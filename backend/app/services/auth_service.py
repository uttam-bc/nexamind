import re
import secrets
import string
from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
import jwt
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import User, Workspace, WorkspaceMember, WorkspaceRole, WorkspaceType
from app.schemas.auth import UserCreate

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


async def register_user(db: AsyncSession, data: UserCreate) -> tuple[User, Workspace]:
    email = data.email.lower().strip()
    existing = await get_user_by_email(db, email)
    if existing:
        raise AuthError("Email already registered", status_code=409)

    # Determine username
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
