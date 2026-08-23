import json
import logging
import os
import re
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Document, SessionRecord, Task, Channel, User
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

logger = logging.getLogger(__name__)
settings = get_settings()


async def execute_tool(
    tool_name: str,
    tool_args: dict,
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
) -> dict:
    """Executes an agent tool call against the workspace database."""
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
        return await create_document_tool(
            db,
            workspace_id,
            user,
            title=tool_args.get("title", "Untitled Document"),
            content_text=tool_args.get("content_text", ""),
        )
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
        return await create_task_tool(
            db,
            workspace_id,
            user,
            title=tool_args.get("title", "Untitled Task"),
            description=tool_args.get("description"),
            status=tool_args.get("status", "todo"),
            priority=tool_args.get("priority", "medium"),
        )
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


async def run_agent(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    user_prompt: str,
) -> dict:
    """Orchestrates an omni-agentic session: multi-step reasoning, tool execution, and rich response synthesis."""
    prompt_clean = user_prompt.strip()
    prompt_lower = prompt_clean.lower()
    tool_executions: list[dict] = []
    groq_key = os.getenv("GROQ_API_KEY")
    meeting_context_str = ""
    finance_context_str = ""
    extra_context_str = ""

    # -----------------------------------------------------------------
    # Step A: Autonomous Intent Recognition & Tool Execution
    # 0. Workspace Switching Action
    # Matches: "switch to group X", "switch to solo", "go to personal space", "open group workspace"
    is_ws_switch = any(p in prompt_lower for p in ["switch to", "switch workspace", "go to workspace", "go to group", "go to solo", "open group", "open solo", "switch account"])
    if is_ws_switch:
        target_match = re.search(r"(?:switch to|switch workspace to|go to|open)\s+([a-zA-Z0-9_\-\s]+)", user_prompt, re.IGNORECASE)
        target_q = target_match.group(1).strip() if target_match else "solo"
        sw_res = await execute_tool("switch_workspace", {"target": target_q}, db, workspace_id, user)
        tool_executions.append({"tool": "switch_workspace", "args": {"target": target_q}, "result": sw_res})

    # 1. Document / File Creation & Drafting
    # Matches: "create a file ... with text ...", "create document ...", "make a file ... in txt format"
    is_doc_create = (
        any(w in prompt_lower for w in ["doc", "document", "spec", "file", "txt", "notes", "markdown"])
        and any(p in prompt_lower for p in ["create", "write", "new", "draft", "author", "make", "generate", "build"])
        and not any(e in prompt_lower for e in ["edit", "update", "modify", "append", "add to"])
        and not is_ws_switch
    )
    if is_doc_create:
        named_match = re.search(r"(?:named|titled|called)\s+['\"]?([^'\"\n]+?)['\"]?(?:\s+with|\s+containing|$)", user_prompt, re.IGNORECASE)
        if named_match:
            title = named_match.group(1).strip()
        else:
            file_match = re.search(r"(?:file|document|doc)\s+['\"]?([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+)['\"]?", user_prompt, re.IGNORECASE)
            if file_match:
                title = file_match.group(1).strip()
            else:
                quotes_match = re.search(r"['\"]([^'\"]+)['\"]", user_prompt)
                if quotes_match:
                    title = quotes_match.group(1).strip()
                else:
                    title = "notes.txt" if "txt" in prompt_lower else "project_spec.md"

        content_match = re.search(r"(?:with\s+(?:text|content|body)|containing|saying|text\s+is)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        if content_match and content_match.group(1).strip() != title:
            content_text = content_match.group(1).strip()
        else:
            content_text = f"# {title}\n\nDocument authored autonomously by NexaMind AI Copilot based on command: '{user_prompt}'."

        doc_res = await execute_tool("create_document", {"title": title, "content_text": content_text}, db, workspace_id, user)
        tool_executions.append({"tool": "create_document", "args": {"title": title, "content_text": content_text}, "result": doc_res})

    # 2. Document / File Editing & Appending
    # Matches: "edit document X and add Y", "edit the file X", "update file X", "append to file X"
    is_doc_edit = any(p in prompt_lower for p in ["edit", "update", "append", "modify", "add section", "add to"]) and any(w in prompt_lower for w in ["doc", "document", "spec", "file", "notes", "text"])
    if is_doc_edit and not is_ws_switch:
        # Extract target document
        target_match = re.search(r"(?:document|file|doc|in|to)\s+['\"]?([a-zA-Z0-9_\-\.]+)", user_prompt, re.IGNORECASE)
        if target_match:
            doc_target = target_match.group(1).strip()
        else:
            quotes_match = re.search(r"['\"]([^'\"]+)['\"]", user_prompt)
            doc_target = quotes_match.group(1).strip() if quotes_match else ""

        # Extract text to add
        add_text_match = re.search(r"(?:(?:add|with|text|section|saying))\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        new_text = add_text_match.group(1).strip() if add_text_match and add_text_match.group(1) != doc_target else f"Updated content added by AI on command: {user_prompt}"

        # If doc_target is empty or generic, grab the most recent document
        if not doc_target or doc_target.lower() in ["the", "this", "file", "document", "doc"]:
            res = await db.execute(select(Document).where(Document.workspace_id == workspace_id).order_by(Document.updated_at.desc()).limit(1))
            latest_doc = res.scalar_one_or_none()
            doc_target = latest_doc.title if latest_doc else "Project Notes"

        edit_res = await execute_tool("edit_document", {"doc_query": doc_target, "new_content_text": new_text, "mode": "append"}, db, workspace_id, user)
        tool_executions.append({"tool": "edit_document", "args": {"doc_query": doc_target, "new_content_text": new_text}, "result": edit_res})

    # 3. Inter-Channel & Group Messaging
    # Matches: "send message X to channel Y", "send it to general group", "post in channel general"
    is_send_msg = (
        (any(w in prompt_lower for w in ["send", "post", "share", "forward", "broadcast"]))
        and (any(w in prompt_lower for w in ["channel", "group", "team", "chat", "general"]))
        and not any(p in prompt_lower for p in ["create a channel", "create channel", "new channel", "make a channel", "add channel", "add a channel"])
        and not is_ws_switch
    )
    if is_send_msg:
        chan_match = re.search(r"(?:to|in)\s+(?:channel\s+|group\s+)?#?([a-zA-Z0-9_\-]+)", user_prompt, re.IGNORECASE)
        chan_name = chan_match.group(1).strip() if chan_match else "general"

        msg_match = re.search(r"(?:message|text|content|saying)\s+['\"]?([^'\"\n]+)['\"]?", user_prompt, re.IGNORECASE)
        if msg_match and msg_match.group(1) != chan_name:
            msg_content = msg_match.group(1).strip()
        else:
            # Check if user says "send it" or "send this document"
            res = await db.execute(select(Document).where(Document.workspace_id == workspace_id).order_by(Document.updated_at.desc()).limit(1))
            latest_doc = res.scalar_one_or_none()
            if latest_doc:
                msg_content = f"📄 **Shared Document: {latest_doc.title}**\n\nContent shared autonomously by AI Copilot."
            else:
                msg_content = f"📢 Shared by AI Copilot: {user_prompt}"

        # Resolve or create channel
        c_res = await execute_tool("create_channel", {"name": chan_name}, db, workspace_id, user)
        chan_id = c_res.get("id")
        if chan_id:
            p_res = await execute_tool("post_channel_message", {"channel_id": chan_id, "content": msg_content}, db, workspace_id, user)
            tool_executions.append({"tool": "post_channel_message", "args": {"channel_id": chan_id, "channel_name": chan_name, "content": msg_content}, "result": p_res})

    # 4. Read / Query Document Content (Including across Group Workspaces)
    # Matches: "access the file in that group's file", "read document X", "what is in file X", "show document X"
    is_read_doc = any(p in prompt_lower for p in ["read", "what is in", "show", "summarize", "open", "display", "access", "get"]) and any(w in prompt_lower for w in ["doc", "document", "spec", "file", "notes"])
    if is_read_doc and not is_doc_create and not is_doc_edit and not is_ws_switch:
        quotes_match = re.search(r"['\"]([^'\"]+)['\"]", user_prompt)
        doc_query = quotes_match.group(1).strip() if quotes_match else ""
        if not doc_query:
            target_match = re.search(r"(?:document|file|doc|notes)\s+([a-zA-Z0-9_\-\.]+)", user_prompt, re.IGNORECASE)
            doc_query = target_match.group(1).strip() if target_match else ""

        # Check if user mentioned a specific group
        group_match = re.search(r"(?:in|from)\s+(?:group|workspace)\s+([a-zA-Z0-9_\-\s]+)", user_prompt, re.IGNORECASE)
        target_group = group_match.group(1).strip() if group_match else None
        
        get_res = await execute_tool("get_document", {"doc_query": doc_query, "target_group": target_group}, db, workspace_id, user)
        tool_executions.append({"tool": "get_document", "args": {"doc_query": doc_query, "target_group": target_group}, "result": get_res})
        if "content" in get_res:
            source_info = f" (from Group '{get_res.get('workspace_name')}')" if get_res.get("workspace_name") else ""
            extra_context_str += f"\n**Document Content for '{get_res.get('title')}'{source_info}:**\n{get_res.get('content')[:1000]}\n"

    # 5. Kanban Task Creation & Management
    if "task" in prompt_lower and any(p in prompt_lower for p in ["create", "add", "new", "make", "assign"]):
        if any(m in prompt_lower for m in ["meeting", "action item", "session"]):
            search_res = await execute_tool("search_sessions", {"query": ""}, db, workspace_id, user)
            tool_executions.append({"tool": "search_sessions", "args": {"query": ""}, "result": search_res})
            sessions = search_res.get("sessions", [])
            if sessions:
                session_title = sessions[0].get("title", "Meeting")
                meeting_context_str = f"Found meeting **'{session_title}'** with {len(sessions[0].get('action_items', []))} action items."
                for item in sessions[0].get("action_items", []):
                    t_res = await execute_tool("create_task", {"title": item, "priority": "high"}, db, workspace_id, user)
                    tool_executions.append({"tool": "create_task", "args": {"title": item}, "result": t_res})
        else:
            quotes_match = re.search(r"['\"]([^'\"]+)['\"]", user_prompt)
            if quotes_match:
                task_title = quotes_match.group(1).strip()
            else:
                task_match = re.search(r"(?:task|to|titled)\s+([a-zA-Z0-9_\-\s]+)", user_prompt, re.IGNORECASE)
                task_title = task_match.group(1).strip() if task_match else "Review Sprint Deliverables"
            priority = "urgent" if "urgent" in prompt_lower else "high" if "high" in prompt_lower else "medium"
            task_res = await execute_tool("create_task", {"title": task_title, "priority": priority}, db, workspace_id, user)
            tool_executions.append({"tool": "create_task", "args": {"title": task_title, "priority": priority}, "result": task_res})

    # 6. Calendar Event & Reminder Scheduling
    if any(p in prompt_lower for p in ["calendar", "schedule meeting", "add reminder", "set reminder", "schedule event", "schedule a", "remind me"]):
        from datetime import date as d_date, timedelta
        quotes_match = re.search(r"['\"]([^'\"]+)['\"]", user_prompt)
        if quotes_match:
            event_title = quotes_match.group(1).strip()
        else:
            event_match = re.search(r"(?:for|named|titled|meeting|about)\s+([a-zA-Z0-9_\-\s]+)", user_prompt, re.IGNORECASE)
            event_title = event_match.group(1).strip() if event_match else "Team Sync"
        target_date = (d_date.today() + timedelta(days=1)).isoformat()
        cal_res = await execute_tool("create_calendar_event", {"title": event_title, "event_date": target_date, "event_time": "02:00 PM"}, db, workspace_id, user)
        tool_executions.append({"tool": "create_calendar_event", "args": {"title": event_title, "event_date": target_date}, "result": cal_res})

    # 7. Code Repository Creation
    if ("repo" in prompt_lower or "repository" in prompt_lower) and any(p in prompt_lower for p in ["create", "new", "add", "make"]):
        repo_match = re.search(r"(?:repo|repository)\s+(?:named\s+)?['\"]?([a-zA-Z0-9_\-]+)['\"]?", user_prompt, re.IGNORECASE)
        repo_name = repo_match.group(1).strip() if repo_match else "core-gateway"
        r_res = await execute_tool("create_repo", {"name": repo_name, "description": "Automated code repository"}, db, workspace_id, user)
        tool_executions.append({"tool": "create_repo", "args": {"name": repo_name}, "result": r_res})

    # 8. Channel Creation
    if "channel" in prompt_lower and any(p in prompt_lower for p in ["create", "new", "add", "make"]):
        chan_match = re.search(r"(?:channel)\s+(?:named\s+)?['\"]?#?([a-zA-Z0-9_\-]+)['\"]?", user_prompt, re.IGNORECASE)
        chan_name = chan_match.group(1).strip() if chan_match else "team-announcements"
        c_res = await execute_tool("create_channel", {"name": chan_name}, db, workspace_id, user)
        tool_executions.append({"tool": "create_channel", "args": {"name": chan_name}, "result": c_res})

    # 9. Report Generation
    if any(p in prompt_lower for p in ["synthesize report", "generate report", "create report", "make report"]):
        rep_match = re.search(r"(?:report|named|titled)\s+[\"']?([^\"'\n]+)[\"']?", user_prompt, re.IGNORECASE)
        rep_title = rep_match.group(1).strip() if rep_match else "Sprint Strategy Synthesis"
        rep_res = await execute_tool("generate_report", {"title": rep_title, "report_type": "sprint_summary"}, db, workspace_id, user)
        tool_executions.append({"tool": "generate_report", "args": {"title": rep_title}, "result": rep_res})

    # 10. Finance Logging & Search
    if any(p in prompt_lower for p in ["expense", "income", "transaction"]) and any(p in prompt_lower for p in ["log", "add", "record", "create"]):
        amount_match = re.search(r"\$?([0-9]+(?:\.[0-9]{1,2})?)", user_prompt)
        amount = float(amount_match.group(1)) if amount_match else 500.0
        tx_type = "income" if "income" in prompt_lower else "expense"
        cat_match = re.search(r"(?:for|under|category)\s+([a-zA-Z0-9\s]+)", user_prompt, re.IGNORECASE)
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

    # -----------------------------------------------------------------
    # Step B: LLM Synthesis with Groq / Gemini
    # -----------------------------------------------------------------
    if groq_key:
        try:
            executed_summary = []
            for t in tool_executions:
                tool_name = t["tool"]
                result = t["result"]
                msg = result.get("message") or result.get("message_detail") or f"Executed {tool_name}"
                executed_summary.append(f"- Tool `{tool_name}`: {msg}")

            system_instruction = (
                f"You are NexaMind Omni-Agent (Chief AI Officer), an autonomous AI agent with complete control over the workspace.\n"
                f"Workspace ID: {workspace_id}\n"
                f"{meeting_context_str}\n"
                f"{finance_context_str}\n"
                f"{extra_context_str}\n"
                f"You have just executed the following tools on behalf of the user:\n"
                f"{chr(10).join(executed_summary) if executed_summary else 'No tools needed for this direct answer.'}\n\n"
                f"Provide a clear, professional, executive debrief summarizing exactly what you completed and suggest next steps."
            )

            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [
                            {"role": "system", "content": system_instruction},
                            {"role": "user", "content": user_prompt},
                        ],
                        "temperature": 0.3,
                        "max_tokens": 600,
                    },
                )
                if res.status_code == 200:
                    answer = res.json()["choices"][0]["message"]["content"].strip()
                    if meeting_context_str and meeting_context_str not in answer:
                        answer = f"{meeting_context_str}\n\n{answer}"
                    if finance_context_str and "Cash Balance" not in answer:
                        answer = f"{finance_context_str}\n\n{answer}"
                    return {"response": answer, "tool_calls": tool_executions}
        except Exception as exc:
            logger.error("Groq omni-agent execution error: %s", exc)

    # -----------------------------------------------------------------
    # Step C: Fallback Deterministic Response
    # -----------------------------------------------------------------
    if tool_executions:
        actions_done = "\n".join(
            f"✅ **{t['tool']}**: {t['result'].get('message', 'Completed successfully')}"
            for t in tool_executions
        )
        reply_parts = [
            "I have autonomously executed the requested actions for your workspace:",
            meeting_context_str,
            finance_context_str,
            extra_context_str,
            actions_done,
            "All changes are saved to Supabase and live across your team.",
        ]
        reply = "\n\n".join(p for p in reply_parts if p.strip())
    else:
        doc_res = await execute_tool("search_documents", {"query": ""}, db, workspace_id, user)
        tool_executions.append({"tool": "search_documents", "args": {"query": ""}, "result": doc_res})
        reply = (
            f"Hello! I am your **NexaMind Autonomous Omni-Agent**.\n"
            f"I have direct control over your workspace code repositories, documents & files, Kanban sprint tasks, "
            f"meetings, financials, channels, and calendar.\n\n"
            f"Give me any command (e.g. *'Create a file named api.txt with text Hello World'*, *'Edit document notes.txt and add Redis section'*, *'Send message Welcome to channel general'*), "
            f"and I will execute it end-to-end."
        )

    return {"response": reply, "tool_calls": tool_executions}
