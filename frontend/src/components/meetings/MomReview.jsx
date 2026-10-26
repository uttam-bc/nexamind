import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, FileText, ListChecks, Loader2, Lock, Mic, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import MarkdownDocument from '../MarkdownDocument';
import { confirmDialog, notify } from '../../context/ToastContext';
import { useDialog } from '../../lib/dialog';

/** Review, edit and approve the minutes of one meeting (or uploaded recording). */
export default function MomReview({ workspaceId, sessionId, onClose, onDelete, onChanged }) {
  const ref = useDialog(true, onClose);
  const [mom, setMom] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('mom');
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [newItem, setNewItem] = useState({ text: '', assignee_id: '', due_date: '' });

  const load = useCallback(async () => {
    try {
      const data = await api.getMom(workspaceId, sessionId);
      setMom(data);
      setError(null);
      setSelected(new Set(data.action_items.filter((i) => i.status === 'proposed').map((i) => i.id)));
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

  // The draft is written in the background after the meeting: check back until it's there.
  useEffect(() => {
    if (!mom || !['summarizing', 'transcribing', 'uploading'].includes(mom.status)) return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [mom, load]);

  const locked = mom?.mom_status === 'approved';
  const canEdit = mom?.can_review && !locked;
  const completeness = mom?.data?.completeness;

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
      { title: 'Approve the minutes?', confirmLabel: 'Approve' },
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
      }),
    );
    if (ok) setNewItem({ text: '', assignee_id: '', due_date: '' });
  };

  const copy = () => {
    const text = tab === 'transcript' ? mom.transcript || '' : `${mom.title}\n\n${mom.markdown || ''}`;
    navigator.clipboard?.writeText(text).then(() => notify('Copied', 'success'), () => notify('Copy failed', 'error'));
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
        className="bg-white w-full sm:max-w-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[90vh] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="mom-title" className="font-bold text-slate-900 truncate">{mom?.title || 'Meeting minutes'}</h2>
            {mom && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                {locked ? (
                  <>
                    <Lock className="w-3 h-3" /> Approved{mom.approved_at ? ` ${new Date(mom.approved_at).toLocaleString()}` : ''}
                  </>
                ) : mom.status === 'summarizing' ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" /> Drafting the minutes from the transcript…
                  </>
                ) : mom.status === 'failed' ? (
                  'Drafting failed — regenerate to try again'
                ) : (
                  'Draft · review before approving'
                )}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 flex gap-1 border-b border-slate-200 overflow-x-auto">
          {[
            ['mom', 'Minutes', FileText],
            ['actions', `Action items${mom ? ` (${mom.action_items.length})` : ''}`, ListChecks],
            ['transcript', 'Transcript', Mic],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px flex items-center gap-1.5 whitespace-nowrap ${
                tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!mom && !error && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}

          {mom && completeness?.is_partial && (
            <div className="flex gap-2 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl p-3" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>These minutes may be incomplete.</strong> {completeness.note}
              </span>
            </div>
          )}

          {mom && tab === 'mom' &&
            (editing ? (
              <div className="space-y-2">
                <textarea
                  aria-label="Minutes (Markdown)"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full min-h-[20rem] border border-slate-300 rounded-xl p-3 tabular-nums text-sm focus:outline-none focus:border-indigo-500"
                />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-sm font-bold">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await run(() => api.editMom(workspaceId, sessionId, draft), 'Minutes saved');
                      if (ok) setEditing(false);
                    }}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="prose-sm max-w-none">
                <MarkdownDocument
                  text={mom.markdown || ''}
                  workspaceId={workspaceId}
                  emptyText={mom.status === 'summarizing' ? 'The minutes are being drafted…' : 'No minutes yet.'}
                />
              </div>
            ))}

          {mom && tab === 'actions' && (
            <div className="space-y-3">
              {mom.action_items.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">No action items were found in the transcript.</p>
              )}
              {mom.action_items.map((item) => (
                <div
                  key={item.id}
                  className={`border rounded-xl p-3 space-y-2 ${item.status === 'rejected' ? 'opacity-50 border-slate-200' : item.needs_review ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}
                >
                  <div className="flex items-start gap-2">
                    {canEdit && item.status === 'proposed' && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        aria-label={`Create a task for: ${item.text}`}
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
                        <p className="text-xs text-slate-500 mt-0.5 break-words">Said: “{item.evidence}”</p>
                      )}
                      {item.needs_review && item.status === 'proposed' && (
                        <p className="text-xs text-amber-700 mt-1">
                          {item.owner_text ? `“${item.owner_text}” isn't a workspace member — pick an assignee.` : 'No owner was named — pick an assignee or leave it unassigned.'}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                        item.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : item.status === 'rejected' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-700'
                      }`}
                    >
                      {item.status === 'confirmed' ? 'Task created' : item.status === 'rejected' ? 'Discarded' : 'Proposed'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center text-sm">
                    <label className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500">Assignee</span>
                      <select
                        disabled={!canEdit || item.status !== 'proposed' || busy}
                        value={item.assignee_id || ''}
                        onChange={(e) => updateItem(item, { assignee_id: e.target.value || null })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white disabled:bg-slate-50"
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
                      <span className="text-xs text-slate-500">Due</span>
                      <input
                        type="date"
                        disabled={!canEdit || item.status !== 'proposed' || busy}
                        value={item.due_date || ''}
                        onChange={(e) => updateItem(item, { due_date: e.target.value || null })}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm disabled:bg-slate-50"
                      />
                    </label>
                    {canEdit && item.status !== 'confirmed' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => updateItem(item, { rejected: item.status !== 'rejected' })}
                        className="text-xs font-bold text-slate-500 hover:text-slate-800 underline"
                      >
                        {item.status === 'rejected' ? 'Restore' : 'Discard'}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {canEdit && (
                <form onSubmit={addItem} className="border border-dashed border-slate-300 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-slate-500">Add an action item that was agreed</p>
                  <input
                    aria-label="Action item"
                    value={newItem.text}
                    maxLength={500}
                    onChange={(e) => setNewItem({ ...newItem, text: e.target.value })}
                    placeholder="What needs to be done"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Assignee"
                      value={newItem.assignee_id}
                      onChange={(e) => setNewItem({ ...newItem, assignee_id: e.target.value })}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
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
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <button type="submit" disabled={busy || !newItem.text.trim()} className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm font-bold disabled:opacity-40">
                      <Plus className="w-4 h-4" /> Add
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {mom && tab === 'transcript' && (
            <pre className="text-xs tabular-nums text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-4">
              {mom.transcript || 'No speech was transcribed.'}
            </pre>
          )}
        </div>

        {mom && (
          <div className="p-3 border-t border-slate-200 flex flex-wrap items-center gap-2 justify-end">
            <button type="button" onClick={copy} className="mr-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100">
              <Copy className="w-4 h-4" /> Copy
            </button>
            {onDelete && !locked && (
              <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-rose-600 hover:bg-rose-50">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
            {canEdit && (
              <>
                <button
                  type="button"
                  disabled={busy || mom.status === 'summarizing'}
                  onClick={async () => {
                    if (await confirmDialog('Redraft the minutes from the transcript? Your edits to the text are replaced; action items you changed are kept.', { title: 'Regenerate?', confirmLabel: 'Regenerate' })) {
                      run(() => api.regenerateMom(workspaceId, sessionId), 'Minutes redrafted');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-slate-100 hover:bg-slate-200 font-semibold disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" /> Regenerate
                </button>
                {tab === 'mom' && !editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(mom.markdown || '');
                      setEditing(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-slate-100 hover:bg-slate-200 font-semibold"
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || mom.status === 'summarizing'}
                  onClick={approve}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> Approve{pendingCount ? ` & create ${selected.size} task(s)` : ''}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
