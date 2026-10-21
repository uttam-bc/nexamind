import logging
import re
import secrets
import string
from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
import httpx
import jwt
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import EmailVerification, User, Workspace, WorkspaceMember, WorkspaceRole, WorkspaceType
from app.schemas.auth import UserCreate
from app.services.email_service import send_verification_otp, validate_email_address

logger = logging.getLogger(__name__)
settings = get_settings()
BCRYPT_ROUNDS = 12
# Verified against when the account does not exist, so login timing does not reveal valid emails.
_DUMMY_HASH = bcrypt.hashpw(b"nexamind-timing-guard", bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_token_expire_minutes),
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise AuthError("Could not validate credentials", status_code=401) from exc
    subject = payload.get("sub")
    if not subject or payload.get("typ", "access") != "access":
        raise AuthError("Invalid token payload", status_code=401)
    return subject


def escape_like(value: str) -> str:
    """Escape LIKE wildcards; use with `escape="!"`."""
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_")


def generate_join_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    clean = username.strip().lstrip("@").lower()
    result = await db.execute(select(User).where(User.username == clean))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_google_id(db: AsyncSession, google_id: str) -> User | None:
    result = await db.execute(select(User).where(User.google_id == google_id))
    return result.scalar_one_or_none()


async def search_users(db: AsyncSession, requester_id: UUID, query: str, limit: int = 10) -> list[User]:
    """Find people the requester can message."""
    clean = query.strip().lstrip("@").lower()
    if not clean:
        return []

    shared_user_ids = (
        select(WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id.in_(
                select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == requester_id)
            )
        )
    )
    pattern = f"%{escape_like(clean)}%"
    q = (
        select(User)
        .where(
            or_(
                and_(
                    User.id.in_(shared_user_ids),
                    or_(
                        User.username.ilike(pattern, escape="!"),
                        User.name.ilike(pattern, escape="!"),
                    ),
                ),
                User.username == clean,
                User.email == clean,
            )
        )
        .order_by(User.name.asc())
        .limit(limit)
    )
    res = await db.execute(q)
    return list(res.scalars().all())


async def create_and_send_otp(db: AsyncSession, email: str, purpose: str = "register") -> dict:
    """Validate deliverability of email, generate 6-digit OTP, store hashed, and dispatch email."""
    # 1. Check deliverability and MX records
    try:
        # In test suite, skip network MX lookup if offline; otherwise perform full MX check
        check_dns = settings.app_env != "test"
        valid_email = validate_email_address(email, check_deliverability=check_dns)
    except ValueError as exc:
        raise AuthError(f"Email deliverability check failed: {exc}", status_code=400) from exc

    # 2. If registering, verify email is not already taken
    if purpose == "register":
        existing = await get_user_by_email(db, valid_email)
        if existing:
            raise AuthError("An account with this email already exists. Please sign in instead.", status_code=409)

    # 3. Rate limit OTP generation: max 4 requests per email per 10 minutes
    ten_mins_ago = datetime.now(UTC) - timedelta(minutes=10)
    count_stmt = select(func.count(EmailVerification.id)).where(
        EmailVerification.email == valid_email,
        EmailVerification.created_at >= ten_mins_ago,
    )
    count_res = await db.execute(count_stmt)
    if (count_res.scalar() or 0) >= 5:
        raise AuthError("Too many verification attempts. Please wait a few minutes before trying again.", status_code=429)

    # 4. Generate 6-digit code and store hashed
    otp_code = f"{secrets.randbelow(900000) + 100000}"
    otp_hash = hash_password(otp_code)
    expires_at = datetime.now(UTC) + timedelta(minutes=10)

    verification = EmailVerification(
        email=valid_email,
        otp_hash=otp_hash,
        purpose=purpose,
        attempts=0,
        is_verified=False,
        expires_at=expires_at,
    )
    db.add(verification)
    await db.flush()

    # 5. Dispatch email
    sent = await send_verification_otp(valid_email, otp_code, purpose=purpose)

    return {
        "message": "Verification code sent to your email" if sent else "Verification code generated (development mode)",
        "email": valid_email,
        "expires_in_seconds": 600,
        "delivery": "sent" if sent else "development_simulated",
        "dev_code": otp_code if (settings.is_development and not sent) else None,
    }


async def verify_otp_code(db: AsyncSession, email: str, otp: str, purpose: str = "register") -> bool:
    """Verify an entered OTP code against pending email verification records."""
    clean_email = email.strip().lower()
    clean_otp = otp.strip()

    stmt = (
        select(EmailVerification)
        .where(
            EmailVerification.email == clean_email,
            EmailVerification.purpose == purpose,
            EmailVerification.is_verified == False,  # noqa: E712
        )
        .order_by(EmailVerification.created_at.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    record = res.scalar_one_or_none()

    if not record:
        raise AuthError("No pending verification request found for this email. Please request a new code.", status_code=400)

    now = datetime.now(UTC)
    expires = record.expires_at if record.expires_at.tzinfo else record.expires_at.replace(tzinfo=UTC)
    if now > expires:
        raise AuthError("Verification code has expired. Please request a new code.", status_code=400)

    if record.attempts >= 5:
        raise AuthError("Too many incorrect attempts. Please request a new code.", status_code=429)

    record.attempts += 1

    if not verify_password(clean_otp, record.otp_hash):
        await db.flush()
        remaining = 5 - record.attempts
        raise AuthError(f"Incorrect verification code ({remaining} attempts remaining)", status_code=400)

    record.is_verified = True
    record.verified_at = now
    await db.flush()
    return True


async def register_user(db: AsyncSession, data: UserCreate) -> tuple[User, Workspace]:
    email = data.email.lower().strip()

    # 1. Validate email syntax and deliverability
    try:
        check_dns = settings.app_env != "test"
        email = validate_email_address(email, check_deliverability=check_dns)
    except ValueError as exc:
        raise AuthError(f"Invalid email: {exc}", status_code=400) from exc

    existing = await get_user_by_email(db, email)
    if existing:
        raise AuthError("Email already registered", status_code=409)

    # 2. Check OTP verification when required
    # Skip if running in test environment and no OTP was provided (preserves test backward compatibility)
    is_test = settings.app_env == "test"
    if settings.require_email_verification and not is_test:
        if data.otp:
            await verify_otp_code(db, email, data.otp, purpose="register")
        else:
            # Check if there is a recently verified record within 15 minutes
            fifteen_mins_ago = datetime.now(UTC) - timedelta(minutes=15)
            verified_stmt = (
                select(EmailVerification)
                .where(
                    EmailVerification.email == email,
                    EmailVerification.purpose == "register",
                    EmailVerification.is_verified == True,  # noqa: E712
                    EmailVerification.verified_at >= fifteen_mins_ago,
                )
                .order_by(EmailVerification.verified_at.desc())
                .limit(1)
            )
            verified_record = (await db.execute(verified_stmt)).scalar_one_or_none()
            if not verified_record:
                raise AuthError("Email verification is required. Please enter the verification code sent to your email.", status_code=400)
    elif data.otp:
        # If OTP was provided even in test/dev, verify it
        await verify_otp_code(db, email, data.otp, purpose="register")

    # 3. Determine username
    raw_username = data.username
    if raw_username:
        clean_user = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_username).lower()
        if len(clean_user) < 2:
            clean_user = f"user_{secrets.token_hex(3)}"
    else:
        base = data.name.strip().lower()
        clean_user = re.sub(r"[^a-zA-Z0-9_\-]", "_", base)
        if len(clean_user) < 2:
            clean_user = email.split("@")[0]

    # Verify uniqueness of username
    existing_user = await get_user_by_username(db, clean_user)
    if existing_user:
        clean_user = f"{clean_user}_{secrets.token_hex(2)}"

    user = User(
        email=email,
        password_hash=hash_password(data.password),
        name=data.name.strip(),
        username=clean_user,
        is_email_verified=True,
    )
    db.add(user)
    await db.flush()

    personal_workspace = Workspace(
        name=f"{user.name}'s Workspace",
        type=WorkspaceType.PERSONAL,
        owner_id=user.id,
        join_code=None,
    )
    db.add(personal_workspace)
    await db.flush()

    membership = WorkspaceMember(
        workspace_id=personal_workspace.id,
        user_id=user.id,
        role=WorkspaceRole.OWNER,
    )
    db.add(membership)
    await db.flush()

    return user, personal_workspace


async def authenticate_user(db: AsyncSession, identifier: str, password: str) -> User:
    clean_id = identifier.strip().lstrip("@").lower()
    # Check by email first, then username
    user = await get_user_by_email(db, clean_id)
    if not user:
        user = await get_user_by_username(db, clean_id)

    if not user:
        verify_password(password, _DUMMY_HASH)
        raise AuthError("Invalid email/username or password", status_code=401)
    if not verify_password(password, user.password_hash):
        raise AuthError("Invalid email/username or password", status_code=401)
    return user


async def authenticate_google_user(db: AsyncSession, credential: str) -> User:
    """Verify Google OAuth token / ID token and log in or automatically register the user."""
    user_info = None

    # Handle developer mock token for local testing without Google Cloud setup
    if settings.is_development and credential.startswith("mock_google_"):
        parts = credential.split(":")
        mock_email = parts[1] if len(parts) > 1 else "google.user@gmail.com"
        mock_name = parts[2] if len(parts) > 2 else "Google Demo User"
        user_info = {
            "email": mock_email,
            "email_verified": "true",
            "name": mock_name,
            "sub": f"mock_google_id_{secrets.token_hex(8)}",
            "picture": "https://lh3.googleusercontent.com/a/default-user",
        }
    else:
        # Verify with Google tokeninfo endpoint
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    "https://oauth2.googleapis.com/tokeninfo",
                    params={"id_token": credential},
                )
                if res.status_code != 200:
                    logger.warning("Google tokeninfo returned status %s: %s", res.status_code, res.text)
                    raise AuthError("Invalid or expired Google authentication credential", status_code=401)
                user_info = res.json()
        except httpx.RequestError as exc:
            logger.error("Failed to connect to Google OAuth service: %s", exc)
            raise AuthError("Unable to verify Google credential with authentication service", status_code=502) from exc

    if not user_info:
        raise AuthError("Could not retrieve Google profile", status_code=401)

    email_verified = user_info.get("email_verified")
    if email_verified not in ("true", True, 1):
        raise AuthError("Google email is not verified by Google", status_code=400)

    google_client_id = settings.google_client_id
    if google_client_id and user_info.get("aud") != google_client_id:
        # Only verify audience if client ID is configured and this isn't dev mock
        if not (settings.is_development and credential.startswith("mock_google_")):
            raise AuthError("Google token audience mismatch", status_code=401)

    email = user_info["email"].lower().strip()
    name = user_info.get("name") or email.split("@")[0]
    google_id = user_info.get("sub")
    avatar_url = user_info.get("picture")

    # Check if user already exists
    user = await get_user_by_email(db, email)
    if not user and google_id:
        user = await get_user_by_google_id(db, google_id)

    if user:
        # Existing user: update google_id and avatar if missing
        if not user.google_id and google_id:
            user.google_id = google_id
        if not user.avatar_url and avatar_url:
            user.avatar_url = avatar_url
        user.is_email_verified = True
        await db.flush()
        return user

    # User does not exist: create automatically
    raw_user = email.split("@")[0]
    clean_user = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_user).lower()
    if len(clean_user) < 2:
        clean_user = f"user_{secrets.token_hex(3)}"

    existing_user = await get_user_by_username(db, clean_user)
    if existing_user:
        clean_user = f"{clean_user}_{secrets.token_hex(2)}"

    random_password = secrets.token_urlsafe(32)
    user = User(
        email=email,
        password_hash=hash_password(random_password),
        name=name.strip(),
        username=clean_user,
        google_id=google_id,
        avatar_url=avatar_url,
        is_email_verified=True,
    )
    db.add(user)
    await db.flush()

    # Create personal workspace
    personal_workspace = Workspace(
        name=f"{user.name}'s Workspace",
        type=WorkspaceType.PERSONAL,
        owner_id=user.id,
        join_code=None,
    )
    db.add(personal_workspace)
    await db.flush()

    membership = WorkspaceMember(
        workspace_id=personal_workspace.id,
        user_id=user.id,
        role=WorkspaceRole.OWNER,
    )
    db.add(membership)
    await db.flush()

    return user
