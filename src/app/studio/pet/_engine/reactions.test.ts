import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mood } from '@/lib/pet/types';
import { prepareBeats, REDUCED_DROP } from './beats';
import { sample } from './events.fixture';
import { REACTIONS } from './reactions';
import { seeded, variantHistory } from './rng';
import { alphaFor, tuningFor } from './species';
import {
  EVENT_PRIORITY, NEUTRAL_POSE, SPRINGS, type Beat, type Family, type ReactionCtx, type ReactionEvent, type ReactionKind, type Species, type Tier,
} from './types';

const SPECIES: Species[] = ['cloud', 'cat', 'dog', 'bunny', 'bear', 'owl', 'chick'];
const FAMILIES: Family[] = ['puff', 'tower', 'drift'];
const MOOD: Mood = { level: 'content', lowest: 'joy', tone: 'content', asleep: false };

const KINDS = Object.keys(EVENT_PRIORITY) as ReactionKind[];
/** Rows of §2.6 that must have three variants (feed's chomp is the exception, checked by phase). */
const ROWS: ReactionKind[] = ['hello', 'welcomeBack', 'fidgetSmall', 'fidgetLong', 'bored', 'poke', 'pet', 'tickle', 'overpoke', 'longPress', 'dragStart', 'fling', 'land', 'shake',
  'tooFull', 'playStart', 'yawn', 'sleep', 'sleepPoke', 'wake', 'wants', 'droopy', 'sad', 'listen', 'ack', 'think', 'speakStart', 'wave', 'celebrate', 'miss', 'bop', 'ballNear', 'dream', 'doze'];

function ctxFor(species: Species, family: Family, seed: number, picks?: Array<[ReactionKind, number]>, tier: Tier = 'full'): ReactionCtx {
  const rng = seeded(seed), h = variantHistory(rng);
  return {
    rng, species, family, stage: 4, mood: MOOD, tier,
    variantHistory: { last: h.last, pick: (k, n) => { const v = h.pick(k, n); picks?.push([k, v]); return v; } },
  };
}

describe('reactions (brief §2.6, §3.4)', () => {
  let random: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('reactions take ctx.rng, never Math.random'); }); });
  afterEach(() => random.mockRestore());

  it('every event kind has a pure reaction that returns well-formed beats', () => {
    expect(Object.keys(REACTIONS).sort()).toEqual([...KINDS].sort());
    for (const species of SPECIES) {
      const ctx = ctxFor(species, 'puff', 1);
      for (const kind of KINDS) for (let i = 0; i < 6; i++) {
        const beats = (REACTIONS[kind] as (e: ReactionEvent, c: ReactionCtx) => Beat[])(sample(kind, i), ctx);
        expect(beats.length, kind).toBeGreaterThan(0);
        for (const b of beats) {
          expect(Number.isFinite(b.at) && b.at >= 0, kind).toBe(true);
          expect(SPRINGS[b.spring], kind).toBeDefined();
          for (const [c, v] of Object.entries(b.target)) {
            expect(c in NEUTRAL_POSE, `${kind}.${c}`).toBe(true);
            expect(Number.isFinite(v), `${kind}.${c}`).toBe(true);
          }
        }
      }
    }
  });

  it('never plays the same variant twice in a row, and every row has three', () => {
    for (const species of SPECIES) {
      const picks: Array<[ReactionKind, number]> = [];
      const ctx = ctxFor(species, 'puff', 7, picks);
      for (let i = 0; i < 40; i++) for (const kind of KINDS) (REACTIONS[kind] as (e: ReactionEvent, c: ReactionCtx) => Beat[])(sample(kind, i), ctx);
      const byKind = new Map<ReactionKind, number[]>();
      for (const [k, v] of picks) byKind.set(k, [...(byKind.get(k) ?? []), v]);
      for (const [k, seq] of byKind) for (let i = 1; i < seq.length; i++) expect(seq[i], `${species} ${k} #${i}`).not.toBe(seq[i - 1]);
      for (const k of ROWS) expect(new Set(byKind.get(k) ?? []).size, `${species} ${k}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps volume on every squash and stretch (sx·sy^α within 2 %) after jitter, on every species and family', () => {
    for (const species of SPECIES) for (const family of FAMILIES) {
      const tuning = tuningFor(species, family);
      for (let seed = 1; seed <= 4; seed++) {
        const ctx = ctxFor(species, family, seed);
        for (const kind of KINDS) for (let i = 0; i < 6; i++) {
          const beats = (REACTIONS[kind] as (e: ReactionEvent, c: ReactionCtx) => Beat[])(sample(kind, i), ctx);
          for (const b of prepareBeats(beats, { rng: ctx.rng, tuning, tier: 'full' })) {
            const { sx, sy } = b.target;
            if (sy === undefined || sy === 1 || sx === undefined || Math.abs(sx - sy) < 1e-9) continue;
            const a = alphaFor(tuning, b.springs?.sy ?? b.spring);
            expect(Math.abs(sx * Math.pow(sy, a) - 1), `${species}/${family} ${kind} sx ${sx} sy ${sy}`).toBeLessThanOrEqual(0.02);
          }
        }
      }
    }
  });

  it('jitters time ±12 % and amplitude ±15 %, except fixed (chomp) beats', () => {
    const tuning = tuningFor('cat', 'puff');
    const beats: Beat[] = [{ at: 0, target: { rot: 10 }, spring: 'pop' }, { at: 500, target: { rot: 0, headY: 4 }, spring: 'pop' }, { at: 170, target: { mouthOpen: 0.35 }, spring: 'snap', fixed: true }];
    for (let seed = 1; seed < 200; seed++) {
      const p = prepareBeats(beats, { rng: seeded(seed), tuning, tier: 'full' });
      const rot = p.find((b) => b.target.rot !== undefined && b.target.rot !== 0)!.target.rot!;
      expect(rot).toBeGreaterThanOrEqual(8.5 - 1e-9);
      expect(rot).toBeLessThanOrEqual(11.5 + 1e-9);
      const late = p.find((b) => b.target.headY !== undefined)!;
      expect(late.at).toBeGreaterThanOrEqual(440);
      expect(late.at).toBeLessThanOrEqual(560);
      expect(p.find((b) => b.fixed)!.at).toBe(170);
    }
  });

  it('reduced motion produces no translation, rotation, hops or wobbles (150 ms crossfades instead)', () => {
    for (const species of SPECIES) {
      const ctx = ctxFor(species, 'puff', 5, undefined, 'reduced');
      const tuning = tuningFor(species, 'puff');
      for (const kind of KINDS) for (let i = 0; i < 4; i++) {
        const beats = (REACTIONS[kind] as (e: ReactionEvent, c: ReactionCtx) => Beat[])(sample(kind, i), ctx);
        for (const b of prepareBeats(beats, { rng: ctx.rng, tuning, tier: 'reduced' })) {
          for (const c of Object.keys(b.target)) expect(REDUCED_DROP.has(c as never), `${kind}.${c}`).toBe(false);
          expect(b.hop, kind).toBeUndefined();
          expect(b.osc, kind).toBeUndefined();
          expect(b.hitStop, kind).toBeUndefined();
          for (const c of ['sx', 'sy'] as const) if (b.target[c] !== undefined) expect(Math.abs(b.target[c]! - 1), `${kind}.${c}`).toBeLessThanOrEqual(0.04 + 1e-9);
        }
      }
    }
  });
});
