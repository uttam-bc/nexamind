import React, { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  FolderKanban,
  Calendar,
  Sparkles,
  Video,
  MessageSquare,
  Code2,
  DollarSign,
  Settings,
  LogOut,
  Plus,
  User,
  Users,
  ChevronDown,
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
}) {
  const [showWsDropdown, setShowWsDropdown] = useState(false);

  const isSolo = currentWorkspace?.type === 'personal';
  const personalWorkspaces = workspaces.filter((w) => w.type === 'personal');
  const teamWorkspaces = workspaces.filter((w) => w.type === 'team');

  const handleToggleMode = (targetMode) => {
    if (targetMode === 'personal') {
      if (personalWorkspaces.length > 0) {
        onSelectWorkspace(personalWorkspaces[0].id);
      }
    } else {
      if (teamWorkspaces.length > 0) {
        onSelectWorkspace(teamWorkspaces[0].id);
      } else {
        onOpenJoinWs();
      }
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'projects', label: 'Kanban', icon: FolderKanban },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'ai_agent', label: 'Copilot', icon: Sparkles },
    { id: 'meetings', label: 'Meetings', icon: Video },
    ...(isSolo
      ? [{ id: 'solo_chat', label: 'Solo Chat', icon: MessageSquare }]
      : [{ id: 'channels', label: 'Channels', icon: MessageSquare }]),
    { id: 'code', label: 'Code Repos', icon: Code2 },
  ];

  return (
    <nav className="hidden md:flex flex-col py-5 px-4 space-y-2 bg-[#F8FAFC] text-[#191C1E] border-r border-[#E2E8F0] w-[260px] h-full flex-shrink-0 select-none">
      {/* Workspace Header (Exact Stitch Spec) */}
      <div className="relative mb-3">
        <div
          onClick={() => setShowWsDropdown(!showWsDropdown)}
          className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#ECEEF0] transition cursor-pointer group"
        >
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 ${
              isSolo
                ? 'bg-sky-50 text-sky-600 border-sky-200'
                : 'bg-purple-50 text-[#8B5CF6] border-purple-200'
            }`}
          >
            {isSolo ? <User className="w-5 h-5" /> : <Users className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-extrabold text-[#191C1E] truncate tracking-tight">
              {currentWorkspace?.name || (isSolo ? 'Solo Account' : 'Engineering Hub')}
            </h2>
            <p className="text-xs text-slate-500 font-mono">
              {isSolo ? 'Solo Environment' : 'Group Workspace'}
            </p>
          </div>
          <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition" />
        </div>

        {/* Dropdown for workspace switching */}
        {showWsDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E2E8F0] rounded-xl p-2 shadow-xl z-50 space-y-1.5">
            <div className="text-[10px] font-mono font-bold uppercase text-slate-400 px-2 py-1">
              Select Workspace
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    onSelectWorkspace(ws.id);
                    setShowWsDropdown(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition ${
                    ws.id === currentWorkspace?.id
                      ? 'bg-indigo-50 text-[#4F46E5] font-bold border border-indigo-200'
                      : 'text-slate-700 hover:bg-[#F2F4F6]'
                  }`}
                >
                  <span className="truncate">{ws.name}</span>
                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      ws.type === 'personal'
                        ? 'bg-sky-100 text-sky-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {ws.type}
                  </span>
                </button>
              ))}
            </div>

            <div className="border-t border-[#E2E8F0] pt-1.5 flex gap-1">
              <button
                onClick={() => {
                  setShowWsDropdown(false);
                  onOpenCreateWs();
                }}
                className="flex-1 text-center py-1 text-[11px] font-bold text-[#4F46E5] hover:bg-indigo-50 rounded-lg transition"
              >
                + Create
              </button>
              <button
                onClick={() => {
                  setShowWsDropdown(false);
                  onOpenJoinWs();
                }}
                className="flex-1 text-center py-1 text-[11px] font-bold text-slate-700 hover:bg-[#F2F4F6] rounded-lg transition"
              >
                Join Code
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Primary Action Button (Exact Stitch Spec) */}
      <button
        onClick={() => {
          if (!isSolo) onTabChange('projects');
          else onTabChange('documents');
        }}
        style={{ backgroundColor: '#4F46E5', color: '#FFFFFF' }}
        className="w-full mb-4 btn-primary-indigo text-white text-xs font-semibold py-2.5 rounded-xl shadow-sm hover:opacity-95 transition-all flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4 text-white" />
        <span className="font-bold text-white">{isSolo ? 'New Draft' : 'New Sprint'}</span>
      </button>

      {/* Navigation Links */}
      <div className="flex-1 flex flex-col space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              style={isActive ? { backgroundColor: '#4F46E5', color: '#FFFFFF' } : {}}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-all duration-150 text-left ${
                isActive
                  ? 'nav-item-active text-white font-bold shadow-sm'
                  : 'text-slate-700 hover:bg-[#ECEEF0] hover:text-[#191C1E]'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
              <span className={`font-medium text-xs ${isActive ? 'text-white font-bold' : 'text-slate-700'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode Switcher Pill */}
      <div className="p-1 bg-[#ECEEF0] rounded-xl flex items-center gap-1">
        <button
          onClick={() => handleToggleMode('personal')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold transition ${
            isSolo
              ? 'bg-white text-sky-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <User className="w-3 h-3" /> Solo
        </button>
        <button
          onClick={() => handleToggleMode('team')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold transition ${
            !isSolo
              ? 'bg-white text-purple-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-3 h-3" /> Group
        </button>
      </div>

      {/* Bottom Pinned Links (Exact Stitch Spec) */}
      <div className="mt-auto border-t border-[#E2E8F0] pt-3 space-y-1">
        <button
          onClick={() => onTabChange('finance')}
          style={activeTab === 'finance' ? { backgroundColor: '#4F46E5', color: '#FFFFFF' } : {}}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition text-left ${
            activeTab === 'finance'
              ? 'nav-item-active text-white font-bold'
              : 'text-slate-700 hover:bg-[#ECEEF0] hover:text-[#191C1E]'
          }`}
        >
          <DollarSign className={`w-4 h-4 ${activeTab === 'finance' ? 'text-white' : 'text-slate-500'}`} />
          <span className={`font-medium ${activeTab === 'finance' ? 'text-white font-bold' : 'text-slate-700'}`}>
            Finance
          </span>
        </button>

        <button
          onClick={() => onTabChange('settings')}
          style={activeTab === 'settings' ? { backgroundColor: '#4F46E5', color: '#FFFFFF' } : {}}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition text-left ${
            activeTab === 'settings'
              ? 'nav-item-active text-white font-bold'
              : 'text-slate-700 hover:bg-[#ECEEF0] hover:text-[#191C1E]'
          }`}
        >
          <Settings className={`w-4 h-4 ${activeTab === 'settings' ? 'text-white' : 'text-slate-500'}`} />
          <span className={`font-medium ${activeTab === 'settings' ? 'text-white font-bold' : 'text-slate-700'}`}>
            Settings
          </span>
        </button>

        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-rose-600 hover:bg-rose-50 transition text-left"
        >
          <LogOut className="w-4 h-4 text-rose-500" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </nav>
  );
}
