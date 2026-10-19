import base64
import logging
import os
import re
from datetime import datetime

from app.services import llm_client

logger = logging.getLogger(__name__)

# Gemini accepts inline audio up to ~20 MB per request.
GEMINI_INLINE_AUDIO_LIMIT = 19 * 1024 * 1024


async def transcribe_audio(file_path: str, mime_type: str = "audio/webm") -> str:
    """Transcribe a recording with Groq Whisper, falling back to Gemini.

    Returns an explanatory placeholder (not a fake transcript) when no provider is configured.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Recording file not found at {file_path}")

    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)
    logger.info("Transcribing '%s' (%d bytes)", filename, file_size)

    text = await llm_client.groq_transcribe(file_path, filename, mime_type)
    if text:
        return text

    gemini_key = llm_client.resolve_gemini_key()
    if gemini_key and file_size <= GEMINI_INLINE_AUDIO_LIMIT:
        with open(file_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("ascii")
        text = await llm_client.gemini_text(
            gemini_key,
            "Transcribe this meeting recording accurately. Return only the spoken words, with no commentary.",
            extra_parts=[{"inline_data": {"mime_type": mime_type, "data": audio_b64}}],
            max_tokens=8192,
        )
        if text:
            return text

    logger.warning("No transcription provider available for %s", filename)
    return (
        f"[Audio recorded — {filename} ({file_size / 1024:.1f} KB)]\n"
        "No transcript was produced. Configure GROQ_API_KEY or GEMINI_API_KEY on the server to enable transcription."
    )


MOM_PROMPT = """Analyze the meeting transcript below and write formal Minutes of the Meeting (MoM).
Use only what is said in the transcript. Do not invent decisions, owners, or dates.

Meeting title: {title}
Date: {date}
Transcript:
{transcript}

Return a JSON object with:
- "summary": Markdown with these sections: "## Minutes of the Meeting", "### Overview",
  "### Decisions", "### Discussion Highlights", "### Risks & Dependencies", "### Next Steps".
  Write "None recorded." for a section the transcript does not cover.
- "action_items": a list of short, actionable strings taken from the transcript (may be empty).
"""


async def summarize_meeting_transcript(transcript: str, title: str = "") -> tuple[str, list[str]]:
    """Produce Minutes of the Meeting (Markdown) and action items from a transcript."""
    if not transcript or not transcript.strip():
        return "No spoken transcript was recorded for this meeting.", []

    meeting_name = title or "Meeting"
    current_date = datetime.now().strftime("%B %d, %Y")
    prompt = MOM_PROMPT.format(title=meeting_name, date=current_date, transcript=transcript[:60000])

    parsed = llm_client.parse_json(await llm_client.complete_text(prompt, json_mode=True))
    if isinstance(parsed, dict) and str(parsed.get("summary", "")).strip():
        items = parsed.get("action_items") or []
        return str(parsed["summary"]).strip(), [str(i).strip() for i in items if str(i).strip()]

    return _summarize_offline(transcript, meeting_name, current_date)


ACTION_PATTERNS = ("action item", "todo:", "to do:", "task:", "need to", "needs to", "will do", "will build",
                   "will fix", "will write", "will implement", "should implement", "follow up")
DECISION_PATTERNS = ("decided", "agreed", "confirmed", "approved", "we will go with", "final decision")


def _summarize_offline(transcript: str, meeting_name: str, current_date: str) -> tuple[str, list[str]]:
    """Rule-based minutes used when no AI provider is reachable. Only restates the transcript."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", transcript) if s.strip()]
    action_items: list[str] = []
    decisions: list[str] = []
    discussion: list[str] = []
    for sentence in sentences:
        if sentence.startswith("[Audio recorded"):
            continue
        lower = sentence.lower()
        if any(p in lower for p in ACTION_PATTERNS):
            item = re.sub(r"^(action item|todo|to do|task)\s*:?\s*", "", sentence, flags=re.IGNORECASE).strip()
            if item and item not in action_items:
                action_items.append(item)
        elif any(p in lower for p in DECISION_PATTERNS):
            decisions.append(sentence)
        elif len(sentence) > 5:
            discussion.append(sentence)

    def bullets(items: list[str], limit: int) -> str:
        return "\n".join(f"- {i}" for i in items[:limit]) if items else "None recorded."

    summary_md = (
        "## Minutes of the Meeting\n\n"
        f"### Overview\n- **Meeting:** {meeting_name}\n- **Date:** {current_date}\n"
        "- **Note:** Generated without an AI provider; this restates the transcript.\n\n"
        f"### Decisions\n{bullets(decisions, 5)}\n\n"
        f"### Discussion Highlights\n{bullets(discussion, 8)}\n\n"
        f"### Next Steps\n{bullets(action_items, 10)}"
    )
    return summary_md, action_items
