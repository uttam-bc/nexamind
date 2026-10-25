import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, ArrowLeft, BookOpen, CircleDot, Code2, Copy, FilePlus, GitBranch, GitCommit, GitPullRequest, Loader2,
  Settings, Tag, Upload,
} from 'lucide-react';
import { api } from '../../api';
import { notify } from '../../context/ToastContext';
import MarkdownDocument from '../MarkdownDocument';
import BranchesTab from './BranchesTab';
import CloneDialog from './CloneDialog';
import CodeTab from './CodeTab';
import CommitsTab, { CommitDetail } from './CommitsTab';
import IssuesTab, { IssueDetail, NewIssue } from './IssuesTab';
import PullsTab, { NewPullRequest, PullRequestDetail } from './PullsTab';
import SettingsTab from './SettingsTab';
import { Avatar, Badge, Btn, Empty, Panel, Spinner, VisibilityBadge } from './ui';
import { can, formatBytes, timeAgo } from './repoUtils';

const TABS = [
  { id: 'code', label: 'Code', icon: Code2, views: ['code'] },
  { id: 'issues', label: 'Issues', icon: CircleDot, views: ['issues', 'issue', 'newissue'], count: 'open_issues' },
  { id: 'pulls', label: 'Pull requests', icon: GitPullRequest, views: ['pulls', 'pull', 'newpull'], count: 'open_pull_requests' },
  { id: 'commits', label: 'Commits', icon: GitCommit, views: ['commits', 'commit'] },
  { id: 'branches', label: 'Branches', icon: GitBranch, views: ['branches'] },
  { id: 'activity', label: 'Activity', icon: Activity, views: ['activity'] },
  { id: 'settings', label: 'Settings', icon: Settings, views: ['settings'], need: 'admin' },
];

function ActivityList({ events }) {
  if (!events) return <Spinner />;
  if (!events.length) return <Panel><Empty icon={Activity} title="No activity yet" /></Panel>;
  return (
    <Panel className="divide-y divide-slate-100" data-testid="repo-activity">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
          <Avatar user={e.actor || { name: '?' }} />
          <div className="min-w-0">
            <p className="text-slate-800 break-words">{e.summary}</p>
            {e.data?.commits?.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {e.data.commits.slice(0, 5).map((c) => (
                  <li key={c.sha} className="text-xs text-slate-500 truncate"><span className="font-mono">{c.sha.slice(0, 7)}</span> {c.subject}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">{e.repo ? `${e.repo.name} · ` : ''}{timeAgo(e.created_at)}</p>
          </div>
        </div>
      ))}
    </Panel>
  );
}
export { ActivityList };

function EmptyRepo({ repo, role, onNewFile, onUpload, onClone }) {
  return (
    <Panel className="p-5 space-y-4" data-testid="empty-repo">
      <div>
        <h3 className="font-bold text-slate-900">This repository is empty</h3>
        <p className="text-sm text-slate-600">Add a file here, or push an existing project from your computer.</p>
      </div>
      {can(role, 'write') && (
        <div className="flex flex-wrap gap-2">
          <Btn onClick={onNewFile}><FilePlus className="w-4 h-4" />Create a file</Btn>
          <Btn onClick={onUpload}><Upload className="w-4 h-4" />Upload files</Btn>
          <Btn onClick={onClone}><Copy className="w-4 h-4" />Clone URL and token</Btn>
        </div>
      )}
      <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto">{`cd your-project
git init -b ${repo.default_branch}
git add . && git commit -m "First commit"
git remote add origin ${repo.clone_url}
git push -u origin ${repo.default_branch}`}</pre>
    </Panel>
  );
}

export default function RepoView({ wsId, repoId, route, navigate, user, personal, onBack, onListChanged }) {
  const [repo, setRepo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [tags, setTags] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [events, setEvents] = useState(null);
  const [clone, setClone] = useState(false);
  const [error, setError] = useState('');
  const [codeAction, setCodeAction] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.getRepo(wsId, repoId);
      setRepo(r);
      setError('');
      if (r.status === 'ready') {
        api.repoBranches(wsId, repoId).then(setBranches).catch(() => {});
        api.repoTags(wsId, repoId).then(setTags).catch(() => {});
      }
      return r;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [wsId, repoId]);

  useEffect(() => {
    setRepo(null);
    load();
    api.getWorkspaceMembers(wsId).then((list) => setMembers(list.map((m) => ({ ...m, user_id: String(m.user_id) })))).catch(() => {});
  }, [wsId, repoId, load]);

  // An import runs in the background: check until it's ready or failed.
  useEffect(() => {
    if (repo?.status !== 'importing') return undefined;
    const timer = setInterval(async () => {
      const r = await load();
      if (r && r.status !== 'importing') onListChanged();
    }, 3000);
    return () => clearInterval(timer);
  }, [repo?.status, load, onListChanged]);

  useEffect(() => {
    if (route.view === 'activity') {
      setEvents(null);
      api.repoEvents(wsId, repoId).then(setEvents).catch((e) => notify(e.message, 'error'));
    }
  }, [route.view, wsId, repoId]);

  if (error) {
    return (
      <div className="space-y-3">
        <Btn size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4" />Repositories</Btn>
        <Panel className="p-4 text-sm text-rose-700" role="alert">{error}</Panel>
      </div>
    );
  }
  if (!repo) return <Spinner label="Opening repository" />;

  const refName = route.ref || repo.default_branch;
  const isBranch = branches.some((b) => b.name === refName) || (!branches.length && refName === repo.default_branch);
  const activeTab = TABS.find((t) => t.views.includes(route.view)) || TABS[0];
  const changed = (branch) => {
    load();
    onListChanged();
    if (branch && !branches.some((b) => b.name === branch)) api.repoBranches(wsId, repoId).then(setBranches).catch(() => {});
  };
  // "#12" in a message is an issue or a pull request (they share numbers).
  const openRef = (number) => api.getIssue(wsId, repoId, number)
    .then(() => navigate({ view: 'issue', number }), () => navigate({ view: 'pull', number }));
  const openCommit = (sha) => navigate({ view: 'commit', sha });
  const startPr = (source, target) => navigate({ view: 'newpull', source, target: target || repo.default_branch });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Btn size="sm" variant="ghost" onClick={onBack} aria-label="All repositories"><ArrowLeft className="w-4 h-4" /></Btn>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex flex-wrap items-center gap-2 break-all">
            <BookOpen className="w-5 h-5 text-slate-500 shrink-0" />{repo.name}
            <VisibilityBadge repo={repo} personal={personal} />
            {repo.role && <Badge tone="indigo">{repo.role}</Badge>}
          </h2>
          {repo.description && <p className="text-sm text-slate-600 mt-0.5">{repo.description}</p>}
        </div>
        {repo.status === 'ready' && <Btn variant="primary" onClick={() => setClone(true)}><Code2 className="w-4 h-4" />Clone</Btn>}
      </div>

      {repo.status === 'importing' && (
        <Panel className="p-4 flex items-center gap-2 text-sm text-slate-700" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> Importing from {repo.imported_from}… This page updates when it's ready.
        </Panel>
      )}
      {repo.status === 'failed' && <Panel className="p-4 text-sm text-rose-700" role="alert">{repo.status_detail}</Panel>}

      {repo.status === 'ready' && (
        <>
          <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto -mx-1 px-1" aria-label="Repository sections">
            {TABS.filter((t) => !t.need || can(repo.role, t.need)).map((t) => {
              const Icon = t.icon;
              const on = t.id === activeTab.id;
              return (
                <button key={t.id} type="button" onClick={() => navigate({ view: t.id, number: null, sha: null }, true)} aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${on ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  <Icon className="w-4 h-4" />{t.label}
                  {t.count && repo[t.count] > 0 && <span className="bg-slate-200 text-slate-700 rounded-full px-1.5 text-[11px]">{repo[t.count]}</span>}
                </button>
              );
            })}
          </nav>

          {['code', 'commits'].includes(route.view) && !repo.empty && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <GitBranch className="w-4 h-4 text-slate-500" />
                <select aria-label="Branch or tag" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-mono bg-white max-w-[14rem]" value={refName}
                  onChange={(e) => navigate({ ref: e.target.value, path: route.view === 'code' ? route.path : '', kind: route.kind })}>
                  <optgroup label="Branches">{branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</optgroup>
                  {tags.length > 0 && <optgroup label="Tags">{tags.map((t) => <option key={`t-${t.name}`} value={t.name}>{t.name}</option>)}</optgroup>}
                  {!branches.some((b) => b.name === refName) && !tags.some((t) => t.name === refName) && <option value={refName}>{refName.slice(0, 12)}</option>}
                </select>
              </label>
              <span className="text-slate-500 flex items-center gap-3">
                <button type="button" className="hover:text-indigo-700" onClick={() => navigate({ view: 'branches' })}><GitBranch className="w-3.5 h-3.5 inline" /> {repo.branch_count}</button>
                <button type="button" className="hover:text-indigo-700" onClick={() => navigate({ view: 'branches' })}><Tag className="w-3.5 h-3.5 inline" /> {repo.tag_count}</button>
                <button type="button" className="hover:text-indigo-700" onClick={() => navigate({ view: 'commits' })}><GitCommit className="w-3.5 h-3.5 inline" /> {repo.commit_count} commits</button>
                <span className="hidden sm:inline">{formatBytes(repo.size_bytes)}</span>
              </span>
            </div>
          )}

          {route.view === 'code' && (repo.empty ? (
            codeAction ? (
              <CodeTab key={codeAction} wsId={wsId} repo={repo} role={repo.role} user={user} refName={refName} isBranch path="" kind="tree"
                navigate={navigate} onOpenCommit={openCommit} onChanged={changed} onStartPullRequest={startPr} initialAction={codeAction} onExit={() => setCodeAction(0)} />
            ) : (
              <EmptyRepo repo={repo} role={repo.role} onClone={() => setClone(true)} onNewFile={() => setCodeAction('new')} onUpload={() => setCodeAction('upload')} />
            )
          ) : (
            <>
              <CodeTab wsId={wsId} repo={repo} role={repo.role} user={user} refName={refName} isBranch={isBranch} path={route.path || ''} kind={route.kind || 'tree'}
                navigate={navigate} onOpenCommit={openCommit} onChanged={changed} onStartPullRequest={startPr} />
              {!route.path && route.kind !== 'blob' && repo.readme && refName === repo.default_branch && (
                <Panel className="overflow-hidden">
                  <p className="px-4 py-2.5 border-b border-slate-200 text-sm font-semibold flex items-center gap-1.5"><BookOpen className="w-4 h-4" />{repo.readme.path}</p>
                  <div className="p-5"><MarkdownDocument text={repo.readme.text} workspaceId={wsId} /></div>
                </Panel>
              )}
            </>
          ))}
          {route.view === 'commits' && <CommitsTab wsId={wsId} repo={repo} refName={refName} onOpenCommit={openCommit} />}
          {route.view === 'commit' && (
            <CommitDetail wsId={wsId} repo={repo} sha={route.sha} onBack={() => navigate({ view: 'commits', sha: null })} onRef={openRef}
              onBrowse={(sha) => navigate({ view: 'code', ref: sha, path: '', kind: 'tree' })} />
          )}
          {route.view === 'branches' && (
            <BranchesTab wsId={wsId} repo={repo} role={repo.role} onChanged={changed} onOpenBranch={(name) => navigate({ view: 'code', ref: name, path: '', kind: 'tree' })}
              onStartPullRequest={startPr} onOpenPull={(number) => navigate({ view: 'pull', number })} />
          )}
          {route.view === 'pulls' && <PullsTab wsId={wsId} repo={repo} role={repo.role} onOpen={(number) => navigate({ view: 'pull', number })} onNew={() => startPr('', repo.default_branch)} />}
          {route.view === 'newpull' && (
            <NewPullRequest wsId={wsId} repo={repo} user={user} members={members} initialSource={route.source} initialTarget={route.target}
              onCancel={() => navigate({ view: 'pulls' })} onCreated={(number) => { changed(); navigate({ view: 'pull', number }); }} />
          )}
          {route.view === 'pull' && (
            <PullRequestDetail wsId={wsId} repo={repo} role={repo.role} user={user} number={route.number} onBack={() => navigate({ view: 'pulls', number: null })}
              onOpenCommit={openCommit} onRef={openRef} onChanged={changed} />
          )}
          {route.view === 'issues' && <IssuesTab wsId={wsId} repo={repo} onLabels={setLabels} onOpen={(number) => navigate({ view: 'issue', number })} onNew={() => navigate({ view: 'newissue' })} />}
          {route.view === 'newissue' && (
            <NewIssue wsId={wsId} repo={repo} role={repo.role} members={members} labels={labels} onCancel={() => navigate({ view: 'issues' })}
              onCreated={(number) => { changed(); navigate({ view: 'issue', number }); }} />
          )}
          {route.view === 'issue' && (
            <IssueDetail wsId={wsId} repo={repo} role={repo.role} user={user} number={route.number} members={members} labels={labels}
              onBack={() => navigate({ view: 'issues', number: null })} onRef={openRef} />
          )}
          {route.view === 'activity' && <ActivityList events={events} />}
          {route.view === 'settings' && can(repo.role, 'admin') && (
            <SettingsTab wsId={wsId} repo={repo} personal={personal} members={members} branches={branches} onSaved={() => changed()} onDeleted={() => { onListChanged(); onBack(); }} />
          )}
        </>
      )}
      {clone && <CloneDialog repo={repo} onClose={() => setClone(false)} />}
    </div>
  );
}
