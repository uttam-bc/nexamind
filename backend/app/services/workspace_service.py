import secrets
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Channel, ChannelMember, User, Workspace, WorkspaceMember, WorkspaceRole, WorkspaceType
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


MANAGER_ROLES = {WorkspaceRole.OWNER, WorkspaceRole.ADMIN}


async def require_author_or_manager(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    author_id: UUID | None,
    action: str = "delete this",
) -> None:
    """Destructive actions on shared content: allowed for its author or a workspace owner/admin."""
    if author_id is not None and author_id == user_id:
        return
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if membership and membership.role in MANAGER_ROLES:
        return
    raise AuthError(f"Only the person who created it or a workspace admin can {action}.", status_code=403)


# --- Membership lifecycle -------------------------------------------------------------------

async def _team_workspace(db: AsyncSession, workspace_id: UUID) -> Workspace:
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise AuthError("Workspace not found", status_code=404)
    if workspace.type != WorkspaceType.TEAM:
        raise AuthError("Personal workspaces have no other members", status_code=400)
    return workspace


async def _owner_count(db: AsyncSession, workspace_id: UUID) -> int:
    result = await db.execute(
        select(func.count(WorkspaceMember.id)).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.role == WorkspaceRole.OWNER
        )
    )
    return result.scalar() or 0


async def _drop_membership(db: AsyncSession, workspace: Workspace, member: WorkspaceMember) -> None:
    """Remove a member and their private-channel access; hand `owner_id` on if they held it."""
    private_channels = select(Channel.id).where(Channel.workspace_id == workspace.id, Channel.is_direct.is_(False))
    await db.execute(
        delete(ChannelMember).where(ChannelMember.user_id == member.user_id, ChannelMember.channel_id.in_(private_channels))
    )
    await db.delete(member)
    await db.flush()
    if workspace.owner_id == member.user_id:
        next_owner = (await db.execute(
            select(WorkspaceMember.user_id)
            .where(WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.role == WorkspaceRole.OWNER)
            .order_by(WorkspaceMember.created_at.asc())
            .limit(1)
        )).scalar_one()
        workspace.owner_id = next_owner
        await db.flush()


async def _require_member(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
    return membership


async def leave_workspace(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> None:
    membership = await _require_member(db, workspace_id, user_id)
    workspace = await _team_workspace(db, workspace_id)
    if membership.role == WorkspaceRole.OWNER and await _owner_count(db, workspace_id) <= 1:
        raise AuthError("Make someone else an owner (or delete the workspace) before leaving", status_code=409)
    await _drop_membership(db, workspace, membership)


async def remove_workspace_member(db: AsyncSession, workspace_id: UUID, actor_id: UUID, member_user_id: UUID) -> None:
    actor = await _require_member(db, workspace_id, actor_id)
    workspace = await _team_workspace(db, workspace_id)
    if member_user_id == actor_id:
        raise AuthError("Use 'Leave workspace' to remove yourself", status_code=400)
    target = await get_workspace_membership(db, workspace_id, member_user_id)
    if target is None:
        raise AuthError("Member not found", status_code=404)
    if actor.role not in MANAGER_ROLES:
        raise AuthError("Only workspace owners or admins can remove members", status_code=403)
    if actor.role == WorkspaceRole.ADMIN and target.role != WorkspaceRole.MEMBER:
        raise AuthError("Admins can only remove members; ask an owner", status_code=403)
    await _drop_membership(db, workspace, target)


async def change_member_role(
    db: AsyncSession, workspace_id: UUID, actor_id: UUID, member_user_id: UUID, role: WorkspaceRole
) -> WorkspaceMember:
    actor = await _require_member(db, workspace_id, actor_id)
    await _team_workspace(db, workspace_id)
    if actor.role != WorkspaceRole.OWNER:
        raise AuthError("Only workspace owners can change roles", status_code=403)
    target = await get_workspace_membership(db, workspace_id, member_user_id)
    if target is None:
        raise AuthError("Member not found", status_code=404)
    if target.role == WorkspaceRole.OWNER and role != WorkspaceRole.OWNER and await _owner_count(db, workspace_id) <= 1:
        raise AuthError("A workspace needs at least one owner", status_code=409)
    target.role = role
    await db.flush()
    return target


async def delete_workspace(db: AsyncSession, workspace_id: UUID, user_id: UUID, confirm_name: str) -> None:
    membership = await _require_member(db, workspace_id, user_id)
    workspace = await _team_workspace(db, workspace_id)
    if membership.role != WorkspaceRole.OWNER:
        raise AuthError("Only workspace owners can delete the workspace", status_code=403)
    if confirm_name.strip() != workspace.name:
        raise AuthError("Type the workspace name exactly to confirm deletion", status_code=400)
    # Content rows reference the workspace with ON DELETE CASCADE; stored files go with them.
    from app.models import FileRecord, SessionRecord
    from app.services.upload_utils import delete_stored_file

    paths = [p for p in (await db.execute(select(FileRecord.file_path).where(FileRecord.workspace_id == workspace_id))).scalars()]
    paths += [p for p in (await db.execute(select(SessionRecord.file_path).where(SessionRecord.workspace_id == workspace_id))).scalars() if p]
    await db.delete(workspace)
    await db.flush()
    for path in paths:
        delete_stored_file(path)
