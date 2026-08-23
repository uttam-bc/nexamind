import json
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Channel,
    CodeRepo,
    Commit,
    Document,
    FinanceTransaction,
    Issue,
    Message,
    ReportRecord,
    ReportType,
    SessionRecord,
    Task,
    User,
)
from app.models.finance import TransactionType
from app.models.project import IssueStatus, TaskPriority, TaskStatus
from app.schemas.channel import ChannelCreate, MessageCreate
from app.schemas.document import DocumentCreate, DocumentUpdate
from app.schemas.finance import TransactionCreate
from app.schemas.project import CodeRepoCreate, CommitCreate, IssueCreate, TaskCreate, TaskUpdate
from app.schemas.report import ReportGenerateRequest
from app.services.channel_service import create_channel, post_message
from app.services.document_service import create_document, update_document
from app.services.finance_service import calculate_runway, create_transaction
from app.services.project_service import (
    create_commit,
    create_issue,
    create_repo,
    create_task,
    update_task,
)
from app.services.report_service import generate_report
from app.services.websocket_manager import ws_manager


# -------------------------------------------------------------
# 1. DOCUMENT & WORKSPACE ACCESS TOOLS
# -------------------------------------------------------------
async def switch_workspace_tool(
    db: AsyncSession,
    user: User,
    target_query: str,
) -> dict:
    """Switch active workspace context to Solo or a specific Group workspace."""
    from app.models import WorkspaceType
    from app.services.workspace_service import list_user_workspaces
    user_workspaces = await list_user_workspaces(db, user.id)
    if not user_workspaces:
        return {"error": "No workspaces found for user."}

    query_lower = target_query.lower().strip()
    target_ws = None

    # Check for personal / solo
    if any(s in query_lower for s in ["solo", "personal", "my account", "private", "me"]):
        for ws in user_workspaces:
            if ws.type == WorkspaceType.PERSONAL or "personal" in ws.name.lower() or "solo" in ws.name.lower():
                target_ws = ws
                break
    
    # Check for group / team generic
    if not target_ws and any(s in query_lower for s in ["group", "team"]):
        for ws in user_workspaces:
            if ws.type == WorkspaceType.TEAM:
                target_ws = ws
                break

    # Check by specific workspace name
    if not target_ws:
        for ws in user_workspaces:
            if query_lower in ws.name.lower() or ws.name.lower() in query_lower:
                target_ws = ws
                break

    if not target_ws:
        target_ws = user_workspaces[0]

    return {
        "id": str(target_ws.id),
        "workspace_id": str(target_ws.id),
        "workspace_name": target_ws.name,
        "workspace_type": target_ws.type.value,
        "type": "workspace_switch",
        "action": "switch_workspace",
        "message": f"Switched active workspace to '{target_ws.name}' ({target_ws.type.value.upper()}).",
    }


async def search_documents_tool(
    db: AsyncSession,
    workspace_id: UUID,
    query: str,
    user: User | None = None,
    search_all_groups: bool = False,
) -> list[dict]:
    """Search workspace documents by title and content across active workspace and group workspaces."""
    matched = []
    
    # 1. Search current workspace
    result = await db.execute(
        select(Document).where(Document.workspace_id == workspace_id)
    )
    for doc in result.scalars().all():
        content_str = json.dumps(doc.content or {}).lower()
        if not query or query.lower() in doc.title.lower() or query.lower() in content_str:
            matched.append({
                "id": str(doc.id),
                "title": doc.title,
                "workspace_id": str(workspace_id),
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
                "content_preview": content_str[:200],
            })

    # 2. If search_all_groups and user provided, include documents from other member workspaces
    if search_all_groups and user:
        from app.services.workspace_service import list_user_workspaces
        workspaces = await list_user_workspaces(db, user.id)
        for ws in workspaces:
            if ws.id == workspace_id:
                continue
            res = await db.execute(select(Document).where(Document.workspace_id == ws.id))
            for doc in res.scalars().all():
                content_str = json.dumps(doc.content or {}).lower()
                if not query or query.lower() in doc.title.lower() or query.lower() in content_str:
                    matched.append({
                        "id": str(doc.id),
                        "title": doc.title,
                        "workspace_id": str(ws.id),
                        "workspace_name": ws.name,
                        "created_at": doc.created_at.isoformat() if doc.created_at else None,
                        "content_preview": content_str[:200],
                    })

    return matched


async def create_document_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    title: str,
    content_text: str = "",
) -> dict:
    """Create a new document or text file in the workspace."""
    initial_blocks = [
        {"id": "1", "type": "heading", "level": 1, "text": title},
        {"id": "2", "type": "paragraph", "text": content_text or "Document created by NexaMind Autonomous AI Agent."},
    ]
    doc = await create_document(
        db,
        workspace_id,
        user,
        DocumentCreate(
            title=title,
            content={
                "text": content_text or f"# {title}\n\nDocument initialized by NexaMind AI.",
                "blocks": initial_blocks,
            },
        ),
    )
    await db.commit()
    return {
        "id": str(doc.id),
        "title": doc.title,
        "type": "document",
        "action": "create",
        "message": f"Document '{doc.title}' created and saved to Supabase.",
    }


async def edit_document_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    doc_query: str,
    new_content_text: str,
    mode: str = "append",
) -> dict:
    """Edit or update an existing document or text file in the workspace."""
    result = await db.execute(
        select(Document).where(Document.workspace_id == workspace_id)
    )
    docs = result.scalars().all()
    target_doc = None
    for d in docs:
        if str(d.id) == doc_query or doc_query.lower() in d.title.lower():
            target_doc = d
            break

    # If not found in current workspace, check user's other workspaces
    if not target_doc:
        from app.services.workspace_service import list_user_workspaces
        workspaces = await list_user_workspaces(db, user.id)
        for ws in workspaces:
            if ws.id == workspace_id:
                continue
            res = await db.execute(select(Document).where(Document.workspace_id == ws.id))
            for d in res.scalars().all():
                if str(d.id) == doc_query or doc_query.lower() in d.title.lower():
                    target_doc = d
                    break
            if target_doc:
                break

    if not target_doc:
        return await create_document_tool(
            db, workspace_id, user, title=doc_query, content_text=new_content_text
        )

    current_text = ""
    if isinstance(target_doc.content, dict):
        current_text = target_doc.content.get("text", "")
        if not current_text and "blocks" in target_doc.content:
            current_text = "\n\n".join(
                b.get("text", "") for b in target_doc.content.get("blocks", [])
            )
    elif isinstance(target_doc.content, str):
        current_text = target_doc.content

    if mode == "append":
        final_text = f"{current_text}\n\n{new_content_text}".strip()
    else:
        final_text = new_content_text

    target_doc.content = {"text": final_text}
    await db.commit()
    return {
        "id": str(target_doc.id),
        "title": target_doc.title,
        "type": "document",
        "action": "edit",
        "message": f"Document '{target_doc.title}' edited and updated in Supabase.",
        "content_preview": final_text[:300],
    }


async def get_document_tool(
    db: AsyncSession,
    workspace_id: UUID,
    doc_query: str,
    user: User | None = None,
    target_group: str | None = None,
) -> dict:
    """Read full content of a document or file in current workspace or across group workspaces."""
    def _extract_text(content_val) -> str:
        if isinstance(content_val, dict):
            if content_val.get("text"):
                return str(content_val["text"])
            if "blocks" in content_val:
                parts = []
                for b in content_val["blocks"]:
                    if isinstance(b, dict) and b.get("text"):
                        parts.append(b["text"])
                if parts:
                    return "\n\n".join(parts)
            return json.dumps(content_val)
        return str(content_val or "")

    # 1. Check in current workspace
    result = await db.execute(
        select(Document).where(Document.workspace_id == workspace_id)
    )
    docs = result.scalars().all()
    for d in docs:
        if str(d.id) == doc_query or (doc_query and doc_query.lower() in d.title.lower()):
            return {
                "id": str(d.id),
                "title": d.title,
                "content": _extract_text(d.content),
                "workspace_id": str(workspace_id),
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "message": f"Retrieved document '{d.title}'.",
            }

    # 2. If not found in current workspace, check across user's other workspaces
    if user:
        from app.services.workspace_service import list_user_workspaces
        workspaces = await list_user_workspaces(db, user.id)
        for ws in workspaces:
            if ws.id == workspace_id:
                continue
            if target_group and target_group.lower() not in ws.name.lower():
                continue
            res = await db.execute(select(Document).where(Document.workspace_id == ws.id))
            ws_docs = res.scalars().all()
            for d in ws_docs:
                if str(d.id) == doc_query or not doc_query or (doc_query.lower() in d.title.lower()):
                    return {
                        "id": str(d.id),
                        "title": d.title,
                        "content": _extract_text(d.content),
                        "workspace_id": str(ws.id),
                        "workspace_name": ws.name,
                        "workspace_type": ws.type.value,
                        "created_at": d.created_at.isoformat() if d.created_at else None,
                        "message": f"Retrieved document '{d.title}' from Group workspace '{ws.name}'.",
                    }

    return {"error": f"Document '{doc_query}' not found."}



# -------------------------------------------------------------
# 2. SESSION & MEETING TOOLS
# -------------------------------------------------------------
async def search_sessions_tool(
    db: AsyncSession,
    workspace_id: UUID,
    query: str,
) -> list[dict]:
    """Search past meeting recordings, transcripts, summaries, and action items."""
    term = f"%{query.strip().lower()}%"
    query_builder = select(SessionRecord).where(SessionRecord.workspace_id == workspace_id)
    if query:
        query_builder = query_builder.where(
            or_(
                SessionRecord.title.ilike(term),
                SessionRecord.transcript.ilike(term),
                SessionRecord.ai_summary.ilike(term),
            )
        )
    result = await db.execute(query_builder.order_by(SessionRecord.created_at.desc()))
    sessions = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "transcript_preview": (s.transcript or "")[:200],
            "ai_summary": s.ai_summary,
            "action_items": s.action_items or [],
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sessions
    ]


# -------------------------------------------------------------
# 3. KANBAN TASK TOOLS
# -------------------------------------------------------------
async def create_task_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    title: str,
    description: str | None = None,
    status: str = "todo",
    priority: str = "medium",
) -> dict:
    """Create a new task on the Kanban board."""
    try:
        task_status = TaskStatus(status.lower())
    except ValueError:
        task_status = TaskStatus.TODO

    try:
        task_priority = TaskPriority(priority.lower())
    except ValueError:
        task_priority = TaskPriority.MEDIUM

    task = await create_task(
        db,
        workspace_id,
        user,
        TaskCreate(
            title=title,
            description=description,
            status=task_status,
            priority=task_priority,
        ),
    )
    await db.commit()

    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {
            "event": "task_created",
            "workspace_id": str(workspace_id),
            "data": {
                "id": str(task.id),
                "title": task.title,
                "status": task.status.value,
                "priority": task.priority.value,
            },
        },
    )

    return {
        "id": str(task.id),
        "title": task.title,
        "type": "task",
        "status": task.status.value,
        "priority": task.priority.value,
        "message": f"Task '{task.title}' created on Kanban board ({task.priority.value.upper()} priority).",
    }


async def update_task_status_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    task_id: str,
    status: str,
) -> dict:
    """Update task status on the Kanban board."""
    task_uuid = UUID(task_id)
    try:
        new_status = TaskStatus(status.lower())
    except ValueError:
        new_status = TaskStatus.TODO

    task = await update_task(
        db,
        workspace_id,
        task_uuid,
        user_id,
        TaskUpdate(status=new_status),
    )
    await db.commit()

    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {
            "event": "task_updated",
            "workspace_id": str(workspace_id),
            "data": {
                "id": str(task.id),
                "title": task.title,
                "status": task.status.value,
            },
        },
    )

    return {
        "id": str(task.id),
        "title": task.title,
        "type": "task",
        "status": task.status.value,
        "message": f"Task '{task.title}' moved to {task.status.value.upper()}.",
    }


# -------------------------------------------------------------
# 4. CODE REPO & VCS TOOLS
# -------------------------------------------------------------
async def create_repo_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    name: str,
    description: str | None = None,
) -> dict:
    """Create a new code repository in the workspace."""
    repo = await create_repo(
        db,
        workspace_id,
        user,
        CodeRepoCreate(name=name, description=description),
    )
    await db.commit()
    return {
        "id": str(repo.id),
        "name": repo.name,
        "type": "code_repo",
        "message": f"Repository '{repo.name}' created successfully.",
    }


async def create_commit_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    repo_id: str,
    message: str,
) -> dict:
    """Create and log a git commit to a code repository."""
    repo_uuid = UUID(repo_id)
    commit = await create_commit(
        db,
        workspace_id,
        repo_uuid,
        user,
        CommitCreate(message=message),
    )
    await db.commit()
    return {
        "id": str(commit.id),
        "hash": commit.hash,
        "message": commit.message,
        "type": "commit",
        "message_detail": f"Commit logged [{commit.hash[:7]}]: '{commit.message}'.",
    }


async def create_issue_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    repo_id: str,
    title: str,
    description: str | None = None,
) -> dict:
    """Create an issue in a code repository."""
    repo_uuid = UUID(repo_id)
    issue = await create_issue(
        db,
        workspace_id,
        repo_uuid,
        user,
        IssueCreate(title=title, description=description),
    )
    await db.commit()
    return {
        "id": str(issue.id),
        "title": issue.title,
        "type": "issue",
        "status": issue.status.value,
        "message": f"Issue #{str(issue.id)[:6]} '{issue.title}' opened.",
    }


# -------------------------------------------------------------
# 5. FINANCIAL TOOLS
# -------------------------------------------------------------
async def search_finance_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    category: str | None = None,
) -> dict:
    """Query workspace income/expenses and calculate runway balance."""
    runway = await calculate_runway(db, workspace_id, user_id)
    query = select(FinanceTransaction).where(FinanceTransaction.workspace_id == workspace_id)
    if category:
        query = query.where(FinanceTransaction.category.ilike(f"%{category.strip()}%"))
    result = await db.execute(query.order_by(FinanceTransaction.date.desc()))
    txs = result.scalars().all()
    return {
        "metrics": runway,
        "transactions_count": len(txs),
        "recent_transactions": [
            {
                "id": str(t.id),
                "type": t.type.value,
                "amount": t.amount,
                "category": t.category,
                "date": t.date.isoformat(),
            }
            for t in txs[:5]
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
) -> dict:
    """Log an income or expense transaction in the workspace financial ledger."""
    from datetime import date as d_date
    tx_type = TransactionType.INCOME if type.lower() == "income" else TransactionType.EXPENSE
    t_date = d_date.fromisoformat(date) if date else d_date.today()

    tx = await create_transaction(
        db,
        workspace_id,
        user,
        TransactionCreate(
            type=tx_type,
            amount=amount,
            category=category,
            date=t_date,
        ),
    )
    await db.commit()
    return {
        "id": str(tx.id),
        "type": "transaction",
        "tx_type": tx.type.value,
        "amount": tx.amount,
        "category": tx.category,
        "message": f"Logged {tx.type.value.upper()} of ${tx.amount:,.2f} under '{tx.category}'.",
    }


# -------------------------------------------------------------
# 6. CHANNEL & MESSAGING TOOLS
# -------------------------------------------------------------
async def create_channel_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    name: str,
) -> dict:
    """Create a new real-time communication channel."""
    channel = await create_channel(
        db,
        workspace_id,
        user,
        ChannelCreate(name=name),
    )
    await db.commit()
    return {
        "id": str(channel.id),
        "name": channel.name,
        "type": "channel",
        "message": f"Channel #{channel.name} created.",
    }


async def post_channel_message_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    channel_id: str,
    content: str,
) -> dict:
    """Post an announcement or message into a real-time channel."""
    c_uuid = UUID(channel_id)
    msg = await post_message(
        db,
        workspace_id,
        c_uuid,
        user,
        MessageCreate(content=content),
    )
    await db.commit()
    return {
        "id": str(msg.id),
        "channel_id": str(c_uuid),
        "type": "message",
        "message": f"Message posted to channel #{str(c_uuid)[:6]}.",
    }


# -------------------------------------------------------------
# 7. REPORT TOOLS
# -------------------------------------------------------------
async def generate_report_tool(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    title: str,
    report_type: str = "sprint_summary",
    prompt: str | None = None,
) -> dict:
    """Synthesize an executive report from workspace meetings, docs, and financials."""
    try:
        r_type = ReportType(report_type.lower())
    except ValueError:
        r_type = ReportType.SPRINT_SUMMARY

    rep = await generate_report(
        db,
        workspace_id,
        user,
        ReportGenerateRequest(
            title=title,
            report_type=r_type,
            custom_prompt=prompt,
        ),
    )
    return {
        "id": str(rep.id),
        "title": rep.title,
        "type": "report",
        "message": f"Executive report '{rep.title}' synthesized.",
    }


# -------------------------------------------------------------
# 8. CALENDAR & REMINDER TOOLS
# -------------------------------------------------------------
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
    """Schedule a meeting, deadline, or milestone on the workspace calendar."""
    from datetime import date as d_date
    from app.models.calendar import CalendarEventType, CalendarEventPriority, CalendarEventSource
    from app.schemas.calendar import CalendarEventCreate
    from app.services.calendar_service import create_calendar_event

    try:
        e_type = CalendarEventType(event_type.lower())
    except ValueError:
        e_type = CalendarEventType.MEETING

    try:
        p_type = CalendarEventPriority(priority.lower())
    except ValueError:
        p_type = CalendarEventPriority.MEDIUM

    ev = await create_calendar_event(
        db,
        workspace_id,
        user,
        CalendarEventCreate(
            title=title,
            event_date=event_date or d_date.today().isoformat(),
            event_time=event_time or "02:00 PM",
            event_type=e_type,
            priority=p_type,
            source=CalendarEventSource.AI_DETECTED,
        ),
    )
    await db.commit()
    return {
        "id": str(ev.id),
        "title": ev.title,
        "event_date": ev.event_date,
        "event_time": ev.event_time,
        "type": "calendar",
        "message": f"Calendar event '{ev.title}' scheduled for {ev.event_date} at {ev.event_time or 'All Day'}.",
    }



AVAILABLE_TOOLS = [
    {
        "name": "create_document",
        "description": "Author a new specification or notes document in the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Title of the document or filename (e.g. notes.txt, design.md)"},
                "content_text": {"type": "string", "description": "Body text or document content"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "edit_document",
        "description": "Edit, append to, or update an existing document or file.",
        "parameters": {
            "type": "object",
            "properties": {
                "doc_query": {"type": "string", "description": "Title or keyword of the document to edit"},
                "new_content_text": {"type": "string", "description": "Text to add or updated content"},
                "mode": {"type": "string", "enum": ["append", "replace"], "description": "Whether to append to or replace existing content"},
            },
            "required": ["doc_query", "new_content_text"],
        },
    },
    {
        "name": "get_document",
        "description": "Read the full text and details of a document or file.",
        "parameters": {
            "type": "object",
            "properties": {
                "doc_query": {"type": "string", "description": "Title or keyword of the document to read"},
            },
            "required": ["doc_query"],
        },
    },
    {
        "name": "search_documents",
        "description": "Search across all documents, specifications, and notes in the workspace.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Keywords to search for"}},
            "required": ["query"],
        },
    },
    {
        "name": "create_task",
        "description": "Create a new task on the team Kanban board.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Title of the task"},
                "description": {"type": "string", "description": "Task criteria and details"},
                "status": {"type": "string", "enum": ["todo", "in_progress", "done"], "description": "Column"},
                "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]},
            },
            "required": ["title"],
        },
    },
    {
        "name": "update_task_status",
        "description": "Move a task between Kanban columns (todo, in_progress, done).",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "UUID of the task"},
                "status": {"type": "string", "enum": ["todo", "in_progress", "done"]},
            },
            "required": ["task_id", "status"],
        },
    },
    {
        "name": "create_repo",
        "description": "Create a new code repository in the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name of the code repository"},
                "description": {"type": "string", "description": "Repository description"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "create_commit",
        "description": "Log a git commit to a code repository.",
        "parameters": {
            "type": "object",
            "properties": {
                "repo_id": {"type": "string", "description": "Repository UUID"},
                "message": {"type": "string", "description": "Commit message"},
            },
            "required": ["repo_id", "message"],
        },
    },
    {
        "name": "create_issue",
        "description": "Create an issue in a code repository.",
        "parameters": {
            "type": "object",
            "properties": {
                "repo_id": {"type": "string", "description": "Repository UUID"},
                "title": {"type": "string", "description": "Issue title"},
                "description": {"type": "string", "description": "Issue description"},
            },
            "required": ["repo_id", "title"],
        },
    },
    {
        "name": "create_transaction",
        "description": "Log an income or expense transaction in the workspace financial ledger.",
        "parameters": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["income", "expense"]},
                "amount": {"type": "number", "description": "Dollar amount"},
                "category": {"type": "string", "description": "Category (e.g. Hosting, Payroll, Sales)"},
                "date": {"type": "string", "description": "Date formatted YYYY-MM-DD"},
            },
            "required": ["type", "amount", "category"],
        },
    },
    {
        "name": "search_finance",
        "description": "Query workspace financial balance, net burn rate, and runway months.",
        "parameters": {
            "type": "object",
            "properties": {"category": {"type": "string", "description": "Optional category filter"}},
        },
    },
    {
        "name": "create_channel",
        "description": "Create a new team real-time chat channel.",
        "parameters": {
            "type": "object",
            "properties": {"name": {"type": "string", "description": "Channel name"}},
            "required": ["name"],
        },
    },
    {
        "name": "post_channel_message",
        "description": "Post a message or announcement into a real-time channel.",
        "parameters": {
            "type": "object",
            "properties": {
                "channel_id": {"type": "string", "description": "Channel UUID"},
                "content": {"type": "string", "description": "Message content to post"},
            },
            "required": ["channel_id", "content"],
        },
    },
    {
        "name": "generate_report",
        "description": "Synthesize a comprehensive executive report from workspace assets.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Report title"},
                "report_type": {"type": "string", "enum": ["sprint_summary", "financial_overview", "meeting_digest", "project_status", "custom"]},
                "prompt": {"type": "string", "description": "Special instructions or focus"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "search_sessions",
        "description": "Search past meeting recordings, transcripts, summaries, and action items.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Keywords or meeting topic"}},
            "required": ["query"],
        },
    },
    {
        "name": "create_calendar_event",
        "description": "Schedule a meeting, deadline, or milestone on the workspace calendar.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Event title"},
                "event_date": {"type": "string", "description": "Event date formatted YYYY-MM-DD"},
                "event_time": {"type": "string", "description": "Optional time e.g. 03:00 PM"},
                "event_type": {"type": "string", "enum": ["meeting", "deadline", "reminder", "milestone", "task"]},
                "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]},
            },
            "required": ["title", "event_date"],
        },
    },
]
