from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ReportType, User
from app.schemas.report import ReportGenerateRequest, ReportResponse
from app.services.report_service import (
    delete_report,
    generate_report,
    get_report,
    list_reports,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/reports", tags=["reports"])


@router.get("", response_model=list[ReportResponse])
async def get_workspace_reports(
    workspace_id: UUID,
    report_type: ReportType | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ReportResponse]:
    reports = await list_reports(db, workspace_id, current_user.id, report_type=report_type, limit=limit)
    return [ReportResponse.model_validate(r) for r in reports]


@router.post("/generate", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def generate_workspace_report(
    workspace_id: UUID,
    data: ReportGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    report = await generate_report(db, workspace_id, current_user, data)
    return ReportResponse.model_validate(report)


@router.get("/{report_id}", response_model=ReportResponse)
async def get_workspace_report(
    workspace_id: UUID,
    report_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    report = await get_report(db, workspace_id, report_id, current_user.id)
    return ReportResponse.model_validate(report)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_report(
    workspace_id: UUID,
    report_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_report(db, workspace_id, report_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
