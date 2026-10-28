import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { isKnownTab } from './lib/navigation';
import { Bot, Search } from 'lucide-react';
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
import CommandPalette from './components/CommandPalette';
const AiAssistant = lazy(() => import('./components/AiAssistant'));
const SoloChat = lazy(() => import('./components/SoloChat'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const CallManager = lazy(() => import('./components/calls/CallManager'));
import NotificationBell from './components/NotificationBell';
import { openDeepLink } from './lib/deepLink';
const FinanceTracker = lazy(() => import('./components/FinanceTracker'));
import LandingPage from './pages/LandingPage';
import CreateGroupModal from './components/CreateGroupModal';
import BootScreen from './components/BootScreen';
import Logo from './components/ui/Logo';
import { getStoredAvatar } from './lib/avatarStorage';
import WorkspaceSwitch from './components/WorkspaceSwitch';
import { useDialogManager } from './lib/dialogManager';
import { roomTransition, originOf } from './lib/viewTransition';

// Placeholder for a feature screen that is still downloading.
function ScreenSkeleton() {
  return (
    <div className="max-w-7xl mx-auto space-y-4" role="status" aria-label="Loading">
      <div className="skeleton h-8 w-56" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
      </div>
      <div className="skeleton h-64" />
    </div>
  );
}

export default function App() {
  useDialogManager();

  // Auth state
  const [token, setToken] = useState(getAuthToken());
  const [user, setUser] = useState(null);
  const [bootError, setBootError] = useState(null);

  // Workspaces state
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [showCreateWsModal, setShowCreateWsModal] = useState(false);
  const [showJoinWsModal, setShowJoinWsModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');

  // Command Palette State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Active module navigation
  // The active tab lives in the URL hash (#/documents), so refresh, links and Back work.
  const readTabFromHash = () => {
    // Only the first segment is the tab: #/code/<repo>/pulls/3 is the Code tab with a deeper view.
    const tab = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
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
  const [unreadCounts, setUnreadCounts] = useState({});
  const [userPresence, setUserPresence] = useState('online');
  const [switching, setSwitching] = useState(false); // a workspace switch whose data is still loading

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
    setBootError(null);
    try {
      // In parallel: on a distant server each round trip costs a few hundred milliseconds.
      const [userData, wsList] = await Promise.all([api.getMe(), api.listWorkspaces()]);
      const storedAvatar = getStoredAvatar(userData?.id);
      if (storedAvatar && userData) userData.avatar_url = storedAvatar;
      setUser(userData);
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
      // Only a rejected token signs out. A sleeping or unreachable server keeps the session and
      // offers a retry (401s already sign out through the nexamind:unauthorized event).
      if (err.status === 401) clearSession();
      else if (!user) {
        // No status (network error) or a gateway/5xx answer usually means the server is asleep or restarting.
        setBootError(
          !err.status || err.status >= 500
            ? 'The server is not answering. It may still be starting up, so try again in a moment.'
            : err.message
        );
      }
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
      }
    } catch (err) {
      console.error('Error loading module data', err);
    } finally {
      setSwitching(false);
    }
  };

  // Switching workspace changes the "room" (accent and panel tint on <html>): when it comes from a
  // control, the new room is revealed from that control (lib/viewTransition).
  const handleSelectWorkspace = (wsId, origin) => {
    const targetWs = workspaces.find((w) => w.id === wsId);
    if (!targetWs || targetWs.id === currentWorkspace?.id) return;
    const apply = () => {
      document.documentElement.dataset.workspace = targetWs.type === 'personal' ? 'solo' : 'group';
      // Clear the previous workspace's lists so the revealed room never shows another room's data;
      // screens show their loading state until the new workspace's data arrives.
      setTasks([]);
      setDocuments([]);
      setChannels([]);
      setSessions([]);
      setFinanceSummary(null);
      setUnreadCounts({});
      setSwitching(true);
      setCurrentWorkspace(targetWs);
    };
    setSavedWorkspaceId(targetWs.id);
    if (origin) roomTransition(origin, apply);
    else apply();
  };

  const isSoloWorkspace = currentWorkspace?.type === 'personal';

  useEffect(() => {
    document.documentElement.dataset.workspace = currentWorkspace && !isSoloWorkspace ? 'group' : 'solo';
  }, [currentWorkspace, isSoloWorkspace]);

  const handleToggleMode = (targetMode, event) => {
    const origin = event ? originOf(event) : null;
    if (targetMode === 'personal') {
      const personal = workspaces.find((w) => w.type === 'personal');
      if (personal) handleSelectWorkspace(personal.id, origin);
    } else {
      const team = workspaces.find(
        (w) => w.type === 'team' || w.type === 'group'
      );
      if (team) handleSelectWorkspace(team.id, origin);
      else setShowJoinWsModal(true);
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

  const clearSession = () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setWorkspaces([]);
    setCurrentWorkspace(null);
  };

  // Signing out is instant: the screen clears now and the server revokes the token in the
  // background (an expired or offline token is fine either way).
  const handleLogout = () => {
    const current = getAuthToken();
    clearSession();
    if (current) api.revokeToken(current);
  };

  // Any API call that comes back 401 (expired or revoked token) signs the user out.
  useEffect(() => {
    window.addEventListener('nexamind:unauthorized', clearSession);
    return () => window.removeEventListener('nexamind:unauthorized', clearSession);
  }, []);

  // Links opened from inside a feature (e.g. a page shared in chat) come through handleOpenLink.
  // The hook sits above the early returns so React sees the same hooks on every render.
  const openLinkRef = useRef(null);
  useEffect(() => {
    const onOpen = (e) => e.detail && openLinkRef.current?.(e.detail);
    window.addEventListener('nexamind:open-link', onOpen);
    return () => window.removeEventListener('nexamind:open-link', onOpen);
  }, []);

  // If not logged in, render the pre-login Landing Page (Item 5)
  if (!token) {
    return (
      <LandingPage
        onLoginSuccess={(newToken, userData) => {
          setToken(newToken);
          const storedAvatar = getStoredAvatar(userData?.id);
          if (storedAvatar && userData) userData.avatar_url = storedAvatar;
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

  // A notification's link: switch to its workspace, open its tab, then let the feature open the item.
  const handleOpenLink = (link) => {
    if (link.workspace_id && link.workspace_id !== currentWorkspace?.id) {
      if (!workspaces.some((w) => w.id === link.workspace_id)) {
        notify('That item is in a workspace you no longer belong to.', 'error');
        return;
      }
      handleSelectWorkspace(link.workspace_id);
    }
    if (link.tab && isKnownTab(link.tab)) setActiveTab(link.tab);
    if (link.tab === 'documents' && link.document_id) setOpenDocId(link.document_id);
    openDeepLink(link);
  };
  openLinkRef.current = handleOpenLink;

  // Until the account and workspaces arrive (the server may be waking up), show the boot screen.
  if (!user) {
    return <BootScreen error={bootError} onRetry={loadInitialData} onSignOut={handleLogout} />;
  }

  return (
    <div className="h-screen w-full flex bg-white text-slate-900 font-sans antialiased overflow-hidden">
      {/* Incoming calls ring on every screen; the call itself opens full screen. */}
      <Suspense fallback={null}>
        <CallManager user={user} currentWorkspaceId={currentWorkspace?.id} />
      </Suspense>

      {/* Phones: a slim top bar (the sidebar is replaced by the bottom navigation). */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between gap-2 pl-3 pr-1.5 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <button type="button" onClick={handleBackToDashboard} aria-label="Go to dashboard" className="rounded-lg">
          <Logo alt="" className="h-6 max-w-[6.5rem]" />
        </button>
        <WorkspaceSwitch compact isSolo={isSoloWorkspace} onChange={handleToggleMode} />
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setIsCommandPaletteOpen(true)}
            aria-label="Search"
            className="p-2.5 rounded-pill text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors duration-fast"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
          </button>
          <NotificationBell onNavigate={handleOpenLink} workspaces={workspaces} />
        </div>
      </header>

      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        onToggleMode={handleToggleMode}
        onOpenCreateWs={() => setShowCreateWsModal(true)}
        onOpenJoinWs={() => setShowJoinWsModal(true)}
        onOpenSearch={() => setIsCommandPaletteOpen(true)}
        onLogout={handleLogout}
        user={user}
        unreadCounts={unreadCounts}
        userPresence={userPresence}
        onChangePresence={setUserPresence}
        notifications={<NotificationBell onNavigate={handleOpenLink} workspaces={workspaces} placement="sidebar" />}
      />

      <div className="flex-1 min-w-0 flex pt-14 md:pt-0 overflow-hidden">
        <main className="flex-1 min-w-0 flex overflow-hidden relative">
          <div className="flex-1 min-w-0 p-4 pb-24 sm:p-6 sm:pb-24 md:p-8 md:pb-10 overflow-y-auto h-full">
            <div key={activeTab} className="h-full animate-tab-in">
            <Suspense fallback={<ScreenSkeleton />}>
            {activeTab === 'dashboard' && (
              <Dashboard
                loading={switching}
                workspace={currentWorkspace}
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
                workspace={currentWorkspace}
                workspaceId={currentWorkspace?.id}
                user={user}
                sessions={sessions}
                onRefreshSessions={() => loadWorkspaceData(currentWorkspace?.id)}
                onBack={handleBackToDashboard}
                onOpenMeeting={(meetingId) => {
                  setActiveTab('meetings');
                  openDeepLink({ tab: 'meetings', meeting_id: meetingId });
                }}
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
                <div role="tablist" aria-label="Docs" className="flex items-center gap-1 mb-4 p-1 bg-slate-100 rounded-pill w-fit">
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
                      className={`px-4 py-1.5 rounded-pill text-sm font-semibold transition-colors duration-base ${
                        activeTab === id ? 'bg-white text-slate-900 shadow-card' : 'text-slate-600 hover:text-slate-900'
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
                workspaceName={currentWorkspace?.name}
                personal={isSoloWorkspace}
                user={user}
                onRefreshRepos={() => loadWorkspaceData(currentWorkspace?.id)}
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
            </Suspense>
            </div>
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

      {/* Floating Copilot button on phones (the sidebar has Copilot on larger screens). */}
      <div className={`md:hidden fixed bottom-20 right-4 z-40 ${activeTab === 'ai_agent' ? 'hidden' : ''}`}>
        <button
          type="button"
          onClick={() => setActiveTab('ai_agent')}
          title="Open Copilot"
          aria-label="Open AI Copilot"
          className="bg-white text-indigo-600 rounded-full p-3.5 shadow-panel transition-transform duration-base ease-out flex items-center justify-center relative border border-slate-200 press"
        >
          <Bot className="w-6 h-6 text-violet-500" aria-hidden="true" />
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
        onNavigate={(tab) => setActiveTab(tab)}
      />

      {/* Create Group Workspace Modal with Instant Join Code Display (Item 8) */}
      <CreateGroupModal
        isOpen={showCreateWsModal}
        onClose={() => setShowCreateWsModal(false)}
        onGroupCreated={(createdGroup) => {
          setWorkspaces((prev) => [...prev, createdGroup]);
          setCurrentWorkspace(createdGroup);
          setSavedWorkspaceId(createdGroup.id);
        }}
      />

      {/* Join Team Workspace Modal */}
      {showJoinWsModal && (
        <div className="fixed inset-0 bg-slate-950/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div data-modal className="bg-white p-6 rounded-2xl border border-slate-200 max-w-sm w-full space-y-4 shadow-panel animate-scale-in">
            <h3 className="text-base font-bold text-slate-900">Join Team Workspace</h3>
            <form onSubmit={handleJoinWorkspace} className="space-y-4">
              <input aria-label="Enter 8-digit join code"
                type="text"
                required
                autoFocus
                placeholder="ENTER 8-DIGIT JOIN CODE"
                className="w-full bg-white border border-line-strong rounded-xl px-4 py-2.5 text-xs text-slate-900 uppercase tracking-widest font-mono text-center focus:outline-none focus:border-indigo-600"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowJoinWsModal(false)}
                  className="px-3.5 py-1.5 rounded-pill text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-pill text-xs font-bold shadow-sm press"
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
