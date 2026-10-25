"""Git repositories: access control, creation (templates, folder upload, import), web edits,
reading, settings, collaborators, protected branches, push tokens and the activity log.

Access is decided here for every operation (`get_repo_for`), never by the UI. Roles, lowest to
highest: read < reviewer < write < maintainer < admin < owner. Workspace owners/admins are admins
of every repository in the workspace; the repository owner is "owner"; a "workspace" repository
gives every member `member_role`; collaborators get their own role; anyone else (and every
non-member of the workspace) gets a 404, so private repositories don't reveal themselves.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import ipaddress
import json
import logging
import os
import re
import secrets
import socket
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import CodeRepo, Issue, RepoFile, User, Workspace, WorkspaceMember, WorkspaceType
from app.models.project import IssueStatus
from app.models.repository import (
    REPO_ROLES,
    BranchRule,
    GitAccessToken,
    PullRequest,
    RepoCollaborator,
    RepoEvent,
)
from app.services import git_service as git
from app.services import repo_templates
from app.services.auth_service import AuthError
from app.services.notification_service import iso_utc, notify
from app.services.workspace_service import MANAGER_ROLES, get_workspace_membership

logger = logging.getLogger(__name__)

RANK = {role: i for i, role in enumerate(REPO_ROLES, start=1)}
ROLE_LABEL = {"read": "read", "reviewer": "reviewer", "write": "write", "maintainer": "maintainer", "admin": "admin",
              "owner": "owner"}
ASSIGNABLE_ROLES = ("read", "reviewer", "write", "maintainer", "admin")
MEMBER_ROLES = ("read", "write")
VISIBILITIES = ("workspace", "private")
TOKEN_PREFIX = "nxm_"
UPLOAD_TTL = timedelta(hours=24)
TRASH_TTL = timedelta(days=7)


def at_least(role: str | None, need: str) -> bool:
    return role is not None and RANK.get(role, 0) >= RANK[need]


def now() -> datetime:
    return datetime.now(UTC)


# --------------------------------------------------------------------------------------------
# Access
# --------------------------------------------------------------------------------------------

async def role_for(db: AsyncSession, repo: CodeRepo, user_id: UUID) -> str | None:
    membership = await get_workspace_membership(db, repo.workspace_id, user_id)
    if membership is None:
        return None
    if repo.owner_id == user_id:
        return "owner"
    if membership.role in MANAGER_ROLES:
        return "admin"
    collab = (await db.execute(
        select(RepoCollaborator.role).where(RepoCollaborator.repo_id == repo.id, RepoCollaborator.user_id == user_id)
    )).scalar_one_or_none()
    base = repo.member_role if repo.visibility == "workspace" else None
    candidates = [r for r in (collab, base) if r in RANK]
    return max(candidates, key=RANK.get) if candidates else None


async def get_repo_for(db: AsyncSession, workspace_id: UUID, repo_id: UUID, user_id: UUID,
                       need: str = "read") -> tuple[CodeRepo, str]:
    repo = await db.get(CodeRepo, repo_id)
    if repo is None or repo.workspace_id != workspace_id:
        raise AuthError("Repository not found", 404)
    role = await role_for(db, repo, user_id)
    if role is None:
        raise AuthError("Repository not found", 404)
    if not at_least(role, need):
        raise AuthError(f"You need {ROLE_LABEL[need]} access to this repository to do that", 403)
    return repo, role


def require(role: str, need: str, what: str = "do that") -> None:
    if not at_least(role, need):
        raise AuthError(f"You need {ROLE_LABEL[need]} access to this repository to {what}", 403)


async def find_by_slug(db: AsyncSession, workspace_id: UUID, slug: str) -> CodeRepo | None:
    return (await db.execute(
        select(CodeRepo).where(CodeRepo.workspace_id == workspace_id, CodeRepo.slug == slug.lower())
    )).scalar_one_or_none()


# --------------------------------------------------------------------------------------------
# Storage: bare repository on disk, legacy conversion, backups
# --------------------------------------------------------------------------------------------

_locks: dict[UUID, asyncio.Lock] = {}


def _lock(repo_id: UUID) -> asyncio.Lock:
    return _locks.setdefault(repo_id, asyncio.Lock())


def author_for(user: User | None) -> git.Author:
    if user is None:
        return git.Author("NexaMind", "noreply@nexamind.invalid")
    # A no-reply address: commits are readable by everyone with access, e-mail addresses aren't.
    return git.Author(user.name or "NexaMind user", f"{user.id.hex}@users.noreply.nexamind.invalid")


async def storage(db: AsyncSession, repo: CodeRepo) -> Path:
    """The bare repository of `repo`, creating, converting or restoring it when needed."""
    if repo.status == "importing":
        raise AuthError("This repository is still being imported. Try again in a moment.", 409)
    if repo.status == "failed":
        raise AuthError(repo.status_detail or "The import of this repository failed", 409)
    async with _lock(repo.id):
        if repo.storage_key is None:
            await _convert_legacy(db, repo)
        path = git.repo_path(repo.storage_key)
        if not path.exists():
            await _restore_or_recreate(repo, path)
    return path


async def _convert_legacy(db: AsyncSession, repo: CodeRepo) -> None:
    """Repositories from before real Git storage: their editor files become the first commit."""
    key = uuid.uuid4().hex
    path = git.repo_path(key)
    files = (await db.execute(select(RepoFile).where(RepoFile.repo_id == repo.id))).scalars().all()
    try:
        await git.init_bare(path, repo.default_branch)
        changes, seen = [], set()
        for f in files:
            name = re.sub(r"[\x00-\x1f\x7f\\]", "_", f.name or "file").strip().strip("/") or "file"
            try:
                name = git.validate_path(name)
            except git.GitError:
                name = f"file-{f.id.hex[:8]}"
            if name in seen:
                continue
            seen.add(name)
            changes.append(git.Change("put", name, data=(f.content or "").encode("utf-8")))
        if changes:
            creator = await db.get(User, repo.created_by) if repo.created_by else None
            await git.commit_changes(path, repo.default_branch, changes,
                                     "Import files saved by the previous code editor", author_for(creator),
                                     create_branch=True)
            repo.pushed_at = now()
    except BaseException:
        git.remove_tree(path)
        raise
    repo.storage_key = key
    if files:
        await db.execute(delete(RepoFile).where(RepoFile.repo_id == repo.id))
    await db.flush()


def _bundle_key(storage_key: str) -> str:
    return f"repos/{storage_key}.bundle"


async def _restore_or_recreate(repo: CodeRepo, path: Path) -> None:
    settings = get_settings()
    if settings.storage_backend == "s3":
        from app.services import storage as file_storage

        tmp = git.staging_root() / f"restore-{repo.storage_key}.bundle"
        try:
            await asyncio.to_thread(file_storage._client().download_file, settings.s3_bucket,
                                    _bundle_key(repo.storage_key), str(tmp))
            await git.restore_bundle(tmp, path, repo.default_branch)
            logger.info("Restored repository %s from its backup", repo.id)
            return
        except git.GitError:
            raise
        except Exception:  # noqa: BLE001 - no backup object (or the bucket is unreachable)
            logger.warning("No backup found for repository %s", repo.id)
        finally:
            tmp.unlink(missing_ok=True)
    if repo.pushed_at is None:
        await git.init_bare(path, repo.default_branch)  # never had any commits: nothing was lost
        return
    raise AuthError("This repository's data is not available on this server and no backup was found. "
                    "Ask an administrator to restore it.", 503)


_backup_tasks: dict[str, asyncio.Task] = {}


def schedule_backup(repo: CodeRepo) -> None:
    """With STORAGE_BACKEND=s3, upload a bundle of every ref a few seconds after the last change."""
    if get_settings().storage_backend != "s3" or not repo.storage_key:
        return
    key = repo.storage_key
    task = _backup_tasks.get(key)
    if task and not task.done():
        task.cancel()
    _backup_tasks[key] = asyncio.create_task(_backup_later(key))


async def _backup_later(key: str, delay: float = 5.0) -> None:
    try:
        await asyncio.sleep(delay)
        await backup_now(key)
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001 - a failed backup must never break the request that caused it
        logger.exception("Backup of repository %s failed", key)


async def backup_now(key: str) -> bool:
    from app.services import storage as file_storage

    settings = get_settings()
    path = git.repo_path(key)
    if not path.exists():
        return False
    tmp = git.staging_root() / f"backup-{key}-{secrets.token_hex(4)}.bundle"
    try:
        if not await git.create_bundle(path, tmp):
            return False
        await asyncio.to_thread(file_storage._client().upload_file, str(tmp), settings.s3_bucket, _bundle_key(key))
        return True
    finally:
        tmp.unlink(missing_ok=True)


def _trash(path: Path) -> None:
    if path.exists():
        trash = git.repo_root() / ".trash"
        trash.mkdir(exist_ok=True)
        os.replace(path, trash / f"{path.name}-{int(now().timestamp())}")


def cleanup_storage(reference: datetime | None = None) -> int:
    """Remove deleted repositories after TRASH_TTL and abandoned uploads after UPLOAD_TTL."""
    reference = reference or now()
    removed = 0
    for folder, ttl in ((git.repo_root() / ".trash", TRASH_TTL), (git.staging_root(), UPLOAD_TTL)):
        if not folder.exists():
            continue
        for item in folder.iterdir():
            try:
                age = reference - datetime.fromtimestamp(item.stat().st_mtime, UTC)
            except OSError:
                continue
            if age > ttl:
                git.remove_tree(item) if item.is_dir() else item.unlink(missing_ok=True)
                removed += 1
    return removed


# --------------------------------------------------------------------------------------------
# Activity log
# --------------------------------------------------------------------------------------------

async def record(db: AsyncSession, repo: CodeRepo, actor_id: UUID | None, kind: str, summary: str, **data) -> None:
    db.add(RepoEvent(repo_id=repo.id, workspace_id=repo.workspace_id, actor_id=actor_id, kind=kind,
                     summary=summary[:500], data=data))


async def names(db: AsyncSession, ids) -> dict[str, dict]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.name, User.avatar_url).where(User.id.in_(ids)))).all()
    return {str(r.id): {"id": str(r.id), "name": r.name, "avatar_url": r.avatar_url} for r in rows}


def serialize_event(e: RepoEvent, people: dict, repo: CodeRepo | None = None) -> dict:
    out = {
        "id": str(e.id), "repo_id": str(e.repo_id), "kind": e.kind, "summary": e.summary, "data": e.data or {},
        "actor": people.get(str(e.actor_id)) if e.actor_id else None, "created_at": iso_utc(e.created_at),
    }
    if repo is not None:
        out["repo"] = {"id": str(repo.id), "name": repo.name, "slug": repo.slug}
    return out


async def list_events(db: AsyncSession, repo: CodeRepo, *, limit: int = 30, before: datetime | None = None) -> list[dict]:
    query = select(RepoEvent).where(RepoEvent.repo_id == repo.id)
    if before:
        query = query.where(RepoEvent.created_at < before)
    events = (await db.execute(query.order_by(RepoEvent.created_at.desc()).limit(min(limit, 100)))).scalars().all()
    people = await names(db, [e.actor_id for e in events])
    return [serialize_event(e, people) for e in events]


async def workspace_activity(db: AsyncSession, workspace_id: UUID, user_id: UUID, limit: int = 20) -> list[dict]:
    repos = {r.id: r for r in await visible_repos(db, workspace_id, user_id)}
    if not repos:
        return []
    events = (await db.execute(
        select(RepoEvent).where(RepoEvent.workspace_id == workspace_id, RepoEvent.repo_id.in_(list(repos)))
        .order_by(RepoEvent.created_at.desc()).limit(min(limit, 100))
    )).scalars().all()
    people = await names(db, [e.actor_id for e in events])
    return [serialize_event(e, people, repos[e.repo_id]) for e in events]


# --------------------------------------------------------------------------------------------
# Listing and serialization
# --------------------------------------------------------------------------------------------

def clone_url(base_url: str, repo: CodeRepo) -> str:
    return f"{base_url.rstrip('/')}/git/{repo.workspace_id}/{repo.slug}.git"


def serialize_repo(repo: CodeRepo, role: str | None = None, **extra) -> dict:
    return {
        "id": str(repo.id), "workspace_id": str(repo.workspace_id), "name": repo.name, "slug": repo.slug,
        "description": repo.description, "visibility": repo.visibility, "member_role": repo.member_role,
        "default_branch": repo.default_branch, "owner_id": str(repo.owner_id) if repo.owner_id else None,
        "status": repo.status, "status_detail": repo.status_detail, "imported_from": repo.imported_from,
        "created_by": str(repo.created_by) if repo.created_by else None,
        "created_at": iso_utc(repo.created_at), "updated_at": iso_utc(repo.updated_at), "pushed_at": iso_utc(repo.pushed_at),
        "role": role, **extra,
    }


async def visible_repos(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> list[CodeRepo]:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if membership is None:
        raise AuthError("Workspace not found", 404)
    repos = (await db.execute(
        select(CodeRepo).where(CodeRepo.workspace_id == workspace_id).order_by(CodeRepo.updated_at.desc())
    )).scalars().all()
    if membership.role in MANAGER_ROLES:
        return list(repos)
    collab = set((await db.execute(
        select(RepoCollaborator.repo_id).where(RepoCollaborator.user_id == user_id)
    )).scalars().all())
    return [r for r in repos if r.visibility == "workspace" or r.owner_id == user_id or r.id in collab]


async def list_repos(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> list[dict]:
    repos = await visible_repos(db, workspace_id, user_id)
    ids = [r.id for r in repos]
    issues, prs = {}, {}
    if ids:
        issues = dict((await db.execute(
            select(Issue.repo_id, func.count()).where(Issue.repo_id.in_(ids), Issue.status == IssueStatus.OPEN)
            .group_by(Issue.repo_id)
        )).all())
        prs = dict((await db.execute(
            select(PullRequest.repo_id, func.count()).where(PullRequest.repo_id.in_(ids), PullRequest.state == "open")
            .group_by(PullRequest.repo_id)
        )).all())
    out = []
    for r in repos:
        role = await role_for(db, r, user_id)
        out.append(serialize_repo(r, role, open_issues=issues.get(r.id, 0), open_pull_requests=prs.get(r.id, 0)))
    return out


# --------------------------------------------------------------------------------------------
# Creation
# --------------------------------------------------------------------------------------------

def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9._-]+", "-", (name or "").lower()).strip("-.")
    slug = re.sub(r"\.git$", "", slug)[:90].strip("-.")
    if not slug:
        raise AuthError("Use at least one letter or digit in the repository name", 400)
    return slug


def _clean_name(name: str) -> str:
    name = (name or "").strip()
    if not name or len(name) > 100:
        raise AuthError("A repository name of 1 to 100 characters is required", 400)
    return name


async def _check_slug_free(db: AsyncSession, workspace_id: UUID, slug: str, exclude: UUID | None = None) -> None:
    existing = await find_by_slug(db, workspace_id, slug)
    if existing is not None and existing.id != exclude:
        raise AuthError(f"A repository called '{existing.name}' already uses that name in this workspace", 409)


async def _visibility_for(db: AsyncSession, workspace_id: UUID, requested: str) -> str:
    """A personal workspace has only its owner, so its repositories are always private."""
    workspace = await db.get(Workspace, workspace_id)
    if workspace is not None and workspace.type == WorkspaceType.PERSONAL:
        return "private"
    return _check_choice(requested, VISIBILITIES, "Visibility")


def _check_choice(value: str, allowed, what: str) -> str:
    if value not in allowed:
        raise AuthError(f"{what} must be one of: {', '.join(allowed)}", 400)
    return value


async def create_repository(
    db: AsyncSession, workspace_id: UUID, user: User, *, name: str, description: str | None = None,
    visibility: str = "workspace", default_branch: str = "main", readme: bool = True, gitignore: str | None = None,
    license: str | None = None, upload_id: str | None = None, include_flagged: list[str] | None = None,
) -> CodeRepo:
    if await get_workspace_membership(db, workspace_id, user.id) is None:
        raise AuthError("Workspace not found", 404)
    name = _clean_name(name)
    slug = slugify(name)
    visibility = await _visibility_for(db, workspace_id, visibility)
    default_branch = git.validate_ref_name(default_branch or "main")
    if gitignore and gitignore not in repo_templates.GITIGNORE:
        raise AuthError("Unknown .gitignore template", 400)
    if license and license not in repo_templates.LICENSES:
        raise AuthError("Unknown license", 400)
    await _check_slug_free(db, workspace_id, slug)
    staged = load_upload(workspace_id, user.id, upload_id) if upload_id else None

    repo = CodeRepo(
        workspace_id=workspace_id, name=name, slug=slug, description=(description or "").strip() or None,
        visibility=visibility, default_branch=default_branch, owner_id=user.id, created_by=user.id,
        storage_key=uuid.uuid4().hex,
    )
    db.add(repo)
    try:
        async with db.begin_nested():
            await db.flush()
    except IntegrityError as exc:
        raise AuthError("A repository with that name was just created in this workspace", 409) from exc

    path = git.repo_path(repo.storage_key)
    try:
        await git.init_bare(path, default_branch)
        changes = staged_changes(staged, "", include_flagged or []) if staged else []
        paths = {c.path.lower() for c in changes}
        if readme and not any(p in paths for p in ("readme.md", "readme", "readme.txt")):
            text = f"# {name}\n\n{repo.description}\n" if repo.description else f"# {name}\n"
            changes.append(git.Change("put", "README.md", data=text.encode("utf-8")))
        if gitignore and ".gitignore" not in paths:
            changes.append(git.Change("put", ".gitignore", data=repo_templates.GITIGNORE[gitignore].encode("utf-8")))
        if license and "license" not in paths:
            changes.append(git.Change("put", "LICENSE", data=repo_templates.license_text(license, user.name).encode("utf-8")))
        if changes:
            await git.commit_changes(path, default_branch, changes, "Initial commit", author_for(user), create_branch=True)
            repo.pushed_at = now()
    except BaseException:
        git.remove_tree(path)
        raise
    if staged:
        discard_upload(workspace_id, user.id, upload_id)
    await record(db, repo, user.id, "repo.created", f"{user.name} created the repository {name}",
                 files=len(staged["files"]) if staged else 0)
    schedule_backup(repo)
    return repo


def validate_import_url(url: str) -> str:
    """Only public HTTPS URLs without credentials: no local files, internal hosts or private networks."""
    url = (url or "").strip()
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise AuthError("Enter an https:// clone URL (for example https://github.com/owner/repo.git)", 400)
    if parts.username or parts.password:
        raise AuthError("Don't put credentials in the URL. Only public repositories can be imported.", 400)
    if parts.port not in (None, 443):
        raise AuthError("Only the standard HTTPS port is allowed", 400)
    host = parts.hostname
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise AuthError(f"Couldn't find the host '{host}'", 400) from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0].split("%")[0])
        if not address.is_global:
            raise AuthError("That host is on a private network and can't be imported from", 400)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


async def start_import(db: AsyncSession, workspace_id: UUID, user: User, *, name: str, url: str,
                       description: str | None = None, visibility: str = "workspace") -> tuple[CodeRepo, str]:
    if await get_workspace_membership(db, workspace_id, user.id) is None:
        raise AuthError("Workspace not found", 404)
    name = _clean_name(name)
    slug = slugify(name)
    visibility = await _visibility_for(db, workspace_id, visibility)
    clean = await asyncio.to_thread(validate_import_url, url)
    await _check_slug_free(db, workspace_id, slug)
    repo = CodeRepo(
        workspace_id=workspace_id, name=name, slug=slug, description=(description or "").strip() or None,
        visibility=visibility, owner_id=user.id, created_by=user.id, storage_key=uuid.uuid4().hex,
        status="importing", imported_from=clean[:500],
    )
    db.add(repo)
    try:
        async with db.begin_nested():
            await db.flush()
    except IntegrityError as exc:
        raise AuthError("A repository with that name was just created in this workspace", 409) from exc
    await record(db, repo, user.id, "repo.import_started", f"{user.name} started importing {clean}")
    return repo, clean


async def run_import(repo_id: UUID, url: str) -> None:
    """Background job: clone the URL into the repository's storage and mark it ready or failed."""
    from app import database

    async with database.AsyncSessionLocal() as db:
        repo = await db.get(CodeRepo, repo_id)
        if repo is None or repo.status != "importing":
            return
        path = git.repo_path(repo.storage_key)
        tmp = path.with_name(path.name + ".importing")
        git.remove_tree(tmp)
        try:
            await git.clone_mirror(url, tmp)
            # Keep branches and tags only (hosting services also expose refs/pull/* etc.).
            for ref in (await git.out(tmp, "for-each-ref", "--format=%(refname)")).split():
                if not ref.startswith(("refs/heads/", "refs/tags/")):
                    await git.git(tmp, "update-ref", "-d", ref)
            size = await git.disk_usage(tmp)
            if size > get_settings().git_max_push_mb * 1024 * 1024:
                raise git.GitError(f"The repository is larger than {get_settings().git_max_push_mb} MB", 413)
            head = (await git.out(tmp, "symbolic-ref", "--short", "HEAD", ok_codes=(0, 128))).strip()
            if head and await git.branch_sha(tmp, head):
                repo.default_branch = head
            else:
                branches = await git.list_refs(tmp, "heads")
                if branches:
                    repo.default_branch = branches[0].name
                    await git.set_head(tmp, repo.default_branch)
            os.replace(tmp, path)
            repo.status, repo.status_detail = "ready", None
            repo.pushed_at = now()
            await record(db, repo, repo.created_by, "repo.imported", f"Imported {repo.name} from {repo.imported_from}")
            schedule_backup(repo)
        except Exception as exc:  # noqa: BLE001 - every failure is reported on the repository
            git.remove_tree(tmp)
            detail = exc.message if isinstance(exc, AuthError) else "unexpected error"
            stderr = getattr(exc, "stderr", "") or ""
            hint = stderr.splitlines()[-1][:200] if stderr else ""
            repo.status = "failed"
            repo.status_detail = f"Import failed: {detail}{' (' + hint + ')' if hint else ''}. Delete this repository and try again."
            await record(db, repo, repo.created_by, "repo.import_failed", f"Importing {repo.name} failed")
        await db.commit()
        if repo.status == "ready" and repo.created_by:
            await notify(db, repo.created_by, kind="repo_imported", category="repos",
                         title=f"{repo.name} is ready", body=f"Imported from {repo.imported_from}",
                         dedupe_key=f"repo-imported:{repo.id}", workspace_id=repo.workspace_id,
                         link={"tab": "code", "workspace_id": str(repo.workspace_id), "repo_id": str(repo.id)})
            await db.commit()


# --------------------------------------------------------------------------------------------
# Upload batches (folder import and file upload): staged on disk until committed
# --------------------------------------------------------------------------------------------

SECRET_NAME = re.compile(
    r"(^|/)(\.env(\.[^/]+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|[^/]+\.(pem|key|p12|pfx|keystore|jks|ppk)"
    r"|credentials(\.json)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|secrets?\.(json|ya?ml|toml|env))$",
    re.IGNORECASE,
)
SAFE_NAME = re.compile(r"(^|/)\.env\.(example|sample|template|dist|defaults)$|\.pub$", re.IGNORECASE)
SECRET_CONTENT = [
    (re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY"), "contains a private key"),
    (re.compile(rb"AKIA[0-9A-Z]{16}"), "contains an AWS access key"),
    (re.compile(rb"gh[pousr]_[A-Za-z0-9]{36,}"), "contains a GitHub token"),
    (re.compile(rb"github_pat_[A-Za-z0-9_]{40,}"), "contains a GitHub token"),
    (re.compile(rb"xox[abposr]-[A-Za-z0-9-]{10,}"), "contains a Slack token"),
    (re.compile(rb"AIza[0-9A-Za-z_\-]{35}"), "contains a Google API key"),
    (re.compile(rb"sk_live_[0-9A-Za-z]{16,}"), "contains a Stripe live key"),
    (re.compile(rb"nxm_[A-Za-z0-9_\-]{30,}"), "contains a NexaMind Git token"),
]


def secret_reason(path: str, sample: bytes) -> str | None:
    if SECRET_NAME.search(path) and not SAFE_NAME.search(path):
        return "looks like a secrets or key file"
    for pattern, reason in SECRET_CONTENT:
        if pattern.search(sample):
            return reason
    return None


def _upload_dir(upload_id: str) -> Path:
    try:
        uid = UUID(str(upload_id))
    except ValueError as exc:
        raise AuthError("Upload not found", 404) from exc
    return git.staging_root() / f"upload-{uid.hex}"


def start_upload(workspace_id: UUID, user_id: UUID) -> dict:
    upload_id = uuid.uuid4()
    folder = _upload_dir(str(upload_id))
    folder.mkdir(parents=True)
    meta = {"workspace_id": str(workspace_id), "user_id": str(user_id), "files": {}, "bytes": 0}
    (folder / "manifest.json").write_text(json.dumps(meta), encoding="utf-8")
    return {"upload_id": str(upload_id)}


def load_upload(workspace_id: UUID, user_id: UUID, upload_id: str) -> dict:
    folder = _upload_dir(upload_id)
    manifest = folder / "manifest.json"
    if not manifest.exists():
        raise AuthError("Upload not found or expired. Select the files again.", 404)
    meta = json.loads(manifest.read_text(encoding="utf-8"))
    if meta.get("workspace_id") != str(workspace_id) or meta.get("user_id") != str(user_id):
        raise AuthError("Upload not found or expired. Select the files again.", 404)
    meta["folder"] = folder
    return meta


def discard_upload(workspace_id: UUID, user_id: UUID, upload_id: str) -> None:
    load_upload(workspace_id, user_id, upload_id)
    git.remove_tree(_upload_dir(upload_id))


_upload_locks: dict[str, asyncio.Lock] = {}


async def add_upload_files(workspace_id: UUID, user_id: UUID, upload_id: str, files: list[UploadFile],
                           paths: list[str]) -> dict:
    settings = get_settings()
    if len(files) != len(paths):
        raise AuthError("Send one path for every file", 400)
    max_file = settings.repo_max_file_mb * 1024 * 1024
    max_total = settings.repo_max_upload_mb * 1024 * 1024
    async with _upload_locks.setdefault(upload_id, asyncio.Lock()):
        meta = load_upload(workspace_id, user_id, upload_id)
        folder = meta.pop("folder")
        flagged = []
        for upload, raw_path in zip(files, paths):
            rel = git.validate_path(raw_path)
            if rel not in meta["files"] and len(meta["files"]) >= settings.repo_max_upload_files:
                raise AuthError(f"At most {settings.repo_max_upload_files} files can be added at once", 413)
            # Short name: deep REPO_DIR paths on Windows otherwise exceed MAX_PATH (260 characters).
            blob = folder / f"b{hashlib.sha256(rel.encode('utf-8')).hexdigest()[:24]}"
            previous = meta["files"].get(rel, {}).get("size", 0)
            written = 0
            head = b""
            try:
                with open(blob, "wb") as out_file:
                    while chunk := await upload.read(1024 * 1024):
                        written += len(chunk)
                        if written > max_file:
                            out_file.close()
                            blob.unlink(missing_ok=True)
                            raise AuthError(f"'{rel}' is larger than {settings.repo_max_file_mb} MB", 413)
                        if len(head) < 512 * 1024:
                            head += chunk[: 512 * 1024 - len(head)]
                        out_file.write(chunk)
            except OSError as exc:  # never show server paths to the user
                logger.error("Could not stage %s for upload %s: %s", rel, upload_id, exc)
                raise AuthError(f"The server couldn't store '{rel}'. Try again; if it keeps failing, tell an administrator.", 500) from exc
            meta["bytes"] = meta["bytes"] - previous + written
            if meta["bytes"] > max_total:
                blob.unlink(missing_ok=True)
                raise AuthError(f"The files add up to more than {settings.repo_max_upload_mb} MB", 413)
            reason = secret_reason(rel, head)
            meta["files"][rel] = {"blob": blob.name, "size": written, "flag": reason}
            if reason:
                flagged.append({"path": rel, "reason": reason})
        tmp = folder / "manifest.json.tmp"
        tmp.write_text(json.dumps(meta), encoding="utf-8")
        os.replace(tmp, folder / "manifest.json")
    return {"upload_id": upload_id, "files": len(meta["files"]), "bytes": meta["bytes"], "flagged": flagged}


def staged_changes(meta: dict, base_path: str, include_flagged: list[str]) -> list[git.Change]:
    """Changes for every staged file; refuses files that look like secrets unless explicitly included."""
    base = git.validate_path(base_path, allow_root=True)
    folder = meta["folder"]
    allowed = set(include_flagged or [])
    flagged = [{"path": p, "reason": f["flag"]} for p, f in meta["files"].items() if f.get("flag") and p not in allowed]
    if flagged:
        raise FlaggedFilesError(flagged)
    if not meta["files"]:
        raise AuthError("No files were uploaded", 400)
    return [git.Change("put", f"{base}/{p}" if base else p, source=folder / f["blob"]) for p, f in sorted(meta["files"].items())]


class FlaggedFilesError(AuthError):
    def __init__(self, flagged: list[dict]):
        super().__init__(
            f"{len(flagged)} file(s) look like secrets and were not added. Review them and confirm to include them.", 422)
        self.flagged = flagged


# --------------------------------------------------------------------------------------------
# Web edits
# --------------------------------------------------------------------------------------------

async def protected_branches(db: AsyncSession, repo: CodeRepo) -> dict[str, BranchRule]:
    rules = (await db.execute(select(BranchRule).where(BranchRule.repo_id == repo.id))).scalars().all()
    return {r.branch: r for r in rules}


async def require_unprotected(db: AsyncSession, repo: CodeRepo, branch: str) -> None:
    if branch in await protected_branches(db, repo):
        raise AuthError(f"'{branch}' is protected: commit to a new branch and open a pull request", 403)


def _decode_change(raw: dict, max_bytes: int) -> git.Change:
    op = raw.get("op")
    path = git.validate_path(raw.get("path") or "")
    if op == "put":
        if raw.get("content_base64") is not None:
            try:
                data = base64.b64decode(raw["content_base64"], validate=True)
            except (binascii.Error, ValueError) as exc:
                raise AuthError(f"The content of '{path}' is not valid base64", 400) from exc
        else:
            data = str(raw.get("content") or "").encode("utf-8")
        if len(data) > max_bytes:
            raise AuthError(f"'{path}' is larger than {max_bytes // (1024 * 1024)} MB", 413)
        return git.Change("put", path, data=data, executable=bool(raw.get("executable")))
    if op == "delete":
        return git.Change("delete", path)
    if op == "move":
        return git.Change("move", path, to=git.validate_path(raw.get("to") or ""))
    raise AuthError("Each change needs op 'put', 'delete' or 'move'", 400)


async def web_commit(
    db: AsyncSession, repo: CodeRepo, role: str, user: User, *, branch: str, message: str, changes: list[dict],
    expected_head: str | None = None, new_branch: str | None = None, upload_id: str | None = None,
    base_path: str = "", include_flagged: list[str] | None = None,
) -> dict:
    require(role, "write", "change files")
    path = await storage(db, repo)
    max_bytes = get_settings().repo_max_file_mb * 1024 * 1024
    if len(changes) > 1000:
        raise AuthError("At most 1000 changes per commit", 400)
    decoded = [_decode_change(c, max_bytes) for c in changes]
    staged = load_upload(repo.workspace_id, user.id, upload_id) if upload_id else None
    if staged:
        decoded += staged_changes(staged, base_path, include_flagged or [])
    if not decoded:
        raise AuthError("Nothing to commit", 400)

    branch = git.validate_ref_name(branch or repo.default_branch)
    head = await git.branch_sha(path, branch)
    target = branch
    created_branch = False
    if new_branch:
        target = git.validate_ref_name(new_branch)
        if head is None:
            raise AuthError(f"Branch '{branch}' doesn't exist", 404)
        if await git.branch_sha(path, target):
            raise AuthError(f"Branch '{target}' already exists", 409)
        await require_unprotected(db, repo, target)
        await git.update_ref(path, f"refs/heads/{target}", head, None)
        created_branch = True
    else:
        await require_unprotected(db, repo, target)
    first_commit = head is None and branch == repo.default_branch and not await git.list_refs(path, "heads")
    try:
        sha = await git.commit_changes(path, target, decoded, message, author_for(user),
                                       expected_head=None if created_branch else expected_head,
                                       create_branch=first_commit)
    except BaseException:
        if created_branch:
            await git.delete_ref(path, f"refs/heads/{target}", head)
        raise
    if staged:
        discard_upload(repo.workspace_id, user.id, upload_id)
    old = head if created_branch else (head or git.ZERO_SHA)
    if created_branch:
        await after_ref_change(db, repo, user, [(f"refs/heads/{target}", git.ZERO_SHA, head)], via="web")
    await after_ref_change(db, repo, user, [(f"refs/heads/{target}", old, sha)], via="web")
    return {"sha": sha, "branch": target}


# --------------------------------------------------------------------------------------------
# After any ref change (web edit, merge or push)
# --------------------------------------------------------------------------------------------

CLOSING = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b", re.IGNORECASE)


async def after_ref_change(db: AsyncSession, repo: CodeRepo, actor: User | None, updates: list[tuple[str, str, str]],
                           *, via: str) -> None:
    from app.services import issue_service, pr_service

    if not updates:
        return
    path = git.repo_path(repo.storage_key)
    repo.pushed_at = now()
    actor_name = actor.name if actor else "Someone"
    for ref, old, new in updates:
        kind, _, name = ref.removeprefix("refs/").partition("/")
        if kind == "heads":
            if new == git.ZERO_SHA:
                await record(db, repo, actor and actor.id, "branch.deleted", f"{actor_name} deleted branch {name}", branch=name)
                continue
            if old == git.ZERO_SHA:
                await record(db, repo, actor and actor.id, "branch.created", f"{actor_name} created branch {name}",
                             branch=name, sha=new)
                base = await git.branch_sha(path, repo.default_branch) if name != repo.default_branch else None
                new_commits = [] if via == "web" else await git.log(path, new, limit=50, exclude=base)
            else:
                new_commits = await git.log(path, new, limit=50, exclude=old)
            if new_commits:
                count = len(new_commits)
                verb = "pushed" if via == "push" else "committed"
                await record(db, repo, actor and actor.id, f"commits.{via}", f"{actor_name} {verb} {count} commit{'s' if count != 1 else ''} to {name}",
                             branch=name, before=old, after=new,
                             commits=[{"sha": c.sha, "subject": c.subject[:200]} for c in new_commits[:10]])
            if name == repo.default_branch:
                numbers = {int(n) for c in new_commits for n in CLOSING.findall(f"{c.subject}\n{c.body}")}
                for number in sorted(numbers)[:20]:
                    await issue_service.close_by_reference(db, repo, number, actor, f"commit {new_commits[0].sha[:7]}")
            await pr_service.detect_merged(db, repo, name, old, new, actor)
        elif kind == "tags":
            verb = "deleted tag" if new == git.ZERO_SHA else "tagged"
            await record(db, repo, actor and actor.id, "tag", f"{actor_name} {verb} {name}", tag=name)
    schedule_backup(repo)



# --------------------------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------------------------

def serialize_commit(c: git.CommitInfo, people: dict | None = None) -> dict:
    out = {
        "sha": c.sha, "short_sha": c.sha[:7], "parents": c.parents, "subject": c.subject, "body": c.body,
        "author_name": c.author_name, "authored_at": c.authored_at, "committer_name": c.committer_name,
        "committed_at": c.committed_at,
    }
    m = re.match(r"^([0-9a-f]{32})@users\.noreply\.nexamind\.invalid$", c.author_email or "")
    if m and people is not None:
        out["author"] = people.get(str(UUID(m.group(1))))
    return out


async def commit_people(db: AsyncSession, commits: list[git.CommitInfo]) -> dict:
    ids = set()
    for c in commits:
        m = re.match(r"^([0-9a-f]{32})@users\.noreply\.nexamind\.invalid$", c.author_email or "")
        if m:
            ids.add(UUID(m.group(1)))
    return await names(db, ids)


async def resolve_or_404(path: Path, rev: str) -> str:
    sha = await git.resolve(path, rev)
    if not sha:
        raise AuthError(f"'{rev}' isn't a branch, tag or commit of this repository", 404)
    return sha


async def overview(db: AsyncSession, repo: CodeRepo, role: str, base_url: str) -> dict:
    path = await storage(db, repo)
    branches = await git.list_refs(path, "heads")
    tags = await git.list_refs(path, "tags")
    head = await git.branch_sha(path, repo.default_branch)
    latest, readme, commits = None, None, 0
    if head:
        info = await git.commit_info(path, head)
        people = await commit_people(db, [info])
        latest = serialize_commit(info, people)
        commits = await git.count_commits(path, head)
        for entry in await git.list_tree(path, head, ""):
            if entry.type == "blob" and entry.name.lower() in ("readme.md", "readme", "readme.txt", "readme.markdown"):
                data, size = await git.read_blob(path, head, entry.path, max_bytes=512 * 1024)
                if data and git.is_text(data):
                    readme = {"path": entry.path, "text": data.decode("utf-8", "replace")}
                break
    open_issues = (await db.execute(select(func.count()).select_from(Issue).where(
        Issue.repo_id == repo.id, Issue.status == IssueStatus.OPEN))).scalar_one()
    open_prs = (await db.execute(select(func.count()).select_from(PullRequest).where(
        PullRequest.repo_id == repo.id, PullRequest.state == "open"))).scalar_one()
    return serialize_repo(
        repo, role, clone_url=clone_url(base_url, repo), empty=head is None and not branches,
        head=head, latest_commit=latest, commit_count=commits, branch_count=len(branches), tag_count=len(tags),
        readme=readme, open_issues=open_issues, open_pull_requests=open_prs,
        protected_branches=sorted(await protected_branches(db, repo)),
        size_bytes=await git.disk_usage(path),
    )


async def tree(db: AsyncSession, repo: CodeRepo, ref: str, directory: str) -> dict:
    path = await storage(db, repo)
    sha = await resolve_or_404(path, ref)
    entries = await git.list_tree(path, sha, directory)
    last = await git.log(path, sha, filepath=directory or None, limit=1)
    people = await commit_people(db, last)
    return {
        "ref": ref, "sha": sha, "path": git.validate_path(directory, allow_root=True),
        "entries": [{"name": e.name, "path": e.path, "type": e.type, "size": e.size, "sha": e.sha} for e in entries],
        "last_commit": serialize_commit(last[0], people) if last else None,
    }


MAX_VIEW_BYTES = 1024 * 1024


async def blob(db: AsyncSession, repo: CodeRepo, ref: str, filepath: str) -> dict:
    path = await storage(db, repo)
    sha = await resolve_or_404(path, ref)
    data, size = await git.read_blob(path, sha, filepath, max_bytes=MAX_VIEW_BYTES)
    text = data.decode("utf-8", "replace") if data and git.is_text(data) else None
    last = await git.log(path, sha, filepath=filepath, limit=1)
    people = await commit_people(db, last)
    return {
        "ref": ref, "sha": sha, "path": git.validate_path(filepath), "name": filepath.rsplit("/", 1)[-1], "size": size,
        "text": text if size <= MAX_VIEW_BYTES else None, "binary": bool(data) and text is None,
        "too_large": size > MAX_VIEW_BYTES, "last_commit": serialize_commit(last[0], people) if last else None,
    }


async def raw(db: AsyncSession, repo: CodeRepo, ref: str, filepath: str) -> tuple[bytes, str]:
    path = await storage(db, repo)
    sha = await resolve_or_404(path, ref)
    data, _ = await git.read_blob(path, sha, filepath, max_bytes=100 * 1024 * 1024)
    return data, filepath.rsplit("/", 1)[-1]


async def commits(db: AsyncSession, repo: CodeRepo, ref: str, *, filepath: str | None, page: int, per_page: int = 30) -> dict:
    path = await storage(db, repo)
    sha = await git.resolve(path, ref) if ref else None
    if ref and not sha:
        raise AuthError(f"'{ref}' isn't a branch, tag or commit of this repository", 404)
    if not sha:
        return {"commits": [], "has_more": False}
    page = max(1, page)
    items = await git.log(path, sha, filepath=filepath, skip=(page - 1) * per_page, limit=per_page + 1,
                          follow=bool(filepath))
    people = await commit_people(db, items)
    return {"commits": [serialize_commit(c, people) for c in items[:per_page]], "has_more": len(items) > per_page}


def serialize_diff(d: git.Diff) -> dict:
    return {
        "additions": d.additions, "deletions": d.deletions, "truncated": d.truncated,
        "files": [{"path": f.path, "old_path": f.old_path, "status": f.status, "additions": f.additions,
                   "deletions": f.deletions, "binary": f.binary, "truncated": f.truncated, "patch": f.patch}
                  for f in d.files],
    }


async def commit_detail(db: AsyncSession, repo: CodeRepo, sha: str) -> dict:
    path = await storage(db, repo)
    info = await git.commit_info(path, sha)
    if info is None:
        raise AuthError("Commit not found", 404)
    people = await commit_people(db, [info])
    return {**serialize_commit(info, people), "diff": serialize_diff(await git.commit_diff(path, info))}


async def branches(db: AsyncSession, repo: CodeRepo) -> list[dict]:
    path = await storage(db, repo)
    refs = await git.list_refs(path, "heads")
    rules = await protected_branches(db, repo)
    default_sha = await git.branch_sha(path, repo.default_branch)
    prs = (await db.execute(select(PullRequest).where(PullRequest.repo_id == repo.id, PullRequest.state == "open"))).scalars().all()
    by_source = {p.source_branch: p for p in prs}
    out = []
    for r in refs[:200]:
        ahead = behind = 0
        if default_sha and r.name != repo.default_branch:
            ahead, behind = await git.ahead_behind(path, default_sha, r.sha)
        pr = by_source.get(r.name)
        out.append({
            "name": r.name, "sha": r.sha, "updated_at": r.date, "subject": r.subject, "author_name": r.author,
            "default": r.name == repo.default_branch, "protected": r.name in rules,
            "required_approvals": rules[r.name].required_approvals if r.name in rules else None,
            "ahead": ahead, "behind": behind,
            "pull_request": {"number": pr.number, "title": pr.title} if pr else None,
        })
    out.sort(key=lambda b: (not b["default"], -(datetime.fromisoformat(b["updated_at"]).timestamp() if b["updated_at"] else 0)))
    return out


async def create_branch(db: AsyncSession, repo: CodeRepo, role: str, user: User, name: str, source: str) -> dict:
    require(role, "write", "create branches")
    path = await storage(db, repo)
    name = git.validate_ref_name(name)
    sha = await resolve_or_404(path, source or repo.default_branch)
    if await git.branch_sha(path, name):
        raise AuthError(f"Branch '{name}' already exists", 409)
    await git.update_ref(path, f"refs/heads/{name}", sha, None)
    await after_ref_change(db, repo, user, [(f"refs/heads/{name}", git.ZERO_SHA, sha)], via="web")
    return {"name": name, "sha": sha}


async def delete_branch(db: AsyncSession, repo: CodeRepo, role: str, user: User, name: str) -> None:
    require(role, "write", "delete branches")
    path = await storage(db, repo)
    name = git.validate_ref_name(name)
    if name == repo.default_branch:
        raise AuthError("The default branch can't be deleted. Choose another default branch first.", 400)
    if name in await protected_branches(db, repo):
        raise AuthError(f"'{name}' is protected. Remove the rule in Settings first.", 403)
    sha = await git.branch_sha(path, name)
    if not sha:
        raise AuthError(f"Branch '{name}' doesn't exist", 404)
    await git.delete_ref(path, f"refs/heads/{name}", sha)
    await after_ref_change(db, repo, user, [(f"refs/heads/{name}", sha, git.ZERO_SHA)], via="web")


async def tags(db: AsyncSession, repo: CodeRepo) -> list[dict]:
    path = await storage(db, repo)
    return [{"name": t.name, "sha": t.target, "date": t.date, "subject": t.subject, "message": t.message,
             "tagger": t.author} for t in (await git.list_refs(path, "tags"))[:200]]


async def create_tag(db: AsyncSession, repo: CodeRepo, role: str, user: User, name: str, target: str, message: str) -> dict:
    require(role, "maintainer", "create releases and tags")
    path = await storage(db, repo)
    sha = await resolve_or_404(path, target or repo.default_branch)
    author = author_for(user)
    await git.create_tag(path, name, sha, (message or "").strip() or name, (author.name, author.email))
    await after_ref_change(db, repo, user, [(f"refs/tags/{name}", git.ZERO_SHA, sha)], via="web")
    return {"name": name, "sha": sha}


async def compare(db: AsyncSession, repo: CodeRepo, base: str, head: str) -> dict:
    path = await storage(db, repo)
    base_sha = await resolve_or_404(path, base)
    head_sha = await resolve_or_404(path, head)
    merge_base = await git.merge_base(path, base_sha, head_sha)
    ahead, behind = await git.ahead_behind(path, base_sha, head_sha)
    items = await git.log(path, head_sha, exclude=base_sha, limit=100)
    people = await commit_people(db, items)
    diff = await git.diff(path, merge_base or git.EMPTY_TREE, head_sha)
    _, conflicts = await git.merge_tree(path, base_sha, head_sha) if merge_base else (None, ["(no common history)"])
    return {
        "base": base, "head": head, "base_sha": base_sha, "head_sha": head_sha, "merge_base": merge_base,
        "ahead": ahead, "behind": behind, "commits": [serialize_commit(c, people) for c in items],
        "diff": serialize_diff(diff), "mergeable": not conflicts, "conflicts": conflicts,
    }


async def search(db: AsyncSession, repo: CodeRepo, ref: str, query: str) -> dict:
    path = await storage(db, repo)
    sha = await resolve_or_404(path, ref or repo.default_branch)
    q = (query or "").strip().lower()
    names_found = [p for p in await git.all_paths(path, sha) if q and q in p.lower()][:50]
    return {"ref": ref, "files": names_found, "matches": await git.grep(path, sha, query)}


async def archive(db: AsyncSession, repo: CodeRepo, ref: str) -> tuple[bytes, str]:
    path = await storage(db, repo)
    sha = await resolve_or_404(path, ref or repo.default_branch)
    safe_ref = re.sub(r"[^A-Za-z0-9._-]", "-", ref or repo.default_branch)
    return await git.archive_zip(path, sha, f"{repo.slug}-{safe_ref}"), f"{repo.slug}-{safe_ref}.zip"


# --------------------------------------------------------------------------------------------
# Settings, collaborators, protected branches
# --------------------------------------------------------------------------------------------

async def update_settings(db: AsyncSession, repo: CodeRepo, role: str, user: User, changes: dict) -> CodeRepo:
    require(role, "admin", "change repository settings")
    summary = []
    if "name" in changes and changes["name"] is not None and changes["name"].strip() != repo.name:
        name = _clean_name(changes["name"])
        slug = slugify(name)
        await _check_slug_free(db, repo.workspace_id, slug, exclude=repo.id)
        repo.name, repo.slug = name, slug
        summary.append(f"renamed it to {name}")
    if "description" in changes:
        repo.description = (changes["description"] or "").strip() or None
    if changes.get("visibility"):
        visibility = await _visibility_for(db, repo.workspace_id, changes["visibility"])
        if visibility != repo.visibility:
            repo.visibility = visibility
            summary.append(f"made it {'visible to the workspace' if visibility == 'workspace' else 'private'}")
    if changes.get("member_role") and changes["member_role"] != repo.member_role:
        repo.member_role = _check_choice(changes["member_role"], MEMBER_ROLES, "Member access")
        summary.append(f"set workspace member access to {repo.member_role}")
    if changes.get("default_branch") and changes["default_branch"] != repo.default_branch:
        branch = git.validate_ref_name(changes["default_branch"])
        path = await storage(db, repo)
        if not await git.branch_sha(path, branch):
            raise AuthError(f"Branch '{branch}' doesn't exist", 404)
        await git.set_head(path, branch)
        repo.default_branch = branch
        summary.append(f"set the default branch to {branch}")
    if summary:
        await record(db, repo, user.id, "repo.settings", f"{user.name} " + ", ".join(summary))
    await db.flush()
    return repo


async def delete_repository(db: AsyncSession, repo: CodeRepo, role: str, user: User, confirm_name: str) -> None:
    require(role, "admin", "delete this repository")
    if (confirm_name or "").strip() != repo.name:
        raise AuthError("Type the repository name exactly to confirm", 400)
    key = repo.storage_key
    await db.delete(repo)
    await db.flush()
    if key:
        _trash(git.repo_path(key))  # kept for TRASH_TTL in case the deletion must be undone by an admin


async def collaborators(db: AsyncSession, repo: CodeRepo) -> list[dict]:
    rows = (await db.execute(select(RepoCollaborator).where(RepoCollaborator.repo_id == repo.id))).scalars().all()
    people = await names(db, [r.user_id for r in rows] + [repo.owner_id])
    out = []
    if repo.owner_id and str(repo.owner_id) in people:
        out.append({"user": people[str(repo.owner_id)], "role": "owner", "source": "owner"})
    for r in rows:
        if r.user_id != repo.owner_id and str(r.user_id) in people:
            out.append({"user": people[str(r.user_id)], "role": r.role, "source": "collaborator", "added_at": iso_utc(r.created_at)})
    return out


async def set_collaborator(db: AsyncSession, repo: CodeRepo, role: str, actor: User, user_id: UUID, new_role: str) -> dict:
    require(role, "admin", "manage collaborators")
    _check_choice(new_role, ASSIGNABLE_ROLES, "Role")
    if user_id == repo.owner_id:
        raise AuthError("The owner's access can't be changed", 400)
    if await get_workspace_membership(db, repo.workspace_id, user_id) is None:
        raise AuthError("Only members of this workspace can be added. Invite them to the workspace first.", 400)
    row = (await db.execute(select(RepoCollaborator).where(
        RepoCollaborator.repo_id == repo.id, RepoCollaborator.user_id == user_id))).scalar_one_or_none()
    target = await db.get(User, user_id)
    if row is None:
        db.add(RepoCollaborator(repo_id=repo.id, user_id=user_id, role=new_role, added_by=actor.id))
        await record(db, repo, actor.id, "access.added", f"{actor.name} gave {target.name} {new_role} access",
                     user_id=str(user_id), role=new_role)
        await notify(db, user_id, kind="repo_access", category="repos", title=f"You now have {new_role} access to {repo.name}",
                     body=f"{actor.name} added you as a collaborator.", dedupe_key=f"repo-access:{repo.id}:{user_id}:{new_role}",
                     workspace_id=repo.workspace_id, actor_id=actor.id,
                     link={"tab": "code", "workspace_id": str(repo.workspace_id), "repo_id": str(repo.id)})
    elif row.role != new_role:
        row.role = new_role
        await record(db, repo, actor.id, "access.changed", f"{actor.name} changed {target.name}'s access to {new_role}",
                     user_id=str(user_id), role=new_role)
    await db.flush()
    return {"user_id": str(user_id), "role": new_role}


async def remove_collaborator(db: AsyncSession, repo: CodeRepo, role: str, actor: User, user_id: UUID) -> None:
    require(role, "admin", "manage collaborators")
    row = (await db.execute(select(RepoCollaborator).where(
        RepoCollaborator.repo_id == repo.id, RepoCollaborator.user_id == user_id))).scalar_one_or_none()
    if row is None:
        raise AuthError("That person isn't a collaborator", 404)
    target = await db.get(User, user_id)
    await db.delete(row)
    await record(db, repo, actor.id, "access.removed", f"{actor.name} removed {target.name if target else 'a user'}'s access",
                 user_id=str(user_id))
    await db.flush()


async def branch_rules(db: AsyncSession, repo: CodeRepo) -> list[dict]:
    rules = await protected_branches(db, repo)
    return [{"branch": r.branch, "required_approvals": r.required_approvals, "created_at": iso_utc(r.created_at)}
            for r in rules.values()]


async def set_branch_rule(db: AsyncSession, repo: CodeRepo, role: str, actor: User, branch: str, approvals: int) -> dict:
    require(role, "admin", "protect branches")
    branch = git.validate_ref_name(branch)
    if not 0 <= approvals <= 10:
        raise AuthError("Required approvals must be between 0 and 10", 400)
    rule = (await protected_branches(db, repo)).get(branch)
    if rule is None:
        db.add(BranchRule(repo_id=repo.id, branch=branch, required_approvals=approvals, created_by=actor.id))
    else:
        rule.required_approvals = approvals
    await record(db, repo, actor.id, "branch.protected",
                 f"{actor.name} protected {branch} ({approvals} approval{'s' if approvals != 1 else ''} required)", branch=branch)
    await db.flush()
    return {"branch": branch, "required_approvals": approvals}


async def delete_branch_rule(db: AsyncSession, repo: CodeRepo, role: str, actor: User, branch: str) -> None:
    require(role, "admin", "protect branches")
    rule = (await protected_branches(db, repo)).get(branch)
    if rule is None:
        raise AuthError("That branch isn't protected", 404)
    await db.delete(rule)
    await record(db, repo, actor.id, "branch.unprotected", f"{actor.name} removed the protection of {branch}", branch=branch)
    await db.flush()


# --------------------------------------------------------------------------------------------
# Personal access tokens (git over HTTPS)
# --------------------------------------------------------------------------------------------

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def serialize_token(t: GitAccessToken) -> dict:
    return {"id": str(t.id), "name": t.name, "prefix": t.prefix, "created_at": iso_utc(t.created_at),
            "expires_at": iso_utc(t.expires_at), "last_used_at": iso_utc(t.last_used_at)}


async def list_tokens(db: AsyncSession, user: User) -> list[dict]:
    rows = (await db.execute(select(GitAccessToken).where(
        GitAccessToken.user_id == user.id, GitAccessToken.revoked_at.is_(None)).order_by(GitAccessToken.created_at.desc())
    )).scalars().all()
    return [serialize_token(t) for t in rows]


async def create_token(db: AsyncSession, user: User, name: str, expires_in_days: int | None) -> dict:
    name = (name or "").strip()
    if not name or len(name) > 100:
        raise AuthError("Give the token a name (at most 100 characters)", 400)
    active = (await db.execute(select(func.count()).select_from(GitAccessToken).where(
        GitAccessToken.user_id == user.id, GitAccessToken.revoked_at.is_(None)))).scalar_one()
    if active >= 20:
        raise AuthError("You already have 20 tokens. Revoke one first.", 400)
    if expires_in_days is not None and not 1 <= expires_in_days <= 366:
        raise AuthError("Tokens can last 1 to 366 days", 400)
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = GitAccessToken(user_id=user.id, name=name, token_hash=hash_token(token), prefix=token[:10],
                         expires_at=now() + timedelta(days=expires_in_days) if expires_in_days else None)
    db.add(row)
    await db.flush()
    return {**serialize_token(row), "token": token}


async def revoke_token(db: AsyncSession, user: User, token_id: UUID) -> None:
    row = await db.get(GitAccessToken, token_id)
    if row is None or row.user_id != user.id or row.revoked_at is not None:
        raise AuthError("Token not found", 404)
    row.revoked_at = now()
    await db.flush()


async def user_for_token(db: AsyncSession, token: str) -> User | None:
    if not token or not token.startswith(TOKEN_PREFIX) or len(token) > 200:
        return None
    row = (await db.execute(select(GitAccessToken).where(GitAccessToken.token_hash == hash_token(token)))).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    if row.expires_at is not None:
        expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=UTC)
        if expires < now():
            return None
    user = await db.get(User, row.user_id)
    if user is None or user.deactivated_at is not None:
        return None
    last = row.last_used_at
    if last is None or (last if last.tzinfo else last.replace(tzinfo=UTC)) < now() - timedelta(minutes=5):
        row.last_used_at = now()
    return user


async def push_policy(db: AsyncSession, repo: CodeRepo, role: str) -> str:
    return json.dumps({
        "protected": sorted(await protected_branches(db, repo)),
        "default_branch": repo.default_branch,
        "can_manage": at_least(role, "maintainer"),
    })


async def ref_snapshot(path: Path) -> dict[str, str]:
    text = await git.out(path, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags")
    return dict(line.split(" ", 1) for line in text.splitlines() if " " in line)


def diff_snapshots(before: dict[str, str], after: dict[str, str]) -> list[tuple[str, str, str]]:
    updates = []
    for ref in sorted(set(before) | set(after)):
        old, new = before.get(ref, git.ZERO_SHA), after.get(ref, git.ZERO_SHA)
        if old != new:
            updates.append((ref, old, new))
    return updates


async def member_ids(db: AsyncSession, workspace_id: UUID) -> list[UUID]:
    return list((await db.execute(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id))).scalars())
