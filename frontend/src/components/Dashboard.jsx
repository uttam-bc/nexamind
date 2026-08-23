import React from 'react';
import {
  FolderKanban,
  FileText,
  MessageSquare,
  Video,
  DollarSign,
  Plus,
  Play,
  TrendingUp,
  Clock,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import AiAssistant from './AiAssistant';

export default function Dashboard({
  workspaceId,
  user,
  tasks,
  channels,
  sessions,
  financeSummary,
  documents,
  onNavigateTab,
  onRefreshAll,
}) {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Open Tasks Card */}
        <div
          onClick={() => onNavigateTab('projects')}
          className="glass-panel p-5 rounded-2xl border border-slate-800 hover:border-indigo-500/40 transition cursor-pointer space-y-2 group shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Open Tasks</span>
            <FolderKanban className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition" />
          </div>
          <div className="text-3xl font-black text-slate-100 tracking-tight">
            {(tasks || []).filter((t) => t.status !== 'done').length}
          </div>
          <div className="text-[11px] text-indigo-400 font-medium flex items-center justify-between">
            <span>Active on Kanban</span>
            <span>→</span>
          </div>
        </div>

        {/* Sessions Card */}
        <div
          onClick={() => onNavigateTab('meetings')}
          className="glass-panel p-5 rounded-2xl border border-slate-800 hover:border-purple-500/40 transition cursor-pointer space-y-2 group shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Meeting Sessions</span>
            <Video className="w-4 h-4 text-purple-400 group-hover:scale-110 transition" />
          </div>
          <div className="text-3xl font-black text-slate-100 tracking-tight">
            {sessions?.length || 0}
          </div>
          <div className="text-[11px] text-purple-400 font-medium flex items-center justify-between">
            <span>Transcripts & AI Summaries</span>
            <span>→</span>
          </div>
        </div>

        {/* Channels Card */}
        <div
          onClick={() => onNavigateTab('channels')}
          className="glass-panel p-5 rounded-2xl border border-slate-800 hover:border-emerald-500/40 transition cursor-pointer space-y-2 group shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Channels</span>
            <MessageSquare className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition" />
          </div>
          <div className="text-3xl font-black text-slate-100 tracking-tight">
            {channels?.length || 0}
          </div>
          <div className="text-[11px] text-emerald-400 font-medium flex items-center justify-between">
            <span>Real-time Chat</span>
            <span>→</span>
          </div>
        </div>

        {/* Documents Card */}
        <div
          onClick={() => onNavigateTab('documents')}
          className="glass-panel p-5 rounded-2xl border border-slate-800 hover:border-cyan-500/40 transition cursor-pointer space-y-2 group shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Documents & Specs</span>
            <FileText className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition" />
          </div>
          <div className="text-3xl font-black text-cyan-400 tracking-tight">
            {documents?.length || 0}
          </div>
          <div className="text-[11px] text-slate-500 font-medium flex items-center justify-between">
            <span>Block Specs & Notes</span>
            <span>→</span>
          </div>
        </div>
      </div>

      {/* Center Autonomous Omni-Agent Cockpit Panel */}
      <AiAssistant
        workspaceId={workspaceId}
        onNavigateTab={onNavigateTab}
        onRefreshAll={onRefreshAll}
      />

      {/* Quick Launchpad & Recent Activity */}
      <div className="grid grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="col-span-1 glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Quick Actions
          </h3>
          <div className="space-y-2">
            <button
              onClick={() => onNavigateTab('meetings')}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition"
            >
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Play className="w-3.5 h-3.5 fill-indigo-400" />
              </div>
              <span>Start Live Video Call</span>
            </button>

            <button
              onClick={() => onNavigateTab('documents')}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition"
            >
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <span>Create Document Spec</span>
            </button>

            <button
              onClick={() => onNavigateTab('projects')}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition"
            >
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Plus className="w-3.5 h-3.5" />
              </div>
              <span>Add Kanban Task</span>
            </button>

            <button
              onClick={() => onNavigateTab('ai_agent')}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition"
            >
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span>Open Omni-Agent AI</span>
            </button>
          </div>
        </div>

        {/* Recent Workspace Stream */}
        <div className="col-span-2 glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Live Workspace Activity
          </h3>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {(sessions || []).slice(0, 3).map((s) => (
              <div
                key={s.id}
                onClick={() => onNavigateTab('meetings')}
                className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs cursor-pointer hover:border-indigo-500/40 transition"
              >
                <div className="flex items-center gap-2.5">
                  <Video className="w-4 h-4 text-purple-400 flex-shrink-0" />
                  <div>
                    <div className="font-bold text-slate-100">{s.title}</div>
                    <div className="text-[10px] text-slate-500">
                      {s.action_items?.length || 0} Action items • {s.status}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500">
                  {new Date(s.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}

            {(tasks || []).slice(0, 3).map((t) => (
              <div
                key={t.id}
                onClick={() => onNavigateTab('projects')}
                className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs cursor-pointer hover:border-indigo-500/40 transition"
              >
                <div className="flex items-center gap-2.5">
                  <FolderKanban className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <div>
                    <div className="font-bold text-slate-100">{t.title}</div>
                    <div className="text-[10px] text-slate-500 capitalize">
                      Column: {t.status.replace('_', ' ')}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-bold uppercase text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                  {t.priority || 'medium'}
                </span>
              </div>
            ))}

            {(documents || []).slice(0, 2).map((d) => (
              <div
                key={d.id}
                onClick={() => onNavigateTab('documents')}
                className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs cursor-pointer hover:border-indigo-500/40 transition"
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <div>
                    <div className="font-bold text-slate-100">{d.title}</div>
                    <div className="text-[10px] text-slate-500">Block document spec</div>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500">
                  {new Date(d.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
