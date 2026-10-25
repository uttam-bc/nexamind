"""Pull requests: real branches compared and merged with Git (merge-tree, commit-tree, CAS ref
update), reviews tied to the commit they reviewed, inline comments, merge rules and notifications."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CodeRepo, User
from app.models.repository import PullRequest, PullRequestReview, RepoComment
from app.services import git_service as git
from app.services import issue_service, repo_service
from app.services.auth_service import AuthError
from app.services.notification_service import iso_utc, notify, notify_many

STATES = ("open", "closed", "merged")
REVIEW_STATES = ("approved", "changes_requested", "commented")
MERGE_METHODS = ("merge", "squash")


def _link(repo: CodeRepo, number: int) -> dict:
    return {"tab": "code", "workspace_id": str(repo.workspace_id), "repo_id": str(repo.id), "pull": number}


def serialize(pr: PullRequest, people: dict, **extra) -> dict:
    return {
        "id": str(pr.id), "number": pr.number, "title": pr.title, "body": pr.body, "state": pr.state, "draft": pr.draft,
        "source_branch": pr.source_branch, "target_branch": pr.target_branch,
        "author": people.get(str(pr.author_id)) if pr.author_id else None,
        "reviewers": [people[r] for r in pr.reviewer_ids or [] if r in people],
        "merged_by": people.get(str(pr.merged_by)) if pr.merged_by else None,
        "merge_commit_sha": pr.merge_commit_sha, "merge_method": pr.merge_method, "head_sha": pr.head_sha,
        "created_at": iso_utc(pr.created_at), "updated_at": iso_utc(pr.updated_at),
        "merged_at": iso_utc(pr.merged_at), "closed_at": iso_utc(pr.closed_at), **extra,
    }


async def _people_for(db: AsyncSession, prs: list[PullRequest]) -> dict:
    ids = set()
    for pr in prs:
        ids |= {pr.author_id, pr.merged_by}
        ids |= {UUID(r) for r in pr.reviewer_ids or []}
    return await repo_service.names(db, ids)


async def get_pr(db: AsyncSession, repo: CodeRepo, number: int) -> PullRequest:
    pr = (await db.execute(select(PullRequest).where(PullRequest.repo_id == repo.id, PullRequest.number == number))).scalar_one_or_none()
    if pr is None:
        raise AuthError(f"Pull request #{number} not found", 404)
    return pr


async def list_prs(db: AsyncSession, repo: CodeRepo, *, state: str | None = "open", page: int = 1, per_page: int = 30) -> dict:
    query = select(PullRequest).where(PullRequest.repo_id == repo.id)
    if state in STATES:
        query = query.where(PullRequest.state == state)
    page = max(1, page)
    rows = (await db.execute(query.order_by(PullRequest.number.desc()).offset((page - 1) * per_page).limit(per_page + 1))).scalars().all()
    counts = dict((await db.execute(select(PullRequest.state, func.count()).where(PullRequest.repo_id == repo.id)
                                    .group_by(PullRequest.state))).all())
    people = await _people_for(db, rows)
    return {"pull_requests": [serialize(p, people) for p in rows[:per_page]], "has_more": len(rows) > per_page,
            "counts": {s: counts.get(s, 0) for s in STATES}}


async def _reviewer_ids(db: AsyncSession, repo: CodeRepo, ids, author_id: UUID) -> list[str]:
    out = []
    for raw in ids or []:
        uid = UUID(str(raw))
        if uid == author_id:
            continue
        if not repo_service.at_least(await repo_service.role_for(db, repo, uid), "reviewer"):
            raise AuthError("Reviewers need at least reviewer access to this repository", 400)
        if str(uid) not in out:
            out.append(str(uid))
    if len(out) > 15:
        raise AuthError("At most 15 reviewers", 400)
    return out


async def create_pr(db: AsyncSession, repo: CodeRepo, role: str, user: User, *, title: str, body: str | None,
                    source: str, target: str, draft: bool = False, reviewer_ids=None) -> PullRequest:
    repo_service.require(role, "write", "open pull requests")
    path = await repo_service.storage(db, repo)
    source, target = git.validate_ref_name(source), git.validate_ref_name(target or repo.default_branch)
    if source == target:
        raise AuthError("Choose two different branches", 400)
    head, base = await git.branch_sha(path, source), await git.branch_sha(path, target)
    if not head:
        raise AuthError(f"Branch '{source}' doesn't exist", 404)
    if not base:
        raise AuthError(f"Branch '{target}' doesn't exist", 404)
    ahead, _ = await git.ahead_behind(path, base, head)
    if ahead == 0:
        raise AuthError(f"'{source}' has no commits that aren't already in '{target}'", 400)
    existing = (await db.execute(select(PullRequest).where(
        PullRequest.repo_id == repo.id, PullRequest.state == "open", PullRequest.source_branch == source,
        PullRequest.target_branch == target))).scalar_one_or_none()
    if existing is not None:
        raise AuthError(f"Pull request #{existing.number} already proposes these changes", 409)
    title = (title or "").strip()
    if not title or len(title) > 255:
        raise AuthError("A title of 1 to 255 characters is required", 400)
    reviewers = await _reviewer_ids(db, repo, reviewer_ids, user.id)
    pr = PullRequest(repo_id=repo.id, number=await issue_service.next_number(db, repo), title=title,
                     body=(body or "").strip() or None, author_id=user.id, source_branch=source, target_branch=target,
                     draft=bool(draft), reviewer_ids=reviewers)
    db.add(pr)
    await db.flush()
    await repo_service.record(db, repo, user.id, "pr.opened", f"{user.name} opened pull request #{pr.number}: {title}",
                              number=pr.number)
    await _notify_reviewers(db, repo, pr, user, reviewers)
    return pr


async def _notify_reviewers(db: AsyncSession, repo: CodeRepo, pr: PullRequest, actor: User, ids) -> None:
    await notify_many(db, [UUID(i) for i in ids], kind="pr_review_requested", category="repos",
                      title=f"{actor.name} asked for your review on #{pr.number} in {repo.name}", body=pr.title,
                      dedupe_key=f"pr-review-request:{pr.id}", workspace_id=repo.workspace_id, actor_id=actor.id,
                      link=_link(repo, pr.number))


async def update_pr(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int, changes: dict) -> PullRequest:
    pr = await get_pr(db, repo, number)
    if not (pr.author_id == user.id or repo_service.at_least(role, "maintainer")):
        raise AuthError("Only the author or maintainers can edit this pull request", 403)
    if changes.get("title") is not None:
        title = changes["title"].strip()
        if not title or len(title) > 255:
            raise AuthError("A title of 1 to 255 characters is required", 400)
        pr.title = title
    if changes.get("body") is not None:
        pr.body = changes["body"].strip() or None
    if changes.get("draft") is not None:
        pr.draft = bool(changes["draft"])
    if changes.get("reviewer_ids") is not None:
        reviewers = await _reviewer_ids(db, repo, changes["reviewer_ids"], pr.author_id)
        added = [r for r in reviewers if r not in (pr.reviewer_ids or [])]
        pr.reviewer_ids = reviewers
        await _notify_reviewers(db, repo, pr, user, added)
    state = changes.get("state")
    if state in ("open", "closed") and state != pr.state:
        if pr.state == "merged":
            raise AuthError("A merged pull request can't be closed or reopened", 400)
        path = await repo_service.storage(db, repo)
        if state == "closed":
            pr.head_sha = await git.branch_sha(path, pr.source_branch)
            target = await git.branch_sha(path, pr.target_branch)
            pr.base_sha = await git.merge_base(path, target, pr.head_sha) if (target and pr.head_sha) else None
            pr.closed_at = repo_service.now()
        else:
            if not await git.branch_sha(path, pr.source_branch):
                raise AuthError(f"Branch '{pr.source_branch}' no longer exists", 400)
            pr.closed_at = None
        pr.state = state
        verb = "closed" if state == "closed" else "reopened"
        await repo_service.record(db, repo, user.id, f"pr.{verb}", f"{user.name} {verb} pull request #{pr.number}", number=pr.number)
    await db.flush()
    return pr


async def _heads(db: AsyncSession, repo: CodeRepo, pr: PullRequest) -> tuple[str | None, str | None, str | None]:
    """(base for the diff, head, current target tip)."""
    path = git.repo_path(repo.storage_key)
    if pr.state == "open":
        head = await git.branch_sha(path, pr.source_branch)
        target = await git.branch_sha(path, pr.target_branch)
        base = await git.merge_base(path, target, head) if head and target else None
        return base, head, target
    return pr.base_sha, pr.head_sha, None


def _latest_reviews(reviews: list[PullRequestReview]) -> dict[UUID, PullRequestReview]:
    latest: dict[UUID, PullRequestReview] = {}
    for r in sorted(reviews, key=lambda r: r.created_at):
        if r.state != "commented" and r.reviewer_id:
            latest[r.reviewer_id] = r
    return latest


async def merge_status(db: AsyncSession, repo: CodeRepo, role: str, pr: PullRequest) -> dict:
    path = git.repo_path(repo.storage_key)  # callers have opened the repository (storage) already
    base, head, target = await _heads(db, repo, pr)
    reviews = (await db.execute(select(PullRequestReview).where(PullRequestReview.pull_request_id == pr.id))).scalars().all()
    latest = _latest_reviews(reviews)
    approvals = [r for r in latest.values() if r.state == "approved" and r.commit_sha == head]
    stale = [r for r in latest.values() if r.state == "approved" and r.commit_sha != head]
    changes_requested = [r for r in latest.values() if r.state == "changes_requested"]
    rules = await repo_service.protected_branches(db, repo)
    required = rules[pr.target_branch].required_approvals if pr.target_branch in rules else 0
    status = {"head_sha": head, "base_sha": base, "target_sha": target, "approvals": len(approvals),
              "stale_approvals": len(stale), "changes_requested": len(changes_requested), "required_approvals": required,
              "protected": pr.target_branch in rules, "ahead": 0, "behind": 0, "conflicts": [], "mergeable": False,
              "blockers": []}
    if pr.state != "open":
        return status
    blockers = status["blockers"]
    if head is None:
        blockers.append(f"The branch '{pr.source_branch}' no longer exists")
    if target is None:
        blockers.append(f"The branch '{pr.target_branch}' no longer exists")
    if head and target:
        status["ahead"], status["behind"] = await git.ahead_behind(path, target, head)
        _, conflicts = await git.merge_tree(path, target, head)
        status["conflicts"] = conflicts
        if conflicts:
            blockers.append("There are merge conflicts: resolve them on the branch (merge the target into it) and push")
        if status["ahead"] == 0:
            blockers.append("There is nothing to merge")
    if pr.draft:
        blockers.append("This is a draft")
    if changes_requested:
        blockers.append("Changes were requested")
    if len(approvals) < required:
        blockers.append(f"{required} approval{'s' if required != 1 else ''} required on the latest commit ({len(approvals)} so far)")
    if not repo_service.at_least(role, "write"):
        blockers.append("You need write access to merge")
    status["mergeable"] = not blockers
    return status


async def detail(db: AsyncSession, repo: CodeRepo, role: str, pr: PullRequest) -> dict:
    await repo_service.storage(db, repo)
    people = await _people_for(db, [pr])
    reviews = (await db.execute(select(PullRequestReview).where(PullRequestReview.pull_request_id == pr.id)
                                .order_by(PullRequestReview.created_at))).scalars().all()
    comments = (await db.execute(select(RepoComment).where(RepoComment.pull_request_id == pr.id)
                                 .order_by(RepoComment.created_at))).scalars().all()
    people.update(await repo_service.names(db, [r.reviewer_id for r in reviews] + [c.author_id for c in comments]))
    return serialize(
        pr, people, status=await merge_status(db, repo, role, pr),
        reviews=[{"id": str(r.id), "state": r.state, "body": r.body, "commit_sha": r.commit_sha,
                  "reviewer": people.get(str(r.reviewer_id)), "created_at": iso_utc(r.created_at)} for r in reviews],
        comments=[issue_service.serialize_comment(c, people) for c in comments],
    )


async def files(db: AsyncSession, repo: CodeRepo, pr: PullRequest) -> dict:
    path = await repo_service.storage(db, repo)
    base, head, _ = await _heads(db, repo, pr)
    if not head:
        return {"files": [], "additions": 0, "deletions": 0, "truncated": False, "unavailable": True}
    return repo_service.serialize_diff(await git.diff(path, base or git.EMPTY_TREE, head))


async def commits(db: AsyncSession, repo: CodeRepo, pr: PullRequest) -> list[dict]:
    path = await repo_service.storage(db, repo)
    base, head, _ = await _heads(db, repo, pr)
    if not head:
        return []
    items = await git.log(path, head, exclude=base, limit=200)
    people = await repo_service.commit_people(db, items)
    return [repo_service.serialize_commit(c, people) for c in items]


async def _participants(db: AsyncSession, pr: PullRequest) -> set[UUID]:
    ids = {pr.author_id} | {UUID(r) for r in pr.reviewer_ids or []}
    ids |= set((await db.execute(select(RepoComment.author_id).where(RepoComment.pull_request_id == pr.id))).scalars())
    return {i for i in ids if i}


async def comment(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int, *, body: str,
                  path: str | None = None, line: int | None = None, side: str | None = None) -> dict:
    repo_service.require(role, "read", "comment")
    pr = await get_pr(db, repo, number)
    c = await _new_comment(db, repo, pr, user, body, path, line, side)
    await notify_many(db, await _participants(db, pr), kind="pr_comment", category="repos",
                      title=f"{user.name} commented on #{pr.number} in {repo.name}", body=c.body[:300],
                      dedupe_key=f"pr-comment:{c.id}", workspace_id=repo.workspace_id, actor_id=user.id,
                      link=_link(repo, pr.number))
    return issue_service.serialize_comment(c, await repo_service.names(db, [user.id]))


async def _new_comment(db: AsyncSession, repo: CodeRepo, pr: PullRequest, user: User, body: str, path: str | None,
                       line: int | None, side: str | None, review_id: UUID | None = None) -> RepoComment:
    body = issue_service.clean_body(body)
    commit_sha = None
    if path:
        path = git.validate_path(path)
        if line is None or not 1 <= int(line) <= 10_000_000:
            raise AuthError("An inline comment needs a line number", 400)
        side = side if side in ("new", "old") else "new"
        _, head, _ = await _heads(db, repo, pr)
        commit_sha = head
    else:
        line, side = None, None
    c = RepoComment(repo_id=repo.id, pull_request_id=pr.id, author_id=user.id, body=body, path=path,
                    line=int(line) if line else None, side=side, commit_sha=commit_sha, review_id=review_id)
    db.add(c)
    await db.flush()
    return c


async def review(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int, *, state: str,
                 body: str | None, comments: list[dict] | None = None) -> dict:
    pr = await get_pr(db, repo, number)
    if state not in REVIEW_STATES:
        raise AuthError("A review approves, requests changes or comments", 400)
    if state != "commented":
        repo_service.require(role, "reviewer", "approve or request changes")
        if pr.author_id == user.id:
            raise AuthError("You can't approve or request changes on your own pull request", 400)
    else:
        repo_service.require(role, "read", "review")
    if pr.state != "open":
        raise AuthError("This pull request is no longer open", 400)
    if state == "changes_requested" and not (body or "").strip() and not comments:
        raise AuthError("Say what should change", 400)
    if state == "commented" and not (body or "").strip() and not comments:
        raise AuthError("Write a comment", 400)
    _, head, _ = await _heads(db, repo, pr)
    if head is None:
        raise AuthError(f"The branch '{pr.source_branch}' no longer exists", 400)
    r = PullRequestReview(pull_request_id=pr.id, reviewer_id=user.id, state=state, body=(body or "").strip() or None,
                          commit_sha=head)
    db.add(r)
    await db.flush()
    for c in comments or []:
        await _new_comment(db, repo, pr, user, c.get("body") or "", c.get("path"), c.get("line"), c.get("side"), r.id)
    words = {"approved": "approved", "changes_requested": "requested changes on", "commented": "reviewed"}[state]
    await repo_service.record(db, repo, user.id, f"pr.review.{state}", f"{user.name} {words} pull request #{pr.number}",
                              number=pr.number)
    await notify(db, pr.author_id, kind="pr_reviewed", category="repos",
                 title=f"{user.name} {words} #{pr.number} in {repo.name}", body=(r.body or pr.title)[:300],
                 dedupe_key=f"pr-review:{r.id}", workspace_id=repo.workspace_id, actor_id=user.id, link=_link(repo, pr.number))
    return {"id": str(r.id), "state": r.state, "commit_sha": head}


async def merge(db: AsyncSession, repo: CodeRepo, role: str, user: User, number: int, *, method: str = "merge",
                message: str | None = None, delete_branch: bool = False, expected_head: str | None = None) -> dict:
    repo_service.require(role, "write", "merge pull requests")
    if method not in MERGE_METHODS:
        raise AuthError("Merge method must be 'merge' or 'squash'", 400)
    pr = await get_pr(db, repo, number)
    if pr.state != "open":
        raise AuthError("This pull request is not open", 400)
    path = await repo_service.storage(db, repo)
    async with repo_service._lock(repo.id):
        status = await merge_status(db, repo, role, pr)
        if not status["mergeable"]:
            raise AuthError("Can't merge yet: " + "; ".join(status["blockers"]), 409)
        head, target = status["head_sha"], status["target_sha"]
        if expected_head and expected_head != head:
            raise AuthError("New commits were pushed to this pull request. Review them before merging.", 409)
        tree, conflicts = await git.merge_tree(path, target, head)
        if tree is None:
            raise AuthError("There are merge conflicts in: " + ", ".join(conflicts[:20]), 409)
        author = repo_service.author_for(user)
        if method == "squash":
            text = (message or "").strip() or f"{pr.title} (#{pr.number})\n\n{pr.body or ''}".strip()
            sha = await git.commit_tree(path, tree, [target], text, author)
        else:
            text = (message or "").strip() or f"Merge pull request #{pr.number} from {pr.source_branch}\n\n{pr.title}"
            sha = await git.commit_tree(path, tree, [target, head], text, author)
        await git.update_ref(path, f"refs/heads/{pr.target_branch}", sha, target)
    pr.state, pr.merged_by, pr.merged_at = "merged", user.id, repo_service.now()
    pr.merge_commit_sha, pr.merge_method, pr.head_sha, pr.base_sha = sha, method, head, status["base_sha"]
    await repo_service.record(db, repo, user.id, "pr.merged", f"{user.name} merged pull request #{pr.number} into {pr.target_branch}",
                              number=pr.number, sha=sha)
    await db.flush()
    await repo_service.after_ref_change(db, repo, user, [(f"refs/heads/{pr.target_branch}", target, sha)], via="merge")
    if pr.target_branch == repo.default_branch:
        for n in sorted({int(x) for x in repo_service.CLOSING.findall(f"{pr.title}\n{pr.body or ''}")})[:20]:
            await issue_service.close_by_reference(db, repo, n, user, f"pull request #{pr.number}")
    await notify_many(db, await _participants(db, pr), kind="pr_merged", category="repos",
                      title=f"{user.name} merged #{pr.number} in {repo.name}", body=pr.title,
                      dedupe_key=f"pr-merged:{pr.id}", workspace_id=repo.workspace_id, actor_id=user.id,
                      link=_link(repo, pr.number))
    deleted = False
    if delete_branch and pr.source_branch != repo.default_branch and pr.source_branch not in await repo_service.protected_branches(db, repo):
        try:
            await git.delete_ref(path, f"refs/heads/{pr.source_branch}", head)
            await repo_service.after_ref_change(db, repo, user, [(f"refs/heads/{pr.source_branch}", head, git.ZERO_SHA)], via="web")
            deleted = True
        except AuthError:
            pass  # someone pushed to it meanwhile: keep it
    await db.flush()
    return {"sha": sha, "branch_deleted": deleted}


async def detect_merged(db: AsyncSession, repo: CodeRepo, branch: str, old_sha: str, new_sha: str, actor: User | None) -> None:
    """Pull requests whose commits reached their target some other way (e.g. a push) are merged."""
    path = git.repo_path(repo.storage_key)
    prs = (await db.execute(select(PullRequest).where(
        PullRequest.repo_id == repo.id, PullRequest.state == "open", PullRequest.target_branch == branch))).scalars().all()
    for pr in prs:
        head = await git.branch_sha(path, pr.source_branch)
        if head and await git.is_ancestor(path, head, new_sha):
            pr.state, pr.merged_at, pr.merged_by = "merged", repo_service.now(), actor.id if actor else None
            pr.merge_method, pr.head_sha = "push", head
            if old_sha != git.ZERO_SHA:
                pr.base_sha = await git.merge_base(path, old_sha, head)
            await repo_service.record(db, repo, actor and actor.id, "pr.merged",
                                      f"Pull request #{pr.number} was merged by a push to {branch}", number=pr.number)
