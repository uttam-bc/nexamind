import React, { useEffect, useState } from 'react';
import { GitBranch, GitPullRequest, Shield, Tag, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog, notify } from '../../context/ToastContext';
import { Badge, Btn, Dialog, Empty, Field, inputClass, Panel, Spinner } from './ui';
import { can, timeAgo } from './repoUtils';

function NewBranchDialog({ wsId, repo, branches, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState(repo.default_branch);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Create a branch"
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!name.trim()} onClick={async () => {
        setBusy(true);
        try {
          await api.createBranch(wsId, repo.id, { name: name.trim(), source });
          notify(`Created branch ${name.trim()}`, 'success');
          onCreated(name.trim());
        } catch (err) {
          notify(err.message, 'error');
          setBusy(false);
        }
      }}>Create branch</Btn></>}
    >
      <div className="space-y-3">
        <Field label="Branch name"><input className={`${inputClass} font-mono`} value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/login" autoFocus /></Field>
        <Field label="Start from">
          <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
            {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}

function NewReleaseDialog({ wsId, repo, branches, onClose, onCreated }) {
  const [name, setName] = useState('v1.0.0');
  const [target, setTarget] = useState(repo.default_branch);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Create a release"
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!name.trim()} onClick={async () => {
        setBusy(true);
        try {
          await api.createTag(wsId, repo.id, { name: name.trim(), target, message });
          notify(`Released ${name.trim()}`, 'success');
          onCreated();
        } catch (err) {
          notify(err.message, 'error');
          setBusy(false);
        }
      }}>Publish release</Btn></>}
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">A release is an annotated Git tag on a commit, with notes.</p>
        <Field label="Tag"><input className={`${inputClass} font-mono`} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="From branch">
          <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
            {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Release notes"><textarea className={inputClass} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export default function BranchesTab({ wsId, repo, role, onOpenBranch, onStartPullRequest, onOpenPull, onChanged }) {
  const [branches, setBranches] = useState(null);
  const [tags, setTags] = useState([]);
  const [dialog, setDialog] = useState(null);
  const load = () => {
    api.repoBranches(wsId, repo.id).then(setBranches).catch((e) => notify(e.message, 'error'));
    api.repoTags(wsId, repo.id).then(setTags).catch(() => {});
  };
  useEffect(load, [wsId, repo.id]);

  const remove = async (b) => {
    if (!(await confirmDialog(`Delete branch "${b.name}"? Its commits stay reachable only if merged elsewhere.`, { title: 'Delete branch', confirmLabel: 'Delete' }))) return;
    try {
      await api.deleteBranch(wsId, repo.id, b.name);
      notify(`Deleted ${b.name}`, 'success');
      load();
      onChanged();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  if (!branches) return <Spinner />;
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-900">Branches <span className="text-slate-500 font-normal">({branches.length})</span></h3>
          {can(role, 'write') && <Btn size="sm" variant="primary" onClick={() => setDialog('branch')}><GitBranch className="w-4 h-4" />New branch</Btn>}
        </div>
        {branches.length === 0 ? <Panel><Empty icon={GitBranch} title="No branches yet">Commit a file or push to create the first branch.</Empty></Panel> : (
          <Panel className="divide-y divide-slate-100" data-testid="branch-list">
            {branches.map((b) => (
              <div key={b.name} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <button type="button" onClick={() => onOpenBranch(b.name)} className="font-mono text-sm font-semibold text-indigo-700 hover:underline break-all">{b.name}</button>
                {b.default && <Badge tone="indigo">default</Badge>}
                {b.protected && <Badge tone="amber"><Shield className="w-3 h-3" />protected</Badge>}
                <span className="text-xs text-slate-500 basis-full sm:basis-auto">Updated {timeAgo(b.updated_at)} by {b.author_name}</span>
                {!b.default && (
                  <span className="text-xs text-slate-600 sm:ml-auto" title={`Compared with ${repo.default_branch}`}>
                    {b.ahead} ahead · {b.behind} behind
                  </span>
                )}
                <span className={`flex gap-1 ${b.default ? 'sm:ml-auto' : ''}`}>
                  {b.pull_request ? (
                    <Btn size="sm" onClick={() => onOpenPull(b.pull_request.number)}><GitPullRequest className="w-4 h-4" />#{b.pull_request.number}</Btn>
                  ) : !b.default && b.ahead > 0 && can(role, 'write') ? (
                    <Btn size="sm" onClick={() => onStartPullRequest(b.name, repo.default_branch)}><GitPullRequest className="w-4 h-4" />New pull request</Btn>
                  ) : null}
                  {!b.default && !b.protected && can(role, 'write') && (
                    <Btn size="sm" variant="ghost" onClick={() => remove(b)} aria-label={`Delete branch ${b.name}`}><Trash2 className="w-4 h-4 text-rose-600" /></Btn>
                  )}
                </span>
              </div>
            ))}
          </Panel>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-900">Releases and tags <span className="text-slate-500 font-normal">({tags.length})</span></h3>
          {can(role, 'maintainer') && branches.length > 0 && <Btn size="sm" onClick={() => setDialog('release')}><Tag className="w-4 h-4" />New release</Btn>}
        </div>
        {tags.length === 0 ? <Panel><Empty icon={Tag} title="No releases yet" /></Panel> : (
          <Panel className="divide-y divide-slate-100">
            {tags.map((t) => (
              <div key={t.name} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag className="w-4 h-4 text-slate-500" />
                  <button type="button" onClick={() => onOpenBranch(t.name)} className="font-mono font-semibold text-indigo-700 hover:underline">{t.name}</button>
                  <span className="text-xs text-slate-500">{t.tagger ? `by ${t.tagger} · ` : ''}{timeAgo(t.date)}</span>
                  <span className="font-mono text-xs text-slate-500 ml-auto">{t.sha.slice(0, 7)}</span>
                </div>
                {t.message && t.message !== t.name && <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{t.message}</p>}
              </div>
            ))}
          </Panel>
        )}
      </section>

      {dialog === 'branch' && <NewBranchDialog wsId={wsId} repo={repo} branches={branches} onClose={() => setDialog(null)} onCreated={() => { setDialog(null); load(); onChanged(); }} />}
      {dialog === 'release' && <NewReleaseDialog wsId={wsId} repo={repo} branches={branches} onClose={() => setDialog(null)} onCreated={() => { setDialog(null); load(); onChanged(); }} />}
    </div>
  );
}
