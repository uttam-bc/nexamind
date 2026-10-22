import React, { useMemo, useState } from 'react';
import {
  Download,
  Eye,
  File,
  FileText,
  Film,
  FolderOpen,
  Image,
  Loader2,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../api';
import { notify, confirmDialog } from '../context/ToastContext';
import FilePreview from './FilePreview';
import MarkdownDocument from './MarkdownDocument';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const MEDIA_RE = /\.(mp4|webm|mov|mp3|wav|m4a|ogg)$/i;

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function extensionOf(name) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name || '');
  return match ? match[1].toUpperCase() : '';
}

/** One library: every page (typed, imported or uploaded) once, plus images, media and other files. */
export function buildLibrary(documents = [], files = []) {
  const originals = new Map(files.filter((f) => f.document_id).map((f) => [f.document_id, f]));
  const pages = documents.map((doc) => ({
    key: `page-${doc.id}`,
    kind: 'page',
    title: doc.title,
    date: doc.updated_at || doc.created_at,
    doc,
    original: originals.get(doc.id) || null,
  }));
  const loose = files
    .filter((f) => !f.document_id)
    .map((f) => ({
      key: `file-${f.id}`,
      kind: IMAGE_RE.test(f.filename) ? 'image' : MEDIA_RE.test(f.filename) || /^(audio|video)\//.test(f.mime_type || '') ? 'media' : 'file',
      title: f.filename,
      date: f.created_at,
      file: f,
    }));
  return [...pages, ...loose].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function ItemIcon({ item }) {
  const cls = 'w-5 h-5';
  if (item.kind === 'page') return <FileText className={`${cls} text-indigo-600`} aria-hidden="true" />;
  if (item.kind === 'image') return <Image className={`${cls} text-emerald-600`} aria-hidden="true" />;
  if (item.kind === 'media') return <Film className={`${cls} text-purple-600`} aria-hidden="true" />;
  return <File className={`${cls} text-slate-600`} aria-hidden="true" />;
}

/** The page as it is now (fetched when opened, so edits by anyone, including the copilot, show). */
function PagePreview({ workspaceId, doc }) {
  const [state, setState] = useState({ status: 'loading' });
  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getDocument(workspaceId, doc.id)
      .then((full) => !cancelled && setState({ status: 'ready', text: full.content?.text || '' }))
      .catch((err) => !cancelled && setState({ status: 'error', message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, doc.id, doc.updated_at]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-600" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading page…
      </div>
    );
  }
  if (state.status === 'error') {
    return <p role="alert" className="py-12 text-center text-sm text-rose-700">Couldn't load the page: {state.message}</p>;
  }
  return (
    <article aria-label={`Preview of ${doc.title}`} className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 max-h-[62vh] overflow-y-auto">
      <MarkdownDocument text={state.text} workspaceId={workspaceId} emptyText="This page is empty." />
    </article>
  );
}

export default function FileManager({ workspaceId, filesList, documents, onRefreshFiles, onOpenDocument }) {
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all'); // 'all' | 'page' | 'image' | 'media' | 'file'

  const library = useMemo(() => buildLibrary(documents, filesList), [documents, filesList]);
  const visible = library.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesSearch && (activeCategory === 'all' || item.kind === activeCategory);
  });

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const stored = await api.uploadFile(workspaceId, fd);
      if (stored.document_id) notify(`"${file.name}" was added and can be edited in Pages.`, 'success');
      else if (stored.page_error) notify(`"${file.name}" was stored, but it couldn't be turned into an editable page: ${stored.page_error}`, 'info');
      else notify(`"${file.name}" was uploaded.`, 'success');
      await onRefreshFiles();
    } catch (err) {
      notify(`Upload failed: ${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (item) => {
    const what = item.kind === 'page' ? 'This page' : 'This file';
    const extra = item.kind === 'page' ? ' It is removed from Pages and Files, together with its original upload and sub-pages.' : '';
    if (!(await confirmDialog(`${what} will be deleted.${extra}`, { title: `Delete "${item.title}"?`, confirmLabel: 'Delete' }))) return;
    try {
      if (item.kind === 'page') await api.deleteDocument(workspaceId, item.doc.id);
      else await api.deleteFile(workspaceId, item.file.id);
      if (selected?.key === item.key) setSelected(null);
      await onRefreshFiles();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const downloadFile = (file) => run(() => api.downloadFile(workspaceId, file.id, file.filename));
  const exportPage = (doc, format) => run(() => api.exportDocument(workspaceId, doc.id, format, doc.title));

  const subtitle = (item) => {
    const date = item.date ? new Date(item.date).toLocaleDateString() : '';
    if (item.kind === 'page') {
      const source = item.original ? `from ${extensionOf(item.original.filename)} upload` : 'Page';
      return `${source} • edited ${date}`;
    }
    return `${formatFileSize(item.file.file_size)} • ${date}`;
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Files</h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Everything in Docs: pages, uploads and images. Word, PDF and Markdown uploads open as editable pages.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" aria-hidden="true" />
            <input
              aria-label="Search files and pages"
              type="text"
              placeholder="Search files and pages..."
              className="w-full bg-slate-100 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-indigo-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 cursor-pointer transition focus-within:ring-2 focus-within:ring-indigo-400">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            <span>{uploading ? 'Uploading…' : 'Upload File'}</span>
            <input type="file" className="sr-only" disabled={uploading} onChange={handleUpload} />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-slate-200 w-fit max-w-full overflow-x-auto" role="group" aria-label="Filter">
        {[
          { id: 'all', label: 'All' },
          { id: 'page', label: 'Pages & documents' },
          { id: 'image', label: 'Images' },
          { id: 'media', label: 'Media' },
          { id: 'file', label: 'Other files' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeCategory === tab.id}
            onClick={() => setActiveCategory(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
              activeCategory === tab.id ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 content-start gap-4 flex-1 overflow-y-auto min-h-0 pr-1">
        {visible.map((item) => (
          <div
            key={item.key}
            className="bg-white p-4 rounded-2xl border border-slate-200 hover:border-indigo-500/40 transition flex flex-col justify-between group space-y-3 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                <ItemIcon item={item} />
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                {item.kind === 'page' ? (
                  <button
                    type="button"
                    onClick={() => onOpenDocument?.(item.doc)}
                    className="p-1 text-slate-500 hover:text-indigo-600"
                    title="Edit in Pages"
                    aria-label={`Edit ${item.title} in Pages`}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => downloadFile(item.file)}
                    className="p-1 text-slate-500 hover:text-indigo-600"
                    title="Download"
                    aria-label={`Download ${item.title}`}
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  className="p-1 text-slate-500 hover:text-rose-600"
                  title="Delete"
                  aria-label={`Delete ${item.title}`}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div>
              <h2 className="font-bold text-xs text-slate-900 truncate" title={item.title}>
                {item.title}
              </h2>
              <div className="text-xs text-slate-600 mt-0.5">{subtitle(item)}</div>
            </div>

            <button
              type="button"
              onClick={() => setSelected(item)}
              className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 border border-slate-200 transition"
            >
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Preview</span>
            </button>
          </div>
        ))}

        {visible.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-600">
            <FolderOpen className="w-12 h-12 mb-3 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-semibold">
              {library.length === 0 ? 'Nothing here yet. Upload a file or create a page.' : 'Nothing matches this filter.'}
            </span>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 sm:p-6 z-50 animate-fade-in" onClick={() => setSelected(null)}>
          <div
            data-modal
            className="bg-white p-6 rounded-2xl border border-slate-300 max-w-4xl w-full space-y-4 max-h-[92vh] flex flex-col overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ItemIcon item={selected} />
                <h2 className="font-bold text-sm text-slate-900 truncate">{selected.title}</h2>
                {selected.kind === 'page' && (
                  <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5 shrink-0">
                    Latest saved version
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setSelected(null)} className="p-1 text-slate-500 hover:text-slate-900" aria-label="Close preview">
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 min-h-[220px] bg-slate-50 rounded-xl p-3 border border-slate-200">
              {selected.kind === 'page' ? (
                <PagePreview workspaceId={workspaceId} doc={selected.doc} />
              ) : (
                <FilePreview workspaceId={workspaceId} file={selected.file} />
              )}
            </div>

            {selected.kind !== 'page' && (
              <div className="grid grid-cols-3 gap-3 bg-white p-3 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-xs text-slate-600 uppercase font-bold block">Size</span>
                  <span className="font-bold text-slate-900">{formatFileSize(selected.file.file_size)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-600 uppercase font-bold block">Type</span>
                  <span className="text-slate-900 truncate block">{selected.file.mime_type || 'application/octet-stream'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-600 uppercase font-bold block">Uploaded</span>
                  <span className="text-slate-900">{new Date(selected.file.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {selected.kind === 'page' ? (
                <>
                  {selected.original && (
                    <button
                      type="button"
                      onClick={() => downloadFile(selected.original)}
                      disabled={busy}
                      className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-800 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-300 transition disabled:opacity-60"
                      title="The file as it was first uploaded, before any edits"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      Original ({extensionOf(selected.original.filename)})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => exportPage(selected.doc, 'md')}
                    disabled={busy}
                    className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-800 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-300 transition disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> Markdown
                  </button>
                  <button
                    type="button"
                    onClick={() => exportPage(selected.doc, 'docx')}
                    disabled={busy}
                    className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-800 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-300 transition disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> Word (.docx)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      onOpenDocument?.(selected.doc);
                    }}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit in Pages
                  </button>
                </>
              ) : (
                <>
                {/\.(docx|pdf|md|markdown|txt)$/i.test(selected.file.filename) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const doc = await api.fileToDocument(workspaceId, selected.file.id);
                        notify(`"${doc.title}" can now be edited in Pages.`, 'success');
                        setSelected(null);
                        await onRefreshFiles();
                        onOpenDocument?.(doc);
                      })
                    }
                    className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-800 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-300 transition disabled:opacity-60"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Make editable page
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => downloadFile(selected.file)}
                  disabled={busy}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download
                </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
