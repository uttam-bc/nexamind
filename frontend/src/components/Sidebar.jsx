import React, { useEffect, useRef, useState } from 'react';
import {
  Home,
  FileText,
  FolderKanban,
  Calendar,
  Sparkles,
  Video,
  MessageSquare,
  Code2,
  DollarSign,
  FileBarChart,
  Settings,
  LogOut,
  Search,
  User,
  Users,
  ChevronsUpDown,
  Check,
  Copy,
  Plus,
  KeyRound,
} from 'lucide-react';
import Logo from './ui/Logo';
import ThemeToggle from './ui/ThemeToggle';
import WorkspaceSwitch from './WorkspaceSwitch';
import { notify } from '../context/ToastContext';
import { originOf } from '../lib/viewTransition';

// Open-plane sidebar: it sits on the page ground with one hairline, labelled navigation on a 34px
// pitch, the workspace and the Solo/Group switch at the top, and the person and utilities at the
// bottom. There is no top bar on desktop.
export default function Sidebar({
  activeTab,
  onTabChange,
  workspaces,
  currentWorkspace,
  onSelectWorkspace,
  onToggleMode,
  onOpenCreateWs,
  onOpenJoinWs,
  onOpenSearch,
  onLogout,
  user,
  unreadCounts = {},
  userPresence = 'online',
  onChangePresence,
  notifications,
}) {
  const [menu, setMenu] = useState(null); // 'workspace' | 'account' | null
  const wsRef = useRef(null);
  const accountRef = useRef(null);
  const isSolo = currentWorkspace?.type === 'personal';

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      const ref = menu === 'workspace' ? wsRef : accountRef;
      if (ref.current && !ref.current.contains(e.target)) setMenu(null);
    };
    const onKey = (e) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const hasUnread = Object.values(unreadCounts).some((n) => n > 0);
  const primary = [
    { id: 'dashboard', label: 'Home', icon: Home },
    { id: 'documents', label: 'Docs', icon: FileText, also: ['files'] },
    { id: isSolo ? 'solo_chat' : 'channels', label: isSolo ? 'Chat' : 'Channels', icon: MessageSquare, dot: hasUnread },
    { id: 'meetings', label: 'Meetings', icon: Video },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'projects', label: isSolo ? 'Tasks' : 'Sprint board', icon: FolderKanban },
    { id: 'code', label: 'Repositories', icon: Code2 },
    { id: 'ai_agent', label: 'Copilot', icon: Sparkles },
  ];
  const secondary = [
    { id: 'finance', label: 'Finance', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
  const presenceColors = { online: 'bg-emerald-500', away: 'bg-amber-400', busy: 'bg-rose-500', offline: 'bg-slate-400' };

  const navItem = (item) => {
    const Icon = item.icon;
    const active = activeTab === item.id || (item.also || []).includes(activeTab);
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => onTabChange(item.id)}
          aria-current={active ? 'page' : undefined}
          className={`group relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-fast ${
            active ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
          }`}
        >
          <Icon
            className={`h-4 w-4 shrink-0 transition-colors duration-fast ${active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="truncate">{item.label}</span>
          {item.dot && !active && (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-600">
              <span className="sr-only">Unread messages</span>
            </span>
          )}
        </button>
      </li>
    );
  };

  const copyJoinCode = async () => {
    setMenu(null);
    if (!currentWorkspace?.join_code) return;
    try {
      await navigator.clipboard.writeText(currentWorkspace.join_code);
      notify(`Join code copied: ${currentWorkspace.join_code}`, 'success');
    } catch {
      notify(`Join code: ${currentWorkspace.join_code}`, 'info');
    }
  };

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Product and workspace */}
      <div className="px-3 pt-4">
        <button type="button" onClick={() => onTabChange('dashboard')} aria-label="Go to home" className="mb-4 block rounded-lg px-2">
          <Logo alt="" className="h-6" />
        </button>

        <div className="relative" ref={wsRef}>
          <button
            type="button"
            onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')}
            aria-haspopup="menu"
            aria-expanded={menu === 'workspace'}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors duration-fast hover:bg-slate-100"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-semibold text-white transition-colors duration-panel">
              {(currentWorkspace?.name || 'NM').slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{currentWorkspace?.name || 'Workspace'}</span>
              <span className="block text-xs text-slate-500">{isSolo ? 'Solo workspace' : 'Group workspace'}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          {menu === 'workspace' && (
            <div role="menu" aria-label="Workspaces" className="absolute left-0 right-0 top-full z-50 mt-1 animate-scale-in origin-top rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel">
              <p className="px-2 py-1 text-xs text-slate-500">Workspaces</p>
              <div className="max-h-60 overflow-y-auto">
                {workspaces.map((ws) => {
                  const personal = ws.type === 'personal';
                  const current = ws.id === currentWorkspace?.id;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      onClick={(e) => {
                        setMenu(null);
                        onSelectWorkspace(ws.id, originOf(e));
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-colors duration-fast hover:bg-slate-100"
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${personal ? 'bg-solo-50 text-solo-700' : 'bg-group-50 text-group-700'}`} aria-hidden="true">
                        {personal ? <User className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                      <span className="text-xs text-slate-500">{personal ? 'Solo' : 'Group'}</span>
                      {current && <Check className="h-3.5 w-3.5 text-slate-700" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 border-t border-slate-100 pt-1">
                {currentWorkspace?.join_code && (
                  <button type="button" role="menuitem" onClick={copyJoinCode} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy join code
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { setMenu(null); onOpenCreateWs(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Create a group
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenu(null); onOpenJoinWs(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Join with a code
                </button>
              </div>
            </div>
          )}
        </div>

        <WorkspaceSwitch isSolo={isSolo} onChange={onToggleMode} className="mt-3" />

        <button
          type="button"
          onClick={onOpenSearch}
          className="mt-3 flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-sm text-slate-500 transition-colors duration-fast hover:border-slate-300 hover:text-slate-700"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-slate-200 px-1 font-sans text-[11px] text-slate-500">Ctrl K</kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Sections" className="mt-4 flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">{primary.map(navItem)}</ul>
        <p className="mt-7 mb-1 px-2.5 text-xs text-slate-500">Workspace</p>
        <ul className="space-y-0.5">{secondary.map(navItem)}</ul>
      </nav>

      {/* Person and utilities */}
      <div className="border-t border-slate-200 px-3 py-3">
        <div className="mb-2 flex items-center gap-0.5">
          {notifications}
          <ThemeToggle />
        </div>
        <div className="relative" ref={accountRef}>
          <button
            type="button"
            onClick={() => setMenu(menu === 'account' ? null : 'account')}
            aria-haspopup="menu"
            aria-expanded={menu === 'account'}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors duration-fast hover:bg-slate-100"
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              {(user?.name || 'U').slice(0, 1).toUpperCase()}
              <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${presenceColors[userPresence] || presenceColors.online}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{user?.name || 'You'}</span>
              <span className="block truncate text-xs capitalize text-slate-500">{userPresence}</span>
            </span>
          </button>
          {menu === 'account' && (
            <div role="menu" aria-label="Account" className="absolute bottom-full left-0 right-0 z-50 mb-1 animate-scale-in origin-bottom rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel">
              <p className="truncate px-2 py-1 text-xs text-slate-500">{user?.email}</p>
              {['online', 'away', 'busy', 'offline'].map((status) => (
                <button
                  key={status}
                  type="button"
                  role="menuitemradio"
                  aria-checked={userPresence === status}
                  onClick={() => { onChangePresence?.(status); setMenu(null); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm capitalize text-slate-700 hover:bg-slate-100"
                >
                  <span className={`h-2 w-2 rounded-full ${presenceColors[status]}`} aria-hidden="true" />
                  {status}
                  {userPresence === status && <Check className="ml-auto h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              ))}
              <div className="mt-1 border-t border-slate-100 pt-1">
                <button type="button" role="menuitem" onClick={() => { setMenu(null); onTabChange('settings'); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                  <Settings className="h-3.5 w-3.5" aria-hidden="true" /> Account settings
                </button>
                <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-rose-700 hover:bg-rose-50">
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
