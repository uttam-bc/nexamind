// Files a person is about to send in a chat: uploads (with progress, cancel and retry) and shared
// references to existing library files/pages. One upload id per file is kept across retries, so a
// retried upload is stored once on the server.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { newId } from './meetingClient';

// Mirrors the server's allow-list (backend upload_utils.ALLOWED_CHAT_EXTENSIONS); the server decides.
export const CHAT_ACCEPT = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.log', '.xml',
  '.sql', '.py', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.go',
  '.rs', '.rb', '.php', '.swift', '.sh', '.ps1', '.html', '.css', '.scss', '.vue', '.svelte', '.dart', '.r', '.zip',
].join(',');
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 'image' | 'pdf' | 'word' | 'sheet' | 'slides' | 'code' | 'text' | 'archive' | 'page' | 'file' */
export function fileKind(name = '', mime = '', isPage = false) {
  if (isPage) return 'page';
  const ext = name.toLowerCase().split('.').pop();
  if (/^image\//.test(mime) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx'].includes(ext)) return 'slides';
  if (ext === 'zip') return 'archive';
  if (['txt', 'md', 'markdown', 'log'].includes(ext)) return 'text';
  if (CHAT_ACCEPT.split(',').includes(`.${ext}`)) return 'code';
  return 'file';
}

export function typeLabel(name = '', mime = '', isPage = false) {
  if (isPage) return 'Page';
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
  return ext || (mime || 'File');
}

function precheck(file) {
  const ext = `.${file.name.toLowerCase().split('.').pop()}`;
  if (!CHAT_ACCEPT.split(',').includes(ext)) return `${file.name}: this file type can't be sent in chat.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than ${formatSize(MAX_FILE_BYTES)}.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** Draft attachments for one composer. `base` is the conversation's API path. */
export function useAttachmentDraft(base) {
  const [items, setItems] = useState([]);
  const uploads = useRef(new Map()); // key -> { abort }
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = (key, changes) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...changes } : it)));

  const start = useCallback(
    (item) => {
      update(item.key, { status: 'uploading', progress: 0, error: null });
      const job = api.uploadChatAttachment(base, item.file, item.clientUploadId, (progress) => update(item.key, { progress }));
      uploads.current.set(item.key, job);
      job.promise.then(
        (stored) => {
          uploads.current.delete(item.key);
          update(item.key, { status: 'ready', progress: 100, id: stored.id, size: stored.size, mime: stored.mime_type });
        },
        (err) => {
          uploads.current.delete(item.key);
          if (err.aborted) return; // removed by the person
          update(item.key, { status: 'error', error: err.message });
        },
      );
    },
    [base],
  );

  /** Add files from a picker, drop or paste. Returns messages for files that were refused. */
  const addFiles = useCallback(
    (fileList) => {
      const refused = [];
      const room = MAX_ATTACHMENTS - itemsRef.current.length;
      const files = Array.from(fileList || []);
      if (files.length > room) refused.push(`At most ${MAX_ATTACHMENTS} files per message.`);
      const accepted = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const problem = precheck(file);
        if (problem) {
          refused.push(problem);
          continue;
        }
        accepted.push({
          key: newId(),
          source: 'upload',
          file,
          name: file.name,
          size: file.size,
          mime: file.type,
          clientUploadId: newId(),
          previewUrl: fileKind(file.name, file.type) === 'image' ? URL.createObjectURL(file) : null,
          status: 'queued',
          progress: 0,
        });
      }
      if (accepted.length) {
        setItems((prev) => [...prev, ...accepted]);
        accepted.forEach((item) => start(item));
      }
      return refused;
    },
    [start],
  );

  /** Add existing library files/pages (shared by reference, nothing uploaded). */
  const addShared = useCallback((refs) => {
    setItems((prev) => {
      const have = new Set(prev.map((p) => `${p.source}:${p.refId}`));
      const fresh = refs
        .filter((r) => !have.has(`${r.source}:${r.refId}`))
        .slice(0, MAX_ATTACHMENTS - prev.length)
        .map((r) => ({ ...r, key: newId(), status: 'ready' }));
      return [...prev, ...fresh];
    });
  }, []);

  const remove = useCallback((key) => {
    uploads.current.get(key)?.abort();
    uploads.current.delete(key);
    setItems((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }, []);

  const retry = useCallback(
    (key) => {
      const item = itemsRef.current.find((p) => p.key === key);
      if (item?.source === 'upload') start(item); // same clientUploadId: the server won't store it twice
    },
    [start],
  );

  /** Forget the sent items (previews stay valid until the message renders its own). */
  const clear = useCallback(() => {
    itemsRef.current.forEach((it) => it.previewUrl && setTimeout(() => URL.revokeObjectURL(it.previewUrl), 30000));
    setItems([]);
  }, []);

  // Leaving the conversation: stop uploads and free previews.
  useEffect(
    () => () => {
      uploads.current.forEach((job) => job.abort());
      itemsRef.current.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    },
    [],
  );

  const busy = items.some((it) => it.status === 'uploading' || it.status === 'queued');
  const failed = items.some((it) => it.status === 'error');
  const payload = () => ({
    attachment_ids: items.filter((it) => it.source === 'upload' && it.id).map((it) => it.id),
    shared_file_ids: items.filter((it) => it.source === 'file').map((it) => it.refId),
    shared_document_ids: items.filter((it) => it.source === 'document').map((it) => it.refId),
  });

  return { items, addFiles, addShared, remove, retry, clear, busy, failed, hasItems: items.length > 0, payload };
}
