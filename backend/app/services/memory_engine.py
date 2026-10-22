"""Long-term workspace memory: ingestion -> extraction -> storage -> retrieval.

Sources (documents, tasks, meetings, public channel messages) are distilled into short memory
items. Retrieval ranks them with Gemini embeddings when a key is available and falls back to a
BM25-style lexical score, so it works offline too.
"""

import asyncio
import json
import logging
import math
import re
from collections import Counter
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import database
from app.config import get_settings
from app.models import Channel, Document, Message, SessionRecord, Task, User
from app.models.ai import AiMemory
from app.services import llm_client

logger = logging.getLogger(__name__)

MEMORY_TYPES = {"summary", "fact", "decision", "action_item", "entity"}
STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "of", "to", "in", "on", "for", "with", "at", "by", "from",
    "is", "are", "was", "were", "be", "been", "it", "this", "that", "these", "those", "as", "do", "does",
    "did", "what", "which", "who", "whom", "how", "when", "where", "why", "i", "me", "my", "we", "our",
    "you", "your", "they", "their", "he", "she", "his", "her", "can", "could", "should", "would", "will",
    "about", "please", "tell", "show", "give", "any", "all", "there", "have", "has", "had", "so", "not",
}


def extract_text_from_document(doc: Document) -> str:
    """Human-readable text from any document content shape (plain text or Notion-style blocks)."""
    raw_content = doc.content
    if isinstance(raw_content, str):
        try:
            raw_content = json.loads(raw_content)
        except json.JSONDecodeError:
            return raw_content.strip()

    parts: list[str] = []
    if isinstance(raw_content, dict):
        # "text" is what the editor saves; when present it is the whole document. Older
        # AI-written documents also carried a copy in "blocks", which must not be read twice.
        if isinstance(raw_content.get("text"), str) and raw_content["text"].strip():
            return raw_content["text"].strip()
        for block in raw_content.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            text = str(block.get("text") or "")
            items = block.get("items")
            if isinstance(items, list):
                text += "\n" + "\n".join(f"- {item}" for item in items)
            if text.strip() and text.strip() not in parts:
                parts.append(text.strip())
        for key in ("body", "content", "markdown"):
            value = raw_content.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return "\n\n".join(p for p in parts if p).strip()


# ---------------------------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------------------------

EXTRACTION_PROMPT = """You extract durable knowledge from workspace content.
Source type: {source_type}
Title: {title}
Content:
{text}

Return a JSON array. Each item has:
- "memory_type": one of summary, fact, decision, action_item, entity
- "title": under 10 words
- "content": one or two sentences, using only information in the content
- "tags": 2-5 keywords
- "importance_score": number between 0.1 and 1.0
Include exactly one "summary" item. Return [] if the content has no meaningful information."""


async def extract_knowledge(text: str, source_type: str, title: str, gemini_key: str | None = None) -> list[dict]:
    clean_text = (text or "").strip()
    if not clean_text:
        return []
    key = gemini_key or llm_client.resolve_gemini_key()
    if key:
        raw = await llm_client.gemini_text(
            key,
            EXTRACTION_PROMPT.format(source_type=source_type, title=title, text=clean_text[:6000]),
            json_mode=True,
            max_tokens=1500,
        )
        parsed = llm_client.parse_json(raw)
        if isinstance(parsed, list):
            items = [_normalize_item(i) for i in parsed if isinstance(i, dict)]
            items = [i for i in items if i]
            if items:
                return items
    return extract_with_heuristics(clean_text, source_type, title)


def _normalize_item(item: dict) -> dict | None:
    content = str(item.get("content") or "").strip()
    if not content:
        return None
    memory_type = str(item.get("memory_type") or "fact").lower()
    try:
        score = min(1.0, max(0.1, float(item.get("importance_score", 0.6))))
    except (TypeError, ValueError):
        score = 0.6
    tags = item.get("tags") if isinstance(item.get("tags"), list) else []
    return {
        "memory_type": memory_type if memory_type in MEMORY_TYPES else "fact",
        "title": str(item.get("title") or content[:60]).strip()[:255],
        "content": content[:4000],
        "tags": [str(t)[:40] for t in tags[:8]],
        "importance_score": score,
    }


def extract_with_heuristics(text: str, source_type: str, title: str) -> list[dict]:
    """Offline extraction: a summary plus lines that read like decisions, actions, or facts."""
    lines = [re.sub(r"^[-*#>\s\[\]x]+", "", line).strip() for line in text.split("\n")]
    lines = [line for line in lines if line]
    if not lines:
        return []
    summary = " ".join(lines)[:300]
    items = [{
        "memory_type": "summary",
        "title": f"Summary: {title[:60]}",
        "content": summary,
        "tags": [source_type],
        "importance_score": 0.8,
    }]
    for line in lines:
        lower = line.lower()
        if any(k in lower for k in ("todo", "action item", "need to", "will implement", "assignee", "deadline", "due ")):
            kind, score = "action_item", 0.85
        elif any(k in lower for k in ("decided", "agreed", "approved", "chosen", "finalized", "we will")):
            kind, score = "decision", 0.9
        elif len(line) > 25:
            kind, score = "fact", 0.6
        else:
            continue
        items.append({
            "memory_type": kind,
            "title": line[:60],
            "content": line[:1000],
            "tags": [source_type],
            "importance_score": score,
        })
    return items[:12]


async def replace_source_memories(
    db: AsyncSession,
    workspace_id: UUID,
    source_type: str,
    source_id: str,
    source_title: str | None,
    items: list[dict],
) -> int:
    """Store the latest extraction for a source, replacing what was extracted before."""
    await db.execute(
        delete(AiMemory).where(AiMemory.workspace_id == workspace_id, AiMemory.source_id == source_id)
    )
    for item in items:
        db.add(AiMemory(
            workspace_id=workspace_id,
            source_type=source_type,
            source_id=source_id,
            source_title=(source_title or item["title"])[:255],
            memory_type=item["memory_type"],
            title=item["title"],
            content=item["content"],
            tags=item.get("tags") or [],
            importance_score=item["importance_score"],
        ))
    await db.flush()
    return len(items)


async def forget_source(db: AsyncSession, workspace_id: UUID, source_id: str) -> None:
    await db.execute(delete(AiMemory).where(AiMemory.workspace_id == workspace_id, AiMemory.source_id == source_id))


# ---------------------------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------------------------

async def ingest_document(db: AsyncSession, doc: Document, gemini_key: str | None = None) -> int:
    text = extract_text_from_document(doc)
    items = await extract_knowledge(f"{doc.title}\n\n{text}", "document", doc.title, gemini_key)
    return await replace_source_memories(db, doc.workspace_id, "document", str(doc.id), doc.title, items)


async def ingest_task(db: AsyncSession, task: Task, gemini_key: str | None = None) -> int:
    status = getattr(task.status, "value", task.status)
    priority = getattr(task.priority, "value", task.priority)
    text = f"Task: {task.title}\nStatus: {status}\nPriority: {priority}\nDescription: {task.description or ''}"
    items = await extract_knowledge(text, "task", task.title, gemini_key)
    return await replace_source_memories(db, task.workspace_id, "task", str(task.id), task.title, items)


async def ingest_chat_message(db: AsyncSession, message: Message, sender_name: str, channel_name: str, gemini_key: str | None = None) -> int:
    if len(message.content) < 15:
        return 0
    text = f"Channel #{channel_name} | From {sender_name}: {message.content}"
    items = await extract_knowledge(text, "chat", f"#{channel_name}", gemini_key)
    return await replace_source_memories(db, message.workspace_id, "chat", str(message.id), f"#{channel_name}", items)


async def ingest_video_meeting(db: AsyncSession, session: SessionRecord, gemini_key: str | None = None) -> int:
    parts = [f"Meeting: {session.title or 'Meeting'}"]
    if session.ai_summary:
        parts.append(f"Minutes:\n{session.ai_summary}")
    if session.action_items:
        parts.append("Action items:\n" + "\n".join(f"- {a}" for a in session.action_items))
    if session.transcript:
        parts.append(f"Transcript excerpt:\n{session.transcript[:3000]}")
    items = await extract_knowledge("\n\n".join(parts), "video_call", session.title or "Meeting", gemini_key)
    return await replace_source_memories(db, session.workspace_id, "video_call", str(session.id), session.title, items)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def sync_all_workspace_documents_to_memory(
    db: AsyncSession,
    workspace_id: UUID,
    gemini_key: str | None = None,
    force_refresh: bool = False,
    max_documents: int = 10,
) -> dict:
    """Ingest documents that are new or edited since their memory was last extracted.

    Capped per call so a large backlog is worked through gradually instead of blocking a chat turn.
    """
    docs = list((await db.execute(select(Document).where(Document.workspace_id == workspace_id))).scalars().all())
    last_extracted = dict((await db.execute(
        select(AiMemory.source_id, func.max(AiMemory.updated_at))
        .where(AiMemory.workspace_id == workspace_id, AiMemory.source_type == "document")
        .group_by(AiMemory.source_id)
    )).all())

    stale = []
    for doc in docs:
        extracted_at = _aware(last_extracted.get(str(doc.id)))
        if force_refresh or extracted_at is None or (_aware(doc.updated_at) or extracted_at) > extracted_at:
            stale.append(doc)
    stale.sort(key=lambda d: _aware(d.updated_at) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    memories_added = 0
    for doc in stale[:max_documents]:
        memories_added += await ingest_document(db, doc, gemini_key)
    return {
        "documents_checked": len(docs),
        "documents_ingested": min(len(stale), max_documents),
        "documents_pending": max(0, len(stale) - max_documents),
        "memories_added": memories_added,
    }


async def run_full_workspace_ingestion(db: AsyncSession, workspace_id: UUID, gemini_key: str | None = None) -> dict:
    """Re-extract every source in a workspace. Only public channel messages are included."""
    stats = {"docs_ingested": 0, "tasks_ingested": 0, "chats_ingested": 0, "meetings_ingested": 0,
             "total_memories_consolidated": 0}

    for doc in (await db.execute(select(Document).where(Document.workspace_id == workspace_id))).scalars():
        stats["total_memories_consolidated"] += await ingest_document(db, doc, gemini_key)
        stats["docs_ingested"] += 1
    for task in (await db.execute(select(Task).where(Task.workspace_id == workspace_id))).scalars():
        stats["total_memories_consolidated"] += await ingest_task(db, task, gemini_key)
        stats["tasks_ingested"] += 1
    for meeting in (await db.execute(select(SessionRecord).where(SessionRecord.workspace_id == workspace_id))).scalars():
        stats["total_memories_consolidated"] += await ingest_video_meeting(db, meeting, gemini_key)
        stats["meetings_ingested"] += 1

    # Private channels and DMs never feed shared memory, or the copilot could repeat them to others.
    public_messages = (await db.execute(
        select(Message, Channel.name, User.name)
        .join(Channel, Channel.id == Message.channel_id)
        .outerjoin(User, User.id == Message.sender_id)
        .where(Message.workspace_id == workspace_id, Channel.is_private.is_(False))
        .order_by(Message.created_at.desc())
        .limit(30)
    )).all()
    for message, channel_name, sender_name in public_messages:
        if len(message.content) >= 20:
            sender = sender_name or "Teammate"
            stats["total_memories_consolidated"] += await ingest_chat_message(db, message, sender, channel_name, gemini_key)
            stats["chats_ingested"] += 1

    await db.flush()
    return {
        "status": "success",
        "ingested_count": stats["docs_ingested"] + stats["tasks_ingested"] + stats["meetings_ingested"],
        "extracted_count": stats["total_memories_consolidated"],
        "consolidated_count": stats["total_memories_consolidated"],
        **stats,
    }


# Debounced background ingestion so editor autosaves don't trigger an extraction per keystroke.
_PENDING_DOCS: dict[UUID, asyncio.Task] = {}
INGEST_DEBOUNCE_SECONDS = 15.0


def schedule_document_ingestion(document_id: UUID, delay: float = INGEST_DEBOUNCE_SECONDS) -> None:
    if not get_settings().run_background_jobs:
        return
    existing = _PENDING_DOCS.get(document_id)
    if existing and not existing.done():
        return

    async def run() -> None:
        try:
            await asyncio.sleep(delay)
            async with database.AsyncSessionLocal() as session:
                doc = await session.get(Document, document_id)
                if doc is not None:
                    await ingest_document(session, doc)
                    await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Background memory ingestion failed for document %s: %s", document_id, exc)
        finally:
            _PENDING_DOCS.pop(document_id, None)

    _PENDING_DOCS[document_id] = asyncio.create_task(run())


# ---------------------------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------------------------

def tokenize(text: str) -> list[str]:
    tokens = []
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        if word in STOPWORDS or len(word) < 2:
            continue
        for suffix in ("ing", "ies", "es", "ed", "s"):
            if len(word) > len(suffix) + 2 and word.endswith(suffix):
                word = word[: -len(suffix)] + ("y" if suffix == "ies" else "")
                break
        tokens.append(word)
    return tokens


def _memory_text(m: AiMemory) -> str:
    return f"{m.title} {m.content} {' '.join(m.tags or [])} {m.source_title or ''}"


def _bm25_scores(query_tokens: list[str], documents: list[list[str]], k1: float = 1.5, b: float = 0.75) -> list[float]:
    if not documents:
        return []
    n = len(documents)
    avg_len = sum(len(d) for d in documents) / n or 1.0
    df = Counter(t for d in documents for t in set(d))
    scores = []
    for doc in documents:
        tf = Counter(doc)
        score = 0.0
        for term in set(query_tokens):
            if term not in tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf[term] * (k1 + 1) / (tf[term] + k1 * (1 - b + b * len(doc) / avg_len))
        scores.append(score)
    return scores


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


async def _ensure_embeddings(db: AsyncSession, memories: list[AiMemory], api_key: str, limit: int = 100) -> None:
    model = get_settings().gemini_embedding_model
    missing = [m for m in memories if not m.embedding or m.embedding_model != model][:limit]
    for start in range(0, len(missing), 50):
        batch = missing[start:start + 50]
        vectors = await llm_client.gemini_embed(api_key, [_memory_text(m) for m in batch])
        if not vectors:
            return
        for memory, vector in zip(batch, vectors):
            memory.embedding = vector
            memory.embedding_model = model
    if missing:
        await db.flush()


async def retrieve_memories(
    db: AsyncSession,
    workspace_id: UUID,
    query: str,
    limit: int = 10,
    gemini_key: str | None = None,
) -> list[dict]:
    """Top memories for a query: semantic similarity when possible, lexical relevance otherwise."""
    memories = list((await db.execute(
        select(AiMemory)
        .where(AiMemory.workspace_id == workspace_id)
        .order_by(AiMemory.updated_at.desc())
        .limit(2000)
    )).scalars().all())
    if not memories:
        return []

    query_tokens = tokenize(query)
    lexical = _bm25_scores(query_tokens, [tokenize(_memory_text(m)) for m in memories])
    max_lex = max(lexical) if lexical and max(lexical) > 0 else 1.0
    scores = [0.7 * (s / max_lex) + 0.3 * m.importance_score for s, m in zip(lexical, memories)]

    key = gemini_key or llm_client.resolve_gemini_key()
    if key and query.strip():
        await _ensure_embeddings(db, memories, key)
        query_vectors = await llm_client.gemini_embed(key, [query], task_type="RETRIEVAL_QUERY")
        if query_vectors:
            qv = query_vectors[0]
            model = get_settings().gemini_embedding_model
            scores = [
                (0.55 * _cosine(qv, m.embedding) + 0.3 * (lex / max_lex) + 0.15 * m.importance_score)
                if m.embedding and m.embedding_model == model else score
                for m, lex, score in zip(memories, lexical, scores)
            ]

    ranked = sorted(zip(scores, memories), key=lambda pair: pair[0], reverse=True)[:limit]
    return [
        {
            "id": str(m.id),
            "source_type": m.source_type,
            "source_id": m.source_id,
            "source_title": m.source_title,
            "memory_type": m.memory_type,
            "title": m.title,
            "content": m.content,
            "importance_score": m.importance_score,
            "relevance": round(score, 4),
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for score, m in ranked
    ]


async def get_workspace_memory_stats(db: AsyncSession, workspace_id: UUID) -> dict:
    counts = dict((await db.execute(
        select(AiMemory.source_type, func.count(AiMemory.id))
        .where(AiMemory.workspace_id == workspace_id)
        .group_by(AiMemory.source_type)
    )).all())
    return {
        "total_memories": sum(counts.values()),
        "documents_indexed": counts.get("document", 0),
        "chats_indexed": counts.get("chat", 0),
        "tasks_indexed": counts.get("task", 0),
        "meetings_indexed": counts.get("video_call", 0),
    }
