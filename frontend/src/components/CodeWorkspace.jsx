import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BookOpen, CircleDot, Code2, GitPullRequest, Plus, Search } from 'lucide-react';
import { api } from '../api';
import { onDeepLink } from '../lib/deepLink';
import CreateRepoDialog from './repos/CreateRepoDialog';
import RepoView, { ActivityList } from './repos/RepoView';
import { Badge, Btn, Empty, inputClass, Panel, Spinner, VisibilityBadge } from './repos/ui';
import { timeAgo } from './repos/repoUtils';

// The open repository and view live in the URL hash (#/code/<repo>/<view>[/<number|sha>]?ref=&path=&kind=),
// so Back works and links can be shared in chat.
const DETAIL = { pulls: 'pull', issues: 'issue', commits: 'commit' };

export function parseRoute(hash = window.location.hash) {
  const [pathPart, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const segments = pathPart.split('/').map(decodeURIComponent);
  if (segments[0] !== 'code' || !segments[1]) return { repoId: null };
  const params = new URLSearchParams(query);
  let view = segments[2] || 'code';
  const arg = segments[3];
  const route = { repoId: segments[1], view, ref: params.get('ref') || '', path: params.get('path') || '', kind: params.get('kind') || 'tree' };
  if (arg && DETAIL[view]) {
    view = DETAIL[view];
    route.view = view;
    if (view === 'commit') route.sha = arg;
    else route.number = Number(arg);
  }
  if (view === 'newpull') {
    route.source = params.get('source') || '';
    route.target = params.get('target') || '';
  }
  return route;
}

export function routeHash(route) {
  if (!route.repoId) return '#/code';
  const back = { pull: 'pulls', issue: 'issues', commit: 'commits' }[route.view];
  let hash = `#/code/${route.repoId}/${back || route.view || 'code'}`;
  if (back) hash += `/${encodeURIComponent(route.view === 'commit' ? route.sha : route.number)}`;
  const params = new URLSearchParams();
  if (route.ref) params.set('ref', route.ref);
  if (route.view === 'code' && route.path) params.set('path', route.path);
  if (route.view === 'code' && route.kind === 'blob') params.set('kind', 'blob');
  if (route.view === 'newpull') {
    if (route.source) params.set('source', route.source);
    if (route.target) params.set('target', route.target);
  }
  const q = params.toString();
  return q ? `${hash}?${q}` : hash;
}

function RepoCard({ repo, personal, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(repo.id)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition">
      <div className="flex items-start gap-2">
        <BookOpen className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
        <span className="font-semibold text-indigo-700 break-all">{repo.name}</span>
        <span className="ml-auto shrink-0">
          <VisibilityBadge repo={repo} personal={personal} />
        </span>
      </div>
      {repo.description && <p className="text-sm text-slate-600 mt-1 line-clamp-2">{repo.description}</p>}
      <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-slate-500">
        {repo.status === 'importing' && <Badge tone="blue">Importing…</Badge>}
        {repo.status === 'failed' && <Badge tone="red">Import failed</Badge>}
        <span className="flex items-center gap-1"><CircleDot className="w-3.5 h-3.5" />{repo.open_issues}</span>
        <span className="flex items-center gap-1"><GitPullRequest className="w-3.5 h-3.5" />{repo.open_pull_requests}</span>
        <span>{repo.default_branch}</span>
        <span className="ml-auto">Updated {timeAgo(repo.pushed_at || repo.updated_at)}</span>
      </div>
    </button>
  );
}

export default function CodeWorkspace({ workspaceId, workspaceName, personal = false, user, onRefreshRepos }) {
  const [route, setRoute] = useState(() => parseRoute());
  const [repos, setRepos] = useState(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [activity, setActivity] = useState(null);

  const loadRepos = useCallback(() => {
    api.listRepos(workspaceId).then(setRepos).catch(() => setRepos([]));
    api.repoActivity(workspaceId, 15).then(setActivity).catch(() => setActivity([]));
  }, [workspaceId]);

  useEffect(() => {
    setRepos(null);
    loadRepos();
  }, [loadRepos]);

  useEffect(() => {
    const sync = () => setRoute(parseRoute());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const go = useCallback((next, replace = false) => {
    setRoute(next);
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  }, []);

  // Notification links: { tab: 'code', repo_id, pull | issue }.
  useEffect(() => onDeepLink('code', (link) => {
    if (!link.repo_id) return;
    if (link.pull) go({ repoId: link.repo_id, view: 'pull', number: Number(link.pull) });
    else if (link.issue) go({ repoId: link.repo_id, view: 'issue', number: Number(link.issue) });
    else go({ repoId: link.repo_id, view: 'code' });
  }), [go]);

  const listChanged = useCallback(() => {
    loadRepos();
    onRefreshRepos?.();
  }, [loadRepos, onRefreshRepos]);

  const navigate = useCallback((patch, replace = false) => {
    setRoute((current) => {
      const next = { ...current, ...patch };
      if (patch.view && patch.view !== 'code' && !('path' in patch)) next.path = '';
      const hash = routeHash(next);
      if (window.location.hash !== hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', hash);
      return next;
    });
  }, []);

  const filtered = useMemo(
    () => (repos || []).filter((r) => !query || `${r.name} ${r.description || ''}`.toLowerCase().includes(query.toLowerCase())),
    [repos, query],
  );

  if (!workspaceId) return null;
  if (route.repoId) {
    return (
      <div className="h-full overflow-y-auto pb-10">
        <RepoView key={route.repoId} wsId={workspaceId} repoId={route.repoId} route={route} navigate={navigate} user={user} personal={personal}
          onBack={() => go({ repoId: null })} onListChanged={listChanged} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-10 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Code2 className="w-5 h-5 text-indigo-600" />Repositories</h1>
          <p className="text-sm text-slate-500">
            {personal
              ? 'Your personal repositories: only you can see them. Switch to a team workspace to share code with others.'
              : `Repositories of ${workspaceName || 'this workspace'}. Members see workspace repositories; private ones only the people you add.`}
          </p>
        </div>
        <Btn variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />New repository</Btn>
      </div>
      <div className="grid lg:grid-cols-[1fr_20rem] gap-4 items-start">
        <div className="space-y-3 min-w-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input aria-label="Find a repository" className={`${inputClass} pl-9`} placeholder="Find a repository" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {!repos ? <Spinner /> : filtered.length === 0 ? (
            <Panel>
              <Empty icon={Code2} title={repos.length ? 'No repository matches' : 'No repositories yet'}
                action={!repos.length && <Btn variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />Create one</Btn>}>
                {!repos.length && 'Start empty, from a folder on your computer, or import a public Git repository.'}
              </Empty>
            </Panel>
          ) : (
            <div className="grid gap-3" data-testid="repo-list">
              {filtered.map((r) => <RepoCard key={r.id} repo={r} personal={personal} onOpen={(id) => go({ repoId: id, view: 'code' })} />)}
            </div>
          )}
        </div>
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Activity className="w-4 h-4" />Recent activity</h2>
          <ActivityList events={activity} />
        </aside>
      </div>
      {creating && (
        <CreateRepoDialog
          personal={personal}
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onCreated={(repo) => {
            setCreating(false);
            listChanged();
            go({ repoId: repo.id, view: 'code' });
          }}
        />
      )}
    </div>
  );
}
