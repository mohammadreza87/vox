import { describe, expect, it } from 'vitest';
import { BLINK_LID } from '../../_components/character/poses';
import { BLINK, BLINK_CLAMP, BLINK_SIGMA, Blinker, blinkGap, lidAt, SLOW_BLINK } from './blink';
import { seeded } from './rng';

/** Φ, the standard normal CDF (Abramowitz–Stegun 7.1.26 through erf). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + Math.sign(z) * y);
}

describe('blink gaps (brief §2.4)', () => {
  it('are log-normal around the median (Kolmogorov–Smirnov against the clamped CDF)', () => {
    const rng = seeded(42), median = 3.5, n = 3000;
    const xs = Array.from({ length: n }, () => blinkGap(rng, median)).sort((a, b) => a - b);
    const [lo, hi] = BLINK_CLAMP;
    // the clamped log-normal: mass below lo sits at lo, above hi at hi
    const cdf = (x: number) => (x < lo ? 0 : x >= hi ? 1 : phi((Math.log(x) - Math.log(median)) / BLINK_SIGMA));
    let d = 0;
    xs.forEach((x, i) => { const f = cdf(x); d = Math.max(d, Math.abs((i + 1) / n - f), Math.abs(i / n - f)); });
    // α = 0.01 critical value 1.63/√n
    expect(d).toBeLessThan(1.63 / Math.sqrt(n));
    // and they are not uniform: the median of the draws sits at the median
    expect(Math.abs(xs[n >> 1] - median)).toBeLessThan(0.2);
    expect(xs[0]).toBeGreaterThanOrEqual(lo);
    expect(xs[n - 1]).toBeLessThanOrEqual(hi);
  });

  it('close 60 / hold 30 / open 90 ms, closing faster than opening', () => {
    expect(lidAt(0, BLINK)).toBe(1);
    expect(lidAt(60, BLINK)).toBeCloseTo(BLINK_LID, 5);
    expect(lidAt(89, BLINK)).toBeCloseTo(BLINK_LID, 5);
    expect(lidAt(180, BLINK)).toBeCloseTo(1, 5);
    // half closed in under half the closing time is impossible on an ease-in; half open early on the ease-out
    expect(lidAt(30, BLINK)).toBeGreaterThan(lidAt(90 + 45, BLINK) - 0.5);
    expect(SLOW_BLINK.close + SLOW_BLINK.hold + SLOW_BLINK.open).toBe(520);
  });

  it('suppresses during happy arcs / sleep and always runs both halves of a double', () => {
    const b = new Blinker(seeded(3));
    b.suppress(true, 0);
    let min = 1;
    for (let t = 0; t < 20000; t += 16) min = Math.min(min, b.lid(t));
    expect(min).toBe(1);
    b.suppress(false, 20000);
    b.force(20000, 'double');
    const closes: number[] = [];
    let prev = 1;
    for (let t = 20000; t < 20600; t += 4) { const l = b.lid(t); if (l <= BLINK_LID + 1e-6 && prev > BLINK_LID + 1e-6) closes.push(t); prev = l; }
    expect(closes.length).toBe(2);
  });
});
