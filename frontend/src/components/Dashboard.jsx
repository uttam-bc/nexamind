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
} from 'lucide-react';

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
  const openTasks = (tasks || []).filter((t) => t.status !== 'done');
  const runwayMonths = financeSummary?.runway_months ?? 12;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10 font-sans text-[#191C1E]">
      {/* 1. Hero Section + Financial Runway Grid (Exact Stitch Spec) */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hero AI Morning Brief */}
        <div className="lg:col-span-2 bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-sm relative overflow-hidden group">
          <div className="relative z-10">
            <h2 className="text-3xl font-bold text-[#191C1E] mb-2 tracking-tight">
              Welcome back, {user?.name || 'Alex'}.
            </h2>
            <p className="text-base text-slate-600 mb-6 max-w-2xl leading-relaxed">
              Here's your AI-generated morning brief. The <strong>Apollo Project</strong> needs your
              review on 3 pull requests, and the Q3 budget report is due at 5 PM.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => onNavigateTab('projects')}
                className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition"
              >
                Review PRs
              </button>
              <button
                onClick={() => onNavigateTab('finance')}
                className="border border-[#E2E8F0] text-[#191C1E] px-4 py-2 rounded-lg text-xs font-semibold hover:bg-[#F2F4F6] transition"
              >
                View Budget
              </button>
            </div>
          </div>
        </div>

        {/* Financial Runway (Exact Stitch Spec) */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-sm hover-lift flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">
                Runway
              </h3>
              <div className="text-3xl font-bold text-[#10B981] mt-1 tracking-tight">
                {runwayMonths} Months
              </div>
            </div>
            <TrendingUp className="w-5 h-5 text-[#10B981]" />
          </div>

          <div>
            <div className="w-full bg-[#ECEEF0] rounded-full h-2 mt-4 overflow-hidden">
              <div className="bg-[#10B981] h-2 rounded-full" style={{ width: '75%' }}></div>
            </div>
            <p className="text-xs font-mono text-slate-500 mt-3 text-right">Burn rate stable</p>
          </div>
        </div>
      </section>

      {/* 2. Workspace Topology & Upcoming Deadlines (Exact Stitch Spec) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workspace Topology */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-[#191C1E] mb-6 flex items-center gap-2">
            <span className="text-slate-400">⚡</span>
            <span>Workspace Topology</span>
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {/* Solo Environment */}
            <div
              onClick={() => onNavigateTab('documents')}
              className="border border-[#0EA5E9]/30 bg-[#0EA5E9]/5 rounded-lg p-4 hover:bg-[#0EA5E9]/10 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#0EA5E9]">Solo Environment</span>
                <User className="w-4 h-4 text-[#0EA5E9]" />
              </div>
              <div className="text-3xl font-bold text-[#191C1E]">{documents?.length || 14}</div>
              <p className="text-xs font-mono text-slate-500">Active Drafts</p>
            </div>

            {/* Group Workspace */}
            <div
              onClick={() => onNavigateTab('projects')}
              className="border border-[#8B5CF6]/30 bg-[#8B5CF6]/5 rounded-lg p-4 hover:bg-[#8B5CF6]/10 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#8B5CF6]">Group Workspace</span>
                <Users className="w-4 h-4 text-[#8B5CF6]" />
              </div>
              <div className="text-3xl font-bold text-[#191C1E]">{tasks?.length || 8}</div>
              <p className="text-xs font-mono text-slate-500">Shared Sprints</p>
            </div>
          </div>
        </div>

        {/* Upcoming Deadlines (Exact Stitch Spec) */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-[#191C1E]">Upcoming Deadlines</h3>
            <button
              onClick={() => onNavigateTab('calendar')}
              className="text-xs font-bold text-[#4F46E5] hover:underline"
            >
              View All
            </button>
          </div>

          <ul className="space-y-3">
            <li
              onClick={() => onNavigateTab('calendar')}
              className="flex items-center justify-between p-3 border border-[#E2E8F0] rounded-lg hover:bg-[#F2F4F6] transition cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-[#F43F5E]"></div>
                <span className="text-xs font-medium text-[#191C1E]">Q3 Budget Submission</span>
              </div>
              <span className="text-xs font-mono text-slate-500 bg-[#ECEEF0] px-2 py-1 rounded">
                Today, 5 PM
              </span>
            </li>

            <li
              onClick={() => onNavigateTab('calendar')}
              className="flex items-center justify-between p-3 border border-[#E2E8F0] rounded-lg hover:bg-[#F2F4F6] transition cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]"></div>
                <span className="text-xs font-medium text-[#191C1E]">Apollo API Integration</span>
              </div>
              <span className="text-xs font-mono text-slate-500 bg-[#ECEEF0] px-2 py-1 rounded">
                Tomorrow
              </span>
            </li>

            <li
              onClick={() => onNavigateTab('calendar')}
              className="flex items-center justify-between p-3 border border-[#E2E8F0] rounded-lg hover:bg-[#F2F4F6] transition cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-[#4F46E5]"></div>
                <span className="text-xs font-medium text-[#191C1E]">Design System Audit</span>
              </div>
              <span className="text-xs font-mono text-slate-500 bg-[#ECEEF0] px-2 py-1 rounded">
                Friday
              </span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
