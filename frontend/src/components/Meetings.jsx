import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Lock,
  Pencil,
  Radio,
  Repeat,
  Upload,
  Users,
  Video,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import FeatureHeader from './FeatureHeader';
import { notify, confirmDialog } from '../context/ToastContext';
import { onDeepLink } from '../lib/deepLink';
import { newId } from '../lib/meetingClient';
import MeetingRoom, { PreJoin } from './meetings/MeetingRoom';
import MomReview from './meetings/MomReview';
import ScheduleMeetingDialog from './meetings/ScheduleMeetingDialog';
import { browserTimeZone } from '../lib/timezone';

const REFRESH_MS = 20000;

function formatWhen(meeting) {
  if (!meeting.scheduled_start) return '';
  const start = new Date(meeting.scheduled_start);
  const local = start.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const viewerZone = browserTimeZone();
  if (meeting.timezone && meeting.timezone !== viewerZone) {
    const theirs = start.toLocaleTimeString([], { timeZone: meeting.timezone, hour: '2-digit', minute: '2-digit' });
    return `${local} (${theirs} ${meeting.timezone})`;
  }
  return local;
}

function startsSoon(meeting) {
  const start = new Date(meeting.scheduled_start).getTime();
  return start - Date.now() < 15 * 60 * 1000;
}

function MomBadge({ session }) {
  if (session.status === 'summarizing' || session.status === 'transcribing' || session.status === 'uploading') {
    return (
      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Processing
      </span>
    );
  }
  if (session.status === 'failed') {
    return <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded">Failed</span>;
  }
  if (session.mom_status === 'approved') {
    return (
      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded flex items-center gap-1">
        <Lock className="w-3 h-3" /> Approved
      </span>
    );
  }
  return (
    <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3" /> Draft
    </span>
  );
}

export default function Meetings({ workspaceId, workspace, workspaces = [], onSelectWorkspace, user, sessions, onRefreshSessions, onRefreshDocuments, onBack }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [members, setMembers] = useState([]);
  const [dialog, setDialog] = useState(null); // { mode: 'create' } | { mode: 'edit', meeting }
  const [joining, setJoining] = useState(null); // meeting being joined (pre-join screen)
  const [inCall, setInCall] = useState(null); // { meeting, stream, state }
  const [momSessionId, setMomSessionId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [instantTitle, setInstantTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const startingRef = useRef(false); // a double click must not start two meetings
  const teamWorkspace = workspaces.find((w) => w.type !== 'personal' && w.id !== workspaceId);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setMeetings(await api.listMeetings(workspaceId, 'upcoming'));
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    load();
    api.getWorkspaceMembers(workspaceId).then(setMembers).catch(() => setMembers([]));
  }, [load, workspaceId]);

  // Keep the list fresh (someone else starts, cancels or ends a meeting) while in the lobby.
  useEffect(() => {
    if (inCall) return undefined;
    const timer = setInterval(load, REFRESH_MS);
    const onNotification = (e) => {
      if (e.detail?.category === 'meetings' || e.detail?.category === 'mom') {
        load();
        onRefreshSessions?.();
      }
    };
    window.addEventListener('nexamind:notification', onNotification);
    return () => {
      clearInterval(timer);
      window.removeEventListener('nexamind:notification', onNotification);
    };
  }, [inCall, load, onRefreshSessions]);

  const openJoin = useCallback(
    async (meetingOrId) => {
      try {
        const meeting = typeof meetingOrId === 'string' ? await api.getMeeting(workspaceId, meetingOrId) : meetingOrId;
        if (meeting.status === 'ended' || meeting.status === 'cancelled') {
          notify(`This meeting has ${meeting.status === 'ended' ? 'ended' : 'been cancelled'}.`, 'info');
          if (meeting.session_id) setMomSessionId(meeting.session_id);
          return;
        }
        setJoining(meeting);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [workspaceId],
  );

  // Notifications link straight to a meeting (join) or to its minutes.
  useEffect(
    () =>
      onDeepLink('meetings', (link) => {
        if (link.session_id) setMomSessionId(link.session_id);
        else if (link.meeting_id && link.join) openJoin(link.meeting_id);
        else if (link.meeting_id) {
          api.getMeeting(workspaceId, link.meeting_id).then(
            (m) => (m.session_id ? setMomSessionId(m.session_id) : m.status === 'live' ? setJoining(m) : null),
            (err) => notify(err.message, 'error'),
          );
        }
      }),
    [openJoin, workspaceId],
  );

  const startInstant = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const meeting = await api.startInstantMeeting(workspaceId, {
        title: instantTitle.trim() || `${user?.name || 'Team'}'s meeting`,
        client_request_id: newId(),
      });
      setInstantTitle('');
      setJoining(meeting);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const submitDialog = async (payload) => {
    if (dialog.mode === 'edit') {
      await api.updateMeeting(workspaceId, dialog.meeting.id, payload);
      notify('Meeting updated. Invitees were told.', 'success');
    } else {
      const meeting = await api.scheduleMeeting(workspaceId, payload);
      notify(`“${meeting.title}” scheduled for ${formatWhen(meeting)}.`, 'success');
    }
    setDialog(null);
    load();
  };

  const cancelMeeting = async (meeting) => {
    const ok = await confirmDialog(`Cancel “${meeting.title}” on ${formatWhen(meeting)}? Invitees are notified.`, {
      title: 'Cancel meeting?',
      confirmLabel: 'Cancel meeting',
    });
    if (!ok) return;
    try {
      await api.cancelMeeting(workspaceId, meeting.id);
      notify('Meeting cancelled.', 'success');
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const uploadRecording = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      await api.uploadSessionFile(workspaceId, file, title);
      notify('Recording uploaded. The transcript and draft minutes appear below when ready.', 'success');
      onRefreshSessions?.();
      onRefreshDocuments?.();
    } catch (err) {
      notify(`Upload failed: ${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const deleteSession = async (sessionId) => {
    if (!(await confirmDialog('This permanently deletes the session, its transcript and minutes.', { title: 'Delete?', confirmLabel: 'Delete' }))) return;
    try {
      await api.deleteSession(workspaceId, sessionId);
      setMomSessionId(null);
      onRefreshSessions?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  if (inCall) {
    return (
      <MeetingRoom
        key={inCall.meeting.id}
        workspaceId={workspaceId}
        meeting={inCall.meeting}
        user={user}
        localStream={inCall.stream}
        initialState={inCall.state}
        onExit={({ ended, sessionId }) => {
          setInCall(null);
          load();
          onRefreshSessions?.();
          if (ended && sessionId && inCall.meeting.is_host) setMomSessionId(sessionId);
        }}
      />
    );
  }

  const live = meetings.filter((m) => m.status === 'live');
  const upcoming = meetings.filter((m) => m.status === 'scheduled');
  const card = 'bg-white border border-slate-200 rounded-2xl shadow-sm';

  return (
    <div className="h-full w-full text-slate-900">
      <div className="space-y-6 max-w-6xl mx-auto py-2">
        <FeatureHeader
          title="Meetings"
          subtitle="Video meetings with live transcription, and minutes you review before they become tasks."
          icon={Video}
          onBack={onBack}
          actions={
            <button type="button" onClick={() => setDialog({ mode: 'create' })} className="px-4 py-2.5 rounded-xl text-xs font-bold bg-white border border-slate-300 hover:border-indigo-400 flex items-center gap-2">
              <CalendarPlus className="w-4 h-4 text-indigo-600" /> Schedule
            </button>
          }
        />

        {workspace?.type === 'personal' && teamWorkspace && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900">
            <p className="text-sm">
              You're in your personal workspace. Team meetings happen in <strong>{teamWorkspace.name}</strong>.
            </p>
            <button type="button" onClick={() => onSelectWorkspace?.(teamWorkspace.id)} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold shrink-0">
              Switch to {teamWorkspace.name}
            </button>
          </div>
        )}

        {live.length > 0 && (
          <section className="space-y-3" aria-label="Live meetings">
            {live.map((m) => (
              <div key={m.id} className="bg-emerald-50 border-2 border-emerald-400 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    <Radio className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-emerald-800">
                      LIVE · {m.participant_count} {m.participant_count === 1 ? 'person' : 'people'} in the call
                    </p>
                    <h3 className="font-bold truncate">{m.title}</h3>
                    <p className="text-xs text-slate-600">Host: {m.organizer_name || 'Unknown'}</p>
                  </div>
                </div>
                <button type="button" onClick={() => openJoin(m)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shrink-0 flex items-center justify-center gap-2">
                  <Video className="w-4 h-4" /> Join
                </button>
              </div>
            ))}
          </section>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`${card} p-5 space-y-3`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold">Start a meeting now</h3>
                <p className="text-xs text-slate-500">Workspace members are notified and can join.</p>
              </div>
            </div>
            <div className="flex flex-col xl:flex-row gap-2">
              <input
                aria-label="Meeting title"
                value={instantTitle}
                onChange={(e) => setInstantTitle(e.target.value)}
                maxLength={255}
                placeholder="Title (optional)"
                className="flex-1 min-w-0 bg-slate-100 border border-slate-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-sm focus:outline-none"
              />
              <button type="button" onClick={startInstant} disabled={starting} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50">
                {starting ? 'Starting…' : 'Start'}
              </button>
            </div>
          </div>
          <div className={`${card} p-5 space-y-3`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold">Upload a recording</h3>
                <p className="text-xs text-slate-500">Audio or video of a meeting held elsewhere: transcript and draft minutes.</p>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="audio/*,video/*" className="hidden" onChange={uploadRecording} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 rounded-xl text-sm font-bold transition-colors duration-fast disabled:opacity-50">
              {uploading ? 'Uploading…' : 'Choose file'}
            </button>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-indigo-600" /> Upcoming
          </h2>
          <div className={`${card} divide-y divide-slate-200 overflow-hidden`}>
            {loading ? (
              <div className="p-6 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : loadError ? (
              <div className="p-6 text-center text-sm text-rose-600">
                {loadError}{' '}
                <button type="button" onClick={load} className="underline font-bold">
                  Retry
                </button>
              </div>
            ) : upcoming.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 space-y-2">
                <CalendarClock className="w-8 h-8 mx-auto text-slate-300" />
                <p>No meetings scheduled.</p>
                <button type="button" onClick={() => setDialog({ mode: 'create' })} className="text-indigo-600 font-bold underline">
                  Schedule one
                </button>
              </div>
            ) : (
              upcoming.map((m) => (
                <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm truncate">{m.title}</h4>
                    <p className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatWhen(m)} · {m.duration_minutes} min
                      </span>
                      {m.recurrence !== 'none' && (
                        <span className="flex items-center gap-1">
                          <Repeat className="w-3 h-3" /> {m.recurrence}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {m.invitees.length ? `${m.invitees.length} invited` : 'Whole workspace'}
                      </span>
                      <span>Host: {m.organizer_name || 'Unknown'}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {m.is_host && (
                      <>
                        <button type="button" onClick={() => setDialog({ mode: 'edit', meeting: m })} aria-label={`Edit ${m.title}`} className="p-2 rounded-xl text-slate-500 hover:bg-slate-100">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => cancelMeeting(m)} aria-label={`Cancel ${m.title}`} className="p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50">
                          <XCircle className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => openJoin(m)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold ${startsSoon(m) ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                    >
                      {m.is_host ? 'Start' : 'Join'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2">
            <FileText className="w-4 h-4 text-violet-600" /> Past meetings & minutes
          </h2>
          <div className={`${card} divide-y divide-slate-200 overflow-hidden`}>
            {sessions?.length ? (
              sessions.map((s) => (
                <button key={s.id} type="button" onClick={() => setMomSessionId(s.id)} className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm truncate">{s.title}</h4>
                    <p className="text-xs text-slate-500">
                      {s.created_at ? new Date(s.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                      {s.meeting_id ? ' · Meeting' : ' · Uploaded recording'}
                    </p>
                  </div>
                  <MomBadge session={s} />
                </button>
              ))
            ) : (
              <p className="p-8 text-center text-sm text-slate-500">Minutes appear here after a meeting ends or a recording is processed.</p>
            )}
          </div>
        </section>
      </div>

      {dialog && (
        <ScheduleMeetingDialog
          meeting={dialog.mode === 'edit' ? dialog.meeting : null}
          members={members}
          currentUserId={user?.id}
          onSubmit={submitDialog}
          onClose={() => setDialog(null)}
        />
      )}

      {joining && (
        <PreJoin
          meeting={joining}
          user={user}
          onCancel={() => setJoining(null)}
          onJoin={(stream, state) => {
            setInCall({ meeting: joining, stream, state });
            setJoining(null);
          }}
        />
      )}

      {momSessionId && (
        <MomReview
          workspaceId={workspaceId}
          sessionId={momSessionId}
          onClose={() => setMomSessionId(null)}
          onDelete={() => deleteSession(momSessionId)}
          onChanged={onRefreshSessions}
        />
      )}
    </div>
  );
}
