import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import User, Workspace, WorkspaceMember, WorkspaceRole, WorkspaceType
from app.services.auth_service import AuthError, generate_join_code


async def get_workspace_membership(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> WorkspaceMember | None:
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def list_user_workspaces(db: AsyncSession, user_id: UUID) -> list[Workspace]:
    result = await db.execute(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.created_at.asc())
    )
    return list(result.scalars().unique().all())


async def get_workspace_for_user(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> Workspace:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    result = await db.execute(
        select(Workspace)
        .options(selectinload(Workspace.members))
        .where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise AuthError("Workspace not found", status_code=404)
    return workspace


async def list_workspace_members_with_details(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[dict]:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    result = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at.asc())
    )
    members_with_users = result.all()
    return [
        {
            "id": member.id,
            "user_id": user.id,
            "name": user.name,
            "email": user.email,
            "role": member.role,
            "created_at": member.created_at,
        }
        for member, user in members_with_users
    ]


async def update_workspace_name(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    new_name: str,
) -> Workspace:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership or membership.role not in [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]:
        raise AuthError("Only workspace owners or admins can rename the workspace", status_code=403)

    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise AuthError("Workspace not found", status_code=404)

    workspace.name = new_name.strip()
    await db.flush()
    return workspace


async def regenerate_workspace_join_code(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> Workspace:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership or membership.role not in [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]:
        raise AuthError("Only workspace owners or admins can regenerate the join code", status_code=403)

    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise AuthError("Workspace not found", status_code=404)

    if workspace.type != WorkspaceType.TEAM:
        raise AuthError("Personal workspaces do not have join codes", status_code=400)

    workspace.join_code = await _generate_unique_join_code(db)
    await db.flush()
    return workspace


async def create_team_workspace(
    db: AsyncSession,
    owner: User,
    name: str,
) -> Workspace:
    join_code = await _generate_unique_join_code(db)
    workspace = Workspace(
        name=name.strip(),
        type=WorkspaceType.TEAM,
        owner_id=owner.id,
        join_code=join_code,
    )
    db.add(workspace)
    await db.flush()

    membership = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=owner.id,
        role=WorkspaceRole.OWNER,
    )
    db.add(membership)
    await db.flush()
    return workspace


async def join_workspace_by_code(
    db: AsyncSession,
    user: User,
    join_code: str,
) -> Workspace:
    normalized_code = join_code.strip().upper()
    result = await db.execute(
        select(Workspace).where(
            Workspace.join_code == normalized_code,
            Workspace.type == WorkspaceType.TEAM,
        )
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise AuthError("Invalid join code", status_code=404)

    existing = await get_workspace_membership(db, workspace.id, user.id)
    if existing:
        raise AuthError("Already a member of this workspace", status_code=409)

    membership = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role=WorkspaceRole.MEMBER,
    )
    db.add(membership)
    await db.flush()
    return workspace


async def _generate_unique_join_code(db: AsyncSession, max_attempts: int = 10) -> str:
    for _ in range(max_attempts):
        code = generate_join_code()
        result = await db.execute(select(Workspace).where(Workspace.join_code == code))
        if result.scalar_one_or_none() is None:
            return code
    raise AuthError("Could not generate unique join code", status_code=500)
