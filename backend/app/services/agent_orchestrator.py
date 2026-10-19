import json
import logging
import os
import re
from uuid import UUID
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Document, SessionRecord, Task, Channel, User
from app.models.ai import AiSession, AiMessage, AiMemory
from app.services.agent_tools import (
    AVAILABLE_TOOLS,
    create_channel_tool,
    create_commit_tool,
    create_document_tool,
    create_issue_tool,
    create_repo_tool,
    create_task_tool,
    create_transaction_tool,
    edit_document_tool,
    generate_report_tool,
    get_document_tool,
    post_channel_message_tool,
    search_documents_tool,
    search_finance_tool,
    search_sessions_tool,
    update_task_status_tool,
)
from app.services.memory_engine import retrieve_memories, ingest_document, ingest_task

logger = logging.getLogger(__name__)
settings = get_settings()


async def execute_tool(
    tool_name: str,
    tool_args: dict,
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
) -> dict:
    """Executes an agent tool call against the workspace database and updates memory."""
    # 0. Workspace Switch
    if tool_name == "switch_workspace":
        from app.services.agent_tools import switch_workspace_tool
        return await switch_workspace_tool(
            db,
            user,
            target_query=tool_args.get("target", "solo"),
        )

    # 1. Documents
    elif tool_name == "create_document":
        res = await create_document_tool(
            db,
            workspace_id,
            user,
            title=tool_args.get("title", "Untitled Document"),
            content_text=tool_args.get("content_text", ""),
        )
        return res
    elif tool_name == "edit_document":
        return await edit_document_tool(
            db,
            workspace_id,
            user,
            doc_query=tool_args.get("doc_query", "Untitled Document"),
            new_content_text=tool_args.get("new_content_text", ""),
            mode=tool_args.get("mode", "append"),
        )
    elif tool_name == "get_document":
        return await get_document_tool(
            db,
            workspace_id,
            doc_query=tool_args.get("doc_query", ""),
            user=user,
            target_group=tool_args.get("target_group"),
        )
    elif tool_name == "search_documents":
        docs = await search_documents_tool(
            db,
            workspace_id,
            tool_args.get("query", ""),
            user=user,
            search_all_groups=tool_args.get("search_all_groups", False),
        )
        return {"documents": docs, "count": len(docs)}

    # 2. Meetings & Sessions
    elif tool_name == "search_sessions":
        sessions = await search_sessions_tool(db, workspace_id, tool_args.get("query", ""))
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
            branch=tool_args.get("branch", "main"),
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
        from app.services.agent_tools import create_calendar_event_tool
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
    models_to_try = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"]

    # Format history turns for Gemini
    contents = []
    for turn in history[-10:]:
        role = "user" if turn.get("role") == "user" else "model"
        text = turn.get("content", "").strip()
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})

    # Add current user prompt
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    payload = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1500,
        },
    }

    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        if text:
                            logger.info("Gemini (%s) response generated successfully (%d chars)", model, len(text))
                            return text.strip()
                else:
                    logger.warning("Gemini model %s returned status %d: %s", model, res.status_code, res.text)
        except Exception as exc:
            logger.warning("Gemini invocation error on %s: %s", model, exc)
            continue

    return None


async def call_groq(
    prompt: str,
    system_instruction: str,
    history: list[dict],
    groq_key: str,
) -> str | None:
    """Backup LLM inference via Groq."""
    try:
        messages = [{"role": "system", "content": system_instruction}]
        for turn in history[-8:]:
            messages.append({
                "role": "user" if turn.get("role") == "user" else "assistant",
                "content": turn.get("content", ""),
            })
        messages.append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=25.0) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": 1000,
                },
            )
            if res.status_code == 200:
                return res.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("Groq fallback exception: %s", exc)
    return None


async def run_agent(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    user_prompt: str,
    session_id: UUID | None = None,
    gemini_key_override: str | None = None,
) -> dict:
    """Orchestrates the NexaMind Agentic AI:
    1. AI Session & History Loading
    2. Long-term Memory Retrieval (Docs, Chat, Tasks, Video Meetings)
    3. Tool Recognition & Autonomous Execution
    4. Gemini Reasoning & Synthesis
    5. Session Persistence & Memory Feedback
    """
    prompt_clean = user_prompt.strip()
    prompt_lower = prompt_clean.lower()
    tool_executions: list[dict] = []

    # 1. Resolve or Create AI Session
    ai_session: AiSession | None = None
    past_messages: list[dict] = []

    if session_id:
        sess_q = select(AiSession).where(
            AiSession.id == session_id,
            AiSession.workspace_id == workspace_id,
        )
        sess_res = await db.execute(sess_q)
        ai_session = sess_res.scalar_one_or_none()

    if not ai_session:
        # Create new chat session for this user
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
        # Fetch conversation history for this session
        msgs_q = (
            select(AiMessage)
            .where(AiMessage.session_id == ai_session.id)
            .order_by(AiMessage.created_at.asc())
            .limit(20)
        )
        msgs_res = await db.execute(msgs_q)
        for m in msgs_res.scalars().all():
            past_messages.append({"role": m.role, "content": m.content})

    # 2. Retrieve Long-Term AI Memory (Docs, Chat, Tasks, Video Meetings)
    retrieved_mems = await retrieve_memories(db, workspace_id, user_prompt, limit=6)
    memory_context_lines = []
    for m in retrieved_mems:
        source_label = m.get("source_title") or m.get("source_type")
        memory_context_lines.append(f"- [{m.get('memory_type', 'fact').upper()} from {source_label}]: {m.get('title')} — {m.get('content')}")

    memory_context_str = "\n".join(memory_context_lines) if memory_context_lines else "No specific past memory matched."

    # 3. Autonomous Tool Execution Pattern Matching
    # A. Workspace Switch
    is_ws_switch = any(p in prompt_lower for p in ["switch to", "switch workspace", "go to workspace", "go to group", "go to solo", "open group", "open solo", "switch account"])
    if is_ws_switch:
        target_match = re.search(r"(?:switch to|switch workspace to|go to|open)\s+([a-zA-Z0-9_\-\s]+)", user_prompt, re.IGNORECASE)
        target_q = target_match.group(1).strip() if target_match else "solo"
        sw_res = await execute_tool("switch_workspace", {"target": target_q}, db, workspace_id, user)
        tool_executions.append({"tool": "switch_workspace", "args": {"target": target_q}, "result": sw_res})

    # B. Document / File Creation
    is_doc_create = (
        any(w in prompt_lower for w in ["doc", "document", "spec", "file", "notes", "markdown"])
        and any(p in prompt_lower for p in ["create", "write", "new", "draft", "author", "make", "generate", "build"])
        and not any(e in prompt_lower for e in ["edit", "update", "modify", "append", "add to"])
        and not is_ws_switch
    )
    if is_doc_create:
        named_match = re.search(r"(?:named|titled|called)\s+['\"]?([^'\"\n]+?)['\"]?(?:\s+with|\s+containing|$)", user_prompt, re.IGNORECASE)
        if named_match:
            doc_title = named_match.group(1).strip()
        else:
            doc_title = "Sprint Specification"

        content_match = re.search(r"(?:with\s+(?:text|content|body)|containing|saying|text\s+is)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        doc_content = content_match.group(1).strip() if content_match else f"# {doc_title}\n\nDrafted by NexaMind Autonomous Copilot."
        doc_res = await execute_tool("create_document", {"title": doc_title, "content_text": doc_content}, db, workspace_id, user)
        tool_executions.append({"tool": "create_document", "args": {"title": doc_title}, "result": doc_res})

    # C. Task Creation (with Status support: To Do, In Progress, Done!)
    if ("task" in prompt_lower or "todo" in prompt_lower or "kanban" in prompt_lower) and any(p in prompt_lower for p in ["create", "new", "add", "make", "assign"]):
        task_match = re.search(r"(?:task|titled|called)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        task_title = task_match.group(1).strip() if task_match else "Review Sprint Deliverables"

        status = "in_progress" if "in progress" in prompt_lower or "doing" in prompt_lower else "done" if "done" in prompt_lower or "completed" in prompt_lower else "todo"
        priority = "urgent" if "urgent" in prompt_lower else "high" if "high" in prompt_lower else "medium"

        task_res = await execute_tool("create_task", {"title": task_title, "status": status, "priority": priority}, db, workspace_id, user)
        tool_executions.append({"tool": "create_task", "args": {"title": task_title, "status": status, "priority": priority}, "result": task_res})

    # D. Channel / Message Creation
    if "channel" in prompt_lower and any(p in prompt_lower for p in ["create", "new", "add", "make"]):
        chan_match = re.search(r"(?:channel)\s+(?:named\s+)?['\"]?#?([a-zA-Z0-9_\-]+)['\"]?", user_prompt, re.IGNORECASE)
        chan_name = chan_match.group(1).strip() if chan_match else "team-announcements"
        c_res = await execute_tool("create_channel", {"name": chan_name}, db, workspace_id, user)
        tool_executions.append({"tool": "create_channel", "args": {"name": chan_name}, "result": c_res})
    elif any(p in prompt_lower for p in ["send message", "post message", "chat to channel"]):
        post_match = re.search(r"(?:message|saying)\s+['\"]?([^'\"\n]+)['\"]?\s+(?:to|in)\s+#?([a-zA-Z0-9_\-]+)", user_prompt, re.IGNORECASE)
        msg_text = post_match.group(1).strip() if post_match else "Team notification from NexaMind Agent"
        ch_target = post_match.group(2).strip() if post_match else "general"
        # Find channel by name
        chan_lookup = await db.execute(select(Channel).where(Channel.workspace_id == workspace_id, Channel.name == ch_target))
        chan_obj = chan_lookup.scalar_one_or_none()
        if chan_obj:
            p_res = await execute_tool("post_channel_message", {"channel_id": str(chan_obj.id), "content": msg_text}, db, workspace_id, user)
            tool_executions.append({"tool": "post_channel_message", "args": {"channel": ch_target, "content": msg_text}, "result": p_res})

    # E. Search Workspace Memory / Docs / Meetings
    if any(p in prompt_lower for p in ["search", "find", "what did we discuss", "check documents", "summarize"]):
        search_res = await execute_tool("search_documents", {"query": user_prompt}, db, workspace_id, user)
        tool_executions.append({"tool": "search_documents", "args": {"query": user_prompt}, "result": search_res})

    # 4. LLM Synthesis with Gemini / Backup
    gemini_key = gemini_override = gemini_key_override or os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    executed_summary = []
    for t in tool_executions:
        tool_name = t["tool"]
        res = t["result"]
        msg = res.get("message") or res.get("message_detail") or f"Executed tool {tool_name}"
        executed_summary.append(f"- Tool `{tool_name}`: {msg}")

    system_instruction = (
        f"You are the NexaMind Chief AI Officer (Agentic AI Copilot).\n"
        f"You operate an integrated workspace platform combining Notion Documents, Microsoft Teams-style Chat, Sprint Kanban Tasks, HD Video Meetings, and Long-Term Memory.\n\n"
        f"WORKSPACE CONTEXT:\n"
        f"- Current Workspace ID: {workspace_id}\n"
        f"- Current User: {user.name} (@{user.username or 'user'})\n\n"
        f"LONG-TERM WORKSPACE MEMORY (Ingested & Consolidated from Docs, Chat, Tasks, Video Meetings):\n"
        f"{memory_context_str}\n\n"
        f"TOOLS EXECUTED FOR THIS REQUEST:\n"
        f"{chr(10).join(executed_summary) if executed_summary else 'No modification tools were needed; providing direct intelligence.'}\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Acknowledge and summarize any actions executed clearly and professionally.\n"
        f"2. Incorporate insights from the retrieved workspace memories whenever relevant to the user's question.\n"
        f"3. Maintain conversational continuity with past dialogue.\n"
        f"4. Propose actionable, concrete next steps for the engineering team."
    )

    final_response = None

    # A. Primary: Google Gemini API
    if gemini_key and not gemini_key.startswith("AQ.") and len(gemini_key) > 20:
        final_response = await call_gemini(user_prompt, system_instruction, past_messages, gemini_key)

    # B. Secondary: Groq API
    if not final_response and groq_key:
        final_response = await call_groq(user_prompt, system_instruction, past_messages, groq_key)

    # C. Fallback: High-quality Deterministic Synthesis
    if not final_response:
        if tool_executions:
            actions_list = "\n".join(
                f"✅ **{t['tool']}**: {t['result'].get('message', 'Completed successfully')}"
                for t in tool_executions
            )
            final_response = (
                f"I have autonomously executed the requested actions in your workspace:\n\n"
                f"{actions_list}\n\n"
                f"**Workspace Memory Reference:**\n"
                f"{memory_context_str[:250]}...\n\n"
                f"*To enable full Gemini multimodal intelligence, configure your `GEMINI_API_KEY` in Workspace Settings.*"
            )
        else:
            final_response = (
                f"Hello {user.name}! I am your **NexaMind Agentic AI Copilot**.\n\n"
                f"I have persistent session memory and 4-stage workspace memory ingestion connected to your **Documents**, **Team Chats**, **Sprint Tasks**, and **Video Call Minutes**.\n\n"
                f"**Relevant Workspace Memories:**\n"
                f"{memory_context_str}\n\n"
                f"Give me any command (e.g., *'Create a task to build auth with status in_progress'*, *'Draft document API_Architecture.md'*, *'What decisions were agreed in yesterday's meeting?'*), and I will take action."
            )

    # 5. Persist to Database (Session & Message)
    user_msg = AiMessage(
        session_id=ai_session.id,
        role="user",
        content=user_prompt,
    )
    db.add(user_msg)

    agent_msg = AiMessage(
        session_id=ai_session.id,
        role="assistant",
        content=final_response,
        tool_calls=tool_executions,
        retrieved_memories=retrieved_mems,
    )
    db.add(agent_msg)
    ai_session.updated_at = datetime.now()
    await db.commit()

    return {
        "session_id": str(ai_session.id),
        "session_title": ai_session.title,
        "response": final_response,
        "tool_calls": tool_executions,
        "retrieved_memories": retrieved_mems,
    }
