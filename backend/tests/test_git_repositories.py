"""Git repositories through the API: every write is a real commit in a bare Git repository."""

import base64
import io
import shutil
import subprocess
import zipfile

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.services import git_service, repo_service
from tests.conftest import auth_headers

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


async def _user(client: AsyncClient, email: str, name: str, username: str) -> dict:
    resp = await client.post("/auth/register", json={"email": email, "password": "securepass123", "name": name,
                                                     "username": username})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return {"headers": auth_headers(body["access_token"]), "id": body["user"]["id"]}


@pytest_asyncio.fixture
async def team(client: AsyncClient, auth_context: dict) -> dict:
    owner = auth_headers(auth_context["token"])
    ws = (await client.post("/workspaces", headers=owner, json={"name": "Team"})).json()
    member = await _user(client, "priya@example.com", "Priya", "priya")
    await client.post("/workspaces/join", headers=member["headers"], json={"join_code": ws["join_code"]})
    outsider = await _user(client, "zed@example.com", "Zed", "zed")
    return {"wid": ws["id"], "owner": owner, "owner_id": auth_context["user_id"], "member": member, "outsider": outsider,
            "base": f"/workspaces/{ws['id']}/repos"}


async def _repo(client, team, name="api", **extra) -> dict:
    resp = await client.post(team["base"], headers=team["owner"], json={"name": name, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _commit(client, team, repo, changes, message="Change", branch="main", headers=None, **extra):
    return await client.post(f"{team['base']}/{repo['id']}/commits", headers=headers or team["owner"],
                             json={"branch": branch, "message": message, "changes": changes, **extra})


def _git_log(repo_id_key: str) -> list[str]:
    path = git_service.repo_path(repo_id_key)
    out = subprocess.run(["git", "--git-dir", str(path), "log", "--format=%s", "--all"], capture_output=True, text=True)
    return out.stdout.split("\n")[:-1]


@pytest.mark.asyncio
async def test_create_repository_with_templates_makes_a_real_initial_commit(client: AsyncClient, team: dict, db_session) -> None:
    repo = await _repo(client, team, "Payments API", description="Billing service", gitignore="Python", license="MIT")
    assert repo["slug"] == "payments-api" and repo["default_branch"] == "main" and repo["role"] == "owner"
    assert repo["commit_count"] == 1 and repo["branch_count"] == 1 and not repo["empty"]
    assert repo["readme"]["text"].startswith("# Payments API")
    assert repo["clone_url"].endswith(f"/git/{team['wid']}/payments-api.git")

    tree = (await client.get(f"{team['base']}/{repo['id']}/tree", headers=team["owner"], params={"ref": "main"})).json()
    assert [e["name"] for e in tree["entries"]] == [".gitignore", "LICENSE", "README.md"]
    lic = (await client.get(f"{team['base']}/{repo['id']}/blob", headers=team["owner"],
                            params={"ref": "main", "path": "LICENSE"})).json()
    assert lic["text"].startswith("MIT License") and "Test User" in lic["text"]

    # It is a genuine Git repository: git itself sees the commit.
    from app.models import CodeRepo
    row = await db_session.get(CodeRepo, __import__("uuid").UUID(repo["id"]))
    assert _git_log(row.storage_key) == ["Initial commit"]

    dup = await client.post(team["base"], headers=team["owner"], json={"name": "payments api"})
    assert dup.status_code == 409

    empty = await _repo(client, team, "empty", readme=False)
    assert empty["empty"] and empty["commit_count"] == 0


@pytest.mark.asyncio
async def test_file_operations_are_commits_with_history(client: AsyncClient, team: dict) -> None:
    repo = await _repo(client, team)
    rid = repo["id"]
    head = repo["head"]
    r = await _commit(client, team, repo, [
        {"op": "put", "path": "src/app/main.py", "content": "print('v1')\n"},
        {"op": "put", "path": "docs/.gitkeep", "content": ""},
        {"op": "put", "path": "logo.png", "content_base64": base64.b64encode(bytes(range(256))).decode()},
    ], "Add app", expected_head=head)
    assert r.status_code == 201, r.text
    sha1 = r.json()["sha"]

    # Someone working from the old version gets a conflict instead of overwriting.
    stale = await _commit(client, team, repo, [{"op": "put", "path": "README.md", "content": "x"}], expected_head=head)
    assert stale.status_code == 409

    r = await _commit(client, team, repo, [{"op": "put", "path": "src/app/main.py", "content": "print('v2')\n"}], "Edit app")
    assert r.status_code == 201
    r = await _commit(client, team, repo, [{"op": "move", "path": "src/app", "to": "src/core"}], "Rename folder")
    assert r.status_code == 201
    tree = (await client.get(f"{team['base']}/{rid}/tree", headers=team["owner"], params={"ref": "main", "path": "src"})).json()
    assert [e["path"] for e in tree["entries"]] == ["src/core"]

    blob = (await client.get(f"{team['base']}/{rid}/blob", headers=team["owner"],
                             params={"ref": "main", "path": "src/core/main.py"})).json()
    assert blob["text"] == "print('v2')\n"
    old = (await client.get(f"{team['base']}/{rid}/blob", headers=team["owner"],
                            params={"ref": sha1, "path": "src/app/main.py"})).json()
    assert old["text"] == "print('v1')\n"
    image = (await client.get(f"{team['base']}/{rid}/blob", headers=team["owner"], params={"ref": "main", "path": "logo.png"})).json()
    assert image["binary"] and image["text"] is None
    raw = await client.get(f"{team['base']}/{rid}/raw", headers=team["owner"], params={"ref": "main", "path": "logo.png"})
    assert raw.content == bytes(range(256)) and "attachment" in raw.headers["content-disposition"]

    history = (await client.get(f"{team['base']}/{rid}/commits", headers=team["owner"],
                                params={"ref": "main", "path": "src/core/main.py"})).json()
    assert [c["subject"] for c in history["commits"]] == ["Rename folder", "Edit app", "Add app"]
    assert history["commits"][0]["author"]["name"] == "Test User"

    detail = (await client.get(f"{team['base']}/{rid}/commits/{history['commits'][1]['sha']}", headers=team["owner"])).json()
    assert detail["diff"]["files"][0]["path"] == "src/app/main.py"
    assert "-print('v1')" in detail["diff"]["files"][0]["patch"] and detail["diff"]["additions"] == 1

    r = await _commit(client, team, repo, [{"op": "delete", "path": "docs"}], "Remove docs")
    assert r.status_code == 201
    bad = [
        ([{"op": "put", "path": "../escape.txt", "content": "x"}], 400),
        ([{"op": "put", "path": ".git/config", "content": "x"}], 400),
        ([{"op": "put", "path": "README.md/inner", "content": "x"}], 409),
        ([{"op": "delete", "path": "missing.txt"}], 404),
        ([{"op": "put", "path": "README.md", "content": "# api\n"}], 400),  # nothing changed
    ]
    for changes, code in bad:
        resp = await _commit(client, team, repo, changes)
        assert resp.status_code == code, (changes, resp.text)

    found = (await client.get(f"{team['base']}/{rid}/search", headers=team["owner"], params={"q": "V2"})).json()
    assert found["matches"][0]["path"] == "src/core/main.py"
    archive = await client.get(f"{team['base']}/{rid}/archive", headers=team["owner"], params={"ref": "main"})
    names = zipfile.ZipFile(io.BytesIO(archive.content)).namelist()
    assert "api-main/src/core/main.py" in names


@pytest.mark.asyncio
async def test_create_from_folder_reviews_secrets_and_keeps_bytes(client: AsyncClient, team: dict) -> None:
    upload = (await client.post(f"/workspaces/{team['wid']}/repo-uploads", headers=team["owner"])).json()["upload_id"]
    files = [
        ("files", ("index.js", b"console.log(1)\n", "text/plain")),
        ("files", (".env", b"DB_PASSWORD=hunter2\n", "text/plain")),
        ("files", ("key.txt", b"-----BEGIN RSA PRIVATE KEY-----\nabc\n", "text/plain")),
        ("files", ("photo.bin", bytes(range(256)) * 4, "application/octet-stream")),
    ]
    data = {"paths": ["web/index.js", "web/.env", "web/key.txt", "assets/photo.bin"]}
    up = await client.post(f"/workspaces/{team['wid']}/repo-uploads/{upload}/files", headers=team["owner"], files=files, data=data)
    assert up.status_code == 200, up.text
    assert {f["path"] for f in up.json()["flagged"]} == {"web/.env", "web/key.txt"}

    refused = await client.post(team["base"], headers=team["owner"], json={"name": "site", "upload_id": upload, "readme": False})
    assert refused.status_code == 422 and {f["path"] for f in refused.json()["flagged"]} == {"web/.env", "web/key.txt"}
    listed = (await client.get(team["base"], headers=team["owner"])).json()
    assert not any(r["slug"] == "site" for r in listed)  # nothing half-created

    # Removing the secrets (by re-uploading only what's wanted) and confirming one flagged file.
    created = await client.post(team["base"], headers=team["owner"],
                                json={"name": "site", "upload_id": upload, "readme": False,
                                      "include_flagged": ["web/.env", "web/key.txt"]})
    assert created.status_code == 201, created.text
    repo = created.json()
    raw = await client.get(f"{team['base']}/{repo['id']}/raw", headers=team["owner"], params={"ref": "main", "path": "assets/photo.bin"})
    assert raw.content == bytes(range(256)) * 4
    # The batch is gone after use: a retry can't create a duplicate commit.
    again = await client.post(team["base"], headers=team["owner"], json={"name": "site-2", "upload_id": upload})
    assert again.status_code == 404
    other = await client.post(f"/workspaces/{team['wid']}/repo-uploads/{upload}/files", headers=team["member"]["headers"],
                              files=[("files", ("a.txt", b"a", "text/plain"))], data={"paths": ["a.txt"]})
    assert other.status_code == 404


@pytest.mark.asyncio
async def test_permissions_private_read_only_and_outsiders(client: AsyncClient, team: dict) -> None:
    private = await _repo(client, team, "secret", visibility="private")
    shared = await _repo(client, team, "shared")
    member, outsider = team["member"], team["outsider"]

    listed = [r["slug"] for r in (await client.get(team["base"], headers=member["headers"])).json()]
    assert listed == ["shared"]
    assert (await client.get(f"{team['base']}/{private['id']}", headers=member["headers"])).status_code == 404
    assert (await client.get(f"{team['base']}/{shared['id']}", headers=outsider["headers"])).status_code == 404

    # Workspace repositories default to write for members; read-only blocks writes in the backend.
    settings = await client.patch(f"{team['base']}/{shared['id']}", headers=team["owner"], json={"member_role": "read"})
    assert settings.status_code == 200 and settings.json()["member_role"] == "read"
    denied = await _commit(client, team, shared, [{"op": "put", "path": "x.txt", "content": "x"}], headers=member["headers"])
    assert denied.status_code == 403
    assert (await client.patch(f"{team['base']}/{shared['id']}", headers=member["headers"], json={"name": "hack"})).status_code == 403

    # A collaborator role opens the private repository.
    added = await client.put(f"{team['base']}/{private['id']}/collaborators", headers=team["owner"],
                             json={"user_id": member["id"], "role": "write"})
    assert added.status_code == 200
    ok = await _commit(client, team, private, [{"op": "put", "path": "x.txt", "content": "x"}], headers=member["headers"])
    assert ok.status_code == 201
    outsider_add = await client.put(f"{team['base']}/{private['id']}/collaborators", headers=team["owner"],
                                    json={"user_id": outsider["id"], "role": "read"})
    assert outsider_add.status_code == 400
    people = (await client.get(f"{team['base']}/{private['id']}/collaborators", headers=team["owner"])).json()
    assert {p["role"] for p in people} == {"owner", "write"}

    wrong = await client.request("DELETE", f"{team['base']}/{private['id']}", headers=team["owner"], json={"confirm_name": "nope"})
    assert wrong.status_code == 400
    gone = await client.request("DELETE", f"{team['base']}/{private['id']}", headers=team["owner"], json={"confirm_name": "secret"})
    assert gone.status_code == 204
    assert (await client.get(f"{team['base']}/{private['id']}", headers=team["owner"])).status_code == 404


@pytest.mark.asyncio
async def test_pull_request_review_merge_and_closing_keywords(client: AsyncClient, team: dict) -> None:
    repo = await _repo(client, team)
    rid, member = repo["id"], team["member"]
    issue = (await client.post(f"{team['base']}/{rid}/issues", headers=member["headers"],
                               json={"title": "Login fails", "body": "Steps..."})).json()
    assert issue["number"] == 1

    rule = await client.put(f"{team['base']}/{rid}/branch-rules", headers=team["owner"], json={"branch": "main", "required_approvals": 1})
    assert rule.status_code == 200
    direct = await _commit(client, team, repo, [{"op": "put", "path": "a.txt", "content": "a"}])
    assert direct.status_code == 403  # protected: changes go through pull requests

    r = await _commit(client, team, repo, [{"op": "put", "path": "login.py", "content": "def login():\n    return True\n"}],
                      "Fix login", new_branch="fix-login")
    assert r.status_code == 201 and r.json()["branch"] == "fix-login"
    pr = await client.post(f"{team['base']}/{rid}/pulls", headers=team["owner"],
                           json={"title": "Fix login", "body": "Fixes #1", "source_branch": "fix-login", "reviewer_ids": [member["id"]]})
    assert pr.status_code == 201, pr.text
    pr = pr.json()
    assert pr["number"] == 2 and pr["status"]["ahead"] == 1 and not pr["status"]["mergeable"]
    again = await client.post(f"{team['base']}/{rid}/pulls", headers=team["owner"],
                              json={"title": "Dup", "source_branch": "fix-login"})
    assert again.status_code == 409

    files = (await client.get(f"{team['base']}/{rid}/pulls/2/files", headers=team["owner"])).json()
    assert [f["path"] for f in files["files"]] == ["login.py"]
    blocked = await client.post(f"{team['base']}/{rid}/pulls/2/merge", headers=team["owner"], json={})
    assert blocked.status_code == 409 and "approval" in blocked.json()["detail"]
    self_review = await client.post(f"{team['base']}/{rid}/pulls/2/reviews", headers=team["owner"], json={"state": "approved"})
    assert self_review.status_code == 400

    review = await client.post(f"{team['base']}/{rid}/pulls/2/reviews", headers=member["headers"], json={
        "state": "approved", "body": "Looks good",
        "comments": [{"body": "Nice", "path": "login.py", "line": 2, "side": "new"}]})
    assert review.status_code == 201, review.text
    detail = (await client.get(f"{team['base']}/{rid}/pulls/2", headers=team["owner"])).json()
    assert detail["status"]["mergeable"] and detail["comments"][0]["path"] == "login.py"

    merged = await client.post(f"{team['base']}/{rid}/pulls/2/merge", headers=team["owner"], json={"delete_branch": True})
    assert merged.status_code == 200, merged.text
    assert merged.json()["branch_deleted"]
    detail = (await client.get(f"{team['base']}/{rid}/pulls/2", headers=team["owner"])).json()
    assert detail["state"] == "merged" and detail["merged_by"]["name"] == "Test User"
    log = (await client.get(f"{team['base']}/{rid}/commits", headers=team["owner"], params={"ref": "main"})).json()["commits"]
    assert log[0]["subject"].startswith("Merge pull request #2") and len(log[0]["parents"]) == 2
    # The merged pull request still shows what it changed after its branch is gone.
    files = (await client.get(f"{team['base']}/{rid}/pulls/2/files", headers=team["owner"])).json()
    assert [f["path"] for f in files["files"]] == ["login.py"]
    closed = (await client.get(f"{team['base']}/{rid}/issues/1", headers=team["owner"])).json()
    assert closed["state"] == "closed"
    activity = [e["kind"] for e in (await client.get(f"{team['base']}/{rid}/activity", headers=team["owner"])).json()]
    assert "pr.merged" in activity and "issue.closed" in activity
    notes = (await client.get("/notifications", headers=member["headers"])).json()
    kinds = {n["kind"] for n in notes["items"]}
    assert {"pr_review_requested", "pr_merged"} <= kinds


@pytest.mark.asyncio
async def test_conflicts_block_merging(client: AsyncClient, team: dict) -> None:
    repo = await _repo(client, team)
    rid = repo["id"]
    await _commit(client, team, repo, [{"op": "put", "path": "README.md", "content": "feature\n"}], "Feature", new_branch="feature")
    await _commit(client, team, repo, [{"op": "put", "path": "README.md", "content": "main\n"}], "Main")
    pr = (await client.post(f"{team['base']}/{rid}/pulls", headers=team["owner"],
                            json={"title": "Feature", "source_branch": "feature"})).json()
    assert pr["status"]["conflicts"] == ["README.md"] and not pr["status"]["mergeable"]
    compare = (await client.get(f"{team['base']}/{rid}/compare", headers=team["owner"], params={"base": "main", "head": "feature"})).json()
    assert compare["ahead"] == 1 and compare["behind"] == 1 and not compare["mergeable"]
    resp = await client.post(f"{team['base']}/{rid}/pulls/{pr['number']}/merge", headers=team["owner"], json={})
    assert resp.status_code == 409 and "conflict" in resp.json()["detail"]

    # Resolve on the branch, then squash-merge.
    await _commit(client, team, repo, [{"op": "put", "path": "README.md", "content": "main\n"}], "Resolve", branch="feature")
    await _commit(client, team, repo, [{"op": "put", "path": "extra.txt", "content": "x"}], "Extra", branch="feature")
    resp = await client.post(f"{team['base']}/{rid}/pulls/{pr['number']}/merge", headers=team["owner"], json={"method": "squash"})
    assert resp.status_code == 200, resp.text
    log = (await client.get(f"{team['base']}/{rid}/commits", headers=team["owner"], params={"ref": "main"})).json()["commits"]
    assert log[0]["subject"] == "Feature (#1)" and len(log[0]["parents"]) == 1


@pytest.mark.asyncio
async def test_issues_labels_assignees_and_task_link(client: AsyncClient, team: dict) -> None:
    repo = await _repo(client, team)
    rid, member = repo["id"], team["member"]
    issue = (await client.post(f"{team['base']}/{rid}/issues", headers=team["owner"], json={
        "title": "Crash on save", "labels": ["Bug", "bug", "ui"], "assignee_id": member["id"], "priority": "high",
        "milestone": "v1"})).json()
    assert issue["labels"] == ["bug", "ui"] and issue["assignee"]["name"] == "Priya" and issue["priority"] == "high"
    outsider = await client.patch(f"{team['base']}/{rid}/issues/1", headers=team["owner"], json={"assignee_id": team["outsider"]["id"]})
    assert outsider.status_code == 400
    comment = await client.post(f"{team['base']}/{rid}/issues/1/comments", headers=member["headers"], json={"body": "On it"})
    assert comment.status_code == 201

    linked = (await client.put(f"{team['base']}/{rid}/issues/1/task", headers=team["owner"], json={})).json()
    task_id = linked["task"]["id"]
    again = (await client.put(f"{team['base']}/{rid}/issues/1/task", headers=team["owner"], json={})).json()
    assert again["task"]["id"] == task_id  # no duplicate task
    tasks = (await client.get(f"/workspaces/{team['wid']}/tasks", headers=team["owner"])).json()
    assert sum(1 for t in tasks if t["id"] == task_id) == 1

    done = await client.patch(f"/workspaces/{team['wid']}/tasks/{task_id}", headers=team["owner"], json={"status": "done"})
    assert done.status_code == 200
    assert (await client.get(f"{team['base']}/{rid}/issues/1", headers=team["owner"])).json()["state"] == "closed"
    reopened = await client.patch(f"{team['base']}/{rid}/issues/1", headers=team["owner"], json={"state": "open"})
    assert reopened.json()["task"]["status"] == "todo"

    listing = (await client.get(f"{team['base']}/{rid}/issues", headers=team["owner"], params={"label": "ui"})).json()
    assert [i["number"] for i in listing["issues"]] == [1] and "bug" in listing["labels"]


@pytest.mark.asyncio
async def test_legacy_repository_files_become_the_first_commit(client: AsyncClient, team: dict, db_session) -> None:
    import uuid

    from app.models import CodeRepo, RepoFile

    legacy = CodeRepo(workspace_id=uuid.UUID(team["wid"]), name="Old", slug="old", created_by=uuid.UUID(team["owner_id"]),
                      owner_id=uuid.UUID(team["owner_id"]))
    db_session.add(legacy)
    await db_session.flush()
    db_session.add(RepoFile(repo_id=legacy.id, name="main.js", content="console.log('old')\n", language="javascript"))
    await db_session.commit()

    repo = (await client.get(f"{team['base']}/{legacy.id}", headers=team["owner"])).json()
    assert repo["commit_count"] == 1 and repo["latest_commit"]["subject"] == "Import files saved by the previous code editor"
    blob = (await client.get(f"{team['base']}/{legacy.id}/blob", headers=team["owner"], params={"ref": "main", "path": "main.js"})).json()
    assert blob["text"] == "console.log('old')\n"


@pytest.mark.asyncio
async def test_import_url_guard(monkeypatch) -> None:
    for url in ("http://github.com/a/b.git", "file:///etc", "https://user:pw@github.com/a/b.git",
                "https://127.0.0.1/a.git", "https://localhost/a.git", "https://10.0.0.5/x.git", "https://example.com:8443/x.git"):
        with pytest.raises(repo_service.AuthError):
            repo_service.validate_import_url(url)


@pytest.mark.asyncio
async def test_import_clones_branches_and_tags(client: AsyncClient, team: dict, monkeypatch, tmp_path) -> None:
    source = tmp_path / "source.git"
    subprocess.run(["git", "init", "--bare", "-b", "trunk", str(source)], check=True, capture_output=True)
    work = tmp_path / "work"
    subprocess.run(["git", "clone", str(source), str(work)], check=True, capture_output=True)
    (work / "hello.txt").write_text("hi\n")
    env = {"GIT_AUTHOR_NAME": "A", "GIT_AUTHOR_EMAIL": "a@x", "GIT_COMMITTER_NAME": "A", "GIT_COMMITTER_EMAIL": "a@x"}
    import os
    full_env = {**os.environ, **env}
    for cmd in (["add", "."], ["commit", "-m", "hello"], ["tag", "v1"], ["push", "origin", "trunk", "--tags"]):
        subprocess.run(["git", "-C", str(work), *cmd], check=True, capture_output=True, env=full_env)

    monkeypatch.setattr(repo_service, "validate_import_url", lambda url: url)

    async def local_clone(url, dest, timeout=None):
        await git_service.run(["-c", "protocol.file.allow=always", "clone", "--mirror", "--quiet", "--", url, str(dest)])
        await git_service.configure(dest)

    monkeypatch.setattr(git_service, "clone_mirror", local_clone)
    resp = await client.post(f"{team['base']}/import", headers=team["owner"], json={"name": "imported", "url": str(source)})
    assert resp.status_code == 202, resp.text
    repo = (await client.get(f"{team['base']}/{resp.json()['id']}", headers=team["owner"])).json()
    assert repo["status"] == "ready", repo
    assert repo["default_branch"] == "trunk" and repo["tag_count"] == 1 and repo["latest_commit"]["subject"] == "hello"


@pytest.mark.asyncio
async def test_personal_workspace_repositories_are_always_private(client: AsyncClient, auth_context: dict) -> None:
    headers = auth_headers(auth_context["token"])
    base = f"/workspaces/{auth_context['workspace_id']}/repos"  # the personal workspace
    repo = (await client.post(base, headers=headers, json={"name": "notes", "visibility": "workspace"})).json()
    assert repo["visibility"] == "private"
    updated = await client.patch(f"{base}/{repo['id']}", headers=headers, json={"visibility": "workspace"})
    assert updated.status_code == 200 and updated.json()["visibility"] == "private"
