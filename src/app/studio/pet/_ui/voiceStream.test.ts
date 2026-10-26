import { describe, expect, it, vi } from 'vitest';
import { createHttpApi } from './api';
import { isPetError } from './errors';
import { asEvent, NdjsonLines, SentenceQueue, streamVoice, type Clip, type Sentence } from './voiceStream';
import type { VoiceStreamEvent } from './contract';

const enc = new TextEncoder();
/** A response whose body arrives in the given chunks (split anywhere, even mid-line). */
function ndjson(chunks: string[], status = 200) {
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
  return new Response(body, { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}
const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const form = () => new FormData();

describe('NDJSON reader', () => {
  it('splits lines across chunk boundaries and keeps a partial line for the next chunk', () => {
    const l = new NdjsonLines();
    expect(l.push('{"type":"transcript","te')).toEqual([]);
    expect(l.push('xt":"hi"}\n{"type":"reply"')).toEqual([{ type: 'transcript', text: 'hi' }]);
    expect(l.push(',"text":"yo"}\n\n not json \n')).toEqual([{ type: 'reply', text: 'yo' }]);
    expect(l.push('{"type":"done"}')).toEqual([]);
    expect(l.end()).toEqual([{ type: 'done' }]);
  });

  it('reads `{type, …}` and `{transcript: {…}}` lines; drops unknown and malformed events', () => {
    expect(asEvent({ type: 'sentence', i: 0, text: 'a', audio: 'AA', mimeType: 'audio/wav' })).toMatchObject({ type: 'sentence', i: 0 });
    expect(asEvent({ transcript: { text: 'hey' } })).toEqual({ type: 'transcript', text: 'hey' });
    expect(asEvent({ type: 'sentence', text: 'no index' })).toBeNull();
    expect(asEvent({ type: 'mystery' })).toBeNull();
    expect(asEvent({ type: 'error' })).toBeNull();
  });
});

describe('streamVoice (talk-voice?stream=1)', () => {
  it('hands every event over as it arrives and resolves the whole turn at done', async () => {
    const events: VoiceStreamEvent[] = [];
    const body = [line({ type: 'transcript', text: 'hello' }), line({ type: 'reply', text: 'Hi! Nice.' }),
      line({ type: 'sentence', i: 0, text: 'Hi!', audio: 'AAA', mimeType: 'audio/wav' }), line({ type: 'sentence', i: 1, text: 'Nice.' }),
      line({ type: 'done', turnId: 't1', goodbye: true, bondMilestone: 2 })].join('');
    const fetch = vi.fn(async () => ndjson([body.slice(0, 37), body.slice(37, 120), body.slice(120)]));
    const r = await streamVoice(fetch as never, '/x?stream=1', {}, form(), (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['transcript', 'reply', 'sentence', 'sentence', 'done']);
    // the server's shapes: `done` carries the goodbye and the milestone; a sentence may come without audio
    expect(r).toEqual({ transcript: 'hello', reply: 'Hi! Nice.', turnId: 't1', goodbye: true, bondMilestone: 2 });
    expect(events[3]).toEqual({ type: 'sentence', i: 1, text: 'Nice.' });
  });

  it('an error event throws its code (the bubble says the turn failed); plain JSON is the whole turn at once', async () => {
    const fail = vi.fn(async () => ndjson([line({ type: 'transcript', text: 'x' }), line({ type: 'error', code: 'settings_changed' })]));
    const err = await streamVoice(fail as never, '/x', {}, form(), () => {}).catch((e) => e);
    expect(isPetError(err) && err.code).toBe('settings_changed');
    const json = vi.fn(async () => new Response(JSON.stringify({ transcript: 'a', reply: 'b', audio: 'CC' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(streamVoice(json as never, '/x', {}, form(), () => {})).resolves.toEqual({ transcript: 'a', reply: 'b', audio: 'CC' });
  });

  it('a route without the stream (bare 404/405/415) is null: the plain call is posted instead; a pet error still throws', async () => {
    const bare = vi.fn(async () => new Response('Not found', { status: 404 }));
    await expect(streamVoice(bare as never, '/x', {}, form(), () => {})).resolves.toBeNull();
    const gone = vi.fn(async () => new Response(JSON.stringify({ error: 'pet_unavailable' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    const err = await streamVoice(gone as never, '/x', {}, form(), () => {}).catch((e) => e);
    expect(isPetError(err) && err.code).toBe('pet_unavailable');
  });

  it('the HTTP API posts ?stream=1 with the epoch, the NDJSON accept and `handsFree`', async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith('/x') ? new Response(JSON.stringify({ careEpoch: 'e1' }), { status: 200 }) : ndjson([line({ type: 'done' })])));
    const api = createHttpApi({ fetch: fetch as never, initData: () => 'signed' });
    await api.get('x');
    await api.talkVoiceStream!('x', new Blob(['a'], { type: 'audio/webm' }), () => {}, { handsFree: true });
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/studio/pet/x/talk-voice?stream=1');
    const h = init.headers as Record<string, string>;
    expect(h['x-pet-care-epoch']).toBe('e1');
    expect(h.Accept).toContain('application/x-ndjson');
    expect((init.body as FormData).get('handsFree')).toBe('true');
  });
});

/** A clip that plays until `finish(i)` is called. */
function harness(decodeOrder?: number[]) {
  const playing: number[] = [];
  const ends = new Map<number, () => void>();
  const stopped: number[] = [];
  const decodes = new Map<number, (c: Clip) => void>();
  const deps = {
    decode: (s: Sentence) => new Promise<Clip>((resolve) => {
      const clip: Clip = {
        play: () => new Promise<void>((r) => { playing.push(s.i); ends.set(s.i, r); }),
        stop: () => { stopped.push(s.i); ends.get(s.i)?.(); },
      };
      if (decodeOrder) decodes.set(s.i, resolve); else resolve(clip);
      if (decodeOrder) decodes.set(s.i, () => resolve(clip));
    }),
    onStart: vi.fn(),
    onDone: vi.fn(),
  };
  return { deps, playing, stopped, finish: (i: number) => ends.get(i)?.(), decoded: (i: number) => (decodes.get(i) as unknown as () => void)?.() };
}
const s = (i: number): Sentence => ({ i, text: `s${i}`, audio: 'AA', mimeType: 'audio/wav' });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the sentence queue (strict order, barge-in)', () => {
  it('plays in index order even when later sentences decode first, and reports done after the last', async () => {
    const h = harness([]);
    const q = new SentenceQueue(h.deps);
    q.push(s(0)); q.push(s(1)); q.push(s(2));
    h.decoded(2); h.decoded(1);
    await tick();
    expect(h.playing).toEqual([]);
    h.decoded(0);
    await tick();
    expect(h.playing).toEqual([0]);
    h.finish(0); await tick();
    expect(h.playing).toEqual([0, 1]);
    q.end();
    h.finish(1); await tick();
    h.finish(2); await tick();
    expect(h.playing).toEqual([0, 1, 2]);
    expect(h.deps.onStart).toHaveBeenCalledTimes(3);
    expect(h.deps.onDone).toHaveBeenCalledTimes(1);
  });

  it('a sentence that fails to decode is skipped; a missing index is passed over once the stream ended', async () => {
    const h = harness();
    h.deps.decode = vi.fn(async (x: Sentence) => { if (x.i === 1) throw new Error('bad'); return { play: async () => {}, stop: () => {} }; }) as never;
    const q = new SentenceQueue(h.deps);
    q.push(s(0)); q.push(s(1)); q.push(s(3));
    await tick(); await tick();
    expect(h.deps.onStart.mock.calls.map((c) => (c[0] as Sentence).i)).toEqual([0]);
    q.end();
    await tick(); await tick();
    expect(h.deps.onStart.mock.calls.map((c) => (c[0] as Sentence).i)).toEqual([0, 3]);
    expect(h.deps.onDone).toHaveBeenCalledTimes(1);
  });

  it('clear() (barge-in) stops the sentence now playing and drops the rest; nothing more plays, no done', async () => {
    const h = harness();
    const q = new SentenceQueue(h.deps);
    q.push(s(0)); q.push(s(1));
    await tick();
    expect(h.playing).toEqual([0]);
    q.clear();
    expect(h.stopped).toEqual([0]);
    await tick();
    q.push(s(2));
    await tick();
    expect(h.playing).toEqual([0]);
    expect(h.deps.onDone).not.toHaveBeenCalled();
  });
});

describe('streamTurn (one streamed voice turn)', () => {
  const deps = (events: VoiceStreamEvent[], r: Awaited<ReturnType<typeof streamVoice>>) => {
    const order: string[] = [];
    let live = true;
    const d = {
      call: vi.fn(async (on: (e: VoiceStreamEvent) => void) => { for (const e of events) on(e); return r; }),
      reply: vi.fn(() => () => { order.push('synth'); }),
      final: vi.fn(() => { order.push('final'); }),
      live: () => live,
      ctx: () => null,
      mouth: vi.fn(),
      done: vi.fn(),
      keep: vi.fn(),
    };
    return { d, order, kill: () => { live = false; } };
  };

  it('no sentence ever sounds (an agent without a voice): `done` applies first, then the text lip-sync says the reply', async () => {
    const { streamTurn } = await import('./voiceStream');
    const { d, order } = deps([{ type: 'transcript', text: 'hi' }, { type: 'reply', text: 'Hello!' }, { type: 'done', goodbye: true }],
      { transcript: 'hi', reply: 'Hello!', goodbye: true });
    const out = await streamTurn(d);
    expect(out.streamed).toBe(true);
    expect(d.reply).toHaveBeenCalledWith({ type: 'reply', text: 'Hello!' });
    expect(order).toEqual(['final', 'synth']);
  });

  it('plain JSON (no events) is not streamed; a stale turn (barge-in, a newer turn) neither finals nor speaks', async () => {
    const { streamTurn } = await import('./voiceStream');
    const a = deps([], { transcript: 'a', reply: 'b' });
    expect(await streamTurn(a.d)).toEqual({ r: { transcript: 'a', reply: 'b' }, streamed: false });
    expect(a.d.reply).not.toHaveBeenCalled();
    const b = deps([{ type: 'reply', text: 'x' }], { transcript: 't', reply: 'x' });
    b.kill();
    await streamTurn(b.d);
    expect(b.order).toEqual([]);
  });
});

describe('pet_action on the stream (design §8.4)', () => {
  it('`done` carries the classified action into the turn, for the page to act on after the reply', async () => {
    const fetch = vi.fn(async () => ndjson([line({ type: 'transcript', text: 'bed time' }), line({ type: 'reply', text: 'Okay!' }), line({ type: 'done', action: { kind: 'sleep', confidence: 0.92 } })]));
    const r = await streamVoice(fetch as never, '/x?stream=1', {}, form(), () => {});
    expect(r).toMatchObject({ transcript: 'bed time', reply: 'Okay!', action: { kind: 'sleep', confidence: 0.92 } });
  });
});
