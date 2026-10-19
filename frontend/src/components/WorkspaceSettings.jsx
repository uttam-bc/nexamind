import React, { useState, useEffect } from 'react';
import {
  Settings,
  Users,
  Key,
  Copy,
  Check,
  RefreshCw,
  Edit2,
  Save,
  Mail,
  Building,
  CheckCircle2,
  Brain,
  ShieldCheck,
  UserPlus,
  Sparkles,
  Database,
  ArrowRight,
  AlertCircle,
  Hash,
} from 'lucide-react';
import { api } from '../api';
import FeatureHeader from './FeatureHeader';

export default function WorkspaceSettings({
  workspace,
  user,
  onRefreshWorkspace,
  onBack,
}) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'members' | 'ai' | 'access'
  const [members, setMembers] = useState([]);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(workspace?.name || '');
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [savingName, setSavingName] = useState(false);

  // Invite by username / email
  const [inviteQuery, setInviteQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState('');

  // AI & Gemini Key configuration
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('nexamind_gemini_key') || '');
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState(null);
  const [memoryStats, setMemoryStats] = useState(null);
  const [isReindexing, setIsReindexing] = useState(false);

  useEffect(() => {
    if (workspace?.id) {
      setNewName(workspace.name);
      loadMembers();
      loadMemoryStats();
    }
  }, [workspace]);

  const loadMembers = async () => {
    try {
      const data = await api.getWorkspaceMembers(workspace.id);
      setMembers(data || []);
    } catch (err) {
      console.error('Error fetching members', err);
    }
  };

  const loadMemoryStats = async () => {
    try {
      const stats = await api.getMemoryStats(workspace.id);
      setMemoryStats(stats);
    } catch (err) {
      console.warn('Could not load memory stats:', err);
    }
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    if (!newName.trim() || savingName) return;
    setSavingName(true);
    try {
      await api.updateWorkspace(workspace.id, newName.trim());
      setIsEditingName(false);
      await onRefreshWorkspace();
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setSavingName(false);
    }
  };

  const handleRegenerateCode = async () => {
    if (
      !confirm(
        'The previous join code will immediately become invalid. Teams currently trying to join will need the new code. Continue?'
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      await api.regenerateJoinCode(workspace.id);
      await onRefreshWorkspace();
      alert('Join code regenerated successfully!');
    } catch (err) {
      alert(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  const copyJoinCode = () => {
    if (workspace?.join_code) {
      navigator.clipboard.writeText(workspace.join_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  // Search users by @username or email
  const handleSearchUsers = async (query) => {
    setInviteQuery(query);
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearchingUsers(true);
    try {
      const clean = query.startsWith('@') ? query.slice(1) : query;
      const res = await api.searchUsers(clean);
      setSearchResults(res || []);
    } catch (err) {
      console.warn('User search error:', err);
    } finally {
      setIsSearchingUsers(false);
    }
  };

  const handleCopyInviteDetails = (targetUser) => {
    const text = `Join my NexaMind workspace "${workspace.name}" with Join Code: ${workspace.join_code}`;
    navigator.clipboard.writeText(text);
    setInviteSuccessMsg(`Invite details copied for @${targetUser.username}! Share join code: ${workspace.join_code}`);
    setTimeout(() => setInviteSuccessMsg(''), 4000);
  };

  const handleTestGeminiKey = async () => {
    if (!geminiApiKey.trim()) {
      setKeyTestResult({ ok: false, message: 'Please enter a Gemini API Key first.' });
      return;
    }
    setIsTestingKey(true);
    setKeyTestResult(null);
    try {
      const res = await api.testGeminiKey(geminiApiKey.trim());
      if (res.valid) {
        setKeyTestResult({
          ok: true,
          message: `Connected successfully! Model: ${res.model || 'gemini-2.0-flash'}`,
        });
        localStorage.setItem('nexamind_gemini_key', geminiApiKey.trim());
      } else {
        setKeyTestResult({ ok: false, message: res.error || 'Invalid Gemini API key.' });
      }
    } catch (err) {
      setKeyTestResult({ ok: false, message: err.message });
    } finally {
      setIsTestingKey(false);
    }
  };

  const handleSaveGeminiKey = () => {
    localStorage.setItem('nexamind_gemini_key', geminiApiKey.trim());
    alert('Gemini API Key saved for this workspace!');
  };

  const handleReindexMemory = async () => {
    setIsReindexing(true);
    try {
      const res = await api.reindexMemory(workspace.id);
      alert(
        `Memory pipeline run complete!\nIngested: ${res.ingested_count} records\nExtracted: ${res.extracted_count} insights\nActive consolidated memories: ${res.consolidated_count}`
      );
      loadMemoryStats();
    } catch (err) {
      alert(`Memory re-indexing failed: ${err.message}`);
    } finally {
      setIsReindexing(false);
    }
  };

  const isOwnerOrAdmin =
    workspace?.owner_id === user?.id ||
    members.find((m) => m.user_id === user?.id)?.role === 'owner' ||
    members.find((m) => m.user_id === user?.id)?.role === 'admin';

  return (
    <div className="h-full flex flex-col select-none">
      {/* 0. Feature Header with Back Button (Item 1) */}
      <FeatureHeader
        title="Admin Control Center"
        icon={Settings}
        badge={workspace?.type === 'personal' ? 'Solo Workspace' : 'Team Workspace'}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-500 hidden sm:inline">
              ID: {workspace?.id?.slice(0, 8)}...
            </span>
          </div>
        }
      />

      {/* Main Admin Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 p-4 sm:p-6 overflow-hidden min-h-0 bg-slate-50/50">
        {/* Navigation Sidebar */}
        <div className="w-full lg:w-64 bg-white rounded-2xl border border-slate-200 p-3 flex lg:flex-col gap-1.5 shadow-xs flex-shrink-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition w-full text-left ${
              activeTab === 'overview'
                ? 'bg-indigo-50 text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Building className="w-4 h-4 text-indigo-600" />
            <span>Workspace Overview</span>
          </button>

          <button
            onClick={() => setActiveTab('members')}
            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition w-full text-left ${
              activeTab === 'members'
                ? 'bg-indigo-50 text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 text-emerald-600" />
            <span>Members & Handles</span>
            <span className="ml-auto bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded-full text-[10px]">
              {members.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition w-full text-left ${
              activeTab === 'ai'
                ? 'bg-indigo-50 text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Brain className="w-4 h-4 text-purple-600" />
            <span>AI & Gemini Engine</span>
          </button>

          {workspace?.type === 'team' && (
            <button
              onClick={() => setActiveTab('access')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition w-full text-left ${
                activeTab === 'access'
                  ? 'bg-indigo-50 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Key className="w-4 h-4 text-amber-600" />
              <span>Join Code & Access</span>
            </button>
          )}
        </div>

        {/* Content Panel */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs overflow-y-auto">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="max-w-3xl space-y-6">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">Workspace General Settings</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Manage basic details, organization branding, and creation metadata.
                </p>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
                    Workspace Name
                  </label>
                  {isEditingName ? (
                    <form onSubmit={handleSaveName} className="flex gap-2">
                      <input
                        type="text"
                        required
                        autoFocus
                        className="flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-600"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                      <button
                        type="submit"
                        disabled={savingName}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingName(false)}
                        className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 px-3 py-2 rounded-xl text-xs font-bold"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-base text-slate-900">{workspace?.name}</span>
                      {isOwnerOrAdmin && (
                        <button
                          onClick={() => setIsEditingName(true)}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-bold p-1.5 rounded-lg hover:bg-indigo-50"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit Name</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Space Type
                    </span>
                    <span className="font-bold text-slate-900 text-sm">
                      {workspace?.type === 'personal' ? 'Personal / Solo Hub' : 'Collaborative Team Workspace'}
                    </span>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Created Date
                    </span>
                    <span className="font-bold text-slate-900 text-sm">
                      {workspace?.created_at
                        ? new Date(workspace.created_at).toLocaleDateString(undefined, {
                            dateStyle: 'medium',
                          })
                        : 'Active'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MEMBERS & USERNAMES (Item 12) */}
          {activeTab === 'members' && (
            <div className="max-w-3xl space-y-6">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">Workspace Members & Usernames</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Every user has a unique handle. Search and invite teammates by @username to collaborate.
                </p>
              </div>

              {/* Search & Invite Box */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-indigo-600" />
                  <span>Find User by @Username</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Type @username to search..."
                    value={inviteQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {isSearchingUsers && (
                    <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 font-mono animate-pulse">
                      searching...
                    </span>
                  )}
                </div>

                {/* Search Results Dropdown */}
                {searchResults.length > 0 && (
                  <div className="p-2 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1">
                    {searchResults.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{u.name}</span>
                          <span className="text-indigo-600 font-mono">@{u.username}</span>
                        </div>
                        <button
                          onClick={() => handleCopyInviteDetails(u)}
                          className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold text-[11px] transition"
                        >
                          Copy Join Invite
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {inviteSuccessMsg && (
                  <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{inviteSuccessMsg}</span>
                  </div>
                )}
              </div>

              {/* Members Roster */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Active Members ({members.length})
                  </span>
                  <button onClick={loadMembers} className="text-xs text-indigo-600 hover:underline font-bold">
                    Refresh List
                  </button>
                </div>

                {members.map((member) => {
                  const isCurrent = member.user_id === user?.id;
                  return (
                    <div
                      key={member.id}
                      className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs hover:border-slate-300 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-sm shadow-xs">
                          {member.name?.slice(0, 2).toUpperCase() || 'U'}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <span>{member.name}</span>
                            {member.username && (
                              <span className="text-indigo-600 font-mono text-[11px]">
                                @{member.username}
                              </span>
                            )}
                            {isCurrent && (
                              <span className="bg-indigo-100 text-indigo-700 text-[9px] px-1.5 py-0.2 rounded-full font-bold">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">{member.email}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-400 hidden sm:inline">
                          Joined {new Date(member.created_at).toLocaleDateString()}
                        </span>
                        <span
                          className={`px-2.5 py-1 rounded-full font-bold uppercase text-[10px] ${
                            member.role === 'owner'
                              ? 'bg-amber-100 text-amber-800'
                              : member.role === 'admin'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {member.role}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: AI & GEMINI CONFIGURATION (Items 2, 4, 6) */}
          {activeTab === 'ai' && (
            <div className="max-w-3xl space-y-6">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">Agentic AI & Google Gemini Integration</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Configure your Google AI Studio API key and orchestrate the 4-stage workspace memory engine.
                </p>
              </div>

              {/* Gemini Key Config Card */}
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-indigo-600" />
                    <span className="font-bold text-sm text-slate-900">Google Gemini API Key</span>
                  </div>
                  <span className="text-xs text-slate-500 font-mono">Multi-model Fallback Active</span>
                </div>

                <div className="space-y-2">
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-mono"
                  />
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Used for autonomous multi-turn reasoning, tool execution, and episodic memory extraction. Supports Gemini 2.0 Flash and 1.5 Flash.
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    onClick={handleTestGeminiKey}
                    disabled={isTestingKey}
                    className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingKey ? 'animate-spin' : ''}`} />
                    <span>{isTestingKey ? 'Verifying...' : 'Test Connection'}</span>
                  </button>
                  <button
                    onClick={handleSaveGeminiKey}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
                  >
                    Save API Key
                  </button>
                </div>

                {keyTestResult && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      keyTestResult.ok
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {keyTestResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{keyTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* 4-Stage Memory Pipeline Card (Item 6) */}
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-600" />
                    <span className="font-bold text-sm text-slate-900">4-Stage Memory Architecture</span>
                  </div>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">
                    {memoryStats?.total_memories || 0} Consolidated Insights
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <div className="font-bold text-indigo-600">1. Ingestion</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Docs, Chats, Tasks, Meetings</div>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <div className="font-bold text-purple-600">2. Extraction</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Key Facts & Decisions</div>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <div className="font-bold text-emerald-600">3. Consolidation</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Importance & Dedup</div>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <div className="font-bold text-blue-600">4. Storage</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Episodic AI Retrieval</div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleReindexMemory}
                    disabled={isReindexing}
                    className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? 'animate-spin' : ''}`} />
                    <span>{isReindexing ? 'Running 4-Stage Pipeline...' : 'Re-Index Workspace Memory Now'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ACCESS & JOIN CODE (Item 8) */}
          {activeTab === 'access' && workspace?.type === 'team' && (
            <div className="max-w-3xl space-y-6">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">Team Join Code & Access</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Share this 8-character join code with new teammates so they can join your workspace immediately.
                </p>
              </div>

              {/* Join Code Card */}
              <div className="p-6 bg-gradient-to-br from-indigo-50/70 to-purple-50/70 rounded-3xl border border-indigo-200/80 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                    Shareable Team Join Code
                  </span>
                  {isOwnerOrAdmin && (
                    <button
                      onClick={handleRegenerateCode}
                      disabled={regenerating}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                      <span>Regenerate Code</span>
                    </button>
                  )}
                </div>

                <div className="p-5 bg-white rounded-2xl border border-indigo-100 flex items-center justify-between shadow-xs">
                  <span className="font-mono text-2xl sm:text-3xl font-black text-indigo-600 tracking-widest">
                    {workspace?.join_code || 'NONE'}
                  </span>
                  <button
                    onClick={copyJoinCode}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-xs active:scale-95"
                  >
                    {copiedCode ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  Teammates can log into NexaMind, enter this code under <strong>Join Workspace</strong>, and gain instant access to your shared documents, kanban boards, and chat channels.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
