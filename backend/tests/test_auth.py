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


@pytest.mark.asyncio
async def test_otp_send_verify_and_register(client: AsyncClient) -> None:
    email = "david@example.com"

    # 1. Send OTP
    send_resp = await client.post("/auth/send-otp", json={"email": email, "purpose": "register"})
    assert send_resp.status_code == 200
    data = send_resp.json()
    assert data["email"] == email
    otp = data.get("dev_code")
    assert otp is not None
    assert len(otp) == 6

    # 2. Try invalid OTP
    bad_resp = await client.post("/auth/verify-otp", json={"email": email, "otp": "000000", "purpose": "register"})
    assert bad_resp.status_code == 400

    # 3. Verify valid OTP
    good_resp = await client.post("/auth/verify-otp", json={"email": email, "otp": otp, "purpose": "register"})
    assert good_resp.status_code == 200
    assert good_resp.json()["verified"] is True

    # 4. Register with the email
    reg_resp = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "securepass123",
            "name": "David",
        },
    )
    assert reg_resp.status_code == 201
    assert reg_resp.json()["user"]["email"] == email


@pytest.mark.asyncio
async def test_otp_rejects_disposable_email(client: AsyncClient) -> None:
    resp = await client.post("/auth/send-otp", json={"email": "spammer@mailinator.com", "purpose": "register"})
    assert resp.status_code == 400
    assert "disposable" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_google_auth_flow(client: AsyncClient) -> None:
    mock_credential = "mock_google_:gtest@example.com:Google Tester"
    resp = await client.post("/auth/google", json={"credential": mock_credential})
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["email"] == "gtest@example.com"
    assert data["user"]["name"] == "Google Tester"
    assert "access_token" in data

    # Re-authenticating should log in without error
    resp2 = await client.post("/auth/google", json={"credential": mock_credential})
    assert resp2.status_code == 200
    assert resp2.json()["user"]["email"] == "gtest@example.com"
