import hashlib
import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import ContactMessage
from app.security import check_identity_limit, client_ip, limit_auth
from app.services.email_service import send_contact_message

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/contact", tags=["contact"])


class ContactRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    subject: str | None = Field(default=None, max_length=255)
    message: str = Field(min_length=1, max_length=5000)
    # Honeypot: hidden from people, filled in by naive bots.
    website: str | None = Field(default=None, max_length=255)


class ContactResponse(BaseModel):
    status: str = "received"


@router.post("", response_model=ContactResponse, status_code=202, dependencies=[Depends(limit_auth)])
async def submit_contact(data: ContactRequest, request: Request, db: AsyncSession = Depends(get_db, scope="function")) -> ContactResponse:
    """Store a contact-form message and forward it to CONTACT_INBOX_EMAIL when e-mail is configured."""
    if data.website:
        logger.info("Contact form honeypot triggered; message dropped")
        return ContactResponse()
    check_identity_limit("contact", data.email, 3, 60 * 60)

    settings = get_settings()
    ip_hash = hashlib.sha256(f"{settings.jwt_secret_key}:{client_ip(request)}".encode()).hexdigest()
    record = ContactMessage(
        name=data.name,
        email=data.email.lower(),
        subject=data.subject or None,
        message=data.message,
        client_ip_hash=ip_hash,
        delivered=False,
    )
    db.add(record)
    await db.flush()

    if settings.contact_inbox_email and settings.smtp_configured:
        record.delivered = await send_contact_message(
            settings.contact_inbox_email, data.name, data.email, data.subject or "", data.message
        )
        await db.flush()
    return ContactResponse()
