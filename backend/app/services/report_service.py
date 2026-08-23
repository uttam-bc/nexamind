import json
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, ReportRecord, ReportType, SessionRecord, User
from app.schemas.report import ReportGenerateRequest
from app.services.auth_service import AuthError
from app.services.finance_service import calculate_runway
from app.services.websocket_manager import ws_manager
from app.services.workspace_service import get_workspace_membership

logger = logging.getLogger(__name__)


async def list_reports(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    report_type: ReportType | None = None,
    limit: int = 50,
) -> list[ReportRecord]:
    await _require_workspace_access(db, workspace_id, user_id)
    query = select(ReportRecord).where(ReportRecord.workspace_id == workspace_id)
    if report_type is not None:
        query = query.where(ReportRecord.report_type == report_type)
    query = query.order_by(ReportRecord.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_report(
    db: AsyncSession,
    workspace_id: UUID,
    report_id: UUID,
    user_id: UUID,
) -> ReportRecord:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(ReportRecord).where(
            ReportRecord.id == report_id,
            ReportRecord.workspace_id == workspace_id,
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise AuthError("Report not found", status_code=404)
    return report


async def generate_report(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: ReportGenerateRequest,
) -> ReportRecord:
    await _require_workspace_access(db, workspace_id, user.id)

    # 1. Retrieve scoped sessions
    session_query = select(SessionRecord).where(SessionRecord.workspace_id == workspace_id)
    if data.session_ids:
        session_query = session_query.where(SessionRecord.id.in_(data.session_ids))
    else:
        session_query = session_query.order_by(SessionRecord.created_at.desc()).limit(5)

    session_result = await db.execute(session_query)
    sessions = list(session_result.scalars().all())

    # 2. Retrieve scoped documents
    doc_query = select(Document).where(Document.workspace_id == workspace_id)
    if data.document_ids:
        doc_query = doc_query.where(Document.id.in_(data.document_ids))
    else:
        doc_query = doc_query.order_by(Document.created_at.desc()).limit(5)

    doc_result = await db.execute(doc_query)
    documents = list(doc_result.scalars().all())

    # 3. Retrieve finance metrics if financial report
    finance_info = None
    if data.report_type == ReportType.FINANCIAL_OVERVIEW:
        finance_info = await calculate_runway(db, workspace_id, user.id)

    # 4. Synthesize structured report
    content, summary = _synthesize_report_content(
        title=data.title,
        report_type=data.report_type,
        sessions=sessions,
        documents=documents,
        finance_info=finance_info,
        custom_prompt=data.custom_prompt,
    )

    source_session_ids = [str(s.id) for s in sessions]
    source_document_ids = [str(d.id) for d in documents]

    report = ReportRecord(
        workspace_id=workspace_id,
        title=data.title.strip(),
        report_type=data.report_type,
        content=content,
        summary=summary,
        source_session_ids=source_session_ids,
        source_document_ids=source_document_ids,
        created_by=user.id,
    )
    db.add(report)
    await db.flush()
    await db.refresh(report)

    # Broadcast report creation
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {
            "event": "report_created",
            "workspace_id": str(workspace_id),
            "report_id": str(report.id),
            "title": report.title,
            "report_type": report.report_type.value,
        },
    )

    return report


async def delete_report(
    db: AsyncSession,
    workspace_id: UUID,
    report_id: UUID,
    user_id: UUID,
) -> None:
    report = await get_report(db, workspace_id, report_id, user_id)
    await db.delete(report)
    await db.flush()


def _synthesize_report_content(
    title: str,
    report_type: ReportType,
    sessions: list[SessionRecord],
    documents: list[Document],
    finance_info: dict | None = None,
    custom_prompt: str | None = None,
) -> tuple[str, str]:
    """Generates structured markdown report synthesized from retrieved workspace assets."""
    summary = f"Synthesized report '{title}' covering {len(sessions)} session(s) and {len(documents)} document(s)."
    
    sections = [
        f"# {title}",
        f"**Report Type:** {report_type.value.replace('_', ' ').title()}",
        f"**Executive Summary:** {summary}\n",
        "## 1. Scope & Source Attribution",
    ]

    if sessions:
        sections.append("### Referenced Meeting Sessions:")
        for s in sessions:
            sections.append(f"- **{s.title}** (Session ID: `{s.id}`) — *Status:* `{s.status.value}`")
    else:
        sections.append("- *No meeting sessions referenced in this scope.*")

    if documents:
        sections.append("\n### Referenced Documents:")
        for d in documents:
            sections.append(f"- **{d.title}** (Document ID: `{d.id}`)")
    else:
        sections.append("- *No documents referenced in this scope.*")

    sections.append("\n## 2. Key Highlights & Discussion")
    for s in sessions:
        if s.ai_summary:
            sections.append(f"#### From '{s.title}':")
            sections.append(s.ai_summary)

    sections.append("\n## 3. Action Items & Next Deliverables")
    all_action_items = []
    for s in sessions:
        for item in s.action_items or []:
            all_action_items.append(f"{item} *(from {s.title})*")

    if all_action_items:
        for item in all_action_items:
            sections.append(f"- [ ] {item}")
    else:
        sections.append("- [ ] Continue sprint velocity and review milestone progress.")

    if finance_info:
        sections.append("\n## 4. Financial Health & Runway")
        cash = finance_info.get("cash_balance", 0.0)
        burn = finance_info.get("net_burn_rate", 0.0)
        runway = finance_info.get("runway_months")
        runway_str = f"{runway} months" if runway is not None else "Profitable / positive net cash flow"
        sections.append(f"- **Cash Balance:** ${cash:,.2f}")
        sections.append(f"- **Net Monthly Burn Rate:** ${burn:,.2f}")
        sections.append(f"- **Estimated Runway:** {runway_str}")

    if custom_prompt:
        sections.append(f"\n## 5. Custom Analysis\n{custom_prompt}")

    content = "\n".join(sections)
    return content, summary


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
