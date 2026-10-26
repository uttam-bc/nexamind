import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  Sparkles,
  MessageSquare,
  FileText,
  Clock,
  Mic,
  Plus,
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
  User,
  Users,
  Tag,
  Pencil,
} from 'lucide-react';
import { api } from '../api';
import FeatureHeader from './FeatureHeader';
import { confirmDialog, notify } from '../context/ToastContext';
import { forgetReminder, getDetectedReminders } from '../lib/reminders';

// The event types the API accepts, with the labels the form shows.
const EVENT_TYPES = [
  ['meeting', 'Meeting'],
  ['deadline', 'Deadline'],
  ['milestone', 'Milestone'],
  ['reminder', 'Reminder'],
  ['task', 'Task'],
];
const TYPE_LABELS = Object.fromEntries(EVENT_TYPES);

const blankEvent = (date) => ({
  title: '',
  description: '',
  event_date: date,
  event_time: '10:00 AM',
  event_type: 'meeting',
  priority: 'medium',
});

// "2026-10-30" as "Fri 30 Oct" (a local calendar day).
const niceDay = (iso) => {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
};

const isoDay = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function CalendarView({
  workspace,
  workspaceId,
  user,
  sessions,
  onRefreshSessions,
  onBack,
  onOpenMeeting,
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week' | 'day'
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [jumpDay, setJumpDay] = useState(String(new Date().getDate()));
  const [jumpMonth, setJumpMonth] = useState(String(new Date().getMonth()));
  const [jumpYear, setJumpYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(true); // month view: the selected day's panel
  const [editingId, setEditingId] = useState(null); // null = the dialog adds a new event
  const [saving, setSaving] = useState(false);
  const isSolo = workspace?.type === 'personal';

  // AI-detected commitments come only from the API (meeting minutes and documents).
  const [insights, setInsights] = useState([]);
  const [insightStatus, setInsightStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'

  const [newEvent, setNewEvent] = useState(() => blankEvent(new Date().toISOString().split('T')[0]));

  const loadEvents = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await api.listCalendarEvents(workspaceId);
      if (data && Array.isArray(data)) {
        setEvents(data);
      }
    } catch (e) {
      notify(`Could not load the calendar: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [workspaceId]);

  const loadInsights = async (force = false) => {
    if (!workspaceId) return;
    setInsightStatus('loading');
    try {
      const reminders = await getDetectedReminders(workspaceId, { force });
      setInsights(
        reminders.map((r) => ({
          id: r.id,
          source: `${r.source_type === 'meeting_mom' ? 'Meeting' : 'Document'}: ${r.source_name}`,
          text: r.title,
          snippet: r.context_snippet,
          suggestedDate: r.suggested_date,
          suggestedTime: r.suggested_time,
          eventType: r.event_type,
          priority: r.priority,
        }))
      );
      setInsightStatus('ready');
    } catch (err) {
      setInsights([]);
      setInsightStatus('error');
    }
  };

  useEffect(() => {
    setInsights([]);
    loadInsights();
  }, [workspaceId]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Days in current month
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const jumpDaysInMonth = new Date(
    parseInt(jumpYear, 10) || year,
    (parseInt(jumpMonth, 10) || 0) + 1,
    0
  ).getDate();

  // Month navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const openDatePicker = () => {
    setJumpDay(String(selectedDay));
    setJumpMonth(String(month));
    setJumpYear(String(year));
    setShowDatePicker(true);
  };

  const handleJumpToDate = (e) => {
    e.preventDefault();
    const y = parseInt(jumpYear, 10);
    const m = parseInt(jumpMonth, 10);
    const d = parseInt(jumpDay, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
    const maxDay = new Date(y, m + 1, 0).getDate();
    const day = Math.min(Math.max(1, d), maxDay);
    setCurrentDate(new Date(y, m, 1));
    setSelectedDay(day);
    setShowDatePicker(false);
  };

  const openAddDialog = () => {
    setEditingId(null);
    setNewEvent(blankEvent(isoDay(year, month, selectedDay)));
    setShowAddModal(true);
  };

  const openEditDialog = (ev) => {
    setEditingId(ev.id);
    setNewEvent({
      title: ev.title || '',
      description: ev.description || '',
      event_date: (ev.event_date || '').slice(0, 10),
      event_time: ev.event_time || '',
      event_type: TYPE_LABELS[ev.event_type] ? ev.event_type : 'meeting',
      priority: ev.priority || 'medium',
    });
    setShowAddModal(true);
  };

  const closeDialog = () => {
    setShowAddModal(false);
    setEditingId(null);
  };

  const handleAddEvent = async (e) => {
    e.preventDefault();
    // `saving` blocks a second submit while the first is in flight (no duplicate events).
    if (!newEvent.title.trim() || !newEvent.event_date || !workspaceId || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.updateCalendarEvent(workspaceId, editingId, newEvent);
        notify('Event updated.', 'success');
      } else {
        await api.createCalendarEvent(workspaceId, newEvent);
      }
      // Keep the saved day in view and selected.
      const [y, m, d] = newEvent.event_date.split('-').map(Number);
      if (y && m && d) {
        setCurrentDate(new Date(y, m - 1, 1));
        setSelectedDay(d);
        setAgendaOpen(true);
      }
      closeDialog();
      await loadEvents();
    } catch (err) {
      notify(`${editingId ? 'Could not save the event' : 'Could not create the event'}: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleScheduleInsight = async (insight) => {
    try {
      if (workspaceId) {
        await api.createCalendarEvent(workspaceId, {
          title: insight.text,
          description: `Auto-scheduled from: ${insight.source}`,
          event_date: insight.suggestedDate,
          event_time: insight.suggestedTime,
          event_type: insight.eventType || 'meeting',
          priority: insight.priority || 'medium',
        });
      }
      forgetReminder(workspaceId, insight.id);
      setInsights((prev) => prev.filter((i) => i.id !== insight.id));
      await loadEvents();
      notify('Added to your calendar.', 'success');
    } catch (e) {
      notify(`Could not add the event: ${e.message}`, 'error');
    }
  };

  const handleDismissInsight = (id) => {
    forgetReminder(workspaceId, id);
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  const handleDeleteEvent = async (ev, e) => {
    e.stopPropagation();
    if (!workspaceId) return;
    const ok = await confirmDialog(`"${ev.title}" will be removed from the calendar.`, {
      title: 'Delete this event?',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.deleteCalendarEvent(workspaceId, ev.id);
      setEvents((prev) => prev.filter((x) => x.id !== ev.id));
      notify('Event deleted.', 'success');
    } catch (err) {
      notify(`Could not delete the event: ${err.message}`, 'error');
      loadEvents();
    }
  };

  // Get events for a specific day in the active month
  const getEventsForDay = (dayNum) => {
    const formattedDay = String(dayNum).padStart(2, '0');
    const formattedMonth = String(month + 1).padStart(2, '0');
    const dateStr = `${year}-${formattedMonth}-${formattedDay}`;

    return events.filter((ev) => {
      if (ev.event_date) {
        return ev.event_date.startsWith(dateStr);
      }
      return ev.day === dayNum;
    });
  };

  // Events use the workspace accent (blue Solo / violet Group); deadlines stay red and milestones
  // green, so a status colour never doubles as the workspace colour.
  const getTypeStyle = (type) => {
    switch (type?.toLowerCase()) {
      case 'milestone':
        return 'bg-emerald-50 text-emerald-800';
      case 'deadline':
      case 'urgent':
        return 'bg-rose-50 text-rose-800 font-medium';
      default:
        return 'bg-indigo-50 text-indigo-800';
    }
  };

  const selectedEvents = getEventsForDay(selectedDay);

  const renderAgenda = (closable) => (
    <div className="space-y-3" id="calendar-day-agenda">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">
          {new Date(year, month, selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          <span className="ml-2 text-xs font-medium text-slate-500">
            {selectedEvents.length === 0 ? 'No events' : `${selectedEvents.length} event${selectedEvents.length === 1 ? '' : 's'}`}
          </span>
        </h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={openAddDialog} className="text-xs font-bold text-indigo-700 hover:bg-indigo-50 px-2.5 py-1 rounded-pill transition-colors duration-fast">
            + Add
          </button>
          {closable && (
            <button
              type="button"
              onClick={() => setAgendaOpen(false)}
              aria-label="Close day panel"
              className="p-1.5 rounded-pill text-slate-500 hover:bg-slate-100 transition-colors duration-fast"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {selectedEvents.length === 0 ? (
        <div className="p-6 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs space-y-2">
          <CalendarIcon className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
          <p className="font-semibold text-slate-600">Nothing scheduled for this day.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {selectedEvents.map((ev) => (
            <li
              key={ev.id}
              className={`p-3.5 rounded-xl flex items-start justify-between gap-3 ${getTypeStyle(ev.event_type || ev.type)}`}
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm break-words">{ev.title}</span>
                  <span className="text-[11px] tabular-nums px-2 py-0.5 rounded-pill bg-white/70 text-slate-700">
                    {ev.meeting_id ? 'Scheduled meeting' : TYPE_LABELS[ev.event_type] || 'Event'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 flex items-center gap-1.5 tabular-nums">
                  <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span>{ev.event_time || 'All day'}</span>
                </p>
                {ev.description && <p className="text-xs text-slate-600 leading-snug break-words">{ev.description}</p>}
              </div>

              {ev.meeting_id ? (
                // A scheduled meeting: it's changed or cancelled from Meetings, so invitees are told.
                <button
                  type="button"
                  onClick={() => onOpenMeeting?.(ev.meeting_id)}
                  className="shrink-0 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-pill transition-colors duration-fast"
                >
                  Open meeting
                </button>
              ) : (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditDialog(ev)}
                    aria-label={`Edit ${ev.title}`}
                    title="Edit"
                    className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white/70 rounded-pill transition-colors duration-fast"
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteEvent(ev, e)}
                    aria-label={`Delete ${ev.title}`}
                    title="Delete"
                    className="p-2 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-pill transition-colors duration-fast"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col select-none">
      <FeatureHeader
        title="Calendar & Scheduling"
        icon={CalendarIcon}
        badge={isSolo ? 'Solo calendar' : 'Group calendar'}
        onBack={onBack}
        actions={
          <button
            type="button"
            onClick={openAddDialog}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-pill text-xs font-bold transition-colors duration-fast shadow-sm press"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Add event</span>
          </button>
        }
      />
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto min-h-0 font-sans antialiased text-slate-900 gap-4 pb-4">
        {/* 1. Main Calendar Workspace */}
        <div className="flex-1 flex flex-col bg-slate-50 rounded-2xl min-h-0 p-4 sm:p-5 space-y-5 lg:overflow-y-auto">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openDatePicker}
                  className="text-xl lg:text-2xl font-semibold text-slate-900 tracking-tight rounded-md decoration-slate-300 underline-offset-4 hover:underline"
                  title="Go to a specific date"
                >
                  {monthNames[month]} {year}
                </button>
                <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 border border-slate-200">
                  <button type="button" onClick={prevMonth} aria-label="Previous month" className="p-1 hover:bg-white rounded-md transition-colors text-slate-600">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={nextMonth} aria-label="Next month" className="p-1 hover:bg-white rounded-md transition-colors text-slate-600">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                {isSolo ? <User className="w-3.5 h-3.5" aria-hidden="true" /> : <Users className="w-3.5 h-3.5" aria-hidden="true" />}
                {isSolo ? 'Your personal schedule' : `${workspace?.name || 'Team'} schedule`} · click the month to jump
              </p>

              {showDatePicker && (
                <form
                  onSubmit={handleJumpToDate}
                  className="absolute left-0 top-full mt-2 z-30 bg-white border border-slate-200 rounded-xl shadow-panel p-3 space-y-3 w-72 animate-scale-in origin-top-left"
                >
                  <p className="text-xs font-bold text-slate-700">Go to date</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">Day</label>
                      <select
                        value={jumpDay}
                        onChange={(e) => setJumpDay(e.target.value)}
                        className="w-full bg-white border border-line-strong rounded-lg px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                      >
                        {Array.from({ length: jumpDaysInMonth }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={String(d)}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">Month</label>
                      <select
                        value={jumpMonth}
                        onChange={(e) => setJumpMonth(e.target.value)}
                        className="w-full bg-white border border-line-strong rounded-lg px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                      >
                        {monthNames.map((name, idx) => (
                          <option key={name} value={String(idx)}>{name.slice(0, 3)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">Year</label>
                      <select
                        value={jumpYear}
                        onChange={(e) => setJumpYear(e.target.value)}
                        className="w-full bg-white border border-line-strong rounded-lg px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                      >
                        {Array.from({ length: 21 }, (_, i) => year - 10 + i).map((y) => (
                          <option key={y} value={String(y)}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDatePicker(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                    >
                      Go
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Switcher */}
            <div className="flex items-center bg-slate-100 p-1 rounded-pill" role="group" aria-label="Calendar view">
              {['month', 'week', 'day'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 text-xs font-semibold rounded-pill capitalize transition-colors duration-base ${
                    viewMode === mode
                      ? 'bg-white text-slate-900 shadow-card font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

          </div>
        </div>

        {/* VIEW A: MONTH VIEW */}
        {viewMode === 'month' && (
          <div className="flex-1 flex flex-col">
          <div className="flex-1 flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white min-h-[420px]">
            {/* Days of Week Header */}
            <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-center tabular-nums text-xs font-bold text-slate-500 py-2.5 shrink-0">
              <span>SUN</span>
              <span>MON</span>
              <span>TUE</span>
              <span>WED</span>
              <span>THU</span>
              <span>FRI</span>
              <span>SAT</span>
            </div>

            {/* Month Day Grid — auto rows so 5- or 6-week months scroll instead of clipping */}
            <div className="flex-1 overflow-y-auto min-h-0">
            <div className="grid grid-cols-7 auto-rows-[minmax(88px,1fr)] bg-slate-200 gap-px min-h-full">
              {/* Previous month padding days */}
              {Array.from({ length: firstDayIndex }).map((_, i) => {
                const day = daysInPrevMonth - firstDayIndex + i + 1;
                return (
                  <div key={`prev-${i}`} className="bg-slate-50 p-2 text-slate-400 text-xs tabular-nums select-none">
                    <span>{day}</span>
                  </div>
                );
              })}

              {/* Current month days */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const dayEvents = getEventsForDay(dayNum);
                const isSelected = selectedDay === dayNum;
                const isToday =
                  new Date().getDate() === dayNum &&
                  new Date().getMonth() === month &&
                  new Date().getFullYear() === year;

                return (
                  <div
                    key={`curr-${dayNum}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${monthNames[month]} ${dayNum}, ${year}${isToday ? ' (today)' : ''}: ${
                      dayEvents.length === 0 ? 'no events' : `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`
                    }`}
                    aria-controls="calendar-day-agenda"
                    onClick={() => {
                      setSelectedDay(dayNum);
                      setAgendaOpen(true);
                    }}
                    onKeyDown={(e) => {
                      // Enter/Space select; arrow keys move between days (WCAG 2.1.1).
                      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDay(dayNum);
                        setAgendaOpen(true);
                      } else if (moves[e.key]) {
                        e.preventDefault();
                        const next = Math.min(daysInMonth, Math.max(1, dayNum + moves[e.key]));
                        setSelectedDay(next);
                        e.currentTarget.parentElement
                          ?.querySelector(`[data-day="${next}"]`)
                          ?.focus();
                      }
                    }}
                    data-day={dayNum}
                    className={`p-1.5 sm:p-2 flex flex-col justify-between transition-colors duration-fast group cursor-pointer min-h-[88px] min-w-0 ${
                      isSelected ? 'ring-2 ring-indigo-600 ring-inset bg-indigo-50' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs tabular-nums font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                          isToday
                            ? 'bg-indigo-600 text-white'
                            : isSelected
                            ? 'bg-indigo-100 text-indigo-600'
                            : 'text-slate-700'
                        }`}
                      >
                        {dayNum}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="text-xs tabular-nums font-bold text-slate-500" aria-hidden="true">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>

                    {/* Event Badges — hover shows description */}
                    <div className="space-y-1 mt-1 overflow-visible">
                      {dayEvents.slice(0, 2).map((ev) => (
                        <div
                          key={ev.id}
                          className={`relative group/ev px-1.5 py-0.5 rounded-md text-[11px] sm:text-xs font-medium truncate ${getTypeStyle(
                            ev.event_type || ev.type
                          )}`}
                          title={
                            ev.description
                              ? `${ev.title}\n${ev.description}`
                              : ev.title
                          }
                        >
                          {ev.event_time ? `${ev.event_time} ` : ''}{ev.title}
                          <div className="pointer-events-none absolute left-0 bottom-full mb-1 z-20 hidden group-hover/ev:block w-48 max-w-[14rem] rounded-lg bg-slate-900 text-white text-[10px] leading-snug px-2.5 py-2 shadow-lg whitespace-normal font-medium normal-case">
                            <div className="font-bold mb-0.5">{ev.title}</div>
                            {ev.event_time && (
                              <div className="text-slate-300 mb-0.5">{ev.event_time}</div>
                            )}
                            {ev.description ? (
                              <div className="text-slate-200">{ev.description}</div>
                            ) : (
                              <div className="text-slate-400 italic">No description</div>
                            )}
                          </div>
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="text-xs font-bold text-slate-500 pl-1 block">
                          +{dayEvents.length - 2} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Next month padding days */}
              {Array.from({
                length: (7 - ((firstDayIndex + daysInMonth) % 7)) % 7,
              }).map((_, i) => (
                <div key={`next-${i}`} className="bg-slate-50 p-2 text-slate-400 text-xs tabular-nums select-none">
                  <span>{i + 1}</span>
                </div>
              ))}
            </div>
            </div>
          </div>
          {/* The selected day expands below the grid with its events and Edit/Delete. */}
          {agendaOpen && <div className="mt-4 animate-slide-up">{renderAgenda(true)}</div>}
          </div>
        )}

        {/* VIEW B: WEEK / AGENDA VIEW */}
        {(viewMode === 'week' || viewMode === 'day') && <div className="flex-1 animate-fade-in">{renderAgenda(false)}</div>}
      </div>

      {/* 2. Proactive AI Detected Commitments Sidebar */}
      <div className="w-full lg:w-80 shrink-0 space-y-4">
        <div className="bg-slate-50 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" aria-hidden="true" />
              <span>Suggested dates</span>
            </h2>
            {insightStatus === 'ready' && (
              <span className="whitespace-nowrap rounded-pill bg-white px-2 py-0.5 text-xs tabular-nums text-slate-600 ring-1 ring-slate-200">
                {insights.length}
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-slate-600 leading-relaxed">
              Dates and commitments found in this workspace's meeting minutes and documents.
            </p>
            <button
              type="button"
              onClick={() => loadInsights(true)}
              disabled={insightStatus === 'loading'}
              className="text-xs font-semibold text-indigo-700 hover:underline disabled:text-slate-400 flex-shrink-0"
            >
              {insightStatus === 'loading' ? 'Scanning…' : 'Rescan'}
            </button>
          </div>

          <div className="space-y-3">
            {insightStatus === 'loading' && insights.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-slate-600 text-xs" role="status">
                Looking for commitments…
              </div>
            ) : insightStatus === 'error' ? (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-center text-rose-700 text-xs" role="alert">
                Couldn't check for commitments. Try Rescan.
              </div>
            ) : insights.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-slate-600 text-xs">
                Nothing to schedule right now. Commitments with dates in meeting minutes or documents will appear here.
              </div>
            ) : (
              insights.map((insight) => (
                <div
                  key={insight.id}
                  className="border-t border-slate-200 pt-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-slate-500">
                    <span>{insight.source}</span>
                    <button
                      onClick={() => handleDismissInsight(insight.id)}
                      className="hover:text-slate-700"
                      aria-label={`Dismiss suggestion: ${insight.text}`}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <p className="text-xs font-semibold text-slate-900 leading-snug">
                    {insight.text}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                    <span className="text-xs tabular-nums text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{[niceDay(insight.suggestedDate), insight.suggestedTime].filter(Boolean).join(' · ')}</span>
                    </span>

                    <button
                      onClick={() => handleScheduleInsight(insight)}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-pill text-xs font-bold transition-colors duration-fast flex items-center gap-1 press"
                    >
                      <Check className="w-3 h-3" />
                      <span>Add to calendar</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div data-modal className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-panel space-y-5 animate-scale-in">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900">{editingId ? 'Edit event' : 'Schedule new event'}</h3>
              <button type="button" onClick={closeDialog} aria-label="Close" className="p-1.5 rounded-pill text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleAddEvent} className="space-y-4">
              <div>
                <label htmlFor="calendar-view-field-1" className="block text-xs font-semibold text-slate-700 mb-1">Event Title *</label>
                <input id="calendar-view-field-1"
                  type="text"
                  required
                  placeholder="e.g. Sprint 42 Planning & Sync"
                  className="w-full bg-white border border-line-strong focus:border-indigo-600 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="calendar-view-field-2" className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                  <input id="calendar-view-field-2"
                    type="date"
                    required
                    className="w-full bg-white border border-line-strong focus:border-indigo-600 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none tabular-nums"
                    value={newEvent.event_date}
                    onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="calendar-view-field-3" className="block text-xs font-semibold text-slate-700 mb-1">Time</label>
                  <input id="calendar-view-field-3"
                    type="text"
                    placeholder="10:00 AM"
                    className="w-full bg-white border border-line-strong focus:border-indigo-600 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none tabular-nums"
                    value={newEvent.event_time}
                    onChange={(e) => setNewEvent({ ...newEvent, event_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="calendar-view-field-4" className="block text-xs font-semibold text-slate-700 mb-1">Event Type</label>
                  <select id="calendar-view-field-4"
                    className="w-full bg-white border border-line-strong focus:border-indigo-600 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none"
                    value={newEvent.event_type}
                    onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })}
                  >
                    {EVENT_TYPES.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="calendar-view-field-5" className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                  <select id="calendar-view-field-5"
                    className="w-full bg-white border border-line-strong focus:border-indigo-600 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none"
                    value={newEvent.priority}
                    onChange={(e) => setNewEvent({ ...newEvent, priority: e.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="calendar-view-field-desc" className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  id="calendar-view-field-desc"
                  rows={2}
                  placeholder="What is this event about?"
                  className="w-full bg-white border border-line-strong focus:border-indigo-600 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none resize-none"
                  value={newEvent.description}
                  onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeDialog} className="btn-secondary text-xs">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary text-xs press">
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
