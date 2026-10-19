import re
import secrets
import string
from datetime import UTC, datetime, timedelta
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import User, Workspace, WorkspaceMember, WorkspaceRole, WorkspaceType
from app.schemas.auth import UserCreate

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
settings = get_settings()


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


import bcrypt

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        if bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8")):
            return True
    except Exception:
        pass
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def create_access_token(subject: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        subject = payload.get("sub")
        if not subject:
            raise AuthError("Invalid token payload", status_code=401)
        return subject
    except JWTError as exc:
        raise AuthError("Could not validate credentials", status_code=401) from exc


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


async def search_users(db: AsyncSession, query: str, limit: int = 10) -> list[User]:
    clean = query.strip().lstrip("@").lower()
    if not clean:
        result = await db.execute(select(User).limit(limit))
        return list(result.scalars().all())

    pattern = f"%{clean}%"
    q = select(User).where(
        or_(
            User.username.ilike(pattern),
            User.name.ilike(pattern),
            User.email.ilike(pattern),
        )
    ).limit(limit)
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

    if not user or not verify_password(password, user.password_hash):
        raise AuthError("Invalid email/username or password", status_code=401)
    return user
