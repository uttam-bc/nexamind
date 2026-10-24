import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploads = [];
const gaps = [];
let failUploads = 0;
vi.mock('../api', () => ({
  api: {
    uploadTranscriptChunk: vi.fn(async (wid, mid, form) => {
      if (failUploads > 0) {
        failUploads -= 1;
        throw new Error('The transcription service is unavailable right now.');
      }
      uploads.push(form.get('client_segment_id'));
      return { segment: null };
    }),
    reportTranscriptGap: vi.fn(async (wid, mid, body) => gaps.push(body.client_segment_id)),
  },
}));
vi.mock('./meetingClient', () => ({ newId: () => Math.random().toString(16).slice(2) }));

// MediaRecorder whose onstop fires asynchronously, like the real one.
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  constructor() {
    this.state = 'inactive';
    this.mimeType = 'audio/webm';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['x'.repeat(100)]) });
      this.onstop?.();
    }, 5);
  }
}

let level = 0;
class FakeAudioContext {
  constructor() {
    this.state = 'running';
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      getByteTimeDomainData(buf) {
        buf.fill(128 + Math.round(level * 127));
      },
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

let MeetingTranscriber;
beforeEach(async () => {
  vi.useFakeTimers();
  uploads.length = 0;
  gaps.length = 0;
  failUploads = 0;
  level = 0;
  globalThis.MediaRecorder = FakeRecorder;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  ({ MeetingTranscriber } = await import('./meetingTranscriber'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const track = { id: 't1', enabled: true, readyState: 'live' };

describe('MeetingTranscriber', () => {
  it('uploads a chunk with speech even though the next chunk starts before onstop', async () => {
    const t = new MeetingTranscriber({ workspaceId: 'w', meetingId: 'm', mode: 'server', chunkSeconds: 5 });
    t.start(track);
    level = 0.5; // speaking during the first chunk
    await vi.advanceTimersByTimeAsync(4000);
    level = 0;
    await vi.advanceTimersByTimeAsync(1100); // first chunk ends; second (silent) begins
    await vi.advanceTimersByTimeAsync(5100); // second chunk ends
    expect(uploads.length).toBe(1);
    await t.stop();
  });

  it('retries a failed upload with the same id, so the server can de-duplicate', async () => {
    const t = new MeetingTranscriber({ workspaceId: 'w', meetingId: 'm', mode: 'server', chunkSeconds: 5 });
    failUploads = 2;
    t.start(track);
    level = 0.5;
    await vi.advanceTimersByTimeAsync(4000);
    level = 0;
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 100);
    expect(uploads.length).toBe(1);
    const { api } = await import('../api');
    const ids = api.uploadTranscriptChunk.mock.calls.map((c) => c[2].get('client_segment_id'));
    expect(new Set(ids).size).toBe(1);
    expect(ids.length).toBe(3);
    await t.stop();
  });

  it('keeps chunks that keep failing for a manual retry and reports them as gaps at the end', async () => {
    const t = new MeetingTranscriber({ workspaceId: 'w', meetingId: 'm', mode: 'server', chunkSeconds: 5 });
    failUploads = 100;
    t.start(track);
    level = 0.5;
    await vi.advanceTimersByTimeAsync(4000);
    level = 0;
    await vi.advanceTimersByTimeAsync(1100);
    for (let i = 0; i < 9; i += 1) await vi.advanceTimersByTimeAsync(10000);
    const { api } = await import('../api');
    expect(api.uploadTranscriptChunk.mock.calls.length).toBe(6); // first try + 5 retries
    expect(t.snapshot().failed).toBe(1);
    expect(t.snapshot().status).toBe('error');
    const stopping = t.stop({ final: true });
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    expect(gaps.length).toBe(1);
  });

  it('uploads audio when the level meter could not run (suspended AudioContext)', async () => {
    globalThis.AudioContext = class extends FakeAudioContext {
      constructor() {
        super();
        this.state = 'suspended';
      }
      resume() {
        return Promise.resolve();
      }
    };
    const t = new MeetingTranscriber({ workspaceId: 'w', meetingId: 'm', mode: 'server', chunkSeconds: 5 });
    t.start(track);
    await vi.advanceTimersByTimeAsync(5100);
    expect(uploads.length).toBe(1);
    await t.stop();
  });
});
