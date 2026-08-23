import React, { useState, useEffect } from 'react';
import { Sparkles, Calendar, Clock, Check, X } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';

export default function AiReminderToast({ workspaceId, onEventCreated, onNavigateCalendar }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [reminders, setReminders] = useState([]);
  const [currentReminder, setCurrentReminder] = useState(null);
  const [dismissedIds, setDismissedIds] = useState(new Set());
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchReminders = async () => {
      if (!workspaceId) return;
      try {
        const res = await api.detectReminders(workspaceId);
        if (isMounted && res.reminders?.length > 0) {
          const fresh = res.reminders.filter((r) => !dismissedIds.has(r.id));
          setReminders(fresh);
          if (fresh.length > 0 && !currentReminder) setCurrentReminder(fresh[0]);
        }
      } catch {
        /* silent background poll */
      }
    };
    fetchReminders();
    const interval = setInterval(fetchReminders, 45000);
    return () => { isMounted = false; clearInterval(interval); };
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
      toastSuccess('Reminder scheduled');
      if (onEventCreated) onEventCreated();
      handleDismiss();
      if (onNavigateCalendar) onNavigateCalendar();
    } catch (err) {
      toastError(err.message || 'Could not schedule reminder');
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full animate-slide-up px-4 sm:px-0">
      <div className="glass-panel p-4 rounded-2xl border border-indigo-500/30 shadow-2xl shadow-indigo-500/10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">AI Reminder</span>
          </div>
          <button onClick={handleDismiss} className="btn-ghost p-1 text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <h4 className="font-semibold text-sm text-slate-100">{currentReminder.title}</h4>
          <p className="text-xs text-slate-400 mt-1 line-clamp-2">{currentReminder.context_snippet}</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
          <Calendar className="w-3 h-3 text-indigo-400" />
          {currentReminder.suggested_date}
          <span className="text-slate-600">•</span>
          <Clock className="w-3 h-3 text-indigo-400" />
          {currentReminder.suggested_time || '02:00 PM'}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-slate-500 truncate max-w-[120px]">From: {currentReminder.source_name}</span>
          <div className="flex gap-2">
            <button onClick={handleDismiss} className="btn-ghost text-xs py-1">Dismiss</button>
            <button onClick={handleAccept} disabled={scheduling} className="btn-primary text-xs py-1.5 px-3">
              <Check className="w-3 h-3" />
              {scheduling ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
