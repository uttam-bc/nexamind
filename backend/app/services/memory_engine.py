import json
import logging
import os
import re
from uuid import UUID
from datetime import datetime

import httpx
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, SessionRecord, Task, Channel, Message, User
from app.models.ai import AiMemory, AiMemorySource, AiMemoryType

logger = logging.getLogger(__name__)


async def extract_with_gemini(text: str, source_type: str, title: str, gemini_key: str) -> list[dict]:
    """Uses Google Gemini API to extract atomic knowledge nodes (facts, decisions, action items, summary)."""
    prompt = (
        f"You are the NexaMind Memory Extraction Engine. Analyze the following {source_type} content:\n\n"
        f"Title: {title}\n"
        f"Content:\n{text[:3000]}\n\n"
        f"Extract key knowledge items as a JSON list of objects. Each object MUST have:\n"
        f"- 'memory_type': one of ['fact', 'decision', 'action_item', 'summary', 'entity']\n"
        f"- 'title': concise descriptive title (under 10 words)\n"
        f"- 'content': 1-2 sentence distillation of the insight\n"
        f"- 'tags': list of 2-5 relevant keywords\n"
        f"- 'importance_score': float between 0.1 and 1.0\n\n"
        f"Return ONLY a valid JSON array of objects. Example: [{{\"memory_type\":\"decision\",\"title\":\"Database Choice\",\"content\":\"Team chose PostgreSQL with asyncpg.\",\"tags\":[\"database\",\"postgres\"],\"importance_score\":0.9}}]"
    )

    models_to_try = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"]
    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "response_mime_type": "application/json"},
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
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
                        if isinstance(parsed, list):
                            return parsed
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
    if len(summary_text) > 200:
        summary_text = summary_text[:197] + "..."
    items.append({
        "memory_type": "summary",
        "title": f"Summary: {title[:40]}",
        "content": summary_text,
        "tags": [source_type, "overview"],
        "importance_score": 0.6,
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
        elif any(kw in lower for kw in ["architecture", "endpoint", "api", "database", "schema", "version", "config", "port"]):
            clean = re.sub(r"^[-*#\s]+", "", line).strip()
            if len(clean) > 15:
                items.append({
                    "memory_type": "fact",
                    "title": f"Fact: {clean[:40]}",
                    "content": clean,
                    "tags": [source_type, "architecture"],
                    "importance_score": 0.75,
                })

    return items[:10]  # Cap at top 10 items per source


async def extract_knowledge(text: str, source_type: str, title: str) -> list[dict]:
    """Stage 2: Extraction. Uses Gemini if available, falling back to heuristics."""
    if not text or not text.strip():
        return []

    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key and not gemini_key.startswith("AQ.") and len(gemini_key) > 20:
        extracted = await extract_with_gemini(text, source_type, title, gemini_key)
        if extracted:
            return extracted

    return extract_with_heuristics(text, source_type, title)


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
    existing_titles = {m.title.lower().strip() for m in existing_memories}

    for item in extracted_items:
        title = item.get("title", "Untitled Memory").strip()
        content = item.get("content", "").strip()
        if not content:
            continue

        mem_type = item.get("memory_type", "fact")
        tags = item.get("tags", [])
        score = float(item.get("importance_score", 0.5))

        # Check if already stored for this source
        if title.lower() in existing_titles:
            # Update existing memory with fresh content & score
            for em in existing_memories:
                if em.title.lower().strip() == title.lower():
                    em.content = content
                    em.importance_score = max(em.importance_score, score)
                    em.tags = list(set((em.tags or []) + tags))
                    em.updated_at = datetime.now()
                    saved_count += 1
                    break
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

async def ingest_document(db: AsyncSession, doc: Document) -> int:
    """Ingests, extracts, consolidates, and stores a Document."""
    content_text = ""
    if isinstance(doc.content, dict):
        blocks = doc.content.get("blocks", [])
        content_text = "\n".join(b.get("text", "") for b in blocks if isinstance(b, dict))
    elif isinstance(doc.content, str):
        content_text = doc.content

    extracted = await extract_knowledge(content_text, "document", doc.title)
    return await consolidate_and_store(
        db,
        doc.workspace_id,
        source_type="document",
        source_id=str(doc.id),
        source_title=doc.title,
        extracted_items=extracted,
    )


async def ingest_task(db: AsyncSession, task: Task) -> int:
    """Ingests, extracts, consolidates, and stores a Task."""
    text = f"Task: {task.title}\nStatus: {task.status}\nPriority: {task.priority}\nDescription: {task.description or 'No details'}"
    extracted = await extract_knowledge(text, "task", task.title)
    return await consolidate_and_store(
        db,
        task.workspace_id,
        source_type="task",
        source_id=str(task.id),
        source_title=task.title,
        extracted_items=extracted,
    )


async def ingest_chat_message(db: AsyncSession, message: Message, sender_name: str, channel_name: str) -> int:
    """Ingests a high-signal chat message or announcement."""
    if len(message.content) < 15:
        return 0

    text = f"Channel #{channel_name} | From {sender_name}: {message.content}"
    extracted = await extract_knowledge(text, "chat", f"#{channel_name} chat")
    return await consolidate_and_store(
        db,
        message.workspace_id,
        source_type="chat",
        source_id=str(message.id),
        source_title=f"#{channel_name}",
        extracted_items=extracted,
    )


async def ingest_video_meeting(db: AsyncSession, session: SessionRecord) -> int:
    """Ingests a video meeting session, transcript, and minutes."""
    parts = [f"Meeting Session: {session.title or 'Workspace Sync'}"]
    if session.summary:
        parts.append(f"Minutes of Meeting (MoM):\n{session.summary}")
    if session.action_items:
        items = session.action_items if isinstance(session.action_items, list) else [str(session.action_items)]
        parts.append("Action Items:\n" + "\n".join(f"- {a}" for a in items))
    if session.raw_transcript:
        parts.append(f"Transcript Snippet:\n{session.raw_transcript[:1500]}")

    full_text = "\n\n".join(parts)
    extracted = await extract_knowledge(full_text, "video_call", session.title or "Meeting Session")
    return await consolidate_and_store(
        db,
        session.workspace_id,
        source_type="video_call",
        source_id=str(session.id),
        source_title=session.title or "Video Meeting",
        extracted_items=extracted,
    )


async def run_full_workspace_ingestion(db: AsyncSession, workspace_id: UUID) -> dict:
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
        count = await ingest_document(db, d)
        stats["docs_ingested"] += 1
        stats["total_memories_consolidated"] += count

    # 2. Tasks
    tasks_res = await db.execute(select(Task).where(Task.workspace_id == workspace_id))
    tasks = list(tasks_res.scalars().all())
    for t in tasks:
        count = await ingest_task(db, t)
        stats["tasks_ingested"] += 1
        stats["total_memories_consolidated"] += count

    # 3. Video Sessions
    sessions_res = await db.execute(select(SessionRecord).where(SessionRecord.workspace_id == workspace_id))
    sessions = list(sessions_res.scalars().all())
    for s in sessions:
        count = await ingest_video_meeting(db, s)
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
            count = await ingest_chat_message(db, m, "Teammate", "team")
            stats["chats_ingested"] += 1
            stats["total_memories_consolidated"] += count

    await db.commit()
    logger.info("Workspace memory ingestion finished: %s", stats)
    return stats


# =========================================================================
# MEMORY RETRIEVAL (Used by Agentic AI during user interaction)
# =========================================================================

async def retrieve_memories(
    db: AsyncSession,
    workspace_id: UUID,
    query: str,
    limit: int = 8,
) -> list[dict]:
    """Retrieves top relevant consolidated memories for the Agentic AI."""
    q_lower = query.lower().strip()
    words = [w for w in re.findall(r"\w+", q_lower) if len(w) > 2]

    # Fetch top memories for workspace sorted by importance
    mem_q = (
        select(AiMemory)
        .where(AiMemory.workspace_id == workspace_id)
        .order_by(AiMemory.importance_score.desc(), AiMemory.updated_at.desc())
        .limit(50)
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
        relevance_score = (match_count * 2.0) + (m.importance_score * 1.5)
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
