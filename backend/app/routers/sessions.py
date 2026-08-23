from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import SessionStatus, User
from app.schemas.session import SessionCreate, SessionResponse, SessionUpdate
from app.services.session_service import (
    create_session,
    delete_session,
    get_session,
    list_sessions,
    process_session_pipeline,
    update_session,
    upload_session_file,
)
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/workspaces/{workspace_id}/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionResponse])
async def get_workspace_sessions(
    workspace_id: UUID,
    status: SessionStatus | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SessionResponse]:
    sessions = await list_sessions(db, workspace_id, current_user.id, status=status, limit=limit)
    return [SessionResponse.model_validate(s) for s in sessions]


@router.post("/upload", response_model=SessionResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_meeting_session(
    workspace_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    session = await upload_session_file(db, workspace_id, current_user, file, title=title)
    
    # Broadcast session created event to workspace
    session_data = SessionResponse.model_validate(session).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "session_created", "workspace_id": str(workspace_id), "data": session_data},
    )

    # Schedule background transcription & summarization pipeline
    background_tasks.add_task(process_session_pipeline, session.id, workspace_id)
    return SessionResponse.model_validate(session)


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_session(
    workspace_id: UUID,
    data: SessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    session = await create_session(db, workspace_id, current_user, data)
    session_data = SessionResponse.model_validate(session).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "session_created", "workspace_id": str(workspace_id), "data": session_data},
    )
    return SessionResponse.model_validate(session)


@router.get("/{session_id}", response_model=SessionResponse)
async def get_workspace_session(
    workspace_id: UUID,
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    session = await get_session(db, workspace_id, session_id, current_user.id)
    return SessionResponse.model_validate(session)


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_workspace_session(
    workspace_id: UUID,
    session_id: UUID,
    data: SessionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    session = await update_session(db, workspace_id, session_id, current_user.id, data)
    session_data = SessionResponse.model_validate(session).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "session_updated", "workspace_id": str(workspace_id), "data": session_data},
    )
    return SessionResponse.model_validate(session)


@router.post("/{session_id}/mom", response_model=SessionResponse)
async def generate_session_mom(
    workspace_id: UUID,
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    from app.services.ai_service import summarize_meeting_transcript
    session = await get_session(db, workspace_id, session_id, current_user.id)
    transcript = session.transcript or ""
    summary_md, action_items = await summarize_meeting_transcript(transcript, title=session.title)
    updated_session = await update_session(
        db,
        workspace_id,
        session_id,
        current_user.id,
        SessionUpdate(ai_summary=summary_md, action_items=action_items),
    )
    session_data = SessionResponse.model_validate(updated_session).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "session_updated", "workspace_id": str(workspace_id), "data": session_data},
    )
    return SessionResponse.model_validate(updated_session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_session(
    workspace_id: UUID,
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_session(db, workspace_id, session_id, current_user.id)
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "session_deleted", "workspace_id": str(workspace_id), "session_id": str(session_id)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
