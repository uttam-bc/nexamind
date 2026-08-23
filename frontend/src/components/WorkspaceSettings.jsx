import React, { useState, useEffect } from 'react';
import {
  Settings,
  Users,
  Key,
  Copy,
  Check,
  RefreshCw,
  Edit2,
  Save,
  Mail,
  Building,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';
import { PageHeader, Badge, Modal } from './ui';

export default function WorkspaceSettings({
  workspace,
  user,
  onRefreshWorkspace,
}) {
  const { success: toastSuccess, error: toastError, confirm } = useToast();

  const [members, setMembers] = useState([]);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(workspace?.name || '');
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSent, setInviteSent] = useState(false);

  useEffect(() => {
    if (workspace?.id) {
      setNewName(workspace.name);
      loadMembers();
    }
  }, [workspace]);

  const loadMembers = async () => {
    try {
      const data = await api.getWorkspaceMembers(workspace.id);
      setMembers(data);
    } catch (err) {
      console.error('Error fetching members', err);
    }
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    if (!newName.trim() || savingName) return;
    setSavingName(true);
    try {
      await api.updateWorkspace(workspace.id, newName.trim());
      setIsEditingName(false);
      await onRefreshWorkspace();
      toastSuccess('Workspace name updated successfully!');
    } catch (err) {
      toastError(`Update failed: ${err.message}`);
    } finally {
      setSavingName(false);
    }
  };

  const handleRegenerateCode = async () => {
    const confirmed = await confirm(
      'The previous join code will immediately become invalid. Teams currently trying to join will need the new code.',
      {
        title: 'Regenerate Join Code?',
        confirmLabel: 'Regenerate',
        cancelLabel: 'Keep Current',
        variant: 'danger',
      }
    );
    if (confirmed) {
      setRegenerating(true);
      try {
        await api.regenerateJoinCode(workspace.id);
        await onRefreshWorkspace();
        toastSuccess('Join code regenerated successfully!');
      } catch (err) {
        toastError(err.message);
      } finally {
        setRegenerating(false);
      }
    }
  };

  const copyJoinCode = () => {
    if (workspace?.join_code) {
      navigator.clipboard.writeText(workspace.join_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
      toastSuccess('Join code copied to clipboard!');
    }
  };

  const handleSendInvite = (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteSent(true);
    toastSuccess(`Invitation generated for ${inviteEmail}!`);
    setTimeout(() => {
      setInviteSent(false);
      setInviteEmail('');
    }, 3000);
  };

  const isOwnerOrAdmin =
    workspace?.owner_id === user?.id ||
    members.find((m) => m.user_id === user?.id)?.role === 'owner' ||
    members.find((m) => m.user_id === user?.id)?.role === 'admin';

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
      <PageHeader
        title="Workspace Settings & Members"
        description="Manage workspace identity, team membership, security credentials, and access roles."
        actions={
          <Badge variant={workspace?.type === 'personal' ? 'emerald' : 'indigo'}>
            {workspace?.type === 'personal' ? 'Personal Space' : 'Team Workspace'}
          </Badge>
        }
      />

      {/* 1. Workspace Profile Card */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800/80 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <Building className="w-4 h-4 text-indigo-400" />
          <span>General Information</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Workspace Name
            </label>
            {isEditingName ? (
              <form onSubmit={handleSaveName} className="flex gap-2">
                <input
                  type="text"
                  required
                  autoFocus
                  className="input-base"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={savingName}
                  className="btn-primary px-4 py-2"
                >
                  <Save className="w-4 h-4" />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="btn-secondary px-4 py-2"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/80">
                <span className="font-semibold text-sm text-slate-100">{workspace?.name}</span>
                {isOwnerOrAdmin && (
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-850 rounded-lg transition"
                    title="Edit Name"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Created Date
            </label>
            <div className="p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/80 text-xs font-semibold text-slate-300">
              {workspace?.created_at
                ? new Date(workspace.created_at).toLocaleDateString(undefined, {
                    dateStyle: 'long',
                  })
                : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Team Invitation & Join Code (Only for Team Workspaces) */}
      {workspace?.type === 'team' && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-800/80 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Key className="w-4 h-4 text-purple-400" />
              <span>Team Join Code & Access</span>
            </h3>

            {isOwnerOrAdmin && (
              <button
                onClick={handleRegenerateCode}
                disabled={regenerating}
                className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                <span>Regenerate Code</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            {/* Join Code Box */}
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block mb-0.5">
                  Shareable Join Code
                </span>
                <span className="font-mono text-xl font-black text-indigo-400 tracking-widest">
                  {workspace?.join_code || 'NONE'}
                </span>
              </div>
              <button
                onClick={copyJoinCode}
                className="btn-secondary py-2 px-3 text-xs"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
              </button>
            </div>

            {/* Invite via Email simulation */}
            <form onSubmit={handleSendInvite} className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  type="email"
                  placeholder="colleague@company.com"
                  className="input-base pl-9"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn-primary py-2.5 px-4 text-xs"
              >
                {inviteSent ? 'Invite Ready!' : 'Send Invite'}
              </button>
            </form>
          </div>
          {inviteSent && (
            <div className="text-xs text-emerald-400 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>Invitation code copied! Share code {workspace?.join_code} with {inviteEmail}.</span>
            </div>
          )}
        </div>
      )}

      {/* 3. Workspace Members Roster */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <span>Workspace Members ({members.length})</span>
          </h3>
          <button onClick={loadMembers} className="text-xs text-indigo-400 hover:underline">
            Refresh List
          </button>
        </div>

        <div className="space-y-2">
          {members.map((member) => {
            const isCurrentUser = member.user_id === user?.id;
            return (
              <div
                key={member.id}
                className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs hover:border-slate-700/60 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-xs shadow-md">
                    {member.name?.slice(0, 2).toUpperCase() || 'U'}
                  </div>
                  <div>
                    <div className="font-bold text-slate-100 flex items-center gap-2">
                      <span>{member.name}</span>
                      {isCurrentUser && (
                        <Badge variant="indigo" className="text-[8px] py-0 px-1 rounded-sm lowercase">
                          you
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{member.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-[10px] text-slate-500">
                    Joined {new Date(member.created_at).toLocaleDateString()}
                  </span>
                  <Badge variant={member.role === 'owner' ? 'amber' : member.role === 'admin' ? 'indigo' : 'default'}>
                    {member.role}
                  </Badge>
                </div>
              </div>
            );
          })}

          {members.length === 0 && (
            <div className="text-center text-slate-500 py-8 text-xs">Loading members...</div>
          )}
        </div>
      </div>
    </div>
  );
}
