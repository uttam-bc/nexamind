import json
import logging
import os
import re
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Channel, Document, User
from app.models.ai import AiMessage, AiSession
from app.services.agent_tools import (
    create_calendar_event_tool,
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
    switch_workspace_tool,
    update_task_status_tool,
)
from app.services.memory_engine import (
    extract_text_from_document,
    retrieve_memories,
    sync_all_workspace_documents_to_memory,
)

logger = logging.getLogger(__name__)
settings = get_settings()

GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
]


async def execute_tool(
    tool_name: str,
    tool_args: dict[str, Any],
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
) -> dict[str, Any]:
    """Executes an agent tool call against the workspace database and updates memory."""
    # 0. Workspace Switch
    if tool_name == "switch_workspace":
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

    payload = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.25,
            "maxOutputTokens": 2000,
        },
    }

    timeout_config = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=10.0)

    for model in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={clean_key}"
        try:
            async with httpx.AsyncClient(timeout=timeout_config) as client:
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
                    logger.warning("Gemini model %s returned status %d: %s", model, res.status_code, res.text[:200])
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

        timeout_config = httpx.Timeout(connect=10.0, read=25.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout_config) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.1-70b-versatile",
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

    # C. Document Editing / Appending
    is_doc_edit = (
        any(w in prompt_lower for w in ["doc", "document", "file", "notes"])
        and any(p in prompt_lower for p in ["edit", "update", "append", "modify", "add to"])
    )
    if is_doc_edit:
        doc_target_match = re.search(r"(?:doc|document|file)\s+['\"]?([^'\"\n]+?)['\"]?(?:\s+with|\s+to|$)", user_prompt, re.IGNORECASE)
        doc_target = doc_target_match.group(1).strip() if doc_target_match else "notes.txt"
        edit_text_match = re.search(r"(?:with|add|text)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        edit_text = edit_text_match.group(1).strip() if edit_text_match else "Updated by NexaMind AI Copilot."
        edit_res = await execute_tool("edit_document", {"doc_query": doc_target, "new_content_text": edit_text, "mode": "append"}, db, workspace_id, user)
        tool_executions.append({"tool": "edit_document", "args": {"doc_query": doc_target}, "result": edit_res})

    # D. Task Creation (with Status support: To Do, In Progress, Done!)
    if ("task" in prompt_lower or "todo" in prompt_lower or "kanban" in prompt_lower) and any(p in prompt_lower for p in ["create", "new", "add", "make", "assign"]):
        task_match = re.search(r"(?:task|titled|called)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        task_title = task_match.group(1).strip() if task_match else "Review Sprint Deliverables"

        status = "in_progress" if "in progress" in prompt_lower or "doing" in prompt_lower else "done" if "done" in prompt_lower or "completed" in prompt_lower else "todo"
        priority = "urgent" if "urgent" in prompt_lower else "high" if "high" in prompt_lower else "medium"

        task_res = await execute_tool("create_task", {"title": task_title, "status": status, "priority": priority}, db, workspace_id, user)
        tool_executions.append({"tool": "create_task", "args": {"title": task_title, "status": status, "priority": priority}, "result": task_res})

    # E. Channel / Message Creation
    if "channel" in prompt_lower and any(p in prompt_lower for p in ["create", "new", "add", "make"]):
        chan_match = re.search(r"(?:channel)\s+(?:named\s+)?['\"]?#?([a-zA-Z0-9_\-]+)['\"]?", user_prompt, re.IGNORECASE)
        chan_name = chan_match.group(1).strip() if chan_match else "team-announcements"
        c_res = await execute_tool("create_channel", {"name": chan_name}, db, workspace_id, user)
        tool_executions.append({"tool": "create_channel", "args": {"name": chan_name}, "result": c_res})
    elif any(p in prompt_lower for p in ["send message", "post message", "chat to channel"]):
        post_match = re.search(r"(?:message|saying)\s+['\"]?([^'\"\n]+)['\"]?\s+(?:to|in)\s+#?([a-zA-Z0-9_\-]+)", user_prompt, re.IGNORECASE)
        msg_text = post_match.group(1).strip() if post_match else "Team notification from NexaMind Agent"
        ch_target = post_match.group(2).strip() if post_match else "general"
        chan_lookup = await db.execute(select(Channel).where(Channel.workspace_id == workspace_id, Channel.name == ch_target))
        chan_obj = chan_lookup.scalar_one_or_none()
        if chan_obj:
            p_res = await execute_tool("post_channel_message", {"channel_id": str(chan_obj.id), "content": msg_text}, db, workspace_id, user)
            tool_executions.append({"tool": "post_channel_message", "args": {"channel": ch_target, "content": msg_text}, "result": p_res})

    # F. Direct Search Request
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
        f"TOOLS EXECUTED FOR THIS TURN:\n"
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

    # C. Fallback: Direct Grounded Synthesis from Documents and Memory
    if not final_response:
        if tool_executions:
            actions_list = "\n".join(
                f"✅ **{t['tool']}**: {t['result'].get('message', 'Completed successfully')}"
                for t in tool_executions
            )
            final_response = (
                f"I have executed the requested actions in your workspace:\n\n"
                f"{actions_list}\n\n"
                f"**Workspace Documents Summary:**\n"
                f"{docs_context_str[:400]}..."
            )
        else:
            # High-quality direct document answer if Gemini is offline
            doc_summaries = []
            for d in all_workspace_docs:
                txt = extract_text_from_document(d)
                doc_summaries.append(f"📄 **{d.title}**: {txt[:180]}")

            docs_formatted = "\n\n".join(doc_summaries) if doc_summaries else "No documents found in this workspace yet."

            final_response = (
                f"### 📚 Workspace Documents & Memory Overview\n\n"
                f"I scanned your workspace and found **{len(all_workspace_docs)} documents**:\n\n"
                f"{docs_formatted}\n\n"
                f"**Relevant AI Long-Term Memory:**\n"
                f"{memory_context_str[:350]}...\n\n"
                f"You can ask me to read any document in detail, draft new specifications, or create tasks on your Kanban board."
            )

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
