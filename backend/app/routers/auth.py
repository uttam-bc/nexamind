from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    DeleteAccountRequest,
    GoogleAuthRequest,
    GoogleConfigResponse,
    ProfileUpdate,
    PublicUserResponse,
    ResetPasswordRequest,
    SendOtpRequest,
    SendOtpResponse,
    UserCreate,
    UserLogin,
    UserResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)
from app.security import check_identity_limit, limit_auth
from app.services.auth_service import (
    authenticate_google_user,
    authenticate_user,
    change_password,
    create_and_send_otp,
    deactivate_account,
    issue_token,
    register_user,
    reset_password,
    revoke_sessions,
    search_users,
    update_profile,
    verify_otp_code,
)

# Per-account limits on top of the per-IP `limit_auth`, so rotating IPs can't brute-force one account.
ACCOUNT_LIMIT = 10
ACCOUNT_WINDOW_SECONDS = 15 * 60

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/send-otp", response_model=SendOtpResponse, dependencies=[Depends(limit_auth)])
async def send_otp(data: SendOtpRequest, db: AsyncSession = Depends(get_db, scope="function")) -> SendOtpResponse:
    """Send a 6-digit code. The response does not reveal whether the address has an account."""
    check_identity_limit("otp-send", data.email, 5, ACCOUNT_WINDOW_SECONDS)
    result = await create_and_send_otp(db, data.email, purpose=data.purpose)
    return SendOtpResponse(
        message=result["message"],
        email=result["email"],
        expires_in_seconds=result["expires_in_seconds"],
        delivery=result["delivery"],
        dev_code=result.get("dev_code"),
    )


@router.post("/verify-otp", response_model=VerifyOtpResponse, dependencies=[Depends(limit_auth)])
async def verify_otp(data: VerifyOtpRequest, db: AsyncSession = Depends(get_db, scope="function")) -> VerifyOtpResponse:
    """Verify that an OTP matches the pending code for this email."""
    check_identity_limit("otp-verify", data.email, ACCOUNT_LIMIT, ACCOUNT_WINDOW_SECONDS)
    await verify_otp_code(db, data.email, data.otp, purpose=data.purpose)
    return VerifyOtpResponse(
        verified=True,
        message="Email verification successful",
    )


@router.post("/register", response_model=AuthResponse, status_code=201, dependencies=[Depends(limit_auth)])
async def register(data: UserCreate, db: AsyncSession = Depends(get_db, scope="function")) -> AuthResponse:
    check_identity_limit("register", data.email, ACCOUNT_LIMIT, ACCOUNT_WINDOW_SECONDS)
    user, _workspace = await register_user(db, data)
    token = issue_token(user)
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(limit_auth)])
async def login(data: UserLogin, db: AsyncSession = Depends(get_db, scope="function")) -> AuthResponse:
    check_identity_limit("login", data.email, ACCOUNT_LIMIT, ACCOUNT_WINDOW_SECONDS)
    user = await authenticate_user(db, data.email, data.password)
    token = issue_token(user)
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.post("/google", response_model=AuthResponse, dependencies=[Depends(limit_auth)])
async def google_auth(data: GoogleAuthRequest, db: AsyncSession = Depends(get_db, scope="function")) -> AuthResponse:
    """Direct sign in or account creation using verified Google credentials."""
    user = await authenticate_google_user(db, data.credential)
    token = issue_token(user)
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.get("/google/config", response_model=GoogleConfigResponse)
async def google_config() -> GoogleConfigResponse:
    """Provide Google Client ID configuration to the frontend if available."""
    return GoogleConfigResponse(client_id=settings.google_client_id or None)


@router.post("/reset-password", status_code=204, dependencies=[Depends(limit_auth)])
async def reset_password_endpoint(data: ResetPasswordRequest, db: AsyncSession = Depends(get_db, scope="function")) -> Response:
    """Set a new password with a `reset_password` code. Signs out every existing session."""
    check_identity_limit("otp-verify", data.email, ACCOUNT_LIMIT, ACCOUNT_WINDOW_SECONDS)
    await reset_password(db, data.email, data.otp, data.new_password)
    return Response(status_code=204)


@router.post("/logout", status_code=204)
async def logout(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db, scope="function")) -> Response:
    """End all of this user's sessions (tokens are revoked server-side, not just forgotten)."""
    await revoke_sessions(db, current_user)
    return Response(status_code=204)


@router.post("/change-password", response_model=AuthResponse, dependencies=[Depends(limit_auth)])
async def change_password_endpoint(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> AuthResponse:
    """Change the password, sign out other sessions, and return a fresh token for this one."""
    check_identity_limit("change-password", str(current_user.id), ACCOUNT_LIMIT, ACCOUNT_WINDOW_SECONDS)
    await change_password(db, current_user, data.current_password, data.new_password)
    return AuthResponse(user=UserResponse.model_validate(current_user), access_token=issue_token(current_user))


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> UserResponse:
    user = await update_profile(db, current_user, data.name, data.username)
    return UserResponse.model_validate(user)


@router.delete("/me", status_code=204, dependencies=[Depends(limit_auth)])
async def delete_me(
    data: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    """Delete the account (identity erased, shared content kept as "Deleted user")."""
    check_identity_limit("delete-account", str(current_user.id), 5, ACCOUNT_WINDOW_SECONDS)
    await deactivate_account(db, current_user, data.password)
    return Response(status_code=204)


@router.get("/users/search", response_model=list[PublicUserResponse])
async def search_workspace_users(
    q: str = Query("", min_length=0, max_length=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[PublicUserResponse]:
    users = await search_users(db, current_user.id, q, limit=15)
    return [PublicUserResponse.model_validate(u) for u in users]
