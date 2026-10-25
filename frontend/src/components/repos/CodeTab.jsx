import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, Download, Edit3, File, FileCode, FilePlus, Folder, FolderPlus, History, Image as ImageIcon, Link2,
  MoveRight, Search, Trash2, Upload,
} from 'lucide-react';
import { api } from '../../api';
import { confirmDialog, notify } from '../../context/ToastContext';
import MarkdownDocument from '../MarkdownDocument';
import CodeView from './CodeView';
import CommitDialog from './CommitDialog';
import { Avatar, Btn, Dialog, Empty, Field, inputClass, Panel, Spinner } from './ui';
import { can, formatBytes, joinPath, parentPath, repoLink, timeAgo } from './repoUtils';
import { prepareEntries, uploadEntries } from './uploads';

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const imageType = (path) => IMAGE_TYPES[path.split('.').pop().toLowerCase()];

function Breadcrumbs({ repo, path, onNavigate }) {
  const parts = path ? path.split('/') : [];
  return (
    <nav aria-label="Folder path" className="flex flex-wrap items-center gap-0.5 text-sm min-w-0">
      <button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => onNavigate('', 'tree')}>{repo.name}</button>
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5 min-w-0">
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {i === parts.length - 1 ? (
            <span className="font-semibold text-slate-900 break-all">{part}</span>
          ) : (
            <button type="button" className="text-indigo-700 hover:underline break-all" onClick={() => onNavigate(parts.slice(0, i + 1).join('/'), 'tree')}>
              {part}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function CommitLine({ commit, onOpenCommit }) {
  if (!commit) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm min-w-0">
      <Avatar user={commit.author || { name: commit.author_name }} size={5} />
      <span className="font-semibold text-slate-800 shrink-0">{commit.author?.name || commit.author_name}</span>
      <button type="button" onClick={() => onOpenCommit(commit.sha)} className="truncate text-slate-600 hover:text-indigo-700 hover:underline min-w-0 text-left">
        {commit.subject}
      </button>
      <span className="ml-auto flex items-center gap-2 shrink-0 text-xs text-slate-500">
        <button type="button" onClick={() => onOpenCommit(commit.sha)} className="font-mono hover:text-indigo-700">{commit.short_sha}</button>
        <span className="hidden sm:inline">{timeAgo(commit.committed_at)}</span>
      </span>
    </div>
  );
}

function ImagePreview({ wsId, repo, refName, path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl;
    api.fetchRepoRaw(wsId, repo.id, refName, path, imageType(path)).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [wsId, repo.id, refName, path]);
  return url ? <img src={url} alt={path} className="max-w-full max-h-[70vh] mx-auto p-4" /> : <Spinner label="Loading image" />;
}

/** Upload files or a folder into the current folder as one commit. */
function UploadDialog({ wsId, repo, branch, protectedBranch, directory, user, onDone, onClose }) {
  const [prepared, setPrepared] = useState(null);
  const [include, setInclude] = useState(new Set());
  const [progress, setProgress] = useState(null);
  const uploadId = useRef(null);
  const control = useRef({});
  const filesInput = useRef(null);
  const folderInput = useRef(null);
  const entries = prepared ? prepared.entries.filter((e) => !e.excluded && !e.tooLarge && (!e.secret || include.has(e.path))) : [];
  const flagged = prepared ? prepared.entries.filter((e) => e.secret && !e.excluded) : [];

  const pick = (files) => {
    setPrepared(prepareEntries(files, { stripRoot: false })); // a chosen folder keeps its name
    setInclude(new Set());
    uploadId.current = null;
  };

  const commit = async ({ message, newBranch, openPr }) => {
    setProgress(0);
    try {
      const id = await uploadEntries(wsId, entries, { onProgress: setProgress, control: control.current, uploadId: uploadId.current });
      uploadId.current = id;
      const result = await api.commitChanges(wsId, repo.id, {
        branch, message, new_branch: newBranch, upload_id: id, base_path: directory, include_flagged: [...include],
      });
      onDone(result, openPr);
    } catch (err) {
      if (err.uploadId) uploadId.current = err.uploadId;
      setProgress(null);
      throw err;
    }
  };

  if (prepared && entries.length) {
    return (
      <CommitDialog
        title={`Add ${entries.length} file${entries.length === 1 ? '' : 's'} to /${directory}`}
        branch={branch}
        protectedBranch={protectedBranch}
        userName={user?.name}
        defaultMessage={`Add ${entries.length === 1 ? entries[0].path.split('/').pop() : `${entries.length} files`}`}
        onCommit={commit}
        onClose={() => {
          control.current.abort?.();
          if (uploadId.current) api.discardRepoUpload(wsId, uploadId.current).catch(() => {});
          onClose();
        }}
        extra={
          <div className="space-y-2">
            <ul className="border border-slate-200 rounded-lg max-h-36 overflow-y-auto text-xs font-mono divide-y divide-slate-100">
              {entries.slice(0, 200).map((e) => <li key={e.path} className="px-3 py-1 flex justify-between gap-2"><span className="break-all">{e.path}</span><span className="text-slate-400">{formatBytes(e.size)}</span></li>)}
            </ul>
            {flagged.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Left out because they may hold secrets:
                {flagged.map((e) => (
                  <label key={e.path} className="flex items-center gap-2 font-mono mt-1">
                    <input type="checkbox" checked={include.has(e.path)} onChange={(ev) => {
                      const next = new Set(include);
                      if (ev.target.checked) next.add(e.path); else next.delete(e.path);
                      setInclude(next);
                    }} /> include {e.path}
                  </label>
                ))}
              </div>
            )}
            {progress !== null && <p className="text-xs text-slate-600" role="status">Uploading… {progress}%</p>}
          </div>
        }
      />
    );
  }
  return (
    <Dialog title={`Upload to /${directory}`} onClose={onClose}>
      <div
        className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files);
        }}
      >
        <Upload className="w-7 h-7 text-slate-400 mx-auto mb-2" />
        <p className="text-sm text-slate-700 mb-3">Drop files here, or choose them. They are committed as they are (no conversion).</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Btn onClick={() => filesInput.current?.click()}>Choose files</Btn>
          <Btn onClick={() => folderInput.current?.click()}>Choose a folder</Btn>
        </div>
        <input ref={filesInput} type="file" multiple className="hidden" data-testid="repo-files-input" onChange={(e) => pick(e.target.files)} />
        <input ref={folderInput} type="file" multiple webkitdirectory="" className="hidden" onChange={(e) => pick(e.target.files)} />
        {prepared && !entries.length && <p className="text-sm text-rose-700 mt-3">Nothing to add: every file was left out.</p>}
      </div>
    </Dialog>
  );
}

function PathDialog({ title, label, initial, confirm, onSubmit, onClose }) {
  const [value, setValue] = useState(initial);
  return (
    <Dialog title={title} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>{confirm}</Btn></>}>
      <Field label={label} hint="Use / to put it in a folder, e.g. src/utils/helpers.js">
        <input className={`${inputClass} font-mono`} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}

export default function CodeTab({ wsId, repo, role, user, refName, isBranch, path, kind, navigate, onOpenCommit, onChanged, onStartPullRequest, initialAction, onExit }) {
  const [tree, setTree] = useState(null);
  const [blob, setBlob] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { path, text, isNew }
  const [dialog, setDialog] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [reload, setReload] = useState(0);
  const writable = can(role, 'write') && isBranch;
  const protectedBranch = (repo.protected_branches || []).includes(refName);
  const directory = kind === 'blob' ? parentPath(path) : path;

  // An empty repository opens straight into "create a file" or "upload".
  useEffect(() => {
    if (initialAction === 'new') setEditing({ isNew: true, name: '', text: '' });
    if (initialAction === 'upload') setDialog({ type: 'upload' });
  }, [initialAction]);
  const leave = () => repo.empty && onExit?.();

  useEffect(() => {
    let cancelled = false;
    setError('');
    setHistory(null);
    if (repo.empty) return undefined;
    if (kind === 'blob') {
      setBlob(null);
      api.repoBlob(wsId, repo.id, refName, path).then((b) => !cancelled && setBlob(b)).catch((e) => !cancelled && setError(e.message));
    } else {
      setTree(null);
      api.repoTree(wsId, repo.id, refName, path).then((t) => !cancelled && setTree(t)).catch((e) => !cancelled && setError(e.message));
    }
    return () => {
      cancelled = true;
    };
  }, [wsId, repo.id, refName, path, kind, reload]);

  const readme = useMemo(() => tree?.entries.find((e) => e.type === 'blob' && /^readme(\.md|\.markdown|\.txt)?$/i.test(e.name)), [tree]);
  const [readmeText, setReadmeText] = useState(null);
  useEffect(() => {
    setReadmeText(null);
    if (!readme || !path) return; // the root README is shown on the overview
    api.repoBlob(wsId, repo.id, refName, readme.path).then((b) => setReadmeText(b.text)).catch(() => {});
  }, [readme, path, wsId, repo.id, refName]);

  const afterCommit = (result, openPr, nextPath, nextKind) => {
    notify(`Committed ${result.sha.slice(0, 7)} to ${result.branch}`, 'success');
    setDialog(null);
    setEditing(null);
    onChanged(result.branch);
    if (openPr && result.branch !== refName) {
      onStartPullRequest(result.branch, refName);
      return;
    }
    if (result.branch !== refName) navigate({ ref: result.branch, path: nextPath ?? path, kind: nextKind ?? kind });
    else if (nextPath !== undefined) navigate({ path: nextPath, kind: nextKind });
    else setReload((n) => n + 1);
  };

  const commitChanges = (changes, defaultMessage, nextPath, nextKind, expected = true) =>
    setDialog({
      type: 'commit',
      defaultMessage,
      run: async ({ message, newBranch, openPr }) => {
        const result = await api.commitChanges(wsId, repo.id, {
          branch: refName, message, changes, new_branch: newBranch,
          expected_head: expected ? (kind === 'blob' ? blob?.sha : tree?.sha) : undefined,
        });
        afterCommit(result, openPr, nextPath, nextKind);
      },
    });

  const runSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return setResults(null);
    try {
      setResults(await api.searchRepo(wsId, repo.id, query.trim(), refName));
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const showHistory = async () => {
    try {
      setHistory(await api.repoCommits(wsId, repo.id, { ref: refName, path }));
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const remove = async () => {
    const what = kind === 'blob' ? 'file' : 'folder';
    if (!(await confirmDialog(`Delete the ${what} "${path}" in a new commit? It stays in the history.`, { title: `Delete ${what}`, confirmLabel: 'Continue' }))) return;
    commitChanges([{ op: 'delete', path }], `Delete ${path}`, parentPath(path), 'tree');
  };

  if (editing) {
    return (
      <Panel className="flex flex-col min-h-[60vh]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200">
          {editing.isNew ? (
            <div className="flex items-center gap-1 flex-1 min-w-[12rem]">
              <span className="text-sm text-slate-500 font-mono">{directory ? `${directory}/` : ''}</span>
              <input
                aria-label="File name"
                className={`${inputClass} font-mono`}
                placeholder="name-your-file.js"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                autoFocus
              />
            </div>
          ) : (
            <span className="font-mono text-sm font-semibold break-all flex-1">Editing {editing.path}</span>
          )}
          <Btn onClick={() => { setEditing(null); leave(); }}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={editing.isNew ? !editing.name?.trim() : editing.text === editing.original}
            onClick={() => {
              const target = editing.isNew ? joinPath(directory, editing.name.trim()) : editing.path;
              commitChanges([{ op: 'put', path: target, content: editing.text }],
                editing.isNew ? `Create ${target.split('/').pop()}` : `Update ${target.split('/').pop()}`, target, 'blob', !editing.isNew);
            }}
          >
            Commit changes…
          </Btn>
        </div>
        <textarea
          aria-label="File contents"
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          spellCheck={false}
          className="flex-1 min-h-[55vh] w-full p-4 font-mono text-[13px] leading-5 text-slate-900 resize-none focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const { selectionStart: s, selectionEnd: end } = e.target;
              const text = `${editing.text.slice(0, s)}  ${editing.text.slice(end)}`;
              setEditing({ ...editing, text });
              requestAnimationFrame(() => e.target.setSelectionRange(s + 2, s + 2));
            }
          }}
        />
        {dialog?.type === 'commit' && (
          <CommitDialog branch={refName} protectedBranch={protectedBranch} userName={user?.name} defaultMessage={dialog.defaultMessage} onCommit={dialog.run} onClose={() => setDialog(null)} />
        )}
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Breadcrumbs repo={repo} path={path} onNavigate={(p, k) => navigate({ path: p, kind: k })} />
        <form onSubmit={runSearch} className="ml-auto flex items-center gap-1 w-full sm:w-auto" role="search">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input aria-label="Search code" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files and code" className={`${inputClass} pl-8 py-1.5`} />
          </div>
        </form>
        {writable && kind === 'tree' && (
          <div className="flex flex-wrap gap-1.5">
            <Btn size="sm" onClick={() => setEditing({ isNew: true, name: '', text: '' })}><FilePlus className="w-4 h-4" />New file</Btn>
            <Btn size="sm" onClick={() => setDialog({ type: 'folder' })}><FolderPlus className="w-4 h-4" />New folder</Btn>
            <Btn size="sm" onClick={() => setDialog({ type: 'upload' })}><Upload className="w-4 h-4" />Upload</Btn>
          </div>
        )}
        <Btn size="sm" onClick={() => api.downloadRepoArchive(wsId, repo.id, refName, `${repo.slug}-${refName}.zip`).catch((e) => notify(e.message, 'error'))}>
          <Download className="w-4 h-4" />ZIP
        </Btn>
      </div>
      {!isBranch && <p className="text-xs text-slate-500">You're viewing a tag or commit. Switch to a branch to make changes.</p>}

      {results && (
        <Panel className="p-3 space-y-2" data-testid="search-results">
          <div className="flex justify-between items-center">
            <p className="text-sm font-semibold">Results for “{query}”</p>
            <Btn size="sm" variant="ghost" onClick={() => setResults(null)}>Close</Btn>
          </div>
          {results.files.length === 0 && results.matches.length === 0 && <p className="text-sm text-slate-500">Nothing found.</p>}
          {results.files.map((f) => (
            <button key={f} type="button" className="block text-left text-sm font-mono text-indigo-700 hover:underline break-all" onClick={() => { setResults(null); navigate({ path: f, kind: 'blob' }); }}>{f}</button>
          ))}
          {results.matches.map((m, i) => (
            <button key={i} type="button" className="block w-full text-left text-xs font-mono hover:bg-slate-50 rounded p-1" onClick={() => { setResults(null); navigate({ path: m.path, kind: 'blob' }); }}>
              <span className="text-indigo-700">{m.path}:{m.line}</span> <span className="text-slate-700 break-all">{m.text}</span>
            </button>
          ))}
        </Panel>
      )}

      {error && <Panel className="p-4 text-sm text-rose-700" role="alert">{error}</Panel>}

      {kind === 'tree' && !error && (
        <Panel className="overflow-hidden">
          {!tree ? <Spinner /> : (
            <>
              <CommitLine commit={tree.last_commit} onOpenCommit={onOpenCommit} />
              <ul className="divide-y divide-slate-100" data-testid="repo-tree">
                {path && (
                  <li>
                    <button type="button" onClick={() => navigate({ path: parentPath(path), kind: 'tree' })} className="w-full text-left px-4 py-2.5 text-sm text-indigo-700 hover:bg-slate-50">..</button>
                  </li>
                )}
                {tree.entries.map((e) => (
                  <li key={e.path}>
                    <button
                      type="button"
                      onClick={() => e.type !== 'submodule' && navigate({ path: e.path, kind: e.type === 'tree' ? 'tree' : 'blob' })}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-left"
                    >
                      {e.type === 'tree' ? <Folder className="w-4 h-4 text-sky-600 fill-sky-100 shrink-0" />
                        : imageType(e.name) ? <ImageIcon className="w-4 h-4 text-slate-500 shrink-0" />
                          : <FileCode className="w-4 h-4 text-slate-500 shrink-0" />}
                      <span className="font-medium text-slate-800 break-all flex-1">{e.name}{e.type === 'submodule' ? ' (submodule)' : ''}</span>
                      {e.type === 'blob' && <span className="text-xs text-slate-400 shrink-0">{formatBytes(e.size)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {tree.entries.length === 0 && <Empty icon={Folder} title="This folder is empty" />}
            </>
          )}
        </Panel>
      )}
      {kind === 'tree' && path && readmeText && (
        <Panel className="p-5"><MarkdownDocument text={readmeText} workspaceId={wsId} /></Panel>
      )}

      {kind === 'blob' && !error && (
        <Panel className="overflow-hidden">
          {!blob ? <Spinner /> : (
            <>
              <CommitLine commit={blob.last_commit} onOpenCommit={onOpenCommit} />
              <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-slate-200">
                <span className="text-xs text-slate-500 mr-auto">
                  {blob.text != null ? `${blob.text.split('\n').length - (blob.text.endsWith('\n') ? 1 : 0)} lines · ` : ''}{formatBytes(blob.size)}
                </span>
                <Btn size="sm" variant="ghost" onClick={showHistory}><History className="w-4 h-4" />History</Btn>
                <Btn size="sm" variant="ghost" onClick={() => api.downloadRepoFile(wsId, repo.id, refName, path).catch((e) => notify(e.message, 'error'))}><Download className="w-4 h-4" />Download</Btn>
                <Btn size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(repoLink(repo.id, 'code', '') + `?ref=${encodeURIComponent(refName)}&path=${encodeURIComponent(path)}&kind=blob`).then(() => notify('Link copied', 'success'))}>
                  <Link2 className="w-4 h-4" />Link
                </Btn>
                {writable && blob.text != null && (
                  <Btn size="sm" variant="ghost" onClick={() => setEditing({ path, text: blob.text, original: blob.text })}><Edit3 className="w-4 h-4" />Edit</Btn>
                )}
                {writable && <Btn size="sm" variant="ghost" onClick={() => setDialog({ type: 'move' })}><MoveRight className="w-4 h-4" />Move</Btn>}
                {writable && <Btn size="sm" variant="ghost" onClick={remove}><Trash2 className="w-4 h-4 text-rose-600" />Delete</Btn>}
              </div>
              {history && (
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2" data-testid="file-history">
                  <p className="text-xs font-semibold text-slate-600 mb-1">History of {path}</p>
                  <ul className="space-y-1">
                    {history.commits.map((c) => (
                      <li key={c.sha} className="text-sm flex gap-2">
                        <button type="button" className="font-mono text-xs text-indigo-700" onClick={() => onOpenCommit(c.sha)}>{c.short_sha}</button>
                        <span className="truncate">{c.subject}</span>
                        <span className="ml-auto text-xs text-slate-500 shrink-0">{c.author?.name || c.author_name} · {timeAgo(c.committed_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {blob.text != null && /\.(md|markdown)$/i.test(path) ? (
                <div className="p-5"><MarkdownDocument text={blob.text} workspaceId={wsId} /></div>
              ) : blob.text != null ? (
                <CodeView text={blob.text} filename={path} />
              ) : imageType(path) && !blob.too_large ? (
                <ImagePreview wsId={wsId} repo={repo} refName={refName} path={path} />
              ) : (
                <Empty icon={File} title={blob.too_large ? 'This file is too large to show' : 'Binary file'}>Download it to open it on your device.</Empty>
              )}
            </>
          )}
        </Panel>
      )}
      {kind === 'tree' && writable && path && (
        <div className="flex justify-end">
          <Btn size="sm" variant="danger" onClick={remove}><Trash2 className="w-4 h-4" />Delete this folder</Btn>
        </div>
      )}

      {dialog?.type === 'commit' && (
        <CommitDialog branch={refName} protectedBranch={protectedBranch} userName={user?.name} defaultMessage={dialog.defaultMessage} onCommit={dialog.run} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'folder' && (
        <PathDialog
          title="New folder"
          label="Folder name"
          initial=""
          confirm="Continue"
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            const folder = joinPath(directory, name);
            // Git stores files, not folders: a .gitkeep placeholder keeps the empty folder.
            commitChanges([{ op: 'put', path: `${folder}/.gitkeep`, content: '' }], `Create folder ${folder}`, folder, 'tree', false);
          }}
        />
      )}
      {dialog?.type === 'move' && (
        <PathDialog
          title={`Move or rename ${path.split('/').pop()}`}
          label="New path"
          initial={path}
          confirm="Continue"
          onClose={() => setDialog(null)}
          onSubmit={(to) => commitChanges([{ op: 'move', path, to }], `Rename ${path.split('/').pop()} to ${to.split('/').pop()}`, to, kind)}
        />
      )}
      {dialog?.type === 'upload' && (
        <UploadDialog
          wsId={wsId} repo={repo} branch={refName} protectedBranch={protectedBranch} directory={directory} user={user}
          onClose={() => { setDialog(null); leave(); }}
          onDone={(result, openPr) => afterCommit(result, openPr, directory, 'tree')}
        />
      )}
    </div>
  );
}
