"""Regression tests for the audit's authentication findings (NX-SEC-001..006, NX-BUG-018)."""

import datetime as dt
import time

import jwt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from httpx import AsyncClient
from sqlalchemy import func, select

from app.config import get_settings
from app.models import EmailVerification
from app.services import auth_service
from tests.conftest import auth_headers

GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com"


async def _register(client: AsyncClient, email: str, password: str = "securepass123", name: str = "User") -> dict:
    resp = await client.post("/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def production_email(monkeypatch):
    """Dev shortcuts off and SMTP 'configured'; outgoing mail captured instead of sent."""
    settings = get_settings()
    monkeypatch.setattr(settings, "enable_dev_auth", False)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_user", "mailer")
    monkeypatch.setattr(settings, "smtp_password", "not-a-real-password")
    outbox: list[tuple[str, str, str | None]] = []

    async def fake_otp(to_email, code, purpose="register"):
        outbox.append(("otp", to_email, code))
        return True

    async def fake_notice(to_email):
        outbox.append(("exists", to_email, None))
        return True

    monkeypatch.setattr(auth_service, "send_verification_otp", fake_otp)
    monkeypatch.setattr(auth_service, "send_account_exists_notice", fake_notice)
    return outbox


# --- OTP / registration ---------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_otp_does_not_reveal_existing_accounts(client: AsyncClient, production_email) -> None:
    await _register(client, "taken@example.com")

    new = await client.post("/auth/send-otp", json={"email": "fresh@example.com"})
    existing = await client.post("/auth/send-otp", json={"email": "taken@example.com"})

    assert new.status_code == existing.status_code == 200
    strip = lambda body: {k: v for k, v in body.items() if k != "email"}  # noqa: E731
    assert strip(new.json()) == strip(existing.json())
    assert new.json()["dev_code"] is None
    assert [kind for kind, *_ in production_email] == ["otp", "exists"]


@pytest.mark.asyncio
async def test_send_otp_fails_closed_without_smtp(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "enable_dev_auth", False)
    resp = await client.post("/auth/send-otp", json={"email": "nosmtp@example.com"})
    assert resp.status_code == 503
    assert "dev_code" not in resp.text


@pytest.mark.asyncio
async def test_failed_delivery_is_reported_and_not_left_pending(client: AsyncClient, db_session, production_email, monkeypatch) -> None:
    async def failing(*_args, **_kwargs):
        return False

    monkeypatch.setattr(auth_service, "send_verification_otp", failing)
    resp = await client.post("/auth/send-otp", json={"email": "bounce@example.com"})
    assert resp.status_code == 503
    count = (await db_session.execute(
        select(func.count(EmailVerification.id)).where(EmailVerification.email == "bounce@example.com"))).scalar()
    assert count == 0


@pytest.mark.asyncio
async def test_register_requires_code_before_revealing_duplicates(client: AsyncClient, production_email, monkeypatch) -> None:
    await _register(client, "dup@example.com")
    monkeypatch.setattr(get_settings(), "require_email_verification", True)

    no_code = await client.post("/auth/register", json={"email": "dup@example.com", "password": "securepass123", "name": "X"})
    assert no_code.status_code == 400  # not 409: an attacker without the inbox learns nothing

    await client.post("/auth/send-otp", json={"email": "new@example.com"})
    code = production_email[-1][2]
    ok = await client.post("/auth/register", json={"email": "new@example.com", "password": "securepass123", "name": "N", "otp": code})
    assert ok.status_code == 201
    assert ok.json()["user"]["is_email_verified"] is True


@pytest.mark.asyncio
async def test_otp_codes_are_limited_to_five_attempts(client: AsyncClient) -> None:
    send = await client.post("/auth/send-otp", json={"email": "guess@example.com"})
    code = send.json()["dev_code"]
    wrong = "111111" if code != "111111" else "222222"
    for _ in range(5):
        assert (await client.post("/auth/verify-otp", json={"email": "guess@example.com", "otp": wrong})).status_code == 400
    locked = await client.post("/auth/verify-otp", json={"email": "guess@example.com", "otp": code})
    assert locked.status_code == 429


# --- Google sign-in -------------------------------------------------------------------------

@pytest.fixture
def google_keys(monkeypatch):
    """A self-signed key pair standing in for Google's published signing certificates."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test-google")])
    now = dt.datetime.now(dt.UTC)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(1).not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=1))
            .sign(key, hashes.SHA256()))
    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()

    from google.oauth2 import id_token
    monkeypatch.setattr(id_token, "_fetch_certs", lambda *_a, **_k: {"kid1": cert_pem})
    monkeypatch.setattr(get_settings(), "google_client_id", GOOGLE_CLIENT_ID)
    monkeypatch.setattr(get_settings(), "enable_dev_auth", False)

    def make(email="g@example.com", sub="google-sub-1", aud=GOOGLE_CLIENT_ID, verified=True,
             iss="https://accounts.google.com", signer=key, exp_offset=600):
        now_ts = int(time.time())
        claims = {"iss": iss, "aud": aud, "sub": sub, "email": email, "email_verified": verified,
                  "name": "Google Person", "iat": now_ts, "exp": now_ts + exp_offset}
        pem = signer.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                   serialization.NoEncryption())
        return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": "kid1"})

    return make


@pytest.mark.asyncio
async def test_google_requires_configuration(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "enable_dev_auth", False)
    resp = await client.post("/auth/google", json={"credential": "mock_google_:x@example.com:X"})
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_google_mock_credentials_rejected_outside_dev(client: AsyncClient, google_keys) -> None:
    resp = await client.post("/auth/google", json={"credential": "mock_google_:victim@example.com:Victim"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_google_valid_token_signs_in(client: AsyncClient, google_keys) -> None:
    resp = await client.post("/auth/google", json={"credential": google_keys()})
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["email"] == "g@example.com"
    again = await client.post("/auth/google", json={"credential": google_keys()})
    assert again.json()["user"]["id"] == resp.json()["user"]["id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("variant", ["forged", "audience", "issuer", "expired", "unverified"])
async def test_google_rejects_bad_tokens(client: AsyncClient, google_keys, variant: str) -> None:
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = {
        "forged": lambda: google_keys(signer=other_key),
        "audience": lambda: google_keys(aud="someone-else.apps.googleusercontent.com"),
        "issuer": lambda: google_keys(iss="https://evil.example.com"),
        "expired": lambda: google_keys(exp_offset=-3600),
        "unverified": lambda: google_keys(verified=False),
    }[variant]()
    resp = await client.post("/auth/google", json={"credential": token})
    assert resp.status_code in (400, 401)
    assert "access_token" not in resp.text


@pytest.mark.asyncio
async def test_google_does_not_take_over_unverified_password_account(client: AsyncClient, google_keys, monkeypatch) -> None:
    await _register(client, "squat@example.com")  # verification off: account is unverified
    resp = await client.post("/auth/google", json={"credential": google_keys(email="squat@example.com")})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_google_links_verified_account(client: AsyncClient, google_keys, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "enable_dev_auth", True)
    code = (await client.post("/auth/send-otp", json={"email": "link@example.com"})).json()["dev_code"]
    reg = await client.post("/auth/register", json={"email": "link@example.com", "password": "securepass123", "name": "L", "otp": code})
    monkeypatch.setattr(get_settings(), "enable_dev_auth", False)
    resp = await client.post("/auth/google", json={"credential": google_keys(email="link@example.com")})
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == reg.json()["user"]["id"]


# --- Sessions, password and account lifecycle -----------------------------------------------

@pytest.mark.asyncio
async def test_logout_revokes_token(client: AsyncClient, auth_context: dict) -> None:
    headers = auth_headers(auth_context["token"])
    assert (await client.post("/auth/logout", headers=headers)).status_code == 204
    assert (await client.get("/auth/me", headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_change_password_revokes_other_sessions(client: AsyncClient, auth_context: dict) -> None:
    old = auth_headers(auth_context["token"])
    wrong = await client.post("/auth/change-password", headers=old,
                              json={"current_password": "nope", "new_password": "newpass456"})
    assert wrong.status_code == 400
    resp = await client.post("/auth/change-password", headers=old,
                             json={"current_password": "securepass123", "new_password": "newpass456"})
    assert resp.status_code == 200
    assert (await client.get("/auth/me", headers=old)).status_code == 401
    assert (await client.get("/auth/me", headers=auth_headers(resp.json()["access_token"]))).status_code == 200
    login = await client.post("/auth/login", json={"email": "testuser@example.com", "password": "newpass456"})
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_password_reset_flow(client: AsyncClient, auth_context: dict) -> None:
    unknown = await client.post("/auth/send-otp", json={"email": "nobody@example.com", "purpose": "reset_password"})
    assert unknown.status_code == 200 and unknown.json()["dev_code"] is None

    send = await client.post("/auth/send-otp", json={"email": "testuser@example.com", "purpose": "reset_password"})
    code = send.json()["dev_code"]
    bad = await client.post("/auth/reset-password", json={"email": "testuser@example.com", "otp": "000000" if code != "000000" else "111111", "new_password": "resetpass789"})
    assert bad.status_code == 400
    ok = await client.post("/auth/reset-password", json={"email": "testuser@example.com", "otp": code, "new_password": "resetpass789"})
    assert ok.status_code == 204
    assert (await client.get("/auth/me", headers=auth_headers(auth_context["token"]))).status_code == 401
    assert (await client.post("/auth/login", json={"email": "testuser@example.com", "password": "resetpass789"})).status_code == 200
    reuse = await client.post("/auth/reset-password", json={"email": "testuser@example.com", "otp": code, "new_password": "another123"})
    assert reuse.status_code == 400


@pytest.mark.asyncio
async def test_register_code_cannot_reset_password(client: AsyncClient, auth_context: dict) -> None:
    code = (await client.post("/auth/send-otp", json={"email": "other@example.com"})).json()["dev_code"]
    resp = await client.post("/auth/reset-password", json={"email": "other@example.com", "otp": code, "new_password": "resetpass789"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_profile(client: AsyncClient, auth_context: dict) -> None:
    await _register(client, "second@example.com", name="Second")
    headers = auth_headers(auth_context["token"])
    resp = await client.patch("/auth/me", headers=headers, json={"name": "  Renamed  ", "username": "@new_name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed" and resp.json()["username"] == "new_name"
    assert (await client.patch("/auth/me", headers=headers, json={"name": "   "})).status_code == 422
    assert (await client.patch("/auth/me", headers=headers, json={"username": "second"})).status_code == 409


@pytest.mark.asyncio
async def test_delete_account(client: AsyncClient, auth_context: dict) -> None:
    headers = auth_headers(auth_context["token"])
    wrong = await client.request("DELETE", "/auth/me", headers=headers, json={"password": "nope"})
    assert wrong.status_code == 400
    resp = await client.request("DELETE", "/auth/me", headers=headers, json={"password": "securepass123"})
    assert resp.status_code == 204
    assert (await client.get("/auth/me", headers=headers)).status_code == 401
    assert (await client.post("/auth/login", json={"email": "testuser@example.com", "password": "securepass123"})).status_code == 401
    # The address is released and can be registered again.
    await _register(client, "testuser@example.com")


@pytest.mark.asyncio
async def test_delete_account_blocked_while_owning_shared_team(client: AsyncClient, auth_context: dict) -> None:
    headers = auth_headers(auth_context["token"])
    team = await client.post("/workspaces", headers=headers, json={"name": "Team", "type": "team"})
    assert team.status_code in (200, 201), team.text
    other = await _register(client, "member@example.com")
    join = await client.post("/workspaces/join", headers=auth_headers(other["access_token"]),
                             json={"join_code": team.json()["join_code"]})
    assert join.status_code in (200, 201), join.text
    resp = await client.request("DELETE", "/auth/me", headers=headers, json={"password": "securepass123"})
    assert resp.status_code == 409
    assert "Team" in resp.json()["detail"]


# --- Rate limiting --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_spoofed_forwarded_for_does_not_bypass_limits(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", True)
    monkeypatch.setattr(get_settings(), "rate_limit_auth_per_minute", 3)
    statuses = []
    for i in range(5):
        resp = await client.post("/auth/login", headers={"X-Forwarded-For": f"10.0.0.{i}"},
                                 json={"email": f"x{i}@example.com", "password": "whatever1"})
        statuses.append(resp.status_code)
    assert statuses[-1] == 429


@pytest.mark.asyncio
async def test_per_account_login_limit(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", True)
    monkeypatch.setattr(get_settings(), "rate_limit_auth_per_minute", 1000)
    monkeypatch.setattr(get_settings(), "client_ip_header", "cf-connecting-ip")
    statuses = []
    for i in range(12):
        resp = await client.post("/auth/login", headers={"cf-connecting-ip": f"203.0.113.{i}"},
                                 json={"email": "target@example.com", "password": "guess1234"})
        statuses.append(resp.status_code)
    assert statuses[:10] == [401] * 10
    assert statuses[10:] == [429, 429]


def test_client_ip_resolution(monkeypatch) -> None:
    from starlette.requests import Request

    from app.security import client_ip

    def request(headers: dict) -> Request:
        return Request({"type": "http", "client": ("198.51.100.7", 1234),
                        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]})

    settings = get_settings()
    assert client_ip(request({"X-Forwarded-For": "1.2.3.4"})) == "198.51.100.7"
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    assert client_ip(request({"X-Forwarded-For": "1.2.3.4, 203.0.113.9"})) == "203.0.113.9"
    monkeypatch.setattr(settings, "client_ip_header", "cf-connecting-ip")
    assert client_ip(request({"cf-connecting-ip": "192.0.2.1", "X-Forwarded-For": "1.2.3.4"})) == "192.0.2.1"
