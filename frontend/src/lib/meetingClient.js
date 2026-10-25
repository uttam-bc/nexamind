// Live meeting connection: signaling over /ws/workspaces/{wid}/meetings/{mid} and one
// RTCPeerConnection per remote participant (a mesh).
//
// Negotiation never races: whoever was already in the room makes the offer to a newcomer, the
// newcomer only answers. Every connection carries three transceivers in a fixed order (audio,
// camera, screen), so turning the camera on/off or sharing the screen is a replaceTrack() and
// needs no renegotiation. ICE candidates that arrive before the remote description are queued.
// A failed ICE connection is restarted; a dropped socket reconnects and rebuilds the peers.

import { openSocket } from '../api';

const AUDIO = 0;
const CAMERA = 1;
const SCREEN = 2;

// Close codes from the server that mean "don't reconnect".
const FINAL_CLOSE = {
  4000: 'ended',
  4404: 'not_found',
  4410: 'closed',
  4409: 'replaced', // the same person joined from another tab or device
  4429: 'full',
  1008: 'auth',
};

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 10000];
const GIVE_UP_AFTER_MS = 2 * 60 * 1000;
const DISCONNECTED_GRACE_MS = 4000;

// Upload budget (bits/s). In a mesh every viewer gets its own encoded copy of each stream, so
// the presenter's upload and CPU are shared between viewers; without limits a large screen at full
// bitrate starves everything else and frames stall.
const UPLOAD_BUDGET = 3_000_000;
const SCREEN_CAPTURE = {
  width: { ideal: 1920, max: 1920 },
  height: { ideal: 1080, max: 1080 },
  frameRate: { ideal: 15, max: 15 },
};

/** Sender limits for one peer, given how many peers share the upload. */
export function encodingPlan(peerCount, someonePresenting, iAmPresenting) {
  const viewers = Math.max(1, peerCount);
  const clamp = (v, lo, hi) => Math.round(Math.min(hi, Math.max(lo, v)));
  const screen = {
    maxBitrate: clamp((UPLOAD_BUDGET * 0.7) / viewers, 300_000, 2_500_000),
    maxFramerate: 15,
  };
  const camera = someonePresenting
    ? // The shared screen is what people look at: cameras drop to thumbnails.
      { maxBitrate: clamp((UPLOAD_BUDGET * (iAmPresenting ? 0.1 : 0.2)) / viewers, 60_000, 250_000), scaleResolutionDownBy: 4, maxFramerate: 12 }
    : { maxBitrate: clamp(UPLOAD_BUDGET / viewers, 150_000, 1_200_000), scaleResolutionDownBy: viewers > 4 ? 2 : 1, maxFramerate: 24 };
  return { camera, screen };
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export class MeetingClient {
  constructor({ workspaceId, meetingId, iceServers = [], localStream = null, onMessage = null }) {
    this.workspaceId = workspaceId;
    this.meetingId = meetingId;
    this.iceServers = iceServers;
    this.onMessage = onMessage; // chat, transcript and other app-level frames

    this.localStream = localStream || new MediaStream();
    this.screenStream = null;
    this.peers = new Map(); // client_id -> peer
    this.participants = new Map(); // client_id -> public participant info (+ stream data)

    this.status = 'connecting'; // connecting | connected | reconnecting | ended | failed
    this.endReason = null;
    this.error = null;
    this.clientId = null;
    this.meeting = null;
    this.screenOwner = null;
    this.activeSpeaker = null;
    this.speaking = new Set();
    this.mic = this.localStream.getAudioTracks().some((t) => t.enabled);
    this.cam = this.localStream.getVideoTracks().some((t) => t.enabled);
    this.hand = false;

    this._listeners = new Set();
    this._version = 0;
    this._ws = null;
    this._closedByUs = false;
    this._attempt = 0;
    this._disconnectedAt = null;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._pendingScreen = null;
    this._audio = null;
    this._inbox = Promise.resolve();
  }

  // --- subscription (used with React's useSyncExternalStore) -----------------------------

  subscribe = (listener) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getVersion = () => this._version;

  _emit() {
    this._version += 1;
    this._listeners.forEach((fn) => fn());
  }

  // --- socket ------------------------------------------------------------------------------

  connect() {
    this._closedByUs = false;
    this._open();
    this._startSpeakerDetection();
  }

  _open() {
    const ws = openSocket(`/ws/workspaces/${this.workspaceId}/meetings/${this.meetingId}`);
    this._ws = ws;
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      // One frame at a time: an offer and its ICE candidates, or two offers, must not interleave.
      this._inbox = this._inbox
        .then(() => this._handle(msg))
        .catch((err) => console.warn('Meeting message failed', msg?.type, err));
    });
    ws.addEventListener('close', (event) => this._onClose(ws, event));
  }

  _send(payload) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  _onClose(ws, event) {
    if (ws !== this._ws) return;
    clearInterval(this._pingTimer);
    if (this._closedByUs) return;
    const final = FINAL_CLOSE[event.code];
    if (final) {
      this._finish(final, event.reason || null);
      return;
    }
    // Network trouble or a server restart: keep the media, rebuild signaling and peers.
    this._disconnectedAt = this._disconnectedAt || Date.now();
    if (Date.now() - this._disconnectedAt > GIVE_UP_AFTER_MS) {
      this.status = 'failed';
      this.error = 'Lost connection to the meeting.';
      this._emit();
      return;
    }
    this.status = 'reconnecting';
    this._teardownPeers();
    this._emit();
    const delay = RECONNECT_DELAYS[Math.min(this._attempt, RECONNECT_DELAYS.length - 1)];
    this._attempt += 1;
    this._reconnectTimer = setTimeout(() => this._open(), delay);
  }

  /** Try again after the client gave up (status "failed"). */
  retry() {
    if (this.status !== 'failed') return;
    this._disconnectedAt = Date.now();
    this._attempt = 0;
    this.status = 'reconnecting';
    this.error = null;
    this._emit();
    this._open();
  }

  _finish(reason, detail = null) {
    this.status = 'ended';
    this.endReason = reason;
    this.error = detail;
    this._teardownPeers();
    this._stopLocal();
    this._emit();
  }

  /** Leave the meeting (others continue). Stops every track and timer. */
  leave() {
    this._closedByUs = true;
    this._send({ type: 'leave' });
    clearTimeout(this._reconnectTimer);
    clearInterval(this._pingTimer);
    try {
      this._ws?.close(1000, 'left');
    } catch {
      /* already closed */
    }
    this._finish('left');
  }

  // --- incoming frames -------------------------------------------------------------------

  async _handle(msg) {
    switch (msg.type) {
      case 'welcome': {
        const wasReconnect = this.clientId !== null;
        this.clientId = msg.client_id;
        this.meeting = msg.meeting;
        this.status = 'connected';
        this.error = null;
        this._attempt = 0;
        this._disconnectedAt = null;
        this.participants = new Map();
        const self = msg.participants.find((p) => p.client_id === this.clientId);
        this.userId = self?.user_id || this.userId;
        for (const p of msg.participants) {
          if (p.client_id !== this.clientId && !this._isSelf(p)) this._addParticipant(p);
        }
        this.screenOwner = msg.screen_owner;
        if (this.screenOwner === this.clientId) this.screenOwner = null;
        this._send({ type: 'state', mic: this.mic, cam: this.cam, hand: this.hand });
        if (this.screenStream) {
          // We were presenting when the socket dropped: claim the screen again.
          this._pendingScreen = this.screenStream;
          this._send({ type: 'screen_share', active: true });
        }
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => this._send({ type: 'ping' }), 25000);
        this._emit();
        this.onMessage?.({ type: wasReconnect ? 'reconnected' : 'connected' });
        break;
      }
      case 'participant_joined': {
        const p = msg.participant;
        if (p.client_id === this.clientId || this._isSelf(p)) break;
        this._addParticipant(p);
        this._emit();
        await this._offerTo(p.client_id);
        this._tuneSenders();
        break;
      }
      case 'participant_left': {
        this._closePeer(msg.client_id);
        this.participants.delete(msg.client_id);
        if (this.screenOwner === msg.client_id) this.screenOwner = null;
        this._tuneSenders();
        this._emit();
        break;
      }
      case 'participant_state': {
        const p = msg.participant;
        const prev = this.participants.get(p.client_id);
        if (!prev) break; // not (or no longer) in the room: never create a tile from a state update
        this.participants.set(p.client_id, { ...prev, ...p });
        this._emit();
        break;
      }
      case 'screen_share': {
        if (msg.client_id === this.clientId) {
          if (msg.active && this._pendingScreen) {
            this.screenStream = this._pendingScreen;
            this._pendingScreen = null;
            await this._applyTrack(SCREEN, this.screenStream.getVideoTracks()[0] || null);
          }
        } else if (msg.active && this.participants.has(msg.client_id)) {
          this.screenOwner = msg.client_id;
        } else if (this.screenOwner === msg.client_id) {
          this.screenOwner = null;
        }
        this._tuneSenders();
        this._emit();
        break;
      }
      case 'signal':
        await this._onSignal(msg.from, msg.from_name, msg.data || {});
        break;
      case 'error':
        if (msg.code === 'screen_busy' && this._pendingScreen) {
          this._pendingScreen.getTracks().forEach((t) => t.stop());
          this._pendingScreen = null;
          this.screenStream = null;
          this._emit();
        }
        this.onMessage?.(msg);
        break;
      case 'replaced':
        // The server closes this socket next (code 4409); nothing to do until then.
        break;
      case 'meeting_ended':
        this._closedByUs = true;
        this._finish('ended', msg.ended_by ? `${msg.ended_by} ended the meeting.` : null);
        break;
      case 'pong':
        break;
      default:
        this.onMessage?.(msg);
    }
  }

  // --- peers -----------------------------------------------------------------------------

  _createPeer(remoteId, isOfferer) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = {
      id: remoteId,
      pc,
      isOfferer,
      queued: [],
      media: new MediaStream(),
      screen: new MediaStream(),
      restartTimer: null,
    };
    if (isOfferer) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      this._attachLocal(peer);
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) this._signal(remoteId, { kind: 'candidate', candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const index = pc.getTransceivers().indexOf(event.transceiver);
      const target = index === SCREEN ? peer.screen : peer.media;
      target.getTracks().filter((t) => t.kind === event.track.kind).forEach((t) => target.removeTrack(t));
      target.addTrack(event.track);
      this._updateParticipant(remoteId, { stream: peer.media, screenStream: peer.screen });
    };
    pc.onconnectionstatechange = () => this._onConnectionState(peer);
    this.peers.set(remoteId, peer);
    this._updateParticipant(remoteId, { stream: peer.media, screenStream: peer.screen, connection: 'connecting' });
    return peer;
  }

  _onConnectionState(peer) {
    const state = peer.pc.connectionState;
    clearTimeout(peer.restartTimer);
    if (state === 'connected') {
      this._updateParticipant(peer.id, { connection: 'connected' });
      this._tuneSenders();
    } else if (state === 'failed') {
      this._updateParticipant(peer.id, { connection: 'reconnecting' });
      this._restartIce(peer);
    } else if (state === 'disconnected') {
      this._updateParticipant(peer.id, { connection: 'reconnecting' });
      peer.restartTimer = setTimeout(() => {
        if (peer.pc.connectionState === 'disconnected') this._restartIce(peer);
      }, DISCONNECTED_GRACE_MS);
    }
  }

  async _restartIce(peer) {
    if (!this.peers.has(peer.id)) return;
    if (peer.isOfferer) {
      await this._makeOffer(peer, true);
    } else {
      this._signal(peer.id, { kind: 'restart' });
    }
  }

  _isSelf(p) {
    return Boolean(this.userId && p.user_id && p.user_id === this.userId);
  }

  /** Add someone to the room; an older connection of the same person is dropped first. */
  _addParticipant(p) {
    for (const [id, existing] of this.participants) {
      if (id !== p.client_id && existing.user_id && existing.user_id === p.user_id) {
        this._closePeer(id);
        this.participants.delete(id);
        if (this.screenOwner === id) this.screenOwner = null;
      }
    }
    this.participants.set(p.client_id, { ...this.participants.get(p.client_id), ...p, connection: 'connecting' });
  }

  _updateParticipant(id, changes) {
    const prev = this.participants.get(id);
    if (!prev) return; // left already: late media or ICE events must not bring a ghost tile back
    this.participants.set(id, { ...prev, ...changes });
    this._emit();
  }

  _attachLocal(peer) {
    const transceivers = peer.pc.getTransceivers();
    const tracks = [
      this.localStream.getAudioTracks()[0] || null,
      this.localStream.getVideoTracks()[0] || null,
      this.screenStream?.getVideoTracks()[0] || null,
    ];
    transceivers.slice(0, 3).forEach((t, i) => {
      t.direction = 'sendrecv';
      t.sender.replaceTrack(tracks[i]).catch(() => {});
    });
  }

  async _offerTo(remoteId) {
    this._closePeer(remoteId);
    const peer = this._createPeer(remoteId, true);
    await this._makeOffer(peer, false);
  }

  async _makeOffer(peer, iceRestart) {
    if (peer.pc.signalingState === 'closed') return;
    const offer = await peer.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await peer.pc.setLocalDescription(offer);
    this._signal(peer.id, { kind: 'offer', sdp: peer.pc.localDescription.toJSON() });
  }

  _signal(to, data) {
    this._send({ type: 'signal', to, data });
  }

  async _flush(peer) {
    const queued = peer.queued;
    peer.queued = [];
    for (const candidate of queued) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  async _onSignal(from, fromName, data) {
    if (!from) return;
    let peer = this.peers.get(from);
    // Only people in the room (from the welcome or a join) can negotiate with us; anything else
    // is a stale connection the server has already replaced or dropped.
    if (!this.participants.has(from)) return;
    if (data.kind === 'offer') {
      const fresh = !peer;
      if (!peer) peer = this._createPeer(from, false);
      await peer.pc.setRemoteDescription(data.sdp);
      if (fresh) this._attachLocal(peer);
      await this._flush(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this._signal(from, { kind: 'answer', sdp: peer.pc.localDescription.toJSON() });
    } else if (data.kind === 'answer') {
      if (peer && peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription(data.sdp);
        await this._flush(peer);
      }
    } else if (data.kind === 'candidate') {
      if (!peer || !data.candidate) return;
      if (peer.pc.remoteDescription) {
        await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      } else {
        peer.queued.push(data.candidate);
      }
    } else if (data.kind === 'restart') {
      if (peer?.isOfferer) await this._makeOffer(peer, true);
      else if (!peer) await this._offerTo(from);
    }
  }

  _closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    clearTimeout(peer.restartTimer);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    try {
      peer.pc.close();
    } catch {
      /* already closed */
    }
    this.peers.delete(id);
  }

  _teardownPeers() {
    [...this.peers.keys()].forEach((id) => this._closePeer(id));
    this.participants = new Map();
    this.screenOwner = null;
  }

  async _applyTrack(index, track) {
    await Promise.all(
      [...this.peers.values()].map((peer) => {
        const transceiver = peer.pc.getTransceivers()[index];
        return transceiver ? transceiver.sender.replaceTrack(track).catch(() => {}) : null;
      }),
    );
    this._tuneSenders();
  }

  /** Apply bitrate/resolution limits to every outgoing camera and screen stream. */
  _tuneSenders() {
    const plan = encodingPlan(this.peers.size, !!(this.screenOwner || this.screenStream), !!this.screenStream);
    for (const peer of this.peers.values()) {
      if (peer.pc.connectionState !== 'connected') continue; // applied once it connects
      const transceivers = peer.pc.getTransceivers();
      [[CAMERA, plan.camera, 'maintain-framerate'], [SCREEN, plan.screen, 'maintain-resolution']].forEach(([index, limits, preference]) => {
        const sender = transceivers[index]?.sender;
        if (!sender?.getParameters) return;
        try {
          const params = sender.getParameters();
          if (!params.encodings?.length) return;
          params.encodings = params.encodings.map((e) => ({ ...e, ...limits, ...(index === SCREEN ? { priority: 'high', networkPriority: 'high' } : {}) }));
          params.degradationPreference = preference;
          sender.setParameters(params).catch(() => {});
        } catch {
          /* not negotiated yet */
        }
      });
    }
  }

  // --- local controls --------------------------------------------------------------------

  setMic(on) {
    const track = this.localStream.getAudioTracks()[0];
    if (on && !track) return false;
    if (track) track.enabled = on;
    this.mic = on && !!track;
    this._send({ type: 'state', mic: this.mic });
    this._emit();
    return true;
  }

  /** Camera off releases the device (the camera light goes off); on asks for it again. */
  async setCam(on, constraints = { width: { ideal: 1280 }, height: { ideal: 720 } }) {
    const current = this.localStream.getVideoTracks()[0];
    if (!on) {
      if (current) {
        current.stop();
        this.localStream.removeTrack(current);
      }
      await this._applyTrack(CAMERA, null);
      this.cam = false;
    } else {
      if (!current) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
        const track = stream.getVideoTracks()[0];
        this.localStream.addTrack(track);
        await this._applyTrack(CAMERA, track);
      }
      this.cam = true;
    }
    this._send({ type: 'state', cam: this.cam });
    this._emit();
  }

  /** Use a microphone that was granted after joining (or a different device). */
  async replaceMic(track) {
    this.localStream.getAudioTracks().forEach((t) => {
      t.stop();
      this.localStream.removeTrack(t);
    });
    this.localStream.addTrack(track);
    await this._applyTrack(AUDIO, track);
    this.setMic(true);
  }

  setHand(raised) {
    this.hand = raised;
    this._send({ type: 'state', hand: raised });
    this._emit();
  }

  /** Ask the browser for a screen, window or tab, then claim the single presenter slot. */
  async startScreenShare() {
    if (this.screenOwner) throw new Error(`${this.participants.get(this.screenOwner)?.name || 'Someone'} is already presenting.`);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: SCREEN_CAPTURE,
      audio: false,
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude', // sharing this tab would show the meeting inside itself
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('No screen was selected.');
    track.contentHint = 'detail';
    // The browser's own "Stop sharing" bar ends the track: treat it like our Stop button.
    track.addEventListener('ended', () => this.stopScreenShare());
    this._pendingScreen = stream;
    if (!this._send({ type: 'screen_share', active: true })) {
      this._pendingScreen = null;
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Not connected to the meeting.');
    }
    this._emit();
  }

  async stopScreenShare() {
    const stream = this.screenStream || this._pendingScreen;
    this.screenStream = null;
    this._pendingScreen = null;
    if (!stream) return;
    stream.getTracks().forEach((t) => t.stop());
    await this._applyTrack(SCREEN, null);
    this._send({ type: 'screen_share', active: false });
    this._emit();
  }

  sendChat(content, clientMessageId = newId(), replyToId = null, files = null) {
    const frame = { type: 'chat', content, client_message_id: clientMessageId };
    if (replyToId) frame.reply_to_id = replyToId;
    if (files) Object.assign(frame, files); // attachment_ids, shared_file_ids, shared_document_ids
    return this._send(frame) ? clientMessageId : null;
  }

  setTranscription(enabled) {
    return this._send({ type: 'transcription', enabled });
  }

  get presenting() {
    return !!this.screenStream;
  }

  _stopLocal() {
    clearInterval(this._speakerTimer);
    this._audio?.ctx.close().catch(() => {});
    this._audio = null;
    this.localStream.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this._pendingScreen?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this._pendingScreen = null;
  }

  // --- active speaker --------------------------------------------------------------------

  _startSpeakerDetection() {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    let ctx;
    try {
      ctx = new Ctx();
    } catch {
      return;
    }
    this._audio = { ctx, analysers: new Map(), lastLoud: new Map() };
    const buffer = new Uint8Array(512);
    this._speakerTimer = setInterval(() => {
      if (!this._audio) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const sources = [['self', this.mic ? this.localStream : null]];
      for (const [id, p] of this.participants) sources.push([id, p.mic === false ? null : p.stream]);
      const seen = new Set();
      const now = Date.now();
      let loudest = null;
      let loudestLevel = 0;
      for (const [id, stream] of sources) {
        const track = stream?.getAudioTracks()[0];
        if (!track) continue;
        seen.add(id);
        let entry = this._audio.analysers.get(id);
        if (!entry || entry.track !== track) {
          entry?.source.disconnect();
          const source = ctx.createMediaStreamSource(new MediaStream([track]));
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          entry = { track, source, analyser };
          this._audio.analysers.set(id, entry);
        }
        entry.analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const level = Math.sqrt(sum / buffer.length);
        if (level > 0.04) {
          this._audio.lastLoud.set(id, now);
          if (level > loudestLevel) {
            loudest = id;
            loudestLevel = level;
          }
        }
      }
      for (const [id, entry] of this._audio.analysers) {
        if (!seen.has(id)) {
          entry.source.disconnect();
          this._audio.analysers.delete(id);
        }
      }
      const speaking = new Set([...this._audio.lastLoud].filter(([, t]) => now - t < 800).map(([id]) => id));
      // The last person who spoke stays the active speaker until someone else talks.
      const active = loudest || this.activeSpeaker;
      const changed = active !== this.activeSpeaker || speaking.size !== this.speaking.size
        || [...speaking].some((id) => !this.speaking.has(id));
      if (changed) {
        this.activeSpeaker = active;
        this.speaking = speaking;
        this._emit();
      }
    }, 250);
  }
}
