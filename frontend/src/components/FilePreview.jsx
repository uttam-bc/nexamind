import React, { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { api } from '../api';
import FormattedChatMessage from './FormattedChatMessage';

// Only these types are ever handed to the browser to render from the file's bytes. Everything
// else (HTML, SVG, scripts) is shown as text or not at all.
const SAFE_IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
};

function blobType(kind, file) {
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'image') return SAFE_IMAGE_TYPES[file.filename.split('.').pop().toLowerCase()] || 'image/png';
  const mime = (file.mime_type || '').toLowerCase();
  if (kind === 'audio') return mime.startsWith('audio/') ? mime : 'audio/mpeg';
  if (kind === 'video') return mime.startsWith('video/') ? mime : 'video/mp4';
  return null;
}

// The page already has its own <h1>; headings inside a previewed file start at <h2>.
const demoteHeadings = (markdown) => markdown.replace(/^(#{1,5}) /gm, '#$1 ');

/** The file itself, rendered inside the app: PDF viewer, image, player, formatted Word/Markdown, or text. */
export default function FilePreview({ workspaceId, file }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setState({ status: 'loading' });
    (async () => {
      try {
        const info = await api.getFilePreview(workspaceId, file.id);
        const type = blobType(info.kind, file);
        if (type) {
          const blob = await api.fetchFileBlob(workspaceId, file.id, type);
          objectUrl = URL.createObjectURL(blob);
        }
        if (!cancelled) setState({ status: 'ready', kind: info.kind, text: info.text, url: objectUrl, reason: info.reason });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err.message });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspaceId, file.id]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-600" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Loading preview…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="py-12 text-center text-sm text-rose-700">
        Couldn't load the preview: {state.message}
      </div>
    );
  }

  const { kind, text, url, reason } = state;
  if (kind === 'pdf') {
    return <iframe src={url} title={`Preview of ${file.filename}`} className="w-full h-[65vh] rounded-xl border border-slate-200 bg-white" />;
  }
  if (kind === 'image') {
    return (
      <div className="flex justify-center bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:20px_20px] rounded-xl p-2">
        <img src={url} alt={file.filename} className="max-h-[65vh] max-w-full object-contain" />
      </div>
    );
  }
  if (kind === 'audio') return <audio controls src={url} className="w-full" aria-label={`Play ${file.filename}`} />;
  if (kind === 'video') return <video controls src={url} className="w-full max-h-[65vh] rounded-xl bg-black" aria-label={`Play ${file.filename}`} />;
  if (kind === 'markdown') {
    return (
      <article aria-label={`Preview of ${file.filename}`} className="prose-sm max-w-none bg-white rounded-xl border border-slate-200 p-6 max-h-[65vh] overflow-y-auto text-slate-900">
        {text?.trim() ? <FormattedChatMessage content={demoteHeadings(text)} isUser={false} /> : <p className="text-sm text-slate-600">This file is empty.</p>}
      </article>
    );
  }
  if (kind === 'code' || kind === 'text') {
    return (
      <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs font-mono overflow-auto max-h-[65vh] whitespace-pre-wrap break-words">
        {text}
      </pre>
    );
  }
  return (
    <div className="text-center space-y-2 py-12">
      <FileText className="w-14 h-14 text-slate-500 mx-auto" aria-hidden="true" />
      <p className="text-sm text-slate-700">
        {reason === 'too_large' ? 'This file is too large to preview here.' : "This file type can't be previewed in the browser."}
      </p>
      <p className="text-xs text-slate-600">Download it to open it on your device.</p>
    </div>
  );
}
