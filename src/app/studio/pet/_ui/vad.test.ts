import { describe, expect, it } from 'vitest';
import { createVad, VAD, type VadEvent } from './vad';

/** Feed `ms` of frames at `db` from `t`, returning the events and the new time. */
function run(v: ReturnType<typeof createVad>, t: number, ms: number, db: number, playing = false) {
  const ev: VadEvent[] = [];
  for (let x = 0; x < ms; x += VAD.frameMs) { t += VAD.frameMs; ev.push(...v.frame(db, t, playing)); }
  return { ev, t };
}

describe('hands-free detector (vad.ts state machine)', () => {
  it('learns the room, then a voice above the floor starts (candidate first) and ends after the silence window', () => {
    const v = createVad(0);
    let r = run(v, 0, 2000, -62);
    expect(r.ev).toEqual([]);
    expect(v.floor).toBeLessThan(-58);
    r = run(v, r.t, 600, -30);
    expect(r.ev).toEqual(['candidate', 'start']);
    expect(v.state).toBe('speech');
    // a pause shorter than the end window does not end it
    r = run(v, r.t, VAD.endMs - 100, -62);
    expect(r.ev).toEqual([]);
    r = run(v, r.t, 200, -30);
    r = run(v, r.t, VAD.endMs + 40, -62);
    expect(r.ev).toEqual(['end']);
    expect(v.state).toBe('quiet');
  });

  it('a blip shorter than the start window is cancelled; an utterance under the minimum is dropped', () => {
    const v = createVad(0);
    let r = run(v, 0, 1000, -60);
    r = run(v, r.t, 60, -25);
    expect(r.ev).toEqual(['candidate']);
    r = run(v, r.t, 40, -60);
    expect(r.ev).toEqual(['cancel']);
    r = run(v, r.t, 200, -25);
    expect(r.ev).toEqual(['candidate', 'start']);
    r = run(v, r.t, VAD.endMs + 40, -60);
    expect(r.ev).toEqual(['tooShort']);
  });

  it('while the pet speaks the start needs the louder margin and the longer hold (barge-in, not its own voice)', () => {
    const v = createVad(0);
    let r = run(v, 0, 1000, -60);
    const echo = -60 + VAD.marginDb + 3;
    r = run(v, r.t, 400, echo, true);
    expect(r.ev).toEqual([]);
    r = run(v, r.t, VAD.playbackStartMs - 40, echo + VAD.playbackDb + 5, true);
    expect(r.ev).toEqual(['candidate']);
    r = run(v, r.t, 80, echo + VAD.playbackDb + 5, true);
    expect(r.ev).toEqual(['start']);
  });

  it('cuts at the maximum length, and turns itself off after a minute without speech (once)', () => {
    const v = createVad(0);
    let r = run(v, 0, 1000, -60);
    r = run(v, r.t, VAD.maxMs + 200, -20);
    // cut at the maximum; still talking, the next utterance starts at once
    expect(r.ev).toEqual(['candidate', 'start', 'end', 'candidate', 'start']);
    const w = createVad(0);
    r = run(w, 0, VAD.idleMs + 100, -60);
    expect(r.ev).toEqual(['idle']);
    r = run(w, r.t, 2000, -60);
    expect(r.ev).toEqual([]);
  });

  it('hold() restarts the idle clock (the pet thinking or speaking is not the person going quiet)', () => {
    const v = createVad(0);
    let r = run(v, 0, VAD.idleMs - 1000, -60);
    v.hold(r.t);
    r = run(v, r.t, 30_000, -60);
    expect(r.ev).toEqual([]);
  });
});
