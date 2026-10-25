"""Git repositories, their files, history, branches, pull requests and issues.

Every handler resolves the repository with `repo_service.get_repo_for`, which applies the caller's
role; the services check the role again for each action."""

from datetime import datetime
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.repository import (
    ActionItemIssue,
    BranchCreate,
    BranchRuleSet,
    CollaboratorSet,
    CommentCreate,
    CommitRequest,
    IssueCreate,
    IssueUpdate,
    MergeRequest,
    PullRequestCreate,
    PullRequestUpdate,
    RepoCreate,
    RepoDelete,
    RepoImport,
    RepoUpdate,
    ReviewCreate,
    TagCreate,
    TaskLink,
    TokenCreate,
)
from app.security import check_identity_limit
from app.services import issue_service, pr_service, repo_service, repo_templates

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["repositories"])
token_router = APIRouter(prefix="/auth/git-tokens", tags=["repositories"])

DB = Depends(get_db, scope="function")


def _attachment(data: bytes, filename: str, media_type: str = "application/octet-stream") -> Response:
    return Response(content=data, media_type=media_type, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "X-Content-Type-Options": "nosniff",
    })


async def _repo(db, workspace_id: UUID, repo_id: UUID, user: User, need: str = "read"):
    return await repo_service.get_repo_for(db, workspace_id, repo_id, user.id, need)


# --- Repositories ---------------------------------------------------------------------------

@router.get("/repos")
async def list_repositories(workspace_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = DB):
    return await repo_service.list_repos(db, workspace_id, user.id)


@router.get("/repo-templates")
async def templates(workspace_id: UUID, user: User = Depends(get_current_user)):
    return repo_templates.catalog()


@router.get("/repo-activity")
async def workspace_activity(workspace_id: UUID, limit: int = Query(20, ge=1, le=100),
                             user: User = Depends(get_current_user), db: AsyncSession = DB):
    return await repo_service.workspace_activity(db, workspace_id, user.id, limit)


@router.post("/repos", status_code=status.HTTP_201_CREATED)
async def create_repository(workspace_id: UUID, data: RepoCreate, request: Request,
                            user: User = Depends(get_current_user), db: AsyncSession = DB):
    check_identity_limit("repo-create", str(user.id), 30, 3600)
    repo = await repo_service.create_repository(
        db, workspace_id, user, name=data.name, description=data.description, visibility=data.visibility,
        default_branch=data.default_branch, readme=data.readme, gitignore=data.gitignore, license=data.license,
        upload_id=data.upload_id, include_flagged=data.include_flagged,
    )
    return await repo_service.overview(db, repo, "owner", str(request.base_url))


@router.post("/repos/import", status_code=status.HTTP_202_ACCEPTED)
async def import_repository(workspace_id: UUID, data: RepoImport, background: BackgroundTasks,
                            user: User = Depends(get_current_user), db: AsyncSession = DB):
    check_identity_limit("repo-import", str(user.id), 10, 3600)
    repo, url = await repo_service.start_import(db, workspace_id, user, name=data.name, url=data.url,
                                                description=data.description, visibility=data.visibility)
    background.add_task(repo_service.run_import, repo.id, url)
    return repo_service.serialize_repo(repo, "owner")


@router.post("/repo-uploads", status_code=status.HTTP_201_CREATED)
async def start_upload(workspace_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = DB):
    if await repo_service.get_workspace_membership(db, workspace_id, user.id) is None:
        raise repo_service.AuthError("Workspace not found", 404)
    return repo_service.start_upload(workspace_id, user.id)


@router.post("/repo-uploads/{upload_id}/files")
async def upload_files(workspace_id: UUID, upload_id: str, files: list[UploadFile] = File(...),
                       paths: list[str] = Form(...), user: User = Depends(get_current_user)):
    check_identity_limit("repo-upload", str(user.id), 600, 3600)
    return await repo_service.add_upload_files(workspace_id, user.id, upload_id, files, paths)


@router.delete("/repo-uploads/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
async def discard_upload(workspace_id: UUID, upload_id: str, user: User = Depends(get_current_user)) -> Response:
    repo_service.discard_upload(workspace_id, user.id, upload_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/repos/{repo_id}")
async def get_repository(workspace_id: UUID, repo_id: UUID, request: Request,
                         user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    if repo.status != "ready":
        return repo_service.serialize_repo(repo, role)
    return await repo_service.overview(db, repo, role, str(request.base_url))


@router.patch("/repos/{repo_id}")
async def update_repository(workspace_id: UUID, repo_id: UUID, data: RepoUpdate, request: Request,
                            user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    await repo_service.update_settings(db, repo, role, user, data.model_dump(exclude_unset=True))
    return await repo_service.overview(db, repo, role, str(request.base_url))


@router.delete("/repos/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_repository(workspace_id: UUID, repo_id: UUID, data: RepoDelete,
                            user: User = Depends(get_current_user), db: AsyncSession = DB) -> Response:
    repo, role = await _repo(db, workspace_id, repo_id, user)
    await repo_service.delete_repository(db, repo, role, user, data.confirm_name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/repos/{repo_id}/activity")
async def repository_activity(workspace_id: UUID, repo_id: UUID, before: datetime | None = None,
                              user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.list_events(db, repo, before=before)


# --- Files and history ------------------------------------------------------------------------

@router.get("/repos/{repo_id}/tree")
async def tree(workspace_id: UUID, repo_id: UUID, ref: str = Query(..., max_length=200), path: str = Query("", max_length=4096),
               user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.tree(db, repo, ref, path)


@router.get("/repos/{repo_id}/blob")
async def blob(workspace_id: UUID, repo_id: UUID, ref: str = Query(..., max_length=200), path: str = Query(..., max_length=4096),
               user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.blob(db, repo, ref, path)


@router.get("/repos/{repo_id}/raw")
async def raw(workspace_id: UUID, repo_id: UUID, ref: str = Query(..., max_length=200), path: str = Query(..., max_length=4096),
              user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    data, name = await repo_service.raw(db, repo, ref, path)
    return _attachment(data, name)


@router.get("/repos/{repo_id}/archive")
async def archive(workspace_id: UUID, repo_id: UUID, ref: str = Query("", max_length=200),
                  user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    data, name = await repo_service.archive(db, repo, ref)
    return _attachment(data, name, "application/zip")


@router.get("/repos/{repo_id}/search")
async def search(workspace_id: UUID, repo_id: UUID, q: str = Query(..., min_length=1, max_length=200),
                 ref: str = Query("", max_length=200), user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.search(db, repo, ref, q)


@router.get("/repos/{repo_id}/commits")
async def commits(workspace_id: UUID, repo_id: UUID, ref: str = Query("", max_length=200),
                  path: str | None = Query(None, max_length=4096), page: int = Query(1, ge=1, le=10000),
                  user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.commits(db, repo, ref or repo.default_branch, filepath=path or None, page=page)


@router.post("/repos/{repo_id}/commits", status_code=status.HTTP_201_CREATED)
async def create_commit(workspace_id: UUID, repo_id: UUID, data: CommitRequest,
                        user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.web_commit(
        db, repo, role, user, branch=data.branch, message=data.message,
        changes=[c.model_dump() for c in data.changes], expected_head=data.expected_head, new_branch=data.new_branch,
        upload_id=data.upload_id, base_path=data.base_path, include_flagged=data.include_flagged,
    )


@router.get("/repos/{repo_id}/commits/{sha}")
async def commit_detail(workspace_id: UUID, repo_id: UUID, sha: str, user: User = Depends(get_current_user),
                        db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.commit_detail(db, repo, sha)


@router.get("/repos/{repo_id}/compare")
async def compare(workspace_id: UUID, repo_id: UUID, base: str = Query(..., max_length=200), head: str = Query(..., max_length=200),
                  user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.compare(db, repo, base, head)


# --- Branches and tags ------------------------------------------------------------------------

@router.get("/repos/{repo_id}/branches")
async def branches(workspace_id: UUID, repo_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.branches(db, repo)


@router.post("/repos/{repo_id}/branches", status_code=status.HTTP_201_CREATED)
async def create_branch(workspace_id: UUID, repo_id: UUID, data: BranchCreate, user: User = Depends(get_current_user),
                        db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.create_branch(db, repo, role, user, data.name, data.source or repo.default_branch)


@router.delete("/repos/{repo_id}/branches/{name:path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(workspace_id: UUID, repo_id: UUID, name: str, user: User = Depends(get_current_user),
                        db: AsyncSession = DB) -> Response:
    repo, role = await _repo(db, workspace_id, repo_id, user)
    await repo_service.delete_branch(db, repo, role, user, name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/repos/{repo_id}/tags")
async def tags(workspace_id: UUID, repo_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.tags(db, repo)


@router.post("/repos/{repo_id}/tags", status_code=status.HTTP_201_CREATED)
async def create_tag(workspace_id: UUID, repo_id: UUID, data: TagCreate, user: User = Depends(get_current_user),
                     db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.create_tag(db, repo, role, user, data.name, data.target or repo.default_branch, data.message or "")


# --- Access and rules ---------------------------------------------------------------------------

@router.get("/repos/{repo_id}/collaborators")
async def collaborators(workspace_id: UUID, repo_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.collaborators(db, repo)


@router.put("/repos/{repo_id}/collaborators")
async def set_collaborator(workspace_id: UUID, repo_id: UUID, data: CollaboratorSet,
                           user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.set_collaborator(db, repo, role, user, data.user_id, data.role)


@router.delete("/repos/{repo_id}/collaborators/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_collaborator(workspace_id: UUID, repo_id: UUID, user_id: UUID, user: User = Depends(get_current_user),
                              db: AsyncSession = DB) -> Response:
    repo, role = await _repo(db, workspace_id, repo_id, user)
    await repo_service.remove_collaborator(db, repo, role, user, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/repos/{repo_id}/branch-rules")
async def branch_rules(workspace_id: UUID, repo_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.branch_rules(db, repo)


@router.put("/repos/{repo_id}/branch-rules")
async def set_branch_rule(workspace_id: UUID, repo_id: UUID, data: BranchRuleSet, user: User = Depends(get_current_user),
                          db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await repo_service.set_branch_rule(db, repo, role, user, data.branch, data.required_approvals)


@router.delete("/repos/{repo_id}/branch-rules/{branch:path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch_rule(workspace_id: UUID, repo_id: UUID, branch: str, user: User = Depends(get_current_user),
                             db: AsyncSession = DB) -> Response:
    repo, role = await _repo(db, workspace_id, repo_id, user)
    await repo_service.delete_branch_rule(db, repo, role, user, branch)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Issues -----------------------------------------------------------------------------------

@router.get("/repos/{repo_id}/issues")
async def list_issues(workspace_id: UUID, repo_id: UUID, state: str = Query("open", pattern="^(open|closed|all)$"),
                      label: str | None = Query(None, max_length=40), assignee_id: UUID | None = None,
                      q: str | None = Query(None, max_length=100), page: int = Query(1, ge=1, le=10000),
                      user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await issue_service.list_issues(db, repo, state=state, label=label, assignee_id=assignee_id, q=q, page=page)


@router.post("/repos/{repo_id}/issues", status_code=status.HTTP_201_CREATED)
async def create_issue(workspace_id: UUID, repo_id: UUID, data: IssueCreate, user: User = Depends(get_current_user),
                       db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    issue = await issue_service.create_issue(db, repo, role, user, **data.model_dump())
    return (await issue_service._serialize_many(db, [issue]))[0]


@router.post("/repos/{repo_id}/issues/from-action-item")
async def issue_from_action_item(workspace_id: UUID, repo_id: UUID, data: ActionItemIssue, response: Response,
                                 user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    issue, created = await issue_service.from_action_item(db, repo, role, user, data.action_item_id)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return (await issue_service._serialize_many(db, [issue]))[0]


@router.get("/repos/{repo_id}/issues/{number}")
async def get_issue(workspace_id: UUID, repo_id: UUID, number: int, user: User = Depends(get_current_user),
                    db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    issue = await issue_service.get_issue(db, repo, number)
    data = (await issue_service._serialize_many(db, [issue]))[0]
    data["comments"] = await issue_service.list_comments(db, issue)
    return data


@router.patch("/repos/{repo_id}/issues/{number}")
async def update_issue(workspace_id: UUID, repo_id: UUID, number: int, data: IssueUpdate,
                       user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    issue = await issue_service.update_issue(db, repo, role, user, number, data.model_dump(exclude_unset=True))
    return (await issue_service._serialize_many(db, [issue]))[0]


@router.post("/repos/{repo_id}/issues/{number}/comments", status_code=status.HTTP_201_CREATED)
async def comment_issue(workspace_id: UUID, repo_id: UUID, number: int, data: CommentCreate,
                        user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await issue_service.add_comment(db, repo, role, user, number, data.body)


@router.put("/repos/{repo_id}/issues/{number}/task")
async def link_task(workspace_id: UUID, repo_id: UUID, number: int, data: TaskLink, user: User = Depends(get_current_user),
                    db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    issue = await issue_service.link_task(db, repo, role, user, number, data.task_id)
    return (await issue_service._serialize_many(db, [issue]))[0]


@router.delete("/repos/{repo_id}/issues/{number}/task")
async def unlink_task(workspace_id: UUID, repo_id: UUID, number: int, user: User = Depends(get_current_user),
                      db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    issue = await issue_service.unlink_task(db, repo, role, user, number)
    return (await issue_service._serialize_many(db, [issue]))[0]


# --- Pull requests ------------------------------------------------------------------------------

@router.get("/repos/{repo_id}/pulls")
async def list_pulls(workspace_id: UUID, repo_id: UUID, state: str = Query("open", pattern="^(open|closed|merged|all)$"),
                     page: int = Query(1, ge=1, le=10000), user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await pr_service.list_prs(db, repo, state=state, page=page)


@router.post("/repos/{repo_id}/pulls", status_code=status.HTTP_201_CREATED)
async def create_pull(workspace_id: UUID, repo_id: UUID, data: PullRequestCreate, user: User = Depends(get_current_user),
                      db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    pr = await pr_service.create_pr(db, repo, role, user, title=data.title, body=data.body, source=data.source_branch,
                                    target=data.target_branch or repo.default_branch, draft=data.draft,
                                    reviewer_ids=data.reviewer_ids)
    return await pr_service.detail(db, repo, role, pr)


@router.get("/repos/{repo_id}/pulls/{number}")
async def get_pull(workspace_id: UUID, repo_id: UUID, number: int, user: User = Depends(get_current_user),
                   db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await pr_service.detail(db, repo, role, await pr_service.get_pr(db, repo, number))


@router.patch("/repos/{repo_id}/pulls/{number}")
async def update_pull(workspace_id: UUID, repo_id: UUID, number: int, data: PullRequestUpdate,
                      user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    pr = await pr_service.update_pr(db, repo, role, user, number, data.model_dump(exclude_unset=True))
    return await pr_service.detail(db, repo, role, pr)


@router.get("/repos/{repo_id}/pulls/{number}/files")
async def pull_files(workspace_id: UUID, repo_id: UUID, number: int, user: User = Depends(get_current_user),
                     db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await pr_service.files(db, repo, await pr_service.get_pr(db, repo, number))


@router.get("/repos/{repo_id}/pulls/{number}/commits")
async def pull_commits(workspace_id: UUID, repo_id: UUID, number: int, user: User = Depends(get_current_user),
                       db: AsyncSession = DB):
    repo, _ = await _repo(db, workspace_id, repo_id, user)
    return await pr_service.commits(db, repo, await pr_service.get_pr(db, repo, number))


@router.post("/repos/{repo_id}/pulls/{number}/comments", status_code=status.HTTP_201_CREATED)
async def comment_pull(workspace_id: UUID, repo_id: UUID, number: int, data: CommentCreate,
                       user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await pr_service.comment(db, repo, role, user, number, body=data.body, path=data.path, line=data.line,
                                    side=data.side)


@router.post("/repos/{repo_id}/pulls/{number}/reviews", status_code=status.HTTP_201_CREATED)
async def review_pull(workspace_id: UUID, repo_id: UUID, number: int, data: ReviewCreate,
                      user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await pr_service.review(db, repo, role, user, number, state=data.state, body=data.body,
                                   comments=[c.model_dump() for c in data.comments])


@router.post("/repos/{repo_id}/pulls/{number}/merge")
async def merge_pull(workspace_id: UUID, repo_id: UUID, number: int, data: MergeRequest,
                     user: User = Depends(get_current_user), db: AsyncSession = DB):
    repo, role = await _repo(db, workspace_id, repo_id, user)
    return await pr_service.merge(db, repo, role, user, number, method=data.method, message=data.message,
                                  delete_branch=data.delete_branch, expected_head=data.expected_head)


# --- Personal access tokens for git over HTTPS ----------------------------------------------------

@token_router.get("")
async def list_tokens(user: User = Depends(get_current_user), db: AsyncSession = DB):
    return await repo_service.list_tokens(db, user)


@token_router.post("", status_code=status.HTTP_201_CREATED)
async def create_token(data: TokenCreate, user: User = Depends(get_current_user), db: AsyncSession = DB):
    check_identity_limit("git-token", str(user.id), 20, 3600)
    return await repo_service.create_token(db, user, data.name, data.expires_in_days)


@token_router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = DB) -> Response:
    await repo_service.revoke_token(db, user, token_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
