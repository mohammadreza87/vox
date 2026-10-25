/**
 * Main-lineage reply-style cases (S14, earlier run aa5ef60) ported onto the
 * chosen wave A implementation (aiq/bandit-lib 57e2d6c). Only cases whose
 * intent holds against wave A's API are kept; renamed APIs are mapped by hand
 * (ReplyStylePolicy -> ReplyStyleBandit, detectCorrectionPhrase ->
 * classifyFollowUp, compositeReward -> computeReward, decayPosterior ->
 * decayBeta, pinsFromResolvedPreferences -> styleFromPreferences,
 * styleFromExplicitRequest -> explicitRequestFromTurn, mulberry32 -> seededRng).
 * Assertions that contradict wave A's documented behaviour, or need an API
 * wave A does not have, are omitted here and listed by case name in
 * docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferenceRecordSchema, resolvePreferences, type PreferenceRecord, type PreferenceValue } from './index';
import {
  ARMS, DIMENSION_ORDER, FOLLOW_UP_WINDOW_MS, ReplyStyleBandit, classifyFollowUp, computeReward, decayBeta,
  explicitRequestFromTurn, posteriorId, resolveReplyStyle, sampleBeta, seededRng, styleFromPreferences, subjectKey,
} from './procedural';
import type {
  BetaParams, ChooseInput, PosteriorRow, ReplyStyle, ReplyStyleBanditDeps, ReplyStyleScope, ReplyStyleStore, StyleDimension,
} from './procedural';
import { FileReplyStyleStore, FirestoreReplyStyleStore, InMemoryReplyStyleStore } from './procedural-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12);
const PERSONA_DEFAULT: ReplyStyle = { length: 'balanced', register: 'informal', structure: 'plain', closingQuestion: 'no', modality: 'text', language: 'fa' };
const keyA: ReplyStyleScope = { personId: 'person-a', personaId: 'persona1', space: 'work', route: 'quick' };
const POSITIVE = (at = T0 + 1_000) => [{ kind: 'reaction', polarity: 'positive', at }];

let banditCounter = 0;
function bandit(store: ReplyStyleStore, extra: Partial<ReplyStyleBanditDeps> = {}, seed = 7): ReplyStyleBandit {
  const prefix = `main-${++banditCounter}`;
  let n = 0;
  return new ReplyStyleBandit({ store, authorize: async () => true, rng: seededRng(seed), now: () => T0, newId: () => `${prefix}-${++n}`, ...extra });
}
const input = (overrides: Partial<ChooseInput> = {}): ChooseInput =>
  ({ scope: keyA, chatKind: 'private', guestAudience: false, personaDefault: PERSONA_DEFAULT, now: T0, ...overrides });

function favour(scope: ReplyStyleScope, d: StyleDimension, winner: string, strength = 500, at = T0): PosteriorRow {
  const arms: Record<string, BetaParams> = Object.fromEntries((ARMS[d] as readonly string[])
    .map((arm) => [arm, arm === winner ? { alpha: strength, beta: 1 } : { alpha: 1, beta: strength }]));
  return { schemaVersion: 1, id: posteriorId(scope, d), subject: subjectKey(scope.personId), personaId: scope.personaId,
    space: scope.space, route: scope.route, dimension: d, arms, updatedAt: at };
}

let seedCounter = 0;
const prefScope = { tenantId: 'tenant1', spaceId: 'work', containerId: 'private1', personId: 'person1', agentId: 'agent1' };
function prefRecord(setting: PreferenceValue, extra: Partial<PreferenceRecord> = {}): PreferenceRecord {
  return preferenceRecordSchema.parse({ ...prefScope, schemaVersion: 1, id: `pref-${setting.key}-${++seedCounter}`, revision: 1,
    createdAt: T0 - DAY, updatedAt: T0 - DAY, origin: 'explicit', status: 'active', setting, evidenceEventIds: [], ...extra });
}
const resolved = (records: PreferenceRecord[]) => resolvePreferences(records, prefScope, T0, async () => true);
const hypothesis = { origin: 'hypothesis' as const, expiresAt: T0 + DAY, evidenceEventIds: ['event1'] };

const STORE_METHODS = ['readPosteriors', 'recordExposure', 'transact', 'listEval', 'deleteSubject', 'sweep'] as const;
const spyAll = (store: ReplyStyleStore) => STORE_METHODS.map((method) => vi.spyOn(store, method));

type Row = Record<string, unknown>;
/** main-lineage fake (doc get, transactions with a failing-commit switch); range queries are not used here. */
function fakeFirestore() {
  const rows = new Map<string, Row>();
  let queue: Promise<unknown> = Promise.resolve();
  let failNext = false;
  const ref = (path: string) => ({ path, id: path.slice(path.indexOf('/') + 1), get: async () => snap(path) });
  const snap = (path: string) => {
    const row = rows.get(path);
    return { ref: ref(path), id: path.slice(path.indexOf('/') + 1), exists: row !== undefined, data: () => (row ? structuredClone(row) : undefined) };
  };
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
      const task = queue.then(async () => {
        const writes = new Map<string, Row>();
        const result = await fn({
          get: async (r: { path: string }) => { if (writes.size > 0) throw new Error('fake: read after write'); return snap(r.path); },
          set: (r: { path: string }, value: Row) => { writes.set(r.path, structuredClone(value)); },
        });
        if (failNext) { failNext = false; throw new Error('Commit failed'); }
        for (const [path, value] of writes) rows.set(path, value);
        return result;
      });
      queue = task.then(() => undefined, () => undefined);
      return task;
    },
  } as unknown as Firestore;
  return { db, rows, failNextCommit: () => { failNext = true; } };
}

const directories: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vox-reply-style-main-'));
  directories.push(dir);
  return join(dir, 'nested', 'reply-style.json');
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('unseeded'); });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Precedence helpers
// ---------------------------------------------------------------------------

describe('main-lineage: precedence helpers', () => {
  it('maps resolvePreferences output to pins: structured, plain, en and hypothesis', async () => {
    expect(styleFromPreferences(await resolved([prefRecord({ key: 'formatting', value: 'structured' })]))).toEqual({ structure: 'steps' });
    expect(styleFromPreferences(await resolved([prefRecord({ key: 'formatting', value: 'plain' })]))).toEqual({ structure: 'plain' });
    expect(styleFromPreferences(await resolved([prefRecord({ key: 'language', value: 'en' })]))).toEqual({ language: 'en' });
    // Defaults pin nothing.
    expect(styleFromPreferences(await resolved([]))).toEqual({});
    const inferred = await resolved([prefRecord({ key: 'formatting', value: 'structured' }, hypothesis)]);
    expect(inferred.find((r) => r.setting.key === 'formatting')?.source).toBe('hypothesis');
    expect(styleFromPreferences(inferred)).toEqual({});
    const store = new InMemoryReplyStyleStore();
    const withHypothesis = await bandit(store).choose(input({ storedPreferences: inferred }));
    expect(withHypothesis.sources.structure).toBe('sampled');
  });

  it('resolveReplyStyle ignores invalid arm values and explicitRequestFromTurn maps triage labels', () => {
    const out = resolveReplyStyle({ personaDefault: PERSONA_DEFAULT, explicitThisTurn: { length: 'huge' as never }, sampled: { register: 'formal' } });
    expect(out.style.length).toBe('balanced');
    expect(out.sources.length).toBe('persona_default');
    expect(out.style.register).toBe('formal');
    expect(out.sources.register).toBe('sampled');
    expect(explicitRequestFromTurn('brief')).toEqual({ length: 'brief' });
    expect(explicitRequestFromTurn('detailed')).toEqual({ length: 'detailed' });
    expect(explicitRequestFromTurn('step_by_step')).toEqual({ structure: 'steps' });
    expect(explicitRequestFromTurn('unspecified')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Reward
// ---------------------------------------------------------------------------

describe('main-lineage: composite reward', () => {
  const replyAt = T0;
  it('reply-rate alone never produces a reward', () => {
    expect(computeReward([{ kind: 'reply', at: replyAt + 1 }], replyAt).reward).toBeNull();
    expect(computeReward([{ kind: 'follow_up', corrective: false, at: replyAt + FOLLOW_UP_WINDOW_MS + 1 }], replyAt).reward).toBeNull();
    expect(computeReward([{ kind: 'follow_up', corrective: false, at: replyAt - 1 }], replyAt).reward).toBeNull();
    expect(computeReward([{ kind: 'follow_up', corrective: true, at: replyAt + FOLLOW_UP_WINDOW_MS + 1 }], replyAt).reward).toBeNull();
    expect(computeReward([], replyAt).reward).toBeNull();
  });

  it('scores each single positive as 1 and each single negative as 0', () => {
    for (const kind of ['explicit_thanks', 'share_offer_accepted'] as const) {
      expect(computeReward([{ kind, at: replyAt + 1 }], replyAt)).toMatchObject({ reward: 1, kinds: [kind] });
    }
    expect(computeReward([{ kind: 'reaction', polarity: 'positive', at: replyAt + 1 }], replyAt)).toMatchObject({ reward: 1, kinds: ['reaction_positive'] });
    expect(computeReward([{ kind: 'explicit_correction', at: replyAt + 1 }], replyAt)).toMatchObject({ reward: 0, kinds: ['explicit_correction'] });
    expect(computeReward([{ kind: 'reaction', polarity: 'negative', at: replyAt + 1 }], replyAt)).toMatchObject({ reward: 0, kinds: ['reaction_negative'] });
    expect(computeReward([{ kind: 'follow_up', corrective: true, at: replyAt + 5_000 }], replyAt)).toMatchObject({ reward: 0, kinds: ['follow_up_corrective'] });
    const everything = computeReward([
      { kind: 'explicit_correction', at: replyAt + 1 }, { kind: 'reaction', polarity: 'positive', at: replyAt + 1 },
      { kind: 'follow_up', corrective: false, at: replyAt + 1 }, { kind: 'share_offer_accepted', at: replyAt + 1 },
      { kind: 'voice_reciprocated', at: replyAt + 1 }, { kind: 'explicit_thanks', at: replyAt + 1 }, { kind: 'reply', at: replyAt + 1 },
    ], replyAt);
    expect(everything.reward).toBe(0);
    expect(everything.reason).toBe('negative');
  });

  it('a negative settle records reward 0 and adds to beta only', async () => {
    const store = new InMemoryReplyStyleStore();
    const p = bandit(store);
    const choice = await p.choose(input());
    const result = await p.settle({ exposureId: choice.exposureId!, now: T0,
      signals: [{ kind: 'follow_up', corrective: true, at: T0 + 1 }, { kind: 'reaction', polarity: 'positive', at: T0 + 1 }] });
    expect(result).toMatchObject({ outcome: 'updated', reward: 0 });
    const [row] = await store.readPosteriors([posteriorId(keyA, 'register')]);
    expect(row.arms[choice.style.register]).toEqual({ alpha: 1, beta: 2 });
    const record = (await store.listEval()).find((r) => r.id === choice.exposureId)!;
    expect(record.reward).toBe(0);
    expect(record.rewardKinds).toEqual(['reaction_positive', 'follow_up_corrective']);
  });
});

describe('main-lineage: correction phrases (EN/FA)', () => {
  it.each(['No, shorter', 'nope', 'again', "that's not what I meant", 'نه، کوتاه‌تر', 'دوباره', 'منظورم این نبود', 'منظورم اين نبود'])('detects %s', (text) => {
    expect(classifyFollowUp(text)).toBe('corrective');
  });
  it.each(['I know', 'nobody asked', 'نهایت', 'thanks!'])('does not flag %s', (text) => {
    expect(classifyFollowUp(text)).not.toBe('corrective');
  });
});

// ---------------------------------------------------------------------------
// Decay, propensity and sampling
// ---------------------------------------------------------------------------

describe('main-lineage: decay', () => {
  it('halves evidence over the prior every 90 days and never drops below Beta(1,1)', () => {
    const p = { alpha: 11, beta: 1 };
    expect(decayBeta(p, 90 * DAY).alpha).toBeCloseTo(6, 9);
    expect(decayBeta(p, 180 * DAY).alpha).toBeCloseTo(3.5, 9);
    const decade = decayBeta(p, 3650 * DAY);
    expect(decade.alpha).toBeGreaterThanOrEqual(1);
    expect(decade.alpha).toBeCloseTo(1, 9);
    expect(decayBeta(p, -DAY)).toEqual(p);
  });

  it('a dominant posterior that is ten half-lives old no longer dominates', async () => {
    const store = new InMemoryReplyStyleStore({ posteriors: [favour(keyA, 'length', 'detailed')] });
    const fresh = await bandit(store, { propensitySamples: 200 }, 1).choose(input());
    expect(fresh.style.length).toBe('detailed');
    const freshRow = (await store.listEval()).find((r) => r.id === fresh.exposureId)!;
    expect(freshRow.propensity.length).toBeGreaterThan(0.95);
    const later = T0 + 10 * 90 * DAY;
    for (let seed = 1; seed <= 5; seed++) {
      const choice = await bandit(store, { propensitySamples: 200, now: () => later }, seed).choose(input({ now: later }));
      const row = (await store.listEval()).find((r) => r.id === choice.exposureId)!;
      expect(row.propensity.length).toBeGreaterThan(0.2);
      expect(row.propensity.length).toBeLessThan(0.6);
    }
  });
});

describe('main-lineage: propensity logging', () => {
  it('joint propensity is the product over all six dimensions', async () => {
    const store = new InMemoryReplyStyleStore();
    const choice = await bandit(store, { dimensions: DIMENSION_ORDER }).choose(input());
    const record = (await store.listEval()).find((r) => r.id === choice.exposureId)!;
    const values = Object.values(record.propensity) as number[];
    expect(values).toHaveLength(6);
    for (const value of values) { expect(value).toBeGreaterThan(0); expect(value).toBeLessThanOrEqual(1); }
    expect(record.jointPropensity).toBeCloseTo(values.reduce((a, b) => a * b, 1), 12);
  });
});

describe('main-lineage: deterministic sampling with an injected RNG', () => {
  it('same seed and store contents give the same choice; seeds explore; Math.random is never used', async () => {
    const seed = () => [favour(keyA, 'length', 'detailed', 3), favour(keyA, 'register', 'formal', 2)];
    const first = await bandit(new InMemoryReplyStyleStore({ posteriors: seed() }), {}, 42).choose(input());
    const second = await bandit(new InMemoryReplyStyleStore({ posteriors: seed() }), {}, 42).choose(input());
    expect(second.style).toEqual(first.style);
    expect(second.sources).toEqual(first.sources);

    const lengths = new Set<string>();
    for (let s = 1; s <= 50; s++) lengths.add((await bandit(new InMemoryReplyStyleStore(), { propensitySamples: 16 }, s).choose(input())).style.length);
    expect(lengths.size).toBeGreaterThanOrEqual(2);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('sampleBeta rejects a bad RNG and choose then falls back without sampling', async () => {
    for (const bad of [() => 1, () => -0.1, () => Number.NaN]) {
      expect(() => sampleBeta(2, 3, bad)).toThrow(RangeError);
      const store = new InMemoryReplyStyleStore();
      const choice = await new ReplyStyleBandit({ store, authorize: async () => true, rng: bad, now: () => T0 }).choose(input());
      expect(choice.exposureId).toBeUndefined();
      expect(Object.values(choice.sources)).not.toContain('sampled');
      expect(choice.style).toEqual(PERSONA_DEFAULT);
      expect(await store.listEval()).toEqual([]);
    }
    expect(() => sampleBeta(0, 1, seededRng(1))).toThrow(RangeError);
    const rng = seededRng(3);
    for (const [alpha, beta] of [[1, 1], [0.5, 0.5], [50, 2]]) {
      const x = sampleBeta(alpha, beta, rng);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += sampleBeta(8, 2, rng);
    expect(sum / 2000).toBeCloseTo(0.8, 1);
  });
});

// ---------------------------------------------------------------------------
// Gate, audience and failures
// ---------------------------------------------------------------------------

describe('main-lineage: gate and audience', () => {
  it('a false gate touches no store method; only an exact true opens it', async () => {
    const store = new InMemoryReplyStyleStore();
    const spies = spyAll(store);
    const gate = vi.fn(async () => false);
    const choice = await bandit(store, { authorize: gate }).choose(input());
    expect(gate).toHaveBeenCalledTimes(1);
    expect(choice.exposureId).toBeUndefined();
    expect(choice.style).toEqual(PERSONA_DEFAULT);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    await bandit(store, { authorize: async () => 1 as unknown as boolean }).choose(input());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect((await bandit(store, { authorize: async () => true }).choose(input())).exposureId).toBeDefined();
  });

  it('a gate that flips to false before the write records nothing', async () => {
    const store = new InMemoryReplyStyleStore();
    const record = vi.spyOn(store, 'recordExposure');
    const gate = vi.fn(async () => true).mockResolvedValueOnce(true).mockResolvedValue(false);
    const choice = await bandit(store, { authorize: gate }).choose(input());
    expect(gate).toHaveBeenCalledTimes(2);
    expect(choice.exposureId).toBeUndefined();
    expect(Object.values(choice.sources)).not.toContain('sampled');
    expect(choice.style).toEqual(PERSONA_DEFAULT);
    expect(record).not.toHaveBeenCalled();
    expect(await store.listEval()).toEqual([]);
  });

  it('groups and guest audiences never sample', async () => {
    const store = new InMemoryReplyStyleStore();
    const spies = spyAll(store);
    for (const overrides of [{ chatKind: 'group' as const }, { guestAudience: true }, { guestAudience: undefined as unknown as boolean }]) {
      const choice = await bandit(store).choose(input(overrides));
      expect(choice.exposureId).toBeUndefined();
      expect(choice.style).toEqual(PERSONA_DEFAULT);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('settle with a false or throwing gate changes no posterior', async () => {
    for (const denied of [async () => false, async () => { throw new Error('gate down'); }]) {
      const store = new InMemoryReplyStyleStore();
      let allow = true;
      const p = bandit(store, { authorize: async () => (allow ? true : denied()) });
      const choice = await p.choose(input());
      allow = false;
      const ids = DIMENSION_ORDER.map((d) => posteriorId(keyA, d));
      const before = await store.readPosteriors(ids);
      expect(await p.settle({ exposureId: choice.exposureId!, signals: POSITIVE(), now: T0 + 2_000 }))
        .toEqual({ outcome: 'not_allowed', reward: null, kinds: [] });
      expect(await store.readPosteriors(ids)).toEqual(before);
    }
  });
});

describe('main-lineage: store failure is fail-closed', () => {
  it('choose falls back without throwing', async () => {
    const failingRead = new InMemoryReplyStyleStore();
    vi.spyOn(failingRead, 'readPosteriors').mockRejectedValue(new Error('down'));
    const a = await bandit(failingRead).choose(input());
    expect(a.exposureId).toBeUndefined();
    expect(a.style).toEqual(PERSONA_DEFAULT);

    const failingAppend = new InMemoryReplyStyleStore();
    vi.spyOn(failingAppend, 'recordExposure').mockRejectedValue(new Error('down'));
    const b = await bandit(failingAppend).choose(input({ explicitThisTurn: { length: 'detailed' } }));
    expect(b.exposureId).toBeUndefined();
    expect(b.style).toEqual({ ...PERSONA_DEFAULT, length: 'detailed' });
    expect(b.sources.length).toBe('explicit_turn');
    expect(Object.values(b.sources)).not.toContain('sampled');

    const throwingGate = await bandit(new InMemoryReplyStyleStore(), { authorize: async () => { throw new Error('gate'); } }).choose(input());
    expect(throwingGate.exposureId).toBeUndefined();

    const badPersona = await bandit(new InMemoryReplyStyleStore()).choose(input({ scope: { ...keyA, personaId: 'bad/persona' } }));
    expect(badPersona.exposureId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// File store
// ---------------------------------------------------------------------------

describe('main-lineage: file store', () => {
  it('serialises concurrent settles on one posterior exactly', async () => {
    const store = new FileReplyStyleStore(tempFile());
    const p = bandit(store, { propensitySamples: 16 });
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push((await p.choose(input())).exposureId!);
    const results = await Promise.all(ids.map((exposureId) => p.settle({ exposureId, signals: POSITIVE(), now: T0 + 2_000 })));
    expect(results.every((r) => r.outcome === 'updated')).toBe(true);
    const [row] = await store.readPosteriors([posteriorId(keyA, 'register')]);
    expect(Object.values(row.arms).reduce((sum, arm) => sum + (arm.alpha - 1), 0)).toBe(30);
    expect(Object.values(row.arms).every((arm) => arm.beta === 1)).toBe(true);
  }, 60_000);

  it('a corrupt file fails closed and is never overwritten', async () => {
    const file = tempFile();
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    for (const content of ['{not json', JSON.stringify({ schemaVersion: 1, posteriors: [], decisions: [] })]) {
      writeFileSync(file, content);
      const store = new FileReplyStyleStore(file);
      await expect(store.readPosteriors([posteriorId(keyA, 'length')])).rejects.toThrow();
      await expect(store.listEval()).rejects.toThrow();
      await expect(store.deleteSubject({ subject: subjectKey('person-a') })).rejects.toThrow();
      await expect(store.sweep(T0 + 365 * DAY)).rejects.toThrow();
      const choice = await bandit(store).choose(input());
      expect(choice.exposureId).toBeUndefined();
      expect(readFileSync(file, 'utf8')).toBe(content);
    }

    // Symlinked file fails closed and is never overwritten (main opened with O_NOFOLLOW).
    const target = tempFile();
    await bandit(new FileReplyStyleStore(target)).choose(input());
    const before = readFileSync(target, 'utf8');
    const link = join(dirname(target), 'link.json');
    symlinkSync(target, link);
    const linked = new FileReplyStyleStore(link);
    await expect(linked.listEval()).rejects.toThrow('invalid_reply_style_store');
    expect((await bandit(linked).choose(input())).exposureId).toBeUndefined();
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(before);

    // A symlink planted at the temp path is never written through: the write replaces it, the target is untouched.
    const victim = join(dirname(target), 'victim.json');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, `${target}.tmp`);
    expect((await bandit(new FileReplyStyleStore(target)).choose(input())).exposureId).toBeDefined();
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Firestore store
// ---------------------------------------------------------------------------

describe('main-lineage: Firestore store with the local fake', () => {
  it('a failed transaction commit leaves the posterior and exposure unchanged', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreReplyStyleStore(fake.db);
    const p = bandit(store, { propensitySamples: 16 });
    const first = await p.choose(input());
    expect((await p.settle({ exposureId: first.exposureId!, signals: POSITIVE(), now: T0 + 2_000 })).outcome).toBe('updated');
    const ids = DIMENSION_ORDER.map((d) => posteriorId(keyA, d));
    const before = await store.readPosteriors(ids);
    const second = await p.choose(input());
    fake.failNextCommit();
    await expect(p.settle({ exposureId: second.exposureId!, signals: POSITIVE(), now: T0 + 2_000 })).rejects.toThrow('Commit failed');
    expect(await store.readPosteriors(ids)).toEqual(before);
    const raw = fake.rows.get(`vox_reply_style_eval/${second.exposureId}`)!;
    expect(raw.settledAt).toBeUndefined();
    // The exposure can still be settled once the store recovers.
    expect((await p.settle({ exposureId: second.exposureId!, signals: POSITIVE(), now: T0 + 2_000, scope: keyA })).outcome).toBe('updated');
  });

  it('refuses duplicate exposure ids and unsafe document ids', async () => {
    const store = new FirestoreReplyStyleStore(fakeFirestore().db);
    const p = bandit(store, { propensitySamples: 16, newId: () => 'row-1' });
    expect((await p.choose(input())).exposureId).toBe('row-1');
    const row = await store.transact({ exposureIds: ['row-1'], posteriorIds: [] }, (snapshot) => ({ result: snapshot.exposures.get('row-1')! }));
    expect(row.id).toBe('row-1');
    await expect(store.recordExposure(row)).rejects.toThrow();
    await expect(store.recordExposure({ ...row, id: '..' })).rejects.toThrow();
    expect(await store.transact({ exposureIds: ['a/b'], posteriorIds: [] }, (snapshot) => ({ result: snapshot.exposures.size }))).toBe(0);
  });
});
