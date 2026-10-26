import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Captions,
  Hand,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  MonitorOff,
  MoreHorizontal,
  PhoneOff,
  RefreshCw,
  Send,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from 'lucide-react';
import { api } from '../../api';
import { MeetingClient, newId } from '../../lib/meetingClient';
import { MeetingTranscriber } from '../../lib/meetingTranscriber';
import { notify } from '../../context/ToastContext';
import { navigateTo } from '../../lib/deepLink';
import { useAttachmentDraft } from '../../lib/chatAttachments';
import { AttachButton, AttachmentTray, DropZone } from '../chat/AttachmentComposer';
import FilePickerDialog from '../chat/FilePickerDialog';
import MessageAttachments from '../chat/MessageAttachments';

const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export function describeMediaError(err, device) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `${device} permission was blocked. Allow it from the address bar's site settings, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${device.toLowerCase()} was found.`;
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `The ${device.toLowerCase()} is being used by another app or couldn't be started.`;
  }
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser (or an insecure http:// page) cannot use the camera or microphone.';
  return `${device} error: ${err?.message || name || 'unknown'}`;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// A stream's tracks change by addTrack() (no event fires), so elements are keyed by track id.
const trackKey = (st, kind = 'video') => (kind === 'video' ? st?.getVideoTracks() : st?.getAudioTracks())?.[0]?.id || 'none';

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function gridClass(count) {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 9) return 'grid-cols-2 md:grid-cols-3';
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
}

/** A <video> bound to a MediaStream; reports whether frames are actually arriving. */
function StreamVideo({ stream, muted = true, mirror = false, fit = 'cover', onLive, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    if (video.srcObject !== stream) video.srcObject = stream || null;
    const play = () => video.play().catch(() => {});
    play();
    const track = () => stream?.getVideoTracks()[0];
    // A muted remote track only means no new frames (a still slide or tab sends none): once a frame
    // has been decoded it stays on screen. Only an ended or missing track counts as not live.
    const update = () => {
      const t = track();
      onLive?.(!!t && t.readyState === 'live' && (video.readyState >= 2 || !t.muted));
    };
    const bind = () => {
      const t = track();
      if (t) {
        t.addEventListener('mute', update);
        t.addEventListener('unmute', update);
        t.addEventListener('ended', update);
      }
      update();
    };
    const onAdd = () => {
      bind();
      play();
    };
    stream?.addEventListener?.('addtrack', onAdd);
    stream?.addEventListener?.('removetrack', update);
    video.addEventListener('loadeddata', update);
    video.addEventListener('playing', update);
    bind();
    return () => {
      stream?.removeEventListener?.('addtrack', onAdd);
      stream?.removeEventListener?.('removetrack', update);
      video.removeEventListener('loadeddata', update);
      video.removeEventListener('playing', update);
      const t = track();
      t?.removeEventListener('mute', update);
      t?.removeEventListener('unmute', update);
      t?.removeEventListener('ended', update);
    };
  }, [stream, onLive]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`${fit === 'contain' ? 'object-contain' : 'object-cover'} ${mirror ? '-scale-x-100' : ''} ${className}`}
    />
  );
}

function RemoteAudio({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    el.srcObject = stream || null;
    const play = () => el.play().catch(() => {});
    play();
    stream?.addEventListener?.('addtrack', play);
    return () => stream?.removeEventListener?.('addtrack', play);
  }, [stream]);
  return <audio ref={ref} autoPlay data-testid="remote-audio" />;
}

// Memoised: chat, transcript and speaker-level updates re-render the room several times a second;
// a tile only needs to re-render when its own participant changes.
const Tile = React.memo(function Tile({ name, stream, camOn, micOn, hand, speaking, isSelf, connection, isHost, compact = false }) {
  const [live, setLive] = useState(false);
  const showVideo = camOn && !!stream && live;
  return (
    <div
      className={`relative rounded-2xl overflow-hidden bg-[#232836] border-2 transition-colors ${
        speaking ? 'border-emerald-400' : 'border-transparent'
      } ${compact ? 'aspect-video min-w-[9rem] sm:min-w-0' : 'min-h-[8rem] h-full'} flex items-center justify-center`}
      data-testid="participant-tile"
      data-name={name}
    >
      {stream && camOn && (
        <StreamVideo key={trackKey(stream)} stream={stream} mirror={isSelf} onLive={setLive} className={`absolute inset-0 w-full h-full ${showVideo ? '' : 'invisible'}`} />
      )}
      {!showVideo && (
        <div className="flex flex-col items-center gap-2">
          <div className={`${compact ? 'w-10 h-10 text-sm' : 'w-16 h-16 sm:w-20 sm:h-20 text-xl'} rounded-full bg-indigo-500/80 flex items-center justify-center font-bold text-white`}>
            {initials(name)}
          </div>
          {camOn && stream && !live && connection === 'connected' && <span className="text-xs text-slate-400">Starting video…</span>}
        </div>
      )}
      {connection && connection !== 'connected' && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 text-amber-300 text-xs px-2 py-1 rounded-lg">
          <Loader2 className="w-3 h-3 animate-spin" />
          {connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
        </div>
      )}
      {hand && (
        <div className="absolute top-2 right-2 bg-amber-400 text-black rounded-full p-1.5" title="Hand raised">
          <Hand className="w-4 h-4" />
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
        <span className="bg-black/60 text-white text-xs px-2 py-1 rounded-lg truncate max-w-full">
          {name}
          {isSelf ? ' (You)' : ''}
          {isHost ? ' · Host' : ''}
        </span>
        {!micOn && (
          <span className="bg-rose-600/90 text-white rounded-lg p-1" title="Muted" aria-label="Muted">
            <MicOff className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  );
});

function ControlButton({ onClick, active = true, danger = false, label, children, disabled = false, badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={danger ? undefined : active}
      className={`relative w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition shrink-0 disabled:opacity-40 ${
        danger
          ? 'bg-rose-600 hover:bg-rose-700 text-white'
          : active
            ? 'bg-slate-700 hover:bg-slate-600 text-white'
            : 'bg-rose-500/90 hover:bg-rose-500 text-white'
      }`}
    >
      {children}
      {badge ? (
        <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-indigo-500 text-[10px] font-bold flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

/** Device check before joining: preview, toggles, and clear messages when a device fails. */
export function PreJoin({ meeting, user, onJoin, onCancel }) {
  const [stream, setStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const streamRef = useRef(null);
  const handedOver = useRef(false);

  const acquire = useCallback(async () => {
    setLoading(true);
    const next = new MediaStream();
    const errs = {};
    if (!navigator.mediaDevices?.getUserMedia) {
      errs.audio = describeMediaError(null, 'Microphone');
    } else {
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        a.getAudioTracks().forEach((t) => next.addTrack(t));
      } catch (err) {
        errs.audio = describeMediaError(err, 'Microphone');
      }
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        v.getVideoTracks().forEach((t) => next.addTrack(t));
      } catch (err) {
        errs.video = describeMediaError(err, 'Camera');
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = next;
    setStream(next);
    setErrors(errs);
    setMicOn(!errs.audio);
    setCamOn(!errs.video);
    setLoading(false);
  }, []);

  useEffect(() => {
    acquire();
    return () => {
      if (!handedOver.current) streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [acquire]);

  const toggleMic = () => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !micOn;
    setMicOn(!micOn);
  };
  const toggleCam = () => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !camOn;
    setCamOn(!camOn);
  };

  const join = () => {
    if (joining) return;
    setJoining(true);
    const s = streamRef.current || new MediaStream();
    // Camera off at join: release it so the light goes off.
    if (!camOn) {
      s.getVideoTracks().forEach((t) => {
        t.stop();
        s.removeTrack(t);
      });
    }
    handedOver.current = true;
    onJoin(s, { mic: micOn && s.getAudioTracks().length > 0, cam: camOn && s.getVideoTracks().length > 0 });
  };

  return (
    <div className="palette-light fixed inset-0 z-50 bg-[#12151C] text-white overflow-y-auto" data-modal>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-3xl grid gap-6 md:grid-cols-[1.4fr_1fr] items-center">
          <div className="relative aspect-video rounded-2xl overflow-hidden bg-[#232836] flex items-center justify-center">
            {stream && camOn && stream.getVideoTracks().length > 0 ? (
              <StreamVideo stream={stream} mirror className="absolute inset-0 w-full h-full" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-indigo-500/80 flex items-center justify-center text-2xl font-bold">
                {initials(user?.name)}
              </div>
            )}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            )}
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-3">
              <ControlButton onClick={toggleMic} active={micOn} disabled={!stream?.getAudioTracks().length} label={micOn ? 'Turn off microphone' : 'Turn on microphone'}>
                {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </ControlButton>
              <ControlButton onClick={toggleCam} active={camOn} disabled={!stream?.getVideoTracks().length} label={camOn ? 'Turn off camera' : 'Turn on camera'}>
                {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </ControlButton>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-400">Ready to join?</p>
              <h2 className="text-xl font-bold break-words">{meeting.title}</h2>
              <p className="text-sm text-slate-400">
                {meeting.participant_count
                  ? `${meeting.participant_count} ${meeting.participant_count === 1 ? 'person is' : 'people are'} in the meeting`
                  : 'No one else is here yet'}
              </p>
            </div>
            {(errors.audio || errors.video) && (
              <div className="space-y-2 text-sm bg-amber-500/10 border border-amber-500/40 text-amber-200 rounded-xl p-3" role="alert">
                {errors.audio && <p>🎙 {errors.audio}</p>}
                {errors.video && <p>📷 {errors.video}</p>}
                <button type="button" onClick={acquire} className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-100 underline">
                  <RefreshCw className="w-3.5 h-3.5" /> Try again
                </button>
              </div>
            )}
            {meeting.transcription_enabled && (
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <Captions className="w-4 h-4" /> This meeting is transcribed for the minutes.
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={join}
                disabled={loading || joining}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl py-3 font-bold"
              >
                {joining ? 'Joining…' : 'Join now'}
              </button>
              <button type="button" onClick={onCancel} className="px-4 rounded-xl bg-slate-700 hover:bg-slate-600 font-bold">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EndDialog({ isHost, busy, onEndForMe, onEndForAll, onCancel }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div
        data-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-meeting-title"
        className="palette-light w-full max-w-sm bg-[#1E2330] border border-slate-700 rounded-2xl p-5 space-y-4 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="end-meeting-title" className="text-lg font-bold">
          {isHost ? 'End the meeting?' : 'Leave the meeting?'}
        </h2>
        <p className="text-sm text-slate-300">
          {isHost
            ? 'Leave and let the others carry on, or end it for everyone. Ending for everyone disconnects all participants and starts drafting the minutes.'
            : 'The meeting will continue without you. You can rejoin while it is running.'}
        </p>
        <div className="space-y-2">
          <button type="button" disabled={busy} onClick={onEndForMe} className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 font-bold disabled:opacity-50">
            {isHost ? 'End for me' : 'Leave meeting'}
          </button>
          {isHost && (
            <button type="button" disabled={busy} onClick={onEndForAll} className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 font-bold disabled:opacity-50">
              {busy ? 'Ending…' : 'End for all'}
            </button>
          )}
          <button type="button" disabled={busy} onClick={onCancel} className="w-full py-2 rounded-xl text-slate-300 hover:bg-slate-800 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ messages, userId, onSend, onRetry, base, workspaceId }) {
  const [text, setText] = useState('');
  const draft = useAttachmentDraft(base);
  const [picking, setPicking] = useState(false);
  const addFiles = (files) => draft.addFiles(files).forEach((problem) => notify(problem, 'error'));
  const openPage = (att) => navigateTo({ tab: 'documents', workspace_id: att.workspace_id, document_id: att.document_id });
  const [replyTo, setReplyTo] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const endRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value && !draft.hasItems) return;
    if (draft.busy) {
      notify('Wait for the files to finish uploading.', 'info');
      return;
    }
    if (draft.failed) {
      notify('Some files failed to upload: retry or remove them first.', 'error');
      return;
    }
    onSend(value, replyTo, draft.hasItems ? { payload: draft.payload(), items: draft.items } : null);
    setText('');
    setReplyTo(null);
    draft.clear();
  };
  const startReply = (m) => {
    const files = (m.attachments || []).map((a) => a.name).join(', ');
    setReplyTo({ id: m.id, sender_name: m.sender_name, excerpt: (m.content || (files ? `📎 ${files}` : '')).slice(0, 140) });
    inputRef.current?.focus();
  };
  const jumpTo = (id) => {
    const el = listRef.current?.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1600);
  };
  const loaded = new Set(messages.map((m) => m.id));
  return (
    <div className="flex flex-col h-full min-h-0">
      <DropZone onFiles={addFiles} className="flex-1 min-h-0 flex flex-col">
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 p-4 min-h-0">
        {messages.length === 0 && <p className="text-sm text-slate-400 text-center mt-8">No messages yet. Messages are kept with the meeting.</p>}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const quote = m.reply_to;
          return (
            <div
              key={m.client_message_id || m.id}
              data-message-id={m.id}
              className={`group flex flex-col ${mine ? 'items-end' : 'items-start'} rounded-lg transition-colors ${highlight === m.id ? 'bg-indigo-500/20' : ''}`}
            >
              <span className="text-[11px] text-slate-400">
                {mine ? 'You' : m.sender_name} · {m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              {(m.content || quote) && (
              <div className={`text-sm px-3 py-2 rounded-xl max-w-[85%] break-words whitespace-pre-wrap ${mine ? 'bg-indigo-600' : 'bg-slate-700'} ${m.pending ? 'opacity-60' : ''}`}>
                {quote && (
                  <button
                    type="button"
                    onClick={() => jumpTo(quote.id)}
                    disabled={!quote.available || !loaded.has(quote.id)}
                    className="block w-full text-left mb-1.5 pl-2 border-l-2 border-white/50 text-xs text-white/80 disabled:cursor-default"
                    aria-label={quote.available ? `Replying to ${quote.sender_name}: ${quote.excerpt}` : 'Original message unavailable'}
                  >
                    {quote.available ? (
                      <>
                        <span className="font-semibold block">{quote.sender_name}</span>
                        <span className="line-clamp-2">{quote.excerpt}</span>
                      </>
                    ) : (
                      <span className="italic">Original message unavailable</span>
                    )}
                  </button>
                )}
                {m.content}
              </div>
              )}
              {m.pending && m.localFiles?.length ? (
                <p className="text-[11px] text-slate-400">📎 {m.localFiles.map((f) => f.name).join(', ')}</p>
              ) : (
                <div className="max-w-[85%]">
                  <MessageAttachments attachments={m.attachments} base={base} tone="dark" onOpenPage={openPage} />
                </div>
              )}
              <div className="flex items-center gap-2">
                {m.pending && <span className="text-[11px] text-slate-500">Sending…</span>}
                {m.failed && (
                  <button type="button" onClick={() => onRetry?.(m)} className="text-[11px] text-rose-300 underline py-1">
                    Not sent · Retry
                  </button>
                )}
                {!m.pending && !m.failed && m.id && (
                  <button
                    type="button"
                    onClick={() => startReply(m)}
                    className="text-[11px] text-slate-400 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 py-1"
                    aria-label={`Reply to ${mine ? 'your message' : m.sender_name}`}
                  >
                    Reply
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      </DropZone>
      <form
        onSubmit={submit}
        onPaste={(e) => e.clipboardData?.files?.length && addFiles(e.clipboardData.files)}
        className="p-3 border-t border-slate-700 space-y-2"
      >
        <AttachmentTray draft={draft} tone="dark" />
        {replyTo && (
          <div className="flex items-start gap-2 bg-slate-800 rounded-lg px-3 py-2 text-xs" data-testid="reply-preview">
            <div className="flex-1 min-w-0 border-l border-white/40 pl-2">
              <span className="font-semibold text-indigo-300 block">Replying to {replyTo.sender_name}</span>
              <span className="text-slate-300 line-clamp-2 break-words">{replyTo.excerpt}</span>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="p-1 rounded hover:bg-slate-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <AttachButton onFiles={addFiles} onShareExisting={workspaceId ? () => setPicking(true) : null} tone="dark" />
          <input
            ref={inputRef}
            aria-label="Message everyone"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && replyTo) {
                e.stopPropagation();
                setReplyTo(null);
              }
            }}
            maxLength={2000}
            placeholder={replyTo ? 'Write a reply' : 'Message everyone'}
            className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button type="submit" aria-label="Send message" disabled={draft.busy} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-3 min-w-[44px]">
            <Send className="w-4 h-4 mx-auto" />
          </button>
        </div>
      </form>
      {picking && <FilePickerDialog workspaceId={workspaceId} onPick={draft.addShared} onClose={() => setPicking(false)} />}
    </div>
  );
}

function TranscriptPanel({ segments, enabled, status, isHost, onToggle, onRetry }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [segments.length]);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-slate-700 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${enabled && status?.status === 'recording' ? 'bg-rose-500 animate-pulse' : 'bg-slate-500'}`} />
            {!enabled ? 'Transcription is off' : status?.mode === 'browser' ? 'Transcribing (browser speech recognition)' : 'Transcribing'}
          </span>
          {isHost && (
            <button type="button" onClick={onToggle} className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600">
              {enabled ? 'Turn off' : 'Turn on'}
            </button>
          )}
        </div>
        {enabled && status?.error && (
          <div className="flex items-start gap-2 text-amber-300 text-xs" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{status.error}</span>
            {status.failed > 0 && (
              <button type="button" onClick={onRetry} className="font-bold underline">
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
        {segments.length === 0 && <p className="text-sm text-slate-400 text-center mt-8">Nothing transcribed yet.</p>}
        {segments.map((s) => (
          <p key={s.id} className="text-sm">
            <span className="text-slate-500 font-mono text-xs mr-1.5">{formatDuration(s.offset_ms / 1000)}</span>
            <strong className="text-indigo-300">{s.speaker_name}:</strong> {s.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export default function MeetingRoom({ workspaceId, meeting: initialMeeting, user, localStream, initialState, onExit, isCall = false, libraryWorkspaceId }) {
  const [meeting, setMeeting] = useState(initialMeeting);
  const [panel, setPanel] = useState(null); // 'chat' | 'people' | 'transcript'
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [segments, setSegments] = useState([]);
  const [transcription, setTranscription] = useState({ enabled: initialMeeting.transcription_enabled, mode: null, chunkSeconds: 15 });
  const [txStatus, setTxStatus] = useState(null);
  const [showEnd, setShowEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  const clientRef = useRef(null);
  const transcriberRef = useRef(null);
  const pendingChat = useRef(new Map());

  if (!clientRef.current) {
    const audio = localStream.getAudioTracks()[0];
    if (audio) audio.enabled = initialState.mic;
    clientRef.current = new MeetingClient({ workspaceId, meetingId: initialMeeting.id, localStream });
    clientRef.current.mic = initialState.mic;
    clientRef.current.cam = initialState.cam;
  }
  const client = clientRef.current;
  useSyncExternalStore(client.subscribe, client.getVersion);

  const addMessage = useCallback((message) => {
    setMessages((prev) => {
      const key = message.client_message_id || message.id;
      const index = prev.findIndex((m) => (m.client_message_id || m.id) === key);
      if (index >= 0) {
        const next = prev.slice();
        next[index] = message;
        return next;
      }
      return [...prev, message].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    });
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      const list = await api.getMeetingMessages(workspaceId, initialMeeting.id);
      list.forEach((m) => {
        pendingChat.current.delete(m.client_message_id);
        addMessage(m);
      });
    } catch {
      /* shown as empty; retried on reconnect */
    }
  }, [workspaceId, initialMeeting.id, addMessage]);

  const startTranscriber = useCallback((mode, chunkSeconds) => {
    if (!mode) return;
    if (!transcriberRef.current) {
      transcriberRef.current = new MeetingTranscriber({
        workspaceId,
        meetingId: initialMeeting.id,
        startedAt: initialMeeting.started_at,
        mode,
        chunkSeconds,
        onChange: setTxStatus,
      });
    }
    transcriberRef.current.start(client.localStream.getAudioTracks()[0] || null);
  }, [workspaceId, initialMeeting.id, initialMeeting.started_at, client]);

  // Connect once; leave on unmount.
  useEffect(() => {
    let cancelled = false;
    client.onMessage = (msg) => {
      if (msg.type === 'chat_message') {
        pendingChat.current.delete(msg.message.client_message_id);
        addMessage(msg.message);
        if (panelRef.current !== 'chat' && msg.message.sender_id !== String(user?.id)) setUnread((n) => n + 1);
      } else if (msg.type === 'transcript_segment') {
        setSegments((prev) => (prev.some((s) => s.id === msg.segment.id) ? prev : [...prev, msg.segment].sort((a, b) => a.offset_ms - b.offset_ms)));
      } else if (msg.type === 'transcription') {
        setTranscription((t) => ({ ...t, enabled: msg.enabled }));
        notify(`${msg.by} turned transcription ${msg.enabled ? 'on' : 'off'}.`, 'info');
      } else if (msg.type === 'reconnected') {
        loadMessages();
        // Resend chat messages that never got through (the server ignores duplicates).
        pendingChat.current.forEach((m, id) => client.sendChat(m.content, id, m.replyToId, m.files));
      } else if (msg.type === 'error' && msg.client_message_id && pendingChat.current.has(msg.client_message_id)) {
        // The server refused this message (rate limit): show it as not sent, with Retry.
        pendingChat.current.delete(msg.client_message_id);
        setMessages((prev) => prev.map((m) => (m.client_message_id === msg.client_message_id ? { ...m, pending: false, failed: true } : m)));
        notify(msg.detail || 'Message not sent', 'error');
      } else if (msg.type === 'error') {
        notify(msg.detail || 'Meeting error', 'error');
      }
    };
    // StrictMode runs this effect twice in development: a quick re-run cancels the pending leave.
    clearTimeout(client._unmountTimer);
    if (client._started) return () => scheduleLeave();
    client._started = true;
    (async () => {
      const ice = await api.getIceServers(workspaceId).then((r) => r.iceServers).catch(() => FALLBACK_ICE);
      if (cancelled) return;
      client.iceServers = ice?.length ? ice : FALLBACK_ICE;
      client.connect();
      loadMessages();
      try {
        const t = await api.getMeetingTranscript(workspaceId, initialMeeting.id);
        if (cancelled) return;
        setSegments(t.segments);
        setTranscription({ enabled: t.enabled, mode: t.mode, chunkSeconds: t.chunk_seconds });
      } catch {
        /* the panel shows nothing; transcription simply doesn't start */
      }
    })();
    function scheduleLeave() {
      client._unmountTimer = setTimeout(() => {
        cancelled = true;
        transcriberRef.current?.stop({ final: true });
        if (client.status !== 'ended') client.leave();
      }, 0);
    }
    return () => scheduleLeave();
  }, [client, workspaceId, initialMeeting.id, user?.id, addMessage, loadMessages]);

  // Transcribe while connected and enabled.
  useEffect(() => {
    if (client.status !== 'connected') return;
    if (transcription.enabled && transcription.mode) startTranscriber(transcription.mode, transcription.chunkSeconds);
    else transcriberRef.current?.stop();
  }, [client.status, transcription, startTranscriber]);

  // Leaving the page = leaving the meeting.
  useEffect(() => {
    const warn = (e) => {
      if (client.status === 'connected') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const leave = () => client.leave();
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', leave);
    };
  }, [client]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (client.meeting) setMeeting((m) => ({ ...m, ...client.meeting }));
  }, [client.meeting]);

  const isHost = !!meeting.is_host;
  const participants = [...client.participants.values()];
  const presenterId = client.presenting ? 'self' : client.screenOwner;
  const presenter = presenterId === 'self' ? null : client.participants.get(presenterId);
  const started = meeting.started_at ? new Date(meeting.started_at).getTime() : now;

  const tiles = [
    {
      id: 'self',
      name: user?.name || 'You',
      stream: client.localStream,
      camOn: client.cam,
      micOn: client.mic,
      hand: client.hand,
      speaking: client.speaking.has('self'),
      isSelf: true,
      isHost,
    },
    ...participants.map((p) => ({
      id: p.client_id,
      name: p.name,
      stream: p.stream,
      camOn: p.cam !== false,
      micOn: p.mic !== false,
      hand: p.hand,
      speaking: client.speaking.has(p.client_id),
      connection: p.connection,
      isHost: p.is_host,
    })),
  ];

  const toggleCam = async () => {
    try {
      await client.setCam(!client.cam);
    } catch (err) {
      notify(describeMediaError(err, 'Camera'), 'error');
    }
  };

  const toggleMic = async () => {
    if (!client.localStream.getAudioTracks().length) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        await client.replaceMic(s.getAudioTracks()[0]);
        if (transcription.enabled && transcription.mode) startTranscriber(transcription.mode, transcription.chunkSeconds);
      } catch (err) {
        notify(describeMediaError(err, 'Microphone'), 'error');
      }
      return;
    }
    client.setMic(!client.mic);
  };

  const toggleScreen = async () => {
    if (client.presenting) {
      await client.stopScreenShare();
      return;
    }
    try {
      await client.startScreenShare();
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return; // the user closed the picker
      notify(err?.message || 'Screen sharing failed', 'error');
    }
  };

  const retryChat = (failed) => {
    setMessages((prev) => prev.filter((m) => m.client_message_id !== failed.client_message_id));
    sendChat(failed.content, failed.reply_to && failed.reply_to.available ? failed.reply_to : null,
      failed.filesPayload ? { payload: failed.filesPayload, items: failed.localFiles || [] } : null);
  };

  const sendChat = (content, replyTo = null, files = null) => {
    const id = newId();
    pendingChat.current.set(id, { content, replyToId: replyTo?.id || null, files: files?.payload || null });
    addMessage({
      client_message_id: id, content, sender_id: String(user?.id), sender_name: user?.name, created_at: new Date().toISOString(), pending: true,
      reply_to_id: replyTo?.id || null, reply_to: replyTo ? { ...replyTo, available: true } : null,
      attachments: [], localFiles: files?.items || [], filesPayload: files?.payload || null,
    });
    client.sendChat(content, id, replyTo?.id || null, files?.payload || null);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      notify('Full screen is not available here.', 'error');
    }
  };

  const endForMe = async () => {
    setEnding(true);
    await transcriberRef.current?.stop({ final: true });
    client.leave();
    api.endMeeting(workspaceId, meeting.id, 'me').catch(() => {});
    onExit({ ended: false });
  };

  const endForAll = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await transcriberRef.current?.stop({ final: true });
      const result = await api.endMeeting(workspaceId, meeting.id, 'all');
      client.leave();
      onExit({ ended: true, sessionId: result.session_id });
    } catch (err) {
      setEnding(false);
      notify(err.message || 'Could not end the meeting', 'error');
    }
  };

  const openPanel = (name) => {
    setPanel((p) => (p === name ? null : name));
    if (name === 'chat') setUnread(0);
  };

  // --- ended / failed screens --------------------------------------------------------------

  if (client.status === 'ended' && client.endReason !== 'left') {
    const text = {
      ended: isCall ? (client.error || 'The call ended.').replace('ended the meeting', 'ended the call') : client.error || 'The host ended the meeting.',
      closed: client.error || 'This meeting has ended.',
      not_found: 'This meeting no longer exists or you do not have access.',
      auth: 'Your session expired. Sign in again to rejoin.',
      replaced: 'You joined this meeting from another tab or device, so this window left. Join again here to move back.',
      full: client.error || 'This meeting is full.',
    }[client.endReason] || 'The meeting is over.';
    const stillRunning = client.endReason === 'replaced' || client.endReason === 'full';
    return (
      <div className="palette-light fixed inset-0 z-50 bg-[#12151C] text-white flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm" role="status">
          <PhoneOff className="w-10 h-10 mx-auto text-rose-400" />
          <h2 className="text-xl font-bold">{client.endReason === 'replaced' ? 'Joined elsewhere' : client.endReason === 'full' ? 'Meeting is full' : isCall ? 'Call ended' : 'Meeting ended'}</h2>
          <p className="text-slate-300">{text}</p>
          <button type="button" onClick={() => onExit({ ended: !stillRunning, sessionId: stillRunning ? null : client.meeting?.session_id })} className="bg-indigo-600 hover:bg-indigo-500 rounded-xl px-5 py-2.5 font-bold">
            {isCall ? 'Close' : 'Back to meetings'}
          </button>
        </div>
      </div>
    );
  }

  const drawer = panel && (
    <aside className="fixed inset-0 z-[55] sm:static sm:z-auto sm:w-80 lg:w-96 bg-[#1A1E28] sm:border-l border-slate-800 flex flex-col min-h-0">
      <div className="h-12 px-4 flex items-center justify-between border-b border-slate-800 shrink-0">
        <h3 className="font-bold text-sm">
          {panel === 'chat' ? 'In-call messages' : panel === 'people' ? `People (${tiles.length})` : 'Live transcript'}
        </h3>
        <button type="button" onClick={() => setPanel(null)} aria-label="Close panel" className="p-1.5 rounded-lg hover:bg-slate-700">
          <X className="w-4 h-4" />
        </button>
      </div>
      {panel === 'chat' && <ChatPanel messages={messages} userId={String(user?.id)} onSend={sendChat} onRetry={retryChat}
        base={`/workspaces/${workspaceId}/meetings/${initialMeeting.id}`} workspaceId={libraryWorkspaceId || workspaceId} />}
      {panel === 'transcript' && (
        <TranscriptPanel
          segments={segments}
          enabled={transcription.enabled}
          status={txStatus ? { ...txStatus, mode: transcription.mode } : { mode: transcription.mode }}
          isHost={isHost}
          onToggle={() => client.setTranscription(!transcription.enabled)}
          onRetry={() => transcriberRef.current?.retryFailed()}
        />
      )}
      {panel === 'people' && (
        <ul className="flex-1 overflow-y-auto p-2 min-h-0">
          {tiles.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-800">
              <div className="w-8 h-8 rounded-full bg-indigo-500/80 flex items-center justify-center text-xs font-bold shrink-0">{initials(t.name)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">
                  {t.name}
                  {t.isSelf ? ' (You)' : ''}
                </p>
                <p className="text-xs text-slate-400">
                  {t.isHost ? 'Host' : 'Participant'}
                  {t.connection && t.connection !== 'connected' ? ` · ${t.connection}` : ''}
                </p>
              </div>
              {t.hand && <Hand className="w-4 h-4 text-amber-400" aria-label="Hand raised" />}
              {t.micOn ? <Mic className="w-4 h-4 text-slate-400" aria-label="Microphone on" /> : <MicOff className="w-4 h-4 text-rose-400" aria-label="Muted" />}
              {t.camOn ? <Video className="w-4 h-4 text-slate-400" aria-label="Camera on" /> : <VideoOff className="w-4 h-4 text-rose-400" aria-label="Camera off" />}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );

  const canShareScreen = !!navigator.mediaDevices?.getDisplayMedia;
  const presenterName = presenterId === 'self' ? 'You are' : `${presenter?.name || 'Someone'} is`;

  const secondary = (
    <>
      {canShareScreen && (
        <ControlButton
          onClick={toggleScreen}
          active={!client.presenting}
          disabled={!!client.screenOwner && !client.presenting}
          label={client.presenting ? 'Stop presenting' : client.screenOwner ? 'Someone else is presenting' : 'Present your screen'}
        >
          {client.presenting ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
        </ControlButton>
      )}
      <ControlButton onClick={() => client.setHand(!client.hand)} active={!client.hand} label={client.hand ? 'Lower hand' : 'Raise hand'}>
        <Hand className={`w-5 h-5 ${client.hand ? 'text-amber-300' : ''}`} />
      </ControlButton>
      <ControlButton onClick={() => openPanel('people')} label="People">
        <Users className="w-5 h-5" />
      </ControlButton>
      <ControlButton onClick={() => openPanel('transcript')} label="Live transcript">
        <Captions className="w-5 h-5" />
      </ControlButton>
      {document.fullscreenEnabled && (
        <ControlButton onClick={toggleFullscreen} label={fullscreen ? 'Exit full screen' : 'Full screen'}>
          {fullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
        </ControlButton>
      )}
    </>
  );

  return (
    <div ref={rootRef} className="palette-light fixed inset-0 z-50 flex flex-col bg-[#12151C] text-white overflow-hidden" data-testid="meeting-room">
      {tiles.slice(1).map((t) => (
        <RemoteAudio key={`${t.id}-${trackKey(t.stream, 'audio')}`} stream={t.stream} />
      ))}

      <header className="h-14 px-3 sm:px-5 flex items-center justify-between gap-2 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" aria-hidden="true" />
          <h2 className="font-bold truncate">{meeting.title}</h2>
          <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded shrink-0" aria-label="Meeting duration">
            {formatDuration((now - started) / 1000)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          {transcription.enabled && transcription.mode && (
            <span className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded ${txStatus?.error ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/15 text-rose-300'}`} title={txStatus?.error || 'This meeting is being transcribed'}>
              <Captions className="w-3.5 h-3.5" /> {txStatus?.error ? 'Transcript issue' : 'Transcribing'}
            </span>
          )}
          <span className="flex items-center gap-1 text-slate-300">
            <Users className="w-3.5 h-3.5" /> {tiles.length}
          </span>
        </div>
      </header>

      {(client.status === 'reconnecting' || client.status === 'connecting' || client.status === 'failed') && (
        <div className={`px-4 py-2 text-sm flex items-center justify-center gap-2 ${client.status === 'failed' ? 'bg-rose-600' : 'bg-amber-600'}`} role="status">
          {client.status === 'failed' ? <WifiOff className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
          {client.status === 'connecting' && 'Connecting to the meeting…'}
          {client.status === 'reconnecting' && 'Connection lost. Reconnecting…'}
          {client.status === 'failed' && (
            <>
              {client.error}
              <button type="button" onClick={() => client.retry()} className="underline font-bold">
                Retry
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <main className="flex-1 min-w-0 min-h-0 p-2 sm:p-4 flex flex-col gap-2 sm:gap-3">
          {presenterId ? (
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 sm:gap-3">
              <div className="relative flex-1 min-h-0 rounded-2xl bg-black overflow-hidden flex items-center justify-center" data-testid="screen-stage">
                {presenterId === 'self' ? (
                  <div className="text-center space-y-3 p-4">
                    <Monitor className="w-10 h-10 mx-auto text-indigo-400" />
                    <p className="font-bold">You are presenting to everyone</p>
                    <button type="button" onClick={toggleScreen} className="bg-rose-600 hover:bg-rose-700 rounded-xl px-4 py-2 text-sm font-bold">
                      Stop presenting
                    </button>
                  </div>
                ) : (
                  <ScreenView stream={presenter?.screenStream} />
                )}
                <span className="absolute top-2 left-2 bg-black/70 text-xs px-2 py-1 rounded-lg flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5" /> {presenterName} presenting
                </span>
              </div>
              <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:w-56 shrink-0">
                {tiles.map((t) => (
                  <div key={t.id} className="w-40 sm:w-48 lg:w-full shrink-0">
                    <Tile {...t} compact />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={`flex-1 min-h-0 grid gap-2 sm:gap-3 auto-rows-fr overflow-y-auto ${gridClass(tiles.length)}`}>
              {tiles.map((t) => (
                <Tile key={t.id} {...t} />
              ))}
            </div>
          )}
        </main>
        {drawer}
      </div>

      <footer className="shrink-0 border-t border-slate-800 px-2 py-2 sm:py-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* Phones: the secondary controls open in a row above the bar, so Leave is never pushed off-screen. */}
        {moreOpen && <div className="flex sm:hidden items-center justify-center gap-2 pb-2 flex-wrap">{secondary}</div>}
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <ControlButton onClick={toggleMic} active={client.mic} label={client.mic ? 'Mute microphone' : 'Unmute microphone'}>
            {client.mic ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </ControlButton>
          <ControlButton onClick={toggleCam} active={client.cam} label={client.cam ? 'Turn off camera' : 'Turn on camera'}>
            {client.cam ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </ControlButton>
          <ControlButton onClick={() => openPanel('chat')} label="In-call messages" badge={unread}>
            <MessageSquare className="w-5 h-5" />
          </ControlButton>
          <div className="hidden sm:contents">{secondary}</div>
          <span className="sm:hidden">
            <ControlButton onClick={() => setMoreOpen((o) => !o)} active label={moreOpen ? 'Fewer controls' : 'More controls'}>
              <MoreHorizontal className="w-5 h-5" />
            </ControlButton>
          </span>
          <ControlButton onClick={() => setShowEnd(true)} danger label={isHost ? 'End or leave meeting' : 'Leave meeting'}>
            <PhoneOff className="w-5 h-5" />
          </ControlButton>
        </div>
      </footer>

      {showEnd && (
        <EndDialog isHost={isHost} busy={ending} onEndForMe={endForMe} onEndForAll={endForAll} onCancel={() => setShowEnd(false)} />
      )}
    </div>
  );
}

function ScreenView({ stream }) {
  const [live, setLive] = useState(false);
  return (
    <>
      {stream && <StreamVideo key={trackKey(stream)} stream={stream} fit="contain" onLive={setLive} className={`w-full h-full ${live ? '' : 'invisible'}`} />}
      {!live && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Waiting for the shared screen…
        </div>
      )}
    </>
  );
}
