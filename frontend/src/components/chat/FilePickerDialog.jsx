import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, FolderOpen, Loader2, Search, X } from 'lucide-react';
import { api } from '../../api';
import { useDialog } from '../../lib/dialog';
import { fileKind, formatSize, typeLabel, MAX_ATTACHMENTS } from '../../lib/chatAttachments';
import { KindIcon } from './AttachmentComposer';

const FILTERS = [
  ['all', 'All'],
  ['page', 'Pages'],
  ['pdf', 'PDFs'],
  ['image', 'Images'],
  ['office', 'Office'],
  ['other', 'Other'],
];

function matchesFilter(entry, filter) {
  if (filter === 'all') return true;
  if (filter === 'office') return ['word', 'sheet', 'slides'].includes(entry.kind);
  if (filter === 'other') return !['page', 'pdf', 'image', 'word', 'sheet', 'slides'].includes(entry.kind);
  return entry.kind === filter;
}

/**
 * Pick existing workspace files and Docs pages to share in a chat (by reference, no copy).
 * Pages with sub-pages act as folders. A page made from an upload shares its original file.
 */
export default function FilePickerDialog({ workspaceId, onPick, onClose, limit = MAX_ATTACHMENTS }) {
  const ref = useDialog(true, onClose);
  const [state, setState] = useState({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [folder, setFolder] = useState(null); // page id whose children are shown
  const [picked, setPicked] = useState(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listDocuments(workspaceId), api.listFiles(workspaceId)]).then(
      ([docs, files]) => !cancelled && setState({ status: 'ready', docs: docs || [], files: files || [] }),
      (err) => !cancelled && setState({ status: 'error', message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const { entries, byId } = useMemo(() => {
    if (state.status !== 'ready') return { entries: [], byId: new Map() };
    const originals = new Map(state.files.filter((f) => f.document_id).map((f) => [f.document_id, f]));
    const childCount = new Map();
    state.docs.forEach((d) => d.parent_id && childCount.set(d.parent_id, (childCount.get(d.parent_id) || 0) + 1));
    const list = [
      ...state.docs.map((d) => {
        const original = originals.get(d.id);
        return {
          key: `doc:${d.id}`,
          id: d.id,
          parentId: d.parent_id || null,
          title: d.title,
          kind: original ? fileKind(original.filename, original.mime_type) : 'page',
          meta: original ? `${typeLabel(original.filename)} · ${formatSize(original.file_size)}` : 'Page',
          date: d.updated_at,
          children: childCount.get(d.id) || 0,
          share: original
            ? { source: 'file', refId: original.id, name: original.filename, mime: original.mime_type, size: original.file_size }
            : { source: 'document', refId: d.id, name: d.title, mime: 'text/markdown' },
        };
      }),
      ...state.files
        .filter((f) => !f.document_id)
        .map((f) => ({
          key: `file:${f.id}`,
          id: f.id,
          parentId: null,
          title: f.filename,
          kind: fileKind(f.filename, f.mime_type),
          meta: `${typeLabel(f.filename, f.mime_type)} · ${formatSize(f.file_size)}`,
          date: f.created_at,
          children: 0,
          share: { source: 'file', refId: f.id, name: f.filename, mime: f.mime_type, size: f.file_size },
        })),
    ];
    return { entries: list, byId: new Map(list.map((e) => [e.id, e])) };
  }, [state]);

  const searching = query.trim().length > 0;
  const visible = entries
    .filter((e) => (searching ? e.title.toLowerCase().includes(query.trim().toLowerCase()) : e.parentId === folder))
    .filter((e) => matchesFilter(e, filter))
    .sort((a, b) => (b.children > 0) - (a.children > 0) || new Date(b.date) - new Date(a.date));

  const crumbs = [];
  for (let id = folder; id; id = byId.get(id)?.parentId) crumbs.unshift(byId.get(id));

  const toggle = (entry) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(entry.key)) next.delete(entry.key);
      else if (next.size < limit) next.set(entry.key, entry.share);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-picker-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-white text-slate-900 w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[85vh] outline-none"
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 id="file-picker-title" className="font-bold">Share from Files & Docs</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 space-y-2 border-b border-slate-100">
          <label className="flex items-center gap-2 border border-slate-300 rounded-xl px-3 focus-within:border-indigo-500">
            <Search className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <input
              aria-label="Search files and pages"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files and pages"
              className="flex-1 min-w-0 py-2.5 text-sm outline-none bg-transparent"
              autoFocus
            />
          </label>
          <div className="flex gap-1 overflow-x-auto" role="group" aria-label="File type">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={filter === id}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border ${
                  filter === id ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {!searching && (
            <nav aria-label="Folder" className="flex items-center gap-1 text-xs text-slate-600 flex-wrap">
              <button type="button" onClick={() => setFolder(null)} className="font-semibold hover:text-indigo-600">
                All files
              </button>
              {crumbs.map((c) => (
                <React.Fragment key={c.id}>
                  <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  <button type="button" onClick={() => setFolder(c.id)} className="hover:text-indigo-600 truncate max-w-[10rem]">
                    {c.title}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-[12rem]">
          {state.status === 'loading' && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          )}
          {state.status === 'error' && <p className="p-6 text-sm text-rose-600" role="alert">{state.message}</p>}
          {state.status === 'ready' && visible.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">
              {searching ? 'Nothing matches your search.' : entries.length ? 'This folder is empty.' : 'No files or pages in this workspace yet.'}
            </p>
          )}
          <ul className="divide-y divide-slate-100">
            {visible.map((e) => {
              const selected = picked.has(e.key);
              return (
                <li key={e.key} className={`flex items-center gap-3 px-4 py-2.5 ${selected ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={`Select ${e.title}`}
                    onClick={() => toggle(e)}
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                      selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5" />}
                  </button>
                  <KindIcon kind={e.kind} />
                  <button type="button" onClick={() => toggle(e)} className="flex-1 min-w-0 text-left">
                    <span className="block text-sm font-medium break-words">{e.title}</span>
                    <span className="block text-xs text-slate-500">{e.meta}</span>
                  </button>
                  {e.children > 0 && !searching && (
                    <button
                      type="button"
                      onClick={() => setFolder(e.id)}
                      className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-indigo-600 shrink-0"
                      aria-label={`Open ${e.title} (${e.children} inside)`}
                    >
                      <FolderOpen className="w-4 h-4" /> {e.children}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="p-3 border-t border-slate-200 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {picked.size ? `${picked.size} selected` : 'Shared as links: nobody gets access they don’t already have.'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-sm font-semibold">
              Cancel
            </button>
            <button
              type="button"
              disabled={!picked.size}
              onClick={() => {
                onPick([...picked.values()]);
                onClose();
              }}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-40"
            >
              Attach {picked.size || ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
