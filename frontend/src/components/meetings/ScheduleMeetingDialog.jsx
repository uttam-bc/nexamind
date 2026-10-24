import React, { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '../../lib/dialog';
import { newId } from '../../lib/meetingClient';
import { browserTimeZone, localToIso, partsIn, timeZones } from '../../lib/timezone';

export default function ScheduleMeetingDialog({ meeting = null, members = [], currentUserId, onSubmit, onClose }) {
  const ref = useDialog(true, onClose);
  const zone = meeting?.timezone || browserTimeZone();
  const initial = meeting?.scheduled_start ? partsIn(meeting.scheduled_start, zone) : { date: '', time: '' };
  const [form, setForm] = useState({
    title: meeting?.title || '',
    date: initial.date,
    time: initial.time,
    timezone: zone,
    duration_minutes: meeting?.duration_minutes || 30,
    recurrence: 'none',
    occurrences: 4,
    agenda: meeting?.agenda || '',
    description: meeting?.description || '',
    invitee_ids: new Set((meeting?.invitees || []).map((i) => i.id)),
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // One id per dialog: a double click or a retried request returns the same meeting.
  const requestId = useRef(newId());
  const submitting = useRef(false); // state updates are async: a fast second click must not send again
  const zones = useMemo(() => timeZones(form.timezone), [form.timezone]);
  const others = members.filter((m) => String(m.user_id) !== String(currentUserId));
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    const title = form.title.trim();
    if (!title) return setError('Give the meeting a title.');
    if (!form.date || !form.time) return setError('Pick a date and time.');
    const iso = localToIso(form.date, form.time, form.timezone);
    if (new Date(iso).getTime() < Date.now() - 60000) return setError('That time is in the past.');
    const payload = {
      title,
      scheduled_start: iso,
      timezone: form.timezone,
      duration_minutes: Number(form.duration_minutes),
      agenda: form.agenda.trim() || null,
      description: form.description.trim() || null,
      invitee_ids: [...form.invitee_ids],
    };
    if (!meeting) {
      payload.recurrence = form.recurrence;
      payload.occurrences = form.recurrence === 'none' ? 1 : Number(form.occurrences);
      payload.client_request_id = requestId.current;
    }
    submitting.current = true;
    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    } finally {
      submitting.current = false;
    }
  };

  const field = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 bg-white';
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}>
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-title"
        tabIndex={-1}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[90vh] outline-none"
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="schedule-title" className="font-bold text-slate-900">{meeting ? 'Edit meeting' : 'Schedule a meeting'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-600">Title</span>
            <input className={field} value={form.title} onChange={set('title')} maxLength={255} required autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-600">Date</span>
              <input type="date" className={field} value={form.date} onChange={set('date')} required />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-600">Start time</span>
              <input type="time" className={field} value={form.time} onChange={set('time')} required />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-600">Time zone</span>
              <select className={field} value={form.timezone} onChange={set('timezone')}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-600">Duration</span>
              <select className={field} value={form.duration_minutes} onChange={set('duration_minutes')}>
                {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!meeting && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">Repeats</span>
                <select className={field} value={form.recurrence} onChange={set('recurrence')}>
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              {form.recurrence !== 'none' && (
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-600">Occurrences</span>
                  <input type="number" min={2} max={52} className={field} value={form.occurrences} onChange={set('occurrences')} />
                </label>
              )}
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-600">Agenda (optional)</span>
            <textarea className={`${field} min-h-[4rem]`} value={form.agenda} onChange={set('agenda')} maxLength={5000} />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs font-bold text-slate-600">Invitees</legend>
            <p className="text-xs text-slate-500">With no invitees, every workspace member can join.</p>
            {others.length === 0 ? (
              <p className="text-sm text-slate-500">No other members in this workspace yet.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl divide-y">
                {others.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={form.invitee_ids.has(String(m.user_id))}
                      onChange={(e) => {
                        const next = new Set(form.invitee_ids);
                        if (e.target.checked) next.add(String(m.user_id));
                        else next.delete(String(m.user_id));
                        setForm({ ...form, invitee_ids: next });
                      }}
                    />
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-slate-400 truncate">{m.email}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {error && (
            <p className="text-sm text-rose-600" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-sm font-bold">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-50">
            {saving ? 'Saving…' : meeting ? 'Save changes' : 'Schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}
