import { api } from '../../api';
import { DEFAULT_EXCLUDES, isExcluded, looksSecret } from './repoUtils';

const BATCH_FILES = 40;
const BATCH_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Turn picked/dropped files into reviewable entries: path, size, and whether they're excluded or flagged. */
export function prepareEntries(files, { stripRoot = true } = {}) {
  const list = Array.from(files).map((file) => ({ file, path: file.relativePath || file.webkitRelativePath || file.name }));
  const roots = new Set(list.map((e) => e.path.split('/')[0]));
  const strip = stripRoot && roots.size === 1 && list.every((e) => e.path.includes('/'));
  const root = strip ? [...roots][0] : '';
  return {
    root,
    entries: list.map(({ file, path }) => {
      const rel = strip ? path.split('/').slice(1).join('/') : path;
      return {
        file,
        path: rel,
        size: file.size,
        excluded: isExcluded(rel, DEFAULT_EXCLUDES),
        secret: looksSecret(rel),
        tooLarge: file.size > MAX_FILE_BYTES,
      };
    }).sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Read a dropped folder (DataTransfer items) into File objects with `relativePath`. */
export async function filesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []);
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      file.relativePath = `${prefix}${entry.name}`;
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}

/**
 * Upload entries in batches to a staging area; resolves with the upload id to commit.
 * `control.abort()` cancels the batch in flight. A failed batch can be retried by calling again
 * with the same `uploadId`: re-sent files replace their staged copy, so nothing is duplicated.
 */
export async function uploadEntries(workspaceId, entries, { onProgress, control, uploadId } = {}) {
  const id = uploadId || (await api.startRepoUpload(workspaceId)).upload_id;
  const total = entries.reduce((n, e) => n + e.size, 0) || 1;
  let sent = 0;
  let batch = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const size = batchBytes;
    const job = api.uploadRepoFiles(workspaceId, id, batch, (pct) => onProgress?.(Math.min(99, Math.round(((sent + (size * pct) / 100) / total) * 100))));
    if (control) control.abort = job.abort;
    await job.promise;
    sent += size;
    onProgress?.(Math.min(99, Math.round((sent / total) * 100)));
    batch = [];
    batchBytes = 0;
  };
  try {
    for (const entry of entries) {
      if (batch.length >= BATCH_FILES || (batchBytes + entry.size > BATCH_BYTES && batch.length)) await flush();
      batch.push({ file: entry.file, path: entry.path });
      batchBytes += entry.size;
    }
    await flush();
  } catch (err) {
    err.uploadId = id;
    throw err;
  }
  onProgress?.(100);
  return id;
}
