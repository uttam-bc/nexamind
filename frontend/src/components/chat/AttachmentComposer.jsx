import React, { useEffect, useRef, useState } from 'react';
import {
  File as FileIcon,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  Presentation,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { CHAT_ACCEPT, fileKind, formatSize, typeLabel } from '../../lib/chatAttachments';

const ICONS = {
  image: FileImage, pdf: FileText, word: FileText, sheet: FileSpreadsheet, slides: Presentation,
  code: FileCode2, text: FileText, archive: FileArchive, page: FileText, file: FileIcon,
};
export const ICON_TONES = {
  image: 'text-emerald-600', pdf: 'text-rose-600', word: 'text-blue-600', sheet: 'text-green-700',
  slides: 'text-orange-600', code: 'text-violet-600', text: 'text-slate-600', archive: 'text-amber-700',
  page: 'text-indigo-600', file: 'text-slate-600',
};

export function KindIcon({ kind, className = 'w-5 h-5' }) {
  const Icon = ICONS[kind] || FileIcon;
  return <Icon className={`${className} ${ICON_TONES[kind] || ''}`} aria-hidden="true" />;
}

/** The paperclip: upload from this device, or share something already in Files/Docs. */
export function AttachButton({ onFiles, onShareExisting, disabled = false, tone = 'light' }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const dark = tone === 'dark';
  const item = `w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left rounded-lg ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`;
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Attach files"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`w-11 h-11 rounded-xl flex items-center justify-center transition disabled:opacity-40 ${
          dark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
        }`}
      >
        <Paperclip className="w-5 h-5" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute bottom-full mb-2 left-0 z-30 w-56 p-1 rounded-xl shadow-xl border ${
            dark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); inputRef.current?.click(); }}>
            <Upload className="w-4 h-4" /> Upload from this device
          </button>
          {onShareExisting && (
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onShareExisting(); }}>
              <FolderOpen className="w-4 h-4" /> Share from Files & Docs
            </button>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={CHAT_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="chat-file-input"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Files waiting to be sent: thumbnail or icon, size, progress, cancel and retry. */
export function AttachmentTray({ draft, tone = 'light' }) {
  if (!draft.hasItems) return null;
  const dark = tone === 'dark';
  return (
    <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Files to send" data-testid="attachment-tray">
      {draft.items.map((it) => {
        const kind = fileKind(it.name, it.mime, it.source === 'document');
        return (
          <li
            key={it.key}
            className={`relative shrink-0 w-44 rounded-xl border p-2 flex gap-2 items-center ${
              it.status === 'error'
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-800'
            }`}
          >
            {it.previewUrl ? (
              <img src={it.previewUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
            ) : (
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${dark ? 'bg-slate-700' : 'bg-slate-100'}`}>
                <KindIcon kind={kind} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" title={it.name}>{it.name}</p>
              <p className={`text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                {it.status === 'uploading' || it.status === 'queued'
                  ? `Uploading ${it.progress || 0}%`
                  : it.status === 'error'
                    ? 'Failed'
                    : it.source === 'upload'
                      ? formatSize(it.size)
                      : it.source === 'document' ? 'Page · shared' : `${typeLabel(it.name, it.mime)} · shared`}
              </p>
              {(it.status === 'uploading' || it.status === 'queued') && (
                <div className={`mt-1 h-1 rounded ${dark ? 'bg-slate-700' : 'bg-slate-200'}`}>
                  <div className="h-1 rounded bg-indigo-500 transition-[width]" style={{ width: `${it.progress || 0}%` }} />
                </div>
              )}
              {it.status === 'error' && (
                <p className="text-[11px] leading-tight line-clamp-2" title={it.error}>{it.error}</p>
              )}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button
                type="button"
                onClick={() => draft.remove(it.key)}
                aria-label={it.status === 'uploading' ? `Cancel uploading ${it.name}` : `Remove ${it.name}`}
                className={`p-1 rounded-md ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {it.status === 'error' && (
                <button type="button" onClick={() => draft.retry(it.key)} aria-label={`Retry ${it.name}`} className="p-1 rounded-md hover:bg-rose-100">
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              {it.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin opacity-60" aria-hidden="true" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Wraps a chat area so files can be dropped onto it. */
export function DropZone({ onFiles, children, className = '', disabled = false }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  return (
    <div
      className={`relative ${className}`}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!disabled && hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      {children}
      {over && (
        <div className="absolute inset-0 z-20 rounded-2xl border-2 border-dashed border-indigo-500 bg-indigo-50/80 flex items-center justify-center pointer-events-none">
          <p className="text-sm font-bold text-indigo-700">Drop files to attach them</p>
        </div>
      )}
    </div>
  );
}
