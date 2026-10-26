import React, { useState, useEffect } from 'react';
import { Sparkles, Check } from 'lucide-react';
import { api } from '../api';
import { forgetReminder, getDetectedReminders } from '../lib/reminders';

// Detection can cost a model call, so it runs once per workspace and then at most every
// 10 minutes while the tab is visible (results are shared with the Calendar panel).
const RECHECK_MS = 10 * 60 * 1000;

const STORAGE_KEY = 'nexamind_dismissed_reminders_v2';

export default function AiReminderToast({
  workspaceId,
  onEventCreated,
  onNavigateCalendar,
}) {
  const [reminders, setReminders] = useState([]);
  const [currentReminder, setCurrentReminder] = useState(null);
  const [scheduling, setScheduling] = useState(false);

  // Helper to read dismissed IDs from localStorage
  const getDismissedSet = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (e) {
      console.warn('Could not read dismissed reminders', e);
    }
    return new Set();
  };

  // Helper to save dismissed IDs to localStorage
  const persistDismissedId = (id, title) => {
    const set = getDismissedSet();
    if (id) set.add(id);
    if (title) set.add(`title:${title}`);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn('Could not save dismissed reminders', e);
    }
  };

  // Check for reminders on mount / workspace change
  useEffect(() => {
    let isMounted = true;
    // A suggestion belongs to one workspace: drop the previous one at once when the workspace changes.
    setReminders([]);
    setCurrentReminder(null);
    const fetchReminders = async () => {
      if (!workspaceId) return;
      if (document.visibilityState === 'hidden') return;
      try {
        const found = await getDetectedReminders(workspaceId);
        if (isMounted) {
          const dismissed = getDismissedSet();
          const fresh = found.filter(
            (r) => !dismissed.has(r.id) && !dismissed.has(`title:${r.title}`)
          );
          setReminders(fresh);
          if (fresh.length > 0) {
            setCurrentReminder(fresh[0]);
          } else {
            setCurrentReminder(null);
          }
        }
      } catch (err) {
        // silent check
      }
    };

    fetchReminders();
    const interval = setInterval(fetchReminders, RECHECK_MS);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [workspaceId]);

  if (!currentReminder) return null;

  const handleDismiss = () => {
    if (currentReminder) {
      persistDismissedId(currentReminder.id, currentReminder.title);
      forgetReminder(workspaceId, currentReminder.id);
      const dismissed = getDismissedSet();
      const nextList = reminders.filter(
        (r) => !dismissed.has(r.id) && !dismissed.has(`title:${r.title}`)
      );
      setReminders(nextList);
      setCurrentReminder(nextList.length > 0 ? nextList[0] : null);
    }
  };

  const handleAccept = async () => {
    if (!currentReminder) return;
    setScheduling(true);
    try {
      await api.createCalendarEvent(workspaceId, {
        title: currentReminder.title,
        description: `Auto-scheduled by AI from: ${currentReminder.source_name} (${currentReminder.context_snippet})`,
        event_date: currentReminder.suggested_date,
        event_time: currentReminder.suggested_time || null, // no time was mentioned: don't invent one
        event_type: currentReminder.event_type || 'meeting',
        priority: currentReminder.priority || 'high',
        source: 'ai_detected',
      });

      persistDismissedId(currentReminder.id, currentReminder.title);
      if (onEventCreated) onEventCreated();
      handleDismiss();
      if (onNavigateCalendar) onNavigateCalendar();
    } catch (err) {
      console.warn('Could not schedule reminder:', err);
    } finally {
      setScheduling(false);
    }
  };

  // "2026-10-30" as "Fri 30 Oct" (the date is a local calendar day, so it is parsed as one).
  const niceDate = (iso) => {
    const [y, m, d] = (iso || '').split('-').map(Number);
    if (!y || !m || !d) return iso || '';
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
  };

  // Shown inline in the home screen's Today panel: a suggestion found in the workspace's minutes or
  // documents, quoting its source, that the user can add to the calendar or dismiss.
  return (
    <div className="mt-1 flex flex-col gap-3 border-t border-slate-200 pt-3 sm:flex-row sm:items-center" role="status">
      <Sparkles className="hidden h-4 w-4 shrink-0 text-indigo-600 sm:block" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{currentReminder.title}</p>
        <p className="truncate text-xs text-slate-500">
          <span className="tabular-nums">{niceDate(currentReminder.suggested_date)}</span>
          {currentReminder.suggested_time ? ` · ${currentReminder.suggested_time}` : ''} · found in {currentReminder.source_name}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={handleDismiss} className="rounded-pill px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">
          Dismiss
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={scheduling}
          className="inline-flex items-center gap-1 rounded-pill bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60 press"
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          {scheduling ? 'Adding…' : 'Add to calendar'}
        </button>
      </div>
    </div>
  );
}
