from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FinanceTransaction, User
from app.models.finance import TransactionType
from app.schemas.finance import TransactionCreate, TransactionUpdate
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership, require_author_or_manager


async def list_transactions(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    transaction_type: TransactionType | None = None,
    category: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[FinanceTransaction]:
    await _require_workspace_access(db, workspace_id, user_id)
    query = select(FinanceTransaction).where(FinanceTransaction.workspace_id == workspace_id)
    if transaction_type is not None:
        query = query.where(FinanceTransaction.type == transaction_type)
    if category is not None:
        query = query.where(FinanceTransaction.category == category)
    query = query.order_by(FinanceTransaction.date.desc(), FinanceTransaction.created_at.desc())
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_transaction(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: TransactionCreate,
) -> FinanceTransaction:
    await _require_workspace_access(db, workspace_id, user.id)
    tx = FinanceTransaction(
        workspace_id=workspace_id,
        type=data.type,
        amount=data.amount,
        category=data.category.strip(),
        date=data.date,
        description=data.description.strip() if data.description else None,
        created_by=user.id,
    )
    db.add(tx)
    await db.flush()
    await db.refresh(tx)
    return tx


async def get_transaction(
    db: AsyncSession,
    workspace_id: UUID,
    transaction_id: UUID,
    user_id: UUID,
) -> FinanceTransaction:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(FinanceTransaction).where(
            FinanceTransaction.id == transaction_id,
            FinanceTransaction.workspace_id == workspace_id,
        )
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise AuthError("Transaction not found", status_code=404)
    return tx


async def update_transaction(
    db: AsyncSession,
    workspace_id: UUID,
    transaction_id: UUID,
    user_id: UUID,
    data: TransactionUpdate,
) -> FinanceTransaction:
    tx = await get_transaction(db, workspace_id, transaction_id, user_id)
    if data.type is not None:
        tx.type = data.type
    if data.amount is not None:
        tx.amount = data.amount
    if data.category is not None:
        tx.category = data.category.strip()
    if data.date is not None:
        tx.date = data.date
    if data.description is not None:
        tx.description = data.description.strip() if data.description else None

    await db.flush()
    await db.refresh(tx)
    return tx


async def delete_transaction(
    db: AsyncSession,
    workspace_id: UUID,
    transaction_id: UUID,
    user_id: UUID,
) -> None:
    tx = await get_transaction(db, workspace_id, transaction_id, user_id)
    await require_author_or_manager(db, tx.workspace_id, user_id, tx.created_by)
    await db.delete(tx)
    await db.flush()


async def calculate_runway(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    lookback_days: int = 90,
) -> dict:
    """Cash position plus runway based on the average monthly net burn over the last 90 days."""
    transactions = await list_transactions(db, workspace_id, user_id)
    total_income = sum(tx.amount for tx in transactions if tx.type == TransactionType.INCOME)
    total_expenses = sum(tx.amount for tx in transactions if tx.type == TransactionType.EXPENSE)
    cash_balance = total_income - total_expenses

    cutoff = date.today() - timedelta(days=lookback_days)
    recent = [tx for tx in transactions if _tx_date(tx) >= cutoff]
    recent_net_outflow = sum(
        tx.amount if tx.type == TransactionType.EXPENSE else -tx.amount for tx in recent
    )
    months = lookback_days / 30.0
    monthly_burn = max(0.0, recent_net_outflow / months)

    if monthly_burn <= 0:
        runway_months = None  # not burning cash: runway is unlimited
    elif cash_balance <= 0:
        runway_months = 0.0
    else:
        runway_months = round(cash_balance / monthly_burn, 1)

    return {
        "total_income": total_income,
        "total_expenses": total_expenses,
        "net_burn_rate": round(monthly_burn, 2),
        "cash_balance": cash_balance,
        "runway_months": runway_months,
        "is_profitable": monthly_burn <= 0,
    }


def _tx_date(tx) -> date:
    value = tx.date
    return value.date() if isinstance(value, datetime) else value


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
