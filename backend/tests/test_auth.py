import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_register_login_and_me(client: AsyncClient) -> None:
    register_response = await client.post(
        "/auth/register",
        json={
            "email": "alice@example.com",
            "password": "securepass123",
            "name": "Alice",
        },
    )
    assert register_response.status_code == 201
    register_data = register_response.json()
    assert register_data["user"]["email"] == "alice@example.com"
    assert "access_token" in register_data

    login_response = await client.post(
        "/auth/login",
        json={"email": "alice@example.com", "password": "securepass123"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]

    me_response = await client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["name"] == "Alice"


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient) -> None:
    payload = {
        "email": "bob@example.com",
        "password": "securepass123",
        "name": "Bob",
    }
    first = await client.post("/auth/register", json=payload)
    assert first.status_code == 201

    second = await client.post("/auth/register", json=payload)
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient) -> None:
    await client.post(
        "/auth/register",
        json={
            "email": "carol@example.com",
            "password": "securepass123",
            "name": "Carol",
        },
    )

    response = await client.post(
        "/auth/login",
        json={"email": "carol@example.com", "password": "wrong-password"},
    )
    assert response.status_code == 401
