import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Calendar,
  Clock,
  Check,
  X,
} from 'lucide-react';
import { api } from '../api';

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
    const fetchReminders = async () => {
      if (!workspaceId) return;
      try {
        const res = await api.detectReminders(workspaceId);
        if (isMounted && res.reminders && res.reminders.length > 0) {
          const dismissed = getDismissedSet();
          const fresh = res.reminders.filter(
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
    const interval = setInterval(fetchReminders, 60000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [workspaceId]);

  if (!currentReminder) return null;

  const handleDismiss = () => {
    if (currentReminder) {
      persistDismissedId(currentReminder.id, currentReminder.title);
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
        event_time: currentReminder.suggested_time || '02:00 PM',
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

  return (
    <div className="fixed bottom-20 right-6 z-50 max-w-sm w-full font-sans">
      <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-2xl shadow-slate-400/20 flex flex-col space-y-2.5 text-[#191C1E]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-[#4F46E5]">
              <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6] animate-pulse" />
            </div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#4F46E5] font-mono">
              AI Detected Reminder
            </span>
          </div>

          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-slate-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-1">
          <h4 className="font-bold text-xs text-[#191C1E]">{currentReminder.title}</h4>
          <p className="text-[11px] text-slate-500 leading-relaxed font-sans line-clamp-2">
            {currentReminder.context_snippet}
          </p>
        </div>

        {/* Date / Time Badge */}
        <div className="flex items-center gap-2 text-[10px] text-slate-600 font-mono bg-[#F2F4F6] px-2.5 py-1 rounded-lg border border-[#E2E8F0]">
          <Calendar className="w-3 h-3 text-[#4F46E5]" />
          <span>{currentReminder.suggested_date}</span>
          <span>•</span>
          <Clock className="w-3 h-3 text-[#4F46E5]" />
          <span>{currentReminder.suggested_time || '02:00 PM'}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-slate-400 truncate max-w-[120px] font-mono">
            {currentReminder.source_name}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDismiss}
              className="px-2.5 py-1 text-[11px] text-slate-500 hover:text-slate-800 font-medium transition"
            >
              Dismiss
            </button>
            <button
              onClick={handleAccept}
              disabled={scheduling}
              className="flex items-center gap-1 bg-[#4F46E5] hover:bg-[#4338CA] text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm transition active:scale-95"
            >
              <Check className="w-3 h-3" />
              <span>{scheduling ? 'Scheduling...' : 'Set Reminder'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
