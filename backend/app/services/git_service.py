"""Thin, safe wrapper around the `git` command line for bare repositories.

Every call passes arguments as a list (never through a shell), with a minimal environment: no
system or global config, no hooks (except the server's own pre-receive policy for pushes), no
credential prompts. Paths and ref names coming from users are validated here before they reach
git, and options are separated from user values with `--end-of-options`/`--`.

Web edits never use a working tree: they build a tree in a temporary index file and create the
commit with `commit-tree`, then move the branch with `update-ref <new> <old>`, which fails if
somebody else moved it in the meantime (no lost updates under concurrency).
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import logging

from app.config import get_settings
from app.services.auth_service import AuthError

logger = logging.getLogger(__name__)

ZERO_SHA = "0" * 40
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHORT_SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")
MAX_DIFF_BYTES = 2 * 1024 * 1024
MAX_FILE_PATCH_BYTES = 256 * 1024
TEXT_SNIFF = 8000


class GitError(AuthError):
    """A git operation failed or was refused; `status_code` is what the API answers with."""

    def __init__(self, message: str, status_code: int = 400, stderr: str = ""):
        super().__init__(message, status_code)
        self.stderr = stderr


# --------------------------------------------------------------------------------------------
# Locations and environment
# --------------------------------------------------------------------------------------------

def repo_root() -> Path:
    root = Path(get_settings().repo_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _support_dir() -> Path:
    d = repo_root() / ".nexamind"
    (d / "home").mkdir(parents=True, exist_ok=True)
    (d / "no-hooks").mkdir(parents=True, exist_ok=True)
    gitconfig = d / "home" / ".gitconfig"
    if not gitconfig.exists():
        gitconfig.write_text("", encoding="utf-8")
    return d


def remove_tree(path: Path) -> None:
    """Delete a folder that may hold git objects (read-only on Windows); missing is fine."""
    import stat

    def retry(func, target, _exc):
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except OSError:
            pass

    if Path(path).exists():
        shutil.rmtree(path, onexc=retry) if sys.version_info >= (3, 12) else shutil.rmtree(path, onerror=retry)


def repo_path(storage_key: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", storage_key or ""):
        raise GitError("Invalid repository storage key", 500)
    return repo_root() / f"{storage_key}.git"


def staging_root() -> Path:
    d = repo_root() / ".staging"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _hooks_dir() -> Path:
    """Hooks used for pushes only: a pre-receive hook that applies the policy in NEXAMIND_REF_POLICY."""
    d = _support_dir() / "push-hooks"
    d.mkdir(parents=True, exist_ok=True)
    hook = d / "pre-receive"
    script = (
        "#!/bin/sh\n"
        'exec "$NEXAMIND_PYTHON" -I "$NEXAMIND_PRE_RECEIVE"\n'
    )
    if not hook.exists() or hook.read_text(encoding="utf-8") != script:
        hook.write_text(script, encoding="utf-8", newline="\n")
        hook.chmod(0o755)
    return d


def _base_env(extra: dict | None = None) -> dict:
    support = _support_dir()
    env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "COMSPEC", "PATHEXT", "WINDIR")
           if k in os.environ}
    env.update(
        HOME=str(support / "home"),
        XDG_CONFIG_HOME=str(support / "home"),
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=str(support / "home" / ".gitconfig"),
        GIT_ATTR_NOSYSTEM="1",
        GIT_TERMINAL_PROMPT="0",
        GIT_ASKPASS="",
        SSH_ASKPASS="",
        LC_ALL="C",
        LANG="C",
    )
    if extra:
        env.update(extra)
    return env


def _git_args(args: list[str], hooks: Path | None = None) -> list[str]:
    hooks = hooks or (_support_dir() / "no-hooks")
    return [
        get_settings().git_binary,
        "-c", f"core.hooksPath={hooks.as_posix()}",
        "-c", "core.fsmonitor=false",
        "-c", "core.quotePath=false",
        "-c", "core.autocrlf=false",
        "-c", "core.longpaths=true",  # Windows: deep repository folders exceed MAX_PATH
        "-c", "safe.directory=*",
        "-c", "protocol.allow=never",
        "-c", "protocol.https.allow=always",
        *args,
    ]


_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run_sync(
    args: list[str],
    *,
    cwd: Path | None = None,
    input: bytes | None = None,
    env: dict | None = None,
    timeout: float | None = None,
    ok_codes: tuple[int, ...] = (0,),
    hooks: Path | None = None,
) -> subprocess.CompletedProcess:
    try:
        proc = subprocess.run(
            _git_args(args, hooks),
            cwd=str(cwd) if cwd else None,
            input=input,
            capture_output=True,
            env=_base_env(env),
            timeout=timeout or get_settings().git_timeout_seconds,
            creationflags=_NO_WINDOW,
        )
    except FileNotFoundError as exc:
        raise GitError("git is not installed on the server", 503) from exc
    except subprocess.TimeoutExpired as exc:
        raise GitError("The git operation took too long and was stopped", 504) from exc
    if proc.returncode not in ok_codes:
        stderr = proc.stderr.decode("utf-8", "replace").strip()
        logger.warning("git %s exited with %s: %s", args[0] if args[0] != "--git-dir" else args[2], proc.returncode, stderr[:500])
        raise GitError(f"git {args[0]} failed", 500, stderr)
    return proc


async def run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    # A thread instead of asyncio subprocesses: those are unavailable on Windows selector loops.
    return await asyncio.to_thread(run_sync, args, **kwargs)


async def git(repo: Path, *args: str, **kwargs) -> subprocess.CompletedProcess:
    return await run(["--git-dir", str(repo), *args], **kwargs)


async def out(repo: Path, *args: str, **kwargs) -> str:
    return (await git(repo, *args, **kwargs)).stdout.decode("utf-8", "replace")


async def version() -> tuple[int, ...]:
    text = (await run(["--version"])).stdout.decode()
    m = re.search(r"(\d+)\.(\d+)", text)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


# --------------------------------------------------------------------------------------------
# Validation of user input
# --------------------------------------------------------------------------------------------

_REF_COMPONENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._+\-]*$")


def validate_ref_name(name: str, what: str = "Branch") -> str:
    """Branch/tag names: letters, digits, `._+-` and `/` between parts; no `..`, `.lock`, leading `-`/`.`."""
    name = (name or "").strip()
    if not name or len(name) > 200 or name == "HEAD":
        raise GitError(f"{what} name is required (at most 200 characters)", 400)
    parts = name.split("/")
    for part in parts:
        if not _REF_COMPONENT.match(part) or part.endswith(".") or part.endswith(".lock") or ".." in part:
            raise GitError(
                f"{what} name '{name}' is not allowed: use letters, digits, '.', '_', '-', '+' and '/' between parts", 400
            )
    return name


def validate_path(path: str, *, allow_root: bool = False) -> str:
    """A repository-relative path with '/' separators. Refuses '..', '.git' and control characters."""
    raw = (path or "").strip()
    if "\\" in raw or "\x00" in raw:
        raise GitError("Paths use '/' between folders and cannot contain '\\'", 400)
    raw = raw.strip("/")
    if not raw:
        if allow_root:
            return ""
        raise GitError("A file path is required", 400)
    if len(raw.encode("utf-8")) > 4096:
        raise GitError("That path is too long", 400)
    for part in raw.split("/"):
        if part in ("", ".", ".."):
            raise GitError(f"'{path}' is not a valid path", 400)
        if part.lower() == ".git" or part.lower().startswith(".git/"):
            raise GitError("'.git' cannot be used as a file or folder name", 400)
        if len(part.encode("utf-8")) > 255:
            raise GitError("A file or folder name is too long", 400)
        if any(ord(c) < 32 or ord(c) == 127 for c in part):
            raise GitError("File names cannot contain control characters", 400)
        if part != part.strip():
            raise GitError("File and folder names cannot start or end with spaces", 400)
    return raw


def is_text(data: bytes) -> bool:
    sample = data[:TEXT_SNIFF]
    if bytes(1) in sample:
        return False
    try:
        sample.decode("utf-8")
        return True
    except UnicodeDecodeError as exc:
        # A multi-byte character cut by the sample boundary is still text.
        return exc.start >= len(sample) - 4


# --------------------------------------------------------------------------------------------
# Repository lifecycle
# --------------------------------------------------------------------------------------------

async def init_bare(path: Path, default_branch: str) -> None:
    validate_ref_name(default_branch)
    if path.exists():
        raise GitError("A repository already exists at this location", 409)
    await run(["init", "--bare", "--quiet", f"--initial-branch={default_branch}", str(path)])
    await configure(path)


async def configure(path: Path) -> None:
    max_push = get_settings().git_max_push_mb * 1024 * 1024
    for key, value in (
        ("receive.fsckObjects", "true"),
        ("transfer.fsckObjects", "true"),
        ("receive.maxInputSize", str(max_push)),
        ("receive.denyDeleteCurrent", "true"),
        ("uploadpack.allowFilter", "true"),
        ("core.logAllRefUpdates", "true"),
        ("gc.auto", "6700"),
    ):
        await git(path, "config", key, value)


async def set_head(path: Path, branch: str) -> None:
    validate_ref_name(branch)
    await git(path, "symbolic-ref", "HEAD", f"refs/heads/{branch}")


async def clone_mirror(url: str, dest: Path, *, timeout: float | None = None) -> None:
    """Clone everything from `url` (already checked by the caller) into a new bare repository."""
    await run(
        ["-c", "http.followRedirects=false", "clone", "--mirror", "--no-local", "--quiet", "--", url, str(dest)],
        timeout=timeout,
    )
    # Forget where it came from: no stored remote, no credentials in config.
    await git(dest, "remote", "remove", "origin", ok_codes=(0, 2))
    await configure(dest)


async def create_bundle(path: Path, out_file: Path) -> bool:
    """Bundle every ref; False when the repository is still empty."""
    if not (await out(path, "for-each-ref", "--count=1", "--format=%(refname)")).strip():
        return False
    await git(path, "bundle", "create", str(out_file), "--all")
    return True


async def restore_bundle(bundle: Path, dest: Path, head_branch: str) -> None:
    tmp = dest.with_name(dest.name + ".restoring")
    remove_tree(tmp)
    await run(["-c", "protocol.file.allow=always", "clone", "--mirror", "--quiet", "--", str(bundle), str(tmp)])
    await git(tmp, "remote", "remove", "origin", ok_codes=(0, 2))
    await configure(tmp)
    try:
        await set_head(tmp, head_branch)
    except GitError:
        pass
    os.replace(tmp, dest)


async def disk_usage(path: Path) -> int:
    text = await out(path, "count-objects", "-v")
    kb = 0
    for line in text.splitlines():
        key, _, value = line.partition(":")
        if key in ("size", "size-pack"):
            kb += int(value.strip() or 0)
    return kb * 1024


# --------------------------------------------------------------------------------------------
# Refs
# --------------------------------------------------------------------------------------------

@dataclass
class Ref:
    name: str
    sha: str
    date: str
    subject: str
    author: str = ""
    target: str | None = None  # commit a tag points at
    message: str | None = None


async def list_refs(path: Path, kind: str = "heads") -> list[Ref]:
    fmt = "%(refname:lstrip=2)%00%(objectname)%00%(*objectname)%00%(creatordate:iso-strict)%00%(subject)%00%(authorname)%(taggername)%00%(contents)%1e"
    sort = "-creatordate"
    text = await out(path, "for-each-ref", f"--sort={sort}", f"--format={fmt}", f"refs/{kind}")
    refs = []
    for record in text.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        name, sha, peeled, date, subject, author, contents = (record.split("\x00") + [""] * 7)[:7]
        refs.append(Ref(name=name, sha=sha, date=date, subject=subject, author=author,
                        target=peeled or sha, message=contents.strip() if kind == "tags" else None))
    return refs


async def ref_sha(path: Path, ref: str) -> str | None:
    proc = await git(path, "rev-parse", "--verify", "--quiet", "--end-of-options", f"{ref}^{{commit}}", ok_codes=(0, 1, 128))
    sha = proc.stdout.decode().strip()
    return sha if proc.returncode == 0 and SHA_RE.match(sha) else None


async def branch_sha(path: Path, branch: str) -> str | None:
    return await ref_sha(path, f"refs/heads/{validate_ref_name(branch)}")


async def resolve(path: Path, rev: str) -> str | None:
    """A branch, tag or commit id (full or abbreviated) to a commit id; None when it doesn't exist."""
    rev = (rev or "").strip()
    if not rev:
        return None
    if SHORT_SHA_RE.match(rev):
        sha = await ref_sha(path, rev)
        if sha:
            return sha
    try:
        validate_ref_name(rev)
    except GitError:
        return None
    return await ref_sha(path, f"refs/heads/{rev}") or await ref_sha(path, f"refs/tags/{rev}")


async def update_ref(path: Path, ref: str, new: str, old: str | None) -> None:
    """Move `ref` to `new` only if it still points at `old` (None = must not exist yet)."""
    proc = await git(path, "update-ref", "-m", "nexamind", "--end-of-options", ref, new, old or ZERO_SHA, ok_codes=(0, 128, 1))
    if proc.returncode != 0:
        raise GitError("The branch changed while you were working. Reload and try again.", 409,
                       proc.stderr.decode("utf-8", "replace"))


async def delete_ref(path: Path, ref: str, old: str) -> None:
    proc = await git(path, "update-ref", "-d", "--end-of-options", ref, old, ok_codes=(0, 1, 128))
    if proc.returncode != 0:
        raise GitError("The branch changed while you were working. Reload and try again.", 409)


async def is_ancestor(path: Path, ancestor: str, descendant: str) -> bool:
    proc = await git(path, "merge-base", "--is-ancestor", ancestor, descendant, ok_codes=(0, 1))
    return proc.returncode == 0


async def merge_base(path: Path, a: str, b: str) -> str | None:
    proc = await git(path, "merge-base", a, b, ok_codes=(0, 1))
    sha = proc.stdout.decode().strip()
    return sha or None


async def ahead_behind(path: Path, base: str, head: str) -> tuple[int, int]:
    """(commits in head not in base, commits in base not in head)."""
    text = await out(path, "rev-list", "--left-right", "--count", f"{base}...{head}")
    behind, ahead = (int(x) for x in text.split())
    return ahead, behind


async def create_tag(path: Path, name: str, target: str, message: str, tagger: tuple[str, str]) -> None:
    validate_ref_name(name, "Tag")
    env = {"GIT_COMMITTER_NAME": tagger[0], "GIT_COMMITTER_EMAIL": tagger[1]}
    proc = await git(path, "tag", "-a", "-m", message or name, name, target, env=env, ok_codes=(0, 128))
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace")
        if "already exists" in err:
            raise GitError(f"Tag '{name}' already exists", 409)
        raise GitError("Could not create the tag", 400, err)


# --------------------------------------------------------------------------------------------
# Reading trees, files and history
# --------------------------------------------------------------------------------------------

@dataclass
class TreeEntry:
    name: str
    path: str
    type: str  # "tree" | "blob" | "symlink" | "submodule"
    mode: str
    sha: str
    size: int | None


async def list_tree(path: Path, commit: str, directory: str = "") -> list[TreeEntry]:
    directory = validate_path(directory, allow_root=True)
    treeish = f"{commit}:{directory}" if directory else f"{commit}^{{tree}}"
    proc = await git(path, "ls-tree", "-z", "-l", "--end-of-options", treeish, ok_codes=(0, 128))
    if proc.returncode != 0:
        raise GitError("That folder doesn't exist in this version", 404)
    entries = []
    for record in proc.stdout.split(b"\x00"):
        if not record:
            continue
        meta, _, name_b = record.partition(b"\t")
        mode, otype, sha, size = meta.decode().split(None, 3)
        name = name_b.decode("utf-8", "replace")
        kind = {"tree": "tree", "commit": "submodule"}.get(otype, "symlink" if mode == "120000" else "blob")
        entries.append(TreeEntry(name=name, path=f"{directory}/{name}" if directory else name, type=kind,
                                 mode=mode, sha=sha, size=int(size) if size.strip().isdigit() else None))
    entries.sort(key=lambda e: (e.type != "tree", e.name.lower()))
    return entries


async def object_info(path: Path, commit: str, filepath: str) -> tuple[str, int] | None:
    """(type, size) of the object at `filepath` in `commit`, or None."""
    filepath = validate_path(filepath)
    proc = await git(path, "cat-file", "--batch-check", input=f"{commit}:{filepath}\n".encode(), ok_codes=(0,))
    line = proc.stdout.decode("utf-8", "replace").strip()
    if line.endswith("missing") or not line:
        return None
    _sha, otype, size = line.rsplit(" ", 2)
    return otype, int(size)


async def read_blob(path: Path, commit: str, filepath: str, max_bytes: int | None = None) -> tuple[bytes, int]:
    info = await object_info(path, commit, filepath)
    if info is None or info[0] != "blob":
        raise GitError("That file doesn't exist in this version", 404)
    size = info[1]
    if max_bytes is not None and size > max_bytes:
        return b"", size
    proc = await git(path, "cat-file", "blob", f"{commit}:{validate_path(filepath)}")
    return proc.stdout, size


async def all_paths(path: Path, commit: str) -> list[str]:
    proc = await git(path, "ls-tree", "-r", "-z", "--name-only", "--end-of-options", f"{commit}^{{tree}}")
    return [p.decode("utf-8", "replace") for p in proc.stdout.split(b"\x00") if p]


@dataclass
class CommitInfo:
    sha: str
    parents: list[str]
    author_name: str
    author_email: str
    authored_at: str
    committer_name: str
    committed_at: str
    subject: str
    body: str = ""


_LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%s%x00%b%x1e"


def _parse_log(text: str) -> list[CommitInfo]:
    commits = []
    for record in text.split("\x1e"):
        record = record.lstrip("\n")
        if not record:
            continue
        parts = record.split("\x00")
        if len(parts) < 9:
            continue
        sha, parents, an, ae, ad, cn, cd, subject, body = parts[:9]
        commits.append(CommitInfo(sha=sha, parents=parents.split(), author_name=an, author_email=ae, authored_at=ad,
                                  committer_name=cn, committed_at=cd, subject=subject, body=body.strip()))
    return commits


async def log(path: Path, rev: str, *, filepath: str | None = None, skip: int = 0, limit: int = 30,
              exclude: str | None = None, follow: bool = False) -> list[CommitInfo]:
    args = ["log", f"--format={_LOG_FORMAT}", f"--max-count={max(1, min(limit, 200))}", f"--skip={max(0, skip)}"]
    if follow and filepath:
        args.append("--follow")
    args += ["--end-of-options", rev]
    if exclude:
        args.append(f"^{exclude}")
    args.append("--")
    if filepath:
        args.append(validate_path(filepath))
    return _parse_log(await out(path, *args))


async def commit_info(path: Path, sha: str) -> CommitInfo | None:
    found = await resolve(path, sha)
    if not found:
        return None
    commits = _parse_log(await out(path, "log", "-1", f"--format={_LOG_FORMAT}", "--end-of-options", found, "--"))
    return commits[0] if commits else None


async def count_commits(path: Path, rev: str) -> int:
    return int((await out(path, "rev-list", "--count", "--end-of-options", rev, "--")).strip() or 0)


# --------------------------------------------------------------------------------------------
# Diffs
# --------------------------------------------------------------------------------------------

@dataclass
class FileDiff:
    path: str
    old_path: str | None
    status: str  # added | modified | deleted | renamed
    additions: int = 0
    deletions: int = 0
    binary: bool = False
    truncated: bool = False
    patch: str = ""


@dataclass
class Diff:
    files: list[FileDiff] = field(default_factory=list)
    additions: int = 0
    deletions: int = 0
    truncated: bool = False


def _unquote(p: str) -> str:
    if p.startswith('"') and p.endswith('"'):
        p = p[1:-1].encode("latin-1", "backslashreplace").decode("unicode_escape").encode("latin-1").decode("utf-8", "replace")
    return p


def parse_diff(text: str) -> Diff:
    diff = Diff()
    total = 0
    current: FileDiff | None = None
    lines_out: list[str] = []

    def finish():
        nonlocal total
        if current is None:
            return
        patch = "\n".join(lines_out)
        if len(patch) > MAX_FILE_PATCH_BYTES or total + len(patch) > MAX_DIFF_BYTES:
            current.truncated = True
            patch = ""
        total += len(patch)
        current.patch = patch
        diff.files.append(current)
        diff.additions += current.additions
        diff.deletions += current.deletions

    in_hunk = False
    for line in text.split("\n"):
        if line.startswith("diff --git "):
            finish()
            m = re.match(r'diff --git (?:"?a/(.*?)"?) (?:"?b/(.*?)"?)$', line)
            a, b = (m.group(1), m.group(2)) if m else ("", "")
            current = FileDiff(path=_unquote(b), old_path=_unquote(a), status="modified")
            lines_out = []
            in_hunk = False
            continue
        if current is None:
            continue
        if not in_hunk:
            if line.startswith("new file mode"):
                current.status = "added"
            elif line.startswith("deleted file mode"):
                current.status = "deleted"
            elif line.startswith("rename from "):
                current.status = "renamed"
                current.old_path = _unquote(line[len("rename from "):])
            elif line.startswith("rename to "):
                current.path = _unquote(line[len("rename to "):])
            elif line.startswith("Binary files ") or line.startswith("GIT binary patch"):
                current.binary = True
            elif line.startswith("--- "):
                continue
            elif line.startswith("+++ "):
                continue
            elif line.startswith("@@"):
                in_hunk = True
                lines_out.append(line)
            continue
        if line.startswith("@@"):
            lines_out.append(line)
        elif line.startswith("+"):
            current.additions += 1
            lines_out.append(line)
        elif line.startswith("-"):
            current.deletions += 1
            lines_out.append(line)
        elif line.startswith(" ") or line.startswith("\\"):
            lines_out.append(line)
    finish()
    for f in diff.files:
        if f.status not in ("renamed",) and f.old_path == f.path:
            f.old_path = None if f.status != "deleted" else f.path
    diff.truncated = any(f.truncated for f in diff.files)
    return diff


async def diff(path: Path, base: str, head: str, *, filepath: str | None = None) -> Diff:
    args = ["diff", "--no-color", "--no-ext-diff", "--find-renames", "-U3", "--end-of-options", base, head, "--"]
    if filepath:
        args.append(validate_path(filepath))
    proc = await git(path, *args)
    raw = proc.stdout
    result = parse_diff(raw[: MAX_DIFF_BYTES * 2].decode("utf-8", "replace"))
    if len(raw) > MAX_DIFF_BYTES * 2:
        result.truncated = True
    return result


async def commit_diff(path: Path, commit: CommitInfo) -> Diff:
    return await diff(path, commit.parents[0] if commit.parents else EMPTY_TREE, commit.sha)


# --------------------------------------------------------------------------------------------
# Writing: commits without a working tree
# --------------------------------------------------------------------------------------------

@dataclass
class Change:
    op: str  # "put" | "delete" | "move"
    path: str
    data: bytes | None = None  # for put (small content)
    source: Path | None = None  # for put (a staged file on disk)
    to: str | None = None  # for move
    executable: bool = False


@dataclass
class Author:
    name: str
    email: str


async def _hash_objects(path: Path, changes: list[Change]) -> dict[int, str]:
    shas: dict[int, str] = {}
    files = [(i, c) for i, c in enumerate(changes) if c.op == "put" and c.source is not None]
    if files:
        listing = "\n".join(str(c.source) for _, c in files) + "\n"
        text = await out(path, "hash-object", "-w", "--no-filters", "--stdin-paths", input=listing.encode("utf-8"))
        for (i, _), sha in zip(files, text.split()):
            shas[i] = sha
    for i, c in enumerate(changes):
        if c.op == "put" and c.source is None:
            shas[i] = (await out(path, "hash-object", "-w", "--no-filters", "--stdin", input=c.data or b"")).strip()
    return shas


async def _read_index(path: Path, commit: str | None) -> dict[str, tuple[str, str]]:
    """path -> (mode, sha) for every file in `commit`."""
    if not commit:
        return {}
    proc = await git(path, "ls-tree", "-r", "-z", "--full-tree", "--end-of-options", commit)
    entries = {}
    for record in proc.stdout.split(b"\x00"):
        if not record:
            continue
        meta, _, name = record.partition(b"\t")
        mode, _otype, sha = meta.decode().split()
        entries[name.decode("utf-8", "replace")] = (mode, sha)
    return entries


def _apply(entries: dict[str, tuple[str, str]], changes: list[Change], shas: dict[int, str]) -> None:
    def folder_exists(p: str) -> bool:
        prefix = p + "/"
        return any(k.startswith(prefix) for k in entries)

    def check_put(p: str):
        if folder_exists(p):
            raise GitError(f"'{p}' is a folder", 409)
        parts = p.split("/")
        for i in range(1, len(parts)):
            parent = "/".join(parts[:i])
            if parent in entries:
                raise GitError(f"'{parent}' is a file, so it can't contain '{parts[i]}'", 409)

    for i, change in enumerate(changes):
        p = validate_path(change.path)
        if change.op == "put":
            check_put(p)
            existing = entries.get(p)
            keep = existing and existing[0] in ("100644", "100755")
            mode = "100755" if change.executable else (existing[0] if keep else "100644")
            entries[p] = (mode, shas[i])
        elif change.op == "delete":
            if p in entries:
                del entries[p]
            elif folder_exists(p):
                for k in [k for k in entries if k.startswith(p + "/")]:
                    del entries[k]
            else:
                raise GitError(f"'{p}' doesn't exist", 404)
        elif change.op == "move":
            dest = validate_path(change.to or "")
            if dest == p:
                continue
            if dest.startswith(p + "/"):
                raise GitError("A folder can't be moved into itself", 400)
            if p in entries:
                check_put(dest)
                if dest in entries:
                    raise GitError(f"'{dest}' already exists", 409)
                entries[dest] = entries.pop(p)
            elif folder_exists(p):
                if dest in entries or folder_exists(dest):
                    raise GitError(f"'{dest}' already exists", 409)
                check_put(dest)
                for k in [k for k in entries if k.startswith(p + "/")]:
                    entries[dest + k[len(p):]] = entries.pop(k)
            else:
                raise GitError(f"'{p}' doesn't exist", 404)
        else:
            raise GitError("Unknown change", 400)


async def write_tree(path: Path, entries: dict[str, tuple[str, str]]) -> str:
    with tempfile.TemporaryDirectory(dir=staging_root()) as tmp:
        env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        await git(path, "read-tree", "--empty", env=env)
        if entries:
            info = "".join(f"{mode} {sha}\t{p}\x00" for p, (mode, sha) in entries.items())
            await git(path, "update-index", "-z", "--index-info", input=info.encode("utf-8"), env=env)
        return (await out(path, "write-tree", env=env)).strip()


async def commit_tree(path: Path, tree: str, parents: list[str], message: str, author: Author,
                      committer: Author | None = None) -> str:
    committer = committer or author
    env = {
        "GIT_AUTHOR_NAME": author.name or "NexaMind user",
        "GIT_AUTHOR_EMAIL": author.email or "user@nexamind.invalid",
        "GIT_COMMITTER_NAME": committer.name or "NexaMind",
        "GIT_COMMITTER_EMAIL": committer.email or "noreply@nexamind.invalid",
    }
    args = ["commit-tree", tree]
    for p in parents:
        args += ["-p", p]
    args += ["-F", "-"]
    return (await out(path, *args, input=message.encode("utf-8"), env=env)).strip()


async def commit_changes(path: Path, branch: str, changes: list[Change], message: str, author: Author, *,
                         expected_head: str | None = None, create_branch: bool = False) -> str:
    """Apply `changes` on top of `branch` as one commit; returns the new commit id.

    `expected_head` (the commit the user was looking at) makes the request fail with 409 instead of
    silently overwriting a change someone else pushed meanwhile."""
    branch = validate_ref_name(branch)
    message = (message or "").strip()
    if not message:
        raise GitError("A commit message is required", 400)
    head = await branch_sha(path, branch)
    if head is None and not create_branch:
        raise GitError(f"Branch '{branch}' doesn't exist", 404)
    if expected_head and head and expected_head != head:
        raise GitError("Someone changed this branch since you opened it. Reload to see the latest version.", 409)
    entries = await _read_index(path, head)
    before = dict(entries)
    shas = await _hash_objects(path, changes)
    _apply(entries, changes, shas)
    if entries == before and head is not None:
        raise GitError("Nothing changed: the files are already like this", 400)
    tree = await write_tree(path, entries)
    sha = await commit_tree(path, tree, [head] if head else [], message, author)
    await update_ref(path, f"refs/heads/{branch}", sha, head)
    return sha


async def merge_tree(path: Path, base: str, head: str) -> tuple[str | None, list[str]]:
    """Merge `head` into `base` in memory: (tree, []) when clean, (None, conflicting paths) otherwise."""
    proc = await git(path, "merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", base, head, ok_codes=(0, 1))
    parts = [p.decode("utf-8", "replace") for p in proc.stdout.split(b"\x00") if p]
    if proc.returncode == 0:
        return parts[0], []
    return None, sorted(set(parts[1:]))


# --------------------------------------------------------------------------------------------
# Search and archives
# --------------------------------------------------------------------------------------------

async def grep(path: Path, commit: str, query: str, *, limit: int = 100) -> list[dict]:
    query = (query or "").strip()
    if not query or len(query) > 200:
        raise GitError("Search for 1 to 200 characters", 400)
    proc = await git(path, "grep", "-I", "-n", "-z", "-F", "-i", "--no-color", "--max-count=5", "-e", query, commit, "--",
                     ok_codes=(0, 1))
    results = []
    for line in proc.stdout.split(b"\n"):
        if not line:
            continue
        parts = line.split(b"\x00", 2)
        if len(parts) != 3:
            continue
        loc, lineno, text = parts
        file = loc.decode("utf-8", "replace").split(":", 1)[-1]
        results.append({"path": file, "line": int(lineno or 0), "text": text.decode("utf-8", "replace")[:300]})
        if len(results) >= limit:
            break
    return results


async def archive_zip(path: Path, commit: str, prefix: str) -> bytes:
    prefix = re.sub(r"[^A-Za-z0-9._-]", "-", prefix)[:80] or "repository"
    return (await git(path, "archive", "--format=zip", f"--prefix={prefix}/", commit)).stdout


# --------------------------------------------------------------------------------------------
# Smart HTTP (clone, fetch, push)
# --------------------------------------------------------------------------------------------

SERVICES = {"git-upload-pack": "upload-pack", "git-receive-pack": "receive-pack"}
_PROTOCOL_RE = re.compile(r"^[A-Za-z0-9=:.,\-]{1,100}$")


def _pkt(line: str) -> bytes:
    data = line.encode()
    return f"{len(data) + 4:04x}".encode() + data


def _service_env(protocol: str | None, policy: str | None) -> tuple[dict, Path | None]:
    env: dict = {}
    if protocol and _PROTOCOL_RE.match(protocol):
        env["GIT_PROTOCOL"] = protocol
    hooks = None
    if policy is not None:
        env["NEXAMIND_REF_POLICY"] = policy
        env["NEXAMIND_PYTHON"] = Path(sys.executable).as_posix()
        env["NEXAMIND_PRE_RECEIVE"] = (Path(__file__).parent / "git_pre_receive.py").as_posix()
        hooks = _hooks_dir()
    return env, hooks


async def advertise(path: Path, service: str, protocol: str | None) -> bytes:
    sub = SERVICES[service]
    env, _ = _service_env(protocol, None)
    body = (await git(path, sub, "--stateless-rpc", "--advertise-refs", str(path), env=env)).stdout
    if protocol and "version=2" in protocol and sub == "upload-pack":
        return body
    return _pkt(f"# service={service}\n") + b"0000" + body


def stream_rpc(path: Path, service: str, body: bytes, protocol: str | None, policy: str | None = None):
    """Run upload-pack/receive-pack for one request and yield its output as it is produced."""
    import threading

    sub = SERVICES[service]
    env, hooks = _service_env(protocol, policy)
    args = _git_args(["--git-dir", str(path), sub, "--stateless-rpc", str(path)], hooks)
    proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env=_base_env(env), creationflags=_NO_WINDOW)

    def feed():
        try:
            proc.stdin.write(body)
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                proc.stdin.close()
            except OSError:
                pass

    writer = threading.Thread(target=feed, daemon=True)
    writer.start()
    try:
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            yield chunk
        proc.wait(timeout=get_settings().git_timeout_seconds)
    finally:
        if proc.poll() is None:
            proc.kill()
        writer.join(timeout=5)


def parse_receive_commands(body: bytes) -> list[tuple[str, str, str]]:
    """The (old, new, ref) updates at the start of a receive-pack request (pkt-lines until flush)."""
    commands = []
    pos = 0
    while pos + 4 <= len(body):
        try:
            length = int(body[pos:pos + 4], 16)
        except ValueError:
            break
        if length == 0:
            break
        if length < 4:
            break
        line = body[pos + 4:pos + length].split(b"\x00", 1)[0].decode("utf-8", "replace").strip()
        pos += length
        parts = line.split(" ")
        if len(parts) == 3 and not line.startswith("shallow"):
            commands.append((parts[0], parts[1], parts[2]))
    return commands
