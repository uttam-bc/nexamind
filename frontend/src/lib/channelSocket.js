// Live channel messages: one socket per open channel that reconnects with backoff, plus helpers
// to merge messages from the socket, REST pages and optimistic sends without duplicates.

import { openSocket } from '../api';

const DELAYS = [1000, 2000, 4000, 8000, 15000];

/** Merge by id (optimistic copies are matched by `client_key`), oldest first. */
export function mergeMessages(current, incoming) {
  const byId = new Map();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) {
    if (m.client_key) {
      for (const [id, existing] of byId) {
        if (existing.pending && existing.client_key === m.client_key) byId.delete(id);
      }
    }
    byId.set(m.id, { ...byId.get(m.id), ...m });
  }
  return [...byId.values()].sort((a, b) => {
    const t = (a.created_at || '').localeCompare(b.created_at || '');
    return t !== 0 ? t : String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Subscribe to a channel. `onEvent(payload)` gets every frame; `onResync()` runs after a
 * reconnect so the caller can fetch what it missed. Returns a function that disconnects.
 */
export function connectChannel(workspaceId, channelId, { onEvent, onResync, onStatus } = {}) {
  let ws = null;
  let attempt = 0;
  let timer = null;
  let stopped = false;
  let everOpen = false;

  const open = () => {
    ws = openSocket(`/ws/workspaces/${workspaceId}/channels/${channelId}`);
    ws.addEventListener('open', () => {
      onStatus?.('connected');
      if (everOpen) onResync?.();
      everOpen = true;
      attempt = 0;
    });
    ws.addEventListener('message', (event) => {
      try {
        onEvent?.(JSON.parse(event.data));
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.addEventListener('close', (event) => {
      if (stopped || event.code === 1008 || event.code === 4403 || event.code === 4404) return;
      onStatus?.('reconnecting');
      timer = setTimeout(open, DELAYS[Math.min(attempt, DELAYS.length - 1)]);
      attempt += 1;
    });
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
