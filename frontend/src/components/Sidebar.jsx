import React, { useState } from 'react';
import {
  Bot,
  Video,
  FileText,
  FolderKanban,
  Code2,
  MessageSquare,
  FolderOpen,
  FileBarChart,
  Settings,
  LogOut,
  Plus,
  Key,
  Copy,
  Check,
  Search,
  Sparkles,
  Calendar,
  User,
  Users,
  DollarSign,
  X,
} from 'lucide-react';
import { SOLO_NAV, GROUP_NAV } from '../lib/navigation';

const ICON_MAP = {
  Bot, Video, FileText, FolderKanban, Code2, MessageSquare, FolderOpen,
  FileBarChart, Settings, Sparkles, Calendar, DollarSign,
};

export default function Sidebar({
  activeTab,
  onTabChange,
  workspaces,
  currentWorkspace,
  onSelectWorkspace,
  onOpenCreateWs,
  onOpenJoinWs,
  onLogout,
  user,
  onOpenCommandPalette,
  isOpen,
  onClose,
}) {
  const [copied, setCopied] = useState(false);
  const isSolo = currentWorkspace?.type === 'personal';
  const personalWorkspaces = workspaces.filter((w) => w.type === 'personal');
  const teamWorkspaces = workspaces.filter((w) => w.type === 'team');
  const navItems = isSolo ? SOLO_NAV : GROUP_NAV;

  const copyJoinCode = () => {
    if (currentWorkspace?.join_code) {
      navigator.clipboard.writeText(currentWorkspace.join_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggleMode = (targetMode) => {
    if (targetMode === 'personal') {
      if (personalWorkspaces.length > 0) onSelectWorkspace(personalWorkspaces[0].id);
    } else if (teamWorkspaces.length > 0) {
      onSelectWorkspace(teamWorkspaces[0].id);
    } else {
      onOpenJoinWs();
    }
  };

  return (
    <aside
      className={`fixed lg:static inset-y-0 left-0 z-50 w-72 border-r border-slate-800/80 bg-slate-900/95 backdrop-blur-xl flex flex-col h-screen shadow-2xl transition-transform duration-200 ${
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}
    >
      <div className="p-4 border-b border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-extrabold text-white text-base shadow-lg shadow-indigo-500/25">
              N
            </div>
            <div>
              <span className="font-bold text-slate-100 text-lg leading-none block">NexaMind</span>
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Workspace</span>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden btn-ghost p-1.5" aria-label="Close sidebar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-slate-950/80 p-1 rounded-xl border border-slate-800/80 grid grid-cols-2 gap-1">
          <button
            onClick={() => handleToggleMode('personal')}
            className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
              isSolo ? 'bg-solo text-white shadow-glow-solo' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Solo
          </button>
          <button
            onClick={() => handleToggleMode('team')}
            className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
              !isSolo ? 'bg-accent text-white shadow-glow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Group ({teamWorkspaces.length})
          </button>
        </div>

        <button
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 transition group"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400" />
            <span>Quick search...</span>
          </div>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-500">⌘K</kbd>
        </button>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-500 uppercase tracking-wider">
              {isSolo ? 'Personal' : 'Team'}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={onOpenJoinWs} className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5">
                <Key className="w-2.5 h-2.5" /> Join
              </button>
              <button onClick={onOpenCreateWs} className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5">
                <Plus className="w-2.5 h-2.5" /> New
              </button>
            </div>
          </div>
          <select
            className="input-base py-2 text-xs font-medium"
            value={currentWorkspace?.id || ''}
            onChange={(e) => onSelectWorkspace(e.target.value)}
          >
            {personalWorkspaces.length > 0 && (
              <optgroup label="Personal">
                {personalWorkspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </optgroup>
            )}
            {teamWorkspaces.length > 0 && (
              <optgroup label="Team">
                {teamWorkspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          {!isSolo && currentWorkspace?.join_code && (
            <div className="flex items-center justify-between text-xs bg-slate-950/80 px-2.5 py-2 rounded-xl border border-slate-800/80 text-slate-400">
              <span className="text-[10px] text-slate-500">Join code</span>
              <button onClick={copyJoinCode} className="flex items-center gap-1 font-mono font-bold text-indigo-400 hover:text-indigo-300">
                {currentWorkspace.join_code}
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item) => {
          const Icon = ICON_MAP[item.icon] || Bot;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`nav-item ${
                isActive
                  ? isSolo
                    ? 'bg-solo-muted text-emerald-300 border border-emerald-500/30'
                    : 'bg-accent-muted text-indigo-300 border border-indigo-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? (isSolo ? 'text-solo' : 'text-indigo-400') : ''}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200 text-xs flex-shrink-0">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-slate-200 block truncate">{user?.name || 'User'}</span>
              <span className="text-[10px] text-slate-500 block truncate">{user?.email}</span>
            </div>
          </div>
          <button onClick={onLogout} title="Sign out" className="btn-ghost p-2 text-slate-400 hover:text-rose-400 flex-shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
