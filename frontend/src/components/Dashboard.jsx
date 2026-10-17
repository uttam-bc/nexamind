import React from 'react';
import {
  TrendingUp,
  User,
  Users,
  FolderKanban,
  FileText,
  Video,
  Calendar,
  Sparkles,
  ArrowRight,
  Clock,
  Layers,
  MessageSquare,
  Plus,
  Hash,
  CheckCircle2,
  Circle,
  ExternalLink,
} from 'lucide-react';

export default function Dashboard({
  workspaceId,
  user,
  tasks = [],
  channels = [],
  sessions = [],
  financeSummary,
  documents = [],
  presenceList = [],
  onNavigateTab,
  onRefreshAll,
}) {
  const openTasks = (tasks || []).filter((t) => t.status !== 'done');
  const completedTasks = (tasks || []).filter((t) => t.status === 'done');
  const runwayMonths = financeSummary?.runway_months ?? 12;

  const presenceColors = {
    online: 'bg-emerald-500',
    away: 'bg-amber-400',
    busy: 'bg-rose-500',
    offline: 'bg-slate-400',
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10 font-sans text-[#191C1E]">
      {/* 1. TEAMS PRESENCE STRIP: ACTIVE COLLABORATORS */}
      <section className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-slate-800 tracking-wide uppercase font-mono">
            Active Collaborators ({presenceList.length > 0 ? presenceList.length : 1})
          </span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          {/* Current User */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-xs text-indigo-900 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>{user?.name || 'You'} (You)</span>
          </div>

          {/* Active Teammates */}
          {presenceList
            .filter((p) => p.user_id !== String(user?.id))
            .map((peer) => (
              <div
                key={peer.user_id}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full text-xs text-slate-700 font-medium hover:bg-slate-100 transition cursor-pointer"
                onClick={() => onNavigateTab('channels')}
                title={`Click to message ${peer.name}`}
              >
                <span className={`w-2 h-2 rounded-full ${presenceColors[peer.status] || presenceColors.online}`} />
                <span>{peer.name}</span>
              </div>
            ))}

          <button
            onClick={() => onNavigateTab('channels')}
            className="text-[11px] font-bold text-[#4F46E5] hover:underline px-2"
          >
            Open Channels &rarr;
          </button>
        </div>
      </section>

      {/* 2. HERO SECTION + FINANCIAL RUNWAY */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hero AI Morning Brief */}
        <div className="lg:col-span-2 bg-gradient-to-br from-white to-slate-50 border border-[#E2E8F0] rounded-xl p-6 shadow-sm relative overflow-hidden group">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-indigo-100 text-indigo-700">
                AI Morning Brief
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
            </div>
            <h2 className="text-2xl lg:text-3xl font-extrabold text-[#191C1E] mb-2 tracking-tight">
              Welcome back, {user?.name || 'Explorer'}.
            </h2>
            <p className="text-sm text-slate-600 mb-5 max-w-2xl leading-relaxed">
              You have <strong>{openTasks.length} open tasks</strong> across sprint boards,{' '}
              <strong>{documents.length} Notion-style knowledge documents</strong>, and{' '}
              <strong>{channels.length} real-time communication channels</strong> active in this workspace.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button
                onClick={() => onNavigateTab('documents')}
                className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-3.5 py-2 rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Knowledge Docs</span>
              </button>
              <button
                onClick={() => onNavigateTab('channels')}
                className="border border-[#E2E8F0] bg-white text-[#191C1E] px-3.5 py-2 rounded-lg text-xs font-semibold hover:bg-slate-100 transition flex items-center gap-1.5"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Team Chat</span>
              </button>
              <button
                onClick={() => onNavigateTab('ai_agent')}
                className="bg-purple-50 text-purple-700 border border-purple-200 px-3.5 py-2 rounded-lg text-xs font-semibold hover:bg-purple-100 transition flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>Ask Copilot</span>
              </button>
            </div>
          </div>
        </div>

        {/* Financial Runway & Health */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">
                Runway Health
              </h3>
              <div className="text-3xl font-bold text-[#10B981] mt-1 tracking-tight">
                {runwayMonths} Months
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          <div>
            <div className="w-full bg-[#ECEEF0] rounded-full h-2 mt-4 overflow-hidden">
              <div className="bg-[#10B981] h-2 rounded-full" style={{ width: '82%' }}></div>
            </div>
            <div className="flex justify-between text-xs font-mono text-slate-500 mt-2">
              <span>Operational Burn: Stable</span>
              <span>Target: 18 mo</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. CORE METRICS TILES (Notion Knowledge + Teams Channels + Sprint Tasks) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Notion Knowledge Pages */}
        <div
          onClick={() => onNavigateTab('documents')}
          className="bg-white border border-[#E2E8F0] hover:border-indigo-300 rounded-xl p-5 shadow-sm hover:shadow transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono font-bold text-slate-500 uppercase">Knowledge Base</span>
            <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center group-hover:scale-110 transition">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mb-1">{documents.length}</div>
          <p className="text-xs text-slate-500">Block-style documents & specs</p>
        </div>

        {/* Team Communication Channels */}
        <div
          onClick={() => onNavigateTab('channels')}
          className="bg-white border border-[#E2E8F0] hover:border-purple-300 rounded-xl p-5 shadow-sm hover:shadow transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono font-bold text-slate-500 uppercase">Team Channels</span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-[#8B5CF6] flex items-center justify-center group-hover:scale-110 transition">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mb-1">{channels.length}</div>
          <p className="text-xs text-slate-500">Threaded chats & discussions</p>
        </div>

        {/* Sprint Kanban Tasks */}
        <div
          onClick={() => onNavigateTab('projects')}
          className="bg-white border border-[#E2E8F0] hover:border-indigo-300 rounded-xl p-5 shadow-sm hover:shadow transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono font-bold text-slate-500 uppercase">Sprint Tasks</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-[#4F46E5] flex items-center justify-center group-hover:scale-110 transition">
              <FolderKanban className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mb-1">{openTasks.length}</div>
          <p className="text-xs text-slate-500">{completedTasks.length} completed this cycle</p>
        </div>
      </section>

      {/* 4. RECENT NOTION PAGES & ACTIVE TEAMS DISCUSSIONS */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Notion Knowledge Pages */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">📚</span>
              <h3 className="text-sm font-bold text-slate-900">Recent Notion Pages</h3>
            </div>
            <button
              onClick={() => onNavigateTab('documents')}
              className="text-xs font-bold text-[#4F46E5] hover:underline flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {documents.slice(0, 4).map((doc) => (
              <div
                key={doc.id}
                onClick={() => onNavigateTab('documents')}
                className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-base shrink-0">{doc.icon || '📄'}</span>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 truncate">{doc.title}</h4>
                    <p className="text-[11px] text-slate-400">
                      Updated {new Date(doc.updated_at || Date.now()).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </div>
            ))}

            {documents.length === 0 && (
              <div className="text-center py-6 text-xs text-slate-400 italic">
                No documents created yet. Click below to draft your first spec!
              </div>
            )}
          </div>
        </div>

        {/* Active Teams Channels & Discussions */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">💬</span>
              <h3 className="text-sm font-bold text-slate-900">Active Discussions</h3>
            </div>
            <button
              onClick={() => onNavigateTab('channels')}
              className="text-xs font-bold text-[#4F46E5] hover:underline flex items-center gap-1"
            >
              <span>Join Chat</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {channels.slice(0, 4).map((chan) => (
              <div
                key={chan.id}
                onClick={() => onNavigateTab('channels')}
                className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Hash className="w-4 h-4 text-slate-400" />
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{chan.name}</h4>
                    <p className="text-[11px] text-slate-500 truncate max-w-xs">
                      {chan.description || 'General team discussion & announcements'}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                  {chan.is_private ? 'Private' : 'Public'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
