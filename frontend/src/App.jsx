import React, { Suspense, lazy, useState, useEffect } from 'react';
import { isKnownTab } from './lib/navigation';
import {
  Bot,
  Search,
  Video,
  CalendarClock,
  LogOut,
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
import MobileNav from './components/MobileNav';
import Dashboard from './components/Dashboard';
import { notify } from './context/ToastContext';
// Feature screens load on first use to keep the initial bundle small.
const Meetings = lazy(() => import('./components/Meetings'));
const Documents = lazy(() => import('./components/Documents'));
const KanbanBoard = lazy(() => import('./components/KanbanBoard'));
const CodeWorkspace = lazy(() => import('./components/CodeWorkspace'));
const Channels = lazy(() => import('./components/Channels'));
const WorkspaceSettings = lazy(() => import('./components/WorkspaceSettings'));
const FileManager = lazy(() => import('./components/FileManager'));
const ReportSynthesizer = lazy(() => import('./components/ReportSynthesizer'));
import CommandPalette from './components/CommandPalette';
const AiAssistant = lazy(() => import('./components/AiAssistant'));
const SoloChat = lazy(() => import('./components/SoloChat'));
const CalendarView = lazy(() => import('./components/CalendarView'));
import AiReminderToast from './components/AiReminderToast';
const FinanceTracker = lazy(() => import('./components/FinanceTracker'));
import LandingPage from './pages/LandingPage';
import CreateGroupModal from './components/CreateGroupModal';
import { useDialogManager } from './lib/dialogManager';

export default function App() {
  useDialogManager();

  // Auth state
  const [token, setToken] = useState(getAuthToken());
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authForm, setAuthForm] = useState({
    name: '',
    email: '',
    password: '',
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
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Active module navigation
  // The active tab lives in the URL hash (#/documents), so refresh, links and Back work.
  const readTabFromHash = () => {
    const tab = window.location.hash.replace(/^#\/?/, '');
    return isKnownTab(tab) ? tab : 'dashboard';
  };
  const [activeTab, setActiveTabState] = useState(readTabFromHash);
  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    if (readTabFromHash() !== tab) window.location.hash = `/${tab}`;
  };

  useEffect(() => {
    const onHashChange = () => setActiveTabState(readTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Module data
  const [tasks, setTasks] = useState([]);
  const [channels, setChannels] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [filesList, setFilesList] = useState([]);
  const [openDocId, setOpenDocId] = useState(null); // page to show when switching from Files to Pages
  const [repos, setRepos] = useState([]);
  const [reports, setReports] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [userPresence, setUserPresence] = useState('online');

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
      clearSession();
    }
  };

  const loadWorkspaceData = async (wsId) => {
    try {
      // Always keep unread counts updated
      api
        .getChannelUnreads(wsId)
        .then((list) =>
          setUnreadCounts(Object.fromEntries((list || []).map((u) => [u.channel_id, u.unread_count])))
        )
        .catch(() => {});

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
      } else if (activeTab === 'files') {
        // Files shows every page as well as uploads, so both lists are needed.
        const [fList, dList] = await Promise.all([
          api.listFiles(wsId).catch(() => []),
          api.listDocuments(wsId).catch(() => []),
        ]);
        setFilesList(fList);
        setDocuments(dList);
      } else if (activeTab === 'reports') {
        const [rList, sList, dList] = await Promise.all([
          api.listReports(wsId).catch(() => []),
          api.listSessions(wsId).catch(() => []),
          api.listDocuments(wsId).catch(() => []),
        ]);
        setReports(rList);
        setSessions(sList);
        setDocuments(dList);
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
      notify(err.message || 'Could not create workspace', 'error');
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
      notify(err.message || 'Invalid or expired join code', 'error');
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

  const clearSession = () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setWorkspaces([]);
    setCurrentWorkspace(null);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Already expired or offline: the local session is cleared either way.
    }
    clearSession();
  };

  // Any API call that comes back 401 (expired or revoked token) signs the user out.
  useEffect(() => {
    window.addEventListener('nexamind:unauthorized', clearSession);
    return () => window.removeEventListener('nexamind:unauthorized', clearSession);
  }, []);

  // If not logged in, render the pre-login Landing Page (Item 5)
  if (!token) {
    return (
      <LandingPage
        onLoginSuccess={(newToken, userData) => {
          setToken(newToken);
          setUser(userData);
          setAuthToken(newToken);
        }}
        onLogin={async (email, password) => {
          return await api.login(email, password);
        }}
        onRegister={async (name, email, password, username, otp) => {
          return await api.register(name, email, password, username, otp);
        }}
      />
    );
  }

  const handleBackToDashboard = () => setActiveTab('dashboard');

  return (
    <div className="h-screen w-full flex flex-col bg-[#F8FAFC] text-[#191C1E] font-sans antialiased overflow-hidden">
      {/* TopNavBar (Exact Stitch Specification) */}
      <header className="fixed top-0 left-0 w-full z-40 flex justify-between items-center px-3 sm:px-6 h-16 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] shadow-sm">
        <div className="flex items-center gap-6">
          {/* Brand Logo & Title */}
          <button
            type="button"
            onClick={handleBackToDashboard}
            className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity"
            title="NexaMind Dashboard"
            aria-label="Go to dashboard"
          >
            <img src="/logo.png" alt="" className="h-7 w-auto object-contain" />
          </button>

          {/* Global Workspace Search (Stitch Spec) */}
          <div className="relative hidden md:block">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input aria-label="Search across workspace"
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
              aria-label="Start video meeting"
              className="text-slate-500 hover:bg-[#ECEEF0] hover:text-[#191C1E] p-2 rounded-lg transition-colors"
            >
              <Video className="w-4 h-4" />
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              title="Calendar & reminders"
              aria-label="Open calendar and reminders"
              className="text-slate-500 hover:bg-[#ECEEF0] hover:text-[#191C1E] p-2 rounded-lg transition-colors"
            >
              <CalendarClock className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              title="Help & Shortcuts"
              aria-label="Search and keyboard shortcuts"
              className="text-slate-500 hover:bg-[#ECEEF0] hover:text-[#191C1E] p-2 rounded-lg transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              if (currentWorkspace?.join_code) {
                navigator.clipboard.writeText(currentWorkspace.join_code);
                notify(`Join Code copied: ${currentWorkspace.join_code}`, 'success');
              } else {
                setShowJoinWsModal(true);
              }
            }}
            className="hidden sm:inline-flex text-xs font-mono font-medium bg-transparent border border-[#E2E8F0] text-[#191C1E] px-4 py-1.5 rounded hover:bg-[#F2F4F6] transition-colors"
          >
            Join Code
          </button>

          <button
            onClick={() => setShowCreateWsModal(true)}
            className="hidden sm:inline-flex text-xs font-semibold bg-[#4F46E5] text-white px-4 py-1.5 rounded hover:opacity-90 transition-opacity shadow-sm"
          >
            Invite Team
          </button>

          {/* Account menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAccountMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showAccountMenu}
              aria-label={`Account menu for ${user?.name || 'your account'}`}
              className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden border border-[#E2E8F0] ml-1 flex items-center justify-center font-bold text-xs text-[#4F46E5] cursor-pointer hover:ring-2 hover:ring-[#4F46E5]/30 transition"
            >
              {user?.name ? user.name.slice(0, 2).toUpperCase() : '··'}
            </button>
            {showAccountMenu && (
              <div
                role="menu"
                aria-label="Account"
                className="absolute right-0 top-10 w-56 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 z-50"
                onKeyDown={(e) => e.key === 'Escape' && setShowAccountMenu(false)}
              >
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-900 truncate">{user?.name}</p>
                  <p className="text-xs text-slate-600 truncate">{user?.email}</p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowAccountMenu(false);
                    setActiveTab('settings');
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-800 hover:bg-slate-100"
                >
                  Account & workspace settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowAccountMenu(false);
                    handleLogout();
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-rose-700 hover:bg-rose-50 flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
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
          documents={documents}
          channels={channels}
          unreadCounts={unreadCounts}
          userPresence={userPresence}
          onChangePresence={setUserPresence}
        />

        {/* Canvas Area */}
        <main className="flex-1 flex overflow-hidden bg-[#F8FAFC] relative">
          <div className="flex-1 p-4 pb-24 sm:p-6 sm:pb-24 md:p-8 overflow-y-auto h-full">
            <Suspense fallback={<div className="text-sm text-slate-500" role="status">Loading…</div>}>
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
                onBack={handleBackToDashboard}
              />
            )}

            {activeTab === 'calendar' && (
              <CalendarView
                workspaceId={currentWorkspace?.id}
                user={user}
                sessions={sessions}
                onRefreshSessions={() => loadWorkspaceData(currentWorkspace?.id)}
                onBack={handleBackToDashboard}
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
                  onBack={handleBackToDashboard}
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
                onBack={handleBackToDashboard}
              />
            )}

            {/* Docs is one section: written pages and uploaded files. */}
            {(activeTab === 'documents' || activeTab === 'files') && (
              <div className="h-full flex flex-col">
                <div role="tablist" aria-label="Docs" className="flex items-center gap-1 mb-4 p-1 bg-white border border-slate-200 rounded-xl w-fit">
                  {[
                    ['documents', 'Pages'],
                    ['files', 'Files'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === id}
                      onClick={() => setActiveTab(id)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                        activeTab === id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-h-0">
                  {activeTab === 'documents' ? (
                    <Documents
                      workspaceId={currentWorkspace?.id}
                      documents={documents}
                      onRefreshDocuments={() => loadWorkspaceData(currentWorkspace?.id)}
                      onBack={handleBackToDashboard}
                      openDocId={openDocId}
                      onOpenedDoc={() => setOpenDocId(null)}
                    />
                  ) : (
                    <FileManager
                      workspaceId={currentWorkspace?.id}
                      filesList={filesList}
                      documents={documents}
                      onRefreshFiles={() => loadWorkspaceData(currentWorkspace?.id)}
                      onOpenDocument={(doc) => {
                        setOpenDocId(doc.id);
                        setActiveTab('documents');
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {activeTab === 'projects' && (
              <KanbanBoard
                workspaceId={currentWorkspace?.id}
                tasks={tasks}
                onRefreshTasks={() => loadWorkspaceData(currentWorkspace?.id)}
                onBack={handleBackToDashboard}
              />
            )}

            {activeTab === 'code' && (
              <CodeWorkspace
                workspaceId={currentWorkspace?.id}
                repos={repos}
                onRefreshRepos={() => loadWorkspaceData(currentWorkspace?.id)}
                onBack={handleBackToDashboard}
              />
            )}

            {activeTab === 'channels' && (
              <Channels
                workspaceId={currentWorkspace?.id}
                workspace={currentWorkspace}
                user={user}
                channels={channels}
                unreadCounts={unreadCounts}
                onRefreshChannels={() => loadWorkspaceData(currentWorkspace?.id)}
                onMarkRead={(chanId) =>
                  setUnreadCounts((prev) => ({ ...prev, [chanId]: 0 }))
                }
                onBack={handleBackToDashboard}
              />
            )}

            {activeTab === 'finance' && (
              <FinanceTracker
                workspaceId={currentWorkspace?.id}
                financeSummary={financeSummary}
                transactions={transactions}
                onRefreshFinance={() => loadWorkspaceData(currentWorkspace?.id)}
                onBack={handleBackToDashboard}
              />
            )}

            {activeTab === 'settings' && (
              <WorkspaceSettings
                workspace={currentWorkspace}
                user={user}
                onRefreshWorkspace={() => loadInitialData()}
                onBack={handleBackToDashboard}
                onUserUpdated={setUser}
                onTokenChanged={(newToken) => {
                  setAuthToken(newToken);
                  setToken(newToken);
                }}
                onAccountDeleted={clearSession}
                onLeftWorkspace={() => {
                  setSavedWorkspaceId(null);
                  setActiveTab('dashboard');
                  loadInitialData();
                }}
              />
            )}


            {activeTab === 'reports' && (
              <ReportSynthesizer
                workspaceId={currentWorkspace?.id}
                reports={reports}
                sessions={sessions}
                documents={documents}
                onRefreshReports={() => loadWorkspaceData(currentWorkspace?.id)}
                onRefreshDocuments={() => loadWorkspaceData(currentWorkspace?.id)}
              />
            )}
            </Suspense>
          </div>
        </main>
      </div>

      <MobileNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentWorkspace={currentWorkspace}
        workspaces={workspaces}
        onSelectWorkspace={handleSelectWorkspace}
        onLogout={handleLogout}
      />

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

      {/* Create Group Workspace Modal with Instant Join Code Display (Item 8) */}
      <CreateGroupModal
        isOpen={showCreateWsModal}
        onClose={() => setShowCreateWsModal(false)}
        onGroupCreated={(createdGroup) => {
          setWorkspaces((prev) => [...prev, createdGroup]);
          handleSelectWorkspace(createdGroup.id);
        }}
      />

      {/* Join Team Workspace Modal */}
      {showJoinWsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div data-modal className="bg-white p-6 rounded-2xl border border-[#E2E8F0] max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-[#191C1E]">Join Team Workspace</h3>
            <form onSubmit={handleJoinWorkspace} className="space-y-4">
              <input aria-label="ENTER 8-DIGIT JOIN CODE"
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
