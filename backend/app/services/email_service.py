import asyncio
import email.message
import logging
import smtplib
from email.utils import formataddr

from email_validator import EmailNotValidError, validate_email

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Known disposable/temporary email domains to prevent spam accounts
DISPOSABLE_EMAIL_DOMAINS = {
    "mailinator.com",
    "tempmail.com",
    "10minutemail.com",
    "guerrillamail.com",
    "throwawaymail.com",
    "yopmail.com",
    "dispostable.com",
    "trashmail.com",
    "fakeinbox.com",
    "sharklasers.com",
    "getairmail.com",
    "maildrop.cc",
    "mohmal.com",
    "temp-mail.org",
    "burnermail.io",
}


def validate_email_address(email_address: str, check_deliverability: bool = True) -> str:
    """Validate email syntax, check domain MX records, and reject disposable emails."""
    clean_email = email_address.strip().lower()
    domain = clean_email.split("@")[-1] if "@" in clean_email else ""
    if domain in DISPOSABLE_EMAIL_DOMAINS:
        raise ValueError("Disposable or temporary email addresses are not allowed. Please use a valid email.")

    try:
        validated = validate_email(clean_email, check_deliverability=check_deliverability)
        return validated.normalized
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc


def _send_smtp_sync(to_email: str, subject: str, html_content: str, text_content: str) -> None:
    """Synchronous SMTP delivery helper run in a worker thread."""
    if not settings.smtp_host:
        raise RuntimeError("SMTP host not configured")

    msg = email.message.EmailMessage()
    msg["Subject"] = subject
    from_name = settings.smtp_from_name or "NexaMind"
    from_email = settings.smtp_from_email or (settings.smtp_user or "noreply@nexamind.com")
    msg["From"] = formataddr((from_name, from_email))
    msg["To"] = to_email

    msg.set_content(text_content)
    msg.add_alternative(html_content, subtype="html")

    port = settings.smtp_port or (465 if settings.smtp_ssl else 587)

    if settings.smtp_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, port, timeout=15) as server:
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, port, timeout=15) as server:
            if settings.smtp_tls:
                server.starttls()
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)


async def send_email(to_email: str, subject: str, html_content: str, text_content: str) -> bool:
    """Send an email asynchronously via SMTP.
    
    If SMTP is not configured, logs the email details for local testing and returns False.
    """
    if not (settings.smtp_host and settings.smtp_user and settings.smtp_password):
        logger.info(
            "\n"
            "======================================================================\n"
            " [NexaMind Email Service - SMTP Not Configured]\n"
            " To: %s\n"
            " Subject: %s\n"
            " Content preview:\n"
            " %s\n"
            " (To send real emails, set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in .env)\n"
            "======================================================================",
            to_email,
            subject,
            text_content[:300],
        )
        return False

    try:
        await asyncio.to_thread(_send_smtp_sync, to_email, subject, html_content, text_content)
        logger.info("Successfully sent email to %s (Subject: %s)", to_email, subject)
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_email, exc, exc_info=True)
        # In development, fall back gracefully
        if settings.is_development:
            return False
        raise


async def send_verification_otp(to_email: str, otp_code: str, purpose: str = "register") -> bool:
    """Send a 6-digit OTP verification email for registration or account security."""
    subject = f"{otp_code} is your NexaMind verification code"

    text_content = (
        f"Your NexaMind verification code is: {otp_code}\n\n"
        f"This code will expire in 10 minutes.\n\n"
        f"If you did not request this verification code, please ignore this email.\n\n"
        f"Welcome to NexaMind — Agentic AI workspace for high-velocity teams."
    )

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>NexaMind Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #E2E8F0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0F172A; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="520px" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #1E293B; border-radius: 20px; border: 1px solid #334155; padding: 36px; text-align: left; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <div style="display: inline-block; padding: 10px 18px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); border-radius: 12px; font-weight: 800; font-size: 18px; color: #FFFFFF; letter-spacing: 0.5px;">
                ⚡ NexaMind
              </div>
            </td>
          </tr>
          <tr>
            <td style="font-size: 22px; font-weight: 700; color: #F8FAFC; padding-bottom: 12px; text-align: center;">
              Confirm Your Email Address
            </td>
          </tr>
          <tr>
            <td style="font-size: 14px; line-height: 22px; color: #94A3B8; padding-bottom: 24px; text-align: center;">
              Use the following One-Time Password (OTP) to complete your registration on <strong>NexaMind</strong>:
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 12px 0 28px 0;">
              <div style="background-color: #0F172A; border: 2px dashed #6366F1; border-radius: 14px; padding: 18px 36px; display: inline-block;">
                <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #818CF8; font-family: 'Courier New', monospace;">
                  {otp_code}
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="font-size: 13px; line-height: 20px; color: #64748B; padding-bottom: 24px; text-align: center;">
              ⏱️ This verification code is valid for <strong>10 minutes</strong>.<br>
              Never share this code with anyone.
            </td>
          </tr>
          <tr>
            <td style="border-top: 1px solid #334155; padding-top: 20px; font-size: 12px; line-height: 18px; color: #64748B; text-align: center;">
              If you didn't attempt to sign up for NexaMind, you can safely ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    return await send_email(to_email, subject, html_content, text_content)
