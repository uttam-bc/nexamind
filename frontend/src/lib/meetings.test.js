import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- fakes for the socket and WebRTC -----------------------------------------------------

const sockets = [];
class FakeSocket extends EventTarget {
  constructor(path) {
    super();
    this.path = path;
    this.readyState = 1; // OPEN
    this.sent = [];
    sockets.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
  receive(msg) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
  }
  frames(type) {
    return this.sent.filter((m) => m.type === type);
  }
}

vi.mock('../api', () => ({
  openSocket: (path) => new FakeSocket(path),
  api: {},
}));

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.id = `${kind}-${Math.random()}`;
    this.enabled = true;
    this.readyState = 'live';
    this.stopped = false;
    this.listeners = {};
  }
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
}

class FakeStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addTrack(t) {
    this.tracks.push(t);
  }
  removeTrack(t) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

const peers = [];
class FakePC {
  constructor() {
    this.transceivers = [];
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.remoteDescription = null;
    this.localDescription = null;
    this.candidates = [];
    this.closed = false;
    peers.push(this);
  }
  addTransceiver(kind) {
    const t = { kind, direction: 'sendrecv', sender: { track: null, replaceTrack: async (tr) => { t.sender.track = tr; } } };
    this.transceivers.push(t);
    return t;
  }
  getTransceivers() {
    return this.transceivers;
  }
  async createOffer(opts) {
    return { type: 'offer', sdp: `offer${opts?.iceRestart ? '-restart' : ''}` };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer' };
  }
  async setLocalDescription(d) {
    this.localDescription = { ...d, toJSON: () => d };
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
    if (d.type === 'offer' && !this.transceivers.length) ['audio', 'video', 'video'].forEach((k) => this.addTransceiver(k));
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate(c) {
    this.candidates.push(c);
  }
  close() {
    this.closed = true;
    this.signalingState = 'closed';
  }
}

let MeetingClient;
const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};
const recv = async (ws, msg) => {
  ws.receive(msg);
  await flush();
  await flush();
};

beforeEach(async () => {
  sockets.length = 0;
  peers.length = 0;
  globalThis.RTCPeerConnection = FakePC;
  globalThis.MediaStream = FakeStream;
  ({ MeetingClient } = await import('./meetingClient'));
});

afterEach(() => {
  vi.useRealTimers();
});

async function joined(client, participants = []) {
  client.connect();
  const ws = sockets[sockets.length - 1];
  await recv(ws, { type: 'welcome', client_id: 'me', participants: [{ client_id: 'me', user_id: 'u-me', name: 'Me' }, ...participants], screen_owner: null, meeting: { id: 'm1' } });
  return ws;
}

describe('MeetingClient signaling', () => {
  it('offers to newcomers with three transceivers carrying local tracks', async () => {
    const mic = new FakeTrack('audio');
    const cam = new FakeTrack('video');
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream([mic, cam]) });
    const ws = await joined(client);
    expect(ws.frames('state')[0]).toMatchObject({ mic: true, cam: true });

    await recv(ws, { type: 'participant_joined', participant: { client_id: 'p2', name: 'Priya', mic: true, cam: true } });
    await flush();
    const pc = peers[0];
    expect(pc.transceivers.map((t) => t.kind)).toEqual(['audio', 'video', 'video']);
    expect(pc.transceivers[0].sender.track).toBe(mic);
    expect(pc.transceivers[1].sender.track).toBe(cam);
    expect(pc.transceivers[2].sender.track).toBe(null);
    const offer = ws.frames('signal')[0];
    expect(offer).toMatchObject({ to: 'p2', data: { kind: 'offer' } });
    expect(client.participants.get('p2').name).toBe('Priya');
  });

  it('answers as the newcomer and queues ICE candidates until the offer arrives', async () => {
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream([new FakeTrack('audio')]) });
    const ws = await joined(client, [{ client_id: 'host', name: 'Host' }]);
    expect(peers.length).toBe(0); // existing participants make the offer, not us

    await recv(ws, { type: 'signal', from: 'host', data: { kind: 'offer', sdp: { type: 'offer', sdp: 'x' } } });
    await flush();
    const pc = peers[0];
    await recv(ws, { type: 'signal', from: 'host', data: { kind: 'candidate', candidate: { candidate: 'c1' } } });
    await flush();
    expect(pc.candidates).toEqual([{ candidate: 'c1' }]);
    expect(ws.frames('signal').at(-1)).toMatchObject({ to: 'host', data: { kind: 'answer' } });
    expect(pc.transceivers[0].sender.track.kind).toBe('audio');
  });

  it('restarts ICE when a connection fails', async () => {
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream() });
    const ws = await joined(client);
    await recv(ws, { type: 'participant_joined', participant: { client_id: 'p2', name: 'P' } });
    await flush();
    const pc = peers[0];
    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    await flush();
    expect(ws.frames('signal').at(-1).data.sdp.sdp).toBe('offer-restart');
    expect(client.participants.get('p2').connection).toBe('reconnecting');
  });

  it('removes a participant who leaves and closes their connection', async () => {
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream() });
    const ws = await joined(client);
    await recv(ws, { type: 'participant_joined', participant: { client_id: 'p2', name: 'P' } });
    await flush();
    await recv(ws, { type: 'participant_left', client_id: 'p2' });
    expect(peers[0].closed).toBe(true);
    expect(client.participants.has('p2')).toBe(false);
  });

  it('shares the screen only after the server grants it and stops on the browser bar', async () => {
    const screenTrack = new FakeTrack('video');
    globalThis.navigator.mediaDevices = { getDisplayMedia: vi.fn().mockResolvedValue(new FakeStream([screenTrack])) };
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream() });
    const ws = await joined(client);
    await recv(ws, { type: 'participant_joined', participant: { client_id: 'p2', name: 'P' } });
    await flush();

    await client.startScreenShare();
    expect(ws.frames('screen_share').at(-1)).toEqual({ type: 'screen_share', active: true });
    expect(peers[0].transceivers[2].sender.track).toBe(null); // not before it's granted
    await recv(ws, { type: 'screen_share', client_id: 'me', active: true });
    await flush();
    expect(peers[0].transceivers[2].sender.track).toBe(screenTrack);
    expect(client.presenting).toBe(true);

    screenTrack.listeners.ended(); // the browser's own "Stop sharing"
    await flush();
    expect(screenTrack.stopped).toBe(true);
    expect(peers[0].transceivers[2].sender.track).toBe(null);
    expect(ws.frames('screen_share').at(-1)).toEqual({ type: 'screen_share', active: false });
  });

  it('drops a screen share the server refuses because someone else presents', async () => {
    const screenTrack = new FakeTrack('video');
    globalThis.navigator.mediaDevices = { getDisplayMedia: vi.fn().mockResolvedValue(new FakeStream([screenTrack])) };
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream() });
    const ws = await joined(client);
    await client.startScreenShare();
    await recv(ws, { type: 'error', code: 'screen_busy', detail: 'Priya is already presenting.' });
    expect(screenTrack.stopped).toBe(true);
    expect(client.presenting).toBe(false);
  });

  it('reconnects after a dropped socket but not after the host ends the meeting', async () => {
    vi.useFakeTimers();
    const mic = new FakeTrack('audio');
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream([mic]) });
    const ws = await joined(client);
    ws.close(1006);
    expect(client.status).toBe('reconnecting');
    vi.advanceTimersByTime(600);
    expect(sockets.length).toBe(2);
    expect(mic.stopped).toBe(false); // media survives a reconnect

    const ws2 = sockets[1];
    await recv(ws2, { type: 'welcome', client_id: 'me2', participants: [], screen_owner: null, meeting: { id: 'm1' } });
    expect(client.status).toBe('connected');
    await recv(ws2, { type: 'meeting_ended', ended_by: 'Host' });
    expect(client.status).toBe('ended');
    expect(client.endReason).toBe('ended');
    expect(mic.stopped).toBe(true); // every track is released
    ws2.close(4000);
    vi.advanceTimersByTime(20000);
    expect(sockets.length).toBe(2);
  });

  it('shows a person once even when their new connection arrives before the old one leaves', async () => {
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream() });
    const ws = await joined(client, [{ client_id: 'old', user_id: 'u-jason', name: 'Jason' }]);
    await recv(ws, { type: 'participant_joined', participant: { client_id: 'new', user_id: 'u-jason', name: 'Jason' } });
    expect([...client.participants.values()].map((p) => p.name)).toEqual(['Jason']);
    expect(client.participants.has('new')).toBe(true);
    // My own other connection is never shown as someone else.
    await recv(ws, { type: 'participant_joined', participant: { client_id: 'me-tab2', user_id: 'u-me', name: 'Me' } });
    expect(client.participants.has('me-tab2')).toBe(false);
  });

  it('ignores signals and state from connections that are not in the room', async () => {
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream() });
    const ws = await joined(client);
    await recv(ws, { type: 'signal', from: 'ghost', from_name: 'Ghost', data: { kind: 'offer', sdp: { type: 'offer', sdp: 'x' } } });
    await recv(ws, { type: 'participant_state', participant: { client_id: 'ghost', name: 'Ghost', mic: false } });
    expect(client.participants.size).toBe(0);
    expect(peers.length).toBe(0);
  });

  it('does not reconnect when replaced by another tab or when the meeting is full', async () => {
    for (const [code, reason] of [[4409, 'replaced'], [4429, 'full']]) {
      const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream() });
      const ws = await joined(client);
      const count = sockets.length;
      ws.close(code);
      expect(client.status).toBe('ended');
      expect(client.endReason).toBe(reason);
      await new Promise((r) => setTimeout(r, 700));
      expect(sockets.length).toBe(count);
    }
  });

  it('leave() stops tracks and tells the server', async () => {
    const cam = new FakeTrack('video');
    const client = new MeetingClient({ workspaceId: 'w', meetingId: 'm1', localStream: new FakeStream([cam]) });
    const ws = await joined(client);
    client.leave();
    expect(ws.frames('leave').length).toBe(1);
    expect(cam.stopped).toBe(true);
    expect(client.status).toBe('ended');
  });
});

describe('helpers', () => {
  it('merges chat messages without duplicates and in order', async () => {
    const { mergeMessages } = await import('./channelSocket');
    const a = { id: '1', created_at: '2026-10-24T10:00:00Z', content: 'a' };
    const b = { id: '2', created_at: '2026-10-24T10:01:00Z', content: 'b' };
    expect(mergeMessages([b], [a, b]).map((m) => m.id)).toEqual(['1', '2']);
    expect(mergeMessages([a], [{ ...a, content: 'edited' }])[0].content).toBe('edited');
  });

  it('converts a local time in a time zone to an ISO instant', async () => {
    const { localToIso } = await import('./timezone');
    expect(localToIso('2026-11-02', '15:30', 'Asia/Kolkata')).toBe('2026-11-02T15:30:00+05:30');
    expect(localToIso('2026-07-01', '09:00', 'Europe/London')).toBe('2026-07-01T09:00:00+01:00');
    expect(localToIso('2026-12-01', '09:00', 'Europe/London')).toBe('2026-12-01T09:00:00+00:00');
    expect(new Date(localToIso('2026-03-10', '08:00', 'America/New_York')).toISOString()).toBe('2026-03-10T12:00:00.000Z');
  });

  it('routes deep links to the tab that asked, including early ones', async () => {
    const { openDeepLink, onDeepLink } = await import('./deepLink');
    openDeepLink({ tab: 'meetings', meeting_id: 'm1' });
    const got = [];
    const stop = onDeepLink('meetings', (l) => got.push(l.meeting_id));
    await new Promise((r) => setTimeout(r, 0));
    openDeepLink({ tab: 'projects', task_id: 't' });
    openDeepLink({ tab: 'meetings', meeting_id: 'm2' });
    stop();
    expect(got).toEqual(['m1', 'm2']);
  });

  it('merges notifications newest first', async () => {
    const { mergeNotifications, timeAgo } = await import('./notifications');
    const list = mergeNotifications([{ id: 'a', created_at: '2026-10-24T10:00:00Z' }], [{ id: 'b', created_at: '2026-10-24T11:00:00Z' }, { id: 'a', created_at: '2026-10-24T10:00:00Z', read_at: 'x' }]);
    expect(list.map((n) => n.id)).toEqual(['b', 'a']);
    expect(list[1].read_at).toBe('x');
    expect(timeAgo('2026-10-24T10:00:00Z', Date.parse('2026-10-24T10:05:00Z'))).toBe('5 min ago');
  });
});

describe('encoding plan', () => {
  it('splits the upload between viewers and favours the shared screen', async () => {
    const { encodingPlan } = await import('./meetingClient');
    const two = encodingPlan(2, false, false);
    const seven = encodingPlan(7, false, false);
    expect(two.camera.maxBitrate).toBeGreaterThan(seven.camera.maxBitrate);
    expect(seven.camera.maxBitrate).toBeGreaterThanOrEqual(150_000);
    expect(seven.camera.scaleResolutionDownBy).toBe(2);
    const presenting = encodingPlan(4, true, true);
    expect(presenting.screen.maxBitrate).toBeGreaterThan(presenting.camera.maxBitrate * 4);
    expect(presenting.camera.scaleResolutionDownBy).toBe(4);
    expect(presenting.screen.maxFramerate).toBe(15);
    expect(encodingPlan(1, true, true).screen.maxBitrate).toBeLessThanOrEqual(2_500_000);
  });
});
