import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, GitMerge, GitPullRequest, GitPullRequestClosed, Link2, MessageSquare,
} from 'lucide-react';
import { api } from '../../api';
import { notify } from '../../context/ToastContext';
import DiffView from './DiffView';
import { LinkedText } from './CommitsTab';
import { Avatar, Badge, Btn, Dialog, Empty, Field, inputClass, Panel, Spinner } from './ui';
import { can, repoLink, timeAgo } from './repoUtils';

const STATE = {
  open: { tone: 'green', icon: GitPullRequest, label: 'Open' },
  merged: { tone: 'purple', icon: GitMerge, label: 'Merged' },
  closed: { tone: 'red', icon: GitPullRequestClosed, label: 'Closed' },
};

export function StateBadge({ state }) {
  const s = STATE[state] || STATE.open;
  const Icon = s.icon;
  return <Badge tone={s.tone}><Icon className="w-3 h-3" />{s.label}</Badge>;
}

function MemberPicker({ members, selected, onChange, label }) {
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const on = selected.includes(m.user_id);
          return (
            <button key={m.user_id} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== m.user_id) : [...selected, m.user_id])}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-700'}`}>
              {on && <Check className="w-3 h-3" />}{m.name}
            </button>
          );
        })}
        {members.length === 0 && <span className="text-xs text-slate-500">No one else in this workspace yet.</span>}
      </div>
    </Field>
  );
}

export function NewPullRequest({ wsId, repo, user, members, initialSource, initialTarget, onCancel, onCreated }) {
  const [branches, setBranches] = useState([]);
  const [target, setTarget] = useState(initialTarget || repo.default_branch);
  const [source, setSource] = useState(initialSource || '');
  const [compare, setCompare] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reviewers, setReviewers] = useState([]);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.repoBranches(wsId, repo.id).then((list) => {
      setBranches(list);
      if (!initialSource) setSource(list.find((b) => !b.default)?.name || '');
    }).catch((e) => notify(e.message, 'error'));
  }, [wsId, repo.id, initialSource]);

  useEffect(() => {
    setCompare(null);
    if (!source || !target || source === target) return;
    api.compareRefs(wsId, repo.id, target, source).then((c) => {
      setCompare(c);
      setTitle((t) => t || (c.commits.length === 1 ? c.commits[0].subject : source.replace(/[-_/]+/g, ' ')));
    }).catch((e) => notify(e.message, 'error'));
  }, [wsId, repo.id, source, target]);

  const create = async () => {
    setBusy(true);
    try {
      const pr = await api.createPull(wsId, repo.id, { title, body, source_branch: source, target_branch: target, draft, reviewer_ids: reviewers });
      notify(`Opened pull request #${pr.number}`, 'success');
      onCreated(pr.number);
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Btn size="sm" variant="ghost" onClick={onCancel}><ArrowLeft className="w-4 h-4" />Pull requests</Btn>
      <Panel className="p-4 space-y-3">
        <h3 className="font-bold text-slate-900">Open a pull request</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">into
            <select aria-label="Target branch" className={`${inputClass} py-1.5 w-auto font-mono`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {branches.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          </label>
          <span className="text-slate-400">←</span>
          <label className="flex items-center gap-1">from
            <select aria-label="Source branch" className={`${inputClass} py-1.5 w-auto font-mono`} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">choose a branch</option>
              {branches.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          </label>
          {compare && (compare.mergeable
            ? <Badge tone="green"><Check className="w-3 h-3" />Can be merged</Badge>
            : <Badge tone="amber"><AlertTriangle className="w-3 h-3" />Conflicts: {compare.conflicts.join(', ')}</Badge>)}
        </div>
        {source === target && source && <p className="text-sm text-slate-500">Choose two different branches.</p>}
        {compare && compare.ahead === 0 && <p className="text-sm text-slate-600">{source} has nothing that isn't already in {target}.</p>}
        {compare && compare.ahead > 0 && (
          <>
            <Field label="Title"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} /></Field>
            <Field label="Description" hint="Write “Fixes #12” to close issue 12 when this is merged into the default branch.">
              <textarea className={inputClass} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <MemberPicker label="Reviewers" members={members.filter((m) => m.user_id !== user?.id)} selected={reviewers} onChange={setReviewers} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />Draft (not ready to merge)</label>
              <Btn variant="success" busy={busy} disabled={!title.trim()} onClick={create}><GitPullRequest className="w-4 h-4" />Create pull request</Btn>
            </div>
          </>
        )}
      </Panel>
      {compare && compare.ahead > 0 && (
        <>
          <p className="text-sm text-slate-600">{compare.ahead} commit{compare.ahead === 1 ? '' : 's'}: {compare.commits.map((c) => c.subject).slice(0, 5).join(' · ')}</p>
          <DiffView diff={compare.diff} />
        </>
      )}
    </div>
  );
}

function ReviewDialog({ onSubmit, onClose, own }) {
  const [state, setState] = useState('commented');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Review changes" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async () => {
      setBusy(true);
      try {
        await onSubmit({ state, body });
      } catch (err) {
        notify(err.message, 'error');
        setBusy(false);
      }
    }}>Submit review</Btn></>}>
      <div className="space-y-3">
        <textarea aria-label="Review summary" className={inputClass} rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Leave a summary" autoFocus />
        {[
          ['commented', 'Comment', 'General feedback without approving.'],
          ['approved', 'Approve', 'These changes can be merged.'],
          ['changes_requested', 'Request changes', 'Something must change before merging.'],
        ].map(([id, label, hint]) => (
          <label key={id} className={`flex gap-2 text-sm ${own && id !== 'commented' ? 'opacity-50' : ''}`}>
            <input type="radio" name="review" checked={state === id} disabled={own && id !== 'commented'} onChange={() => setState(id)} className="mt-1" />
            <span><span className="font-semibold">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
          </label>
        ))}
        {own && <p className="text-xs text-slate-500">You can't approve your own pull request.</p>}
      </div>
    </Dialog>
  );
}

function MergeBox({ pr, role, onMerge, onState }) {
  const s = pr.status;
  const [method, setMethod] = useState('merge');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  if (pr.state === 'merged') {
    return (
      <Panel className="p-4 border-violet-200 bg-violet-50 flex items-center gap-2 text-sm">
        <GitMerge className="w-5 h-5 text-violet-700" />
        <span>{pr.merged_by ? <strong>{pr.merged_by.name}</strong> : 'Someone'} merged this {timeAgo(pr.merged_at)}{pr.merge_method === 'push' ? ' by pushing it' : ''}.</span>
      </Panel>
    );
  }
  if (pr.state === 'closed') {
    return (
      <Panel className="p-4 flex flex-wrap items-center gap-2 text-sm">
        <GitPullRequestClosed className="w-5 h-5 text-rose-600" /> Closed without merging.
        {(pr.canEdit) && <Btn size="sm" className="ml-auto" onClick={() => onState('open')}>Reopen</Btn>}
      </Panel>
    );
  }
  return (
    <Panel className={`p-4 space-y-3 ${s.mergeable ? 'border-emerald-300' : 'border-amber-300'}`} data-testid="merge-box">
      <ul className="space-y-1.5 text-sm">
        <li className="flex items-center gap-2">
          {s.conflicts.length ? <AlertTriangle className="w-4 h-4 text-amber-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          {s.conflicts.length ? <>Conflicts in <span className="font-mono">{s.conflicts.join(', ')}</span>. Merge <code>{pr.target_branch}</code> into <code>{pr.source_branch}</code>, fix them and push.</> : 'No conflicts with the target branch'}
        </li>
        <li className="flex items-center gap-2">
          {s.approvals >= s.required_approvals && !s.changes_requested ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
          {s.approvals} approval{s.approvals === 1 ? '' : 's'} on the latest commit
          {s.required_approvals ? ` (${s.required_approvals} required)` : ''}
          {s.stale_approvals ? ` · ${s.stale_approvals} older approval${s.stale_approvals === 1 ? '' : 's'} before new commits` : ''}
          {s.changes_requested ? ` · ${s.changes_requested} requested changes` : ''}
        </li>
        <li className="text-xs text-slate-500">{s.ahead} commit{s.ahead === 1 ? '' : 's'} ahead, {s.behind} behind {pr.target_branch}</li>
      </ul>
      {s.blockers.length > 0 && <p className="text-sm text-amber-800" role="status">Can't merge yet: {s.blockers.join('; ')}.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {can(role, 'write') && (
          <>
            <select aria-label="Merge method" className={`${inputClass} w-auto py-1.5`} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="merge">Create a merge commit</option>
              <option value="squash">Squash and merge</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />Delete branch</label>
            <Btn variant="success" busy={busy} disabled={!s.mergeable} onClick={async () => {
              setBusy(true);
              try {
                await onMerge({ method, delete_branch: deleteBranch, expected_head: s.head_sha });
              } finally {
                setBusy(false);
              }
            }}><GitMerge className="w-4 h-4" />Merge pull request</Btn>
          </>
        )}
        {pr.canEdit && <Btn variant="ghost" className="ml-auto" onClick={() => onState('closed')}>Close</Btn>}
      </div>
    </Panel>
  );
}

function Timeline({ pr }) {
  const items = useMemo(() => [
    ...pr.reviews.map((r) => ({ ...r, kind: 'review' })),
    ...pr.comments.filter((c) => !c.path && !c.review_id).map((c) => ({ ...c, kind: 'comment' })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)), [pr]);
  const words = { approved: 'approved these changes', changes_requested: 'requested changes', commented: 'reviewed' };
  return items.map((item) => (
    <div key={`${item.kind}-${item.id}`} className="flex gap-3">
      <Avatar user={item.kind === 'review' ? item.reviewer : item.author} size={8} />
      <Panel className="flex-1 min-w-0 overflow-hidden">
        <div className={`px-3 py-2 text-xs border-b border-slate-100 flex flex-wrap items-center gap-1.5 ${item.state === 'approved' ? 'bg-emerald-50' : item.state === 'changes_requested' ? 'bg-rose-50' : 'bg-slate-50'}`}>
          <strong className="text-slate-800">{(item.kind === 'review' ? item.reviewer : item.author)?.name || 'Someone'}</strong>
          {item.kind === 'review' ? words[item.state] : 'commented'}
          <span className="text-slate-500">{timeAgo(item.created_at)}</span>
          {item.kind === 'review' && <span className="font-mono text-slate-400 ml-auto">{item.commit_sha.slice(0, 7)}</span>}
        </div>
        {item.body && <p className="px-3 py-2 text-sm whitespace-pre-wrap break-words text-slate-800">{item.body}</p>}
      </Panel>
    </div>
  ));
}

export function PullRequestDetail({ wsId, repo, role, user, number, onBack, onOpenCommit, onRef, onChanged }) {
  const [pr, setPr] = useState(null);
  const [tab, setTab] = useState('conversation');
  const [files, setFiles] = useState(null);
  const [commits, setCommits] = useState(null);
  const [comment, setComment] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.getPull(wsId, repo.id, number).then(setPr).catch((e) => setError(e.message));
  useEffect(() => {
    setPr(null);
    setFiles(null);
    setCommits(null);
    load();
  }, [wsId, repo.id, number]);
  useEffect(() => {
    if (tab === 'files' && !files) api.pullFiles(wsId, repo.id, number).then(setFiles).catch((e) => notify(e.message, 'error'));
    if (tab === 'commits' && !commits) api.pullCommits(wsId, repo.id, number).then(setCommits).catch((e) => notify(e.message, 'error'));
  }, [tab, files, commits, wsId, repo.id, number]);

  if (error) return <Panel className="p-4 text-sm text-rose-700" role="alert">{error}</Panel>;
  if (!pr) return <Spinner />;
  const canEdit = pr.author?.id === user?.id || can(role, 'maintainer');
  const view = { ...pr, canEdit };

  const refresh = () => {
    load();
    onChanged?.();
  };
  const postComment = async () => {
    try {
      await api.commentPull(wsId, repo.id, number, { body: comment });
      setComment('');
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      <Btn size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4" />Pull requests</Btn>
      <div>
        <h2 className="text-xl font-bold text-slate-900 break-words">{pr.title} <span className="text-slate-400 font-normal">#{pr.number}</span></h2>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-slate-600">
          <StateBadge state={pr.state} />
          {pr.draft && <Badge>Draft</Badge>}
          <span><strong className="text-slate-800">{pr.author?.name}</strong> {pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'proposed merging' : 'wants to merge'} into <code className="bg-indigo-50 text-indigo-800 px-1 rounded">{pr.target_branch}</code> from <code className="bg-indigo-50 text-indigo-800 px-1 rounded">{pr.source_branch}</code></span>
          <button type="button" className="ml-auto text-xs flex items-center gap-1 text-slate-500 hover:text-indigo-700" onClick={() => navigator.clipboard?.writeText(repoLink(repo.id, 'pulls', pr.number)).then(() => notify('Link copied. Paste it in a chat to share.', 'success'))}>
            <Link2 className="w-3.5 h-3.5" />Copy link
          </button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto" role="tablist">
        {[['conversation', 'Conversation'], ['commits', 'Commits'], ['files', 'Files changed']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500'}`}>{label}</button>
        ))}
        {pr.state === 'open' && can(role, 'read') && <Btn size="sm" variant="primary" className="ml-auto mb-1" onClick={() => setReviewing(true)}>Review</Btn>}
      </div>

      {tab === 'conversation' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <Avatar user={pr.author} size={8} />
            <Panel className="flex-1 p-3 text-sm whitespace-pre-wrap break-words text-slate-800">
              {pr.body ? <LinkedText text={pr.body} onRef={onRef} /> : <span className="text-slate-500">No description.</span>}
            </Panel>
          </div>
          <Timeline pr={pr} />
          <MergeBox pr={view} role={role} onState={async (state) => {
            try {
              await api.updatePull(wsId, repo.id, number, { state });
              refresh();
            } catch (err) {
              notify(err.message, 'error');
            }
          }} onMerge={async (data) => {
            try {
              const result = await api.mergePull(wsId, repo.id, number, data);
              notify(`Merged as ${result.sha.slice(0, 7)}`, 'success');
              refresh();
            } catch (err) {
              notify(err.message, 'error');
              load();
            }
          }} />
          <div className="space-y-2">
            <textarea aria-label="Add a comment" className={inputClass} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" />
            <div className="flex justify-end"><Btn variant="primary" disabled={!comment.trim()} onClick={postComment}><MessageSquare className="w-4 h-4" />Comment</Btn></div>
          </div>
        </div>
      )}
      {tab === 'commits' && (!commits ? <Spinner /> : (
        <Panel className="divide-y divide-slate-100">
          {commits.map((c) => (
            <button key={c.sha} type="button" onClick={() => onOpenCommit(c.sha)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
              <Avatar user={c.author || { name: c.author_name }} size={5} />
              <span className="text-sm truncate flex-1">{c.subject}</span>
              <span className="font-mono text-xs text-slate-500">{c.short_sha}</span>
            </button>
          ))}
          {commits.length === 0 && <Empty title="No commits to show" />}
        </Panel>
      ))}
      {tab === 'files' && (!files ? <Spinner /> : files.unavailable ? <Empty title="The branch of this pull request is gone" /> : (
        <DiffView
          diff={files}
          comments={pr.comments.filter((c) => c.path)}
          onComment={pr.state === 'open' ? async ({ path, line, side, body }) => {
            try {
              await api.commentPull(wsId, repo.id, number, { body, path, line, side });
              load();
            } catch (err) {
              notify(err.message, 'error');
              throw err;
            }
          } : undefined}
        />
      ))}
      {reviewing && (
        <ReviewDialog own={pr.author?.id === user?.id} onClose={() => setReviewing(false)} onSubmit={async (data) => {
          await api.reviewPull(wsId, repo.id, number, data);
          setReviewing(false);
          notify('Review submitted', 'success');
          load();
        }} />
      )}
    </div>
  );
}

export default function PullsTab({ wsId, repo, onOpen, onNew, role }) {
  const [state, setState] = useState('open');
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.listPulls(wsId, repo.id, state).then(setData).catch((e) => notify(e.message, 'error'));
  }, [wsId, repo.id, state]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg" role="tablist">
          {['open', 'merged', 'closed', 'all'].map((s) => (
            <button key={s} type="button" role="tab" aria-selected={state === s} onClick={() => setState(s)}
              className={`px-3 py-1 rounded-md text-xs font-semibold capitalize ${state === s ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'}`}>
              {s}{data && s !== 'all' ? ` ${data.counts[s]}` : ''}
            </button>
          ))}
        </div>
        {can(role, 'write') && <Btn size="sm" variant="success" className="ml-auto" onClick={onNew}><GitPullRequest className="w-4 h-4" />New pull request</Btn>}
      </div>
      {!data ? <Spinner /> : data.pull_requests.length === 0 ? (
        <Panel><Empty icon={GitPullRequest} title={`No ${state === 'all' ? '' : state} pull requests`}>Pull requests propose merging one branch into another, with review.</Empty></Panel>
      ) : (
        <Panel className="divide-y divide-slate-100" data-testid="pull-list">
          {data.pull_requests.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpen(p.number)} className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
              <StateBadge state={p.state} />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-slate-900 break-words">{p.title}</span>
                <span className="block text-xs text-slate-500">#{p.number} by {p.author?.name || 'someone'} · {p.source_branch} → {p.target_branch} · {timeAgo(p.created_at)}</span>
              </span>
              {p.draft && <Badge>Draft</Badge>}
            </button>
          ))}
        </Panel>
      )}
    </div>
  );
}
