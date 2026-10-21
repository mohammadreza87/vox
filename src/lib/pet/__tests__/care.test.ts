import { describe, expect, it } from 'vitest';
import {
  apply, CARE, clampNeeds, decay, DECAY_PER_HOUR, isQuiet, mood, newCare, NEW_PET, open, quietHours, safeZone, talk, welcomeBack,
} from '../care';
import { NEED_FLOOR, NEED_KEYS, type PetAction, type PetCare } from '../types';

const H = 3_600_000;
const D = 24 * H;
/** Noon UTC on a Tuesday: outside quiet hours in UTC. */
const NOON = Date.UTC(2026, 9, 20, 12);

function pet(over: Partial<PetCare> = {}, at = NOON, tz = 'UTC'): PetCare {
  return { ...newCare('agent-1', 42, at, tz, 2), ...over };
}

describe('newCare and zones', () => {
  it('starts content, awake, with the current stage seen and empty caps', () => {
    const care = newCare('agent-1', 42, NOON, 'Asia/Tehran', 3);
    expect(care).toMatchObject({ v: 1, agentId: 'agent-1', userId: 42, ...NEW_PET, bond: 0, seenBond: 0, asleep: false, tz: 'Asia/Tehran',
      quietStart: 22, quietEnd: 8, lastSeenStage: 3, lastUpdatedAt: NOON, lastSeenAt: NOON, firstMetAt: NOON,
      caps: { hourStart: NOON, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: NOON } });
  });

  it('falls back to UTC for anything that is not a zone the runtime knows', () => {
    expect(safeZone('Europe/Berlin')).toBe('Europe/Berlin');
    for (const bad of [undefined, 42, '', 'Mars/Olympus', 'x'.repeat(65)]) expect(safeZone(bad)).toBe('UTC');
    expect(newCare('a', 1, NOON, 'nope', 1).tz).toBe('UTC');
  });

  it('reads quiet hours on the user wall clock, wrapping midnight', () => {
    // Tehran is UTC+3:30: 22:00 local is 18:30Z, 08:00 local is 04:30Z.
    expect(isQuiet(Date.UTC(2026, 9, 20, 18, 29), 'Asia/Tehran')).toBe(false);
    expect(isQuiet(Date.UTC(2026, 9, 20, 18, 30), 'Asia/Tehran')).toBe(true);
    expect(isQuiet(Date.UTC(2026, 9, 20, 23), 'Asia/Tehran')).toBe(true);
    expect(isQuiet(Date.UTC(2026, 9, 21, 4, 29), 'Asia/Tehran')).toBe(true);
    expect(isQuiet(Date.UTC(2026, 9, 21, 4, 30), 'Asia/Tehran')).toBe(false);
    // a non-wrapping window, and an empty one
    expect(isQuiet(Date.UTC(2026, 9, 20, 3), 'UTC', 1, 6)).toBe(true);
    expect(isQuiet(Date.UTC(2026, 9, 20, 7), 'UTC', 1, 6)).toBe(false);
    expect(isQuiet(Date.UTC(2026, 9, 20, 0), 'UTC', 1, 6)).toBe(false);
    expect(isQuiet(Date.UTC(2026, 9, 20, 5), 'UTC', 5, 5)).toBe(false);
    expect(quietHours(pet({ tz: 'Asia/Tehran' }), Date.UTC(2026, 9, 20, 20))).toBe(true);
  });
});

describe('decay', () => {
  it('drops every need at its hourly rate while awake outside quiet hours', () => {
    const care = decay(pet(), NOON + 2 * H);
    expect(care).toMatchObject({ tummy: 75 - 2 * DECAY_PER_HOUR.tummy, joy: 80 - 2 * DECAY_PER_HOUR.joy, energy: 85 - 2 * DECAY_PER_HOUR.energy, lastUpdatedAt: NOON + 2 * H });
  });

  it('never goes below the floors, however long the absence (and stays fast)', () => {
    const started = Date.now();
    const care = decay(pet({ energy: 21 }), NOON + 400 * D);
    expect(Date.now() - started).toBeLessThan(500);
    expect(care.tummy).toBe(NEED_FLOOR.tummy);
    expect(care.joy).toBe(NEED_FLOOR.joy);
    for (const key of NEED_KEYS) expect(care[key]).toBeGreaterThanOrEqual(NEED_FLOOR[key]);
  });

  it('stops decay in quiet hours and refills Energy 12 an hour', () => {
    const night = Date.UTC(2026, 9, 20, 22);
    const care = decay(pet({ energy: 30 }, night), night + 5 * H);
    expect(care).toMatchObject({ tummy: 75, joy: 80, energy: 30 + 5 * CARE.quietEnergyPerHour });
    expect(decay(pet({ energy: 30 }, night), night + 10 * H).energy).toBe(100);
  });

  it('splits an evening-to-morning span across midnight into awake, quiet, awake', () => {
    const evening = Date.UTC(2026, 9, 20, 20);
    const care = decay(pet({ energy: 50 }, evening), evening + 14 * H);
    // 20–22 awake (2 h), 22–08 quiet (10 h), 08–10 awake (2 h)
    expect(care.tummy).toBe(75 - 4 * DECAY_PER_HOUR.tummy);
    expect(care.energy).toBe(Math.min(100, 50 - 6 + 120) - 6);
  });

  it('follows DST: a fall-back night is 11 real hours, a spring-forward night 9', () => {
    const ny = 'America/New_York';
    // 2026-10-31 21:00 EDT (01:00Z) → 2026-11-01 09:00 EST (14:00Z): awake 1 h + 1 h around an 11 h night
    const fall = decay(pet({ energy: 40 }, Date.UTC(2026, 10, 1, 1), ny), Date.UTC(2026, 10, 1, 14), ny);
    expect(fall.tummy).toBe(75 - 2 * DECAY_PER_HOUR.tummy);
    expect(fall.energy).toBe(Math.min(100, 37 + 11 * CARE.quietEnergyPerHour) - 3);
    // 2026-03-07 21:00 EST (02:00Z) → 2026-03-08 09:00 EDT (13:00Z): awake 1 h + 1 h around a 9 h night.
    // A fixed −5 offset would read 13:00Z as 08:00 and count only 1 awake hour.
    const spring = decay(pet({ energy: 40 }, Date.UTC(2026, 2, 8, 2), ny), Date.UTC(2026, 2, 8, 13), ny);
    expect(spring.tummy).toBe(75 - 2 * DECAY_PER_HOUR.tummy);
    expect(spring.energy).toBe(Math.min(100, 37 + 9 * CARE.quietEnergyPerHour) - 3);
  });

  it('a nap refills Energy a point a minute and pauses the other needs', () => {
    const care = decay(pet({ asleep: true, sleptAt: NOON, energy: 20 }), NOON + 30 * 60_000);
    expect(care).toMatchObject({ energy: 50, tummy: 75, joy: 80 });
  });

  it('uses the request zone when given, else the stored one', () => {
    // 20:00Z is quiet in Tehran (23:30) but not in UTC
    const at = Date.UTC(2026, 9, 20, 20);
    expect(decay(pet({}, at), at + H, 'Asia/Tehran')).toMatchObject({ tz: 'Asia/Tehran', tummy: 75 });
    expect(decay(pet({}, at), at + H)).toMatchObject({ tz: 'UTC', tummy: 70 });
    expect(decay(pet({}, at), at + H, 'garbage').tz).toBe('UTC');
  });

  it('is a no-op on needs when the clock runs behind the last update', () => {
    const care = decay(pet(), NOON - H);
    expect(care).toMatchObject({ tummy: 75, joy: 80, energy: 85, lastUpdatedAt: NOON });
  });

  it('clamps stored nonsense into [floor, 100]', () => {
    const care = clampNeeds(pet({ tummy: Number.NaN, joy: 140, energy: -5 }));
    expect(care).toMatchObject({ tummy: NEED_FLOOR.tummy, joy: 100, energy: NEED_FLOOR.energy });
  });
});

describe('apply', () => {
  it('feed: +35 Tummy, +1 Bond, wakes a napping pet; full at 90 is a guard with no change', () => {
    const fed = apply(pet({ tummy: 40, asleep: true, sleptAt: NOON }), 'feed', NOON);
    expect(fed).toEqual({ care: expect.objectContaining({ tummy: 75, bond: 1, asleep: false }) });
    expect(fed.care.sleptAt).toBeUndefined();
    expect(apply(pet({ tummy: 80 }), 'feed', NOON).care.tummy).toBe(100);
    const full = apply(pet({ tummy: 90 }), 'feed', NOON);
    expect(full).toMatchObject({ guard: 'full', care: { tummy: 90, bond: 0 } });
  });

  it('play: +25 Joy, −8 Energy (never below the floor); tired below 25 is a guard with no change', () => {
    expect(apply(pet({ joy: 50, energy: 60 }), 'play', NOON).care).toMatchObject({ joy: 75, energy: 52, bond: 1 });
    expect(apply(pet({ energy: 26, asleep: true, sleptAt: NOON }), 'play', NOON).care).toMatchObject({ energy: NEED_FLOOR.energy, asleep: false });
    expect(apply(pet({ energy: 24, joy: 40 }), 'play', NOON)).toMatchObject({ guard: 'tired', care: { energy: 24, joy: 40 } });
  });

  it('sleep and wake are idempotent: a repeat is a noop guard', () => {
    const asleep = apply(pet(), 'sleep', NOON + 5);
    expect(asleep.care).toMatchObject({ asleep: true, sleptAt: NOON + 5, bond: 1 });
    expect(apply(asleep.care, 'sleep', NOON + 6)).toMatchObject({ guard: 'noop', care: { sleptAt: NOON + 5, bond: 1 } });
    const awake = apply(asleep.care, 'wake', NOON + 7);
    expect(awake.care.asleep).toBe(false);
    expect(awake.care.bond).toBe(1);
    expect(apply(awake.care, 'wake', NOON + 8).guard).toBe('noop');
  });

  it.each(['pet', 'tickle'] as const)('%s: +2 Joy per tap, capped at +12 an hour, reported as a guard', (action) => {
    expect(apply(pet({ joy: 40 }), action, NOON).care.joy).toBe(42);
    expect(apply(pet({ joy: 40 }), action, NOON, 3).care.joy).toBe(46);
    expect(apply(pet({ joy: 40 }), action, NOON, Number.NaN).care.joy).toBe(42);
    expect(apply(pet({ joy: 40 }), action, NOON, -4).care.joy).toBe(42);
    const big = apply(pet({ joy: 40 }), action, NOON, 1000);
    expect(big).toMatchObject({ guard: 'capped', care: { joy: 52, caps: { petJoy: 12 } } });
    const after = apply(big.care, action, NOON + 1000, 2);
    expect(after).toMatchObject({ guard: 'capped', care: { joy: 52, bond: 1 } });
    // a new hour resets the window
    expect(apply(big.care, action, NOON + H, 2)).toEqual({ care: expect.objectContaining({ joy: 56, caps: expect.objectContaining({ petJoy: 4, hourStart: NOON + H }) }) });
  });

  it('caps Bond from care at 5 a day, resets the next day, keeps caps for a slightly late clock and restarts on a reset one', () => {
    let care = pet({ tummy: 30 });
    for (let i = 0; i < 8; i++) care = apply(care, i % 2 ? 'sleep' : 'wake', NOON + i).care;
    expect(care.bond).toBe(4);
    care = apply(care, 'pet', NOON + 10).care;
    care = apply(care, 'pet', NOON + 11).care;
    expect(care.bond).toBe(5);
    expect(apply(care, 'pet', NOON + D).care.bond).toBe(6);
    // a slow request saving after a newer one opened the windows: the caps hold (never refilled)
    const late = apply(care, 'pet', NOON - 1);
    expect(late.care.caps).toMatchObject({ hourStart: NOON, dayStart: NOON, careBond: 5 });
    expect(late.care.bond).toBe(5);
    const talked = talk({ ...care, caps: { ...care.caps, talkJoy: 30 } }, NOON - 5000);
    expect(talked).toMatchObject({ guard: 'capped', care: { caps: { talkJoy: 30, hourStart: NOON } } });
    // a clock far behind the windows (reset, skew) restarts them
    expect(apply(care, 'pet', NOON - H - 1).care.caps).toMatchObject({ hourStart: NOON - H - 1, petJoy: 2 });
    expect(apply(care, 'pet', NOON - D - 1).care.caps).toMatchObject({ dayStart: NOON - D - 1, careBond: 1 });
  });

  it('reports a Bond milestone once, and older docs without seenBond once', () => {
    const crossed = apply(pet({ bond: 24, tummy: 30 }), 'feed', NOON);
    expect(crossed.bondMilestone).toBe(0);
    expect(crossed.care.seenBond).toBe(25);
    expect(apply(crossed.care, 'feed', NOON + 1).bondMilestone).toBeUndefined();
    const legacy = pet({ bond: 60 });
    delete legacy.seenBond;
    expect(apply(legacy, 'wake', NOON).bondMilestone).toBe(1);
    // beyond the six fidgets the index stays on the last one
    expect(apply(pet({ bond: 400 }), 'wake', NOON).bondMilestone).toBe(5);
  });
});

describe('talk', () => {
  it('+6 Joy (≤ 30 an hour) and +1 Bond per exchange, uncapped', () => {
    let care = pet({ joy: 40 });
    for (let i = 0; i < 5; i++) {
      const r = talk(care, NOON + i);
      expect(r.guard).toBeUndefined();
      care = r.care;
    }
    expect(care).toMatchObject({ joy: 70, bond: 5, caps: { talkJoy: 30 } });
    const capped = talk(care, NOON + 10);
    expect(capped).toMatchObject({ guard: 'capped', care: { joy: 70, bond: 6 } });
    expect(talk(pet({ caps: { ...pet().caps, talkJoy: 27 } }), NOON)).toMatchObject({ guard: 'capped', care: { joy: 83 } });
    expect(talk(pet({ caps: { ...pet().caps, talkJoy: 99 } }), NOON).care.joy).toBe(80);
    // talking wakes a sleeping pet, as feeding and playing do
    expect(talk(pet({ asleep: true, sleptAt: NOON - 1 }), NOON).care).toMatchObject({ asleep: false });
    expect(talk(pet({ asleep: true, sleptAt: NOON - 1 }), NOON).care).not.toHaveProperty('sleptAt');
  });
});

describe('welcome back and open', () => {
  it('lifts every need to at least 60 only after more than a day away', () => {
    const low = pet({ tummy: 25, joy: 70, energy: 20 });
    expect(welcomeBack(low, NOON + D)).toEqual({ care: low });
    const back = welcomeBack(low, NOON + D + 1);
    expect(back).toEqual({ care: expect.objectContaining({ tummy: 60, joy: 70, energy: 60 }), awayMs: D + 1 });
  });

  it('a long absence decays to the floors, then the welcome lifts them, with a souvenir slot', () => {
    const opened = open(decay(pet(), NOON + 3 * D), NOON + 3 * D, 2);
    expect(opened.welcome).toEqual({ awayMs: 3 * D });
    for (const key of NEED_KEYS) expect(opened.care[key]).toBeGreaterThanOrEqual(60);
    expect(opened.care.lastSeenAt).toBe(NOON + 3 * D);
    expect(opened.stageUp).toBeUndefined();
  });

  it('falls asleep on open during quiet hours and keeps an earlier bedtime', () => {
    const night = Date.UTC(2026, 9, 20, 23);
    expect(open(pet({}, night - H), night, 2).care).toMatchObject({ asleep: true, sleptAt: night });
    expect(open(pet({ asleep: true, sleptAt: night - H }, night - H), night, 2).care.sleptAt).toBe(night - H);
  });

  it('wakes on the first open after a night, but not after an afternoon nap', () => {
    const morning = Date.UTC(2026, 9, 21, 9);
    expect(open(pet({ asleep: true, sleptAt: Date.UTC(2026, 9, 20, 23) }), morning, 2).care.asleep).toBe(false);
    expect(open(pet({ asleep: true, sleptAt: Date.UTC(2026, 9, 20, 21) }), morning, 2).care.asleep).toBe(false);
    expect(open(pet({ asleep: true, sleptAt: NOON }), NOON + 2 * H, 2).care.asleep).toBe(true);
    const legacy = pet({ asleep: true });
    delete legacy.sleptAt;
    expect(open(legacy, NOON, 2).care.asleep).toBe(false);
  });

  it('plays a stage-up once and records the stage either way', () => {
    const grown = open(pet({ lastSeenStage: 2 }), NOON, 3);
    expect(grown.stageUp).toEqual({ from: 2, to: 3 });
    expect(grown.care.lastSeenStage).toBe(3);
    expect(open(grown.care, NOON + 1, 3).stageUp).toBeUndefined();
    expect(open(pet({ lastSeenStage: 4 }), NOON, 4).care.lastSeenStage).toBe(4);
  });

  it('reports an unseen Bond milestone on open', () => {
    const r = open(pet({ bond: 26, seenBond: 20 }), NOON, 2);
    expect(r.bondMilestone).toBe(0);
    expect(open(r.care, NOON + 1, 2).bondMilestone).toBeUndefined();
  });
});

describe('mood', () => {
  it('is the lowest need: happy > 80, content ≥ 55, wants 30–54, droopy < 30, with the need as the tone', () => {
    expect(mood(pet({ tummy: 90, joy: 85, energy: 81 }))).toEqual({ level: 'happy', lowest: 'energy', tone: 'happy', asleep: false });
    expect(mood(pet({ tummy: 55, joy: 90, energy: 90 }))).toEqual({ level: 'content', lowest: 'tummy', tone: 'content', asleep: false });
    expect(mood(pet({ tummy: 90, joy: 54, energy: 90 }))).toMatchObject({ level: 'wants', lowest: 'joy', tone: 'bored' });
    expect(mood(pet({ tummy: 90, joy: 90, energy: 29, asleep: true }))).toEqual({ level: 'droopy', lowest: 'energy', tone: 'tired', asleep: true });
    expect(mood(pet({ tummy: 40, joy: 90, energy: 90 })).tone).toBe('hungry');
  });

  it('breaks ties tummy > energy > joy', () => {
    expect(mood(pet({ tummy: 40, joy: 40, energy: 40 })).lowest).toBe('tummy');
    expect(mood(pet({ tummy: 60, joy: 40, energy: 40 })).lowest).toBe('energy');
  });
});

describe('humane invariants', () => {
  it('no sequence of actions and absences takes a need below its floor or invents sickness, death or poop', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const actions: PetAction[] = ['feed', 'play', 'sleep', 'wake', 'pet', 'tickle'];
    const zones = ['UTC', 'Asia/Tehran', 'America/New_York', 'Pacific/Auckland'];
    const keys = new Set(Object.keys(pet()));
    let now = NOON;
    let care = pet();
    for (let i = 0; i < 2000; i++) {
      now += Math.floor(rng() * (rng() < 0.1 ? 5 * D : 3 * H));
      care = decay(care, now, zones[Math.floor(rng() * zones.length)]);
      const r = rng();
      care = r < 0.7 ? apply(care, actions[Math.floor(rng() * actions.length)], now, Math.floor(rng() * 60)).care
        : r < 0.85 ? talk(care, now).care : open(care, now, (1 + Math.floor(rng() * 4)) as 1 | 2 | 3 | 4).care;
      for (const key of NEED_KEYS) {
        expect(care[key]).toBeGreaterThanOrEqual(NEED_FLOOR[key]);
        expect(care[key]).toBeLessThanOrEqual(100);
      }
      expect(care.bond).toBeGreaterThanOrEqual(0);
      for (const key of Object.keys(care)) expect(keys.has(key) || key === 'sleptAt').toBe(true);
      expect(['happy', 'content', 'wants', 'droopy']).toContain(mood(care).level);
    }
    expect(JSON.stringify(care)).not.toMatch(/sick|dead|die|poop|ill/i);
  });
});
