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
    """Send an email via SMTP. Returns True only when the server accepted the message.

    Never logs the subject or body: they can contain verification codes.
    """
    if not get_settings().smtp_configured:
        logger.warning("Email to %s not sent: SMTP is not configured", mask_email(to_email))
        return False

    try:
        await asyncio.to_thread(_send_smtp_sync, to_email, subject, html_content, text_content)
    except Exception as exc:  # SMTP errors must not leak to clients or crash the request
        logger.error("Email to %s failed: %s", mask_email(to_email), exc.__class__.__name__)
        return False
    logger.info("Email sent to %s", mask_email(to_email))
    return True


def mask_email(address: str) -> str:
    """j***@example.com — enough to debug delivery without logging the full address."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


async def send_account_exists_notice(to_email: str) -> bool:
    """Sent instead of a code when someone tries to register an address that already has an account.

    Keeps the API response identical for new and existing addresses (no account enumeration)."""
    subject = "Someone tried to create a NexaMind account with your email"
    text = (
        "Someone (hopefully you) tried to create a new NexaMind account with this email address, "
        "but you already have one.\n\n"
        "Sign in instead, or use 'Forgot password' on the sign-in screen to reset your password.\n\n"
        "If this wasn't you, you can ignore this email."
    )
    html = f"<p>{text.replace(chr(10) + chr(10), '</p><p>')}</p>"
    return await send_email(to_email, subject, html, text)


async def send_contact_message(to_email: str, name: str, sender: str, subject: str, message: str) -> bool:
    import html as html_lib

    mail_subject = f"[NexaMind contact] {subject or 'New message'}"[:200]
    text = f"From: {name} <{sender}>\n\n{message}"
    body = f"<p><strong>From:</strong> {html_lib.escape(name)} &lt;{html_lib.escape(sender)}&gt;</p>" \
           f"<pre style='white-space:pre-wrap'>{html_lib.escape(message)}</pre>"
    return await send_email(to_email, mail_subject, body, text)


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
              {"If you didn't ask to reset your NexaMind password, you can ignore this email; your password is unchanged." if purpose == "reset_password" else "If you didn't attempt to sign up for NexaMind, you can safely ignore this email."}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    return await send_email(to_email, subject, html_content, text_content)
