import { describe, expect, it } from 'vitest';
import type { GestureEvent, Hit, PointerSample } from '../_ui/contract';
import { createGestureClassifier } from './gestures';
import type { Point } from './types';

/** A round body of radius 60 around (100, 100): the head above y 70, eyes at (83|117, 90). */
const hit = (p: Point): Hit | null => {
  if (Math.hypot(p.x - 100, p.y - 100) > 60) return null;
  const local = { x: p.x, y: p.y };
  if (Math.hypot(p.x - 83, p.y - 90) < 8) return { zone: 'eye', side: -1, local };
  if (p.y < 70) return { zone: 'head', side: 0, local };
  return { zone: 'belly', side: 0, local };
};

const s = (kind: PointerSample['kind'], x: number, y: number, t: number, id = 1): PointerSample => ({ kind, id, x, y, t });
const types = (es: GestureEvent[]) => es.map((e) => e.type);

/** Feed a stream of samples and collect every event (with ticks every 16 ms in between). */
function play(samples: PointerSample[], c = createGestureClassifier()): GestureEvent[] {
  const out: GestureEvent[] = [];
  let last = samples[0]?.t ?? 0;
  for (const p of samples) {
    for (let t = last + 16; t < p.t; t += 16) out.push(...c.tick(t));
    out.push(...c.feed(p, hit));
    last = p.t;
  }
  return out;
}

/** A finger moving from a to b over ms, sampled every 16 ms. */
function path(a: Point, b: Point, t0: number, ms: number): PointerSample[] {
  const n = Math.max(1, Math.round(ms / 16));
  return Array.from({ length: n }, (_, i) => { const u = (i + 1) / n; return s('move', a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, t0 + u * ms); });
}

describe('gesture classifier (brief §1.3, §2.6)', () => {
  it('contact lands in the pointerdown sample itself, then a tap is a poke with its zone', () => {
    const c = createGestureClassifier();
    const down = c.feed(s('down', 100, 120, 0), hit);
    expect(types(down)).toEqual(['contact']);
    const up = c.feed(s('up', 101, 121, 120), hit);
    expect(up).toEqual([expect.objectContaining({ type: 'poke', hits: 1, coolOff: false, hit: expect.objectContaining({ zone: 'belly' }) })]);
    expect(play([s('down', 83, 90, 5000), s('up', 83, 90, 5100)], c).find((e) => e.type === 'poke')).toMatchObject({ hit: { zone: 'eye', side: -1 } });
    expect(play([s('down', 100, 50, 9000), s('up', 100, 50, 9100)], c).find((e) => e.type === 'poke')).toMatchObject({ hit: { zone: 'head' } });
  });

  it('a press held 420 ms is a long-press (fired by the timer, not the release)', () => {
    const es = play([s('down', 100, 120, 0), s('move', 102, 121, 200), s('up', 102, 121, 700)]);
    expect(types(es)).toEqual(['contact', 'longPress']);
  });

  it('off the character, the finger is tracked', () => {
    expect(types(play([s('down', 10, 10, 0), ...path({ x: 10, y: 10 }, { x: 30, y: 10 }, 0, 100), s('up', 30, 10, 120)]))).toEqual(['track', ...Array(6).fill('track'), 'trackEnd']);
  });

  it('a slow pass across the body is a stroke (pet), with passes counted', () => {
    const es = play([s('down', 70, 120, 0), ...path({ x: 70, y: 120 }, { x: 130, y: 120 }, 0, 400), ...path({ x: 130, y: 120 }, { x: 70, y: 120 }, 400, 400), s('up', 70, 120, 820)]);
    const strokes = es.filter((e) => e.type === 'stroke');
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    expect(strokes[0]).toMatchObject({ type: 'stroke', dir: 1 });
    expect(Math.max(...strokes.map((e) => (e.type === 'stroke' ? e.passes : 0)))).toBeGreaterThanOrEqual(2);
    expect(es.some((e) => e.type === 'dragStart')).toBe(false);
  });

  it('fast rubbing (3 reversals in 600 ms) is a tickle', () => {
    const rub: PointerSample[] = [s('down', 90, 120, 0)];
    let x = 90, t = 0;
    for (let i = 0; i < 4; i++) { const to = i % 2 ? 90 : 110; rub.push(...path({ x, y: 120 }, { x: to, y: 120 }, t, 80)); x = to; t += 80; }
    rub.push(s('up', x, 120, t + 10));
    expect(types(play(rub))).toContain('tickle');
  });

  it('four pokes within a second are a tickle', () => {
    const taps = [0, 200, 400, 600].flatMap((t) => [s('down', 100, 120, t), s('up', 100, 120, t + 60)]);
    const es = play(taps);
    expect(types(es).filter((x) => x === 'poke').length).toBe(3);
    expect(types(es)).toContain('tickle');
  });

  it('a grab pulled off the body is a drag; a fast release is a fling, a slow one a drop', () => {
    const fling = play([s('down', 100, 120, 0), ...path({ x: 100, y: 120 }, { x: 260, y: 60 }, 0, 120), s('up', 260, 60, 130)]);
    expect(types(fling)).toContain('dragStart');
    expect(fling.find((e) => e.type === 'release')).toMatchObject({ fling: true });
    const drop = play([s('down', 100, 120, 0), ...path({ x: 100, y: 120 }, { x: 200, y: 120 }, 0, 600), ...path({ x: 200, y: 120 }, { x: 205, y: 121 }, 600, 300), s('up', 205, 121, 920)]);
    expect(types(drop)).toContain('dragStart');
    expect(drop.find((e) => e.type === 'release')).toMatchObject({ fling: false });
  });

  it('escalates per kind in a sliding 4 s window: mid at 4, max at 7, a 3 s cool-off, reset after 6 s', () => {
    const c = createGestureClassifier();
    const tap = (t: number) => [...c.feed(s('down', 100, 120, t), hit), ...c.feed(s('up', 100, 120, t + 50), hit)].filter((e) => e.type !== 'contact');
    const seen: GestureEvent[] = [];
    // one poke every 500 ms: never 4 within a second, so never a tickle
    for (let i = 0; i < 7; i++) seen.push(...tap(i * 500));
    expect(seen.map((e) => (e.type === 'poke' ? `poke${e.hits}` : e.type === 'overpoke' ? e.level : e.type))).toEqual(['poke1', 'poke2', 'poke3', 'mid', 'poke5', 'poke6', 'max']);
    // the cool-off: taps only get small squashes
    expect(tap(3500)[0]).toMatchObject({ type: 'poke', coolOff: true });
    // after it, the window starts again
    expect(tap(6200)[0]).toMatchObject({ type: 'poke', coolOff: false, hits: 1 });
    // hits that slid out of the 4 s window no longer count
    expect(tap(6700)[0]).toMatchObject({ hits: 2 });
    expect(tap(11500)[0]).toMatchObject({ hits: 1 });
    // 6 s without any touch resets everything
    for (let i = 0; i < 3; i++) tap(12000 + i * 500);
    expect(tap(19000)[0]).toMatchObject({ hits: 1 });
  });

  it('shake: |a| > 15 m/s² three times within 1 s, once per 5 s', () => {
    const c = createGestureClassifier();
    const out: GestureEvent[] = [];
    const g = { x: 0, y: 9.8, z: 0 }, hard = { x: 14, y: 9.8, z: 4 };
    for (let t = 0; t < 1000; t += 50) out.push(...c.accel(Math.floor(t / 100) % 2 ? hard : g, t));
    expect(types(out)).toEqual(['shake']);
    for (let t = 1000; t < 4000; t += 50) out.push(...c.accel(Math.floor(t / 100) % 2 ? hard : g, t));
    expect(types(out)).toEqual(['shake']);
    for (let t = 6000; t < 7000; t += 50) out.push(...c.accel(Math.floor(t / 100) % 2 ? hard : g, t));
    expect(types(out)).toEqual(['shake', 'shake']);
  });
});
