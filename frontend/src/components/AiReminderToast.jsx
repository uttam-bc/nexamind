import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Calendar,
  Clock,
  Check,
  X,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { api } from '../api';

export default function AiReminderToast({
  workspaceId,
  onEventCreated,
  onNavigateCalendar,
}) {
  const [reminders, setReminders] = useState([]);
  const [currentReminder, setCurrentReminder] = useState(null);
  const [dismissedIds, setDismissedIds] = useState(new Set());
  const [scheduling, setScheduling] = useState(false);

  // Poll or check for reminders on mount / workspace change
  useEffect(() => {
    let isMounted = true;
    const fetchReminders = async () => {
      if (!workspaceId) return;
      try {
        const res = await api.detectReminders(workspaceId);
        if (isMounted && res.reminders && res.reminders.length > 0) {
          const fresh = res.reminders.filter((r) => !dismissedIds.has(r.id));
          setReminders(fresh);
          if (fresh.length > 0 && !currentReminder) {
            setCurrentReminder(fresh[0]);
          }
        }
      } catch (err) {
        // silent background check
      }
    };

    fetchReminders();
    const interval = setInterval(fetchReminders, 45000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [workspaceId]);

  if (!currentReminder) return null;

  const handleDismiss = () => {
    setDismissedIds((prev) => new Set([...prev, currentReminder.id]));
    const nextList = reminders.filter((r) => r.id !== currentReminder.id);
    setReminders(nextList);
    setCurrentReminder(nextList.length > 0 ? nextList[0] : null);
  };

  const handleAccept = async () => {
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
    <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full animate-bounce-short">
      <div className="glass-panel p-4 rounded-2xl border border-indigo-500/40 bg-slate-950/95 shadow-2xl shadow-indigo-500/20 flex flex-col space-y-2.5 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            </div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-300">
              AI Detected Reminder
            </span>
          </div>

          <button
            onClick={handleDismiss}
            className="text-slate-500 hover:text-slate-300 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-1">
          <h4 className="font-bold text-xs text-slate-100">{currentReminder.title}</h4>
          <p className="text-[11px] text-slate-400 leading-relaxed font-sans line-clamp-2">
            {currentReminder.context_snippet}
          </p>
        </div>

        {/* Date / Time Badge */}
        <div className="flex items-center gap-2 text-[10px] text-slate-300 font-mono bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
          <Calendar className="w-3 h-3 text-indigo-400" />
          <span>{currentReminder.suggested_date}</span>
          <span>•</span>
          <Clock className="w-3 h-3 text-indigo-400" />
          <span>{currentReminder.suggested_time || '02:00 PM'}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-slate-500 truncate max-w-[120px]">
            From: {currentReminder.source_name}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDismiss}
              className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 transition"
            >
              Dismiss
            </button>
            <button
              onClick={handleAccept}
              disabled={scheduling}
              className="flex items-center gap-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
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
