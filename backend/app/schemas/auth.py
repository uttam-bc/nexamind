from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    name: str = Field(min_length=1, max_length=255)
    username: str | None = Field(default=None, min_length=2, max_length=50)
    otp: str | None = Field(default=None, max_length=10)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes")
        if v.strip() != v or not any(c.isalpha() for c in v) or not any(c.isdigit() for c in v):
            raise ValueError("Password must contain letters and numbers and no leading/trailing spaces")
        return v


class UserLogin(BaseModel):
    email: str = Field(min_length=1, max_length=255)  # email address or @username
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    name: str
    username: str | None = None
    is_email_verified: bool = True
    avatar_url: str | None = None
    created_at: datetime


class PublicUserResponse(BaseModel):
    """What other people may see about a user."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    username: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuthResponse(BaseModel):
    user: UserResponse
    access_token: str
    token_type: str = "bearer"


class SendOtpRequest(BaseModel):
    email: EmailStr
    purpose: str = Field(default="register", max_length=50)


class SendOtpResponse(BaseModel):
    message: str
    email: str
    expires_in_seconds: int = 600
    delivery: str = "sent"
    dev_code: str | None = None


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=10)
    purpose: str = Field(default="register", max_length=50)


class VerifyOtpResponse(BaseModel):
    verified: bool
    message: str


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=10)


class GoogleConfigResponse(BaseModel):
    client_id: str | None = None
