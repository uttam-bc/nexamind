from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models import ReportType


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_generate_sprint_summary_report(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Create a document
    doc_res = await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
        json={"title": "NexaMind Phase 7 Spec"},
    )
    assert doc_res.status_code == 201
    doc_id = doc_res.json()["id"]

    # 2. Create a session
    sess_res = await client.post(
        f"/workspaces/{workspace_id}/sessions",
        headers=auth_headers(token),
        json={
            "title": "Sprint 4 Retrospective",
            "source": "notes",
            "transcript": "Team discussed report generation module.",
            "ai_summary": "Sprint 4 completed on schedule.",
            "action_items": ["Implement report synthesizer", "Write test suite"],
        },
    )
    assert sess_res.status_code == 201
    session_id = sess_res.json()["id"]

    # 3. Generate sprint summary report
    report_payload = {
        "title": "Sprint 4 Execution Report",
        "report_type": "sprint_summary",
        "session_ids": [session_id],
        "document_ids": [doc_id],
        "custom_prompt": "Focus on deliverable timelines and readiness for demo.",
    }
    gen_res = await client.post(
        f"/workspaces/{workspace_id}/reports/generate",
        headers=auth_headers(token),
        json=report_payload,
    )
    assert gen_res.status_code == 201
    report = gen_res.json()
    assert report["title"] == "Sprint 4 Execution Report"
    assert report["report_type"] == ReportType.SPRINT_SUMMARY
    assert "Sprint 4 Retrospective" in report["content"]
    assert "NexaMind Phase 7 Spec" in report["content"]
    assert "Implement report synthesizer" in report["content"]
    assert session_id in report["source_session_ids"]
    assert doc_id in report["source_document_ids"]
    assert report["summary"] is not None


@pytest.mark.asyncio
async def test_generate_financial_overview_report(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Add financial records
    await client.post(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
        json={"type": "income", "amount": 50000.0, "category": "Grant", "date": "2026-08-01"},
    )
    await client.post(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
        json={"type": "expense", "amount": 10000.0, "category": "Salaries", "date": "2026-08-05"},
    )

    # 2. Generate financial overview report
    report_payload = {
        "title": "Q3 Financial & Runway Overview",
        "report_type": "financial_overview",
    }
    gen_res = await client.post(
        f"/workspaces/{workspace_id}/reports/generate",
        headers=auth_headers(token),
        json=report_payload,
    )
    assert gen_res.status_code == 201
    report = gen_res.json()
    assert report["report_type"] == ReportType.FINANCIAL_OVERVIEW
    assert "Financial Health & Runway" in report["content"]
    assert "$40,000.00" in report["content"]  # Cash balance 50k - 10k


@pytest.mark.asyncio
async def test_list_get_and_delete_reports(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Generate a report
    gen_res = await client.post(
        f"/workspaces/{workspace_id}/reports/generate",
        headers=auth_headers(token),
        json={"title": "Test Report", "report_type": "custom"},
    )
    assert gen_res.status_code == 201
    report_id = gen_res.json()["id"]

    # List reports
    list_res = await client.get(
        f"/workspaces/{workspace_id}/reports",
        headers=auth_headers(token),
    )
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    # Get single report
    get_res = await client.get(
        f"/workspaces/{workspace_id}/reports/{report_id}",
        headers=auth_headers(token),
    )
    assert get_res.status_code == 200
    assert get_res.json()["title"] == "Test Report"

    # Delete report
    del_res = await client.delete(
        f"/workspaces/{workspace_id}/reports/{report_id}",
        headers=auth_headers(token),
    )
    assert del_res.status_code == 204

    # Confirm deleted
    get_after = await client.get(
        f"/workspaces/{workspace_id}/reports/{report_id}",
        headers=auth_headers(token),
    )
    assert get_after.status_code == 404


@pytest.mark.asyncio
async def test_report_access_control(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Create report in User 1's workspace
    gen_res = await client.post(
        f"/workspaces/{workspace_id}/reports/generate",
        headers=auth_headers(token),
        json={"title": "Private Strategic Plan", "report_type": "sprint_summary"},
    )
    assert gen_res.status_code == 201
    report_id = gen_res.json()["id"]

    # Register User 2
    user2_res = await client.post(
        "/auth/register",
        json={"email": "outsider_report@example.com", "password": "securepass123", "name": "Outsider"},
    )
    assert user2_res.status_code == 201
    user2_token = user2_res.json()["access_token"]

    # User 2 cannot access User 1's report -> 404 Access Denied
    get_res = await client.get(
        f"/workspaces/{workspace_id}/reports/{report_id}",
        headers=auth_headers(user2_token),
    )
    assert get_res.status_code == 404
