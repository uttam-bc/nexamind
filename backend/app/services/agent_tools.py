"""Workspace actions the AI copilot can take. Each tool runs with the caller's own permissions."""

import math
import json
from pathlib import Path
from datetime import date as date_type
from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Channel,
    CodeRepo,
    Document,
    FileRecord,
    FinanceTransaction,
    ReportType,
    SessionRecord,
    Task,
    User,
    WorkspaceType,
)
from app.models.finance import TransactionType
from app.models.project import TaskPriority, TaskStatus
from app.schemas.channel import ChannelCreate, MessageCreate
from app.schemas.document import DocumentCreate
from app.schemas.finance import MAX_AMOUNT, TransactionCreate
from app.schemas.project import CodeRepoCreate, CommitCreate, IssueCreate, TaskCreate, TaskUpdate
from app.schemas.report import ReportGenerateRequest
from app.services.auth_service import escape_like
from app.services.channel_service import create_channel, list_channels, post_message
from app.services.document_service import create_document
from app.services.finance_service import calculate_runway, create_transaction
from app.services.memory_engine import extract_text_from_document, schedule_document_ingestion
from app.services.project_service import create_commit, create_issue, create_repo, create_task, update_task
from app.services.report_service import generate_report
from app.services.websocket_manager import ws_manager
from app.services.workspace_service import list_user_workspaces


class ToolError(Exception):
    """A tool could not run; the message is safe to show to the user and the model."""


def _uuid(value: str, label: str) -> UUID:
    try:
        return UUID(str(value))
    except ValueError as exc:
        raise ToolError(f"'{value}' is not a valid {label} id") from exc


def _like(text: str) -> str:
    return f"%{escape_like(text.strip().lower())}%"


# -------------------------------------------------------------------------------------------
# Workspaces & documents
# -------------------------------------------------------------------------------------------

async def switch_workspace_tool(db: AsyncSession, user: User, target_query: str) -> dict:
    """Find one of the user's workspaces by name, or 'personal' / 'team'."""
    workspaces = await list_user_workspaces(db, user.id)
    query = target_query.lower().strip()
    for filler in ("the ", "my ", "workspace", "group "):
        query = query.replace(filler, " ")
    query = " ".join(query.split())

    target = next((ws for ws in workspaces if ws.name.lower() == query), None)
    if target is None and query:
        target = next((ws for ws in workspaces if query in ws.name.lower() or ws.name.lower() in query), None)
    if target is None and query in {"solo", "personal", "private", "me", "mine"}:
        target = next((ws for ws in workspaces if ws.type == WorkspaceType.PERSONAL), None)
    if target is None and query in {"team", "group"}:
        target = next((ws for ws in workspaces if ws.type == WorkspaceType.TEAM), None)
    if target is None:
        names = ", ".join(ws.name for ws in workspaces)
        raise ToolError(f"No workspace matches '{target_query}'. Your workspaces: {names}")

    return {
        "workspace_id": str(target.id),
        "workspace_name": target.name,
        "workspace_type": target.type.value,
        "action": "switch_workspace",
        "message": f"Switched to workspace '{target.name}'.",
    }


def _doc_summary(doc: Document, workspace_id: UUID, workspace_name: str | None = None) -> dict:
    text = extract_text_from_document(doc)
    item = {
        "id": str(doc.id),
        "title": doc.title,
        "workspace_id": str(workspace_id),
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        "content_preview": text[:300],
    }
    if workspace_name:
        item["workspace_name"] = workspace_name
    return item


async def search_documents_tool(
    db: AsyncSession,
    workspace_id: UUID,
    query: str,
    user: User | None = None,
    search_all_groups: bool = False,
    limit: int = 20,
) -> list[dict]:
    """Documents whose title or content contains the query, current workspace first."""
    scopes: list[tuple[UUID, str | None]] = [(workspace_id, None)]
    if search_all_groups and user:
        scopes += [(ws.id, ws.name) for ws in await list_user_workspaces(db, user.id) if ws.id != workspace_id]

    needle = query.strip().lower()
    matched: list[dict] = []
    for scope_id, scope_name in scopes:
        docs = (await db.execute(
            select(Document).where(Document.workspace_id == scope_id).order_by(Document.updated_at.desc())
        )).scalars().all()
        for doc in docs:
            if not needle or needle in doc.title.lower() or needle in extract_text_from_document(doc).lower():
                matched.append(_doc_summary(doc, scope_id, scope_name))
                if len(matched) >= limit:
                    return matched
    return matched


async def _find_document(db: AsyncSession, workspace_id: UUID, doc_query: str) -> Document | None:
    """Match by id, exact title, then a title containing the query. Ambiguous matches are refused."""
    docs = (await db.execute(
        select(Document).where(Document.workspace_id == workspace_id).order_by(Document.updated_at.desc())
    )).scalars().all()
    raw = doc_query.strip()
    query = raw.lower()
    if not query:
        return None
    by_id = next((d for d in docs if str(d.id) == raw), None)
    if by_id:
        return by_id
    exact = [d for d in docs if d.title.strip().lower() == query]
    if len(exact) == 1:
        return exact[0]
    candidates = exact or [d for d in docs if query in d.title.lower()]
    if len(candidates) > 1:
        options = "; ".join(f"'{d.title}' (id {d.id})" for d in candidates[:8])
        raise ToolError(f"Several documents match '{doc_query}': {options}. Ask the user which one, or pass the id.")
    return candidates[0] if candidates else None


async def create_document_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    title: str,
    content_text: str = "",
) -> dict:
    title = title.strip()
    if not title:
        raise ToolError("A document title is required")
    # Same shape the editor saves, so the page opens, previews and edits normally.
    doc = await create_document(
        db, workspace_id, user,
        DocumentCreate(title=title[:255], content={"text": content_text.strip()}),
    )
    await db.commit()
    schedule_document_ingestion(doc.id, delay=0)
    return {"id": str(doc.id), "title": doc.title, "action": "create", "message": f"Created document '{doc.title}'."}


EDIT_MODES = {"append", "prepend", "replace", "replace_text"}


async def edit_document_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    doc_query: str,
    new_content_text: str,
    mode: str = "append",
    find_text: str | None = None,
) -> dict:
    """Change a document in the current workspace.

    append / prepend add text; replace swaps the whole body; replace_text swaps every occurrence of
    `find_text` with `new_content_text` (targeted fixes without rewriting the page).
    """
    mode = (mode or "append").strip().lower()
    if mode not in EDIT_MODES:
        raise ToolError(f"Unknown edit mode '{mode}'. Use one of: {', '.join(sorted(EDIT_MODES))}")
    if mode != "replace_text" and not new_content_text.strip():
        raise ToolError("No text was given to put in the document")
    doc = await _find_document(db, workspace_id, doc_query)
    if doc is None:
        raise ToolError(f"No document matching '{doc_query}' in this workspace")

    current_text = extract_text_from_document(doc)
    occurrences = 0
    if mode == "replace_text":
        if not find_text:
            raise ToolError("replace_text needs find_text: the exact text to replace")
        occurrences = current_text.count(find_text)
        if occurrences == 0:
            raise ToolError(
                f"'{find_text[:80]}' was not found in '{doc.title}'. Read the document first and copy the text exactly."
            )
        final_text = current_text.replace(find_text, new_content_text)
    elif mode == "replace":
        final_text = new_content_text.strip()
    elif mode == "prepend":
        final_text = (new_content_text.strip() + "\n\n" + current_text).strip()
    else:
        final_text = (current_text + "\n\n" + new_content_text.strip()).strip()

    content = dict(doc.content) if isinstance(doc.content, dict) else {}
    content.pop("blocks", None)  # "text" is now the single source of the document body
    content["text"] = final_text
    doc.content = content
    doc.updated_at = datetime.now()
    await db.commit()
    schedule_document_ingestion(doc.id, delay=0)
    detail = ""
    if mode == "replace_text":
        detail = f" ({occurrences} replacement{'s' if occurrences != 1 else ''})"
    return {
        "id": str(doc.id),
        "title": doc.title,
        "action": "edit",
        "mode": mode,
        "message": f"Updated document '{doc.title}'{detail}.",
        "content_preview": final_text[:300],
    }


async def get_document_tool(
    db: AsyncSession,
    workspace_id: UUID,
    doc_query: str,
    user: User | None = None,
    target_group: str | None = None,
) -> dict:
    """Read a document from the current workspace, or from another workspace the user belongs to."""
    scopes: list[tuple[UUID, str | None, str | None]] = []
    if not target_group:
        scopes.append((workspace_id, None, None))
    if user:
        for ws in await list_user_workspaces(db, user.id):
            if ws.id == workspace_id and not target_group:
                continue
            if target_group and target_group.strip().lower() not in ws.name.lower():
                continue
            scopes.append((ws.id, ws.name, ws.type.value))

    for scope_id, scope_name, scope_type in scopes:
        doc = await _find_document(db, scope_id, doc_query)
        if doc is None:
            continue
        result = {
            "id": str(doc.id),
            "title": doc.title,
            "content": extract_text_from_document(doc)[:20000],
            "workspace_id": str(scope_id),
            "message": f"Read document '{doc.title}'" + (f" from workspace '{scope_name}'." if scope_name else "."),
        }
        if scope_name:
            result.update({"workspace_name": scope_name, "workspace_type": scope_type})
        return result
    where = f" in workspace '{target_group}'" if target_group else ""
    raise ToolError(f"No document matching '{doc_query}'{where}")


# -------------------------------------------------------------------------------------------
# Meetings
# -------------------------------------------------------------------------------------------

async def search_sessions_tool(db: AsyncSession, workspace_id: UUID, query: str = "", limit: int = 10) -> list[dict]:
    """Meetings matching the query (all recent meetings when the query is empty), newest first."""
    stmt = select(SessionRecord).where(SessionRecord.workspace_id == workspace_id)
    if query.strip():
        pattern = _like(query)
        stmt = stmt.where(or_(
            SessionRecord.title.ilike(pattern, escape="!"),
            SessionRecord.transcript.ilike(pattern, escape="!"),
            SessionRecord.ai_summary.ilike(pattern, escape="!"),
        ))
    sessions = (await db.execute(stmt.order_by(SessionRecord.created_at.desc()).limit(limit))).scalars().all()
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "ai_summary": (s.ai_summary or "")[:2000],
            "action_items": s.action_items or [],
            "transcript_preview": (s.transcript or "")[:300],
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sessions
    ]


# -------------------------------------------------------------------------------------------
# Tasks
# -------------------------------------------------------------------------------------------

async def list_tasks_tool(db: AsyncSession, workspace_id: UUID, query: str = "", status: str | None = None) -> list[dict]:
    stmt = select(Task).where(Task.workspace_id == workspace_id)
    if query.strip():
        stmt = stmt.where(Task.title.ilike(_like(query), escape="!"))
    if status:
        try:
            stmt = stmt.where(Task.status == TaskStatus(status.lower()))
        except ValueError as exc:
            raise ToolError(f"Unknown task status '{status}'") from exc
    tasks = (await db.execute(stmt.order_by(Task.created_at.desc()).limit(50))).scalars().all()
    return [
        {"id": str(t.id), "title": t.title, "status": t.status.value, "priority": t.priority.value}
        for t in tasks
    ]


async def create_task_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    title: str,
    description: str | None = None,
    status: str = "todo",
    priority: str = "medium",
) -> dict:
    title = title.strip()
    if not title:
        raise ToolError("A task title is required")
    try:
        task_status = TaskStatus(status.lower())
    except ValueError:
        task_status = TaskStatus.TODO
    try:
        task_priority = TaskPriority(priority.lower())
    except ValueError:
        task_priority = TaskPriority.MEDIUM

    task = await create_task(
        db, workspace_id, user,
        TaskCreate(title=title[:255], description=description, status=task_status, priority=task_priority),
    )
    await db.commit()
    await ws_manager.broadcast_to_workspace(workspace_id, {
        "event": "task_created",
        "workspace_id": str(workspace_id),
        "data": {"id": str(task.id), "title": task.title, "status": task.status.value, "priority": task.priority.value},
    })
    return {
        "id": str(task.id),
        "title": task.title,
        "status": task.status.value,
        "priority": task.priority.value,
        "message": f"Created task '{task.title}' ({task.priority.value} priority, {task.status.value}).",
    }


async def update_task_status_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    task_id: str,
    status: str,
) -> dict:
    try:
        new_status = TaskStatus(status.lower())
    except ValueError as exc:
        raise ToolError(f"Unknown task status '{status}'") from exc
    task = await update_task(db, workspace_id, _uuid(task_id, "task"), user_id, TaskUpdate(status=new_status))
    await db.commit()
    await ws_manager.broadcast_to_workspace(workspace_id, {
        "event": "task_updated",
        "workspace_id": str(workspace_id),
        "data": {"id": str(task.id), "title": task.title, "status": task.status.value},
    })
    return {
        "id": str(task.id),
        "title": task.title,
        "status": task.status.value,
        "message": f"Moved task '{task.title}' to {task.status.value}.",
    }


# -------------------------------------------------------------------------------------------
# Code repositories
# -------------------------------------------------------------------------------------------

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")


async def list_files_tool(db: AsyncSession, workspace_id: UUID, query: str = "", images_only: bool = False) -> list[dict]:
    """Uploaded files (newest first). Images can be placed in a page with ![alt](file:<id>)."""
    files = (await db.execute(
        select(FileRecord).where(FileRecord.workspace_id == workspace_id).order_by(FileRecord.created_at.desc())
    )).scalars().all()
    needle = query.strip().lower()
    items = []
    for f in files:
        is_image = f.filename.lower().endswith(IMAGE_EXTENSIONS)
        if (images_only and not is_image) or (needle and needle not in f.filename.lower()):
            continue
        item = {"id": str(f.id), "filename": f.filename, "is_image": is_image, "size_bytes": f.file_size}
        if is_image:
            item["markdown"] = f"![{Path(f.filename).stem}](file:{f.id})"
        if f.document_id:
            item["page_id"] = str(f.document_id)  # original upload of this page
        items.append(item)
        if len(items) >= 50:
            break
    return items


async def list_repos_tool(db: AsyncSession, workspace_id: UUID) -> list[dict]:
    repos = (await db.execute(select(CodeRepo).where(CodeRepo.workspace_id == workspace_id))).scalars().all()
    return [{"id": str(r.id), "name": r.name, "description": r.description} for r in repos]


async def create_repo_tool(db: AsyncSession, workspace_id: UUID, user: User, name: str, description: str | None = None) -> dict:
    if not name.strip():
        raise ToolError("A repository name is required")
    repo = await create_repo(db, workspace_id, user, CodeRepoCreate(name=name.strip()[:255], description=description))
    await db.commit()
    return {"id": str(repo.id), "name": repo.name, "message": f"Created repository '{repo.name}'."}


async def create_commit_tool(db: AsyncSession, workspace_id: UUID, user: User, repo_id: str, message: str) -> dict:
    commit = await create_commit(db, workspace_id, _uuid(repo_id, "repository"), user, CommitCreate(message=message))
    await db.commit()
    return {
        "id": str(commit.id),
        "hash": commit.hash,
        "message": f"Logged commit {commit.hash[:7]}: '{commit.message}'.",
    }


async def create_issue_tool(
    db: AsyncSession, workspace_id: UUID, user: User, repo_id: str, title: str, description: str | None = None
) -> dict:
    issue = await create_issue(
        db, workspace_id, _uuid(repo_id, "repository"), user, IssueCreate(title=title[:255], description=description)
    )
    await db.commit()
    return {"id": str(issue.id), "title": issue.title, "status": issue.status.value,
            "message": f"Opened issue '{issue.title}'."}


# -------------------------------------------------------------------------------------------
# Finance
# -------------------------------------------------------------------------------------------

async def search_finance_tool(db: AsyncSession, workspace_id: UUID, user_id: UUID, category: str | None = None) -> dict:
    runway = await calculate_runway(db, workspace_id, user_id)
    stmt = select(FinanceTransaction).where(FinanceTransaction.workspace_id == workspace_id)
    if category:
        stmt = stmt.where(FinanceTransaction.category.ilike(_like(category), escape="!"))
    txs = (await db.execute(stmt.order_by(FinanceTransaction.date.desc()))).scalars().all()
    return {
        "metrics": runway,
        "transactions_count": len(txs),
        "recent_transactions": [
            {"id": str(t.id), "type": t.type.value, "amount": t.amount, "category": t.category,
             "date": t.date.isoformat()}
            for t in txs[:10]
        ],
    }


async def create_transaction_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    type: str,
    amount: float,
    category: str,
    date: str | None = None,
    description: str | None = None,
) -> dict:
    try:
        value = float(amount)
    except (TypeError, ValueError) as exc:
        raise ToolError("The amount must be a number") from exc
    if value <= 0:
        raise ToolError("The amount must be greater than zero")
    if not math.isfinite(value) or value > MAX_AMOUNT:
        raise ToolError(f"The amount must be at most {MAX_AMOUNT:,.0f}")
    if not category.strip():
        raise ToolError("A category is required")
    tx_type = TransactionType.INCOME if type.lower() in {"income", "revenue"} else TransactionType.EXPENSE
    try:
        tx_date = date_type.fromisoformat(date) if date else date_type.today()
    except ValueError as exc:
        raise ToolError(f"'{date}' is not a valid YYYY-MM-DD date") from exc

    tx = await create_transaction(
        db, workspace_id, user,
        TransactionCreate(
            type=tx_type,
            amount=value,
            category=category.strip()[:128],
            date=datetime.combine(tx_date, datetime.min.time()),
            description=description,
        ),
    )
    await db.commit()
    return {
        "id": str(tx.id),
        "tx_type": tx.type.value,
        "amount": tx.amount,
        "category": tx.category,
        "message": f"Logged {tx.type.value} of ${tx.amount:,.2f} under '{tx.category}'.",
    }


# -------------------------------------------------------------------------------------------
# Channels
# -------------------------------------------------------------------------------------------

async def list_channels_tool(db: AsyncSession, workspace_id: UUID, user: User) -> list[dict]:
    channels = await list_channels(db, workspace_id, user.id)
    return [
        {"id": str(c.id), "name": c.name, "is_private": c.is_private}
        for c in channels
        if c.workspace_id == workspace_id and not c.is_direct
    ]


async def create_channel_tool(db: AsyncSession, workspace_id: UUID, user: User, name: str, is_private: bool = False) -> dict:
    clean = name.strip().lstrip("#")
    if not clean:
        raise ToolError("A channel name is required")
    channel = await create_channel(db, workspace_id, user, ChannelCreate(name=clean[:128], is_private=is_private))
    await db.commit()
    return {"id": str(channel.id), "name": channel.name, "message": f"Created channel #{channel.name}."}


async def post_channel_message_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    content: str,
    channel_id: str | None = None,
    channel_name: str | None = None,
) -> dict:
    if not content.strip():
        raise ToolError("Message content is required")
    channels = await list_channels(db, workspace_id, user.id)
    channel = None
    if channel_id:
        channel = next((c for c in channels if str(c.id) == str(channel_id)), None)
    elif channel_name:
        wanted = channel_name.strip().lstrip("#").lower()
        channel = next((c for c in channels if c.name.lower() == wanted and not c.is_direct), None)
    if channel is None:
        raise ToolError(f"No channel named '{channel_name or channel_id}' that you can post to")

    message = await post_message(db, workspace_id, channel.id, user, MessageCreate(content=content.strip()[:10000]))
    await db.commit()
    from app.schemas.channel import MessageResponse

    await ws_manager.broadcast_to_channel(channel.id, {
        "event": "new_message",
        "channel_id": str(channel.id),
        "data": MessageResponse.model_validate(message).model_dump(mode="json"),
    })
    return {"id": str(message["id"]), "channel_id": str(channel.id), "channel_name": channel.name,
            "message": f"Posted to #{channel.name}."}


# -------------------------------------------------------------------------------------------
# Reports & calendar
# -------------------------------------------------------------------------------------------

async def generate_report_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    title: str,
    report_type: str = "sprint_summary",
    prompt: str | None = None,
) -> dict:
    try:
        r_type = ReportType(report_type.lower())
    except ValueError:
        r_type = ReportType.SPRINT_SUMMARY
    report = await generate_report(
        db, workspace_id, user,
        ReportGenerateRequest(title=title.strip()[:255] or "Workspace Report", report_type=r_type, custom_prompt=prompt),
    )
    await db.commit()
    return {"id": str(report.id), "title": report.title, "summary": report.summary,
            "message": f"Generated report '{report.title}'."}


async def create_calendar_event_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    title: str,
    event_date: str,
    event_time: str | None = None,
    event_type: str = "meeting",
    priority: str = "medium",
) -> dict:
    from app.models.calendar import CalendarEventPriority, CalendarEventSource, CalendarEventType
    from app.schemas.calendar import CalendarEventCreate
    from app.services.calendar_service import create_calendar_event

    if not title.strip():
        raise ToolError("An event title is required")
    try:
        date_type.fromisoformat(event_date)
    except (TypeError, ValueError) as exc:
        raise ToolError(f"'{event_date}' is not a valid YYYY-MM-DD date") from exc
    try:
        e_type = CalendarEventType(event_type.lower())
    except ValueError:
        e_type = CalendarEventType.MEETING
    try:
        p_type = CalendarEventPriority(priority.lower())
    except ValueError:
        p_type = CalendarEventPriority.MEDIUM

    event = await create_calendar_event(
        db, workspace_id, user,
        CalendarEventCreate(
            title=title.strip()[:255],
            event_date=event_date,
            event_time=event_time,
            event_type=e_type,
            priority=p_type,
            source=CalendarEventSource.AI_DETECTED,
        ),
    )
    await db.commit()
    return {
        "id": str(event.id),
        "title": event.title,
        "event_date": event.event_date,
        "event_time": event.event_time,
        "message": f"Scheduled '{event.title}' on {event.event_date}" + (f" at {event.event_time}." if event.event_time else "."),
    }


# -------------------------------------------------------------------------------------------
# Declarations shown to the model (JSON Schema subset understood by Gemini and Groq)
# -------------------------------------------------------------------------------------------

def _fn(name: str, description: str, properties: dict | None = None, required: list[str] | None = None) -> dict:
    declaration = {"name": name, "description": description}
    if properties:
        declaration["parameters"] = {"type": "object", "properties": properties, "required": required or []}
    return declaration


STRING = {"type": "string"}
AVAILABLE_TOOLS = [
    _fn("search_documents", "Find documents whose title or text contains a keyword.",
        {"query": {**STRING, "description": "Keyword or phrase"},
         "search_all_groups": {"type": "boolean", "description": "Also search the user's other workspaces"}},
        ["query"]),
    _fn("get_document", "Read the full text of a document by title or id.",
        {"doc_query": {**STRING, "description": "Document title or id"},
         "target_group": {**STRING, "description": "Name of another workspace to read from (optional)"}},
        ["doc_query"]),
    _fn("create_document", "Create a new document in the current workspace.",
        {"title": STRING, "content_text": {**STRING, "description": "Document body (plain text or Markdown)"}},
        ["title"]),
    _fn("edit_document",
        "Change an existing document. Read it with get_document first. Use mode 'replace_text' with find_text "
        "for targeted fixes, 'append'/'prepend' to add text, or 'replace' to rewrite the whole body (Markdown).",
        {"doc_query": {**STRING, "description": "Document id (preferred) or exact title"},
         "new_content_text": {**STRING, "description": "Text to add, the new body, or the replacement for find_text"},
         "mode": {"type": "string", "enum": ["append", "prepend", "replace", "replace_text"]},
         "find_text": {**STRING, "description": "replace_text only: the exact existing text to replace"}},
        ["doc_query", "new_content_text"]),
    _fn("search_sessions", "Search meeting recordings: summaries, transcripts, and action items. Empty query lists recent meetings.",
        {"query": STRING}),
    _fn("list_tasks", "List Kanban tasks, optionally filtered by title keyword or status.",
        {"query": STRING, "status": {"type": "string", "enum": ["todo", "in_progress", "review", "done"]}}),
    _fn("create_task", "Create a Kanban task.",
        {"title": STRING, "description": STRING,
         "status": {"type": "string", "enum": ["todo", "in_progress", "review", "done"]},
         "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]}},
        ["title"]),
    _fn("update_task_status", "Move a task to another Kanban column. Use list_tasks to find the id.",
        {"task_id": STRING, "status": {"type": "string", "enum": ["todo", "in_progress", "review", "done"]}},
        ["task_id", "status"]),
    _fn("list_files",
        "List uploaded files (images, PDFs, Word files…). Image results include ready-to-use Markdown "
        "(![alt](file:<id>)) for placing the image in a document with edit_document.",
        {"query": {**STRING, "description": "Filename keyword (optional)"},
         "images_only": {"type": "boolean"}}),
    _fn("list_repos", "List code repositories in the workspace."),
    _fn("create_repo", "Create a code repository.", {"name": STRING, "description": STRING}, ["name"]),
    _fn("create_commit", "Log a commit to a repository. Use list_repos to find the id.",
        {"repo_id": STRING, "message": STRING}, ["repo_id", "message"]),
    _fn("create_issue", "Open an issue in a repository. Use list_repos to find the id.",
        {"repo_id": STRING, "title": STRING, "description": STRING}, ["repo_id", "title"]),
    _fn("search_finance", "Get cash balance, monthly burn, runway, and recent transactions.",
        {"category": {**STRING, "description": "Optional category filter"}}),
    _fn("create_transaction", "Record an income or expense.",
        {"type": {"type": "string", "enum": ["income", "expense"]},
         "amount": {"type": "number", "description": "Positive amount in dollars"},
         "category": STRING,
         "date": {**STRING, "description": "YYYY-MM-DD, defaults to today"},
         "description": STRING},
        ["type", "amount", "category"]),
    _fn("list_channels", "List the workspace's chat channels."),
    _fn("create_channel", "Create a chat channel.", {"name": STRING, "is_private": {"type": "boolean"}}, ["name"]),
    _fn("post_channel_message", "Post a message to a channel, by channel name.",
        {"channel_name": STRING, "content": STRING}, ["channel_name", "content"]),
    _fn("generate_report", "Generate a report from recent meetings, documents, and finances.",
        {"title": STRING,
         "report_type": {"type": "string", "enum": ["sprint_summary", "financial_overview", "meeting_digest", "project_status", "custom"]},
         "prompt": {**STRING, "description": "What the report should focus on"}},
        ["title"]),
    _fn("create_calendar_event", "Add a meeting, deadline, reminder, or milestone to the calendar.",
        {"title": STRING,
         "event_date": {**STRING, "description": "YYYY-MM-DD"},
         "event_time": {**STRING, "description": "e.g. 03:00 PM (optional)"},
         "event_type": {"type": "string", "enum": ["meeting", "deadline", "reminder", "milestone", "task"]},
         "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]}},
        ["title", "event_date"]),
    _fn("switch_workspace", "Switch the user's active workspace by name, or to 'personal' or 'team'.",
        {"target": STRING}, ["target"]),
]


def to_json_safe(value):
    return json.loads(json.dumps(value, default=str))
