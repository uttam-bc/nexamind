"""Offline command parser for the copilot, used when no LLM provider is reachable.

It recognises explicit commands ("create a task 'X'", "log an expense of $450 for Hosting") and
returns tool calls. Anything it cannot fully understand produces no action: unlike the old
keyword matcher it never fills in invented titles, channels, or amounts.
"""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

QUOTE = r"['\"‘’“”]"
# A quote mark only opens/closes at a word edge, so apostrophes ("don't") stay inside titles.
QUOTED = rf"(?<!\w){QUOTE}(?P<q>.+?){QUOTE}(?!\w)"
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


@dataclass
class PlannedCall:
    tool: str
    args: dict
    # Special plans that expand at execution time (e.g. tasks from meeting action items).
    expand: str | None = None


@dataclass
class Plan:
    calls: list[PlannedCall] = field(default_factory=list)


def _clean(text: str) -> str:
    return text.strip().strip(".,;:!").strip()


def _unquote(text: str) -> str:
    """Text wrapped in quotes is kept verbatim; bare text loses trailing punctuation."""
    stripped = text.strip()
    m = re.fullmatch(rf"{QUOTED}[.,;:!]*", stripped)
    return m.group("q").strip() if m else _clean(stripped)


def _group_text(m: re.Match) -> str:
    """Value of a `{QUOTED}|(?P<bare>...)` alternation."""
    return m.group("q").strip() if m.group("q") else _clean(m.group("bare") or "")


def _first_quoted(text: str) -> str | None:
    match = re.search(QUOTED, text)
    return _clean(match.group("q")) if match else None


def _named(text: str) -> str | None:
    """Title given as 'named X' / 'titled X' / 'called X', or the first quoted string."""
    match = re.search(
        rf"\b(?:named|titled|called)\s+(?:{QUOTED}|(?P<bare>[^\n]+?))(?=\s+(?:with|containing|saying|that says)\b|[.,;]?\s*$)",
        text,
        re.IGNORECASE,
    )
    if match:
        return _clean(match.group("q") or match.group("bare"))
    return _first_quoted(text)


def parse_date(text: str, today: date | None = None) -> str | None:
    today = today or date.today()
    lower = text.lower()
    if m := re.search(r"\b(\d{4}-\d{2}-\d{2})\b", lower):
        return m.group(1)
    if "day after tomorrow" in lower:
        return (today + timedelta(days=2)).isoformat()
    if "tomorrow" in lower:
        return (today + timedelta(days=1)).isoformat()
    if "today" in lower or "tonight" in lower:
        return today.isoformat()
    if m := re.search(r"\bin\s+(\d{1,3})\s+days?\b", lower):
        return (today + timedelta(days=int(m.group(1)))).isoformat()
    if m := re.search(r"\b(?:next|on|this)?\s*(" + "|".join(WEEKDAYS) + r")\b", lower):
        target = WEEKDAYS.index(m.group(1))
        delta = (target - today.weekday()) % 7 or 7
        return (today + timedelta(days=delta)).isoformat()
    return None


def parse_time(text: str) -> str | None:
    if m := re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text, re.IGNORECASE):
        hour, minute, meridiem = int(m.group(1)), int(m.group(2) or 0), m.group(3).upper()
        if 1 <= hour <= 12 and minute < 60:
            return f"{hour:02d}:{minute:02d} {meridiem}"
    if m := re.search(r"\bat\s+(\d{1,2}):(\d{2})\b", text):
        hour, minute = int(m.group(1)), int(m.group(2))
        if hour < 24 and minute < 60:
            meridiem = "AM" if hour < 12 else "PM"
            return f"{(hour % 12) or 12:02d}:{minute:02d} {meridiem}"
    return None


def _priority(text: str) -> str:
    lower = text.lower()
    for level in ("urgent", "high", "low"):
        if re.search(rf"\b{level}\b", lower):
            return level
    if "critical" in lower or "asap" in lower:
        return "urgent"
    return "medium"


def _task_status(text: str) -> str:
    lower = text.lower()
    if "in progress" in lower or "in-progress" in lower or "doing" in lower:
        return "in_progress"
    if re.search(r"\b(?:in|for)\s+review\b", lower):
        return "review"
    if re.search(r"\b(?:done|completed|finished)\b", lower):
        return "done"
    return "todo"


# Each parser takes one clause and returns tool calls, or None if the clause isn't that command.

def _parse_switch(c: str) -> list[PlannedCall] | None:
    m = re.match(
        r"^(?:please\s+)?(?:switch|go|change|move|jump)\s+(?:over\s+)?(?:to|into)\s+(?:the\s+|my\s+)?(?P<t>.+)$"
        r"|^(?:please\s+)?open\s+(?:the\s+|my\s+)?(?P<t2>(?:solo|personal|team|group)\b.*workspace.*|.*\bworkspace\b.*)$",
        c, re.IGNORECASE,
    )
    if not m:
        return None
    target = _unquote(m.group("t") or m.group("t2"))
    return [PlannedCall("switch_workspace", {"target": target})] if target else None


def _parse_get_document(c: str) -> list[PlannedCall] | None:
    m = re.match(
        r"^(?:please\s+)?(?:access|open|read|show(?:\s+me)?|get|view|fetch)\s+(?:the\s+)?(?:file|doc|document|note|page)\s+"
        r"(?P<d>.+?)(?:\s+(?:from|in)\s+(?:the\s+)?(?:group|workspace|team)?\s*(?P<g>.+))?$",
        c, re.IGNORECASE,
    )
    if not m:
        return None
    doc = _unquote(m.group("d"))
    if not doc:
        return None
    args = {"doc_query": doc}
    if m.group("g"):
        args["target_group"] = re.sub(r"\s+workspace$", "", _unquote(m.group("g")), flags=re.IGNORECASE).strip()
    return [PlannedCall("get_document", args)]


def _parse_create_document(c: str) -> list[PlannedCall] | None:
    if not re.search(r"\b(?:create|draft|write|make|author|generate|start|new)\b", c, re.IGNORECASE):
        return None
    if not re.search(r"\b(?:doc|document|file|note|notes|spec|page|memo)\b", c, re.IGNORECASE):
        return None
    if re.search(r"\b(?:task|channel|repo|repository|report)\b", c, re.IGNORECASE):
        return None
    title = _named(c)
    if not title:
        m = re.search(r"\babout\s+(?:our\s+|the\s+|my\s+)?(?P<t>.+)$", c, re.IGNORECASE)
        title = (lambda t: t[:1].upper() + t[1:])(_clean(m.group("t"))) if m else None
    if not title:
        return None
    content = ""
    m = re.search(rf"\b(?:with\s+(?:the\s+)?(?:text|content|body)|containing|saying|that says)\s+(?:{QUOTED}|(?P<bare>.+))$", c, re.IGNORECASE)
    if m:
        content = _group_text(m)
    else:
        m = re.search(rf"\bwith\s+(?:{QUOTED}|(?P<bare>.+))$", c, re.IGNORECASE)
        if m and _group_text(m) != title:
            content = _group_text(m)
    return [PlannedCall("create_document", {"title": title, "content_text": content})]


def _parse_edit_document(c: str) -> list[PlannedCall] | None:
    m = re.match(
        r"^(?:please\s+)?(?:edit|update|modify|append\s+to|add\s+to)\s+(?:the\s+)?(?:doc|document|file|note|notes|page)\s+"
        rf"(?P<d>{QUOTED}|\S+)\s+(?:and\s+)?(?:add|append|with|to\s+say|saying|replace\s+with)\s+(?P<t>.+)$",
        c, re.IGNORECASE,
    )
    if not m:
        return None
    doc = _unquote(m.group("d"))
    text = _unquote(m.group("t"))
    if not doc or not text:
        return None
    mode = "replace" if re.search(r"\breplace\b", c, re.IGNORECASE) else "append"
    return [PlannedCall("edit_document", {"doc_query": doc, "new_content_text": text, "mode": mode})]


def _parse_meeting_tasks(c: str) -> list[PlannedCall] | None:
    if re.search(r"\b(?:create|add|make|turn|convert)\b.*\btasks?\b.*\baction items?\b.*\bmeeting", c, re.IGNORECASE) or \
       re.search(r"\bconvert\b.*\baction items?\b.*\b(?:into|to)\s+tasks?\b", c, re.IGNORECASE):
        m = re.search(rf"\bmeeting\s+(?:{QUOTED}|(?:called|titled|named)\s+(?P<bare>.+))", c, re.IGNORECASE)
        query = _group_text(m) if m else ""
        return [PlannedCall("search_sessions", {"query": query}, expand="tasks_from_action_items")]
    return None


def _parse_create_task(c: str) -> list[PlannedCall] | None:
    if not re.search(r"\b(?:create|add|make|new|assign|open)\b", c, re.IGNORECASE):
        return None
    if not re.search(r"\b(?:task|todo|to-do|ticket|card)\b", c, re.IGNORECASE):
        return None
    title = _named(c)
    if not title:
        m = re.search(r"\b(?:task|todo|to-do|ticket|card)\s*(?:to|for|:)\s+(?P<t>.+)$", c, re.IGNORECASE)
        title = _clean(m.group("t")) if m else None
        if title:
            title = _clean(re.sub(r"\s+(?:with|at|as)\s+(?:an?\s+)?(?:urgent|high|medium|low)\s+priority$|\s+(?:urgently|asap)$",
                                  "", title, flags=re.IGNORECASE))
    if not title:
        return None
    return [PlannedCall("create_task", {"title": title, "priority": _priority(c), "status": _task_status(c)})]


def _parse_transaction(c: str) -> list[PlannedCall] | None:
    m = re.search(
        r"\b(?:log|record|add|track|enter)\s+(?:an?\s+|the\s+)?(?P<kind>expense|income|revenue|payment|cost|sale)s?\b"
        r".*?\$?\s?(?P<amt>\d[\d,]*(?:\.\d+)?)\s*(?:k\b)?"
        r"(?:\s*(?:usd|dollars))?(?:\s+(?:for|on|under|from|as)\s+(?P<cat>.+))?$",
        c, re.IGNORECASE,
    )
    if not m:
        return None
    amount = float(m.group("amt").replace(",", ""))
    if re.search(rf"{re.escape(m.group('amt'))}\s*k\b", c, re.IGNORECASE):
        amount *= 1000
    kind = "income" if m.group("kind").lower() in {"income", "revenue", "sale"} else "expense"
    category = _unquote(m.group("cat") or "")
    if not category:
        return None
    args = {"type": kind, "amount": amount, "category": category}
    if when := parse_date(c):
        args["date"] = when
        args["category"] = _clean(re.sub(r"\b(?:today|yesterday|tomorrow|on\s+\d{4}-\d{2}-\d{2})\b", "", category, flags=re.IGNORECASE))
    return [PlannedCall("create_transaction", args)]


def _parse_finance_query(c: str) -> list[PlannedCall] | None:
    if re.search(r"\b(?:cash|balance|runway|burn|finances?|financial|revenue|expenses?|spending|budget|money)\b", c, re.IGNORECASE) and \
       not re.search(r"\b(?:log|record|add|track|enter)\b", c, re.IGNORECASE):
        return [PlannedCall("search_finance", {})]
    return None


def _parse_repo(c: str) -> list[PlannedCall] | None:
    m = re.search(r"\b(?:create|make|add|new|set\s+up)\b.*?\b(?:repo|repository)\b", c, re.IGNORECASE)
    if not m:
        return None
    name = _named(c)
    return [PlannedCall("create_repo", {"name": name})] if name else None


def _parse_channel(c: str) -> list[PlannedCall] | None:
    m = re.match(
        rf"^(?:please\s+)?(?:send|post)\s+(?:a\s+)?(?:message|msg|note|announcement)?\s*(?:{QUOTED}|(?P<bare>.+?))\s+"
        r"(?:to|in|on)\s+(?:the\s+)?(?:channel\s+)?#?(?P<ch>[\w-]+)(?:\s+channel)?$",
        c, re.IGNORECASE,
    )
    if m:
        content = _group_text(m)
        if content:
            return [PlannedCall("post_channel_message", {"channel_name": m.group("ch"), "content": content})]
    if re.search(r"\b(?:create|make|add|new|start|open)\b.*\bchannel\b", c, re.IGNORECASE):
        name = _named(c)
        if not name:
            m = re.search(r"\bchannel\s+#?(?P<n>[\w-]+)", c, re.IGNORECASE)
            name = m.group("n") if m and m.group("n").lower() not in {"named", "called", "titled", "for"} else None
        if name:
            return [PlannedCall("create_channel", {"name": name.lstrip("#"), "is_private": bool(re.search(r"\bprivate\b", c, re.I))})]
    return None


def _parse_calendar(c: str) -> list[PlannedCall] | None:
    m = re.search(
        r"\b(?:schedule|book|set\s+up|add|create|plan|put)\b.*?\b(?P<kind>meeting|call|event|deadline|reminder|milestone|sync|standup|review)\b",
        c, re.IGNORECASE,
    )
    if not m:
        return None
    when = parse_date(c)
    title = _first_quoted(c)
    if not title:
        mt = re.search(r"\b(?:for|called|titled|named|about)\s+(?P<t>.+?)(?=\s+(?:today|tomorrow|on|next|at|in)\b|$)", c, re.IGNORECASE)
        title = _clean(mt.group("t")) if mt else None
    if not title or not when:
        return None
    kind = m.group("kind").lower()
    event_type = kind if kind in {"meeting", "deadline", "reminder", "milestone"} else "meeting"
    args = {"title": title, "event_date": when, "event_type": event_type, "priority": _priority(c)}
    if t := parse_time(c):
        args["event_time"] = t
    return [PlannedCall("create_calendar_event", args)]


def _parse_search_documents(c: str) -> list[PlannedCall] | None:
    m = re.search(
        r"\b(?:search|find|look\s*up|look\s+for)\s+(?:in\s+)?(?:the\s+|my\s+)?(?:docs|documents|notes|files|pages)\s+(?:for|about|on|mentioning)\s+(?P<q>.+)$"
        r"|\b(?:search|find|look\s+for)\s+(?P<q2>.+?)\s+in\s+(?:the\s+|my\s+)?(?:docs|documents|notes|files)$",
        c, re.IGNORECASE,
    )
    if not m:
        return None
    query = _unquote(m.group("q") or m.group("q2"))
    return [PlannedCall("search_documents", {"query": query})] if query else None


def _parse_meeting_query(c: str) -> list[PlannedCall] | None:
    if re.search(r"\b(?:meeting|meetings|standup|sync|call|discussed|minutes|mom)\b", c, re.IGNORECASE) and \
       re.search(r"\b(?:what|summar|recap|show|list|find|search|tell)\w*", c, re.IGNORECASE):
        quoted = _first_quoted(c)
        return [PlannedCall("search_sessions", {"query": quoted or ""})]
    return None


def _parse_report(c: str) -> list[PlannedCall] | None:
    if not re.search(r"\b(?:generate|create|make|write|produce)\b.*\breport\b", c, re.IGNORECASE):
        return None
    lower = c.lower()
    report_type = (
        "financial_overview" if re.search(r"financ|runway|budget", lower)
        else "meeting_digest" if "meeting" in lower
        else "project_status" if re.search(r"project|status", lower)
        else "sprint_summary"
    )
    title = _named(c) or report_type.replace("_", " ").title()
    return [PlannedCall("generate_report", {"title": title, "report_type": report_type})]


PARSERS = [
    _parse_switch,
    _parse_meeting_tasks,
    _parse_edit_document,
    _parse_get_document,
    _parse_create_document,
    _parse_transaction,
    _parse_create_task,
    _parse_repo,
    _parse_channel,
    _parse_calendar,
    _parse_report,
    _parse_search_documents,
    _parse_finance_query,
    _parse_meeting_query,
]


NEGATION = re.compile(r"\b(?:don'?t|do not|never|no need to|stop|cancel|shouldn'?t|won'?t)\b", re.IGNORECASE)


def _outside_quotes(text: str, index: int) -> bool:
    return len(re.findall(rf"(?<!\w){QUOTE}|{QUOTE}(?!\w)", text[:index])) % 2 == 0


def _parse_clause(clause: str) -> list[PlannedCall] | None:
    clause = _clean(re.sub(r"^(?:please|can you|could you|would you|kindly|also|then)\s+", "", clause.strip(), flags=re.IGNORECASE))
    if not clause:
        return None
    unquoted = re.sub(QUOTED, "", clause)
    if NEGATION.search(unquoted):
        return None
    for parser in PARSERS:
        calls = parser(clause)
        if calls:
            return calls
    return None


def _split_points(text: str) -> list[re.Match]:
    return list(re.finditer(r"\s*(?:;|\band then\b|\bthen\b|\band\b|\balso\b)\s*", text, re.IGNORECASE))


def _plan_text(text: str) -> list[PlannedCall]:
    """Parse the whole text as one command, or split at a conjunction where both halves parse."""
    whole = _parse_clause(text)
    for point in _split_points(text):
        left, right = text[: point.start()], text[point.end():]
        left_calls = _parse_clause(left)
        if not left_calls:
            continue
        right_calls = _plan_text(right)
        if right_calls:
            return left_calls + right_calls
    return whole or []


def _sentences(text: str) -> list[str]:
    parts, start = [], 0
    for m in re.finditer(r"(?<=[.!?])\s+(?=[A-Z])", text):
        if _outside_quotes(text, m.start()):
            parts.append(text[start:m.start()])
            start = m.end()
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def plan(prompt: str) -> Plan:
    calls: list[PlannedCall] = []
    seen: set[tuple] = set()
    # Sentences are planned independently ("Create task 'A'. Log an expense of $5 for Food.")
    for sentence in _sentences(prompt.strip()):
        for call in _plan_text(sentence):
            key = (call.tool, tuple(sorted((k, str(v)) for k, v in call.args.items())), call.expand)
            if key not in seen:
                seen.add(key)
                calls.append(call)
    return Plan(calls=calls)
