import React, { useState, useEffect } from 'react';
import { Search, Menu, X } from 'lucide-react';
import {
  api,
  getAuthToken,
  setAuthToken,
  setSavedWorkspaceId,
} from './api';
import { useToast } from './context/ToastContext';
import { getTabLabel } from './lib/navigation';
import AuthPage from './pages/AuthPage';
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
import FileManager from './components/FileManager';
import ReportSynthesizer from './components/ReportSynthesizer';
import { Modal } from './components/ui';

export default function App() {
  const { error: toastError, success: toastSuccess } = useToast();

  const [token, setToken] = useState(getAuthToken());
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [showCreateWsModal, setShowCreateWsModal] = useState(false);
  const [showJoinWsModal, setShowJoinWsModal] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

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

  const isSolo = currentWorkspace?.type === 'personal';

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

  useEffect(() => {
    if (token) loadInitialData();
  }, [token]);

  useEffect(() => {
    if (currentWorkspace) loadWorkspaceData(currentWorkspace.id);
  }, [currentWorkspace, activeTab]);

  const loadInitialData = async () => {
    try {
      const userData = await api.getMe();
      setUser(userData);
      const wsList = await api.listWorkspaces();
      setWorkspaces(wsList);
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
        setSessions(await api.listSessions(wsId));
      } else if (activeTab === 'documents') {
        setDocuments(await api.listDocuments(wsId));
      } else if (activeTab === 'projects') {
        setTasks(await api.listTasks(wsId));
      } else if (activeTab === 'code') {
        setRepos(await api.listRepos(wsId));
      } else if (activeTab === 'channels') {
        setChannels(await api.listChannels(wsId));
      } else if (activeTab === 'calendar') {
        const [cEvents, sList] = await Promise.all([
          api.listCalendarEvents(wsId).catch(() => []),
          api.listSessions(wsId).catch(() => []),
        ]);
        setCalendarEvents(cEvents);
        setSessions(sList);
      } else if (activeTab === 'finance') {
        const [fSum, tList] = await Promise.all([
          api.getFinanceSummary(wsId).catch(() => null),
          api.listTransactions(wsId).catch(() => []),
        ]);
        setFinanceSummary(fSum);
        setTransactions(tList);
      } else if (activeTab === 'files') {
        setFilesList(await api.listFiles(wsId).catch(() => []));
      } else if (activeTab === 'reports') {
        const [rList, sList, dList] = await Promise.all([
          api.listReports(wsId).catch(() => []),
          api.listSessions(wsId).catch(() => []),
          api.listDocuments(wsId).catch(() => []),
        ]);
        setReports(rList);
        setSessions(sList);
        setDocuments(dList);
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

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
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
      toastSuccess('Team workspace created');
    } catch (err) {
      toastError(err.message);
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
      toastSuccess(`Joined ${joined.name}`);
    } catch (err) {
      toastError(err.message);
    }
  };

  if (!token || !user) {
    return (
      <AuthPage
        authMode={authMode}
        setAuthMode={(mode) => { setAuthMode(mode); setAuthError(''); }}
        authForm={authForm}
        setAuthForm={setAuthForm}
        authError={authError}
        authLoading={authLoading}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  const refresh = () => loadWorkspaceData(currentWorkspace?.id);

  return (
    <div className="flex h-screen bg-surface text-slate-100 overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        onOpenCreateWs={() => setShowCreateWsModal(true)}
        onOpenJoinWs={() => setShowJoinWsModal(true)}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        user={user}
        onLogout={handleLogout}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 lg:h-16 border-b border-slate-800/80 px-4 lg:px-8 flex items-center justify-between bg-slate-900/50 backdrop-blur-md flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden btn-ghost p-2 -ml-1"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-bold text-sm lg:text-base text-slate-100 truncate">
                {getTabLabel(activeTab, currentWorkspace?.type)}
              </h1>
              <p className="text-xs text-slate-500 truncate hidden sm:block">
                {currentWorkspace?.name}
              </p>
            </div>
            <span
              className={`hidden sm:inline-flex text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                isSolo
                  ? 'bg-solo-muted text-solo border-emerald-500/25'
                  : 'bg-accent-muted text-indigo-300 border-indigo-500/25'
              }`}
            >
              {isSolo ? 'Solo' : 'Group'}
            </span>
          </div>

          <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 transition"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden md:inline text-[10px] font-mono px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-500">
                ⌘K
              </kbd>
            </button>
            <span className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Online
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          {activeTab === 'dashboard' && (
            <Dashboard
              workspaceId={currentWorkspace?.id}
              isSolo={isSolo}
              tasks={tasks}
              channels={channels}
              sessions={sessions}
              financeSummary={financeSummary}
              documents={documents}
              onNavigateTab={handleTabChange}
            />
          )}
          {activeTab === 'solo_chat' && (
            <SoloChat workspaceId={currentWorkspace?.id} user={user} onNavigateTab={handleTabChange} onRefreshAll={refresh} />
          )}
          {activeTab === 'calendar' && (
            <CalendarView workspaceId={currentWorkspace?.id} user={user} sessions={sessions} onRefreshSessions={refresh} />
          )}
          {activeTab === 'ai_agent' && (
            <div className="h-full max-w-5xl mx-auto">
              <AiAssistant
                workspaceId={currentWorkspace?.id}
                onNavigateTab={handleTabChange}
                onRefreshAll={refresh}
                onSwitchWorkspace={(wsId) => {
                  const target = workspaces.find((w) => w.id === wsId);
                  if (target) handleSelectWorkspace(target.id);
                }}
                variant="full"
              />
            </div>
          )}
          {activeTab === 'meetings' && (
            <Meetings workspaceId={currentWorkspace?.id} sessions={sessions} onRefreshSessions={refresh} onRefreshDocuments={refresh} />
          )}
          {activeTab === 'documents' && (
            <Documents workspaceId={currentWorkspace?.id} documents={documents} onRefreshDocuments={refresh} />
          )}
          {activeTab === 'projects' && (
            <KanbanBoard workspaceId={currentWorkspace?.id} tasks={tasks} onRefreshTasks={refresh} />
          )}
          {activeTab === 'code' && (
            <CodeWorkspace workspaceId={currentWorkspace?.id} repos={repos} onRefreshRepos={refresh} />
          )}
          {activeTab === 'channels' && (
            <Channels workspaceId={currentWorkspace?.id} channels={channels} onRefreshChannels={refresh} />
          )}
          {activeTab === 'finance' && (
            <FinanceTracker workspaceId={currentWorkspace?.id} financeSummary={financeSummary} transactions={transactions} onRefreshFinance={refresh} />
          )}
          {activeTab === 'files' && (
            <FileManager workspaceId={currentWorkspace?.id} filesList={filesList} onRefreshFiles={refresh} />
          )}
          {activeTab === 'reports' && (
            <ReportSynthesizer workspaceId={currentWorkspace?.id} reports={reports} sessions={sessions} documents={documents} onRefreshReports={refresh} onRefreshDocuments={refresh} />
          )}
          {activeTab === 'settings' && (
            <WorkspaceSettings workspace={currentWorkspace} user={user} onRefreshWorkspace={() => loadInitialData()} />
          )}
        </div>
      </main>

      <AiReminderToast workspaceId={currentWorkspace?.id} onEventCreated={refresh} onNavigateCalendar={() => handleTabChange('calendar')} />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        documents={documents}
        tasks={tasks}
        sessions={sessions}
        channels={channels}
        repos={repos}
        reports={reports}
        onNavigate={handleTabChange}
      />

      <Modal open={showCreateWsModal} onClose={() => setShowCreateWsModal(false)} title="Create Team Workspace" size="sm">
        <form onSubmit={handleCreateWorkspace} className="space-y-4">
          <input
            type="text"
            required
            autoFocus
            placeholder="e.g. Core Engineering Team"
            className="input-base"
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreateWsModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Create Space</button>
          </div>
        </form>
      </Modal>

      <Modal open={showJoinWsModal} onClose={() => setShowJoinWsModal(false)} title="Join Team Workspace" size="sm">
        <form onSubmit={handleJoinWorkspace} className="space-y-4">
          <input
            type="text"
            required
            autoFocus
            placeholder="Enter 8-digit join code"
            className="input-base uppercase tracking-widest font-mono text-center"
            value={joinCodeInput}
            onChange={(e) => setJoinCodeInput(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowJoinWsModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Join Space</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
