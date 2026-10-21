import { describe, expect, it } from 'vitest';
import { follow, followerAtRest, makeFollower } from './follower';
import { analyse, makeSpring, presetKC, retarget, step, stepResponse } from './spring';
import { FOLLOWERS, LOOP, SPRINGS, springKC, type SpringPreset } from './types';

/** Linear interpolation of a sampled curve at time t. */
function at(curve: Array<[number, number]>, t: number): number {
  for (let i = 1; i < curve.length; i++) {
    const [t1, x1] = curve[i];
    if (t1 >= t) { const [t0, x0] = curve[i - 1]; return x0 + ((x1 - x0) * (t - t0)) / (t1 - t0 || 1); }
  }
  return curve[curve.length - 1][1];
}

describe('spring presets (brief §2.2)', () => {
  it('k = (2π/d)², c = 4π(1 − bounce)/d, matching the table', () => {
    const table: Record<SpringPreset, [number, number]> = { eye: [3948, 126], snap: [987, 53], pop: [439, 23], jelly: [130, 10.3], float: [62, 12.6], sleepy: [27, 10.5] };
    for (const [p, [k, c]] of Object.entries(table) as Array<[SpringPreset, [number, number]]>) {
      const kc = springKC(SPRINGS[p].visualDuration, SPRINGS[p].bounce);
      expect(SPRINGS[p].k).toBeCloseTo(kc.k, 1);
      expect(SPRINGS[p].c).toBeCloseTo(kc.c, 1);
      // the brief's table is rounded
      expect(Math.abs(SPRINGS[p].k - k) / k).toBeLessThan(0.02);
      expect(Math.abs(SPRINGS[p].c - c) / c).toBeLessThan(0.02);
    }
  });

  it('pop settles within 2 % by 450 ms; jelly shows at least two visible oscillations', () => {
    expect(analyse(stepResponse(presetKC('pop'), 1200, 60)).settleMs).toBeLessThanOrEqual(450);
    expect(analyse(stepResponse(presetKC('jelly'), 2000, 60)).peaks).toBeGreaterThanOrEqual(2);
    // eyes and sleep never bounce
    expect(analyse(stepResponse(presetKC('eye'), 600, 60)).overshoot).toBeLessThan(0.005);
    expect(analyse(stepResponse(presetKC('sleepy'), 3000, 60)).overshoot).toBeLessThan(0.005);
  });
});

describe('frame-rate independence (brief §4.3 point 3)', () => {
  const presets = Object.keys(SPRINGS) as SpringPreset[];

  it('the same trajectory at 30, 60 and 120 Hz within 1 % of the amplitude', () => {
    for (const p of presets) {
      const ref = stepResponse(presetKC(p), 1500, 120);
      for (const hz of [30, 60]) {
        const c = stepResponse(presetKC(p), 1500, hz);
        for (const [t, x] of c) expect(Math.abs(x - at(ref, t))).toBeLessThan(0.01);
      }
    }
  });

  it('a 64 ms hitch lands on the same trajectory within 1 %', () => {
    for (const p of presets) {
      const ref = stepResponse(presetKC(p), 1500, 120);
      for (const hz of [30, 60, 120]) {
        const c = stepResponse(presetKC(p), 1500, hz, 200);
        for (const [t, x] of c) expect(Math.abs(x - at(ref, t))).toBeLessThan(0.01);
      }
    }
  });

  it('clamps a long frame to 64 ms (a hitch never launches a spring)', () => {
    const a = makeSpring(0, 'snap'), b = makeSpring(0, 'snap');
    retarget(a, 1); retarget(b, 1);
    step(a, 500);
    step(b, LOOP.maxDtMs);
    expect(a.x).toBeCloseTo(b.x, 10);
  });

  it('retargeting keeps velocity (an interrupt never restarts)', () => {
    const s = makeSpring(0, 'pop');
    retarget(s, 1);
    step(s, 50);
    const v = s.v;
    retarget(s, -1, presetKC('pop'));
    expect(s.v).toBe(v);
  });

  it('a stiff squash released on a soft spring does not fling past its own depth', () => {
    const s = makeSpring(1, 'eye');
    retarget(s, 0.7, presetKC('eye'));
    step(s, 33);
    retarget(s, 1, presetKC('jelly'));
    let min = s.x;
    for (let i = 0; i < 120; i++) { step(s, 1000 / 60); min = Math.min(min, s.x); }
    expect(min).toBeGreaterThan(0.6);
  });
});

describe('followers (t3ssel8r second-order systems)', () => {
  it('reach the input and come to rest', () => {
    for (const p of Object.keys(FOLLOWERS) as Array<keyof typeof FOLLOWERS>) {
      const f = makeFollower(0, p);
      for (let i = 0; i < 400; i++) follow(f, 10, 1000 / 60);
      expect(f.y).toBeCloseTo(10, 1);
      expect(followerAtRest(f)).toBe(true);
    }
  });

  it('r < 0 holds back at the start of a move (the ear anticipation)', () => {
    const a = makeFollower(0, 'ear'), b = makeFollower(0, { ...FOLLOWERS.ear, r: 0 });
    let lag = 0;
    for (let i = 1; i <= 8; i++) { const x = Math.min(10, i * 2.5); follow(a, x, 1000 / 60); follow(b, x, 1000 / 60); lag = Math.min(lag, a.y - b.y); }
    expect(lag).toBeLessThan(-0.05);
  });

  it('are frame-rate independent within 2 % of the step and stable at long frames', () => {
    const run = (hz: number) => {
      const f = makeFollower(0, 'floppy'), out: Array<[number, number]> = [[0, 0]];
      let t = 0;
      while (t < 1500) { t += 1000 / hz; follow(f, 10, 1000 / hz); out.push([t, f.y]); }
      return out;
    };
    const ref = run(120);
    for (const hz of [30, 60]) for (const [t, y] of run(hz)) if (t > 50) expect(Math.abs(y - at(ref, t))).toBeLessThan(0.2);
    const f = makeFollower(0, 'cheek');
    for (let i = 0; i < 20; i++) follow(f, 1, 64);
    expect(Number.isFinite(f.y) && Math.abs(f.y - 1) < 0.2).toBe(true);
  });
});
