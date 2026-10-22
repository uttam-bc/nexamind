import asyncio
import logging
import re
import secrets
import string
from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
import jwt
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    EmailVerification,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
    WorkspaceType,
)
from app.schemas.auth import UserCreate
from app.services.email_service import (
    send_account_exists_notice,
    send_verification_otp,
    validate_email_address,
)

logger = logging.getLogger(__name__)
settings = get_settings()
BCRYPT_ROUNDS = 12
# Verified against when the account does not exist, so login timing does not reveal valid emails.
_DUMMY_HASH = bcrypt.hashpw(b"nexamind-timing-guard", bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")

OTP_PURPOSES = {"register", "reset_password"}
OTP_TTL = timedelta(minutes=10)
OTP_MAX_ATTEMPTS = 5
OTP_MAX_PER_WINDOW = 5
VERIFIED_OTP_VALID_FOR = timedelta(minutes=15)
NEUTRAL_OTP_MESSAGE = "If this address can receive email, we've sent it a 6-digit code. It expires in 10 minutes."
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


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


# ---------------------------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------------------------

def create_access_token(subject: str, token_version: int = 0) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_token_expire_minutes),
        "typ": "access",
        "ver": token_version,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def issue_token(user: User) -> str:
    return create_access_token(str(user.id), user.token_version)


def decode_token_claims(token: str) -> tuple[str, int]:
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
    version = payload.get("ver", 0)
    if not isinstance(version, int):
        raise AuthError("Invalid token payload", status_code=401)
    return subject, version


def decode_access_token(token: str) -> str:
    return decode_token_claims(token)[0]


async def get_user_for_token(db: AsyncSession, token: str) -> User:
    """Resolve a bearer token to an active user, rejecting revoked or deactivated sessions."""
    subject, version = decode_token_claims(token)
    try:
        user_id = UUID(subject)
    except ValueError as exc:
        raise AuthError("Invalid token", status_code=401) from exc
    user = await get_user_by_id(db, user_id)
    if not user or user.deactivated_at is not None:
        raise AuthError("User not found", status_code=401)
    if user.token_version != version:
        raise AuthError("Session has ended. Please sign in again.", status_code=401)
    return user


async def revoke_sessions(db: AsyncSession, user: User) -> None:
    """Invalidate every token issued to this user so far."""
    user.token_version = (user.token_version or 0) + 1
    await db.flush()


# ---------------------------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------------------------

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
    """Find people the requester can message.

    Partial matches only cover users who already share a workspace with the requester;
    anyone else must be looked up by their exact username or email address.
    """
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
            User.deactivated_at.is_(None),
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
            ),
        )
        .order_by(User.name.asc())
        .limit(limit)
    )
    res = await db.execute(q)
    return list(res.scalars().all())


# ---------------------------------------------------------------------------------------------
# One-time codes
# ---------------------------------------------------------------------------------------------

def _validated_email(email: str) -> str:
    try:
        return validate_email_address(email, check_deliverability=settings.app_env != "test")
    except ValueError as exc:
        raise AuthError(f"Please enter a valid email address: {exc}", status_code=400) from exc


async def create_and_send_otp(db: AsyncSession, email: str, purpose: str = "register") -> dict:
    """Send a one-time code. The response is identical whether or not an account exists.

    - register + existing account: no code is created; the owner gets an "account exists" notice.
    - reset_password + no account: nothing is sent.
    Codes are only returned in the response when developer auth is explicitly enabled locally.
    """
    if purpose not in OTP_PURPOSES:
        raise AuthError("Unsupported verification purpose", status_code=400)
    valid_email = _validated_email(email)

    dev_mode = settings.dev_auth_active
    if not settings.smtp_configured and not dev_mode:
        raise AuthError(
            "Email delivery is not configured on this server, so verification codes can't be sent. "
            "Please contact the site administrator.",
            status_code=503,
        )

    window_start = datetime.now() - OTP_TTL
    recent = (await db.execute(
        select(func.count(EmailVerification.id)).where(
            EmailVerification.email == valid_email,
            EmailVerification.created_at >= window_start,
        )
    )).scalar() or 0
    if recent >= OTP_MAX_PER_WINDOW:
        raise AuthError("Too many codes requested for this address. Please wait a few minutes.", status_code=429)

    existing = await get_user_by_email(db, valid_email)
    response = {"message": NEUTRAL_OTP_MESSAGE, "email": valid_email,
                "expires_in_seconds": int(OTP_TTL.total_seconds()),
                "delivery": "development" if dev_mode else "sent", "dev_code": None}

    # Record every request (even ones that send no code) so the per-address limit can't be probed.
    otp_code = f"{secrets.randbelow(900000) + 100000}"
    send_code = (purpose == "register" and existing is None) or (
        purpose == "reset_password" and existing is not None and existing.deactivated_at is None)
    record = EmailVerification(
        email=valid_email,
        otp_hash=hash_password(otp_code) if send_code else hash_password(secrets.token_urlsafe(16)),
        purpose=purpose,
        attempts=0,
        is_verified=False,
        expires_at=datetime.now(UTC) + OTP_TTL,
    )
    db.add(record)
    await db.flush()

    if dev_mode and not settings.smtp_configured:
        if send_code:
            response["dev_code"] = otp_code
        return response

    if send_code:
        delivered = await send_verification_otp(valid_email, otp_code, purpose=purpose)
    elif purpose == "register":
        delivered = await send_account_exists_notice(valid_email)
    else:
        delivered = True  # unknown address for reset: nothing to send, same response

    if not delivered:
        await db.delete(record)
        await db.flush()
        raise AuthError("We couldn't send the email right now. Please try again in a few minutes.", status_code=503)
    return response


async def verify_otp_code(db: AsyncSession, email: str, otp: str, purpose: str = "register") -> EmailVerification:
    """Check a code against the latest pending request for this email and purpose."""
    clean_email = email.strip().lower()
    record = (await db.execute(
        select(EmailVerification)
        .where(
            EmailVerification.email == clean_email,
            EmailVerification.purpose == purpose,
            EmailVerification.is_verified.is_(False),
        )
        .order_by(EmailVerification.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not record:
        raise AuthError("This code is invalid or has expired. Please request a new one.", status_code=400)
    expires = record.expires_at if record.expires_at.tzinfo else record.expires_at.replace(tzinfo=UTC)
    if datetime.now(UTC) > expires:
        raise AuthError("This code is invalid or has expired. Please request a new one.", status_code=400)
    if record.attempts >= OTP_MAX_ATTEMPTS:
        raise AuthError("Too many incorrect attempts. Please request a new code.", status_code=429)

    record.attempts += 1
    if not verify_password(otp.strip(), record.otp_hash):
        # Commit now: the request's session rolls back when the error propagates, which would
        # otherwise discard the attempt and make the attempt limit useless.
        await db.commit()
        remaining = OTP_MAX_ATTEMPTS - record.attempts
        raise AuthError(f"Incorrect code ({remaining} attempts remaining).", status_code=400)

    record.is_verified = True
    record.verified_at = datetime.now(UTC)
    await db.flush()
    return record


async def _require_recent_verification(db: AsyncSession, email: str, otp: str | None, purpose: str) -> None:
    if otp:
        await verify_otp_code(db, email, otp, purpose=purpose)
        return
    since = datetime.now(UTC) - VERIFIED_OTP_VALID_FOR
    verified = (await db.execute(
        select(EmailVerification.id)
        .where(
            EmailVerification.email == email,
            EmailVerification.purpose == purpose,
            EmailVerification.is_verified.is_(True),
            EmailVerification.verified_at >= since,
        )
        .limit(1)
    )).first()
    if not verified:
        raise AuthError("Email verification is required. Enter the code we sent to your email.", status_code=400)


# ---------------------------------------------------------------------------------------------
# Registration and login
# ---------------------------------------------------------------------------------------------

def _username_from(raw: str | None, name: str, email: str) -> str:
    if raw:
        clean = re.sub(r"[^a-zA-Z0-9_\-]", "", raw).lower()
        return clean if len(clean) >= 2 else f"user_{secrets.token_hex(3)}"
    clean = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip().lower())
    return clean if len(clean) >= 2 else email.split("@")[0]


async def _unique_username(db: AsyncSession, base: str) -> str:
    candidate = base[:44]
    while await get_user_by_username(db, candidate):
        candidate = f"{base[:44]}_{secrets.token_hex(2)}"
    return candidate


async def _create_user_with_workspace(db: AsyncSession, **fields) -> User:
    user = User(**fields)
    db.add(user)
    await db.flush()
    workspace = Workspace(name=f"{user.name}'s Workspace", type=WorkspaceType.PERSONAL, owner_id=user.id, join_code=None)
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.OWNER))
    await db.flush()
    return user


async def register_user(db: AsyncSession, data: UserCreate) -> tuple[User, Workspace | None]:
    email = _validated_email(data.email)

    # Proving control of the inbox comes first, so "already registered" is only ever revealed
    # to someone who received the code.
    if settings.require_email_verification:
        await _require_recent_verification(db, email, data.otp, "register")
    elif data.otp:
        await verify_otp_code(db, email, data.otp, purpose="register")

    if await get_user_by_email(db, email):
        raise AuthError("Email already registered. Please sign in instead.", status_code=409)

    username = await _unique_username(db, _username_from(data.username, data.name, email))
    user = await _create_user_with_workspace(
        db,
        email=email,
        password_hash=hash_password(data.password),
        name=data.name.strip(),
        username=username,
        is_email_verified=settings.require_email_verification or bool(data.otp),
    )
    return user, None


async def authenticate_user(db: AsyncSession, identifier: str, password: str) -> User:
    clean_id = identifier.strip().lstrip("@").lower()
    user = await get_user_by_email(db, clean_id) or await get_user_by_username(db, clean_id)
    if not user or user.deactivated_at is not None:
        verify_password(password, _DUMMY_HASH)
        raise AuthError("Invalid email/username or password", status_code=401)
    if not verify_password(password, user.password_hash):
        raise AuthError("Invalid email/username or password", status_code=401)
    return user


# ---------------------------------------------------------------------------------------------
# Password and profile management
# ---------------------------------------------------------------------------------------------

async def reset_password(db: AsyncSession, email: str, otp: str, new_password: str) -> None:
    clean = _validated_email(email)
    await verify_otp_code(db, clean, otp, purpose="reset_password")
    user = await get_user_by_email(db, clean)
    if not user or user.deactivated_at is not None:
        raise AuthError("This code is invalid or has expired. Please request a new one.", status_code=400)
    user.password_hash = hash_password(new_password)
    user.is_email_verified = True
    await revoke_sessions(db, user)


async def change_password(db: AsyncSession, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise AuthError("Current password is incorrect", status_code=400)
    if verify_password(new_password, user.password_hash):
        raise AuthError("New password must be different from the current one", status_code=400)
    user.password_hash = hash_password(new_password)
    await revoke_sessions(db, user)


async def update_profile(db: AsyncSession, user: User, name: str | None, username: str | None) -> User:
    if name is not None:
        user.name = name
    if username is not None:
        clean = re.sub(r"[^a-z0-9_\-]", "", username.strip().lstrip("@").lower())
        if len(clean) < 2:
            raise AuthError("Username must be at least 2 letters, numbers, '-' or '_'", status_code=422)
        if clean != user.username:
            taken = await get_user_by_username(db, clean)
            if taken and taken.id != user.id:
                raise AuthError("That username is taken", status_code=409)
            user.username = clean
    await db.flush()
    return user


async def deactivate_account(db: AsyncSession, user: User, password: str) -> None:
    """Delete an account without destroying content other people depend on.

    The personal workspace and solo team workspaces are deleted. Team workspaces the user owns
    alongside other members block deletion until ownership is transferred. Shared content the
    user created stays, attributed to "Deleted user"; the login identity is erased.
    """
    if not verify_password(password, user.password_hash):
        raise AuthError("Password is incorrect", status_code=400)

    memberships = (await db.execute(
        select(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user.id)
    )).all()

    blocking = []
    for membership, workspace in memberships:
        if workspace.type == WorkspaceType.TEAM and membership.role == WorkspaceRole.OWNER:
            others = (await db.execute(
                select(func.count(WorkspaceMember.id)).where(
                    WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.user_id != user.id)
            )).scalar() or 0
            other_owners = (await db.execute(
                select(func.count(WorkspaceMember.id)).where(
                    WorkspaceMember.workspace_id == workspace.id,
                    WorkspaceMember.user_id != user.id,
                    WorkspaceMember.role == WorkspaceRole.OWNER)
            )).scalar() or 0
            if others and not other_owners:
                blocking.append(workspace.name)
    if blocking:
        raise AuthError(
            "Transfer ownership or delete these team workspaces first: " + ", ".join(sorted(blocking)),
            status_code=409,
        )

    for membership, workspace in memberships:
        sole_member = (await db.execute(
            select(func.count(WorkspaceMember.id)).where(WorkspaceMember.workspace_id == workspace.id)
        )).scalar() == 1
        if workspace.type == WorkspaceType.PERSONAL or sole_member:
            await db.delete(workspace)
        else:
            await db.delete(membership)
            if workspace.owner_id == user.id:
                new_owner = (await db.execute(
                    select(WorkspaceMember.user_id).where(
                        WorkspaceMember.workspace_id == workspace.id,
                        WorkspaceMember.user_id != user.id,
                        WorkspaceMember.role == WorkspaceRole.OWNER)
                    .limit(1)
                )).scalar_one()
                workspace.owner_id = new_owner

    await db.execute(delete(EmailVerification).where(EmailVerification.email == user.email))
    user.email = f"deleted-{user.id}@deleted.invalid"
    user.username = None
    user.name = "Deleted user"
    user.password_hash = hash_password(secrets.token_urlsafe(32))
    user.google_id = None
    user.avatar_url = None
    user.gemini_api_key_encrypted = None
    user.deactivated_at = datetime.now(UTC)
    await revoke_sessions(db, user)


# ---------------------------------------------------------------------------------------------
# Google sign-in
# ---------------------------------------------------------------------------------------------

_google_request = None


def _verify_google_token_sync(credential: str, client_id: str) -> dict:
    """Verify signature (Google's published keys), audience, issuer and expiry."""
    global _google_request
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    if _google_request is None:
        _google_request = google_requests.Request()
    claims = google_id_token.verify_oauth2_token(credential, _google_request, audience=client_id)
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise ValueError("Wrong issuer")
    return claims


def _mock_google_claims(credential: str) -> dict:
    parts = credential.split(":")
    email = parts[1] if len(parts) > 1 and parts[1] else "google.user@example.com"
    return {
        "email": email,
        "email_verified": True,
        "name": parts[2] if len(parts) > 2 and parts[2] else "Google Demo User",
        "sub": f"mock_google_id_{email}",
        "picture": None,
    }


async def authenticate_google_user(db: AsyncSession, credential: str) -> User:
    """Sign in or register with a Google ID token. Fails closed when Google isn't configured."""
    if settings.dev_auth_active and credential.startswith("mock_google_:"):
        claims = _mock_google_claims(credential)
    else:
        client_id = (settings.google_client_id or "").strip()
        if not client_id:
            raise AuthError("Google sign-in is not available on this server.", status_code=503)
        from google.auth import exceptions as google_exceptions

        try:
            claims = await asyncio.to_thread(_verify_google_token_sync, credential, client_id)
        except google_exceptions.TransportError as exc:  # couldn't fetch Google's keys
            logger.error("Google key fetch failed: %s", exc.__class__.__name__)
            raise AuthError("Google sign-in is temporarily unavailable.", status_code=502) from exc
        except (ValueError, google_exceptions.GoogleAuthError) as exc:
            logger.info("Rejected Google credential: %s", exc.__class__.__name__)
            raise AuthError("Google sign-in failed. Please try again.", status_code=401) from exc

    if claims.get("email_verified") not in (True, "true"):
        raise AuthError("Your Google email address isn't verified.", status_code=400)
    google_id = str(claims.get("sub") or "")
    email = str(claims.get("email") or "").strip().lower()
    if not google_id or not email:
        raise AuthError("Google sign-in failed. Please try again.", status_code=401)

    user = await get_user_by_google_id(db, google_id)
    if user is None:
        user = await get_user_by_email(db, email)
        if user is not None:
            if user.google_id and user.google_id != google_id:
                raise AuthError("This email is linked to a different Google account.", status_code=409)
            if not user.is_email_verified:
                raise AuthError("Sign in with your password once to link Google to this account.", status_code=409)
            user.google_id = google_id
    if user is not None:
        if user.deactivated_at is not None:
            raise AuthError("This account has been deleted.", status_code=403)
        if not user.avatar_url and claims.get("picture"):
            user.avatar_url = claims["picture"]
        await db.flush()
        return user

    name = str(claims.get("name") or email.split("@")[0]).strip()[:255]
    username = await _unique_username(db, _username_from(None, email.split("@")[0], email))
    return await _create_user_with_workspace(
        db,
        email=email,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        name=name,
        username=username,
        google_id=google_id,
        avatar_url=claims.get("picture"),
        is_email_verified=True,
    )
