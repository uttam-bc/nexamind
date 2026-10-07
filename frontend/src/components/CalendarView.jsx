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
  Tag,
} from 'lucide-react';
import { api } from '../api';

export default function CalendarView({
  workspaceId,
  user,
  sessions,
  onRefreshSessions,
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week' | 'day'
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Proactive AI Detected Commitments
  const [insights, setInsights] = useState([
    {
      id: 'insight-1',
      source: 'From #general Channel',
      icon: MessageSquare,
      borderColor: 'border-l-[#F59E0B]',
      badgeColor: 'text-[#F59E0B]',
      text: 'Team sync on system architecture & database deployment strategy',
      btnColor: 'bg-[#4F46E5] text-white',
      btnText: 'Add to Cal',
      suggestedDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      suggestedTime: '02:00 PM',
    },
    {
      id: 'insight-2',
      source: 'From PR Review',
      icon: FileText,
      borderColor: 'border-l-[#F43F5E]',
      badgeColor: 'text-[#F43F5E]',
      text: 'Security patch & authorization token audit',
      suggestedDate: new Date().toISOString().split('T')[0],
      suggestedTime: '04:00 PM',
      btnColor: 'bg-[#F43F5E] text-white',
      btnText: 'Add to Cal',
    },
  ]);

  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    event_date: new Date().toISOString().split('T')[0],
    event_time: '10:00 AM',
    event_type: 'meeting',
    priority: 'medium',
  });

  const loadEvents = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await api.listCalendarEvents(workspaceId);
      if (data && Array.isArray(data)) {
        setEvents(data);
      }
    } catch (e) {
      console.warn('Calendar load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [workspaceId]);

  // Month navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

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

  const handleAddEvent = async (e) => {
    e.preventDefault();
    if (!newEvent.title.trim() || !workspaceId) return;
    try {
      await api.createCalendarEvent(workspaceId, newEvent);
      setShowAddModal(false);
      setNewEvent({
        title: '',
        description: '',
        event_date: new Date().toISOString().split('T')[0],
        event_time: '10:00 AM',
        event_type: 'meeting',
        priority: 'medium',
      });
      await loadEvents();
    } catch (err) {
      alert(`Event creation error: ${err.message}`);
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
          event_type: 'meeting',
          priority: 'high',
        });
      }
      setInsights((prev) => prev.filter((i) => i.id !== insight.id));
      await loadEvents();
    } catch (e) {
      console.warn('Schedule insight error:', e);
    }
  };

  const handleDismissInsight = (id) => {
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  const handleDeleteEvent = async (eventId, e) => {
    e.stopPropagation();
    if (!workspaceId) return;
    try {
      await api.deleteCalendarEvent(workspaceId, eventId);
      await loadEvents();
    } catch (err) {
      console.warn('Delete error:', err);
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

  const getTypeStyle = (type) => {
    switch (type?.toLowerCase()) {
      case 'standup':
        return 'bg-purple-50 text-purple-700 border-l-2 border-purple-500';
      case 'review':
      case 'milestone':
        return 'bg-blue-50 text-blue-700 border-l-2 border-blue-500';
      case 'deadline':
      case 'urgent':
        return 'bg-rose-50 text-rose-700 border-l-2 border-rose-500 font-bold';
      default:
        return 'bg-indigo-50 text-indigo-700 border-l-2 border-indigo-500';
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row overflow-y-auto bg-[#F8FAFC] font-sans antialiased text-[#191C1E] gap-6">
      {/* 1. Main Calendar Workspace */}
      <div className="flex-1 flex flex-col bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden p-6 space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#4F46E5]">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl lg:text-2xl font-bold text-[#191C1E] tracking-tight">
                  {monthNames[month]} {year}
                </h1>
                <div className="flex items-center gap-1 bg-[#F2F4F6] rounded-lg p-1 border border-[#E2E8F0]">
                  <button onClick={prevMonth} className="p-1 hover:bg-white rounded transition text-slate-600">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={nextMonth} className="p-1 hover:bg-white rounded transition text-slate-600">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Workspace Sprint & Meeting Schedule
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Switcher */}
            <div className="flex items-center bg-[#F2F4F6] p-1 rounded-xl border border-[#E2E8F0]">
              {['month', 'week', 'day'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg capitalize transition ${
                    viewMode === mode
                      ? 'bg-white text-[#4F46E5] shadow-sm font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              style={{ backgroundColor: '#4F46E5', color: '#FFFFFF' }}
              className="px-4 py-2 rounded-xl text-xs font-bold shadow-sm hover:opacity-95 transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>+ Add Event</span>
            </button>
          </div>
        </div>

        {/* VIEW A: MONTH VIEW */}
        {viewMode === 'month' && (
          <div className="flex-1 flex flex-col border border-[#E2E8F0] rounded-xl overflow-hidden shadow-sm min-h-[520px]">
            {/* Days of Week Header */}
            <div className="grid grid-cols-7 bg-[#F8FAFC] border-b border-[#E2E8F0] text-center font-mono text-xs font-bold text-slate-500 py-2.5">
              <span>SUN</span>
              <span>MON</span>
              <span>TUE</span>
              <span>WED</span>
              <span>THU</span>
              <span>FRI</span>
              <span>SAT</span>
            </div>

            {/* Month Day Grid */}
            <div className="flex-1 grid grid-cols-7 grid-rows-5 bg-[#E2E8F0] gap-px">
              {/* Previous month padding days */}
              {Array.from({ length: firstDayIndex }).map((_, i) => {
                const day = daysInPrevMonth - firstDayIndex + i + 1;
                return (
                  <div key={`prev-${i}`} className="bg-[#FAFBFD] p-2 text-slate-300 text-xs font-mono select-none">
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
                    onClick={() => setSelectedDay(dayNum)}
                    className={`bg-white p-2 flex flex-col justify-between transition group hover:bg-[#F8FAFC] cursor-pointer min-h-[90px] ${
                      isSelected ? 'ring-2 ring-[#4F46E5] ring-inset bg-indigo-50/20' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-mono font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                          isToday
                            ? 'bg-[#4F46E5] text-white'
                            : isSelected
                            ? 'bg-indigo-100 text-[#4F46E5]'
                            : 'text-slate-700'
                        }`}
                      >
                        {dayNum}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="text-[10px] font-mono font-bold text-slate-400">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>

                    {/* Event Badges */}
                    <div className="space-y-1 mt-1 overflow-hidden">
                      {dayEvents.slice(0, 2).map((ev) => (
                        <div
                          key={ev.id}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate shadow-xs ${getTypeStyle(
                            ev.event_type || ev.type
                          )}`}
                        >
                          {ev.event_time ? `${ev.event_time} ` : ''}{ev.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="text-[9px] font-bold text-slate-400 pl-1 block">
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
                <div key={`next-${i}`} className="bg-[#FAFBFD] p-2 text-slate-300 text-xs font-mono select-none">
                  <span>{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW B: WEEK / AGENDA VIEW */}
        {(viewMode === 'week' || viewMode === 'day') && (
          <div className="flex-1 space-y-4">
            <h3 className="text-sm font-bold text-[#191C1E]">
              Schedule for {monthNames[month]} {selectedDay}, {year}
            </h3>
            {getEventsForDay(selectedDay).length === 0 ? (
              <div className="p-8 text-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-slate-400 text-xs space-y-2">
                <CalendarIcon className="w-6 h-6 text-slate-300 mx-auto" />
                <p className="font-semibold text-slate-600">No events scheduled for this day.</p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="text-xs font-bold text-[#4F46E5] hover:underline"
                >
                  + Add an Event
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {getEventsForDay(selectedDay).map((ev) => (
                  <div
                    key={ev.id}
                    className={`p-4 rounded-xl border flex items-center justify-between shadow-xs ${getTypeStyle(
                      ev.event_type || ev.type
                    )}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs">{ev.title}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/60">
                          {ev.event_type || 'Event'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 flex items-center gap-2 font-mono">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{ev.event_time || 'All Day'}</span>
                      </p>
                    </div>

                    <button
                      onClick={(e) => handleDeleteEvent(ev.id, e)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Proactive AI Detected Commitments Sidebar */}
      <div className="w-full lg:w-80 space-y-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#191C1E] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#8B5CF6] animate-pulse" />
              <span>AI Detected Commitments</span>
            </h2>
            <span className="text-[10px] font-mono bg-purple-50 text-[#8B5CF6] px-2 py-0.5 rounded font-bold">
              {insights.length} Detected
            </span>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            NexaMind Copilot analyzes team chats and PR discussions to automatically surface action items.
          </p>

          <div className="space-y-3">
            {insights.length === 0 ? (
              <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-center text-slate-400 text-xs italic">
                All action items scheduled!
              </div>
            ) : (
              insights.map((insight) => (
                <div
                  key={insight.id}
                  className={`bg-white border border-[#E2E8F0] border-l-4 rounded-xl p-3.5 shadow-xs space-y-2.5 ${insight.borderColor}`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>{insight.source}</span>
                    <button
                      onClick={() => handleDismissInsight(insight.id)}
                      className="hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-xs font-semibold text-[#191C1E] leading-snug">
                    {insight.text}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-[#E2E8F0]">
                    <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{insight.suggestedTime}</span>
                    </span>

                    <button
                      onClick={() => handleScheduleInsight(insight)}
                      className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      <span>Add to Cal</span>
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-[#191C1E]">Schedule New Event</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Event Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sprint 42 Planning & Sync"
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-3.5 py-2 text-xs text-[#191C1E] focus:outline-none"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-3.5 py-2 text-xs text-[#191C1E] focus:outline-none font-mono"
                    value={newEvent.event_date}
                    onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Time</label>
                  <input
                    type="text"
                    placeholder="10:00 AM"
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-3.5 py-2 text-xs text-[#191C1E] focus:outline-none font-mono"
                    value={newEvent.event_time}
                    onChange={(e) => setNewEvent({ ...newEvent, event_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Event Type</label>
                  <select
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-3.5 py-2 text-xs text-[#191C1E] focus:outline-none"
                    value={newEvent.event_type}
                    onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })}
                  >
                    <option value="meeting">Team Meeting</option>
                    <option value="standup">Daily Standup</option>
                    <option value="review">Sprint Review</option>
                    <option value="deadline">Sprint Deadline</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] focus:border-[#4F46E5] rounded-xl px-3.5 py-2 text-xs text-[#191C1E] focus:outline-none"
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

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-[#F2F4F6] rounded-xl font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: '#4F46E5', color: '#FFFFFF' }}
                  className="px-5 py-2 text-xs font-bold rounded-xl shadow-sm hover:opacity-95 transition"
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
