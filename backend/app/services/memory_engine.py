import json
import logging
import os
import re
from uuid import UUID
from datetime import datetime

import httpx
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Document, SessionRecord, Task, Channel, Message, User
from app.models.ai import AiMemory, AiMemorySource, AiMemoryType

logger = logging.getLogger(__name__)

GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
]


def extract_text_from_document(doc: Document) -> str:
    """Extracts human-readable text from any document content structure."""
    title = (doc.title or "Untitled Document").strip()
    raw_content = doc.content

    if isinstance(raw_content, str):
        try:
            raw_content = json.loads(raw_content)
        except Exception:
            pass

    extracted_parts = []
    if isinstance(raw_content, dict):
        # 1. Direct text field
        if raw_content.get("text"):
            extracted_parts.append(str(raw_content["text"]).strip())

        # 2. Block-based content (Notion-style blocks)
        blocks = raw_content.get("blocks", [])
        if isinstance(blocks, list):
            for b in blocks:
                if isinstance(b, dict):
                    b_text = b.get("text") or ""
                    b_items = b.get("items")
                    if b_items and isinstance(b_items, list):
                        b_text += "\n" + "\n".join(f"- {item}" for item in b_items)
                    if b_text.strip():
                        extracted_parts.append(b_text.strip())

        # 3. Fallback to body or content keys
        for key in ["body", "content", "markdown"]:
            if key in raw_content and isinstance(raw_content[key], str) and raw_content[key].strip():
                extracted_parts.append(raw_content[key].strip())

    elif isinstance(raw_content, str) and raw_content.strip():
        extracted_parts.append(raw_content.strip())

    combined_text = "\n\n".join(p for p in extracted_parts if p).strip()
    if not combined_text:
        return f"Document '{title}' is present in the workspace with no written body text yet."
    return combined_text


async def extract_with_gemini(text: str, source_type: str, title: str, gemini_key: str) -> list[dict]:
    """Uses Google Gemini API to extract atomic knowledge nodes (facts, decisions, action items, summary)."""
    clean_key = gemini_key.strip()
    prompt = (
        f"You are the NexaMind Memory Extraction Engine. Deeply analyze this {source_type} content:\n\n"
        f"Title: {title}\n"
        f"Content:\n{text[:4000]}\n\n"
        f"Extract key knowledge items as a JSON list of objects. Each object MUST have:\n"
        f"- 'memory_type': one of ['summary', 'fact', 'decision', 'action_item', 'entity']\n"
        f"- 'title': concise descriptive title (under 10 words)\n"
        f"- 'content': 1-2 sentence distillation of the insight or facts contained in the document\n"
        f"- 'tags': list of 2-5 relevant keywords\n"
        f"- 'importance_score': float between 0.1 and 1.0\n\n"
        f"IMPORTANT: You MUST include at least one 'summary' object giving an executive overview of this {source_type}.\n"
        f"Return ONLY a valid JSON array of objects without markdown fences."
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1500,
            "response_mime_type": "application/json",
        },
    }

    timeout_config = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
    for model in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={clean_key}"
        try:
            async with httpx.AsyncClient(timeout=timeout_config) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        raw_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        clean_text = raw_text.strip()
                        if clean_text.startswith("```json"):
                            clean_text = clean_text[7:-3].strip()
                        elif clean_text.startswith("```"):
                            clean_text = clean_text[3:-3].strip()
                        parsed = json.loads(clean_text)
                        if isinstance(parsed, list) and parsed:
                            logger.info("Gemini (%s) successfully extracted %d memories from '%s'", model, len(parsed), title)
                            return parsed
                else:
                    logger.warning("Gemini extraction model %s returned status %d: %s", model, res.status_code, res.text[:200])
        except Exception as exc:
            logger.warning("Gemini extraction attempt failed with model %s: %s", model, exc)
            continue

    return []


def extract_with_heuristics(text: str, source_type: str, title: str) -> list[dict]:
    """Fallback high-precision heuristic extraction engine."""
    items = []
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    # 1. High-level Summary
    summary_text = lines[0] if lines else f"{source_type.capitalize()}: {title}"
    if len(summary_text) > 300:
        summary_text = summary_text[:297] + "..."
    items.append({
        "memory_type": "summary",
        "title": f"Summary: {title[:40]}",
        "content": summary_text,
        "tags": [source_type, "overview", title.lower()[:20]],
        "importance_score": 0.85,
    })

    # 2. Extract decisions, action items, facts
    for line in lines:
        lower = line.lower()
        if any(kw in lower for kw in ["todo:", "action item", "need to", "will implement", "- [ ]", "assignee", "deadline"]):
            clean = re.sub(r"^[-*#\s\[\]x]+", "", line).strip()
            if clean:
                items.append({
                    "memory_type": "action_item",
                    "title": f"Action: {clean[:40]}",
                    "content": clean,
                    "tags": [source_type, "todo"],
                    "importance_score": 0.85,
                })
        elif any(kw in lower for kw in ["decided", "agreed", "approved", "chosen", "finalized", "we will"]):
            clean = re.sub(r"^[-*#\s]+", "", line).strip()
            if clean:
                items.append({
                    "memory_type": "decision",
                    "title": f"Decision: {clean[:40]}",
                    "content": clean,
                    "tags": [source_type, "decision"],
                    "importance_score": 0.9,
                })
        elif any(kw in lower for kw in ["architecture", "endpoint", "api", "database", "schema", "version", "config", "port", "stack", "module"]):
            clean = re.sub(r"^[-*#\s]+", "", line).strip()
            if len(clean) > 10:
                items.append({
                    "memory_type": "fact",
                    "title": f"Fact: {clean[:40]}",
                    "content": clean,
                    "tags": [source_type, "architecture"],
                    "importance_score": 0.8,
                })
        elif len(line) > 20 and not line.startswith("#"):
            clean = re.sub(r"^[-*#\s]+", "", line).strip()
            if len(clean) > 25:
                items.append({
                    "memory_type": "fact",
                    "title": f"Note: {clean[:40]}",
                    "content": clean,
                    "tags": [source_type, "notes"],
                    "importance_score": 0.7,
                })

    return items[:12]


async def extract_knowledge(text: str, source_type: str, title: str, gemini_key: str | None = None) -> list[dict]:
    """Stage 2: Extraction. Uses Gemini if available, falling back to heuristics."""
    clean_text = (text or "").strip()
    if not clean_text:
        clean_text = f"Document '{title}' is registered in the workspace."

    settings = get_settings()
    active_key = (gemini_key or os.getenv("GEMINI_API_KEY") or settings.gemini_api_key or "").strip()
    if active_key and len(active_key) > 10:
        extracted = await extract_with_gemini(clean_text, source_type, title, active_key)
        if extracted:
            return extracted

    return extract_with_heuristics(clean_text, source_type, title)


async def consolidate_and_store(
    db: AsyncSession,
    workspace_id: UUID,
    source_type: str,
    source_id: str | None,
    source_title: str | None,
    extracted_items: list[dict],
) -> int:
    """Stage 3 & 4: Consolidation & Storage.
    Deduplicates against existing memories for this source/workspace and saves.
    """
    if not extracted_items:
        return 0

    saved_count = 0
    # Fetch existing memories for this source to consolidate/update
    existing_q = select(AiMemory).where(
        AiMemory.workspace_id == workspace_id,
        AiMemory.source_id == source_id,
    )
    res = await db.execute(existing_q)
    existing_memories = list(res.scalars().all())
    existing_by_title = {m.title.lower().strip(): m for m in existing_memories}

    for item in extracted_items:
        title = item.get("title", "Untitled Memory").strip()
        content = item.get("content", "").strip()
        if not content:
            continue

        mem_type = item.get("memory_type", "fact")
        tags = item.get("tags", [])
        score = float(item.get("importance_score", 0.7))

        title_lower = title.lower().strip()
        if title_lower in existing_by_title:
            em = existing_by_title[title_lower]
            em.content = content
            em.importance_score = max(em.importance_score, score)
            em.tags = list(set((em.tags or []) + tags))
            em.updated_at = datetime.now()
            saved_count += 1
        else:
            new_mem = AiMemory(
                workspace_id=workspace_id,
                source_type=source_type,
                source_id=source_id,
                source_title=source_title or title,
                memory_type=mem_type,
                title=title,
                content=content,
                tags=tags,
                importance_score=score,
            )
            db.add(new_mem)
            saved_count += 1

    await db.flush()
    return saved_count


# =========================================================================
# STAGE 1: INGESTION PIPELINE HANDLERS
# =========================================================================

async def ingest_document(db: AsyncSession, doc: Document, gemini_key: str | None = None) -> int:
    """Ingests, extracts, consolidates, and stores a Document into AI Memory."""
    content_text = extract_text_from_document(doc)
    extracted = await extract_knowledge(content_text, "document", doc.title, gemini_key=gemini_key)
    count = await consolidate_and_store(
        db,
        doc.workspace_id,
        source_type="document",
        source_id=str(doc.id),
        source_title=doc.title,
        extracted_items=extracted,
    )
    logger.info("Ingested document '%s' (ID: %s) -> %d memories stored in AI Memory", doc.title, doc.id, count)
    return count


async def ingest_task(db: AsyncSession, task: Task, gemini_key: str | None = None) -> int:
    """Ingests, extracts, consolidates, and stores a Task."""
    text = f"Task: {task.title}\nStatus: {task.status}\nPriority: {task.priority}\nDescription: {task.description or 'No details'}"
    extracted = await extract_knowledge(text, "task", task.title, gemini_key=gemini_key)
    return await consolidate_and_store(
        db,
        task.workspace_id,
        source_type="task",
        source_id=str(task.id),
        source_title=task.title,
        extracted_items=extracted,
    )


async def ingest_chat_message(db: AsyncSession, message: Message, sender_name: str, channel_name: str, gemini_key: str | None = None) -> int:
    """Ingests a high-signal chat message or announcement."""
    if len(message.content) < 15:
        return 0

    text = f"Channel #{channel_name} | From {sender_name}: {message.content}"
    extracted = await extract_knowledge(text, "chat", f"#{channel_name} chat", gemini_key=gemini_key)
    return await consolidate_and_store(
        db,
        message.workspace_id,
        source_type="chat",
        source_id=str(message.id),
        source_title=f"#{channel_name}",
        extracted_items=extracted,
    )


async def ingest_video_meeting(db: AsyncSession, session: SessionRecord, gemini_key: str | None = None) -> int:
    """Ingests a video meeting session, transcript, and minutes."""
    parts = [f"Meeting Session: {session.title or 'Workspace Sync'}"]
    summary_val = getattr(session, "ai_summary", None) or getattr(session, "summary", None)
    if summary_val:
        parts.append(f"Minutes of Meeting (MoM):\n{summary_val}")
    if session.action_items:
        items = session.action_items if isinstance(session.action_items, list) else [str(session.action_items)]
        parts.append("Action Items:\n" + "\n".join(f"- {a}" for a in items))
    transcript_val = getattr(session, "transcript", None) or getattr(session, "raw_transcript", None)
    if transcript_val:
        parts.append(f"Transcript Snippet:\n{transcript_val[:1500]}")

    full_text = "\n\n".join(parts)
    extracted = await extract_knowledge(full_text, "video_call", session.title or "Meeting Session", gemini_key=gemini_key)
    return await consolidate_and_store(
        db,
        session.workspace_id,
        source_type="video_call",
        source_id=str(session.id),
        source_title=session.title or "Video Meeting",
        extracted_items=extracted,
    )


async def sync_all_workspace_documents_to_memory(
    db: AsyncSession,
    workspace_id: UUID,
    gemini_key: str | None = None,
    force_refresh: bool = False,
) -> dict:
    """Ensures every document in the workspace is actively read and consolidated into AI memory."""
    docs_res = await db.execute(select(Document).where(Document.workspace_id == workspace_id))
    docs = list(docs_res.scalars().all())

    memories_res = await db.execute(
        select(AiMemory).where(
            AiMemory.workspace_id == workspace_id,
            AiMemory.source_type == "document",
        )
    )
    existing_mems = list(memories_res.scalars().all())
    existing_source_ids = {m.source_id for m in existing_mems if m.source_id}

    total_ingested = 0
    total_memories_added = 0

    for doc in docs:
        doc_id_str = str(doc.id)
        # Ingest if document has no memory stored or if force_refresh is enabled
        if force_refresh or doc_id_str not in existing_source_ids:
            count = await ingest_document(db, doc, gemini_key=gemini_key)
            total_ingested += 1
            total_memories_added += count

    if total_ingested > 0:
        await db.commit()

    return {
        "documents_checked": len(docs),
        "documents_ingested": total_ingested,
        "memories_added": total_memories_added,
    }


async def run_full_workspace_ingestion(db: AsyncSession, workspace_id: UUID, gemini_key: str | None = None) -> dict:
    """Complete 4-stage ingestion, extraction, consolidation, and storage for an entire workspace."""
    logger.info("Starting complete workspace memory ingestion for workspace %s", workspace_id)
    stats = {
        "docs_ingested": 0,
        "tasks_ingested": 0,
        "chats_ingested": 0,
        "meetings_ingested": 0,
        "total_memories_consolidated": 0,
    }

    # 1. Documents
    docs_res = await db.execute(select(Document).where(Document.workspace_id == workspace_id))
    docs = list(docs_res.scalars().all())
    for d in docs:
        count = await ingest_document(db, d, gemini_key=gemini_key)
        stats["docs_ingested"] += 1
        stats["total_memories_consolidated"] += count

    # 2. Tasks
    tasks_res = await db.execute(select(Task).where(Task.workspace_id == workspace_id))
    tasks = list(tasks_res.scalars().all())
    for t in tasks:
        count = await ingest_task(db, t, gemini_key=gemini_key)
        stats["tasks_ingested"] += 1
        stats["total_memories_consolidated"] += count

    # 3. Video Sessions
    sessions_res = await db.execute(select(SessionRecord).where(SessionRecord.workspace_id == workspace_id))
    sessions = list(sessions_res.scalars().all())
    for s in sessions:
        count = await ingest_video_meeting(db, s, gemini_key=gemini_key)
        stats["meetings_ingested"] += 1
        stats["total_memories_consolidated"] += count

    # 4. Recent Chat Messages
    msgs_res = await db.execute(
        select(Message)
        .where(Message.workspace_id == workspace_id)
        .order_by(Message.created_at.desc())
        .limit(30)
    )
    msgs = list(msgs_res.scalars().all())
    for m in msgs:
        if len(m.content) >= 20:
            count = await ingest_chat_message(db, m, "Teammate", "team", gemini_key=gemini_key)
            stats["chats_ingested"] += 1
            stats["total_memories_consolidated"] += count

    await db.commit()
    logger.info("Workspace memory ingestion finished: %s", stats)

    # Supply keys expected by both backend and frontend UI
    return {
        "status": "success",
        "ingested_count": stats["docs_ingested"] + stats["tasks_ingested"] + stats["meetings_ingested"],
        "extracted_count": stats["total_memories_consolidated"],
        "consolidated_count": stats["total_memories_consolidated"],
        **stats,
    }


# =========================================================================
# MEMORY RETRIEVAL (Used by Agentic AI during user interaction)
# =========================================================================

async def retrieve_memories(
    db: AsyncSession,
    workspace_id: UUID,
    query: str,
    limit: int = 10,
) -> list[dict]:
    """Retrieves top relevant consolidated memories for the Agentic AI."""
    q_lower = query.lower().strip()
    words = [w for w in re.findall(r"\w+", q_lower) if len(w) > 1]
    is_doc_query = any(w in q_lower for w in ["document", "documents", "doc", "docs", "file", "files", "note", "notes", "all", "everything", "read", "what is in"])

    # Fetch top memories for workspace sorted by importance
    mem_q = (
        select(AiMemory)
        .where(AiMemory.workspace_id == workspace_id)
        .order_by(AiMemory.importance_score.desc(), AiMemory.updated_at.desc())
        .limit(60)
    )
    res = await db.execute(mem_q)
    memories = list(res.scalars().all())

    if not memories:
        return []

    # Score each memory based on keyword relevance + importance score
    scored = []
    for m in memories:
        text_content = f"{m.title} {m.content} {' '.join(m.tags or [])} {m.source_title or ''}".lower()
        match_count = sum(1 for w in words if w in text_content)

        relevance_score = (match_count * 2.5) + (m.importance_score * 2.0)
        # Boost document memories if the user is asking about documents
        if is_doc_query and m.source_type == "document":
            relevance_score += 4.0
        if is_doc_query and m.memory_type == "summary":
            relevance_score += 3.0

        scored.append((relevance_score, m))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_items = [item[1] for item in scored[:limit]]

    return [
        {
            "id": str(m.id),
            "source_type": m.source_type,
            "source_title": m.source_title,
            "memory_type": m.memory_type,
            "title": m.title,
            "content": m.content,
            "importance_score": m.importance_score,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in top_items
    ]


async def get_workspace_memory_stats(db: AsyncSession, workspace_id: UUID) -> dict:
    """Returns memory statistics for the admin dashboard."""
    total_q = select(func.count(AiMemory.id)).where(AiMemory.workspace_id == workspace_id)
    total = (await db.execute(total_q)).scalar() or 0

    docs_q = select(func.count(AiMemory.id)).where(
        AiMemory.workspace_id == workspace_id,
        AiMemory.source_type == "document",
    )
    docs_count = (await db.execute(docs_q)).scalar() or 0

    chats_q = select(func.count(AiMemory.id)).where(
        AiMemory.workspace_id == workspace_id,
        AiMemory.source_type == "chat",
    )
    chats_count = (await db.execute(chats_q)).scalar() or 0

    tasks_q = select(func.count(AiMemory.id)).where(
        AiMemory.workspace_id == workspace_id,
        AiMemory.source_type == "task",
    )
    tasks_count = (await db.execute(tasks_q)).scalar() or 0

    meetings_q = select(func.count(AiMemory.id)).where(
        AiMemory.workspace_id == workspace_id,
        AiMemory.source_type == "video_call",
    )
    meetings_count = (await db.execute(meetings_q)).scalar() or 0

    return {
        "total_memories": total,
        "documents_indexed": docs_count,
        "chats_indexed": chats_count,
        "tasks_indexed": tasks_count,
        "meetings_indexed": meetings_count,
    }
