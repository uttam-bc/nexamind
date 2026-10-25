"""Repository issues: numbered (shared counter with pull requests), labels, assignee, priority,
milestone, comments, and links to tasks and meeting action items that never duplicate."""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CodeRepo, Issue, Task, User
from app.models.meeting import MeetingActionItem
from app.models.project import IssueStatus, TaskPriority, TaskStatus
from app.models.repository import RepoComment
from app.services import repo_service
from app.services.auth_service import AuthError
from app.services.notification_service import iso_utc, notify, notify_many

PRIORITIES = ("low", "medium", "high", "urgent")
DEFAULT_LABELS = ("bug", "enhancement", "documentation", "question", "good first issue", "help wanted")


async def next_number(db: AsyncSession, repo: CodeRepo) -> int:
    """Atomically take the repository's next issue/pull request number."""
    number = (await db.execute(
        update(CodeRepo).where(CodeRepo.id == repo.id).values(next_number=CodeRepo.next_number + 1)
        .returning(CodeRepo.next_number)
    )).scalar_one() - 1
    await db.refresh(repo, ["next_number"])
    return number


def _labels(raw) -> list[str]:
    if raw is None:
        return []
    labels = []
    for label in raw:
        label = re.sub(r"\s+", " ", str(label)).strip().lower()
        if not label:
            continue
        if len(label) > 40:
            raise AuthError("Labels are at most 40 characters", 400)
        if label not in labels:
            labels.append(label)
    if len(labels) > 10:
        raise AuthError("At most 10 labels per issue", 400)
    return labels


def serialize(issue: Issue, people: dict, task: Task | None = None, comments: int | None = None) -> dict:
    return {
        "id": str(issue.id), "repo_id": str(issue.repo_id), "number": issue.number, "title": issue.title,
        "body": issue.description, "state": issue.status.value, "labels": issue.labels or [],
        "priority": issue.priority, "milestone": issue.milestone,
        "author": people.get(str(issue.created_by)) if issue.created_by else None,
        "assignee": people.get(str(issue.assignee_id)) if issue.assignee_id else None,
        "task": {"id": str(task.id), "title": task.title, "status": task.status.value} if task else None,
        "source_action_item_id": str(issue.source_action_item_id) if issue.source_action_item_id else None,
        "comment_count": comments, "created_at": iso_utc(issue.created_at), "updated_at": iso_utc(issue.updated_at),
        "closed_at": iso_utc(issue.closed_at),
    }


async def _serialize_many(db: AsyncSession, issues: list[Issue]) -> list[dict]:
    people = await repo_service.names(db, [i.created_by for i in issues] + [i.assignee_id for i in issues])
    task_ids = [i.task_id for i in issues if i.task_id]
    tasks = {t.id: t for t in (await db.execute(select(Task).where(Task.id.in_(task_ids)))).scalars()} if task_ids else {}
    counts = {}
    if issues:
        counts = dict((await db.execute(
            select(RepoComment.issue_id, func.count()).where(RepoComment.issue_id.in_([i.id for i in issues]))
            .group_by(RepoComment.issue_id)
        )).all())
    return [serialize(i, people, tasks.get(i.task_id), counts.get(i.id, 0)) for i in issues]


async def list_issues(db: AsyncSession, repo: CodeRepo, *, state: str | None = "open", label: str | None = None,
                      assignee_id: UUID | None = None, q: str | None = None, page: int = 1, per_page: int = 30) -> dict:
    query = select(Issue).where(Issue.repo_id == repo.id)
    if state in ("open", "closed"):
        query = query.where(Issue.status == IssueStatus(state))
    if assignee_id:
        query = query.where(Issue.assignee_id == assignee_id)
    if q:
        term = f"%{q.strip()[:100]}%"
        query = query.where(or_(Issue.title.ilike(term), Issue.description.ilike(term)))
    rows = (await db.execute(query.order_by(Issue.number.desc()))).scalars().all()
    if label:
        rows = [i for i in rows if label.lower() in (i.labels or [])]
    page = max(1, page)
    window = rows[(page - 1) * per_page: page * per_page + 1]
    counts = dict((await db.execute(
        select(Issue.status, func.count()).where(Issue.repo_id == repo.id).group_by(Issue.status))).all())
    used = sorted({lbl for i in rows for lbl in (i.labels or [])} | set(DEFAULT_LABELS))
    return {
        "issues": await _serialize_many(db, window[:per_page]), "has_more": len(window) > per_page,
        "open_count": counts.get(IssueStatus.OPEN, 0), "closed_count": counts.get(IssueStatus.CLOSED, 0),
        "labels": used,
    }


async def get_issue(db: AsyncSession, repo: CodeRepo, number: int) -> Issue:
    issue = (await db.execute(select(Issue).where(Issue.repo_id == repo.id, Issue.number == number))).scalar_one_or_none()
    if issue is None:
        raise AuthError(f"Issue #{number} not found", 404)
    return issue


async def _check_assignee(db: AsyncSession, repo: CodeRepo, user_id: UUID | None) -> None:
    if user_id is None:
        return
    if await repo_service.role_for(db, repo, user_id) is None:
        raise AuthError("The assignee needs access to this repository", 400)


def _link(repo: CodeRepo, kind: str, number: int) -> dict:
    return {"tab": "code", "workspace_id": str(repo.workspace_id), "repo_id": str(repo.id), kind: number}


async def create_issue(db: AsyncSession, repo: CodeRepo, role: str, user: User, *, title: str, body: str | None = None,
                       labels=None, assignee_id: UUID | None = None, priority: str = "medium",
                       milestone: str | None = None, source_action_item_id: UUID | None = None) -> Issue:
    repo_service.require(role, "read", "open issues")
    title = (title or "").strip()
    if not title or len(title) > 255:
        raise AuthError("An issue title of 1 to 255 characters is required", 400)
    if priority not in PRIORITIES:
        raise AuthError("Priority must be low, medium, high or urgent", 400)
    triage = repo_service.at_least(role, "write")
    labels = _labels(labels) if triage else []
    if not triage:
        assignee_id, milestone = None, None
    await _check_assignee(db, repo, assignee_id)
    issue = Issue(
        repo_id=repo.id, number=await next_number(db, repo), title=title, description=(body or "").strip() or None,
        status=IssueStatus.OPEN, labels=labels, priority=priority if triage else "medium",
        milestone=(milestone or "").strip()[:120] or None, assignee_id=assignee_id, created_by=user.id,
        source_action_item_id=source_action_item_id,
    )
    db.add(issue)
    await db.flush()
    await repo_service.record(db, repo, user.id, "issue.opened", f"{user.name} opened issue #{issue.number}: {title}",
                              number=issue.number)
    if assignee_id:
        await _notify_assigned(db, repo, issue, user)
    return issue


async def _notify_assigned(db: AsyncSession, repo: CodeRepo, issue: Issue, actor: User) -> None:
    await notify(db, issue.assignee_id, kind="issue_assigned", category="repos",
                 title=f"{actor.name} assigned you #{issue.number} in {repo.name}", body=issue.title,
                 dedupe_key=f"issue-assigned:{issue.id}:{issue.assignee_id}", workspace_id=repo.workspace_id,
                 actor_id=actor.id, link=_link(repo, "issue", issue.number))


async def update_issue(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int, changes: dict) -> Issue:
    issue = await get_issue(db, repo, number)
    author = issue.created_by == user.id
    triage = repo_service.at_least(role, "write")
    if ("title" in changes or "body" in changes) and not (author or triage):
        raise AuthError("Only the author or people with write access can edit this issue", 403)
    triage_fields = {"labels", "assignee_id", "priority", "milestone"} & {k for k, v in changes.items() if v is not None or k == "assignee_id"}
    if triage_fields and not triage:
        raise AuthError("You need write access to change labels, assignees, priority or milestones", 403)
    if changes.get("title") is not None:
        title = changes["title"].strip()
        if not title or len(title) > 255:
            raise AuthError("An issue title of 1 to 255 characters is required", 400)
        issue.title = title
    if "body" in changes and changes["body"] is not None:
        issue.description = changes["body"].strip() or None
    if changes.get("labels") is not None:
        issue.labels = _labels(changes["labels"])
    if changes.get("priority") is not None:
        if changes["priority"] not in PRIORITIES:
            raise AuthError("Priority must be low, medium, high or urgent", 400)
        issue.priority = changes["priority"]
    if "milestone" in changes and changes["milestone"] is not None:
        issue.milestone = changes["milestone"].strip()[:120] or None
    if "assignee_id" in changes and changes["assignee_id"] != issue.assignee_id:
        await _check_assignee(db, repo, changes["assignee_id"])
        issue.assignee_id = changes["assignee_id"]
        if issue.assignee_id:
            await _notify_assigned(db, repo, issue, user)
    if changes.get("state") in ("open", "closed"):
        if not (author or triage):
            raise AuthError("Only the author or people with write access can close or reopen this issue", 403)
        await set_state(db, repo, issue, changes["state"], user)
    await db.flush()
    return issue


async def set_state(db: AsyncSession, repo: CodeRepo, issue: Issue, state: str, actor: User | None, via: str | None = None,
                    sync_task: bool = True) -> bool:
    new = IssueStatus(state)
    if issue.status == new:
        return False
    issue.status = new
    issue.closed_at = repo_service.now() if new == IssueStatus.CLOSED else None
    issue.closed_by = actor.id if (actor and new == IssueStatus.CLOSED) else None
    name = actor.name if actor else "Someone"
    verb = "closed" if new == IssueStatus.CLOSED else "reopened"
    await repo_service.record(db, repo, actor and actor.id, f"issue.{verb}",
                              f"{name} {verb} issue #{issue.number}{f' via {via}' if via else ''}", number=issue.number)
    if sync_task and issue.task_id:
        task = await db.get(Task, issue.task_id)
        if task is not None:
            target = TaskStatus.DONE if new == IssueStatus.CLOSED else TaskStatus.TODO
            if (new == IssueStatus.CLOSED) != (task.status == TaskStatus.DONE):
                task.status = target
    if new == IssueStatus.CLOSED and issue.created_by:
        await notify(db, issue.created_by, kind="issue_closed", category="repos",
                     title=f"#{issue.number} in {repo.name} was closed", body=issue.title,
                     dedupe_key=f"issue-closed:{issue.id}:{issue.closed_at.isoformat()}", workspace_id=repo.workspace_id,
                     actor_id=actor.id if actor else None, link=_link(repo, "issue", issue.number))
    return True


async def close_by_reference(db: AsyncSession, repo: CodeRepo, number: int, actor: User | None, via: str) -> None:
    """'Fixes #12' in a commit or merged pull request closes issue 12 (not a pull request number)."""
    issue = (await db.execute(select(Issue).where(Issue.repo_id == repo.id, Issue.number == number))).scalar_one_or_none()
    if issue is not None and issue.status == IssueStatus.OPEN:
        await set_state(db, repo, issue, "closed", actor, via)


async def sync_from_task(db: AsyncSession, task: Task, actor: User | None) -> None:
    """A linked task moved to/from Done: close or reopen its issue."""
    issue = (await db.execute(select(Issue).where(Issue.task_id == task.id))).scalar_one_or_none()
    if issue is None:
        return
    want = "closed" if task.status == TaskStatus.DONE else "open"
    if issue.status.value != want:
        repo = await db.get(CodeRepo, issue.repo_id)
        await set_state(db, repo, issue, want, actor, "its task", sync_task=False)


def serialize_comment(c: RepoComment, people: dict) -> dict:
    return {
        "id": str(c.id), "body": c.body, "author": people.get(str(c.author_id)) if c.author_id else None,
        "path": c.path, "line": c.line, "side": c.side, "commit_sha": c.commit_sha,
        "review_id": str(c.review_id) if c.review_id else None,
        "created_at": iso_utc(c.created_at), "edited_at": iso_utc(c.edited_at),
    }


async def list_comments(db: AsyncSession, issue: Issue) -> list[dict]:
    rows = (await db.execute(select(RepoComment).where(RepoComment.issue_id == issue.id)
                             .order_by(RepoComment.created_at))).scalars().all()
    people = await repo_service.names(db, [c.author_id for c in rows])
    return [serialize_comment(c, people) for c in rows]


def clean_body(body: str) -> str:
    body = (body or "").strip()
    if not body or len(body) > 20000:
        raise AuthError("A comment of 1 to 20,000 characters is required", 400)
    return body


async def add_comment(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int, body: str) -> dict:
    repo_service.require(role, "read", "comment")
    issue = await get_issue(db, repo, number)
    comment = RepoComment(repo_id=repo.id, issue_id=issue.id, author_id=user.id, body=clean_body(body))
    db.add(comment)
    await db.flush()
    await notify_many(db, [issue.created_by, issue.assignee_id], kind="issue_comment", category="repos",
                      title=f"{user.name} commented on #{issue.number} in {repo.name}", body=comment.body[:300],
                      dedupe_key=f"issue-comment:{comment.id}", workspace_id=repo.workspace_id, actor_id=user.id,
                      link=_link(repo, "issue", issue.number))
    people = await repo_service.names(db, [user.id])
    return serialize_comment(comment, people)


async def link_task(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int,
                    task_id: UUID | None = None) -> Issue:
    """Link an existing task, or create one from the issue. Idempotent: an issue has at most one task."""
    repo_service.require(role, "write", "link tasks")
    issue = await get_issue(db, repo, number)
    if issue.task_id and await db.get(Task, issue.task_id):
        if task_id is None or task_id == issue.task_id:
            return issue
        raise AuthError("This issue is already linked to a task. Unlink it first.", 409)
    if task_id:
        task = await db.get(Task, task_id)
        if task is None or task.workspace_id != repo.workspace_id:
            raise AuthError("Task not found in this workspace", 404)
        other = (await db.execute(select(Issue).where(Issue.task_id == task.id))).scalar_one_or_none()
        if other is not None:
            raise AuthError("That task is already linked to another issue", 409)
    else:
        priority = issue.priority if issue.priority in {p.value for p in TaskPriority} else "medium"
        task = Task(
            workspace_id=repo.workspace_id, title=f"{repo.name}#{issue.number}: {issue.title}"[:255],
            description=issue.description, priority=TaskPriority(priority), assignee_id=issue.assignee_id,
            created_by=user.id, status=TaskStatus.DONE if issue.status == IssueStatus.CLOSED else TaskStatus.TODO,
        )
        db.add(task)
        await db.flush()
    issue.task_id = task.id
    await repo_service.record(db, repo, user.id, "issue.task_linked", f"{user.name} linked issue #{issue.number} to a task",
                              number=issue.number, task_id=str(task.id))
    await db.flush()
    return issue


async def unlink_task(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int) -> Issue:
    repo_service.require(role, "write", "link tasks")
    issue = await get_issue(db, repo, number)
    issue.task_id = None
    await db.flush()
    return issue


async def from_action_item(db: AsyncSession, repo: CodeRepo, role: str, user: User, action_item_id: UUID) -> tuple[Issue, bool]:
    """Turn a meeting action item into an issue once; asking again returns the same issue."""
    from app.services import meeting_service

    repo_service.require(role, "write", "create issues from meeting action items")
    item = await db.get(MeetingActionItem, action_item_id)
    if item is None or item.workspace_id != repo.workspace_id:
        raise AuthError("Action item not found", 404)
    if item.meeting_id is not None:
        await meeting_service.get_meeting(db, repo.workspace_id, item.meeting_id, user.id)  # 404 when hidden from the user
    existing = (await db.execute(select(Issue).where(Issue.source_action_item_id == item.id))).scalar_one_or_none()
    if existing is not None:
        if existing.repo_id != repo.id:
            other = await db.get(CodeRepo, existing.repo_id)
            raise AuthError(f"This action item is already issue #{existing.number} in {other.name if other else 'another repository'}", 409)
        return existing, False
    body = item.text
    if item.evidence:
        body += f"\n\n> {item.evidence}"
    if item.due_date:
        body += f"\n\nDue: {item.due_date}"
    issue = await create_issue(db, repo, role, user, title=item.text[:255], body=body, labels=["meeting"],
                               assignee_id=item.assignee_id if item.assignee_id and await repo_service.role_for(db, repo, item.assignee_id) else None,
                               source_action_item_id=item.id)
    if item.task_id and await db.get(Task, item.task_id):
        other = (await db.execute(select(Issue).where(Issue.task_id == item.task_id))).scalar_one_or_none()
        if other is None:
            issue.task_id = item.task_id
            await db.flush()
    return issue, True
