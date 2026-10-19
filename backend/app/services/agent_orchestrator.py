"""NexaMind copilot: an LLM tool-use loop grounded in workspace memory.

Flow for each chat turn:
1. Load (or create) the caller's own chat session and its recent history.
2. Retrieve relevant long-term memories and list workspace documents as context.
3. Ask the model (Gemini, falling back to Groq) with tool declarations; execute the tools it calls
   and feed results back until it answers or the round limit is reached.
4. With no reachable model, run the offline command parser instead and describe the results.
5. Persist the turn.
"""

import json
import logging
import os
import re
from datetime import date as d_date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Document, User, Workspace
from app.models.ai import AiMessage, AiSession
from app.services import agent_tools as tools
from app.services import llm_client
from app.services.agent_planner import PlannedCall, plan
from app.services.auth_service import AuthError
from app.services.memory_engine import retrieve_memories, sync_all_workspace_documents_to_memory

logger = logging.getLogger(__name__)

MAX_TOOL_RESULT_CHARS = 8000
HISTORY_MESSAGES = 20


# ---------------------------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------------------------

async def execute_tool(
    tool_name: str,
    tool_args: dict[str, Any],
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
) -> dict[str, Any]:
    """Run one tool. Failures come back as {"error": ...} instead of raising."""
    args = {k: v for k, v in (tool_args or {}).items() if v is not None}
    declaration = next((t for t in tools.AVAILABLE_TOOLS if t["name"] == tool_name), None)
    if declaration is None:
        return {"error": f"Unknown tool '{tool_name}'"}
    missing = [r for r in declaration.get("parameters", {}).get("required", []) if r not in args or args[r] in ("", None)]
    if missing:
        return {"error": f"Missing required argument(s): {', '.join(missing)}"}

    try:
        result = await _dispatch(tool_name, args, db, workspace_id, user)
    except (tools.ToolError, AuthError) as exc:
        # Raised by validation/access checks before anything is written.
        return {"error": exc.args[0] if exc.args else str(exc)}
    except Exception:
        logger.exception("Tool %s failed", tool_name)
        await db.rollback()
        await db.refresh(user)
        return {"error": f"The {tool_name} action failed unexpectedly."}
    return tools.to_json_safe(result)


async def _dispatch(name: str, a: dict, db: AsyncSession, ws: UUID, user: User) -> dict:
    if name == "switch_workspace":
        return await tools.switch_workspace_tool(db, user, str(a["target"]))
    if name == "search_documents":
        docs = await tools.search_documents_tool(db, ws, str(a["query"]), user=user,
                                                 search_all_groups=bool(a.get("search_all_groups")))
        return {"documents": docs, "count": len(docs)}
    if name == "get_document":
        return await tools.get_document_tool(db, ws, str(a["doc_query"]), user=user, target_group=a.get("target_group"))
    if name == "create_document":
        return await tools.create_document_tool(db, ws, user, str(a["title"]), str(a.get("content_text", "")))
    if name == "edit_document":
        return await tools.edit_document_tool(db, ws, user, str(a["doc_query"]), str(a["new_content_text"]),
                                              str(a.get("mode", "append")))
    if name == "search_sessions":
        sessions = await tools.search_sessions_tool(db, ws, str(a.get("query", "")))
        return {"sessions": sessions, "count": len(sessions)}

    # 3. Tasks & Kanban
    elif tool_name == "create_task":
        res = await create_task_tool(
            db,
            workspace_id,
            user,
            title=tool_args.get("title", "Untitled Task"),
            description=tool_args.get("description"),
            status=tool_args.get("status", "todo"),
            priority=tool_args.get("priority", "medium"),
        )
        return res
    elif tool_name == "update_task_status":
        return await update_task_status_tool(
            db,
            workspace_id,
            user.id,
            task_id=tool_args.get("task_id", ""),
            status=tool_args.get("status", "done"),
        )

    # 4. Repos & Code
    elif tool_name == "create_repo":
        return await create_repo_tool(
            db,
            workspace_id,
            user,
            name=tool_args.get("name", "new-repo"),
            description=tool_args.get("description", "Code repository created by agent"),
        )
    elif tool_name == "create_commit":
        return await create_commit_tool(
            db,
            workspace_id,
            user,
            repo_id=tool_args.get("repo_id", ""),
            message=tool_args.get("message", "Commit by NexaMind agent"),
        )
    elif tool_name == "create_issue":
        return await create_issue_tool(
            db,
            workspace_id,
            user,
            repo_id=tool_args.get("repo_id", ""),
            title=tool_args.get("title", "Issue"),
            description=tool_args.get("description"),
        )

    # 5. Finance
    elif tool_name == "create_transaction":
        return await create_transaction_tool(
            db,
            workspace_id,
            user,
            type=tool_args.get("type", "expense"),
            amount=float(tool_args.get("amount", 100.0)),
            category=tool_args.get("category", "General"),
            date=tool_args.get("date"),
        )
    elif tool_name == "search_finance":
        return await search_finance_tool(db, workspace_id, user.id, tool_args.get("category"))

    # 6. Channels & Chat
    elif tool_name == "create_channel":
        return await create_channel_tool(
            db,
            workspace_id,
            user,
            name=tool_args.get("name", "general"),
        )
    elif tool_name == "post_channel_message":
        return await post_channel_message_tool(
            db,
            workspace_id,
            user,
            channel_id=tool_args.get("channel_id", ""),
            content=tool_args.get("content", ""),
        )

    # 7. Reports
    elif tool_name == "generate_report":
        return await generate_report_tool(
            db,
            workspace_id,
            user,
            title=tool_args.get("title", "Workspace Executive Summary"),
            report_type=tool_args.get("report_type", "sprint_summary"),
            prompt=tool_args.get("prompt"),
        )

    # 8. Calendar & Events
    elif tool_name == "create_calendar_event":
        return await create_calendar_event_tool(
            db,
            workspace_id,
            user,
            title=tool_args.get("title", "Team Meeting"),
            event_date=tool_args.get("event_date", ""),
            event_time=tool_args.get("event_time"),
            event_type=tool_args.get("event_type", "meeting"),
            priority=tool_args.get("priority", "medium"),
        )

    raise ValueError(f"Unknown tool: {tool_name}")


async def call_gemini(
    prompt: str,
    system_instruction: str,
    history: list[dict],
    gemini_key: str,
) -> str | None:
    """Calls Google Gemini API with system instructions and chat conversation history."""
    clean_key = gemini_key.strip()
    if not clean_key:
        return None

    # Format history turns for Gemini
    contents = []
    for turn in history[-12:]:
        role = "user" if turn.get("role") == "user" else "model"
        text = turn.get("content", "").strip()
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})

    # Add current user prompt
    contents.append({"role": "user", "parts": [{"text": prompt}]})
    config = {"temperature": 0.3, "maxOutputTokens": 4096}

    for _ in range(get_settings().agent_max_tool_rounds):
        candidate = await llm_client.gemini_generate(api_key, contents, system=system, tools=tools.AVAILABLE_TOOLS,
                                                     generation_config=config)
        if candidate is None:
            raise _NoModel()
        parts = candidate.get("content", {}).get("parts") or []
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            return llm_client.candidate_text(candidate)
        contents.append(candidate["content"])
        responses = []
        for call in calls:
            result = await _execute_logged(call.get("name", ""), call.get("args") or {}, ctx)
            responses.append({"functionResponse": {"name": call.get("name", ""), "response": _for_model(result)}})
        contents.append({"role": "user", "parts": responses})
    return await _final_answer_without_tools(api_key, contents, system)


async def _final_answer_without_tools(api_key: str, contents: list[dict], system: str) -> str:
    contents = contents + [{"role": "user", "parts": [{"text": "Summarize what you did and found so far for the user."}]}]
    candidate = await llm_client.gemini_generate(api_key, contents, system=system)
    return llm_client.candidate_text(candidate) or "I reached my step limit for this request."


async def _run_groq(system: str, history: list[dict], prompt: str, ctx: dict) -> str:
    messages = [{"role": "system", "content": system}]
    messages += [{"role": t["role"], "content": t["content"]} for t in history if t["content"].strip()]
    messages.append({"role": "user", "content": prompt})

    for _ in range(get_settings().agent_max_tool_rounds):
        message = await llm_client.groq_chat(messages, tools=tools.AVAILABLE_TOOLS)
        if message is None:
            raise _NoModel()
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            return (message.get("content") or "").strip()
        messages.append({"role": "assistant", "content": message.get("content") or "", "tool_calls": tool_calls})
        for call in tool_calls:
            fn = call.get("function", {})
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = await _execute_logged(fn.get("name", ""), args, ctx)
            messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": json.dumps(_for_model(result))})
    return "I reached my step limit for this request. Here is what I did so far:\n\n" + _describe_actions(ctx["log"])


async def _execute_logged(name: str, args: dict, ctx: dict) -> dict:
    result = await execute_tool(name, args, ctx["db"], ctx["workspace_id"], ctx["user"])
    ctx["log"].append({"tool": name, "args": tools.to_json_safe(args), "result": result})
    return result


# ---------------------------------------------------------------------------------------------
# Offline path
# ---------------------------------------------------------------------------------------------

async def _run_offline(prompt: str, ctx: dict, memories: list[dict]) -> str:
    planned = plan(prompt).calls
    for call in planned:
        await _execute_planned(call, ctx)
    if ctx["log"]:
        return _describe_actions(ctx["log"])

    lines = ["No AI model is configured, so I can only run explicit commands such as "
             "“create a task 'Fix login bug'”, “log an expense of $40 for Hosting”, or "
             "“schedule a meeting 'Retro' tomorrow at 3 PM”."]
    if memories:
        lines.append("\nHere is what I found in your workspace that may be relevant:")
        lines += [f"- **{m['title']}** ({m.get('source_title') or m['source_type']}): {m['content']}" for m in memories[:6]]
    return "\n".join(lines)


async def _execute_planned(call: PlannedCall, ctx: dict) -> None:
    result = await _execute_logged(call.tool, call.args, ctx)
    if call.expand != "tasks_from_action_items" or "error" in result:
        return
    sessions = [s for s in result.get("sessions", []) if s.get("action_items")]
    if not sessions:
        ctx["notes"].append("I couldn't find a meeting with action items.")
        return
    meeting = sessions[0]
    ctx["notes"].append(f"Action items from the meeting **{meeting['title']}**:")
    for item in meeting["action_items"]:
        await _execute_logged("create_task", {"title": str(item)[:255],
                                              "description": f"From meeting: {meeting['title']}"}, ctx)


def _describe_actions(log: list[dict], notes: list[str] | None = None) -> str:
    lines = list(notes or [])
    for entry in log:
        result = entry["result"]
        if "error" in result:
            lines.append(f"- ⚠️ `{entry['tool']}`: {result['error']}")
            continue
        tool = entry["tool"]
        if tool == "search_finance":
            m = result.get("metrics", {})
            runway = m.get("runway_months")
            runway_text = "not burning cash" if runway is None else f"{runway} months"
            lines.append(
                f"- **Cash Balance:** ${m.get('cash_balance', 0):,.2f}\n"
                f"- **Total income:** ${m.get('total_income', 0):,.2f} · **Total expenses:** ${m.get('total_expenses', 0):,.2f}\n"
                f"- **Monthly net burn (last 90 days):** ${m.get('net_burn_rate', 0):,.2f}\n"
                f"- **Runway:** {runway_text}"
            )
        elif tool == "search_sessions":
            sessions = result.get("sessions", [])
            if not sessions:
                lines.append("- No matching meetings found.")
            for s in sessions[:5]:
                items = "; ".join(s.get("action_items") or []) or "none"
                lines.append(f"- **{s['title']}** — action items: {items}")
        elif tool == "search_documents":
            docs = result.get("documents", [])
            lines.append(f"- Found {len(docs)} document(s)" + (":" if docs else "."))
            lines += [f"  - **{d['title']}**: {d['content_preview'][:120]}" for d in docs[:10]]
        elif tool == "get_document":
            lines.append(f"- {result.get('message')}\n\n{result.get('content', '')[:3000]}")
        else:
            lines.append(f"- ✅ {result.get('message') or f'Ran {tool}.'}")
    return "\n".join(lines) if lines else "Done."


# ---------------------------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------------------------

async def run_agent(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    user_prompt: str,
    session_id: UUID | None = None,
) -> dict:
    """Orchestrates the NexaMind Agentic AI:
    1. Synchronize all workspace documents to memory
    2. AI Session & History Loading
    3. Document and Long-term Memory Retrieval
    4. Autonomous Tool Execution
    5. Gemini 3.8 Flash Reasoning & Grounded Synthesis
    6. Session Persistence & Memory Feedback
    """
    prompt_clean = user_prompt.strip()
    prompt_lower = prompt_clean.lower()
    tool_executions: list[dict] = []

    gemini_key = (gemini_key_override or os.getenv("GEMINI_API_KEY") or settings.gemini_api_key or "").strip()
    groq_key = (os.getenv("GROQ_API_KEY") or settings.groq_api_key or "").strip()

    # 1. PRIMARY GOAL: Automatically sync and read ALL workspace documents into AI Memory
    try:
        sync_result = await sync_all_workspace_documents_to_memory(
            db, workspace_id, gemini_key=gemini_key, force_refresh=False
        )
        if sync_result.get("documents_ingested", 0) > 0:
            logger.info("Auto-synced %d new/updated documents to AI memory", sync_result["documents_ingested"])
    except Exception as sync_exc:
        logger.warning("Workspace document auto-sync warning: %s", sync_exc)

    # 2. Fetch all current documents directly from workspace for real-time grounded context
    docs_q = select(Document).where(Document.workspace_id == workspace_id).order_by(Document.updated_at.desc())
    docs_res = await db.execute(docs_q)
    all_workspace_docs = list(docs_res.scalars().all())

    docs_context_parts = []
    for idx, d in enumerate(all_workspace_docs, 1):
        extracted_text = extract_text_from_document(d)
        truncated_content = extracted_text[:1200] + ("..." if len(extracted_text) > 1200 else "")
        docs_context_parts.append(
            f"{idx}. 📄 **{d.title}** (ID: {d.id})\n"
            f"   Content Preview:\n   {truncated_content}"
        )

    docs_context_str = "\n\n".join(docs_context_parts) if docs_context_parts else "No documents created in this workspace yet."

    # 3. Resolve or Create AI Session
    ai_session: AiSession | None = None
    past_messages: list[dict] = []

    if session_id:
        if isinstance(session_id, str):
            try:
                session_id = UUID(session_id)
            except Exception:
                session_id = None

    if session_id:
        sess_q = select(AiSession).where(
            AiSession.id == session_id,
            AiSession.workspace_id == workspace_id,
        )
        sess_res = await db.execute(sess_q)
        ai_session = sess_res.scalar_one_or_none()

    if not ai_session:
        title = prompt_clean[:40] + ("..." if len(prompt_clean) > 40 else "")
        ai_session = AiSession(
            workspace_id=workspace_id,
            user_id=user.id,
            title=title or "New Chat Session",
        )
        db.add(ai_session)
        await db.flush()
        await db.refresh(ai_session)
    else:
        msgs_q = (
            select(AiMessage)
            .where(AiMessage.session_id == ai_session.id)
            .order_by(AiMessage.created_at.asc())
            .limit(20)
        )
        msgs_res = await db.execute(msgs_q)
        for m in msgs_res.scalars().all():
            past_messages.append({"role": m.role, "content": m.content})

    # 4. Retrieve Long-Term AI Memory (Docs, Chat, Tasks, Video Meetings)
    retrieved_mems = await retrieve_memories(db, workspace_id, user_prompt, limit=12)
    memory_context_lines = []
    for m in retrieved_mems:
        source_label = m.get("source_title") or m.get("source_type")
        memory_context_lines.append(f"- [{m.get('memory_type', 'fact').upper()} from {source_label}]: {m.get('title')} — {m.get('content')}")

    memory_context_str = "\n".join(memory_context_lines) if memory_context_lines else "No specific past memory matched."

    # 5. Autonomous Tool Execution Pattern Matching
    meeting_context_str = ""
    finance_context_str = ""

    # A. Workspace Switch
    is_ws_switch = any(p in prompt_lower for p in ["switch to", "switch workspace", "go to workspace", "go to group", "go to solo", "open group", "open solo", "switch account"])
    if is_ws_switch:
        target_match = re.search(r"(?:switch to|switch workspace to|go to|open)\s+([a-zA-Z0-9_\-\s]+)", user_prompt, re.IGNORECASE)
        target_q = target_match.group(1).strip() if target_match else "solo"
        sw_res = await execute_tool("switch_workspace", {"target": target_q}, db, workspace_id, user)
        tool_executions.append({"tool": "switch_workspace", "args": {"target": target_q}, "result": sw_res})

    # B. Cross-Workspace or Direct Document Access
    is_doc_get = (
        any(p in prompt_lower for p in ["access the file", "get the file", "read the file", "show file", "view file", "open file", "access document", "read document", "get document"])
        or ("file" in prompt_lower and ("from group" in prompt_lower or "in group" in prompt_lower))
    )
    if is_doc_get and not is_ws_switch:
        doc_q_match = re.search(r"(?:access the file|get the file|read the file|show file|view file|open file|access document|read document|get document|file)\s+['\"]?([a-zA-Z0-9_\-\.]+?)['\"]?(?:\s+from|\s+in|$)", user_prompt, re.IGNORECASE)
        doc_query = doc_q_match.group(1).strip().strip("'\"") if doc_q_match else ""
        group_match = re.search(r"(?:from group|in group|group workspace|group)\s+['\"]?([^'\"\n]+?)['\"]?$", user_prompt, re.IGNORECASE)
        target_group = group_match.group(1).strip().strip("'\"") if group_match else None
        get_res = await execute_tool("get_document", {"doc_query": doc_query, "target_group": target_group}, db, workspace_id, user)
        tool_executions.append({"tool": "get_document", "args": {"doc_query": doc_query, "target_group": target_group}, "result": get_res})

    # C. Document Editing / Appending
    is_doc_edit = (
        any(w in prompt_lower for w in ["doc", "document", "file", "notes"])
        and any(p in prompt_lower for p in ["edit", "update", "append", "modify", "add to"])
        and not is_ws_switch
    )
    if is_doc_edit:
        doc_target_match = re.search(
            r"(?:edit|update|append|modify|add to)\s+(?:doc|document|file)?\s*['\"]?([a-zA-Z0-9_\-\.]+?)['\"]?(?:\s+and\s+(?:add|append)|\s+with|\s+to|$)",
            user_prompt,
            re.IGNORECASE,
        )
        doc_target = doc_target_match.group(1).strip().strip("'\"") if doc_target_match else "notes.txt"
        edit_text_match = re.search(r"(?:and add|and append|with|add|text)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        edit_text = edit_text_match.group(1).strip().strip("'\"") if edit_text_match else "Updated by NexaMind AI Copilot."
        edit_res = await execute_tool("edit_document", {"doc_query": doc_target, "new_content_text": edit_text, "mode": "append"}, db, workspace_id, user)
        tool_executions.append({"tool": "edit_document", "args": {"doc_query": doc_target}, "result": edit_res})

    # D. Document / File Creation
    is_doc_create = (
        any(w in prompt_lower for w in ["doc", "document", "spec", "file", "notes", "markdown"])
        and any(p in prompt_lower for p in ["create", "write", "new", "draft", "author", "make", "generate", "build"])
        and not is_doc_edit
        and not is_doc_get
        and not is_ws_switch
    )
    if is_doc_create:
        named_match = re.search(r"(?:named|titled|called)\s+['\"]?([^'\"\n]+?)['\"]?(?:\s+with|\s+containing|$)", user_prompt, re.IGNORECASE)
        if named_match:
            doc_title = named_match.group(1).strip().strip("'\"")
        else:
            q_match = re.search(r"['\"]([^'\"\n]+)['\"]", user_prompt)
            doc_title = q_match.group(1).strip().strip("'\"") if q_match else "Sprint Specification"

        content_match = re.search(r"(?:with\s+(?:text|content|body|specs)|containing|saying|text\s+is)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        doc_content = content_match.group(1).strip().strip("'\"") if content_match else f"# {doc_title}\n\nDrafted by NexaMind Autonomous Copilot."
        doc_res = await execute_tool("create_document", {"title": doc_title, "content_text": doc_content}, db, workspace_id, user)
        tool_executions.append({"tool": "create_document", "args": {"title": doc_title}, "result": doc_res})

    # E. Tasks & Kanban (with Meeting to Action Items and Status support)
    if ("task" in prompt_lower or "todo" in prompt_lower or "kanban" in prompt_lower) and any(p in prompt_lower for p in ["create", "new", "add", "make", "assign"]):
        if any(m in prompt_lower for m in ["meeting", "action item", "session", "yesterday"]):
            search_res = await execute_tool("search_sessions", {"query": ""}, db, workspace_id, user)
            tool_executions.append({"tool": "search_sessions", "args": {"query": ""}, "result": search_res})
            sessions = search_res.get("sessions", [])
            if sessions:
                session_title = sessions[0].get("title", "Meeting")
                action_items = sessions[0].get("action_items", [])
                meeting_context_str = f"Found meeting **'{session_title}'** with {len(action_items)} action items."
                for item in action_items:
                    t_res = await execute_tool("create_task", {"title": item, "priority": "high"}, db, workspace_id, user)
                    tool_executions.append({"tool": "create_task", "args": {"title": item}, "result": t_res})
        else:
            quote_match = re.search(r"(?:task|titled|called)\s+['\"]([^'\"]+)['\"]", user_prompt, re.IGNORECASE)
            if quote_match:
                task_title = quote_match.group(1).strip()
            else:
                task_match = re.search(r"(?:task|titled|called)\s+['\"]?([^'\"\n,]+)['\"]?", user_prompt, re.IGNORECASE)
                task_title = task_match.group(1).strip() if task_match else "Review Sprint Deliverables"

            status = "in_progress" if "in progress" in prompt_lower or "doing" in prompt_lower else "done" if "done" in prompt_lower or "completed" in prompt_lower else "todo"
            priority = "urgent" if "urgent" in prompt_lower else "high" if "high" in prompt_lower else "medium"

            task_res = await execute_tool("create_task", {"title": task_title, "status": status, "priority": priority}, db, workspace_id, user)
            tool_executions.append({"tool": "create_task", "args": {"title": task_title, "status": status, "priority": priority}, "result": task_res})

    # F. Code Repository Creation
    if ("repo" in prompt_lower or "repository" in prompt_lower) and any(p in prompt_lower for p in ["create", "new", "add", "make"]):
        repo_match = re.search(r"(?:repo|repository)\s+(?:named\s+)?['\"]?([a-zA-Z0-9_\-]+)['\"]?", user_prompt, re.IGNORECASE)
        repo_name = repo_match.group(1).strip().strip("'\"") if repo_match else "core-gateway"
        r_res = await execute_tool("create_repo", {"name": repo_name, "description": "Automated code repository"}, db, workspace_id, user)
        tool_executions.append({"tool": "create_repo", "args": {"name": repo_name}, "result": r_res})

    # G. Channel Creation & Messaging
    if "channel" in prompt_lower and any(p in prompt_lower for p in ["create", "new", "add", "make"]) and not any(p in prompt_lower for p in ["send message", "post message", "chat to channel"]):
        chan_match = re.search(r"(?:channel)\s+(?:named\s+)?['\"]?#?([a-zA-Z0-9_\-]+)['\"]?", user_prompt, re.IGNORECASE)
        chan_name = chan_match.group(1).strip().strip("'\"") if chan_match else "team-announcements"
        c_res = await execute_tool("create_channel", {"name": chan_name}, db, workspace_id, user)
        tool_executions.append({"tool": "create_channel", "args": {"name": chan_name}, "result": c_res})

    if any(p in prompt_lower for p in ["send message", "post message", "chat to channel"]):
        post_match = re.search(r"(?:message|saying)\s+['\"]?([^'\"\n]+)['\"]?\s+(?:to|in)\s+(?:channel\s+)?#?([a-zA-Z0-9_\-]+)", user_prompt, re.IGNORECASE)
        msg_text = post_match.group(1).strip().strip("'\"") if post_match else "Team notification from NexaMind Agent"
        ch_target = post_match.group(2).strip() if post_match else "general"
        chan_lookup = await db.execute(select(Channel).where(Channel.workspace_id == workspace_id, Channel.name.ilike(ch_target)))
        chan_obj = chan_lookup.scalar_one_or_none()
        if not chan_obj:
            chan_any = await db.execute(select(Channel).where(Channel.workspace_id == workspace_id).limit(1))
            chan_obj = chan_any.scalar_one_or_none()
        if not chan_obj:
            c_res = await create_channel_tool(db, workspace_id, user, name=ch_target)
            chan_id = c_res.get("id")
            if chan_id:
                chan_obj = await db.get(Channel, UUID(chan_id))
        if chan_obj:
            p_res = await execute_tool("post_channel_message", {"channel_id": str(chan_obj.id), "content": msg_text}, db, workspace_id, user)
            tool_executions.append({"tool": "post_channel_message", "args": {"channel": ch_target, "content": msg_text}, "result": p_res})

    # H. Calendar & Event Scheduling
    if any(p in prompt_lower for p in ["schedule meeting", "schedule a meeting", "schedule event", "calendar", "set reminder", "book meeting"]):
        quotes_match = re.search(r"['\"]([^'\"]+)['\"]", user_prompt)
        if quotes_match:
            event_title = quotes_match.group(1).strip()
        else:
            event_match = re.search(r"(?:for|named|titled|meeting|about)\s+([a-zA-Z0-9_\-\s]+)", user_prompt, re.IGNORECASE)
            event_title = event_match.group(1).strip() if event_match else "Team Sync"
        target_date = (d_date.today() + timedelta(days=1)).isoformat()
        cal_res = await execute_tool("create_calendar_event", {"title": event_title, "event_date": target_date, "event_time": "03:00 PM"}, db, workspace_id, user)
        tool_executions.append({"tool": "create_calendar_event", "args": {"title": event_title, "event_date": target_date}, "result": cal_res})

    # I. Finance Logging & Runway Search
    if any(p in prompt_lower for p in ["expense", "income", "transaction"]) and any(p in prompt_lower for p in ["log", "add", "record", "create"]):
        amount_match = re.search(r"\$?([0-9]+(?:\.[0-9]{1,2})?)", user_prompt)
        amount = float(amount_match.group(1)) if amount_match else 500.0
        tx_type = "income" if "income" in prompt_lower else "expense"
        cat_match = re.search(r"(?:for|under|category)\s+([a-zA-Z0-9\s]+?)(?:\.|$)", user_prompt, re.IGNORECASE)
        cat = cat_match.group(1).strip() if cat_match else "Cloud Infrastructure"
        tx_res = await execute_tool("create_transaction", {"type": tx_type, "amount": amount, "category": cat}, db, workspace_id, user)
        tool_executions.append({"tool": "create_transaction", "args": {"type": tx_type, "amount": amount, "category": cat}, "result": tx_res})
    elif any(p in prompt_lower for p in ["runway", "burn rate", "balance", "how much money", "financial health", "cash"]):
        fin_res = await execute_tool("search_finance", {}, db, workspace_id, user)
        tool_executions.append({"tool": "search_finance", "args": {}, "result": fin_res})
        metrics = fin_res.get("metrics", {})
        cash = metrics.get("cash_balance", 0.0)
        burn = metrics.get("net_burn_rate", 0.0)
        runway = metrics.get("runway_months")
        runway_str = f"{runway} months" if runway is not None else "Profitable"
        finance_context_str = f"**Cash Balance:** ${cash:,.2f} | **Burn Rate:** ${burn:,.2f}/mo | **Runway:** {runway_str}"

    # J. Report Generation
    if any(p in prompt_lower for p in ["synthesize report", "generate report", "create report", "make report"]):
        rep_match = re.search(r"(?:report|named|titled)\s+[\"']?([^\"'\n]+)[\"']?", user_prompt, re.IGNORECASE)
        rep_title = rep_match.group(1).strip().strip("'\"") if rep_match else "Sprint Strategy Synthesis"
        rep_res = await execute_tool("generate_report", {"title": rep_title, "report_type": "sprint_summary"}, db, workspace_id, user)
        tool_executions.append({"tool": "generate_report", "args": {"title": rep_title}, "result": rep_res})

    # K. Direct Search Request
    if any(p in prompt_lower for p in ["search documents for", "find documents about", "lookup in docs"]):
        search_q_match = re.search(r"(?:search documents for|find documents about|lookup in docs)\s+(.+)", user_prompt, re.IGNORECASE)
        search_term = search_q_match.group(1).strip() if search_q_match else user_prompt
        search_res = await execute_tool("search_documents", {"query": search_term}, db, workspace_id, user)
        tool_executions.append({"tool": "search_documents", "args": {"query": search_term}, "result": search_res})

    executed_summary = []
    for t in tool_executions:
        tool_name = t["tool"]
        res = t["result"]
        msg = res.get("message") or res.get("message_detail") or f"Executed tool {tool_name}"
        executed_summary.append(f"- Tool `{tool_name}`: {msg}")

    # 6. Build Comprehensive Grounded Context for Gemini
    system_instruction = (
        f"You are the NexaMind Chief AI Officer (Agentic AI Copilot).\n"
        f"You operate an integrated workspace platform combining Notion Documents, Team Chat, Sprint Kanban Tasks, HD Video Meetings, and Persistent Long-Term Memory.\n\n"
        f"WORKSPACE CONTEXT:\n"
        f"- Current Workspace ID: {workspace_id}\n"
        f"- Current User: {user.name} (@{user.username or 'user'})\n"
        f"- Total Documents in Workspace: {len(all_workspace_docs)}\n\n"
        f"ALL WORKSPACE DOCUMENTS (Stored in active workspace database):\n"
        f"{docs_context_str}\n\n"
        f"LONG-TERM WORKSPACE MEMORY (Extracted facts, decisions, summaries, and action items):\n"
        f"{memory_context_str}\n\n"
        + (f"MEETING CONTEXT:\n{meeting_context_str}\n\n" if meeting_context_str else "")
        + (f"FINANCE CONTEXT:\n{finance_context_str}\n\n" if finance_context_str else "")
        + f"TOOLS EXECUTED FOR THIS TURN:\n"
        f"{chr(10).join(executed_summary) if executed_summary else 'No modification tools were needed; providing direct intelligence.'}\n\n"
        f"CRITICAL INSTRUCTIONS:\n"
        f"1. You MUST read and answer using the Workspace Documents and Long-Term Memory provided above.\n"
        f"2. If the user asks 'what is in the documents' or asks about any file or document, summarize EACH document clearly by title, detailing its content, status, and what was decided or recorded.\n"
        f"3. If any tools were executed (e.g. created task, created document, switched workspace), confirm the action clearly and professionally.\n"
        f"4. Maintain a high-impact, helpful, executive tone.\n"
        f"5. FORMATTING GUIDELINES:\n"
        f"   - Keep text clean, elegant, and readable without unnecessary cluttered symbols.\n"
        f"   - Avoid redundant markup like `### **Title**` or redundant nested asterisks like `* **Label:**`.\n"
        f"   - When writing mathematical or scientific formulas, ALWAYS enclose them in standard dollar signs: use $...$ for inline formulas (e.g. $E = mc^2$) and $$...$$ for block formulas (e.g. $$\\int_0^1 f(x) dx$$) so the frontend KaTeX engine converts and renders them into crisp mathematical notation.\n"
        f"   - Do not output raw unescaped LaTeX commands without math delimiters.\n"
        f"6. Propose concrete next steps whenever relevant."
    )

    final_response = None

    # A. Primary: Google Gemini API (gemini-3.8-flash)
    if gemini_key and len(gemini_key) > 10:
        final_response = await call_gemini(user_prompt, system_instruction, past_messages, gemini_key)

    # B. Secondary: Groq API fallback
    if not final_response and groq_key:
        final_response = await call_groq(user_prompt, system_instruction, past_messages, groq_key)

    # Attach meeting and finance contextual summaries if present
    if meeting_context_str and meeting_context_str not in (final_response or ""):
        final_response = f"{meeting_context_str}\n\n{final_response}" if final_response else meeting_context_str
    if finance_context_str and "Cash Balance" not in (final_response or ""):
        final_response = f"{finance_context_str}\n\n{final_response}" if final_response else finance_context_str

    # C. Fallback: Direct Grounded Synthesis from Documents and Memory
    if not final_response:
        if tool_executions:
            actions_list = "\n".join(
                f"✅ **{t['tool']}**: {t['result'].get('message', 'Completed successfully')}"
                for t in tool_executions
            )
            reply_sections = ["I have executed the requested actions in your workspace:"]
            if meeting_context_str:
                reply_sections.append(meeting_context_str)
            if finance_context_str:
                reply_sections.append(finance_context_str)
            reply_sections.append(actions_list)
            if docs_context_str and docs_context_str != "No documents created in this workspace yet.":
                reply_sections.append(f"**Workspace Documents Summary:**\n{docs_context_str[:400]}...")
            final_response = "\n\n".join(reply_sections)
        else:
            # High-quality direct document answer if Gemini is offline
            doc_summaries = []
            for d in all_workspace_docs:
                txt = extract_text_from_document(d)
                doc_summaries.append(f"📄 **{d.title}**: {txt[:180]}")

            docs_formatted = "\n\n".join(doc_summaries) if doc_summaries else "No documents found in this workspace yet."

            reply_parts = [
                f"### 📚 Workspace Documents & Memory Overview\n\nI scanned your workspace and found **{len(all_workspace_docs)} documents**:\n\n{docs_formatted}",
            ]
            if meeting_context_str:
                reply_parts.append(meeting_context_str)
            if finance_context_str:
                reply_parts.append(finance_context_str)
            reply_parts.append(
                f"**Relevant AI Long-Term Memory:**\n"
                f"{memory_context_str[:350]}...\n\n"
                f"You can ask me to read any document in detail, draft new specifications, or create tasks on your Kanban board."
            )
            final_response = "\n\n".join(reply_parts)

    # 7. Persist to Database (Session & Message)
    user_msg = AiMessage(
        session_id=ai_session.id,
        role="user",
        content=user_prompt,
    )
    db.add(user_msg)

    agent_msg = AiMessage(
        session_id=ai_session.id,
        role="assistant",
        content=response,
        tool_calls=ctx["log"],
        retrieved_memories=memories,
    ))
    stored_session = await db.get(AiSession, session_ref)
    if stored_session is not None:
        stored_session.updated_at = datetime.now()
    await db.commit()

    return {
        "session_id": str(session_ref),
        "session_title": session_title,
        "response": response,
        "tool_calls": ctx["log"],
        "retrieved_memories": memories,
    }
