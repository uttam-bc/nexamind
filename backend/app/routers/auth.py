from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.auth import (
    AuthResponse,
    GoogleAuthRequest,
    GoogleConfigResponse,
    PublicUserResponse,
    SendOtpRequest,
    SendOtpResponse,
    UserCreate,
    UserLogin,
    UserResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)
from app.security import limit_auth
from app.services.auth_service import (
    authenticate_google_user,
    authenticate_user,
    create_access_token,
    create_and_send_otp,
    register_user,
    search_users,
    verify_otp_code,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/send-otp", response_model=SendOtpResponse, dependencies=[Depends(limit_auth)])
async def send_otp(data: SendOtpRequest, db: AsyncSession = Depends(get_db)) -> SendOtpResponse:
    """Send a 6-digit verification code to the requested email address."""
    result = await create_and_send_otp(db, data.email, purpose=data.purpose)
    return SendOtpResponse(
        message=result["message"],
        email=result["email"],
        expires_in_seconds=result["expires_in_seconds"],
        delivery=result["delivery"],
        dev_code=result.get("dev_code"),
    )


@router.post("/verify-otp", response_model=VerifyOtpResponse, dependencies=[Depends(limit_auth)])
async def verify_otp(data: VerifyOtpRequest, db: AsyncSession = Depends(get_db)) -> VerifyOtpResponse:
    """Verify that an OTP matches the pending code for this email."""
    await verify_otp_code(db, data.email, data.otp, purpose=data.purpose)
    return VerifyOtpResponse(
        verified=True,
        message="Email verification successful",
    )


@router.post("/register", response_model=AuthResponse, status_code=201, dependencies=[Depends(limit_auth)])
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    user, _workspace = await register_user(db, data)
    token = create_access_token(str(user.id))
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(limit_auth)])
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    user = await authenticate_user(db, data.email, data.password)
    token = create_access_token(str(user.id))
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.post("/google", response_model=AuthResponse, dependencies=[Depends(limit_auth)])
async def google_auth(data: GoogleAuthRequest, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """Direct sign in or account creation using verified Google credentials."""
    user = await authenticate_google_user(db, data.credential)
    token = create_access_token(str(user.id))
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.get("/google/config", response_model=GoogleConfigResponse)
async def google_config() -> GoogleConfigResponse:
    """Provide Google Client ID configuration to the frontend if available."""
    return GoogleConfigResponse(client_id=settings.google_client_id)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.get("/users/search", response_model=list[PublicUserResponse])
async def search_workspace_users(
    q: str = Query("", min_length=0, max_length=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PublicUserResponse]:
    users = await search_users(db, current_user.id, q, limit=15)
    return [PublicUserResponse.model_validate(u) for u in users]
