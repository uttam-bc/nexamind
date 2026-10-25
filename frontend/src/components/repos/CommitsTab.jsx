import React, { useEffect, useState } from 'react';
import { ArrowLeft, Copy, FolderTree, GitCommit } from 'lucide-react';
import { api } from '../../api';
import { notify } from '../../context/ToastContext';
import DiffView from './DiffView';
import { Avatar, Btn, Empty, Panel, Spinner } from './ui';
import { timeAgo } from './repoUtils';

/** Turns "#12" in commit messages into links to that issue or pull request. */
export function LinkedText({ text, onRef }) {
  const parts = (text || '').split(/(#\d+)/g);
  return parts.map((part, i) => (/^#\d+$/.test(part) && onRef ? (
    <button key={i} type="button" className="text-indigo-700 hover:underline" onClick={() => onRef(Number(part.slice(1)))}>{part}</button>
  ) : <React.Fragment key={i}>{part}</React.Fragment>));
}

export function CommitDetail({ wsId, repo, sha, onBack, onBrowse, onRef }) {
  const [commit, setCommit] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setCommit(null);
    api.repoCommit(wsId, repo.id, sha).then(setCommit).catch((e) => setError(e.message));
  }, [wsId, repo.id, sha]);
  if (error) return <Panel className="p-4 text-sm text-rose-700" role="alert">{error}</Panel>;
  if (!commit) return <Spinner />;
  return (
    <div className="space-y-3">
      <Btn size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4" />Commits</Btn>
      <Panel className="p-4">
        <h3 className="font-bold text-slate-900 break-words"><LinkedText text={commit.subject} onRef={onRef} /></h3>
        {commit.body && <pre className="whitespace-pre-wrap text-sm text-slate-700 mt-2 font-sans"><LinkedText text={commit.body} onRef={onRef} /></pre>}
        <div className="flex flex-wrap items-center gap-2 mt-3 text-sm text-slate-600">
          <Avatar user={commit.author || { name: commit.author_name }} size={5} />
          <span className="font-semibold text-slate-800">{commit.author?.name || commit.author_name}</span>
          <span>committed {timeAgo(commit.committed_at)}</span>
          <span className="sm:ml-auto flex items-center gap-1 font-mono text-xs">
            {commit.parents.length > 1 && <span className="text-slate-500 mr-2">merge of {commit.parents.map((p) => p.slice(0, 7)).join(' + ')}</span>}
            {commit.sha}
            <button type="button" aria-label="Copy commit id" onClick={() => navigator.clipboard?.writeText(commit.sha).then(() => notify('Commit id copied', 'success'))} className="p-1 hover:bg-slate-100 rounded">
              <Copy className="w-3.5 h-3.5" />
            </button>
          </span>
          <Btn size="sm" onClick={() => onBrowse(commit.sha)}><FolderTree className="w-4 h-4" />Browse files</Btn>
        </div>
      </Panel>
      <DiffView diff={commit.diff} />
    </div>
  );
}

export default function CommitsTab({ wsId, repo, refName, onOpenCommit }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setPage(1);
  }, [refName]);
  useEffect(() => {
    setData(null);
    api.repoCommits(wsId, repo.id, { ref: refName, page }).then(setData).catch((e) => setError(e.message));
  }, [wsId, repo.id, refName, page]);

  if (error) return <Panel className="p-4 text-sm text-rose-700" role="alert">{error}</Panel>;
  if (!data) return <Spinner />;
  if (!data.commits.length) return <Panel><Empty icon={GitCommit} title="No commits yet" /></Panel>;
  // Group by day like GitHub's history.
  const groups = [];
  data.commits.forEach((c) => {
    const day = new Date(c.committed_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, commits: [] });
    groups[groups.length - 1].commits.push(c);
  });
  return (
    <div className="space-y-4" data-testid="commit-list">
      {groups.map((g) => (
        <section key={g.day}>
          <h3 className="text-xs font-semibold text-slate-500 mb-1.5">Commits on {g.day}</h3>
          <Panel className="divide-y divide-slate-100">
            {g.commits.map((c) => (
              <div key={c.sha} className="flex items-start gap-3 px-4 py-3">
                <Avatar user={c.author || { name: c.author_name }} />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpenCommit(c.sha)} className="font-semibold text-sm text-slate-900 hover:text-indigo-700 hover:underline text-left break-words">
                    {c.subject}
                  </button>
                  <p className="text-xs text-slate-500">{c.author?.name || c.author_name} committed {timeAgo(c.committed_at)}</p>
                </div>
                <button type="button" onClick={() => onOpenCommit(c.sha)} className="font-mono text-xs text-slate-600 border border-slate-200 rounded px-2 py-1 hover:bg-slate-50 shrink-0">
                  {c.short_sha}
                </button>
              </div>
            ))}
          </Panel>
        </section>
      ))}
      <div className="flex justify-center gap-2">
        <Btn size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</Btn>
        <Btn size="sm" disabled={!data.has_more} onClick={() => setPage(page + 1)}>Older</Btn>
      </div>
    </div>
  );
}
