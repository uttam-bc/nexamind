from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.finance import TransactionType
from app.schemas.finance import (
    RunwaySummaryResponse,
    TransactionCreate,
    TransactionResponse,
    TransactionUpdate,
)
from app.services.finance_service import (
    calculate_runway,
    create_transaction,
    delete_transaction,
    get_transaction,
    list_transactions,
    update_transaction,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/finance", tags=["finance"])


@router.get("/transactions", response_model=list[TransactionResponse])
async def get_transactions(
    workspace_id: UUID,
    type: TransactionType | None = None,
    category: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TransactionResponse]:
    transactions = await list_transactions(db, workspace_id, current_user.id, transaction_type=type, category=category)
    return [TransactionResponse.model_validate(tx) for tx in transactions]


@router.post("/transactions", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_transaction(
    workspace_id: UUID,
    data: TransactionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TransactionResponse:
    tx = await create_transaction(db, workspace_id, current_user, data)
    return TransactionResponse.model_validate(tx)


@router.get("/transactions/{transaction_id}", response_model=TransactionResponse)
async def get_workspace_transaction(
    workspace_id: UUID,
    transaction_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TransactionResponse:
    tx = await get_transaction(db, workspace_id, transaction_id, current_user.id)
    return TransactionResponse.model_validate(tx)


@router.patch("/transactions/{transaction_id}", response_model=TransactionResponse)
async def update_workspace_transaction(
    workspace_id: UUID,
    transaction_id: UUID,
    data: TransactionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TransactionResponse:
    tx = await update_transaction(db, workspace_id, transaction_id, current_user.id, data)
    return TransactionResponse.model_validate(tx)


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_transaction(
    workspace_id: UUID,
    transaction_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_transaction(db, workspace_id, transaction_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/runway", response_model=RunwaySummaryResponse)
@router.get("/summary", response_model=RunwaySummaryResponse)
async def get_workspace_runway(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RunwaySummaryResponse:
    summary = await calculate_runway(db, workspace_id, current_user.id)
    return RunwaySummaryResponse(**summary)
