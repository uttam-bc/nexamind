import React, { useState, useEffect } from 'react';
import {
  Bot,
  Search,
  Video,
  Bell,
  HelpCircle,
  Plus,
  User,
  Users,
  Sparkles,
  Calendar,
} from 'lucide-react';
import {
  api,
  getAuthToken,
  setAuthToken,
  getSavedWorkspaceId,
  setSavedWorkspaceId,
} from './api';

import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Meetings from './components/Meetings';
import Documents from './components/Documents';
import KanbanBoard from './components/KanbanBoard';
import CodeWorkspace from './components/CodeWorkspace';
import Channels from './components/Channels';
import WorkspaceSettings from './components/WorkspaceSettings';
import CommandPalette from './components/CommandPalette';
import AiAssistant from './components/AiAssistant';
import SoloChat from './components/SoloChat';
import CalendarView from './components/CalendarView';
import AiReminderToast from './components/AiReminderToast';
import FinanceTracker from './components/FinanceTracker';

export default function App() {
  // Auth state
  const [token, setToken] = useState(getAuthToken());
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authForm, setAuthForm] = useState({
    name: '',
    email: 'admin@nexamind.app',
    password: 'password123',
  });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Workspaces state
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [showCreateWsModal, setShowCreateWsModal] = useState(false);
  const [showJoinWsModal, setShowJoinWsModal] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');

  // Command Palette State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Active module navigation
  const [activeTab, setActiveTab] = useState('dashboard');

  // Module data
  const [tasks, setTasks] = useState([]);
  const [channels, setChannels] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [filesList, setFilesList] = useState([]);
  const [repos, setRepos] = useState([]);
  const [reports, setReports] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);

  // Setup global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load user data on startup / login
  useEffect(() => {
    if (token) {
      loadInitialData();
    }
  }, [token]);

  // Load module data when current workspace changes
  useEffect(() => {
    if (currentWorkspace) {
      loadWorkspaceData(currentWorkspace.id);
    }
  }, [currentWorkspace, activeTab]);

  const loadInitialData = async () => {
    try {
      const userData = await api.getMe();
      setUser(userData);
      const wsList = await api.listWorkspaces();
      setWorkspaces(wsList);

      // Prioritize saved workspace ID, otherwise default to Team/Group workspace
      const savedId = getSavedWorkspaceId();
      const savedWs = wsList.find((w) => w.id === savedId);
      const teamWs = wsList.find((w) => w.type === 'team' || w.type === 'group');
      const personalWs = wsList.find((w) => w.type === 'personal');
      const targetWs = savedWs || teamWs || personalWs || wsList[0];
      if (targetWs) {
        setCurrentWorkspace(targetWs);
        setSavedWorkspaceId(targetWs.id);
      }
    } catch (err) {
      console.error('Initial load error', err);
      handleLogout();
    }
  };

  const loadWorkspaceData = async (wsId) => {
    try {
      if (activeTab === 'dashboard') {
        const [tList, fSum, sList, dList, cList] = await Promise.all([
          api.listTasks(wsId).catch(() => []),
          api.getFinanceSummary(wsId).catch(() => null),
          api.listSessions(wsId).catch(() => []),
          api.listDocuments(wsId).catch(() => []),
          api.listChannels(wsId).catch(() => []),
        ]);
        setTasks(tList);
        setFinanceSummary(fSum);
        setSessions(sList);
        setDocuments(dList);
        setChannels(cList);
      } else if (activeTab === 'documents') {
        const dList = await api.listDocuments(wsId).catch(() => []);
        setDocuments(dList);
      } else if (activeTab === 'projects') {
        const tList = await api.listTasks(wsId).catch(() => []);
        setTasks(tList);
      } else if (activeTab === 'meetings') {
        const sList = await api.listSessions(wsId).catch(() => []);
        setSessions(sList);
      } else if (activeTab === 'channels') {
        const cList = await api.listChannels(wsId).catch(() => []);
        setChannels(cList);
      } else if (activeTab === 'finance') {
        const [fSum, tList] = await Promise.all([
          api.getFinanceSummary(wsId).catch(() => null),
          api.listTransactions(wsId).catch(() => []),
        ]);
        setFinanceSummary(fSum);
        setTransactions(tList);
      } else if (activeTab === 'code') {
        const rList = await api.listRepos(wsId).catch(() => []);
        setRepos(rList);
      }
    } catch (err) {
      console.error('Error loading module data', err);
    }
  };

  const handleSelectWorkspace = (wsId) => {
    const targetWs = workspaces.find((w) => w.id === wsId);
    if (targetWs) {
      setCurrentWorkspace(targetWs);
      setSavedWorkspaceId(targetWs.id);
    }
  };

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    try {
      const created = await api.createWorkspace(newWsName.trim());
      setWorkspaces((prev) => [...prev, created]);
      setCurrentWorkspace(created);
      setSavedWorkspaceId(created.id);
      setShowCreateWsModal(false);
      setNewWsName('');
    } catch (err) {
      alert(err.message || 'Could not create workspace');
    }
  };

  const handleJoinWorkspace = async (e) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    try {
      const joined = await api.joinWorkspace(joinCodeInput.trim().toUpperCase());
      const wsList = await api.listWorkspaces();
      setWorkspaces(wsList);
      setCurrentWorkspace(joined);
      setSavedWorkspaceId(joined.id);
      setShowJoinWsModal(false);
      setJoinCodeInput('');
    } catch (err) {
      alert(err.message || 'Invalid or expired join code');
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      if (authMode === 'register') {
        await api.register(authForm.name, authForm.email, authForm.password);
      }
      const loginRes = await api.login(authForm.email, authForm.password);
      setAuthToken(loginRes.access_token);
      setToken(loginRes.access_token);
    } catch (err) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setWorkspaces([]);
    setCurrentWorkspace(null);
  };

  // If not logged in, render clean Auth Screen
  if (!token) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-sans text-[#191C1E]">
        <div className="w-full max-w-md bg-white border border-[#E2E8F0] rounded-2xl shadow-xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto text-[#4F46E5]">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-extrabold text-[#191C1E] tracking-tight">
              NexaMind 2.0
            </h1>
            <p className="text-xs text-slate-500 font-mono">
              Autonomous AI Workspace & Engineering Platform
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
                {authError}
              </div>
            )}

            {authMode === 'register' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Mitchell"
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] outline-none transition font-sans"
                  value={authForm.name}
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Email Address</label>
              <input
                type="email"
                required
                placeholder="name@nexamind.app"
                className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] outline-none transition font-sans"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] outline-none transition font-sans"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-[#4F46E5] hover:bg-[#4338CA] text-white py-2.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition flex items-center justify-center gap-2"
            >
              {authLoading
                ? 'Authenticating...'
                : authMode === 'login'
                ? 'Sign In to Workspace'
                : 'Create Account & Launch Solo Space'}
            </button>
          </form>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError('');
              }}
              className="text-xs text-[#4F46E5] hover:underline font-semibold"
            >
              {authMode === 'login'
                ? "Don't have an account? Register"
                : 'Already have an account? Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-[#F8FAFC] text-[#191C1E] font-sans antialiased overflow-hidden">
      {/* TopNavBar (Exact Stitch Specification) */}
      <header className="fixed top-0 left-0 w-full z-40 flex justify-between items-center px-6 h-16 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] shadow-sm">
        <div className="flex items-center gap-6">
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-2 text-[#191C1E] font-extrabold text-base tracking-tight">
            <span className="text-[#4F46E5] text-lg font-bold">⚡</span>
            <span>NexaMind 2.0</span>
          </div>

          {/* Global Workspace Search (Stitch Spec) */}
          <div className="relative hidden md:block">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              onClick={() => setIsCommandPaletteOpen(true)}
              placeholder="Search across workspace..."
              className="pl-9 pr-4 py-1.5 bg-[#F2F4F6] border-b border-[#E2E8F0] focus:border-[#4F46E5] focus:outline-none text-xs w-64 font-mono rounded-none transition-colors text-[#191C1E] placeholder-slate-400 cursor-pointer"
            />
          </div>
        </div>

        {/* Top Right Action Tools */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('meetings')}
              title="Start Video Meeting"
              className="text-slate-500 hover:bg-[#ECEEF0] hover:text-[#191C1E] p-2 rounded-lg transition-colors"
            >
              <Video className="w-4 h-4" />
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              title="Notifications"
              className="text-slate-500 hover:bg-[#ECEEF0] hover:text-[#191C1E] p-2 rounded-lg transition-colors relative"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#F43F5E] rounded-full"></span>
            </button>
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              title="Help & Shortcuts"
              className="text-slate-500 hover:bg-[#ECEEF0] hover:text-[#191C1E] p-2 rounded-lg transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              if (currentWorkspace?.join_code) {
                navigator.clipboard.writeText(currentWorkspace.join_code);
                alert(`Join Code copied: ${currentWorkspace.join_code}`);
              } else {
                setShowJoinWsModal(true);
              }
            }}
            className="text-xs font-mono font-medium bg-transparent border border-[#E2E8F0] text-[#191C1E] px-4 py-1.5 rounded hover:bg-[#F2F4F6] transition-colors"
          >
            Join Code
          </button>

          <button
            onClick={() => setShowCreateWsModal(true)}
            className="text-xs font-semibold bg-[#4F46E5] text-white px-4 py-1.5 rounded hover:opacity-90 transition-opacity shadow-sm"
          >
            Invite Team
          </button>

          {/* User Profile Avatar */}
          <div
            onClick={() => setActiveTab('settings')}
            className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden border border-[#E2E8F0] ml-1 flex items-center justify-center font-bold text-xs text-[#4F46E5] cursor-pointer hover:ring-2 hover:ring-[#4F46E5]/30 transition"
          >
            {user?.name ? user.name.slice(0, 2).toUpperCase() : 'EX'}
          </div>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <div className="flex flex-1 pt-16 overflow-hidden h-full w-full">
        {/* SideNavBar */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          workspaces={workspaces}
          currentWorkspace={currentWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          onOpenCreateWs={() => setShowCreateWsModal(true)}
          onOpenJoinWs={() => setShowJoinWsModal(true)}
          onLogout={handleLogout}
          user={user}
        />

        {/* Canvas Area */}
        <main className="flex-1 flex overflow-hidden bg-[#F8FAFC] relative">
          <div className="flex-1 p-6 md:p-8 overflow-y-auto h-full">
            {activeTab === 'dashboard' && (
              <Dashboard
                workspaceId={currentWorkspace?.id}
                user={user}
                tasks={tasks}
                channels={channels}
                sessions={sessions}
                financeSummary={financeSummary}
                documents={documents}
                onNavigateTab={setActiveTab}
                onRefreshAll={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'solo_chat' && (
              <SoloChat
                workspaceId={currentWorkspace?.id}
                user={user}
                onNavigateTab={setActiveTab}
                onRefreshAll={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'calendar' && (
              <CalendarView
                workspaceId={currentWorkspace?.id}
                user={user}
                sessions={sessions}
                onRefreshSessions={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'ai_agent' && (
              <div className="h-full max-w-5xl mx-auto">
                <AiAssistant
                  workspaceId={currentWorkspace?.id}
                  onNavigateTab={setActiveTab}
                  onRefreshAll={() => loadWorkspaceData(currentWorkspace?.id)}
                  onSwitchWorkspace={(wsId) => {
                    const target = workspaces.find((w) => w.id === wsId);
                    if (target) handleSelectWorkspace(target.id);
                  }}
                />
              </div>
            )}

            {activeTab === 'meetings' && (
              <Meetings
                workspaceId={currentWorkspace?.id}
                workspace={currentWorkspace}
                workspaces={workspaces}
                onSelectWorkspace={handleSelectWorkspace}
                user={user}
                sessions={sessions}
                onRefreshSessions={() => loadWorkspaceData(currentWorkspace?.id)}
                onRefreshDocuments={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'documents' && (
              <Documents
                workspaceId={currentWorkspace?.id}
                documents={documents}
                onRefreshDocuments={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'projects' && (
              <KanbanBoard
                workspaceId={currentWorkspace?.id}
                tasks={tasks}
                onRefreshTasks={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'code' && (
              <CodeWorkspace
                workspaceId={currentWorkspace?.id}
                repos={repos}
                onRefreshRepos={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'channels' && (
              <Channels
                workspaceId={currentWorkspace?.id}
                workspace={currentWorkspace}
                user={user}
                channels={channels}
                onRefreshChannels={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'finance' && (
              <FinanceTracker
                workspaceId={currentWorkspace?.id}
                financeSummary={financeSummary}
                transactions={transactions}
                onRefreshFinance={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}

            {activeTab === 'settings' && (
              <WorkspaceSettings
                workspace={currentWorkspace}
                user={user}
                onRefreshWorkspace={() => loadInitialData()}
              />
            )}
          </div>
        </main>
      </div>

      {/* Floating AI Autonomous Reminder Toast */}
      <AiReminderToast
        workspaceId={currentWorkspace?.id}
        onEventCreated={() => loadWorkspaceData(currentWorkspace?.id)}
        onNavigateCalendar={() => setActiveTab('calendar')}
      />

      {/* Floating AI Copilot FAB (Stitch Spec) */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setActiveTab('ai_agent')}
          title="Open Copilot"
          className="bg-white hover:bg-slate-50 text-[#4F46E5] rounded-full p-3.5 shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-200 flex items-center justify-center relative border border-[#E2E8F0]"
        >
          <Bot className="w-6 h-6 text-[#8B5CF6]" />
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[#8B5CF6] rounded-full border-2 border-white ai-pulse"></span>
        </button>
      </div>

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        documents={documents}
        tasks={tasks}
        sessions={sessions}
        channels={channels}
        repos={repos}
        reports={reports}
        onNavigate={(tab) => setActiveTab(tab)}
      />

      {/* Create Team Workspace Modal */}
      {showCreateWsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-[#191C1E]">Create Team Workspace</h3>
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. Core Engineering Team"
                className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWsModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
                >
                  Create Space
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Team Workspace Modal */}
      {showJoinWsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-[#191C1E]">Join Team Workspace</h3>
            <form onSubmit={handleJoinWorkspace} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                placeholder="ENTER 8-DIGIT JOIN CODE"
                className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] uppercase tracking-widest font-mono text-center focus:outline-none focus:border-[#4F46E5]"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowJoinWsModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
                >
                  Join Space
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
