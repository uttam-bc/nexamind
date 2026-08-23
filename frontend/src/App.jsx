import React, { useState, useEffect } from 'react';
import { Bot, AlertCircle, Search } from 'lucide-react';
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

      // Default directly to Solo / Personal workspace upon login
      const personalWs = wsList.find((w) => w.type === 'personal') || wsList[0];
      if (personalWs) {
        setCurrentWorkspace(personalWs);
        setSavedWorkspaceId(personalWs.id);
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
      } else if (activeTab === 'meetings') {
        const sList = await api.listSessions(wsId);
        setSessions(sList);
      } else if (activeTab === 'documents') {
        const dList = await api.listDocuments(wsId);
        setDocuments(dList);
      } else if (activeTab === 'projects') {
        const tList = await api.listTasks(wsId);
        setTasks(tList);
      } else if (activeTab === 'code') {
        const rList = await api.listRepos(wsId);
        setRepos(rList);
      } else if (activeTab === 'channels') {
        const cList = await api.listChannels(wsId);
        setChannels(cList);
      } else if (activeTab === 'calendar') {
        const [cEvents, sList] = await Promise.all([
          api.listCalendarEvents(wsId).catch(() => []),
          api.listSessions(wsId).catch(() => []),
        ]);
        setCalendarEvents(cEvents);
        setSessions(sList);
      } else if (activeTab === 'settings') {
        const wsDetail = await api.getWorkspace(wsId);
        setCurrentWorkspace(wsDetail);
      }
    } catch (err) {
      console.error('Error fetching workspace data', err);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      let res;
      if (authMode === 'login') {
        res = await api.login(authForm.email, authForm.password);
      } else {
        res = await api.register(authForm.name, authForm.email, authForm.password);
      }
      setAuthToken(res.access_token);
      setToken(res.access_token);
    } catch (err) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken('');
    setToken('');
    setSavedWorkspaceId('');
    setUser(null);
    setCurrentWorkspace(null);
    setActiveTab('dashboard');
  };

  const handleSelectWorkspace = (wsId) => {
    const ws = workspaces.find((w) => w.id === wsId);
    if (ws) {
      setCurrentWorkspace(ws);
      setSavedWorkspaceId(ws.id);
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
      alert(err.message);
    }
  };

  const handleJoinWorkspace = async (e) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    try {
      const joined = await api.joinWorkspace(joinCodeInput.trim());
      setWorkspaces((prev) => [...prev, joined]);
      setCurrentWorkspace(joined);
      setSavedWorkspaceId(joined.id);
      setShowJoinWsModal(false);
      setJoinCodeInput('');
    } catch (err) {
      alert(err.message);
    }
  };

  // ----------------------------------------------------
  // Render Auth Screen (Login / Register)
  // ----------------------------------------------------
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full glass-panel p-8 rounded-3xl shadow-2xl border border-slate-800 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center p-3.5 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl shadow-xl shadow-indigo-600/30 text-white">
              <Bot className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-black tracking-tight gradient-text">NexaMind</h1>
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Agentic AI Workspace for High-Velocity Teams
            </p>
          </div>

          {authError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Full Name
                </label>
                <input
                  color='black'
                  type="text"
                  required
                  placeholder="Jordan Vance"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-indigo-500 text-black placeholder-slate-600 font-medium"
                  value={authForm.name}
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Email Address
              </label>
              <input
              color='black'
                type="email"
                required
                placeholder="admin@nexamind.app"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-indigo-500 text-black placeholder-slate-600 font-medium"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Password
              </label>
              <input
              color='black'
                type="password"
                required
                placeholder="••••••••"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-indigo-500 text-black placeholder-slate-600 font-medium"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition shadow-lg shadow-indigo-600/30 text-xs uppercase tracking-wider"
            >
              {authLoading
                ? 'Authenticating...'
                : authMode === 'login'
                ? 'Sign In to Workspace'
                : 'Create My Workspace Account'}
            </button>
          </form>

          <div className="text-center text-xs text-slate-400">
            {authMode === 'login' ? (
              <span>
                New to NexaMind?{' '}
                <button
                  onClick={() => { setAuthMode('register'); setAuthError(''); }}
                  className="text-indigo-400 hover:underline font-bold"
                >
                  Create an account
                </button>
              </span>
            ) : (
              <span>
                Already registered?{' '}
                <button
                  onClick={() => { setAuthMode('login'); setAuthError(''); }}
                  className="text-indigo-400 hover:underline font-bold"
                >
                  Sign In
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // Render Main Application Shell
  // ----------------------------------------------------
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Navigation Sidebar */}
      <Sidebar
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        onOpenCreateWs={() => setShowCreateWsModal(true)}
        onOpenJoinWs={() => setShowJoinWsModal(true)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSelectTab={setActiveTab}
        user={user}
        onLogout={handleLogout}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Main Workspace Canvas */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
        {/* Top Workspace Header & Mode Status */}
        <header className="h-16 border-b border-slate-800/80 px-8 flex items-center justify-between bg-slate-900/40 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-base text-slate-100 capitalize">
              {activeTab === 'dashboard'
                ? currentWorkspace?.type === 'personal'
                  ? 'Personal Dashboard'
                  : 'Team Dashboard'
                : activeTab === 'solo_chat'
                ? 'Solo Chat & Notes (WhatsApp Style)'
                : activeTab === 'settings'
                ? 'Workspace Settings'
                : activeTab.replace('_', ' ')}
            </span>
            <span className="text-xs text-slate-500 font-mono">/ {currentWorkspace?.name}</span>

            {/* Mode Badge with 1-Click Toggle */}
            {currentWorkspace?.type === 'personal' ? (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                <span>👤 Solo (Private Space)</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">
                <span>👥 Group Mode (Shared with Team)</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Switch Button */}
            {currentWorkspace?.type === 'personal' ? (
              <button
                onClick={() => {
                  const teamWs = workspaces.find((w) => w.type === 'team');
                  if (teamWs) handleSelectWorkspace(teamWs.id);
                  else setShowJoinWsModal(true);
                }}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
              >
                <span>👥 Switch to Group</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  const personalWs = workspaces.find((w) => w.type === 'personal');
                  if (personalWs) handleSelectWorkspace(personalWs.id);
                }}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 transition active:scale-95"
              >
                <span>👤 Switch to Solo</span>
              </button>
            )}

            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="flex items-center gap-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 px-3.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 transition"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search (Ctrl+K)</span>
            </button>

            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Supabase & AI Active</span>
            </span>
          </div>
        </header>

        {/* Dynamic Workspace Module View */}
        <div className="flex-1 overflow-y-auto p-8">
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
              />
            </div>
          )}

          {activeTab === 'meetings' && (
            <Meetings
              workspaceId={currentWorkspace?.id}
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
              channels={channels}
              onRefreshChannels={() => loadWorkspaceData(currentWorkspace?.id)}
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

      {/* Floating AI Autonomous Reminder Popup */}
      <AiReminderToast
        workspaceId={currentWorkspace?.id}
        onEventCreated={() => loadWorkspaceData(currentWorkspace?.id)}
        onNavigateCalendar={() => setActiveTab('calendar')}
      />

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
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-slate-100">Create Team Workspace</h3>
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. Core Engineering Team"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWsModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
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
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-slate-100">Join Team Workspace</h3>
            <form onSubmit={handleJoinWorkspace} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                placeholder="ENTER 8-DIGIT JOIN CODE"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 uppercase tracking-widest font-mono text-center focus:outline-none focus:border-indigo-500"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowJoinWsModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
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
