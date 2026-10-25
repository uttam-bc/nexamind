"""The real git client against a running server: clone, push, protected branches, permissions."""

import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")

BACKEND = Path(__file__).resolve().parent.parent
GIT_ENV = {
    "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "GIT_ASKPASS": "", "SSH_ASKPASS": "",
    "GIT_AUTHOR_NAME": "Dev", "GIT_AUTHOR_EMAIL": "dev@example.com",
    "GIT_COMMITTER_NAME": "Dev", "GIT_COMMITTER_EMAIL": "dev@example.com",
}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("git-http")
    port = _free_port()
    env = {**os.environ,
           "DATABASE_URL": f"sqlite+aiosqlite:///{(tmp / 'db.sqlite').as_posix()}", "AUTO_CREATE_SCHEMA": "true",
           "REPO_DIR": str(tmp / "repos"), "UPLOAD_DIR": str(tmp / "uploads"), "APP_ENV": "test",
           "RUN_BACKGROUND_JOBS": "false", "RATE_LIMIT_ENABLED": "false", "REQUIRE_EMAIL_VERIFICATION": "false"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                            cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(f"{base}/health", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.2)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield base
    proc.terminate()
    proc.wait(timeout=10)


def _register(base: str, email: str, name: str) -> dict:
    r = httpx.post(f"{base}/auth/register", json={"email": email, "password": "securepass123", "name": name,
                                                  "username": email.split("@")[0]})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    token = httpx.post(f"{base}/auth/git-tokens", headers=headers, json={"name": "laptop"}).json()["token"]
    return {"headers": headers, "token": token}


def _git(*args, cwd=None, check=True):
    proc = subprocess.run(["git", "-c", "credential.helper=", *args], cwd=cwd, capture_output=True, text=True,
                          env={**os.environ, **GIT_ENV}, timeout=120)
    if check and proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed:\n{proc.stderr}")
    return proc


def _url(clone_url: str, token: str | None) -> str:
    return clone_url.replace("http://", f"http://dev:{token}@") if token else clone_url


def test_clone_push_and_policies(server, tmp_path):
    owner = _register(server, "owner@example.com", "Owner")
    member = _register(server, "member@example.com", "Member")
    outsider = _register(server, "outsider@example.com", "Outsider")
    ws = httpx.post(f"{server}/workspaces", headers=owner["headers"], json={"name": "Team"}).json()
    httpx.post(f"{server}/workspaces/join", headers=member["headers"], json={"join_code": ws["join_code"]})
    base = f"{server}/workspaces/{ws['id']}/repos"
    repo = httpx.post(base, headers=owner["headers"], json={"name": "demo", "gitignore": "Node"}).json()
    clone_url = repo["clone_url"]

    # No or wrong credentials: refused.
    assert _git("clone", clone_url, str(tmp_path / "anon"), check=False).returncode != 0
    bad = _git("clone", _url(clone_url, "nxm_wrongwrongwrongwrongwrongwrongwrongwrong"), str(tmp_path / "bad"), check=False)
    assert bad.returncode != 0
    hidden = _git("clone", _url(clone_url, outsider["token"]), str(tmp_path / "outsider"), check=False)
    assert hidden.returncode != 0 and "not found" in hidden.stderr.lower()

    # Clone, commit, push.
    work = tmp_path / "work"
    _git("clone", _url(clone_url, owner["token"]), str(work))
    assert (work / "README.md").read_text().startswith("# demo") and (work / ".gitignore").exists()
    (work / "src").mkdir()
    (work / "src" / "index.js").write_text("console.log('pushed')\n")
    _git("add", ".", cwd=work)
    _git("commit", "-m", "Add index", cwd=work)
    _git("push", "origin", "main", cwd=work)
    commits = httpx.get(f"{base}/{repo['id']}/commits", headers=owner["headers"], params={"ref": "main"}).json()["commits"]
    assert [c["subject"] for c in commits] == ["Add index", "Initial commit"]
    activity = httpx.get(f"{base}/{repo['id']}/activity", headers=owner["headers"]).json()
    assert any(e["kind"] == "commits.push" and "pushed 1 commit to main" in e["summary"] for e in activity)

    # A web edit, then pull it.
    httpx.post(f"{base}/{repo['id']}/commits", headers=owner["headers"], json={
        "branch": "main", "message": "Edit on the web", "changes": [{"op": "put", "path": "web.txt", "content": "web\n"}]})
    _git("pull", "--ff-only", "origin", "main", cwd=work)
    assert (work / "web.txt").read_text() == "web\n"

    # Protected branch: direct pushes are refused by the server's pre-receive policy.
    httpx.put(f"{base}/{repo['id']}/branch-rules", headers=owner["headers"], json={"branch": "main", "required_approvals": 1})
    (work / "a.txt").write_text("a\n")
    _git("add", ".", cwd=work)
    _git("commit", "-m", "Direct", cwd=work)
    refused = _git("push", "origin", "main", cwd=work, check=False)
    assert refused.returncode != 0 and "protected branch" in refused.stderr
    _git("push", "origin", "HEAD:refs/heads/feature", cwd=work)
    branches = {b["name"] for b in httpx.get(f"{base}/{repo['id']}/branches", headers=owner["headers"]).json()}
    assert branches == {"main", "feature"}
    pr = httpx.post(f"{base}/{repo['id']}/pulls", headers=owner["headers"],
                    json={"title": "Direct", "source_branch": "feature"}).json()
    assert pr["status"]["ahead"] == 1

    # Members with read access can clone but not push.
    httpx.patch(f"{base}/{repo['id']}", headers=owner["headers"], json={"member_role": "read"})
    mwork = tmp_path / "member"
    _git("clone", _url(clone_url, member["token"]), str(mwork))
    (mwork / "m.txt").write_text("m\n")
    _git("add", ".", cwd=mwork)
    _git("commit", "-m", "Member change", cwd=mwork)
    denied = _git("push", "origin", "HEAD:refs/heads/member", cwd=mwork, check=False)
    assert denied.returncode != 0 and "write access" in denied.stderr

    # A revoked token stops working immediately.
    tokens = httpx.get(f"{server}/auth/git-tokens", headers=owner["headers"]).json()
    httpx.delete(f"{server}/auth/git-tokens/{tokens[0]['id']}", headers=owner["headers"])
    assert _git("fetch", "origin", cwd=work, check=False).returncode != 0


def test_first_push_into_an_empty_repository(server, tmp_path):
    owner = _register(server, "solo@example.com", "Solo")
    wid = httpx.get(f"{server}/workspaces", headers=owner["headers"]).json()[0]["id"]
    repo = httpx.post(f"{server}/workspaces/{wid}/repos", headers=owner["headers"],
                      json={"name": "fresh", "readme": False}).json()
    assert repo["empty"]
    work = tmp_path / "local"
    _git("init", "-b", "master", str(work))
    (work / "a.txt").write_text("a\n")
    _git("add", ".", cwd=work)
    _git("commit", "-m", "First", cwd=work)
    _git("push", _url(repo["clone_url"], owner["token"]), "master", cwd=work)
    after = httpx.get(f"{server}/workspaces/{wid}/repos/{repo['id']}", headers=owner["headers"]).json()
    assert after["default_branch"] == "master" and after["latest_commit"]["subject"] == "First"
