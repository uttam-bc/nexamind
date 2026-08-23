import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Video,
  FileText,
  Bell,
  Tag,
  Check,
  X,
  Layers,
} from 'lucide-react';
import { api } from '../api';

export default function CalendarView({
  workspaceId,
  user,
  sessions,
  onRefreshSessions,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [detectedReminders, setDetectedReminders] = useState([]);
  const [detecting, setDetecting] = useState(false);

  // Form state
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    event_date: new Date().toISOString().split('T')[0],
    event_time: '10:00 AM',
    event_type: 'meeting',
    priority: 'medium',
  });

  // Load calendar events
  const loadEvents = async () => {
    try {
      setLoading(true);
      const data = await api.listCalendarEvents(workspaceId);
      setEvents(data || []);
    } catch (err) {
      console.warn('Error loading calendar events:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load AI detected reminders from MoMs & docs
  const loadDetectedReminders = async () => {
    try {
      setDetecting(true);
      const res = await api.detectReminders(workspaceId);
      setDetectedReminders(res.reminders || []);
    } catch (err) {
      console.warn('Error detecting reminders:', err);
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    if (workspaceId) {
      loadEvents();
      loadDetectedReminders();
    }
  }, [workspaceId]);

  // Create Event
  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!newEvent.title.trim()) return;

    try {
      await api.createCalendarEvent(workspaceId, newEvent);
      setShowAddModal(false);
      setNewEvent({
        title: '',
        description: '',
        event_date: selectedDateStr,
        event_time: '10:00 AM',
        event_type: 'meeting',
        priority: 'medium',
      });
      await loadEvents();
      await loadDetectedReminders();
    } catch (err) {
      alert(`Could not create event: ${err.message}`);
    }
  };

  // 1-Click Accept Detected Reminder
  const handleAcceptReminder = async (rem) => {
    try {
      await api.createCalendarEvent(workspaceId, {
        title: rem.title,
        description: `Auto-scheduled by AI from: ${rem.source_name} (${rem.context_snippet})`,
        event_date: rem.suggested_date,
        event_time: rem.suggested_time || '02:00 PM',
        event_type: rem.event_type,
        priority: rem.priority,
        source: 'ai_detected',
      });
      setDetectedReminders((prev) => prev.filter((r) => r.id !== rem.id));
      await loadEvents();
      alert(`Reminder scheduled for ${rem.suggested_date}!`);
    } catch (err) {
      alert(`Error scheduling reminder: ${err.message}`);
    }
  };

  // Delete event
  const handleDeleteEvent = async (id) => {
    if (confirm('Remove this event from your calendar?')) {
      try {
        await api.deleteCalendarEvent(workspaceId, id);
        await loadEvents();
      } catch (err) {
        alert(`Error deleting event: ${err.message}`);
      }
    }
  };

  // Toggle completion
  const handleToggleComplete = async (event) => {
    try {
      await api.updateCalendarEvent(workspaceId, event.id, {
        is_completed: !event.is_completed,
      });
      await loadEvents();
    } catch (err) {
      console.warn('Error updating event:', err);
    }
  };

  // Calendar calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // Events filtered
  const filteredEvents = events.filter((e) => {
    if (filterType === 'all') return true;
    return e.event_type === filterType;
  });

  const selectedDateEvents = filteredEvents.filter((e) => e.event_date === selectedDateStr);

  const getEventTypeBadge = (type) => {
    switch (type) {
      case 'meeting':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'deadline':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'reminder':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'milestone':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default:
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 tracking-tight flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-indigo-400" />
            <span>Personal Calendar & Smart Schedule</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage scheduled meetings, deadlines, sprint milestones, and autonomous AI reminders.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setNewEvent((prev) => ({ ...prev, event_date: selectedDateStr }));
              setShowAddModal(true);
            }}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add Event / Meeting</span>
          </button>
        </div>
      </div>

      {/* AI Detected Reminders Banner */}
      {detectedReminders.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-950/80 via-purple-950/60 to-slate-950 p-4 rounded-2xl border border-indigo-500/30 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              <span className="text-xs font-bold text-slate-200">
                AI Detected Reminders from Meeting MoMs & Document Specs ({detectedReminders.length})
              </span>
            </div>
            <span className="text-[10px] uppercase font-bold text-indigo-400 font-mono">
              Auto-Scanned
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {detectedReminders.map((rem) => (
              <div
                key={rem.id}
                className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between space-y-2"
              >
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span className="font-mono text-indigo-300">📅 {rem.suggested_date} ({rem.suggested_time || '2:00 PM'})</span>
                    <span className="capitalize text-emerald-400">{rem.priority}</span>
                  </div>
                  <h4 className="font-bold text-xs text-slate-100">{rem.title}</h4>
                  <p className="text-[11px] text-slate-400 line-clamp-2 mt-1 font-sans">
                    {rem.context_snippet}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <span className="text-[10px] text-slate-500 truncate max-w-[120px]">
                    From: {rem.source_name}
                  </span>
                  <button
                    onClick={() => handleAcceptReminder(rem)}
                    className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold shadow transition"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Set Reminder</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Calendar Month Matrix (Left) + Selected Day Agenda (Right) */}
      <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Monthly Calendar Matrix */}
        <div className="col-span-2 glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col">
          {/* Month Navigator & Filter Bar */}
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <h3 className="font-extrabold text-base text-slate-100">
                {monthNames[month]} {year}
              </h3>
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={prevMonth}
                  className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={nextMonth}
                  className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Filter Types */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-[11px]">
              {['all', 'meeting', 'deadline', 'reminder', 'milestone'].map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1 rounded-lg font-bold capitalize transition ${
                    filterType === t ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Days of Week Header */}
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          {/* Day Cells Grid */}
          <div className="grid grid-cols-7 gap-1.5 flex-1 min-h-0">
            {/* Blank pads for first day */}
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`empty-${i}`} className="bg-slate-950/20 rounded-xl border border-transparent" />
            ))}

            {/* Actual Days */}
            {Array.from({ length: totalDays }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const isSelected = selectedDateStr === dateStr;
              const isToday = new Date().toISOString().split('T')[0] === dateStr;

              const dayEvents = filteredEvents.filter((e) => e.event_date === dateStr);

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDateStr(dateStr)}
                  className={`p-2 rounded-xl border text-left flex flex-col justify-between transition min-h-[75px] ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500 shadow-md'
                      : isToday
                      ? 'bg-slate-900/90 border-indigo-500/40 hover:bg-slate-800'
                      : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-bold ${
                        isToday
                          ? 'w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]'
                          : isSelected
                          ? 'text-indigo-400 font-extrabold'
                          : 'text-slate-400'
                      }`}
                    >
                      {dayNum}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    )}
                  </div>

                  <div className="space-y-1 mt-1 overflow-hidden">
                    {dayEvents.slice(0, 2).map((ev) => (
                      <div
                        key={ev.id}
                        className={`text-[9px] px-1.5 py-0.5 rounded truncate font-medium border ${getEventTypeBadge(ev.event_type)}`}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-[9px] text-slate-500 font-mono">
                        +{dayEvents.length - 2} more
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Date Agenda Drawer (Right) */}
        <div className="col-span-1 glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col bg-slate-950/50">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Selected Date</span>
              <h3 className="font-extrabold text-sm text-slate-100">{selectedDateStr}</h3>
            </div>
            <span className="text-xs bg-slate-900 text-indigo-400 px-2.5 py-1 rounded-lg border border-slate-800 font-mono font-bold">
              {selectedDateEvents.length} Events
            </span>
          </div>

          {/* Agenda Event Cards */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {selectedDateEvents.map((ev) => (
              <div
                key={ev.id}
                className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 hover:border-slate-700 transition space-y-2 group shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleComplete(ev)}
                      className={`text-slate-400 hover:scale-110 transition ${ev.is_completed ? 'text-emerald-400' : ''}`}
                    >
                      <CheckCircle2 className={`w-4 h-4 ${ev.is_completed ? 'fill-emerald-500/20 text-emerald-400' : 'text-slate-600'}`} />
                    </button>
                    <h4 className={`font-bold text-xs ${ev.is_completed ? 'line-through text-slate-500' : 'text-slate-100'}`}>
                      {ev.title}
                    </h4>
                  </div>
                  <button
                    onClick={() => handleDeleteEvent(ev.id)}
                    className="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {ev.description && (
                  <p className="text-[11px] text-slate-400 pl-6 leading-relaxed">
                    {ev.description}
                  </p>
                )}

                <div className="flex items-center justify-between text-[10px] pl-6 pt-1 border-t border-slate-800/80">
                  <div className="flex items-center gap-1 text-slate-400 font-mono">
                    <Clock className="w-3 h-3 text-indigo-400" />
                    <span>{ev.event_time || 'All Day'}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded border capitalize font-bold ${getEventTypeBadge(ev.event_type)}`}>
                    {ev.event_type}
                  </span>
                </div>
              </div>
            ))}

            {selectedDateEvents.length === 0 && (
              <div className="text-center py-16 text-slate-500 space-y-2">
                <CalendarIcon className="w-8 h-8 mx-auto text-slate-700" />
                <p className="text-xs">No events scheduled for {selectedDateStr}.</p>
                <button
                  onClick={() => {
                    setNewEvent((prev) => ({ ...prev, event_date: selectedDateStr }));
                    setShowAddModal(true);
                  }}
                  className="text-xs text-indigo-400 hover:underline font-bold"
                >
                  + Add an event for this day
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-extrabold text-sm text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>Schedule Calendar Event</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEvent} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 font-bold mb-1">Event Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sprint Demo with Engineering Leads"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                    value={newEvent.event_date}
                    onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Time</label>
                  <input
                    type="text"
                    placeholder="e.g. 03:00 PM"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                    value={newEvent.event_time}
                    onChange={(e) => setNewEvent({ ...newEvent, event_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Event Type</label>
                  <select
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                    value={newEvent.event_type}
                    onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })}
                  >
                    <option value="meeting">Meeting</option>
                    <option value="deadline">Deadline</option>
                    <option value="reminder">Reminder</option>
                    <option value="milestone">Sprint Milestone</option>
                    <option value="task">Task</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Priority</label>
                  <select
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
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
                <label className="block text-slate-400 font-bold mb-1">Description / Agenda</label>
                <textarea
                  placeholder="Notes, agenda, or video call links..."
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
                  value={newEvent.description}
                  onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/30 transition"
                >
                  Save Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
