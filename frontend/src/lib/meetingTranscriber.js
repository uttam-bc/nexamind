// Continuous meeting transcription.
//
// Server mode (a speech-to-text provider is configured): each participant records their own
// microphone in standalone chunks (a fresh MediaRecorder every N seconds, so every chunk has its
// own header) and uploads them. The speaker label is therefore exact. Chunks with no speech are
// skipped. Uploads retry with backoff; each chunk has a stable id, so a retry never duplicates
// a segment. Chunks that still fail are kept for a manual retry and reported as gaps when the
// meeting ends, so the minutes can say the transcript is incomplete.
//
// Browser mode (no provider): the browser's speech recognition, restarted whenever it stops,
// sends each final phrase as a text segment.

import { api } from '../api';
import { newId } from './meetingClient';

const RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000];
const MAX_KEPT_FAILURES = 40;
const SPEECH_LEVEL = 0.02;
const PAUSE_MS = 400;
const MIN_CHUNK_SHARE = 0.6;
const MAX_CHUNK_SHARE = 1.4;

function pickMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return null;
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MeetingTranscriber {
  constructor({ workspaceId, meetingId, startedAt, mode, chunkSeconds = 15, onChange }) {
    this.workspaceId = workspaceId;
    this.meetingId = meetingId;
    this.startedAt = startedAt ? new Date(startedAt).getTime() : Date.now();
    this.mode = mode; // 'server' | 'browser'
    this.chunkMs = Math.max(5, chunkSeconds) * 1000;
    this.onChange = onChange;

    this.status = 'idle'; // idle | recording | retrying | error | unsupported | stopped
    this.error = null;
    this.uploaded = 0;
    this.failed = []; // chunks that exhausted their retries
    this.queue = [];
    this._uploading = false;
    this._track = null;
    this._recorder = null;
    this._chunkTimer = null;
    this._recognition = null;
    this._stopped = true;
    this._ctx = null;
    this._analyser = null;
    this._levelTimer = null;
    this._chunk = { heard: false, startedAt: 0 }; // speech seen during the chunk being recorded
    this._lastLoud = 0;
  }

  _set(changes) {
    Object.assign(this, changes);
    this.onChange?.(this.snapshot());
  }

  snapshot() {
    return {
      status: this.status,
      error: this.error,
      mode: this.mode,
      uploaded: this.uploaded,
      pending: this.queue.length,
      failed: this.failed.length,
    };
  }

  _offset() {
    return Math.max(0, Date.now() - this.startedAt);
  }

  /** Start (or keep going with a new microphone track). */
  start(micTrack) {
    this._stopped = false;
    if (this.mode === 'browser') {
      this._startRecognition();
      return;
    }
    if (!micTrack) {
      this._set({ status: 'error', error: 'No microphone is available, so your speech is not being transcribed.' });
      return;
    }
    if (pickMimeType() === null) {
      this._set({ status: 'unsupported', error: 'This browser cannot record audio for transcription.' });
      return;
    }
    if (this._track && this._track.id === micTrack.id) return;
    this._stopRecorder(false);
    this._track = micTrack;
    this._watchLevel(micTrack);
    this._set({ status: 'recording', error: null });
    this._nextChunk();
  }

  _watchLevel(track) {
    clearInterval(this._levelTimer);
    this._ctx?.close().catch(() => {});
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) {
      this._chunk.heard = true;
      return;
    }
    try {
      this._ctx = new Ctx();
      const source = this._ctx.createMediaStreamSource(new MediaStream([track]));
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 1024;
      source.connect(this._analyser);
      if (this._ctx.state === 'suspended') {
        const resume = () => this._ctx?.resume().catch(() => {});
        document.addEventListener('pointerdown', resume, { once: true });
        document.addEventListener('keydown', resume, { once: true });
      }
    } catch {
      this._analyser = null;
      this._chunk.heard = true;
      return;
    }
    const buffer = new Uint8Array(1024);
    this._levelTimer = setInterval(() => {
      if (!this._analyser) return;
      if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
      if (this._ctx.state !== 'running') return;
      this._chunk.metered = true;
      if (!track.enabled) return; // muted: nothing to transcribe
      this._analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const now = Date.now();
      if (Math.sqrt(sum / buffer.length) > SPEECH_LEVEL) {
        this._chunk.heard = true;
        this._lastLoud = now;
      }
      // End the chunk at a pause, so words aren't cut in half between two chunks.
      const elapsed = now - this._chunk.startedAt;
      if (elapsed >= this.chunkMs * MIN_CHUNK_SHARE && now - this._lastLoud >= PAUSE_MS) this._cut();
    }, 100);
  }

  _nextChunk() {
    if (this._stopped || !this._track || this._track.readyState === 'ended') return;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(new MediaStream([this._track]), mimeType ? { mimeType } : undefined);
    const parts = [];
    const offset = this._offset();
    // Each chunk keeps its own flag: the next chunk starts before this one's onstop runs.
    const chunk = { heard: !this._analyser, startedAt: Date.now() };
    this._chunk = chunk;
    recorder.ondataavailable = (event) => {
      if (event.data?.size) parts.push(event.data);
    };
    recorder.onstop = () => {
      const duration = this._offset() - offset;
      // Skip a chunk as silent only if the level meter really measured it: a suspended
      // AudioContext (created without a user gesture) reads as silence, and speech must never be dropped.
      if (parts.length && (chunk.heard || !chunk.metered)) {
        const blob = new Blob(parts, { type: recorder.mimeType || mimeType || 'audio/webm' });
        this._enqueue({ id: newId(), blob, offset, duration, attempts: 0 });
      }
    };
    recorder.start();
    this._recorder = recorder;
    // Without a level meter chunks are cut on time; with one, at the first pause (see above).
    clearTimeout(this._chunkTimer);
    const metered = this._analyser && this._ctx?.state === 'running';
    this._chunkTimer = setTimeout(() => this._cut(), metered ? this.chunkMs * MAX_CHUNK_SHARE : this.chunkMs);
  }

  _cut() {
    const recorder = this._recorder;
    if (!recorder || this._stopped) return;
    if (recorder.state !== 'inactive') recorder.stop();
    this._nextChunk();
  }

  _stopRecorder(flush = true) {
    clearTimeout(this._chunkTimer);
    const recorder = this._recorder;
    this._recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      if (!flush) recorder.ondataavailable = null;
      recorder.stop();
    }
  }

  _enqueue(chunk) {
    this.queue.push(chunk);
    this.onChange?.(this.snapshot());
    this._drain();
  }

  async _drain() {
    if (this._uploading) return;
    this._uploading = true;
    try {
      while (this.queue.length) {
        const chunk = this.queue[0];
        const ok = await this._upload(chunk);
        this.queue.shift();
        if (ok) {
          this.uploaded += 1;
        } else {
          this.failed.push(chunk);
          if (this.failed.length > MAX_KEPT_FAILURES) await this._reportGap(this.failed.shift());
        }
        this._set({
          status: this.failed.length ? 'error' : this._stopped ? 'stopped' : 'recording',
          error: this.failed.length
            ? `${this.failed.length} part(s) of your audio couldn't be transcribed yet.`
            : null,
        });
      }
    } finally {
      this._uploading = false;
    }
  }

  async _upload(chunk) {
    while (chunk.attempts <= RETRY_DELAYS.length) {
      try {
        const form = new FormData();
        const ext = chunk.blob.type.includes('ogg') ? 'ogg' : chunk.blob.type.includes('mp4') ? 'm4a' : 'webm';
        form.append('audio', chunk.blob, `chunk.${ext}`);
        form.append('client_segment_id', chunk.id);
        form.append('offset_ms', String(Math.round(chunk.offset)));
        form.append('duration_ms', String(Math.min(120000, Math.round(chunk.duration))));
        await api.uploadTranscriptChunk(this.workspaceId, this.meetingId, form);
        return true;
      } catch (err) {
        const message = String(err?.message || '');
        // The meeting ended or transcription was switched off: nothing to retry.
        if (/only be added while|turned off|not found|access denied/i.test(message)) return true;
        chunk.attempts += 1;
        if (chunk.attempts > RETRY_DELAYS.length) return false;
        this._set({ status: 'retrying', error: 'Transcription is having trouble; retrying…' });
        await sleep(RETRY_DELAYS[chunk.attempts - 1]);
        if (!navigator.onLine) {
          await new Promise((resolve) => window.addEventListener('online', resolve, { once: true }));
        }
      }
    }
    return false;
  }

  /** Retry the chunks that failed (the "Retry" button). */
  retryFailed() {
    const chunks = this.failed.splice(0);
    chunks.forEach((c) => {
      c.attempts = 0;
    });
    this.queue.push(...chunks);
    this._set({ status: 'retrying', error: null });
    this._drain();
  }

  async _reportGap(chunk) {
    await api
      .reportTranscriptGap(this.workspaceId, this.meetingId, {
        client_segment_id: chunk.id,
        offset_ms: Math.round(chunk.offset),
        duration_ms: Math.min(120000, Math.round(chunk.duration)),
      })
      .catch(() => {});
  }

  // --- browser speech recognition ---------------------------------------------------------

  _startRecognition() {
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) {
      this._set({
        status: 'unsupported',
        error: 'No transcription service is configured and this browser has no speech recognition.',
      });
      return;
    }
    if (this._recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    let phraseStart = this._offset();
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const text = result[0]?.transcript?.trim();
        const offset = phraseStart;
        phraseStart = this._offset();
        if (!text) continue;
        this._sendText({ id: newId(), text, offset, duration: phraseStart - offset, attempts: 0 });
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this._recognition = null;
        this._set({ status: 'error', error: 'Microphone access for transcription was blocked.' });
      }
    };
    // Browsers end recognition after silence or about a minute: start it again right away.
    recognition.onend = () => {
      if (this._stopped || this._recognition !== recognition) return;
      setTimeout(() => {
        if (this._stopped || this._recognition !== recognition) return;
        try {
          recognition.start();
        } catch {
          /* already started */
        }
      }, 250);
    };
    this._recognition = recognition;
    try {
      recognition.start();
      this._set({ status: 'recording', error: null });
    } catch (err) {
      this._set({ status: 'error', error: err.message });
    }
  }

  async _sendText(item) {
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      try {
        await api.addTranscriptSegment(this.workspaceId, this.meetingId, {
          text: item.text,
          client_segment_id: item.id,
          offset_ms: Math.round(item.offset),
          duration_ms: Math.min(120000, Math.max(0, Math.round(item.duration))),
        });
        this.uploaded += 1;
        this.onChange?.(this.snapshot());
        return;
      } catch {
        if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt]);
      }
    }
    this._set({ status: 'error', error: 'Some phrases could not be saved to the transcript.' });
  }

  /** Stop recording. Uploads the last chunk; with `final`, unrecoverable chunks become gaps. */
  async stop({ final = false } = {}) {
    this._stopped = true;
    this._stopRecorder(true);
    clearInterval(this._levelTimer);
    this._ctx?.close().catch(() => {});
    this._ctx = null;
    this._analyser = null;
    this._track = null;
    if (this._recognition) {
      const recognition = this._recognition;
      this._recognition = null;
      try {
        recognition.stop();
      } catch {
        /* not running */
      }
    }
    if (final) {
      // Give the last chunk a moment to be queued and uploaded.
      await sleep(200);
      this._drain();
      const deadline = Date.now() + 20000;
      while ((this._uploading || this.queue.length) && Date.now() < deadline) await sleep(200);
      await Promise.all(this.failed.splice(0).map((c) => this._reportGap(c)));
    }
    this._set({ status: 'stopped' });
  }
}
