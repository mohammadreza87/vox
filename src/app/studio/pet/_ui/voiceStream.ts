/**
 * Streamed voice replies (design §8A.3), loaded with the first voice turn, never with the page: the NDJSON reader for
 * talk-voice?stream=1 (transcript, reply, one event per sentence with its audio, done or error), and the sentence
 * queue that plays each sentence's audio strictly in order on the page's one AudioContext, lip-syncing per sentence.
 * Barge-in (`clear`) stops the sentence now playing and drops the rest.
 */

import type { PetErrorCode, PetCare, TalkVoiceResponse } from '@/lib/pet/types';
import { readJson } from './api';
import type { TalkAction, TalkReplyB, VoiceOpts, VoiceStreamEvent } from './contract';
import { PetError } from './errors';

/* ---------- NDJSON ---------- */

/** Splits NDJSON as it arrives: whole lines out, a partial line kept for the next chunk. Unparseable lines are skipped. */
export class NdjsonLines {
  private buf = '';
  push(text: string): unknown[] {
    this.buf += text;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    return parse(lines);
  }
  /** the last line, if the stream ended without a newline */
  end(): unknown[] { const rest = this.buf; this.buf = ''; return parse([rest]); }
}

function parse(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const l of lines) {
    const s = l.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* a broken line is not an event */ }
  }
  return out;
}

const TYPES = new Set(['transcript', 'reply', 'sentence', 'done', 'error']);
/** A parsed line as an event, or null (unknown types and malformed shapes are ignored). */
export function asEvent(v: unknown): VoiceStreamEvent | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  // `type` names the event; a server may also send `{ "transcript": { … } }` style lines
  const type = typeof e.type === 'string' ? e.type : Object.keys(e).find((k) => TYPES.has(k));
  if (!type || !TYPES.has(type)) return null;
  const body = (typeof e.type === 'string' ? e : e[type]) as Record<string, unknown>;
  if (!body || typeof body !== 'object') return null;
  if ((type === 'transcript' || type === 'reply') && typeof body.text !== 'string') return null;
  if (type === 'sentence' && (typeof body.i !== 'number' || typeof body.text !== 'string')) return null;
  if (type === 'error' && typeof body.code !== 'string') return null;
  return { ...body, type } as VoiceStreamEvent;
}

const UNSUPPORTED = new Set([404, 405, 415, 501]);

/**
 * POST the recording to talk-voice?stream=1. NDJSON: every event goes to `onEvent` as it arrives and the turn resolves
 * at `done` (an `error` event throws its code). Plain JSON: the server answered the whole turn at once, so it resolves
 * with it. Null: the route has no stream (it said so with a bare 404/405/415/501), the turn was not taken.
 */
export async function streamVoice(doFetch: typeof fetch, url: string, headers: Record<string, string>, body: FormData,
  onEvent: (e: VoiceStreamEvent) => void, o?: VoiceOpts): Promise<TalkVoiceResponse | null> {
  let res: Response;
  try {
    res = await doFetch(url, { method: 'POST', headers, body, ...(o?.signal ? { signal: o.signal } : {}) });
  } catch (e) {
    throw new PetError(0, 'network', e instanceof Error ? e.message : 'Network error');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!/ndjson|jsonl/i.test(type)) {
    if (UNSUPPORTED.has(res.status)) {
      const j: unknown = await res.clone().json().catch(() => null);
      if (!(j && typeof j === 'object' && 'error' in j)) return null;
    }
    return readJson<TalkVoiceResponse>(res);
  }
  const out: TalkVoiceResponse = { transcript: '', reply: '' };
  let care: PetCare | undefined;
  const take = (v: unknown) => {
    const e = asEvent(v);
    if (!e) return;
    if (e.type === 'transcript') out.transcript = e.text;
    if (e.type === 'reply') out.reply = e.text;
    if (e.type === 'done') {
      if (e.turnId) out.turnId = e.turnId;
      care = e.care ?? care;
      if (e.goodbye) out.goodbye = true;
      if (e.bondMilestone !== undefined) out.bondMilestone = e.bondMilestone;
      // pet_action (§8.4), when the server classifies the turn: it rides on `done`
      const action = (e as { action?: TalkAction }).action;
      if (action) (out as TalkReplyB).action = action;
    }
    onEvent(e);
    if (e.type === 'error') throw new PetError(res.status, e.code as PetErrorCode, e.code);
  };
  const lines = new NdjsonLines();
  const reader = res.body?.getReader();
  if (!reader) {
    for (const v of lines.push(await res.text())) take(v);
  } else {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const v of lines.push(dec.decode(value, { stream: true }))) take(v);
      }
    } catch (e) {
      if (e instanceof PetError) { void reader.cancel().catch(() => {}); throw e; }
      throw new PetError(0, 'network', e instanceof Error ? e.message : 'Stream broke');
    }
  }
  for (const v of lines.end()) take(v);
  if (care) out.care = care;
  return out;
}

/* ---------- the sentence queue ---------- */

export interface Sentence { i: number; text: string; audio: string; mimeType?: string }
/** One decoded sentence: `play` resolves when it ended (or was stopped). */
export interface Clip { play(): Promise<void>; stop(): void; analyser?: AnalyserNode }

export interface QueueDeps {
  decode(s: Sentence): Promise<Clip>;
  /** a sentence starts sounding (the bubble shows it, the mouth follows its analyser) */
  onStart(s: Sentence, clip: Clip): void;
  /** every sentence pushed before `end()` has played (or failed to decode) */
  onDone(): void;
}

/**
 * Plays sentences in index order, whatever order they decode in. Decoding runs ahead (in parallel with playback);
 * a sentence that fails to decode is skipped; a missing index is waited for until `end()`, then passed over.
 */
export class SentenceQueue {
  private clips = new Map<number, Promise<{ c: Clip | null; s: Sentence }>>();
  private next = 0;
  private ended = false;
  /** clear() was called: this reply is over for good; later pushes and end() are ignored */
  private cleared = false;
  private running = false;
  private gen = 0;
  private current: Clip | null = null;
  /** sentences that started sounding */
  started = 0;
  constructor(private deps: QueueDeps) {}

  push(s: Sentence) {
    if (this.cleared || s.i < this.next || this.clips.has(s.i)) return;
    this.clips.set(s.i, this.deps.decode(s).then((c) => ({ c, s }), () => ({ c: null, s })));
    void this.pump();
  }

  end() { if (this.cleared) return; this.ended = true; void this.pump(); }

  /** barge-in, a new turn, the page hiding: silence now, nothing more from this reply */
  clear() {
    this.gen++;
    this.cleared = true;
    this.ended = true;
    this.clips.clear();
    const c = this.current;
    this.current = null;
    c?.stop();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    const g = this.gen;
    try {
      while (g === this.gen) {
        const p = this.clips.get(this.next);
        if (!p) {
          const later = [...this.clips.keys()].filter((k) => k > this.next);
          if (this.ended && later.length) { this.next = Math.min(...later); continue; }
          break;
        }
        const { c, s } = await p;
        if (g !== this.gen) return;
        this.clips.delete(this.next);
        this.next++;
        if (!c) continue;
        this.current = c;
        this.started++;
        this.deps.onStart(s, c);
        await c.play();
        if (g !== this.gen) return;
        this.current = null;
      }
    } finally {
      // a cleared queue (gen moved on) must not stay "running" forever: a later push or end() may pump again
      this.running = false;
    }
    if (g === this.gen && this.ended && !this.clips.size) this.deps.onDone();
  }
}

/* ---------- real clips on the page's AudioContext ---------- */

const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

/**
 * Decoding for the queue. MP3 plays through an <audio> element routed into the context (streams as it decodes, no
 * full-buffer decode on a slow phone); everything else (WAV, PCM in a WAV header, Ogg) goes through decodeAudioData.
 * Every clip plays through one analyser, so the reply's lip-sync is one continuous `speakAudio`.
 */
export function clipDecoder(ctx: AudioContext, an: AnalyserNode): (s: Sentence) => Promise<Clip> {
  const analyser = () => an;
  return async (s) => {
    if (/mpeg|mp3/i.test(s.mimeType ?? '') && typeof Audio !== 'undefined') {
      const el = new Audio(`data:${s.mimeType};base64,${s.audio}`);
      el.preload = 'auto';
      const an = analyser();
      try { ctx.createMediaElementSource(el).connect(an); } catch { /* the element plays on its own; the mouth falls back to text */ }
      let done: () => void = () => {};
      return {
        analyser: an,
        play: () => new Promise<void>((resolve) => {
          done = () => { el.onended = null; el.onerror = null; resolve(); };
          el.onended = done; el.onerror = done;
          void el.play().catch(done);
        }),
        stop: () => { try { el.pause(); } catch { /* gone */ } done(); },
      };
    }
    const buf = await ctx.decodeAudioData(bytes(s.audio).buffer as ArrayBuffer);
    const an = analyser();
    let src: AudioBufferSourceNode | null = null;
    let done: () => void = () => {};
    return {
      analyser: an,
      play: () => new Promise<void>((resolve) => {
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(an);
        done = () => { if (src) src.onended = null; resolve(); };
        src.onended = done;
        src.start();
      }),
      stop: () => {
        const n = src;
        src = null;
        if (n) { n.onended = null; try { n.stop(); } catch { /* ended */ } try { n.disconnect(); } catch { /* ended */ } }
        done();
      },
    };
  };
}

/* ---------- one streamed turn ---------- */

export interface TurnDeps {
  call(onEvent: (e: VoiceStreamEvent) => void): Promise<TalkVoiceResponse | null>;
  /** the reply event: show it and go to speaking; returns the text lip-sync to run if no sentence ever sounds */
  reply(e: Extract<VoiceStreamEvent, { type: 'reply' }>): (() => void) | undefined;
  /** the turn is complete (`done` carried care, goodbye and a Bond milestone): before the last sentence can end */
  final(r: TalkVoiceResponse): void;
  /** this turn's reply is still the one speaking (no newer turn, no barge-in, the session alive) */
  live(): boolean;
  ctx(): AudioContext | null;
  /** a sentence starts: the mouth follows its analyser */
  mouth(an: AnalyserNode): void;
  /** every sentence has played */
  done(): void;
  /** the page keeps the queue so a barge-in or a new turn can clear it (null once drained) */
  keep(q: SentenceQueue | null): void;
}

/**
 * Runs one talk-voice?stream=1 turn: the reply goes to the bubble on its event, sentences queue and play in order as
 * they arrive, and if none ever sounds (no voice, undecodable audio) the text lip-sync says the reply. `r` null: the
 * server has no stream route (post the plain call); `streamed` false: it answered plain JSON (speak it as before).
 */
export async function streamTurn(d: TurnDeps): Promise<{ r: TalkVoiceResponse | null; streamed: boolean }> {
  let streamed = false, synth: (() => void) | undefined, q: SentenceQueue | null = null;
  const r = await d.call((e) => {
    if (e.type === 'reply' && e.text) { streamed = true; synth = d.reply(e); return; }
    // a sentence whose synthesis failed has no audio: the queue passes over its index
    if (e.type !== 'sentence' || !e.audio || !streamed || !d.live()) return;
    const ctx = d.ctx();
    if (!ctx) return;
    if (!q) {
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.connect(ctx.destination);
      let mouth = false;
      q = new SentenceQueue({
        decode: clipDecoder(ctx, an),
        // one lip-sync for the whole reply, from the first sentence that sounds
        onStart: () => { if (d.live() && !mouth) { mouth = true; d.mouth(an); } },
        onDone: () => { try { an.disconnect(); } catch { /* gone */ } if (!d.live()) return; d.keep(null); d.done(); },
      });
      d.keep(q);
    }
    q.push({ i: e.i, text: e.text, audio: e.audio, mimeType: e.mimeType });
  });
  if (r && streamed && d.live()) { d.final(r); if (q) (q as SentenceQueue).end(); else synth?.(); }
  return { r, streamed };
}
