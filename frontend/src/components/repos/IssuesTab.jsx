import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleDot, ClipboardList, Link2, MessageSquare, Search, Tag } from 'lucide-react';
import { api } from '../../api';
import { notify } from '../../context/ToastContext';
import { navigateTo } from '../../lib/deepLink';
import { Avatar, Badge, Btn, Empty, Field, inputClass, Panel, Spinner } from './ui';
import { LinkedText } from './CommitsTab';
import { can, repoLink, timeAgo } from './repoUtils';

const PRIORITY_TONE = { low: 'slate', medium: 'blue', high: 'amber', urgent: 'red' };

function IssueState({ state }) {
  return state === 'open'
    ? <Badge tone="green"><CircleDot className="w-3 h-3" />Open</Badge>
    : <Badge tone="purple"><CheckCircle2 className="w-3 h-3" />Closed</Badge>;
}

function Labels({ labels }) {
  return labels.map((l) => <Badge key={l} tone="indigo"><Tag className="w-3 h-3" />{l}</Badge>);
}

function IssueForm({ members, labels, initial = {}, triage, onSubmit, onCancel, submitLabel }) {
  const [title, setTitle] = useState(initial.title || '');
  const [body, setBody] = useState(initial.body || '');
  const [picked, setPicked] = useState(initial.labels || []);
  const [assignee, setAssignee] = useState(initial.assignee?.id || '');
  const [priority, setPriority] = useState(initial.priority || 'medium');
  const [milestone, setMilestone] = useState(initial.milestone || '');
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const all = [...new Set([...labels, ...picked])];
  return (
    <Panel className="p-4 space-y-3">
      <Field label="Title"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} autoFocus /></Field>
      <Field label="Description"><textarea className={inputClass} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened, what you expected, steps to reproduce" /></Field>
      {triage && (
        <>
          <Field label="Labels">
            <div className="flex flex-wrap gap-1.5 items-center">
              {all.map((l) => (
                <button key={l} type="button" aria-pressed={picked.includes(l)} onClick={() => setPicked(picked.includes(l) ? picked.filter((x) => x !== l) : [...picked, l])}
                  className={`px-2.5 py-1 rounded-full border text-xs ${picked.includes(l) ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-600'}`}>{l}</button>
              ))}
              <input aria-label="New label" className={`${inputClass} w-32 py-1 text-xs`} placeholder="+ label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newLabel.trim()) {
                    e.preventDefault();
                    setPicked([...new Set([...picked, newLabel.trim().toLowerCase()])]);
                    setNewLabel('');
                  }
                }} />
            </div>
          </Field>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Assignee">
              <select className={inputClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">No one</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Milestone"><input className={inputClass} value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="v1.0" maxLength={120} /></Field>
          </div>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn variant="success" busy={busy} disabled={!title.trim()} onClick={async () => {
          setBusy(true);
          try {
            await onSubmit({
              title: title.trim(), body,
              ...(triage ? { labels: picked, assignee_id: assignee || null, priority, milestone } : {}),
            });
          } catch (err) {
            notify(err.message, 'error');
            setBusy(false);
          }
        }}>{submitLabel}</Btn>
      </div>
    </Panel>
  );
}

export function IssueDetail({ wsId, repo, role, user, number, members, labels, onBack, onRef }) {
  const [issue, setIssue] = useState(null);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.getIssue(wsId, repo.id, number).then(setIssue).catch((e) => setError(e.message));
  useEffect(() => {
    setIssue(null);
    load();
  }, [wsId, repo.id, number]);
  if (error) return <Panel className="p-4 text-sm text-rose-700" role="alert">{error}</Panel>;
  if (!issue) return <Spinner />;
  const triage = can(role, 'write');
  const author = issue.author?.id === user?.id;
  const update = async (data) => {
    try {
      await api.updateIssue(wsId, repo.id, number, data);
      load();
    } catch (err) {
      notify(err.message, 'error');
      throw err;
    }
  };

  if (editing) {
    return (
      <IssueForm members={members} labels={labels} initial={issue} triage={triage} submitLabel="Save" onCancel={() => setEditing(false)}
        onSubmit={async (data) => {
          await update(data);
          setEditing(false);
        }} />
    );
  }
  return (
    <div className="space-y-4">
      <Btn size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4" />Issues</Btn>
      <div>
        <h2 className="text-xl font-bold text-slate-900 break-words">{issue.title} <span className="text-slate-400 font-normal">#{issue.number}</span></h2>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-slate-600">
          <IssueState state={issue.state} />
          <span><strong className="text-slate-800">{issue.author?.name || 'Someone'}</strong> opened this {timeAgo(issue.created_at)}</span>
          <button type="button" className="ml-auto text-xs flex items-center gap-1 text-slate-500 hover:text-indigo-700" onClick={() => navigator.clipboard?.writeText(repoLink(repo.id, 'issues', issue.number)).then(() => notify('Link copied. Paste it in a chat to share.', 'success'))}>
            <Link2 className="w-3.5 h-3.5" />Copy link
          </button>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_16rem] gap-4">
        <div className="space-y-4 min-w-0">
          <div className="flex gap-3">
            <Avatar user={issue.author} size={8} />
            <Panel className="flex-1 p-3 text-sm whitespace-pre-wrap break-words">
              {issue.body ? <LinkedText text={issue.body} onRef={onRef} /> : <span className="text-slate-500">No description.</span>}
            </Panel>
          </div>
          {issue.comments.map((c) => (
            <div key={c.id} className="flex gap-3">
              <Avatar user={c.author} size={8} />
              <Panel className="flex-1 overflow-hidden">
                <p className="px-3 py-2 text-xs bg-slate-50 border-b border-slate-100"><strong className="text-slate-800">{c.author?.name}</strong> commented {timeAgo(c.created_at)}</p>
                <p className="px-3 py-2 text-sm whitespace-pre-wrap break-words"><LinkedText text={c.body} onRef={onRef} /></p>
              </Panel>
            </div>
          ))}
          <textarea aria-label="Add a comment" className={inputClass} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" />
          <div className="flex flex-wrap justify-end gap-2">
            {(triage || author) && (
              <Btn onClick={() => update({ state: issue.state === 'open' ? 'closed' : 'open' })}>
                {issue.state === 'open' ? <><CheckCircle2 className="w-4 h-4 text-violet-600" />Close issue</> : 'Reopen issue'}
              </Btn>
            )}
            <Btn variant="primary" disabled={!comment.trim()} onClick={async () => {
              try {
                await api.commentIssue(wsId, repo.id, number, comment);
                setComment('');
                load();
              } catch (err) {
                notify(err.message, 'error');
              }
            }}><MessageSquare className="w-4 h-4" />Comment</Btn>
          </div>
        </div>
        <aside className="space-y-3 text-sm">
          {(triage || author) && <Btn size="sm" className="w-full" onClick={() => setEditing(true)}>Edit</Btn>}
          <Panel className="p-3 space-y-3">
            <div><p className="text-xs font-semibold text-slate-500">Assignee</p><p>{issue.assignee?.name || 'No one'}</p></div>
            <div><p className="text-xs font-semibold text-slate-500">Labels</p><div className="flex flex-wrap gap-1 mt-1">{issue.labels.length ? <Labels labels={issue.labels} /> : 'None'}</div></div>
            <div><p className="text-xs font-semibold text-slate-500">Priority</p><Badge tone={PRIORITY_TONE[issue.priority]}>{issue.priority}</Badge></div>
            <div><p className="text-xs font-semibold text-slate-500">Milestone</p><p>{issue.milestone || 'None'}</p></div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Task</p>
              {issue.task ? (
                <button type="button" className="text-left text-indigo-700 hover:underline" onClick={() => navigateTo({ tab: 'projects', workspace_id: repo.workspace_id, task_id: issue.task.id })}>
                  <ClipboardList className="w-3.5 h-3.5 inline mr-1" />{issue.task.title} <Badge>{issue.task.status.replace('_', ' ')}</Badge>
                </button>
              ) : triage ? (
                <Btn size="sm" onClick={async () => {
                  try {
                    await api.linkIssueTask(wsId, repo.id, number);
                    notify('Task created on the board and linked', 'success');
                    load();
                  } catch (err) {
                    notify(err.message, 'error');
                  }
                }}><ClipboardList className="w-4 h-4" />Create linked task</Btn>
              ) : <p>None</p>}
              {issue.task && <p className="text-xs text-slate-500 mt-1">Closing one closes the other.</p>}
            </div>
            {issue.source_action_item_id && <p className="text-xs text-slate-500">Created from a meeting action item.</p>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

export function NewIssue({ wsId, repo, role, members, labels, onCancel, onCreated }) {
  return (
    <div className="space-y-3">
      <Btn size="sm" variant="ghost" onClick={onCancel}><ArrowLeft className="w-4 h-4" />Issues</Btn>
      <h3 className="font-bold text-slate-900">New issue</h3>
      <IssueForm members={members} labels={labels} triage={can(role, 'write')} submitLabel="Submit issue" onCancel={onCancel}
        onSubmit={async (data) => {
          const issue = await api.createIssue(wsId, repo.id, data);
          notify(`Opened issue #${issue.number}`, 'success');
          onCreated(issue.number);
        }} />
    </div>
  );
}

export default function IssuesTab({ wsId, repo, onOpen, onNew, onLabels }) {
  const [state, setState] = useState('open');
  const [label, setLabel] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.listIssues(wsId, repo.id, { state, label, q: query, page }).then((d) => {
      setData(d);
      onLabels?.(d.labels);
    }).catch((e) => notify(e.message, 'error'));
  }, [wsId, repo.id, state, label, query, page]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg" role="tablist">
          {[['open', data?.open_count], ['closed', data?.closed_count], ['all']].map(([s, n]) => (
            <button key={s} type="button" role="tab" aria-selected={state === s} onClick={() => { setState(s); setPage(1); }}
              className={`px-3 py-1 rounded-md text-xs font-semibold capitalize ${state === s ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'}`}>{s}{n != null ? ` ${n}` : ''}</button>
          ))}
        </div>
        <select aria-label="Filter by label" className={`${inputClass} w-auto py-1.5`} value={label} onChange={(e) => { setLabel(e.target.value); setPage(1); }}>
          <option value="">All labels</option>
          {(data?.labels || []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <form className="relative flex-1 min-w-[10rem]" onSubmit={(e) => { e.preventDefault(); setQuery(q); setPage(1); }} role="search">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          <input aria-label="Search issues" className={`${inputClass} pl-8 py-1.5`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issues" />
        </form>
        <Btn size="sm" variant="success" onClick={onNew}><CircleDot className="w-4 h-4" />New issue</Btn>
      </div>
      {!data ? <Spinner /> : data.issues.length === 0 ? (
        <Panel><Empty icon={CircleDot} title="No issues match">Issues track bugs, ideas and work for this repository.</Empty></Panel>
      ) : (
        <Panel className="divide-y divide-slate-100" data-testid="issue-list">
          {data.issues.map((i) => (
            <button key={i.id} type="button" onClick={() => onOpen(i.number)} className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
              <IssueState state={i.state} />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-slate-900 break-words mr-1">{i.title}</span>
                <span className="inline-flex flex-wrap gap-1 align-middle"><Labels labels={i.labels} /></span>
                <span className="block text-xs text-slate-500">#{i.number} by {i.author?.name || 'someone'} · {timeAgo(i.created_at)}{i.milestone ? ` · ${i.milestone}` : ''}</span>
              </span>
              <span className="flex flex-col items-end gap-1 shrink-0">
                {i.priority !== 'medium' && <Badge tone={PRIORITY_TONE[i.priority]}>{i.priority}</Badge>}
                {i.assignee && <span className="text-xs text-slate-500">{i.assignee.name}</span>}
                {i.comment_count > 0 && <span className="text-xs text-slate-500 flex items-center gap-1"><MessageSquare className="w-3 h-3" />{i.comment_count}</span>}
              </span>
            </button>
          ))}
        </Panel>
      )}
      {data && (page > 1 || data.has_more) && (
        <div className="flex justify-center gap-2">
          <Btn size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Btn>
          <Btn size="sm" disabled={!data.has_more} onClick={() => setPage(page + 1)}>Next</Btn>
        </div>
      )}
    </div>
  );
}
