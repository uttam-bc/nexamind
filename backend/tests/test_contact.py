"""NX-BUG-004: the contact form must store (and, when configured, e-mail) messages."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import get_settings
from app.models import ContactMessage
from app.routers import contact as contact_router

MESSAGE = {"name": "Alex", "email": "alex@example.com", "subject": "Hi", "message": "Hello there"}


@pytest.mark.asyncio
async def test_contact_message_is_stored(client: AsyncClient, db_session) -> None:
    resp = await client.post("/contact", json=MESSAGE)
    assert resp.status_code == 202
    rows = (await db_session.execute(select(ContactMessage))).scalars().all()
    assert len(rows) == 1
    assert rows[0].message == "Hello there" and rows[0].delivered is False
    assert rows[0].client_ip_hash and "127.0.0.1" not in rows[0].client_ip_hash


@pytest.mark.asyncio
async def test_contact_forwarded_when_configured(client: AsyncClient, db_session, monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "contact_inbox_email", "inbox@example.com")
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_user", "u")
    monkeypatch.setattr(settings, "smtp_password", "p")
    sent = []

    async def fake_send(to, name, sender, subject, message):
        sent.append((to, sender, message))
        return True

    monkeypatch.setattr(contact_router, "send_contact_message", fake_send)
    assert (await client.post("/contact", json=MESSAGE)).status_code == 202
    assert sent == [("inbox@example.com", "alex@example.com", "Hello there")]
    row = (await db_session.execute(select(ContactMessage))).scalar_one()
    assert row.delivered is True


@pytest.mark.asyncio
async def test_contact_honeypot_and_validation(client: AsyncClient, db_session) -> None:
    assert (await client.post("/contact", json={**MESSAGE, "website": "http://spam"})).status_code == 202
    assert (await client.post("/contact", json={**MESSAGE, "message": "   "})).status_code == 422
    assert (await client.post("/contact", json={**MESSAGE, "name": "  "})).status_code == 422
    assert (await db_session.execute(select(ContactMessage))).scalars().all() == []


@pytest.mark.asyncio
async def test_contact_per_sender_limit(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", True)
    monkeypatch.setattr(get_settings(), "rate_limit_auth_per_minute", 100)
    codes = [(await client.post("/contact", json=MESSAGE)).status_code for _ in range(4)]
    assert codes == [202, 202, 202, 429]
