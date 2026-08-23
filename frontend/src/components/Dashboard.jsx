import React from 'react';
import {
  FolderKanban,
  FileText,
  MessageSquare,
  Video,
  DollarSign,
  Plus,
  Play,
  Sparkles,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

export default function Dashboard({
  workspaceId,
  isSolo,
  tasks,
  channels,
  sessions,
  financeSummary,
  documents,
  onNavigateTab,
}) {
  const openTasks = (tasks || []).filter((t) => t.status !== 'done').length;
  const accent = isSolo ? 'solo' : 'indigo';

  const metrics = [
    {
      label: 'Open Tasks',
      value: openTasks,
      sub: 'Active on board',
      icon: FolderKanban,
      color: 'text-indigo-400 hover:border-indigo-500/40',
      tab: 'projects',
    },
    {
      label: 'Meetings',
      value: sessions?.length || 0,
      sub: 'Sessions & MoM',
      icon: Video,
      color: 'text-purple-400 hover:border-purple-500/40',
      tab: 'meetings',
    },
    {
      label: 'Channels',
      value: channels?.length || 0,
      sub: 'Live messaging',
      icon: MessageSquare,
      color: 'text-emerald-400 hover:border-emerald-500/40',
      tab: 'channels',
    },
    {
      label: 'Documents',
      value: documents?.length || 0,
      sub: 'Specs & notes',
      icon: FileText,
      color: 'text-cyan-400 hover:border-cyan-500/40',
      tab: 'documents',
    },
  ];

  if (financeSummary) {
    metrics.push({
      label: 'Cash Balance',
      value: `$${(financeSummary.cash_balance || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      sub: 'View finance',
      icon: DollarSign,
      color: 'text-amber-400 hover:border-amber-500/40',
      tab: 'finance',
    });
  }

  const quickActions = [
    { label: 'Start Video Call', icon: Play, tab: 'meetings', color: 'bg-indigo-500/10 text-indigo-400' },
    { label: 'New Document', icon: FileText, tab: 'documents', color: 'bg-purple-500/10 text-purple-400' },
    { label: 'Add Task', icon: Plus, tab: 'projects', color: 'bg-emerald-500/10 text-emerald-400' },
    { label: 'Open AI Copilot', icon: Sparkles, tab: 'ai_agent', color: 'bg-cyan-500/10 text-cyan-400' },
  ];

  const activity = [
    ...(sessions || []).slice(0, 2).map((s) => ({ type: 'session', item: s, tab: 'meetings' })),
    ...(tasks || []).slice(0, 2).map((t) => ({ type: 'task', item: t, tab: 'projects' })),
    ...(documents || []).slice(0, 2).map((d) => ({ type: 'doc', item: d, tab: 'documents' })),
  ].slice(0, 6);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
          {isSolo ? 'Personal Dashboard' : 'Team Dashboard'}
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Your workspace at a glance — jump into any module below.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.label}
              onClick={() => onNavigateTab(m.tab)}
              className={`metric-card text-left ${m.color.split(' ').slice(1).join(' ')}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{m.label}</span>
                <Icon className={`w-4 h-4 ${m.color.split(' ')[0]} group-hover:scale-110 transition-transform`} />
              </div>
              <div className="text-2xl font-bold text-slate-100">{m.value}</div>
              <div className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                <span>{m.sub}</span>
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          );
        })}
      </div>

      {/* AI Copilot promo card — single instance lives on ai_agent tab */}
      <button
        onClick={() => onNavigateTab('ai_agent')}
        className="w-full glass-panel rounded-2xl border border-indigo-500/20 p-5 flex items-center gap-4 hover:border-indigo-500/40 hover:shadow-glow transition-all text-left group"
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-600/30 flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-100">NexaMind AI Copilot</p>
          <p className="text-sm text-slate-400 mt-0.5 truncate">
            Create documents, schedule meetings, manage tasks — all by conversation.
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm font-semibold text-indigo-400 group-hover:text-indigo-300 flex-shrink-0">
          Open <ArrowRight className="w-4 h-4" />
        </div>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quick Actions</h3>
          <div className="space-y-2">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  onClick={() => onNavigateTab(a.tab)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 text-slate-200 border border-slate-800/60 text-sm font-medium transition"
                >
                  <div className={`p-2 rounded-lg ${a.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 glass-panel p-5 rounded-2xl border border-slate-800/80 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recent Activity</h3>
            <TrendingUp className="w-4 h-4 text-slate-600" />
          </div>
          <div className="flex-1 space-y-2">
            {activity.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No activity yet. Create your first item.</p>
            ) : (
              activity.map(({ type, item, tab }) => (
                <button
                  key={`${type}-${item.id}`}
                  onClick={() => onNavigateTab(tab)}
                  className="w-full p-3 bg-slate-900/50 rounded-xl border border-slate-800/60 flex items-center justify-between text-left hover:border-indigo-500/30 transition group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {type === 'session' && <Video className="w-4 h-4 text-purple-400 flex-shrink-0" />}
                    {type === 'task' && <FolderKanban className="w-4 h-4 text-indigo-400 flex-shrink-0" />}
                    {type === 'doc' && <FileText className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100 truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-500 capitalize">
                        {type === 'task' ? item.status?.replace('_', ' ') : type}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400 flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
