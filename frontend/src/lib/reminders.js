import { api } from '../api';

// Reminder detection may call the AI model, so results are shared between the Calendar panel
// and the reminder toast, reused for a few minutes, and concurrent requests are merged.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // workspaceId -> { at, reminders }
const inFlight = new Map(); // workspaceId -> Promise

export async function getDetectedReminders(workspaceId, { force = false } = {}) {
  if (!workspaceId) return [];
  const hit = cache.get(workspaceId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.reminders;
  if (inFlight.has(workspaceId)) return inFlight.get(workspaceId);
  const promise = api
    .detectReminders(workspaceId)
    .then((res) => {
      const reminders = Array.isArray(res?.reminders) ? res.reminders : [];
      cache.set(workspaceId, { at: Date.now(), reminders });
      return reminders;
    })
    .finally(() => inFlight.delete(workspaceId));
  inFlight.set(workspaceId, promise);
  return promise;
}

export function forgetReminder(workspaceId, reminderId) {
  const hit = cache.get(workspaceId);
  if (hit) cache.set(workspaceId, { ...hit, reminders: hit.reminders.filter((r) => r.id !== reminderId) });
}

export function clearReminderCache() {
  cache.clear();
}
