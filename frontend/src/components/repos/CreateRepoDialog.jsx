import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FolderUp, GitBranch, Globe, Lock, Plus } from 'lucide-react';
import { api } from '../../api';
import { notify } from '../../context/ToastContext';
import { Badge, Btn, Dialog, Field, inputClass } from './ui';
import { formatBytes } from './repoUtils';
import { filesFromDrop, prepareEntries, uploadEntries } from './uploads';

const MODES = [
  { id: 'new', label: 'New', icon: Plus },
  { id: 'folder', label: 'From folder', icon: FolderUp },
  { id: 'import', label: 'Import', icon: Globe },
];

function Visibility({ value, onChange }) {
  return (
    <fieldset className="grid sm:grid-cols-2 gap-2">
      <legend className="text-sm font-semibold text-slate-800 mb-1">Who can see it</legend>
      {[
        ['workspace', Globe, 'Workspace', 'Every workspace member can see it and push'],
        ['private', Lock, 'Private', 'Only you, admins and people you add'],
      ].map(([id, Icon, label, hint]) => (
        <label key={id} className={`flex gap-2 p-3 rounded-lg border cursor-pointer ${value === id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
          <input type="radio" name="visibility" className="mt-1" checked={value === id} onChange={() => onChange(id)} />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Icon className="w-4 h-4" />{label}</span>
            <span className="block text-xs text-slate-500">{hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Folder preview: what will be committed, what's left out and what looks like a secret. */
function FolderReview({ prepared, includeSecrets, setIncludeSecrets }) {
  const included = prepared.entries.filter((e) => !e.excluded && !e.tooLarge && (!e.secret || includeSecrets.has(e.path)));
  const excluded = prepared.entries.filter((e) => e.excluded);
  const secrets = prepared.entries.filter((e) => e.secret && !e.excluded);
  const large = prepared.entries.filter((e) => e.tooLarge && !e.excluded);
  return (
    <div className="space-y-3" data-testid="folder-review">
      <p className="text-sm text-slate-700">
        <strong>{included.length}</strong> file{included.length === 1 ? '' : 's'} ({formatBytes(included.reduce((n, e) => n + e.size, 0))}) will be
        committed. Your original files are not changed.
      </p>
      {secrets.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <AlertTriangle className="w-4 h-4" /> {secrets.length} file{secrets.length === 1 ? '' : 's'} may contain secrets
          </p>
          <p className="text-xs text-amber-800 mb-2">They are left out. Only include one if you're sure it holds no passwords or keys.</p>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {secrets.map((e) => (
              <li key={e.path}>
                <label className="flex items-center gap-2 text-xs font-mono text-amber-900 break-all">
                  <input
                    type="checkbox"
                    checked={includeSecrets.has(e.path)}
                    onChange={(ev) => {
                      const next = new Set(includeSecrets);
                      if (ev.target.checked) next.add(e.path);
                      else next.delete(e.path);
                      setIncludeSecrets(next);
                    }}
                  />
                  {e.path}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {large.length > 0 && (
        <p className="text-xs text-rose-700">Too large to add (over 25 MB): {large.map((e) => e.path).join(', ')}</p>
      )}
      {excluded.length > 0 && (
        <p className="text-xs text-slate-500">
          Left out: {excluded.length} file{excluded.length === 1 ? '' : 's'} in dependency, build or version-control folders
          (node_modules, .git, dist, build, venv…).
        </p>
      )}
      <ul className="border border-slate-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-slate-100 text-xs font-mono">
        {included.slice(0, 300).map((e) => (
          <li key={e.path} className="px-3 py-1.5 flex justify-between gap-3">
            <span className="break-all">{e.path}</span>
            <span className="text-slate-400 shrink-0">{formatBytes(e.size)}</span>
          </li>
        ))}
        {included.length > 300 && <li className="px-3 py-1.5 text-slate-500">…and {included.length - 300} more</li>}
      </ul>
    </div>
  );
}

export default function CreateRepoDialog({ workspaceId, personal = false, onClose, onCreated }) {
  const [mode, setMode] = useState('new');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('workspace');
  const [branch, setBranch] = useState('main');
  const [readme, setReadme] = useState(true);
  const [gitignore, setGitignore] = useState('');
  const [license, setLicense] = useState('');
  const [url, setUrl] = useState('');
  const [templates, setTemplates] = useState({ gitignore: [], licenses: [] });
  const [prepared, setPrepared] = useState(null);
  const [includeSecrets, setIncludeSecrets] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const control = useRef({});
  const uploadId = useRef(null);
  const folderInput = useRef(null);

  useEffect(() => {
    api.repoTemplates(workspaceId).then(setTemplates).catch(() => {});
  }, [workspaceId]);

  const toCommit = useMemo(
    () => (prepared ? prepared.entries.filter((e) => !e.excluded && !e.tooLarge && (!e.secret || includeSecrets.has(e.path))) : []),
    [prepared, includeSecrets],
  );

  const pickFolder = (files) => {
    const next = prepareEntries(files);
    if (!next.entries.length) return;
    setPrepared(next);
    setIncludeSecrets(new Set());
    uploadId.current = null;
    if (!name && next.root) setName(next.root);
  };

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      let repo;
      if (mode === 'import') {
        repo = await api.importRepo(workspaceId, { name, url, description, visibility });
        notify('Import started. The repository will be ready in a moment.', 'info');
      } else {
        let upload = null;
        if (mode === 'folder') {
          if (!toCommit.length) throw new Error('Choose a folder with at least one file to commit.');
          setProgress(0);
          upload = await uploadEntries(workspaceId, toCommit, { onProgress: setProgress, control: control.current, uploadId: uploadId.current });
          uploadId.current = upload;
        }
        repo = await api.createRepo(workspaceId, {
          name, description, visibility, default_branch: branch || 'main', readme, gitignore: gitignore || null,
          license: license || null, upload_id: upload, include_flagged: [...includeSecrets],
        });
        notify(`Created ${repo.name}`, 'success');
      }
      onCreated(repo);
    } catch (err) {
      if (err.uploadId) uploadId.current = err.uploadId; // retry continues the same upload
      if (err.aborted) setError('Upload cancelled. Nothing was created.');
      else if (err.data?.flagged) setError(`${err.message} ${err.data.flagged.map((f) => f.path).join(', ')}`);
      else setError(err.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const close = () => {
    if (busy) {
      control.current.abort?.();
      return;
    }
    if (uploadId.current) api.discardRepoUpload(workspaceId, uploadId.current).catch(() => {});
    onClose();
  };

  return (
    <Dialog
      title="Create a repository"
      onClose={close}
      wide={mode === 'folder'}
      footer={
        <>
          <Btn onClick={close}>{busy && progress !== null ? 'Cancel upload' : 'Cancel'}</Btn>
          <Btn variant="primary" busy={busy} disabled={!name.trim() || (mode === 'import' && !url.trim()) || (mode === 'folder' && !toCommit.length)} onClick={submit}>
            {mode === 'import' ? 'Import repository' : mode === 'folder' ? `Commit ${toCommit.length} file${toCommit.length === 1 ? '' : 's'}` : 'Create repository'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg" role="tablist" aria-label="How to start">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => !busy && setMode(id)}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-semibold ${mode === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'}`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {mode === 'folder' && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              pickFolder(await filesFromDrop(e.dataTransfer));
            }}
            className="border-2 border-dashed border-slate-300 rounded-xl p-5 text-center"
          >
            <FolderUp className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-700">Drop a project folder here, or</p>
            <Btn className="mt-2" onClick={() => folderInput.current?.click()} disabled={busy}>Choose a folder</Btn>
            <input
              ref={folderInput}
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              className="hidden"
              data-testid="repo-folder-input"
              onChange={(e) => {
                pickFolder(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
        {mode === 'folder' && prepared && <FolderReview prepared={prepared} includeSecrets={includeSecrets} setIncludeSecrets={setIncludeSecrets} />}

        <Field label="Repository name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="payments-api" autoFocus />
        </Field>
        {mode === 'import' && (
          <Field label="Clone URL" hint="A public https:// repository (GitHub, GitLab, Bitbucket…). Branches, tags and history are copied.">
            <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/project.git" />
          </Field>
        )}
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        {personal ? (
          <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            This is your personal workspace, so the repository is private to you. Create it in a team workspace to share it.
          </p>
        ) : (
          <Visibility value={visibility} onChange={setVisibility} />
        )}
        {mode !== 'import' && (
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Default branch">
              <div className="relative">
                <GitBranch className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                <input className={`${inputClass} pl-8`} value={branch} onChange={(e) => setBranch(e.target.value)} maxLength={200} />
              </div>
            </Field>
            <Field label=".gitignore">
              <select className={inputClass} value={gitignore} onChange={(e) => setGitignore(e.target.value)}>
                <option value="">None</option>
                {templates.gitignore.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="License">
              <select className={inputClass} value={license} onChange={(e) => setLicense(e.target.value)}>
                <option value="">None</option>
                {templates.licenses.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        {mode !== 'import' && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} />
            Add a README{mode === 'folder' ? ' (if the folder has none)' : ''}
          </label>
        )}
        {progress !== null && (
          <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <div className="flex justify-between text-xs text-slate-600 mb-1"><span>Uploading…</span><span>{progress}%</span></div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3" role="alert">
            {error} {uploadId.current && !busy && <Badge tone="amber">Press the button again to retry; uploaded files are kept.</Badge>}
          </p>
        )}
      </div>
    </Dialog>
  );
}
