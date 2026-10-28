import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  HelpCircle,
  History,
  Info,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../api';
import MarkdownDocument from '../MarkdownDocument';
import { confirmDialog, notify } from '../../context/ToastContext';
import { useDialog } from '../../lib/dialog';
import { detectRelatedMeetings, parseMomTranscript, synthesizeMoMSections } from '../../lib/momAnalysis';

/**
 * Advanced AI Minutes of Meeting (MoM) Review, Editing, and Approval Dialog.
 * Provides a comprehensive 9-section report, grounded evidence tracking,
 * connected meeting timelines, and task integration.
 */
export default function MomReview({ workspaceId, sessionId, onClose, onDelete, onChanged }) {
  const ref = useDialog(true, onClose);
  const [mom, setMom] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [workspaceMeetings, setWorkspaceMeetings] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('report'); // 'report' | 'actions' | 'related' | 'transcript' | 'markdown'
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [newItem, setNewItem] = useState({ text: '', assignee_id: '', due_date: '' });
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [highlightTimestamp, setHighlightTimestamp] = useState(null);

  const transcriptScrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getMom(workspaceId, sessionId);
      setMom(data);
      setError(null);
      setSelected(new Set(data.action_items.filter((i) => i.status === 'proposed').map((i) => i.id)));

      // If tied to a scheduled/instant meeting, fetch meeting record
      if (data.meeting_id) {
        api.getMeeting(workspaceId, data.meeting_id).then(setMeeting).catch(() => {});
      }

      // Fetch all workspace meetings for related history detection
      api.listMeetings(workspaceId, 'all').then(setWorkspaceMeetings).catch(() => {});

      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [workspaceId, sessionId]);

  useEffect(() => {
    load();
    api.getWorkspaceMembers(workspaceId).then(setMembers).catch(() => setMembers([]));
  }, [load, workspaceId]);

  // If drafting in the background, poll until finished
  useEffect(() => {
    if (!mom || !['summarizing', 'transcribing', 'uploading'].includes(mom.status)) return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [mom, load]);

  const locked = mom?.mom_status === 'approved';
  const canEdit = mom?.can_review && !locked;
  const completeness = mom?.data?.completeness;

  // Synthesize 9 Structured MoM Sections
  const report = useMemo(() => {
    if (!mom) return null;
    return synthesizeMoMSections(mom, meeting, members);
  }, [mom, meeting, members]);

  // Detect Related Historical Meetings (Part B)
  const relatedMeetings = useMemo(() => {
    if (!mom) return [];
    return detectRelatedMeetings(
      meeting?.id || mom.session_id,
      mom.title,
      meeting?.agenda || '',
      workspaceMeetings
    );
  }, [mom, meeting, workspaceMeetings]);

  // Structured Transcript Segments
  const parsedSegments = useMemo(() => {
    return parseMomTranscript(mom?.transcript || '');
  }, [mom?.transcript]);

  const run = async (fn, okMessage) => {
    setBusy(true);
    try {
      const result = await fn();
      if (okMessage) notify(okMessage, 'success');
      await load();
      onChanged?.();
      return result;
    } catch (err) {
      notify(err.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (item, changes) => run(() => api.updateMomActionItem(workspaceId, sessionId, item.id, changes));

  const approve = async () => {
    const chosen = mom.action_items.filter((i) => selected.has(i.id) && i.status === 'proposed');
    const unassigned = chosen.filter((i) => !i.assignee_id).length;
    const ok = await confirmDialog(
      `Approving locks these minutes. ${chosen.length} task(s) will be created${unassigned ? ` (${unassigned} without an assignee)` : ''}; unselected items are discarded.`,
      { title: 'Approve the minutes?', confirmLabel: 'Approve' }
    );
    if (!ok) return;
    const result = await run(() => api.approveMom(workspaceId, sessionId, chosen.map((i) => i.id)));
    if (result) notify(`Minutes approved. ${result.created_task_ids.length} task(s) created.`, 'success');
  };

  const addItem = async (e) => {
    e.preventDefault();
    if (!newItem.text.trim()) return;
    const ok = await run(() =>
      api.addMomActionItem(workspaceId, sessionId, {
        text: newItem.text.trim(),
        assignee_id: newItem.assignee_id || null,
        due_date: newItem.due_date || null,
      })
    );
    if (ok) setNewItem({ text: '', assignee_id: '', due_date: '' });
  };

  const copy = () => {
    const text =
      tab === 'transcript'
        ? mom?.transcript || ''
        : `${mom?.title || 'Meeting Minutes'}\n\n${mom?.markdown || ''}`;
    navigator.clipboard?.writeText(text).then(
      () => notify('Copied to clipboard', 'success'),
      () => notify('Copy failed', 'error')
    );
  };

  const jumpToTranscript = (timestamp) => {
    if (!timestamp) return;
    setTab('transcript');
    setHighlightTimestamp(timestamp);
    setTranscriptSearch('');
    setTimeout(() => {
      const target = document.getElementById(`transcript-${timestamp}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  const pendingCount = mom?.action_items.filter((i) => i.status === 'proposed').length || 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mom-title"
        tabIndex={-1}
        className="bg-white w-full sm:max-w-4xl sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[92vh] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3 bg-slate-50/50 sm:rounded-t-2xl shrink-0">
          <div className="min-w-0">
            <h2 id="mom-title" className="font-extrabold text-lg text-slate-900 truncate">
              {mom?.title || 'Meeting Minutes & Summary'}
            </h2>
            {mom && (
              <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-1">
                {locked ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    <Lock className="w-3 h-3" /> Approved & Locked
                    {mom.approved_at && ` on ${new Date(mom.approved_at).toLocaleDateString()}`}
                  </span>
                ) : mom.status === 'summarizing' ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                    <Loader2 className="w-3 h-3 animate-spin" /> Drafting minutes from transcript…
                  </span>
                ) : mom.status === 'failed' ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md">
                    Drafting failed — click Regenerate
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                    Draft MoM · Review before approving
                  </span>
                )}
                {report?.overview?.actualDuration && (
                  <span className="text-slate-400">· Duration: {report.overview.actualDuration}</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-4 flex items-center gap-1 border-b border-slate-200 bg-white shrink-0 overflow-x-auto min-h-[46px] h-11 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {[
            ['report', 'Comprehensive MoM', FileText],
            ['actions', `Action items${mom ? ` (${mom.action_items.length})` : ''}`, ListChecks],
            ['related', `Connected Meetings (${relatedMeetings.length})`, History],
            ['transcript', 'Transcript', Mic],
            ['markdown', 'Raw Markdown', Pencil],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (id === 'markdown' && !draft) setDraft(mom?.markdown || '');
              }}
              className={`h-full px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors -mb-px ${
                tab === id
                  ? 'border-indigo-600 text-indigo-700 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 min-h-0 bg-slate-50/30">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl" role="alert">
              {error}
            </div>
          )}

          {!mom && !error && (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-sm text-slate-500 font-medium">Loading meeting report…</p>
            </div>
          )}

          {mom && completeness?.is_partial && (
            <div className="flex gap-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl p-3.5" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <strong className="font-bold">Notice: These minutes may be incomplete.</strong>
                <p className="text-xs text-amber-800 mt-0.5">{completeness.note}</p>
              </div>
            </div>
          )}

          {/* TAB 1: COMPREHENSIVE 9-SECTION MoM REPORT */}
          {mom && tab === 'report' && report && (
            <div className="space-y-6">
              {/* SECTION 1: MEETING OVERVIEW */}
              <section aria-labelledby="sec-overview" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 id="sec-overview" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Info className="w-4 h-4 text-indigo-600" />
                    Section 1: Meeting Overview
                  </h3>
                  <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full">
                    {report.overview.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block font-medium">Meeting Date</span>
                    <span className="font-bold text-slate-800 block mt-0.5">{report.overview.date}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Actual Duration</span>
                    <span className="font-bold text-indigo-600 block mt-0.5">{report.overview.actualDuration}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Organizer / Host</span>
                    <span className="font-bold text-slate-800 block mt-0.5">{report.overview.organizer}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Unique Participants</span>
                    <span className="font-bold text-slate-800 block mt-0.5">
                      {report.overview.uniqueParticipantsCount} ({report.overview.hostCount} Host, {report.overview.otherParticipantsCount} Members)
                    </span>
                  </div>
                </div>

                {report.overview.scheduledStart && (
                  <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 flex flex-wrap gap-4">
                    <span>
                      Scheduled Time:{' '}
                      <strong className="text-slate-700">
                        {report.overview.scheduledStart} – {report.overview.scheduledEnd || 'Open'}
                      </strong>
                    </span>
                    {report.overview.actualStart && (
                      <span>
                        Recorded Speech:{' '}
                        <strong className="text-slate-700">
                          {report.overview.actualStart} – {report.overview.actualEnd || 'End'}
                        </strong>
                      </span>
                    )}
                  </div>
                )}

                <div className="pt-2">
                  <span className="text-xs font-semibold text-slate-500 block mb-1.5">Joined Attendees:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {report.overview.participants.map((name, i) => (
                      <span key={i} className="text-xs font-medium px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </section>

              {/* SECTION 2: MEETING AGENDA */}
              <section aria-labelledby="sec-agenda" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
                <h3 id="sec-agenda" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-indigo-600" />
                  Section 2: Meeting Agenda & Objectives
                </h3>

                {report.agenda.objectives.length > 0 && (
                  <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 text-xs text-indigo-900">
                    <span className="font-bold block text-indigo-950 mb-1">Stated Meeting Objective:</span>
                    <ul className="list-disc list-inside space-y-0.5">
                      {report.agenda.objectives.map((obj, i) => (
                        <li key={i}>{obj}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <span className="text-xs font-bold text-slate-700 block">Agenda Coverage Status:</span>
                  {report.agenda.items.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No formal agenda was specified prior to the meeting.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {report.agenda.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 border border-slate-200">
                          <span className="font-medium text-slate-800">{item.text}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              item.status === 'Completed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {report.agenda.newTopics.length > 0 && (
                  <div className="text-xs pt-2">
                    <span className="text-slate-500 font-semibold">New topics introduced during discussion: </span>
                    <span className="text-slate-800">{report.agenda.newTopics.join(', ')}</span>
                  </div>
                )}
              </section>

              {/* SECTION 3: EXECUTIVE SUMMARY */}
              <section aria-labelledby="sec-summary" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-2">
                <h3 id="sec-summary" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  Section 3: Executive Summary
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed font-normal whitespace-pre-wrap">
                  {report.executiveSummary}
                </p>
              </section>

              {/* SECTION 4: TOPIC-BY-TOPIC DISCUSSION */}
              <section aria-labelledby="sec-topics" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 id="sec-topics" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-indigo-600" />
                    Section 4: Detailed Topic-by-Topic Discussion
                  </h3>
                  <span className="text-xs text-slate-500 font-medium">{report.topics.length} topics</span>
                </div>

                {report.topics.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No segregated discussion topics recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {report.topics.map((t) => (
                      <div key={t.id} className="border border-slate-200 rounded-xl p-3.5 space-y-2 hover:border-slate-300 transition-colors bg-white">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-bold text-slate-900">{t.title}</h4>
                          {t.timestamp && (
                            <button
                              type="button"
                              onClick={() => jumpToTranscript(t.timestamp)}
                              className="text-[11px] font-mono font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded transition-colors flex items-center gap-1"
                              title="Click to view in transcript"
                            >
                              <Clock className="w-3 h-3" /> [{t.timestamp}]
                            </button>
                          )}
                        </div>

                        <p className="text-xs text-slate-700 leading-relaxed">{t.summary}</p>

                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                          {t.contributors.length > 0 && (
                            <span>
                              <strong>Contributors:</strong> {t.contributors.join(', ')}
                            </span>
                          )}
                          {t.relatedDecisions.length > 0 && (
                            <span className="text-emerald-700 font-semibold">
                              ✓ {t.relatedDecisions.length} decision reached
                            </span>
                          )}
                          {t.relatedActions.length > 0 && (
                            <span className="text-indigo-700 font-semibold">
                              • {t.relatedActions.length} action item
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* SECTION 5: INDIVIDUAL PARTICIPANT SUMMARIES */}
              <section aria-labelledby="sec-participants" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 id="sec-participants" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-600" />
                    Section 5: Individual Participant Summaries
                  </h3>
                  <span className="text-[11px] text-indigo-700 bg-indigo-50 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Strict Transcript Attribution
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {report.participantSummaries.map((p, i) => (
                    <div key={i} className="border border-slate-200 rounded-xl p-3.5 space-y-2 bg-slate-50/50">
                      <div className="flex items-start justify-between">
                        <div>
                          <strong className="text-sm font-bold text-slate-900 block">{p.name}</strong>
                          <span className="text-[11px] text-slate-500">{p.role}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded font-mono">
                          {p.statementsCount} remarks
                        </span>
                      </div>

                      <div className="text-xs space-y-1 text-slate-700">
                        <span className="font-semibold text-slate-900 block">Key Contributions:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                          {p.contributions.map((c, idx) => (
                            <li key={idx} className="line-clamp-2">{c}</li>
                          ))}
                        </ul>
                      </div>

                      {p.responsibilities.length > 0 && (
                        <div className="text-xs text-indigo-900 bg-indigo-50/80 p-2 rounded-lg">
                          <span className="font-bold block text-indigo-950">Assigned Tasks:</span>
                          <p className="truncate">{p.responsibilities.join('; ')}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* SECTION 6: DECISIONS AND AGREEMENTS */}
              <section aria-labelledby="sec-decisions" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
                <h3 id="sec-decisions" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Section 6: Decisions and Agreements
                </h3>

                {report.decisions.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No explicit binding decisions were ratified during this meeting.</p>
                ) : (
                  <div className="space-y-2">
                    {report.decisions.map((d, i) => (
                      <div key={i} className="p-3 bg-emerald-50/40 border border-emerald-200/80 rounded-xl space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <strong className="text-xs font-bold text-emerald-950">{d.text}</strong>
                          <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded shrink-0">
                            {d.consensus}
                          </span>
                        </div>
                        {d.evidence && (
                          <p className="text-xs text-emerald-800/90 italic font-mono">
                            Evidence quote: “{d.evidence}”
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* SECTION 7: ACTION ITEMS HIGHLIGHT */}
              <section aria-labelledby="sec-actions-hl" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 id="sec-actions-hl" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ListChecks className="w-4 h-4 text-indigo-600" />
                    Section 7: Action Items and Next Steps
                  </h3>
                  <button
                    type="button"
                    onClick={() => setTab('actions')}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
                  >
                    Manage & assign tasks <ArrowRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="space-y-2">
                  {report.actionItems.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No pending action items were generated from the transcript.</p>
                  ) : (
                    report.actionItems.map((a) => (
                      <div key={a.id} className="flex items-center justify-between text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-slate-900 truncate">{a.text}</p>
                          <span className="text-[11px] text-slate-500">
                            Assignee: <strong className="text-slate-700">{a.assignee_name || a.owner_text || 'Unassigned'}</strong>
                            {a.due_date && ` · Due: ${a.due_date}`}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            a.status === 'confirmed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : a.status === 'rejected'
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {a.status === 'confirmed' ? 'Task created' : a.status === 'rejected' ? 'Discarded' : 'Proposed'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* SECTION 8: QUESTIONS AND UNRESOLVED ISSUES */}
              <section aria-labelledby="sec-questions" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
                <h3 id="sec-questions" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-amber-600" />
                  Section 8: Questions and Unresolved Issues
                </h3>
                {report.openQuestions.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No unresolved questions or blocked dependencies were flagged.</p>
                ) : (
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {report.openQuestions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-50/50 border border-amber-200/60">
                        <span className="text-amber-600 font-bold">•</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* SECTION 9: CLOSING STATEMENTS & FINAL OUTCOMES */}
              <section aria-labelledby="sec-closing" className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-2.5">
                <h3 id="sec-closing" className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-slate-700" />
                  Section 9: Closing Statements and Final Outcomes
                </h3>
                <div className="text-xs text-slate-700 space-y-1.5">
                  <p>
                    <strong>Adjournment Note:</strong> {report.closingStatements.concludingNote}
                  </p>
                  <p>
                    <strong>Agreed Deliverables:</strong> {report.closingStatements.finalDeliverablesCount} action items agreed upon.
                  </p>
                  <p>
                    <strong>Next Follow-up Cadence:</strong> {report.closingStatements.nextFollowup}
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* TAB 2: ACTION ITEMS & TASK CREATION */}
          {mom && tab === 'actions' && (
            <div className="space-y-4">
              <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900 flex items-center justify-between">
                <span>Select proposed items to automatically turn into tracked workspace tasks upon approval.</span>
                <span className="font-bold">{selected.size} selected</span>
              </div>

              {mom.action_items.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-10">No action items were found in the transcript.</p>
              )}

              {mom.action_items.map((item) => (
                <div
                  key={item.id}
                  className={`border rounded-xl p-3.5 space-y-2 bg-white transition-colors ${
                    item.status === 'rejected'
                      ? 'opacity-50 border-slate-200'
                      : item.needs_review
                      ? 'border-amber-300 bg-amber-50/30'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {canEdit && item.status === 'proposed' && (
                      <input
                        type="checkbox"
                        className="mt-1 rounded text-indigo-600 focus:ring-indigo-500"
                        aria-label={`Create task for: ${item.text}`}
                        checked={selected.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 break-words">{item.text}</p>
                      {item.evidence && item.evidence !== 'manual' && (
                        <p className="text-xs text-slate-500 mt-1 font-mono break-words">Evidence: “{item.evidence}”</p>
                      )}
                      {item.needs_review && item.status === 'proposed' && (
                        <p className="text-xs text-amber-700 mt-1 font-medium">
                          {item.owner_text
                            ? `“${item.owner_text}” is not an exact workspace member — assign an owner.`
                            : 'Unassigned action item — pick an assignee.'}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                        item.status === 'confirmed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : item.status === 'rejected'
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-indigo-100 text-indigo-800'
                      }`}
                    >
                      {item.status === 'confirmed' ? 'Task created' : item.status === 'rejected' ? 'Discarded' : 'Proposed'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-3 items-center text-xs pt-1 border-t border-slate-100">
                    <label className="flex items-center gap-1.5">
                      <span className="text-slate-500 font-medium">Assignee:</span>
                      <select
                        disabled={!canEdit || item.status !== 'proposed' || busy}
                        value={item.assignee_id || ''}
                        onChange={(e) => updateItem(item, { assignee_id: e.target.value || null })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white disabled:bg-slate-50 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-1.5">
                      <span className="text-slate-500 font-medium">Due:</span>
                      <input
                        type="date"
                        disabled={!canEdit || item.status !== 'proposed' || busy}
                        value={item.due_date || ''}
                        onChange={(e) => updateItem(item, { due_date: e.target.value || null })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs disabled:bg-slate-50 focus:outline-none focus:border-indigo-500"
                      />
                    </label>

                    {canEdit && item.status !== 'confirmed' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => updateItem(item, { rejected: item.status !== 'rejected' })}
                        className="text-xs font-bold text-slate-500 hover:text-slate-800 underline ml-auto"
                      >
                        {item.status === 'rejected' ? 'Restore' : 'Discard'}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {canEdit && (
                <form onSubmit={addItem} className="border border-dashed border-slate-300 rounded-xl p-4 space-y-3 bg-white">
                  <p className="text-xs font-bold text-slate-700">Manually add agreed action item:</p>
                  <input
                    aria-label="Action item"
                    value={newItem.text}
                    maxLength={500}
                    onChange={(e) => setNewItem({ ...newItem, text: e.target.value })}
                    placeholder="Task description..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  />
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      aria-label="Assignee"
                      value={newItem.assignee_id}
                      onChange={(e) => setNewItem({ ...newItem, assignee_id: e.target.value })}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      aria-label="Due date"
                      value={newItem.due_date}
                      onChange={(e) => setNewItem({ ...newItem, due_date: e.target.value })}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busy || !newItem.text.trim()}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Item
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: CONNECTED MEETINGS TIMELINE (PART B) */}
          {mom && tab === 'related' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1">
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <GitBranch className="w-4 h-4 text-indigo-600" />
                  Historical Meeting Relationships & Follow-Up Chain
                </h4>
                <p className="text-xs text-slate-600">
                  Detected from verified workspace meeting history, cadence series, and follow-up agendas.
                </p>
              </div>

              {relatedMeetings.length === 0 ? (
                <div className="text-center py-12 px-4 bg-white border border-slate-200 rounded-2xl space-y-2">
                  <History className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-700">No prior related meetings found in this workspace.</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Historical connections are generated only from verified workspace records. Future follow-ups to this meeting will appear here.
                  </p>
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-indigo-200">
                  {relatedMeetings.map((rm, idx) => (
                    <div key={rm.id || idx} className="relative group">
                      <span className="absolute -left-6 top-2 w-3.5 h-3.5 rounded-full border-2 border-white bg-indigo-600 ring-2 ring-indigo-200" />
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900">{rm.title}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700">
                              {rm.category}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {rm.confidence}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600">{rm.reason}</p>

                        <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-100">
                          <span>Date: {new Date(rm.date).toLocaleDateString()}</span>
                          <span className="capitalize">Status: {rm.status}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: INTERACTIVE TRANSCRIPT WITH SEARCH & JUMP */}
          {mom && tab === 'transcript' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search in full transcript..."
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div ref={transcriptScrollRef} className="space-y-1 bg-white border border-slate-200 rounded-xl p-4 max-h-[500px] overflow-y-auto">
                {parsedSegments.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No speech was transcribed for this session.</p>
                ) : (
                  parsedSegments
                    .filter((s) => !transcriptSearch || s.text.toLowerCase().includes(transcriptSearch.toLowerCase()) || (s.speaker && s.speaker.toLowerCase().includes(transcriptSearch.toLowerCase())))
                    .map((s, idx) => {
                      const isHighlighted = highlightTimestamp && s.timestamp === highlightTimestamp;
                      return (
                        <div
                          key={s.id || idx}
                          id={s.timestamp ? `transcript-${s.timestamp}` : undefined}
                          className={`text-xs p-1.5 rounded transition-colors ${
                            isHighlighted ? 'bg-amber-100 border-l-4 border-amber-500 font-medium' : 'hover:bg-slate-50'
                          }`}
                        >
                          {s.timestamp && (
                            <span className="font-mono text-slate-400 text-[11px] mr-2">[{s.timestamp}]</span>
                          )}
                          {s.speaker && (
                            <strong className="text-indigo-900 mr-1.5">{s.speaker}:</strong>
                          )}
                          <span className="text-slate-800">{s.text}</span>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}

          {/* TAB 5: RAW MARKDOWN EDITOR */}
          {mom && tab === 'markdown' && (
            <div className="space-y-3">
              {editing ? (
                <div className="space-y-2">
                  <textarea
                    aria-label="Minutes (Markdown)"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="w-full min-h-[22rem] border border-slate-300 rounded-xl p-3 tabular-nums text-xs font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="px-4 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-700 hover:bg-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await run(() => api.editMom(workspaceId, sessionId, draft), 'Minutes updated');
                        if (ok) setEditing(false);
                      }}
                      className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
                    >
                      Save Markdown
                    </button>
                  </div>
                </div>
              ) : (
                <div className="prose-sm max-w-none bg-white p-4 border border-slate-200 rounded-xl">
                  <MarkdownDocument
                    text={mom.markdown || ''}
                    workspaceId={workspaceId}
                    emptyText={mom.status === 'summarizing' ? 'The minutes are being drafted…' : 'No minutes generated yet.'}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {mom && (
          <div className="p-3 sm:p-4 border-t border-slate-200 flex flex-wrap items-center gap-2 justify-end bg-slate-50/60 sm:rounded-b-2xl shrink-0">
            <button
              type="button"
              onClick={copy}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm text-slate-700 hover:bg-slate-200 font-semibold transition-colors"
            >
              <Copy className="w-4 h-4" /> Copy Report
            </button>

            {onDelete && !locked && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm text-rose-600 hover:bg-rose-50 font-semibold"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}

            {canEdit && (
              <>
                <button
                  type="button"
                  disabled={busy || mom.status === 'summarizing'}
                  onClick={async () => {
                    const ok = await confirmDialog(
                      'Regenerate the minutes from the original transcript? Your manual text edits will be replaced, but custom action items are safely preserved.',
                      { title: 'Regenerate MoM?', confirmLabel: 'Regenerate' }
                    );
                    if (ok) {
                      run(() => api.regenerateMom(workspaceId, sessionId), 'Minutes redrafted successfully');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Regenerate
                </button>

                {tab === 'markdown' && !editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(mom.markdown || '');
                      setEditing(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold transition-colors"
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                )}

                <button
                  type="button"
                  disabled={busy || mom.status === 'summarizing'}
                  onClick={approve}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50 shadow-sm transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" /> Approve
                  {pendingCount ? ` & Create ${selected.size} Task(s)` : ''}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
