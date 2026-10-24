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
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Hash,
  Search,
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
  documents = [],
  channels = [],
  unreadCounts = {},
  userPresence = 'online',
  onChangePresence,
}) {
  const [showWsDropdown, setShowWsDropdown] = useState(false);
  const [showPresenceMenu, setShowPresenceMenu] = useState(false);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);

  const isSolo = currentWorkspace?.type === 'personal';

  const activityRailItems = [
    { id: 'dashboard', label: 'Activity', icon: LayoutDashboard },
    // Docs holds both pages and uploaded files.
    { id: 'documents', label: 'Docs', icon: FileText, badge: documents.length > 0 ? documents.length : null, also: ['files'] },
    {
      id: isSolo ? 'solo_chat' : 'channels',
      label: isSolo ? 'Chat' : 'Channels',
      icon: MessageSquare,
      hasUnread: Object.values(unreadCounts).some((cnt) => cnt > 0),
    },
    { id: 'projects', label: 'Tasks', icon: FolderKanban },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'meetings', label: 'Meet', icon: Video },
    { id: 'ai_agent', label: 'Copilot', icon: Sparkles, accent: true },
    { id: 'code', label: 'Repos', icon: Code2 },
  ];

  const presenceColors = {
    online: 'bg-emerald-500',
    away: 'bg-amber-400',
    busy: 'bg-rose-500',
    offline: 'bg-slate-400',
  };

  return (
    <div className="hidden md:flex h-full select-none shrink-0">
      {/* 1. MICROSOFT TEAMS ACTIVITY RAIL (56px) */}
      <aside className="w-[4.5rem] bg-[#1E1B4B] text-slate-300 flex flex-col items-center py-3 justify-between border-r border-[#312E81] z-20">
        {/* Top: Current Workspace Icon */}
        <div className="flex flex-col items-center gap-4 w-full">
          <button
            onClick={() => setShowWsDropdown(!showWsDropdown)}
            title={currentWorkspace?.name || 'Workspace'}
            className="w-10 h-10 rounded-xl bg-[#4F46E5] text-white flex items-center justify-center font-bold text-sm shadow-md hover:scale-105 transition-all relative"
          >
            {currentWorkspace?.name ? currentWorkspace.name.slice(0, 2).toUpperCase() : 'NM'}
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#1E1B4B] bg-emerald-400" />
          </button>

          <div className="w-8 h-[1px] bg-[#312E81]" />

          {/* Activity Rail Navigation Icons */}
          <nav aria-label="Sections" className="flex flex-col items-center gap-1.5 w-full overflow-y-auto max-h-[calc(100vh-15rem)]">
            {activityRailItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id || (item.also || []).includes(activeTab);
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  title={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-16 h-12 rounded-xl flex flex-col items-center justify-center relative transition-all duration-150 ${
                    isActive
                      ? 'bg-[#4F46E5] text-white shadow-lg shadow-indigo-950 font-bold'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-[#312E81]/60'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${item.accent && !isActive ? 'text-amber-400' : ''}`} />
                  <span className="text-xs font-medium leading-none mt-1">{item.label}</span>

                  {/* Active Indicator Bar */}
                  {isActive && (
                    <div className="absolute -left-1.5 top-2 bottom-2 w-1 bg-white rounded-r-full" />
                  )}

                  {/* Unread Message Dot Badge */}
                  {item.hasUnread && !isActive && (
                    <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#1E1B4B]" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Rail Actions: Settings & Presence Avatar */}
        <div className="flex flex-col items-center gap-2 relative">
          <button
            onClick={() => onTabChange('finance')}
            title="Finance"
            aria-label="Finance"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
              activeTab === 'finance'
                ? 'bg-[#4F46E5] text-white'
                : 'text-slate-400 hover:text-white hover:bg-[#312E81]/60'
            }`}
          >
            <DollarSign className="w-5 h-5" />
          </button>

          <button
            onClick={() => onTabChange('settings')}
            title="Settings"
            aria-label="Settings"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
              activeTab === 'settings'
                ? 'bg-[#4F46E5] text-white'
                : 'text-slate-400 hover:text-white hover:bg-[#312E81]/60'
            }`}
          >
            <Settings className="w-5 h-5" />
          </button>

          <div className="w-8 h-[1px] bg-[#312E81] my-1" />

          {/* User Presence Avatar */}
          <div className="relative">
            <button
              onClick={() => setShowPresenceMenu(!showPresenceMenu)}
              className="w-9 h-9 rounded-full bg-slate-700 text-white flex items-center justify-center font-bold text-xs hover:ring-2 hover:ring-indigo-400 transition"
              title={`${user?.name || 'User'} (${userPresence})`}
            >
              {user?.name ? user.name[0].toUpperCase() : 'U'}
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-[#1E1B4B] ${presenceColors[userPresence] || presenceColors.online}`}
              />
            </button>

            {/* Presence Status Popup */}
            {showPresenceMenu && (
              <div className="absolute bottom-0 left-12 bg-white text-slate-800 rounded-xl p-2 shadow-2xl border border-slate-200 w-44 z-50 text-xs">
                <div className="px-2 py-1 border-b border-slate-100 font-bold text-slate-900 truncate">
                  {user?.name || 'User'}
                </div>
                <div className="py-1">
                  {['online', 'away', 'busy', 'offline'].map((status) => (
                    <button
                      key={status}
                      onClick={() => {
                        if (onChangePresence) onChangePresence(status);
                        setShowPresenceMenu(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 flex items-center gap-2 capitalize"
                    >
                      <span className={`w-2 h-2 rounded-full ${presenceColors[status]}`} />
                      <span>{status}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={onLogout}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 flex items-center gap-2 border-t border-slate-100 mt-1"
                >
                  <LogOut className="w-3.5 h-3.5" /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 2. CONTEXTUAL NOTION-STYLE EXPANDABLE PANEL (220px) */}
      {isPanelExpanded && (
        <aside className="w-60 bg-[#F8FAFC] border-r border-[#E2E8F0] flex flex-col py-4 px-3 text-[#191C1E] justify-between z-10">
          <div>
            {/* Workspace Header Dropdown */}
            <div className="relative mb-3">
              <div
                onClick={() => setShowWsDropdown(!showWsDropdown)}
                className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#ECEEF0] transition cursor-pointer group border border-transparent hover:border-slate-200"
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${
                    isSolo
                      ? 'bg-sky-50 text-sky-600 border-sky-200'
                      : 'bg-purple-50 text-[#8B5CF6] border-purple-200'
                  }`}
                >
                  {isSolo ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xs font-bold text-slate-900 truncate tracking-tight">
                    {currentWorkspace?.name || (isSolo ? 'Solo Space' : 'Team Hub')}
                  </h2>
                  <p className="text-xs text-slate-500 font-mono capitalize">
                    {isSolo ? 'Personal' : 'Team'} Space
                  </p>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition" />
              </div>

              {/* Workspace Switcher Menu */}
              {showWsDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E2E8F0] rounded-xl p-2 shadow-2xl z-50 space-y-1.5">
                  <div className="text-xs font-mono font-bold uppercase text-slate-400 px-2 py-0.5">
                    Workspaces
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => {
                          onSelectWorkspace(ws.id);
                          setShowWsDropdown(false);
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between transition ${
                          ws.id === currentWorkspace?.id
                            ? 'bg-indigo-50 text-[#4F46E5] font-bold border border-indigo-200'
                            : 'text-slate-700 hover:bg-[#F2F4F6]'
                        }`}
                      >
                        <span className="truncate">{ws.name}</span>
                        <span
                          className={`text-xs font-mono uppercase px-1.5 py-0.5 rounded ${
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
                      className="flex-1 text-center py-1 text-xs font-bold text-[#4F46E5] hover:bg-indigo-50 rounded-lg transition"
                    >
                      + Create Group
                    </button>
                    <button
                      onClick={() => {
                        setShowWsDropdown(false);
                        onOpenJoinWs();
                      }}
                      className="flex-1 text-center py-1 text-xs font-bold text-slate-700 hover:bg-[#F2F4F6] rounded-lg transition"
                    >
                      Join Code
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Contextual Quick Actions for Active Tab */}
            {activeTab === 'documents' && (
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between px-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <span>Notion Pages</span>
                  <button
                    onClick={() => onTabChange('documents')}
                    className="hover:text-indigo-600 transition"
                    title="Add Page"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-0.5 max-h-56 overflow-y-auto">
                  {documents.slice(0, 8).map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => onTabChange('documents')}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-[#ECEEF0] flex items-center gap-2 truncate"
                    >
                      <span className="text-sm">{doc.icon || '📄'}</span>
                      <span className="truncate">{doc.title}</span>
                    </button>
                  ))}
                  {documents.length === 0 && (
                    <div className="text-xs text-slate-400 px-2 py-1 italic">No pages yet</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'channels' && (
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between px-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <span>Channels</span>
                  <button
                    onClick={() => onTabChange('channels')}
                    className="hover:text-indigo-600 transition"
                    title="Add Channel"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-0.5 max-h-56 overflow-y-auto">
                  {channels.map((chan) => (
                    <button
                      key={chan.id}
                      onClick={() => onTabChange('channels')}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-[#ECEEF0] flex items-center justify-between truncate"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Hash className="w-3.5 h-3.5 text-slate-400" />
                        <span className="truncate">{chan.name}</span>
                      </div>
                      {unreadCounts[chan.id] > 0 && (
                        <span className="bg-rose-500 text-white font-bold text-xs px-1.5 py-0.2 rounded-full">
                          {unreadCounts[chan.id]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'solo_chat' && (
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between px-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <span>Direct Chats</span>
                  <button
                    onClick={() => onTabChange('solo_chat')}
                    className="hover:text-indigo-600 transition"
                    title="Open Direct Messages"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-0.5 max-h-56 overflow-y-auto">
                  {channels
                    .filter((c) => c.is_direct)
                    .map((chan) => (
                      <button
                        key={chan.id}
                        onClick={() => onTabChange('solo_chat')}
                        className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-[#ECEEF0] flex items-center justify-between truncate"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <User className="w-3.5 h-3.5 text-indigo-500" />
                          <span className="truncate">{chan.name.replace('dm-', '@')}</span>
                        </div>
                      </button>
                    ))}
                  {channels.filter((c) => c.is_direct).length === 0 && (
                    <div className="text-xs text-slate-400 px-2 py-1 italic">No direct chats yet</div>
                  )}
                </div>
              </div>
            )}

            {/* Quick Action Button */}
            <button
              onClick={() => {
                if (activeTab === 'documents') onTabChange('documents');
                else if (activeTab === 'channels') onTabChange('channels');
                else onTabChange(isSolo ? 'documents' : 'projects');
              }}
              className="w-full bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-semibold py-2 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 mb-3"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{activeTab === 'documents' ? 'New Page' : isSolo ? 'New Draft' : 'New Sprint'}</span>
            </button>
          </div>

          {/* Panel Collapse Toggle */}
          <div className="pt-2 border-t border-slate-200">
            <button
              onClick={() => setIsPanelExpanded(false)}
              className="w-full flex items-center justify-center gap-1.5 py-1 text-slate-400 hover:text-slate-700 text-xs transition"
              title="Collapse Panel"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
              <span>Collapse Sidebar</span>
            </button>
          </div>
        </aside>
      )}

      {/* Uncollapse button when panel is closed */}
      {!isPanelExpanded && (
        <button
          onClick={() => setIsPanelExpanded(true)}
          className="self-start mt-4 -ml-2 bg-white border border-slate-200 shadow-sm rounded-r-lg p-1 text-slate-500 hover:text-slate-900 transition z-20"
          title="Expand Sidebar"
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
