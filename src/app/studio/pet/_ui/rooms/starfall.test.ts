import { describe, expect, it } from 'vitest';
import { STARFALL, StarfallRound, roundId } from './starfall';

const field = { x0: 0, x1: 400, y0: 0, catchY: 300, size: 200 };
/** stars always spawn at x = 200 */
const centre = () => 0.5;

describe('Starfall round (design §4.2, §10.6)', () => {
  it('a star reaching the mouth line near the pet is caught; one passing just beside it is a near miss, never counted against you', () => {
    const r = new StarfallRound({ ...field, zen: false, random: centre });
    const ev = [];
    for (let t = 0; t < 3000; t += 20) ev.push(...r.step(20, 200));
    expect(ev.filter((e) => e.type === 'catch').length).toBeGreaterThan(0);
    expect(r.pips).toBe(r.caught);
    const far = new StarfallRound({ ...field, zen: false, random: centre });
    const fe = [];
    for (let t = 0; t < 3000; t += 20) fe.push(...far.step(20, 200 + field.size * 0.45));
    expect(fe.some((e) => e.type === 'nearMiss')).toBe(true);
    expect(fe.some((e) => e.type === 'catch')).toBe(false);
    expect(far.caught).toBe(0);
  });

  it('ends when every pip is lit or its time is up; Zen never ends and has no timer', () => {
    const r = new StarfallRound({ ...field, zen: false, random: centre });
    let end = null;
    for (let t = 0; t < STARFALL.roundMs + 1000 && !end; t += 20) end = r.step(20, 200).find((e) => e.type === 'end') ?? null;
    expect(end).toEqual({ type: 'end', caught: STARFALL.pips });
    expect(r.won).toBe(true);
    const slow = new StarfallRound({ ...field, zen: false, random: centre });
    let out = null;
    for (let t = 0; t <= STARFALL.roundMs + 40 && !out; t += 20) out = slow.step(20, 900).find((e) => e.type === 'end') ?? null;
    expect(out).toEqual({ type: 'end', caught: 0 });
    const zen = new StarfallRound({ ...field, zen: true, random: centre });
    for (let t = 0; t < STARFALL.roundMs * 3; t += 20) expect(zen.step(20, 200).some((e) => e.type === 'end')).toBe(false);
    expect(zen.over).toBe(false);
  });

  it('reduced motion keeps the stars falling, slower (§10.8)', () => {
    const a = new StarfallRound({ ...field, zen: false, random: centre });
    const b = new StarfallRound({ ...field, zen: false, reduced: true, random: centre });
    a.step(500, 0); b.step(500, 0);
    a.step(100, 0); b.step(100, 0);
    expect(b.stars[0].y).toBeLessThan(a.stars[0].y);
  });

  it('round ids fit the server rule (8-40 of [A-Za-z0-9_-])', () => {
    expect(roundId()).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
  });
});
