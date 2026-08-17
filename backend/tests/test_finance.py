import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_finance_transactions_and_runway(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Create income transaction
    income_res = await client.post(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
        json={
            "type": "income",
            "amount": 10000.00,
            "category": "Investment",
            "date": "2026-08-01T00:00:00Z",
            "description": "Initial Seed Capital",
        },
    )
    assert income_res.status_code == 201
    assert income_res.json()["amount"] == 10000.00

    # Create expense transaction
    expense_res = await client.post(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
        json={
            "type": "expense",
            "amount": 2000.00,
            "category": "Software Infrastructure",
            "date": "2026-08-10T00:00:00Z",
            "description": "Railway and Neon hosting",
        },
    )
    assert expense_res.status_code == 201
    assert expense_res.json()["amount"] == 2000.00

    # List transactions
    list_res = await client.get(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
    )
    assert list_res.status_code == 200
    assert len(list_res.json()) == 2

    # Filter transactions by type
    income_only = await client.get(
        f"/workspaces/{workspace_id}/finance/transactions?type=income",
        headers=auth_headers(token),
    )
    assert income_only.status_code == 200
    assert len(income_only.json()) == 1
    assert income_only.json()[0]["type"] == "income"

    # Calculate Runway
    runway_res = await client.get(
        f"/workspaces/{workspace_id}/finance/runway",
        headers=auth_headers(token),
    )
    assert runway_res.status_code == 200
    runway = runway_res.json()
    assert runway["total_income"] == 10000.00
    assert runway["total_expenses"] == 2000.00
    assert runway["cash_balance"] == 8000.00
