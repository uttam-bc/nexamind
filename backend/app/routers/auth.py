from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.auth import AuthResponse, UserCreate, UserLogin, UserResponse
from app.services.auth_service import authenticate_user, create_access_token, register_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    user, _workspace = await register_user(db, data)
    token = create_access_token(str(user.id))
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.post("/login", response_model=AuthResponse)
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    user = await authenticate_user(db, data.email, data.password)
    token = create_access_token(str(user.id))
    return AuthResponse(
        user=UserResponse.model_validate(user),
        access_token=token,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)
