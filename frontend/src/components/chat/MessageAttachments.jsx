import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, Eye, ImageOff, Loader2, Lock, X } from 'lucide-react';
import { api } from '../../api';
import { useDialog } from '../../lib/dialog';
import { fileKind, formatSize, typeLabel } from '../../lib/chatAttachments';
import { notify } from '../../context/ToastContext';
import { KindIcon } from './AttachmentComposer';

// Only these types are handed to the browser to render; nothing is ever shown as HTML/SVG.
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
const imageType = (name) => IMAGE_TYPES[name.toLowerCase().split('.').pop()];

/** Loads an attachment's bytes once, as an object URL of a safe type. */
function useAttachmentUrl(base, attachment, type, enabled = true) {
  const [state, setState] = useState({ status: 'idle' });
  useEffect(() => {
    if (!enabled || !attachment.available) return undefined;
    let url = null;
    let cancelled = false;
    setState({ status: 'loading' });
    api.fetchAttachmentBlob(base, attachment.id, type).then(
      (blob) => {
        url = URL.createObjectURL(blob);
        if (!cancelled) setState({ status: 'ready', url });
      },
      (err) => !cancelled && setState({ status: 'error', message: err.message, denied: err.status === 403 }),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [base, attachment.id, attachment.available, type, enabled]);
  return state;
}

function Viewer({ title, onClose, children, actions }) {
  const ref = useDialog(true, onClose);
  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex flex-col" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col h-full outline-none"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
          <p className="font-semibold truncate min-w-0">{title}</p>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center p-2 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

function ImageAttachment({ base, attachment, tone }) {
  const type = imageType(attachment.name) || 'image/png';
  const state = useAttachmentUrl(base, attachment, type);
  const [open, setOpen] = useState(false);
  const dark = tone === 'dark';
  if (!attachment.available || state.status === 'error') {
    return <FileCard base={base} attachment={attachment} tone={tone} problem={state.message} denied={state.denied} />;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => state.url && setOpen(true)}
        className={`block rounded-xl overflow-hidden border ${dark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-100'} max-w-full`}
        aria-label={`Open image ${attachment.name}`}
      >
        {state.url ? (
          <img src={state.url} alt={attachment.name} className="max-h-60 max-w-full sm:max-w-xs object-contain" />
        ) : (
          <span className="w-48 h-32 flex items-center justify-center" role="status" aria-label={`Loading ${attachment.name}`}>
            <Loader2 className="w-5 h-5 animate-spin opacity-60" />
          </span>
        )}
      </button>
      {open && (
        <Viewer
          title={attachment.name}
          onClose={() => setOpen(false)}
          actions={<DownloadButton base={base} attachment={attachment} tone="dark" />}
        >
          <img src={state.url} alt={attachment.name} className="max-w-full max-h-full object-contain" />
        </Viewer>
      )}
    </>
  );
}

function DownloadButton({ base, attachment, tone }) {
  const [busy, setBusy] = useState(false);
  const dark = tone === 'dark';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.downloadAttachment(base, attachment.id, attachment.name);
        } catch (err) {
          notify(err.message, 'error');
        } finally {
          setBusy(false);
        }
      }}
      aria-label={`Download ${attachment.name}`}
      className={`p-2 rounded-lg ${dark ? 'hover:bg-white/10 text-white' : 'hover:bg-slate-100 text-slate-700'} disabled:opacity-50`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
    </button>
  );
}

function PdfViewer({ base, attachment, onClose }) {
  const state = useAttachmentUrl(base, attachment, 'application/pdf');
  return (
    <Viewer title={attachment.name} onClose={onClose} actions={<DownloadButton base={base} attachment={attachment} tone="dark" />}>
      {state.status === 'ready' && <iframe src={state.url} title={`Preview of ${attachment.name}`} className="w-full h-full rounded-lg bg-white" />}
      {state.status === 'loading' && <Loader2 className="w-6 h-6 animate-spin text-white" />}
      {state.status === 'error' && <p className="text-white text-sm max-w-md text-center" role="alert">{state.message}</p>}
    </Viewer>
  );
}

function FileCard({ base, attachment, tone, onOpenPage, problem, denied }) {
  const [preview, setPreview] = useState(false);
  const dark = tone === 'dark';
  const isPage = attachment.kind === 'document';
  const kind = fileKind(attachment.name, attachment.mime_type, isPage);
  const shared = attachment.kind !== 'upload';
  const unavailable = !attachment.available;
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-2.5 pr-1.5 w-full sm:w-80 max-w-full ${
        dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-900'
      } ${unavailable ? 'opacity-70' : ''}`}
      data-testid="attachment-card"
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${dark ? 'bg-slate-700' : 'bg-slate-100'}`}>
        {unavailable ? <ImageOff className="w-5 h-5 opacity-60" aria-hidden="true" /> : denied ? <Lock className="w-5 h-5 opacity-70" aria-hidden="true" /> : <KindIcon kind={kind} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold break-words leading-snug">{attachment.name}</p>
        <p className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          {unavailable
            ? 'No longer available: the original was deleted or moved'
            : problem || [isPage ? 'Page' : typeLabel(attachment.name, attachment.mime_type), formatSize(attachment.size), shared ? (isPage ? 'shared page' : 'shared from Files') : null]
                .filter(Boolean)
                .join(' · ')}
        </p>
      </div>
      {!unavailable && !denied && (
        <div className="flex items-center shrink-0">
          {isPage ? (
            <button
              type="button"
              onClick={() => onOpenPage?.(attachment)}
              className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-semibold ${dark ? 'hover:bg-white/10' : 'hover:bg-slate-100 text-indigo-700'}`}
            >
              <ExternalLink className="w-4 h-4" /> Open
            </button>
          ) : (
            <>
              {kind === 'pdf' && (
                <button type="button" onClick={() => setPreview(true)} aria-label={`Preview ${attachment.name}`}
                  className={`p-2 rounded-lg ${dark ? 'hover:bg-white/10' : 'hover:bg-slate-100 text-slate-700'}`}>
                  <Eye className="w-4 h-4" />
                </button>
              )}
              <DownloadButton base={base} attachment={attachment} tone={tone} />
            </>
          )}
        </div>
      )}
      {preview && <PdfViewer base={base} attachment={attachment} onClose={() => setPreview(false)} />}
    </div>
  );
}

/** Attachments of one message. `base` is the conversation's API path. */
export default function MessageAttachments({ attachments, base, tone = 'light', onOpenPage }) {
  if (!attachments?.length) return null;
  const images = attachments.filter((a) => a.kind !== 'document' && imageType(a.name));
  const others = attachments.filter((a) => !images.includes(a));
  return (
    <div className="mt-2 space-y-2 max-w-full" data-testid="message-attachments">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <ImageAttachment key={a.id} base={base} attachment={a} tone={tone} />
          ))}
        </div>
      )}
      {others.map((a) => (
        <FileCard key={a.id} base={base} attachment={a} tone={tone} onOpenPage={onOpenPage} />
      ))}
    </div>
  );
}
