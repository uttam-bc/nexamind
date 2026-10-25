"""Git smart HTTP: `git clone/fetch/pull/push https://<api>/git/<workspace id>/<repo>.git`.

Authentication is HTTP Basic with a personal access token as the password (any user name).
Reading needs read access, pushing needs write access; the pre-receive hook then enforces
protected branches, the default branch and tag rules for the pushing user."""

import asyncio
import base64
import binascii
import zlib
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.security import rate_limiter
from app.services import git_service as git
from app.services import repo_service
from app.services.auth_service import AuthError

router = APIRouter(prefix="/git", tags=["git"])

NO_CACHE = {"Cache-Control": "no-cache, max-age=0, must-revalidate", "Pragma": "no-cache"}


def _challenge(message: str) -> Response:
    return Response(content=message + "\n", status_code=401, media_type="text/plain",
                    headers={"WWW-Authenticate": 'Basic realm="NexaMind Git", charset="UTF-8"'})


async def _user(request: Request, db: AsyncSession) -> User | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("basic "):
        return None
    try:
        decoded = base64.b64decode(header[6:].strip(), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None
    _, _, token = decoded.partition(":")
    user = await repo_service.user_for_token(db, token)
    if user is None and get_settings().rate_limit_enabled:
        ip = request.client.host if request.client else "unknown"
        rate_limiter.check(f"git-auth-failed:{ip}", 20, 300)
    return user


async def _open(db: AsyncSession, workspace_id: UUID, name: str, user: User, need: str):
    slug = name[:-4] if name.endswith(".git") else name
    repo = await repo_service.find_by_slug(db, workspace_id, slug)
    role = await repo_service.role_for(db, repo, user.id) if repo else None
    if repo is None or role is None:
        raise AuthError("Repository not found", 404)
    if not repo_service.at_least(role, need):
        raise AuthError(f"You need {need} access to this repository to push" if need == "write" else "Access denied", 403)
    return repo, role, await repo_service.storage(db, repo)


async def _body(request: Request) -> bytes:
    limit = get_settings().git_max_push_mb * 1024 * 1024
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise AuthError(f"The push is larger than {get_settings().git_max_push_mb} MB", 413)
        chunks.append(chunk)
    data = b"".join(chunks)
    if request.headers.get("content-encoding", "").lower() == "gzip":
        inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            data = inflater.decompress(data, limit + 1)
        except zlib.error as exc:
            raise AuthError("The request body is not valid gzip", 400) from exc
        if len(data) > limit or inflater.unconsumed_tail:
            raise AuthError(f"The push is larger than {get_settings().git_max_push_mb} MB", 413)
    return data


def _plain(exc: AuthError) -> Response:
    return Response(content=exc.message + "\n", status_code=exc.status_code, media_type="text/plain")


@router.get("/{workspace_id}/{name}/info/refs")
async def info_refs(workspace_id: UUID, name: str, request: Request, service: str = Query(""),
                    db: AsyncSession = Depends(get_db, scope="function")) -> Response:
    if service not in git.SERVICES:
        return Response("Only the smart HTTP protocol is supported. Update git.\n", status_code=403, media_type="text/plain")
    user = await _user(request, db)
    if user is None:
        return _challenge("Sign in with your NexaMind user name and a personal access token")
    try:
        _, _, path = await _open(db, workspace_id, name, user, "write" if service == "git-receive-pack" else "read")
        data = await git.advertise(path, service, request.headers.get("git-protocol"))
    except AuthError as exc:
        return _plain(exc)
    return Response(content=data, media_type=f"application/x-{service}-advertisement", headers=NO_CACHE)


@router.post("/{workspace_id}/{name}/git-upload-pack")
async def upload_pack(workspace_id: UUID, name: str, request: Request,
                      db: AsyncSession = Depends(get_db, scope="function")) -> Response:
    user = await _user(request, db)
    if user is None:
        return _challenge("Authentication required")
    try:
        _, _, path = await _open(db, workspace_id, name, user, "read")
        body = await _body(request)
    except AuthError as exc:
        return _plain(exc)
    stream = git.stream_rpc(path, "git-upload-pack", body, request.headers.get("git-protocol"))
    return StreamingResponse(stream, media_type="application/x-git-upload-pack-result", headers=NO_CACHE)


@router.post("/{workspace_id}/{name}/git-receive-pack")
async def receive_pack(workspace_id: UUID, name: str, request: Request,
                       db: AsyncSession = Depends(get_db, scope="function")) -> Response:
    user = await _user(request, db)
    if user is None:
        return _challenge("Authentication required")
    try:
        repo, role, path = await _open(db, workspace_id, name, user, "write")
        body = await _body(request)
        policy = await repo_service.push_policy(db, repo, role)
    except AuthError as exc:
        return _plain(exc)
    async with repo_service._lock(repo.id):
        before = await repo_service.ref_snapshot(path)
        output = await asyncio.to_thread(
            lambda: b"".join(git.stream_rpc(path, "git-receive-pack", body, request.headers.get("git-protocol"), policy))
        )
        after = await repo_service.ref_snapshot(path)
    updates = repo_service.diff_snapshots(before, after)
    if updates:
        if repo.default_branch not in {r.removeprefix("refs/heads/") for r in after if r.startswith("refs/heads/")}:
            heads = sorted(r.removeprefix("refs/heads/") for r in after if r.startswith("refs/heads/"))
            if heads:  # first push of an empty repository with a different branch name
                repo.default_branch = heads[0]
                await git.set_head(path, heads[0])
        await repo_service.after_ref_change(db, repo, user, updates, via="push")
    return Response(content=output, media_type="application/x-git-receive-pack-result", headers=NO_CACHE)
