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
  Shield,
  Layers,
} from 'lucide-react';

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
}) {
  const [copied, setCopied] = useState(false);

  const copyJoinCode = () => {
    if (currentWorkspace?.join_code) {
      navigator.clipboard.writeText(currentWorkspace.join_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isSolo = currentWorkspace?.type === 'personal';

  const personalWorkspaces = workspaces.filter((w) => w.type === 'personal');
  const teamWorkspaces = workspaces.filter((w) => w.type === 'team');

  // Handle fast toggle between Solo and Group
  const handleToggleMode = (targetMode) => {
    if (targetMode === 'personal') {
      if (personalWorkspaces.length > 0) {
        onSelectWorkspace(personalWorkspaces[0].id);
      }
    } else {
      // Group mode
      if (teamWorkspaces.length > 0) {
        onSelectWorkspace(teamWorkspaces[0].id);
      } else {
        // No group workspace yet -> prompt user to join or create
        onOpenJoinWs();
      }
    }
  };

  // Solo navigation vs Group navigation
  const navItems = isSolo
    ? [
        { id: 'dashboard', label: 'Personal Dashboard', icon: Bot },
        {
          id: 'solo_chat',
          label: 'Solo Chat & Notes',
          icon: MessageSquare,
          badge: 'WhatsApp Style',
          badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        },
        {
          id: 'calendar',
          label: 'Calendar & Schedule',
          icon: Calendar,
          badge: 'AI Reminders',
          badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        },
        { id: 'ai_agent', label: 'Solo AI Copilot', icon: Sparkles },
        {
          id: 'meetings',
          label: 'Personal Video & MoM',
          icon: Video,
        },
        { id: 'documents', label: 'Personal Documents', icon: FileText },
        { id: 'projects', label: 'Personal Tasks (Kanban)', icon: FolderKanban },
        { id: 'settings', label: 'Account & Preferences', icon: Settings },
      ]
    : [
        { id: 'dashboard', label: 'Group Dashboard', icon: Bot },
        {
          id: 'ai_agent',
          label: 'Group Omni-Agent AI',
          icon: Sparkles,
          badge: 'Full Control',
          badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        },
        {
          id: 'meetings',
          label: 'Group Meetings & Video',
          icon: Video,
          badge: 'Live MoM',
          badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        },
        {
          id: 'channels',
          label: 'Group Channels',
          icon: MessageSquare,
          badge: 'Live WS',
          badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        },
        { id: 'calendar', label: 'Group Calendar & Milestones', icon: Calendar },
        { id: 'documents', label: 'Group Documents & Specs', icon: FileText },
        { id: 'projects', label: 'Group Sprint Kanban', icon: FolderKanban },
        { id: 'code', label: 'Group Code Repos', icon: Code2 },
        { id: 'settings', label: 'Group Roster & Settings', icon: Settings },
      ];

  return (
    <aside className="w-68 border-r border-slate-800 bg-slate-900/80 backdrop-blur-md flex flex-col h-screen select-none shadow-2xl">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center font-extrabold text-white text-base shadow-lg shadow-indigo-500/25">
              N
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-slate-100 text-lg leading-none block">
                NexaMind
              </span>
              <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
                2.0 Platform
              </span>
            </div>
          </div>

          <span
            className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold font-mono border ${
              isSolo
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
            }`}
          >
            {isSolo ? '👤 SOLO' : '👥 GROUP'}
          </span>
        </div>

        {/* WORKSPACE MODE QUICK TOGGLE PILL */}
        <div className="bg-slate-950 p-1 rounded-2xl border border-slate-800 grid grid-cols-2 gap-1 text-xs">
          <button
            onClick={() => handleToggleMode('personal')}
            className={`py-1.5 px-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition ${
              isSolo
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Solo Space</span>
          </button>

          <button
            onClick={() => handleToggleMode('team')}
            className={`py-1.5 px-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition ${
              !isSolo
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Group ({teamWorkspaces.length})</span>
          </button>
        </div>

        {/* Global Search / Command Palette Shortcut */}
        <button
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between bg-slate-950/80 hover:bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 transition group"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition" />
            <span className="text-xs">Quick Search...</span>
          </div>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-400">
            Ctrl+K
          </kbd>
        </button>

        {/* Active Workspace Selector & Actions */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-400 uppercase tracking-wider">
              {isSolo ? 'Personal Space' : 'Active Group'}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={onOpenJoinWs}
                title="Join a Group via Code"
                className="text-[10px] text-indigo-400 hover:underline flex items-center gap-0.5"
              >
                <Key className="w-2.5 h-2.5" />
                <span>Join</span>
              </button>
              <span className="text-slate-600">•</span>
              <button
                onClick={onOpenCreateWs}
                title="Create New Group"
                className="text-[10px] text-indigo-400 hover:underline flex items-center gap-0.5"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>New</span>
              </button>
            </div>
          </div>

          <select
            className="w-full bg-slate-950 border border-slate-800 text-xs font-semibold rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 truncate"
            value={currentWorkspace?.id || ''}
            onChange={(e) => onSelectWorkspace(e.target.value)}
          >
            {personalWorkspaces.length > 0 && (
              <optgroup label="👤 Solo / Personal Spaces">
                {personalWorkspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    👤 {w.name}
                  </option>
                ))}
              </optgroup>
            )}
            {teamWorkspaces.length > 0 && (
              <optgroup label="👥 Group / Team Workspaces">
                {teamWorkspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    👥 {w.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {/* Group Join Code Info Pill */}
          {!isSolo && currentWorkspace?.join_code && (
            <div className="flex items-center justify-between text-xs bg-slate-950/90 px-2.5 py-1.5 rounded-xl border border-slate-800 text-slate-400">
              <span className="text-[10px]">Group Join Code:</span>
              <button
                onClick={copyJoinCode}
                className="flex items-center gap-1 font-mono font-bold text-indigo-400 hover:text-indigo-300 transition"
                title="Click to copy join code for your team"
              >
                <span>{currentWorkspace.join_code}</span>
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isActive
                  ? isSolo
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon
                  className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                    isActive
                      ? isSolo
                        ? 'text-emerald-400'
                        : 'text-indigo-400'
                      : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                    item.badgeColor || 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User Footer Profile */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200 text-xs">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-200 block truncate">
                {user?.name || 'Developer'}
              </span>
              <span className="text-[10px] text-slate-500 block truncate">
                {user?.email || 'user@nexamind.app'}
              </span>
            </div>
          </div>

          <button
            onClick={onLogout}
            title="Sign Out"
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 rounded-xl transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
