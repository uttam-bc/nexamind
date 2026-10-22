from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.finance import TransactionType

# Keeps totals finite: sums of capped values can't overflow a float.
MAX_AMOUNT = 1_000_000_000_000


class TransactionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    type: TransactionType
    amount: float = Field(..., gt=0, le=MAX_AMOUNT, allow_inf_nan=False)
    category: str = Field(..., min_length=1, max_length=128)
    date: datetime
    description: str | None = None


class TransactionUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    type: TransactionType | None = None
    amount: float | None = Field(default=None, gt=0, le=MAX_AMOUNT, allow_inf_nan=False)
    category: str | None = Field(default=None, min_length=1, max_length=128)
    date: datetime | None = None
    description: str | None = None


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    type: TransactionType
    amount: float
    category: str
    date: datetime
    description: str | None = None
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class RunwaySummaryResponse(BaseModel):
    total_income: float
    total_expenses: float
    net_burn_rate: float  # average monthly net outflow over the last 90 days
    cash_balance: float
    runway_months: float | None = None  # None when not burning cash
    is_profitable: bool = False
