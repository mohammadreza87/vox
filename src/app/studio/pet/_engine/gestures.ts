/**
 * Pointer → gesture classifier (brief §1.3, §2.6). Pure: feed it samples and a hit test, it answers gestures.
 * `contact` is emitted inside the pointerdown sample so the first squash lands on that same frame; the
 * classified gesture follows on move, up or a timer tick. Escalation counts hits per gesture kind in a sliding
 * 4 s window (mid at 4, max at 7 → a 3 s cool-off where taps only get small squashes; 6 s without touch resets).
 */

import { GESTURE, type GestureClassifier, type GestureEvent, type Hit, type PointerSample } from '../_ui/contract';
import { PHYSICS, type Point } from './types';

type Thresholds = typeof GESTURE;
type Mode = 'press' | 'stroke' | 'drag' | 'track';

interface Ptr {
  id: number;
  downT: number;
  down: Point;
  last: Point;
  hit: Hit | null;
  mode: Mode;
  samples: PointerSample[];
  long: boolean;
  /** stroke bookkeeping */
  dir: -1 | 0 | 1;
  run: number;
  travel: number;
  passes: number;
  reversals: number[];
  strokeOn: boolean;
  offBody: number;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function createGestureClassifier(over: Partial<Thresholds> = {}): GestureClassifier {
  const G: Thresholds = { ...GESTURE, ...over };
  let ptr: Ptr | null = null;
  let pokes: number[] = [];
  const esc: Record<'poke' | 'tickle', number[]> = { poke: [], tickle: [] };
  let coolOffUntil = -Infinity;
  let lastTouch = -Infinity;
  const shake = { times: [] as number[], above: false, last: -Infinity };

  /** Velocity (px/s) over the last ~80 ms of samples. */
  function velocity(p: Ptr): { vx: number; vy: number; speed: number } {
    const s = p.samples, last = s[s.length - 1];
    if (!last || s.length < 2) return { vx: 0, vy: 0, speed: 0 };
    let ref = s[0];
    for (let i = s.length - 2; i >= 0; i--) { ref = s[i]; if (last.t - s[i].t >= 80) break; }
    const dt = Math.max(1, last.t - ref.t) / 1000;
    const vx = (last.x - ref.x) / dt, vy = (last.y - ref.y) / dt;
    return { vx, vy, speed: Math.hypot(vx, vy) };
  }

  function escalate(kind: 'poke' | 'tickle', t: number, hit: Hit | null, at: Point): GestureEvent[] {
    const w = esc[kind];
    w.push(t);
    while (w.length && t - w[0] > G.escalationMs) w.shift();
    const n = w.length;
    if (n >= G.escalationMax) { coolOffUntil = t + G.coolOffMs; w.length = 0; return [{ type: 'overpoke', hits: n, level: 'max' }]; }
    if (n === G.escalationMid) return [{ type: 'overpoke', hits: n, level: 'mid' }];
    if (kind === 'tickle') return [{ type: 'tickle' }];
    return hit ? [{ type: 'poke', hit, at, hits: n, coolOff: false }] : [];
  }

  function tap(p: Ptr, t: number): GestureEvent[] {
    if (!p.hit) return [];
    if (t < coolOffUntil) return [{ type: 'poke', hit: p.hit, at: p.down, hits: 0, coolOff: true }];
    pokes.push(t);
    pokes = pokes.filter((x) => t - x <= G.ticklePokeMs);
    // ≥ 4 pokes within 1 s is a tickle (each further burst of 4 tickles again)
    if (pokes.length >= G.ticklePokes) { pokes = []; return escalate('tickle', t, p.hit, p.down); }
    return escalate('poke', t, p.hit, p.down);
  }

  function strokeMove(p: Ptr, s: PointerSample, hit: Hit | null): GestureEvent[] {
    const out: GestureEvent[] = [];
    const prev = p.samples[p.samples.length - 2];
    if (!prev) return out;
    const dx = s.x - prev.x;
    p.travel += Math.hypot(dx, s.y - prev.y);
    const d = Math.sign(dx) as -1 | 0 | 1;
    if (d !== 0) {
      if (p.dir !== 0 && d !== p.dir && Math.abs(p.run) >= 4) {
        // a reversal: rubbing back and forth (tickle when fast, a new stroke pass when long enough)
        p.reversals.push(s.t);
        p.reversals = p.reversals.filter((x) => s.t - x <= G.tickleReversalMs);
        if (Math.abs(p.run) >= G.strokePx) p.passes++;
        p.run = 0;
        if (p.reversals.length >= G.tickleReversals) { p.reversals = []; out.push(...escalate('tickle', s.t, hit, s)); }
        else if (p.strokeOn) out.push(stroke(p));
      }
      p.dir = d;
      p.run += dx;
    }
    const v = velocity(p);
    if (!p.strokeOn && s.t - p.downT >= G.strokeMs && p.travel >= G.strokePx && v.speed >= G.strokeMinV && v.speed <= G.strokeMaxV) {
      p.strokeOn = true;
      p.passes = Math.max(1, p.passes);
      out.push(stroke(p));
    }
    return out;
  }

  function stroke(p: Ptr): GestureEvent {
    return { type: 'stroke', speed: Math.round(velocity(p).speed), dir: p.dir === -1 ? -1 : 1, passes: p.passes };
  }

  function startDrag(p: Ptr, s: PointerSample): GestureEvent[] {
    p.mode = 'drag';
    const v = velocity(p);
    return [{ type: 'dragStart', at: p.down }, { type: 'dragMove', at: { x: s.x, y: s.y }, vx: v.vx, vy: v.vy }];
  }

  return {
    feed(s, hitAt) {
      const at = { x: s.x, y: s.y };
      if (s.kind === 'down') {
        if (ptr && ptr.id !== s.id) return [];
        // 6 s without any touch: the escalation forgets everything
        if (s.t - lastTouch > G.resetMs) { esc.poke = []; esc.tickle = []; coolOffUntil = -Infinity; pokes = []; }
        lastTouch = s.t;
        const hit = hitAt(at);
        ptr = { id: s.id, downT: s.t, down: at, last: at, hit, mode: hit ? 'press' : 'track', samples: [s], long: false, dir: 0, run: 0, travel: 0, passes: 0, reversals: [], strokeOn: false, offBody: 0 };
        return hit ? [{ type: 'contact', hit, at }] : [{ type: 'track', at }];
      }
      const p = ptr;
      if (!p || p.id !== s.id) return [];
      lastTouch = s.t;
      if (s.kind === 'move') {
        p.samples.push(s);
        while (p.samples.length > 2 && s.t - p.samples[0].t > 160) p.samples.shift();
        p.last = at;
        if (p.mode === 'track') return [{ type: 'track', at }];
        if (p.mode === 'drag') { const v = velocity(p); return [{ type: 'dragMove', at, vx: v.vx, vy: v.vy }]; }
        const hit = hitAt(at);
        if (!hit) p.offBody++; else p.offBody = 0;
        if (p.mode === 'press') {
          if (p.long || dist(p.down, at) < Math.max(G.tapPx, G.dragPx)) return [];
          // a grab that leaves the body, or moves faster than any stroke, is a drag; on the body it is a stroke
          if (!hit || velocity(p).speed > G.strokeMaxV) return startDrag(p, s);
          p.mode = 'stroke';
        }
        // a first pass that carries on off the body (≥ 10 px past its edge) was a grab after all: a drag. Once the
        // finger has rubbed back and forth it is petting, wherever it wanders
        if (p.mode === 'stroke' && !hit && p.offBody >= 1 && p.passes <= 1 && p.reversals.length === 0) { p.offBody++; return startDrag(p, s); }
        return strokeMove(p, s, hit);
      }
      // up / cancel
      ptr = null;
      if (p.mode === 'track') return [{ type: 'trackEnd' }];
      if (p.mode === 'drag') {
        p.samples.push(s);
        const v = s.kind === 'cancel' ? { vx: 0, vy: 0, speed: 0 } : velocity(p);
        return [{ type: 'release', at, vx: v.vx, vy: v.vy, fling: v.speed > PHYSICS.flingV }];
      }
      if (p.mode === 'press' && s.kind === 'up' && !p.long && s.t - p.downT < G.tapMs && dist(p.down, at) < G.tapPx) return tap(p, s.t);
      return [];
    },

    tick(now) {
      const p = ptr;
      if (p && p.mode === 'press' && p.hit && !p.long && now - p.downT >= G.longPressMs && dist(p.down, p.last) < G.tapPx) {
        p.long = true;
        return [{ type: 'longPress', hit: p.hit, at: p.down }];
      }
      return [];
    },

    accel(a, now) {
      const above = Math.hypot(a.x, a.y, a.z) > G.shakeA;
      if (above && !shake.above) shake.times.push(now);
      shake.above = above;
      shake.times = shake.times.filter((t) => now - t <= G.shakeMs);
      if (shake.times.length >= G.shakeCount && now - shake.last >= G.shakeCooldownMs) {
        shake.last = now;
        shake.times = [];
        return [{ type: 'shake' }];
      }
      return [];
    },

    reset() {
      ptr = null; pokes = []; esc.poke = []; esc.tickle = []; coolOffUntil = -Infinity; lastTouch = -Infinity;
      shake.times = []; shake.above = false;
    },
  };
}
