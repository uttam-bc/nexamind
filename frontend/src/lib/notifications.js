// Notification list helpers (kept apart from the component so they load cheaply).

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Merge notifications by id, newest first. */
export function mergeNotifications(current, incoming) {
  const byId = new Map(current.map((n) => [n.id, n]));
  incoming.forEach((n) => byId.set(n.id, { ...byId.get(n.id), ...n }));
  return [...byId.values()].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
