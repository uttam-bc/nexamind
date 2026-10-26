import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { api } from '../../api';
import { notify } from '../../context/ToastContext';
import { useDialog } from '../../lib/dialog';
import { newId } from '../../lib/meetingClient';
import MeetingRoom, { PreJoin } from '../meetings/MeetingRoom';

// Calls from a direct message. Start one with startCall(); an incoming one arrives over the
// notification socket as {type: 'call', event: 'ring' | 'answered' | 'declined' | 'ended'}.
// A call is a meeting of the conversation, so the room has every meeting feature.

const START_EVENT = 'nexamind:start-call';
const NO_ANSWER_MS = 45_000;

/** Start (or rejoin) the call of a direct message from anywhere in the app. */
export function startCall({ workspaceId, channelId, peerName }) {
  window.dispatchEvent(new CustomEvent(START_EVENT, { detail: { workspaceId, channelId, peerName } }));
}

/** A soft two-tone ring, repeated, made with Web Audio (no sound file). */
function useRingtone(active) {
  useEffect(() => {
    if (!active) return undefined;
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return undefined;
    }
    const ring = () => {
      [0, 0.45].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = offset ? 480 : 440;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + offset + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.42);
      });
    };
    ring();
    const timer = setInterval(ring, 2500);
    return () => {
      clearInterval(timer);
      ctx.close().catch(() => {});
    };
  }, [active]);
}

function IncomingCall({ ring, onAccept, onDecline }) {
  const ref = useDialog(true, onDecline);
  const name = ring.caller?.name || 'Someone';
  return (
    <div className="fixed inset-0 z-[95] bg-slate-950/60 flex items-end sm:items-center justify-center p-4">
      <div ref={ref} role="alertdialog" aria-modal="true" aria-label={`Incoming call from ${name}`} tabIndex={-1}
        className="palette-light w-full max-w-sm bg-[#12151C] text-white rounded-2xl shadow-2xl p-6 text-center outline-none" data-testid="incoming-call">
        <div className="relative w-20 h-20 mx-auto mb-4">
          <span className="absolute inset-0 rounded-full bg-indigo-500/40 animate-ping motion-reduce:animate-none" aria-hidden="true" />
          {ring.caller?.avatar_url
            ? <img src={ring.caller.avatar_url} alt="" className="relative w-20 h-20 rounded-full object-cover" />
            : <span className="relative w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-3xl font-bold">{name.slice(0, 1).toUpperCase()}</span>}
        </div>
        <p className="text-lg font-bold">{name}</p>
        <p className="text-sm text-slate-400 flex items-center justify-center gap-1.5 mt-1"><Video className="w-4 h-4" />Incoming video call…</p>
        <div className="flex justify-center gap-8 mt-6">
          <div className="flex flex-col items-center gap-1.5">
            <button type="button" onClick={onDecline} aria-label="Decline call" className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center">
              <PhoneOff className="w-6 h-6" />
            </button>
            <span className="text-xs text-slate-400">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <button type="button" onClick={onAccept} aria-label="Accept call" className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center" autoFocus>
              <Phone className="w-6 h-6" />
            </button>
            <span className="text-xs text-slate-400">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mounted once by App: rings for incoming calls and hosts the call screen. */
export default function CallManager({ user, currentWorkspaceId }) {
  const [ringing, setRinging] = useState(null); // incoming ring frame
  const [call, setCall] = useState(null); // { meeting, outgoing, peerName, phase: 'prejoin' | 'room', stream, state, answered }
  const callRef = useRef(null);
  callRef.current = call;
  const ringTimer = useRef(null);
  useRingtone(Boolean(ringing));

  const stopRinging = useCallback(() => {
    clearTimeout(ringTimer.current);
    setRinging(null);
  }, []);

  // Start a call from a conversation.
  useEffect(() => {
    const onStart = async (e) => {
      const { workspaceId, channelId, peerName } = e.detail;
      if (callRef.current) {
        notify('You are already in a call.', 'info');
        return;
      }
      try {
        const { call: meeting, created } = await api.startCall(workspaceId, channelId, newId());
        setCall({ meeting, outgoing: created, peerName, phase: 'prejoin', answered: !created });
      } catch (err) {
        notify(err.message, 'error');
      }
    };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, []);

  // Ring / answered / declined / ended frames from the notification socket.
  useEffect(() => {
    const onCall = (e) => {
      const msg = e.detail;
      const current = callRef.current;
      if (msg.event === 'ring') {
        if (current) return; // busy: the caller sees a missed call
        setRinging(msg);
        clearTimeout(ringTimer.current);
        ringTimer.current = setTimeout(() => setRinging(null), (msg.ring_seconds || 45) * 1000);
      } else if (msg.event === 'answered') {
        // Only my own answer (on another device) stops my ringing; the caller joining doesn't.
        if (msg.user_id === String(user?.id)) setRinging((r) => (r && r.meeting_id === msg.meeting_id ? null : r));
        if (current?.meeting.id === msg.meeting_id && msg.user_id !== String(user?.id)) {
          setCall((c) => (c ? { ...c, answered: true } : c));
        }
      } else if (msg.event === 'declined') {
        if (current?.meeting.id === msg.meeting_id && msg.user_id !== String(user?.id)) {
          notify(`${msg.name || 'They'} declined the call.`, 'info');
          if (current.phase === 'prejoin') setCall(null);
        }
      } else if (msg.event === 'ended') {
        setRinging((r) => (r && r.meeting_id === msg.meeting_id ? null : r));
        if (current?.meeting.id === msg.meeting_id) {
          if (current.phase === 'prejoin') setCall(null);
          else setCall((c) => (c ? { ...c, over: true } : c)); // the room shows "Call ended"
        }
      }
    };
    window.addEventListener('nexamind:call', onCall);
    return () => window.removeEventListener('nexamind:call', onCall);
  }, [user?.id]);

  // Nobody picked up: end the call so it shows as missed.
  useEffect(() => {
    if (!call?.outgoing || call.answered) return undefined;
    const timer = setTimeout(() => {
      const c = callRef.current;
      if (!c || c.answered) return;
      notify(`${c.peerName || 'They'} didn't answer.`, 'info');
      api.endMeeting(c.meeting.workspace_id, c.meeting.id, 'all').catch(() => {});
      if (c.phase === 'prejoin') setCall(null);
      else setCall((cur) => (cur ? { ...cur, over: true } : cur));
    }, NO_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [call?.outgoing, call?.answered, call?.meeting?.id]);

  const accept = () => {
    const r = ringing;
    stopRinging();
    setCall({ meeting: r.call, outgoing: false, peerName: r.caller?.name, phase: 'prejoin', answered: true });
  };
  const decline = () => {
    const r = ringing;
    stopRinging();
    api.declineCall(r.call.workspace_id, r.meeting_id).catch(() => {});
  };

  const cancelBeforeJoining = () => {
    const c = callRef.current;
    if (c?.outgoing && !c.answered) api.endMeeting(c.meeting.workspace_id, c.meeting.id, 'all').catch(() => {});
    setCall(null);
  };

  return (
    <>
      {ringing && <IncomingCall ring={ringing} onAccept={accept} onDecline={decline} />}
      {call?.phase === 'prejoin' && (
        <PreJoin
          meeting={call.meeting}
          user={user}
          onCancel={cancelBeforeJoining}
          onJoin={(stream, state) => setCall((c) => ({ ...c, phase: 'room', stream, state }))}
        />
      )}
      {call?.phase === 'room' && (
        <>
          <MeetingRoom
            key={call.meeting.id}
            isCall
            workspaceId={call.meeting.workspace_id}
            libraryWorkspaceId={currentWorkspaceId}
            meeting={call.meeting}
            user={user}
            localStream={call.stream}
            initialState={call.state}
            onExit={() => {
              const c = callRef.current;
              // Hanging up before anyone answered cancels the call for the other person too.
              if (c?.outgoing && !c.answered) api.endMeeting(c.meeting.workspace_id, c.meeting.id, 'all').catch(() => {});
              setCall(null);
            }}
          />
          {call.outgoing && !call.answered && !call.over && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-900/90 text-white text-sm px-4 py-2 rounded-full flex items-center gap-2 shadow-lg" role="status">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
              Calling {call.peerName || 'them'}…
            </div>
          )}
        </>
      )}
    </>
  );
}
