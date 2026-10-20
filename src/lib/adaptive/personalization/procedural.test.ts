import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { preferenceRecordSchema, resolvePreferences, type PreferenceRecord, type PreferenceValue } from './index';
import {
  compositeReward, decayPosterior, detectCorrectionPhrase, EVAL_RETENTION_MS, FOLLOW_UP_WINDOW_MS, MAX_EVIDENCE, mulberry32,
  personKeyOf, pinsFromResolvedPreferences, posteriorDocId, REPLY_STYLE_ARMS, REPLY_STYLE_DIMENSIONS, replyStyleEvalRecordSchema,
  replyStylePosteriorDocSchema, ReplyStylePolicy, resolveReplyStyle, REWARD_WINDOW_MS, sampleBeta, styleFromExplicitRequest, updatePosterior,
  type ChooseReplyStyleInput, type ReplyOutcomeSignals, type ReplyStyle, type ReplyStyleDimension, type ReplyStyleEvalRecord,
  type ReplyStyleKey, type ReplyStylePolicyOptions, type ReplyStylePosteriorDoc, type ReplyStyleStore,
} from './procedural';
import { FileReplyStyleStore, FirestoreReplyStyleStore, InMemoryReplyStyleStore } from './procedural-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12);
let clock = T0;
const PERSONA_DEFAULT: ReplyStyle = { length: 'balanced', register: 'informal', structure: 'plain', modality: 'text', language: 'fa', closingQuestion: 'no' };
const key = (personId: string, extra: Partial<ReplyStyleKey> = {}): ReplyStyleKey => ({ personId, personaId: 'persona1', space: 'work', route: 'quick', ...extra });
const keyA = key('person-a');
const POSITIVE: ReplyOutcomeSignals = { reaction: 'positive' };

function policy(store: ReplyStyleStore, extra: Partial<ReplyStylePolicyOptions> = {}, seed = 7): ReplyStylePolicy {
  return new ReplyStylePolicy({ store, random: mulberry32(seed), now: () => clock, ...extra });
}
const input = (overrides: Partial<ChooseReplyStyleInput> = {}): ChooseReplyStyleInput => ({
  key: keyA, audience: 'private', guestAudience: false, personaDefault: PERSONA_DEFAULT, personalizationAllowed: () => true, ...overrides,
});

let seedCounter = 0;
function evalRecord(id: string, k: ReplyStyleKey, at: number): ReplyStyleEvalRecord {
  const sources = Object.fromEntries(REPLY_STYLE_DIMENSIONS.map(d => [d, 'persona_default'])) as ReplyStyleEvalRecord['sources'];
  return { schemaVersion: 1, id, at, expiresAt: at + EVAL_RETENTION_MS,
    context: { personKey: personKeyOf(k.personId), personaId: k.personaId, space: k.space, route: k.route, policyVersion: 1, dimensions: ['length'] },
    armChosen: { ...PERSONA_DEFAULT }, sources, propensity: 1, dimensionPropensity: {}, unchosenArms: {}, reward: null };
}
/** Seeds a posterior doc through the public store interface only. */
async function seedPosterior(store: ReplyStyleStore, k: ReplyStyleKey, arms: ReplyStylePosteriorDoc['arms'], at = T0) {
  const id = `seed-${++seedCounter}`;
  await store.appendDecision(evalRecord(id, k, at));
  await store.settle(id, () => ({ doc: { schemaVersion: 1, id: posteriorDocId(k), personKey: personKeyOf(k.personId), personaId: k.personaId,
    space: k.space, route: k.route, arms, updatedAt: at }, result: undefined }));
}
const favour = <D extends ReplyStyleDimension>(d: D, winner: string, strength = 500, at = T0) => ({
  [d]: Object.fromEntries((REPLY_STYLE_ARMS[d] as readonly string[]).map(arm =>
    [arm, arm === winner ? { alpha: strength, beta: 1, updatedAt: at } : { alpha: 1, beta: strength, updatedAt: at }])),
}) as ReplyStylePosteriorDoc['arms'];
async function recordOf(store: ReplyStyleStore, id: string | undefined): Promise<ReplyStyleEvalRecord> {
  const row = (await store.listDecisions({})).find(r => r.id === id);
  if (!row) throw new Error(`no record ${id}`);
  return row;
}

const prefScope = { tenantId: 'tenant1', spaceId: 'work', containerId: 'private1', personId: 'person1', agentId: 'agent1' };
function prefRecord(setting: PreferenceValue, extra: Partial<PreferenceRecord> = {}): PreferenceRecord {
  return preferenceRecordSchema.parse({ ...prefScope, schemaVersion: 1, id: `pref-${setting.key}-${++seedCounter}`, revision: 1,
    createdAt: T0 - DAY, updatedAt: T0 - DAY, origin: 'explicit', status: 'active', setting, evidenceEventIds: [], ...extra });
}
const resolved = (records: PreferenceRecord[]) => resolvePreferences(records, prefScope, T0, async () => true);
const hypothesis = { origin: 'hypothesis' as const, expiresAt: T0 + DAY, evidenceEventIds: ['event1'] };

type Row = Record<string, unknown>;
/** Local fake modelled on src/lib/relationships/__tests__/stores.test.ts, with delete, batch and Date range operators. */
function fakeFirestore() {
  const rows = new Map<string, Row>();
  let queue: Promise<unknown> = Promise.resolve();
  let failNext = false;
  let batches = 0;
  function ref(path: string) {
    return { path, id: path.slice(path.indexOf('/') + 1), get: async () => snap(path), delete: async () => { rows.delete(path); } };
  }
  function snap(path: string) {
    const row = rows.get(path);
    return { ref: ref(path), id: path.slice(path.indexOf('/') + 1), exists: row !== undefined, get: (field: string) => row?.[field], data: () => row };
  }
  function query(name: string, filters: Array<[string, string, unknown]> = [], order = '', max = Infinity) {
    return {
      doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]], order, max),
      orderBy: (field: string) => query(name, filters, field, max),
      limit: (n: number) => query(name, filters, order, n),
      get: async () => {
        const matched = [...rows.entries()].filter(([path]) => path.startsWith(`${name}/`)).filter(([, row]) => filters.every(([field, op, value]) => {
          const actual = row[field];
          if (op === '==') return actual === value;
          if (!(actual instanceof Date) || !(value instanceof Date)) throw new Error('fake: range filters need Dates');
          if (op === '>=') return actual.getTime() >= value.getTime();
          if (op === '<=') return actual.getTime() <= value.getTime();
          throw new Error(`fake: unsupported op ${op}`);
        }));
        if (order) matched.sort(([, a], [, b]) => (a[order] as Date).getTime() - (b[order] as Date).getTime());
        const docs = matched.slice(0, max).map(([path]) => snap(path));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }
  const db = {
    collection: (name: string) => query(name),
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
    batch: () => {
      batches++;
      const deletes: string[] = [];
      return { delete: (r: { path: string }) => { deletes.push(r.path); }, commit: async () => { for (const path of deletes) rows.delete(path); } };
    },
  } as unknown as Firestore;
  return { db, rows, failNextCommit: () => { failNext = true; }, batches: () => batches };
}

const directories: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vox-reply-style-'));
  directories.push(dir);
  return join(dir, 'nested', 'reply-style.json');
}
type Kind = 'memory' | 'file' | 'firestore';
const KINDS: Kind[] = ['memory', 'file', 'firestore'];
function makeStore(kind: Kind): ReplyStyleStore {
  if (kind === 'memory') return new InMemoryReplyStyleStore();
  if (kind === 'file') return new FileReplyStyleStore(tempFile());
  return new FirestoreReplyStyleStore(fakeFirestore().db);
}
const STORE_METHODS = ['get', 'appendDecision', 'settle', 'listPosteriors', 'listDecisions', 'deleteScope', 'sweep'] as const;
function spyAll(store: ReplyStyleStore) {
  return STORE_METHODS.map(method => vi.spyOn(store, method));
}

beforeEach(() => {
  clock = T0;
  vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('unseeded'); });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

describe('precedence', () => {
  it('explicit this turn beats stored, stored beats sampled, sampled beats persona default', async () => {
    const store = new InMemoryReplyStyleStore();
    await seedPosterior(store, keyA, favour('length', 'detailed'));
    const p = policy(store, { dimensions: ['length'] });
    const storedBalanced = await resolved([prefRecord({ key: 'response_length', value: 'balanced' })]);

    const turn = await p.choose(input({ explicitThisTurn: { length: 'brief' } }));
    expect(turn.style.length).toBe('brief');
    expect(turn.sources.length).toBe('explicit_turn');
    expect(turn.decisionId).toBeUndefined();

    const turnOverStored = await p.choose(input({ explicitThisTurn: { length: 'brief' }, storedPreferences: storedBalanced }));
    expect(turnOverStored.style.length).toBe('brief');
    expect(turnOverStored.sources.length).toBe('explicit_turn');

    const stored = await p.choose(input({ storedPreferences: storedBalanced }));
    expect(stored.style.length).toBe('balanced');
    expect(stored.sources.length).toBe('explicit_stored');
    expect(stored.propensity).toBe(1);

    const sampled = await p.choose(input());
    expect(sampled.style.length).toBe('detailed');
    expect(sampled.sources.length).toBe('sampled');
    expect(sampled.decisionId).toBeDefined();

    const gated = await p.choose(input({ personalizationAllowed: () => false }));
    expect(gated.style.length).toBe(PERSONA_DEFAULT.length);
    expect(gated.sources.length).toBe('persona_default');
    expect(gated.decisionId).toBeUndefined();
  });

  it('maps resolvePreferences output to pins: structured, plain, auto, reset and hypothesis', async () => {
    const mixedDefault: ReplyStyle = { ...PERSONA_DEFAULT, language: 'mixed' };
    const structured = pinsFromResolvedPreferences(await resolved([prefRecord({ key: 'formatting', value: 'structured' })]), mixedDefault);
    expect(structured.pins.structure).toBe('steps');
    expect(structured.sources.structure).toBe('explicit_stored');
    const plain = pinsFromResolvedPreferences(await resolved([prefRecord({ key: 'formatting', value: 'plain' })]), mixedDefault);
    expect(plain.pins.structure).toBe('plain');
    const auto = pinsFromResolvedPreferences(await resolved([prefRecord({ key: 'language', value: 'auto' })]), mixedDefault);
    expect(auto.pins.language).toBe('mixed');
    expect(auto.sources.language).toBe('explicit_stored');
    const english = pinsFromResolvedPreferences(await resolved([prefRecord({ key: 'language', value: 'en' })]), mixedDefault);
    expect(english.pins.language).toBe('en');
    // Defaults pin nothing.
    expect(pinsFromResolvedPreferences(await resolved([]), mixedDefault).pins).toEqual({});

    const store = new InMemoryReplyStyleStore();
    const p = policy(store);
    const reset = await p.choose(input({ personaDefault: { ...PERSONA_DEFAULT, structure: 'steps' },
      storedPreferences: await resolved([prefRecord({ key: 'formatting', value: 'plain' }, { status: 'reset' })]) }));
    expect(reset.style.structure).toBe('steps');
    expect(reset.sources.structure).toBe('reset');
    const resetRecord = await recordOf(store, reset.decisionId);
    expect(resetRecord.dimensionPropensity.structure).toBeUndefined();
    expect(resetRecord.unchosenArms.structure).toBeUndefined();

    const inferred = await resolved([prefRecord({ key: 'formatting', value: 'structured' }, hypothesis)]);
    expect(inferred.find(r => r.setting.key === 'formatting')?.source).toBe('hypothesis');
    expect(pinsFromResolvedPreferences(inferred, PERSONA_DEFAULT).pins).toEqual({});
    const withHypothesis = await p.choose(input({ storedPreferences: inferred }));
    expect(withHypothesis.sources.structure).toBe('sampled');
  });

  it('resolveReplyStyle ignores invalid arm values and styleFromExplicitRequest maps triage labels', () => {
    const out = resolveReplyStyle({ personaDefault: PERSONA_DEFAULT, explicitThisTurn: { length: 'huge' as never }, sampled: { register: 'formal' } });
    expect(out.style.length).toBe('balanced');
    expect(out.sources.length).toBe('persona_default');
    expect(out.style.register).toBe('formal');
    expect(out.sources.register).toBe('sampled');
    expect(styleFromExplicitRequest('brief')).toEqual({ length: 'brief' });
    expect(styleFromExplicitRequest('detailed')).toEqual({ length: 'detailed' });
    expect(styleFromExplicitRequest('step_by_step')).toEqual({ structure: 'steps' });
    expect(styleFromExplicitRequest('listening')).toEqual({});
    expect(styleFromExplicitRequest('unspecified')).toEqual({});
  });

  it('pinned dimensions are never sampled or learned', async () => {
    const store = new InMemoryReplyStyleStore();
    const p = policy(store);
    const choice = await p.choose(input({ explicitThisTurn: { length: 'brief' } }));
    const record = await recordOf(store, choice.decisionId);
    expect(record.sources.length).toBe('explicit_turn');
    expect('length' in record.dimensionPropensity).toBe(false);
    expect('length' in record.unchosenArms).toBe(false);
    expect(await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: () => true })).toEqual({ updated: true, reward: 1 });
    const doc = await store.get(keyA);
    expect(doc?.arms.length).toBeUndefined();
    for (const d of REPLY_STYLE_DIMENSIONS.filter(x => x !== 'length')) {
      expect(doc?.arms[d]?.[record.armChosen[d]]).toMatchObject({ alpha: 2, beta: 1 });
      expect(Object.keys(doc?.arms[d] ?? {})).toEqual([record.armChosen[d]]);
    }
  });

  it('validates constructor options', () => {
    const store = new InMemoryReplyStyleStore();
    expect(() => policy(store, { dimensions: [] })).toThrow();
    expect(() => policy(store, { dimensions: ['length', 'length'] })).toThrow();
    expect(() => policy(store, { dimensions: ['tone' as ReplyStyleDimension] })).toThrow();
    expect(() => policy(store, { halfLifeMs: 0 })).toThrow();
    expect(() => policy(store, { propensitySamples: 15 })).toThrow();
    expect(() => policy(store, { propensitySamples: 2001 })).toThrow();
    expect(() => policy(store, { propensitySamples: 16, dimensions: ['register'] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Withdrawal and reset, for every store
// ---------------------------------------------------------------------------

for (const kind of KINDS) describe(`${kind} store: withdrawal and reset`, () => {
  it('withdraw deletes posteriors and eval rows by space, then entirely, and stale decisions recreate nothing', async () => {
    const store = makeStore(kind);
    const p = policy(store, { propensitySamples: 16 });
    const allow = () => true;
    const keys = [key('person-a'), key('person-a', { space: 'personal' }), key('person-b'), key('person-b', { space: 'personal' })];
    for (const k of keys) {
      const choice = await p.choose(input({ key: k }));
      expect(await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: allow })).toMatchObject({ updated: true });
    }
    const stale = await p.choose(input({ key: keys[0] }));
    expect(stale.decisionId).toBeDefined();

    expect(await p.withdraw('person-a', 'work')).toEqual({ posteriors: 1, decisions: 2 });
    expect(await p.describe({ personId: 'person-a', personaId: 'persona1', space: 'work' })).toEqual([]);
    expect((await p.describe({ personId: 'person-a', personaId: 'persona1', space: 'personal' })).length).toBeGreaterThan(0);

    expect(await p.withdraw('person-a')).toEqual({ posteriors: 1, decisions: 1 });
    expect(await p.settle({ decisionId: stale.decisionId!, signals: POSITIVE, personalizationAllowed: allow })).toEqual({ updated: false, reason: 'unknown_decision' });
    expect(await store.get(keys[0])).toBeNull();
    expect(await store.get(keys[1])).toBeNull();
    expect(await p.describe({ personId: 'person-a', personaId: 'persona1', space: 'work' })).toEqual([]);
    expect(await p.describe({ personId: 'person-a', personaId: 'persona1', space: 'personal' })).toEqual([]);

    // Person B is untouched.
    expect(await store.get(keys[2])).not.toBeNull();
    expect(await store.get(keys[3])).not.toBeNull();
    const remaining = await store.listDecisions({});
    expect(remaining).toHaveLength(2);
    expect(remaining.every(r => r.context.personKey === personKeyOf('person-b'))).toBe(true);
  });

  it('reset deletes only that persona and space, across all routes', async () => {
    const store = makeStore(kind);
    const p = policy(store, { propensitySamples: 16 });
    const targets = [key('person-a'), key('person-a', { route: 'thoughtful' })];
    const others = [key('person-a', { personaId: 'persona2' }), key('person-a', { space: 'personal' })];
    for (const k of [...targets, ...others]) {
      const choice = await p.choose(input({ key: k }));
      await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: () => true });
    }
    expect(new Set((await p.describe({ personId: 'person-a', personaId: 'persona1', space: 'work' })).map(v => v.route))).toEqual(new Set(['quick', 'thoughtful']));
    expect(await p.reset({ personId: 'person-a', personaId: 'persona1', space: 'work' })).toEqual({ posteriors: 2, decisions: 2 });
    for (const k of targets) expect(await store.get(k)).toBeNull();
    for (const k of others) expect(await store.get(k)).not.toBeNull();
    expect(await store.listDecisions({})).toHaveLength(2);
  });

  it('lists decisions by time range and sweeps only expired rows', async () => {
    const store = makeStore(kind);
    const p = policy(store, { propensitySamples: 16, dimensions: ['register'] });
    const ids: string[] = [];
    for (const offset of [0, DAY, 2 * DAY]) {
      clock = T0 + offset;
      ids.push((await p.choose(input())).decisionId!);
    }
    expect((await store.listDecisions({ since: T0 + DAY })).map(r => r.id)).toEqual(ids.slice(1));
    expect((await store.listDecisions({ until: T0 + DAY })).map(r => r.id)).toEqual(ids.slice(0, 2));
    expect((await store.listDecisions({ limit: 1 })).map(r => r.id)).toEqual(ids.slice(0, 1));
    expect(await store.sweep(T0 + EVAL_RETENTION_MS + DAY - 1)).toBe(1);
    expect((await store.listDecisions({})).map(r => r.id)).toEqual(ids.slice(1));
    expect(await store.sweep(T0 + EVAL_RETENTION_MS + DAY)).toBe(1);
    expect((await store.listDecisions({})).map(r => r.id)).toEqual(ids.slice(2));
  });
});

// ---------------------------------------------------------------------------
// Reward
// ---------------------------------------------------------------------------

describe('composite reward', () => {
  const replyAt = T0;
  it('reply-rate alone never produces a reward', () => {
    expect(compositeReward({ replied: true }, replyAt).reward).toBeNull();
    expect(compositeReward({ replied: true, followUp: { at: replyAt + 1000, corrective: 'unknown' } }, replyAt).reward).toBeNull();
    expect(compositeReward({ followUp: { at: replyAt + FOLLOW_UP_WINDOW_MS + 1, corrective: false } }, replyAt).reward).toBeNull();
    expect(compositeReward({ followUp: { at: replyAt - 1, corrective: false } }, replyAt).reward).toBeNull();
    expect(compositeReward({ followUp: { at: replyAt + FOLLOW_UP_WINDOW_MS + 1, corrective: true } }, replyAt).reward).toBeNull();
    expect(compositeReward({}, replyAt)).toEqual({ reward: null, positives: [], negatives: [] });
  });

  it('scores each single positive as 1 and each single negative as 0', () => {
    const positives: Array<[ReplyOutcomeSignals, string]> = [
      [{ reaction: 'positive' }, 'reaction_positive'],
      [{ followUp: { at: replyAt + 600_000, corrective: false } }, 'follow_up'],
      [{ shareOfferAccepted: true }, 'share_offer_accepted'],
      [{ voiceReciprocated: true }, 'voice_reciprocated'],
      [{ explicitThanks: true }, 'explicit_thanks'],
    ];
    for (const [signals, kind] of positives) expect(compositeReward(signals, replyAt)).toEqual({ reward: 1, positives: [kind], negatives: [] });
    const negatives: Array<[ReplyOutcomeSignals, string]> = [
      [{ explicitCorrection: true }, 'explicit_correction'],
      [{ correctionPhrase: true }, 'correction_phrase'],
      [{ reaction: 'negative' }, 'reaction_negative'],
      [{ followUp: { at: replyAt + 5_000, corrective: true } }, 'corrective_follow_up'],
    ];
    for (const [signals, kind] of negatives) expect(compositeReward(signals, replyAt)).toEqual({ reward: 0, positives: [], negatives: [kind] });
    const everything = compositeReward({ explicitCorrection: true, reaction: 'positive', followUp: { at: replyAt + 1, corrective: false },
      shareOfferAccepted: true, voiceReciprocated: true, explicitThanks: true, replied: true }, replyAt);
    expect(everything.reward).toBe(0);
    expect(everything.negatives).toEqual(['explicit_correction']);
  });

  it('200 settles with reply-rate-only signals leave every posterior unchanged', async () => {
    const store = new InMemoryReplyStyleStore();
    const p = policy(store, { propensitySamples: 16 });
    const first = await p.choose(input());
    await p.settle({ decisionId: first.decisionId!, signals: POSITIVE, personalizationAllowed: () => true });
    const before = await store.get(keyA);
    const settleSpy = vi.spyOn(store, 'settle');
    const variants: ReplyOutcomeSignals[] = [
      { replied: true },
      { replied: true, followUp: { at: T0 + 1000, corrective: 'unknown' } },
      { replied: true, followUp: { at: T0 + FOLLOW_UP_WINDOW_MS + 1, corrective: false } },
      { replied: true, followUp: { at: T0 - 1, corrective: false } },
    ];
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const choice = await p.choose(input());
      ids.push(choice.decisionId!);
      expect(await p.settle({ decisionId: choice.decisionId!, signals: variants[i % variants.length], personalizationAllowed: () => true }))
        .toEqual({ updated: false, reason: 'no_signal' });
    }
    expect(await store.get(keyA)).toEqual(before);
    const rows = (await store.listDecisions({})).filter(r => ids.includes(r.id));
    expect(rows).toHaveLength(200);
    expect(rows.every(r => r.reward === null && r.settledAt === undefined)).toBe(true);
    // Only the out-of-window follow-ups reached the store; they wrote nothing.
    expect(settleSpy).toHaveBeenCalledTimes(100);
    // A no_signal row can still be settled later.
    expect(await p.settle({ decisionId: ids[0], signals: POSITIVE, personalizationAllowed: () => true })).toEqual({ updated: true, reward: 1 });
  });
});

describe('correction phrases (EN/FA)', () => {
  it.each([
    'No, shorter', 'nope', 'try again', 'again', "that's not what I meant", 'you misunderstood',
    'نه، کوتاه‌تر', 'دوباره', 'منظورم این نبود', 'اشتباه متوجه شدی', 'منظورم اين نبود', 'اشتباه‌متوجه شدی', 'منظورم‌این نبود',
  ])('detects %s', text => {
    expect(detectCorrectionPhrase(text)).toBe(true);
  });
  it.each(['no problem', 'no worries, thanks', 'I know', 'nobody asked', 'نه ممنون', 'نهایت', 'thanks!'])('does not flag %s', text => {
    expect(detectCorrectionPhrase(text)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Decay, propensity and sampling
// ---------------------------------------------------------------------------

describe('decay', () => {
  it('halves evidence over the prior every 90 days and never drops below Beta(1,1)', () => {
    const p = { alpha: 11, beta: 1, updatedAt: T0 };
    expect(decayPosterior(p, T0 + 90 * DAY).alpha).toBeCloseTo(6, 9);
    expect(decayPosterior(p, T0 + 180 * DAY).alpha).toBeCloseTo(3.5, 9);
    const decade = decayPosterior(p, T0 + 3650 * DAY);
    expect(decade.alpha).toBeGreaterThanOrEqual(1);
    expect(decade.alpha).toBeCloseTo(1, 9);
    expect(decade.updatedAt).toBe(T0);
    expect(decayPosterior(p, T0 - DAY)).toEqual(p);
    expect(updatePosterior(p, 1, T0 + 90 * DAY)).toEqual({ alpha: expect.closeTo(7, 9), beta: 1, updatedAt: T0 + 90 * DAY });
    const capped = updatePosterior({ alpha: 9_999, beta: 1, updatedAt: T0 }, 1, T0);
    expect(capped.alpha + capped.beta).toBeCloseTo(MAX_EVIDENCE, 6);
    expect(capped.beta).toBe(1);
  });

  it('a dominant posterior that is ten half-lives old no longer dominates', async () => {
    const store = new InMemoryReplyStyleStore();
    await seedPosterior(store, keyA, favour('length', 'detailed'));
    const fresh = await policy(store, { dimensions: ['length'] }, 1).choose(input());
    expect(fresh.propensity).toBeGreaterThan(0.95);
    clock = T0 + 10 * 90 * DAY;
    for (let seed = 1; seed <= 5; seed++) {
      const choice = await policy(store, { dimensions: ['length'] }, seed).choose(input());
      expect(choice.propensity).toBeGreaterThan(0.2);
      expect(choice.propensity).toBeLessThan(0.6);
    }
  });
});

describe('propensity logging', () => {
  it('logs a content-free record with the chosen arm, propensity and unchosen arms', async () => {
    const store = new InMemoryReplyStyleStore();
    const p = policy(store, { dimensions: ['register'] });
    const choice = await p.choose(input());
    const record = await recordOf(store, choice.decisionId);
    expect(record.propensity).toBeGreaterThanOrEqual(0.35);
    expect(record.propensity).toBeLessThanOrEqual(0.65);
    expect(record.propensity).toBe(choice.propensity);
    expect(record.dimensionPropensity).toEqual({ register: record.propensity });
    expect(record.unchosenArms).toEqual({ register: REPLY_STYLE_ARMS.register.filter(a => a !== record.armChosen.register) });
    expect(record.reward).toBeNull();
    expect(record.at).toBe(T0);
    expect(record.expiresAt).toBe(T0 + 90 * DAY);
    expect(record.context).toEqual({ personKey: personKeyOf('person-a'), personaId: 'persona1', space: 'work', route: 'quick', policyVersion: 1, dimensions: ['register'] });
    expect(record.sources).toEqual({ length: 'persona_default', register: 'sampled', structure: 'persona_default', modality: 'persona_default', language: 'persona_default', closingQuestion: 'persona_default' });
    expect(record.armChosen).toEqual(choice.style);

    clock = T0 + 1000;
    expect(await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: () => true })).toEqual({ updated: true, reward: 1 });
    const settled = await recordOf(store, choice.decisionId);
    expect(settled.reward).toBe(1);
    expect(settled.rewardSignals).toEqual(['reaction_positive']);
    expect(settled.settledAt).toBe(clock);
    expect(await p.settle({ decisionId: choice.decisionId!, signals: { explicitCorrection: true }, personalizationAllowed: () => true }))
      .toEqual({ updated: false, reason: 'already_settled' });

    const late = await p.choose(input());
    clock += REWARD_WINDOW_MS + 1;
    expect(await p.settle({ decisionId: late.decisionId!, signals: POSITIVE, personalizationAllowed: () => true })).toEqual({ updated: false, reason: 'expired' });
    expect((await recordOf(store, late.decisionId)).reward).toBeNull();
  });

  it('a negative settle records reward 0 and adds to beta only', async () => {
    const store = new InMemoryReplyStyleStore();
    const p = policy(store, { dimensions: ['register'] });
    const choice = await p.choose(input());
    expect(await p.settle({ decisionId: choice.decisionId!, signals: { correctionPhrase: true, reaction: 'positive' }, personalizationAllowed: () => true }))
      .toEqual({ updated: true, reward: 0 });
    expect((await store.get(keyA))?.arms.register?.[choice.style.register]).toEqual({ alpha: 1, beta: 2, updatedAt: T0 });
    const record = await recordOf(store, choice.decisionId);
    expect(record.reward).toBe(0);
    expect(record.rewardSignals).toEqual(['reaction_positive', 'correction_phrase']);
  });

  it('joint propensity is the product over all six dimensions', async () => {
    const store = new InMemoryReplyStyleStore();
    const choice = await policy(store).choose(input());
    const record = await recordOf(store, choice.decisionId);
    const values = Object.values(record.dimensionPropensity) as number[];
    expect(values).toHaveLength(6);
    for (const value of values) { expect(value).toBeGreaterThan(0); expect(value).toBeLessThanOrEqual(1); }
    expect(record.propensity).toBeCloseTo(values.reduce((a, b) => a * b, 1), 12);
  });

  it('a dominant arm has propensity above 0.95', async () => {
    const store = new InMemoryReplyStyleStore();
    await seedPosterior(store, keyA, favour('register', 'formal', 1000));
    const choice = await policy(store, { dimensions: ['register'] }).choose(input());
    expect(choice.style.register).toBe('formal');
    expect(choice.propensity).toBeGreaterThan(0.95);
    expect(choice.propensity).toBeLessThanOrEqual(1);
  });
});

describe('deterministic sampling with an injected RNG', () => {
  it('same seed and store contents give the same choice; seeds explore; Math.random is never used', async () => {
    const a = new InMemoryReplyStyleStore();
    const b = new InMemoryReplyStyleStore();
    for (const store of [a, b]) await seedPosterior(store, keyA, { ...favour('length', 'detailed', 3), ...favour('register', 'formal', 2) });
    const first = await policy(a, {}, 42).choose(input());
    const second = await policy(b, {}, 42).choose(input());
    expect(second.style).toEqual(first.style);
    expect(second.sources).toEqual(first.sources);
    expect(second.propensity).toBe(first.propensity);

    const lengths = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) lengths.add((await policy(new InMemoryReplyStyleStore(), { dimensions: ['length'], propensitySamples: 16 }, seed).choose(input())).style.length);
    expect(lengths.size).toBeGreaterThanOrEqual(2);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('sampleBeta rejects a bad RNG and choose then falls back without sampling', async () => {
    for (const bad of [() => 1, () => -0.1, () => Number.NaN]) {
      expect(() => sampleBeta(2, 3, bad)).toThrow(RangeError);
      const store = new InMemoryReplyStyleStore();
      const choice = await new ReplyStylePolicy({ store, random: bad, now: () => clock }).choose(input());
      expect(choice.decisionId).toBeUndefined();
      expect(choice.propensity).toBe(1);
      expect(Object.values(choice.sources)).not.toContain('sampled');
      expect(choice.style).toEqual(PERSONA_DEFAULT);
      expect(await store.listDecisions({})).toEqual([]);
    }
    expect(() => sampleBeta(0, 1, mulberry32(1))).toThrow(RangeError);
    const rng = mulberry32(3);
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

describe('gate and audience', () => {
  it('a false gate touches no store method', async () => {
    const store = new InMemoryReplyStyleStore();
    const spies = spyAll(store);
    const gate = vi.fn(() => false);
    const choice = await policy(store).choose(input({ personalizationAllowed: gate }));
    expect(gate).toHaveBeenCalledTimes(1);
    expect(choice.decisionId).toBeUndefined();
    expect(choice.style).toEqual(PERSONA_DEFAULT);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // Only an exact `true` opens the gate.
    await policy(store).choose(input({ personalizationAllowed: () => 1 as unknown as boolean }));
    await policy(store).choose(input({ personalizationAllowed: async () => false }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect((await policy(store).choose(input({ personalizationAllowed: async () => true }))).decisionId).toBeDefined();
  });

  it('a gate that flips to false before the write records nothing', async () => {
    const store = new InMemoryReplyStyleStore();
    const append = vi.spyOn(store, 'appendDecision');
    const gate = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const choice = await policy(store).choose(input({ personalizationAllowed: gate }));
    expect(gate).toHaveBeenCalledTimes(2);
    expect(choice.decisionId).toBeUndefined();
    expect(choice.propensity).toBe(1);
    expect(Object.values(choice.sources)).not.toContain('sampled');
    expect(append).not.toHaveBeenCalled();
    expect(await store.listDecisions({})).toEqual([]);
  });

  it('groups and guest audiences never sample', async () => {
    const store = new InMemoryReplyStyleStore();
    const spies = spyAll(store);
    for (const overrides of [{ audience: 'group' as const }, { guestAudience: true }, { guestAudience: undefined as unknown as boolean }]) {
      const choice = await policy(store).choose(input(overrides));
      expect(choice.decisionId).toBeUndefined();
      expect(choice.style).toEqual(PERSONA_DEFAULT);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('settle with a false gate is personalization_off and changes nothing', async () => {
    const store = new InMemoryReplyStyleStore();
    const p = policy(store);
    const choice = await p.choose(input());
    const before = await store.get(keyA);
    const settleSpy = vi.spyOn(store, 'settle');
    expect(await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: () => false }))
      .toEqual({ updated: false, reason: 'personalization_off' });
    expect(await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: () => { throw new Error('gate down'); } }))
      .toEqual({ updated: false, reason: 'personalization_off' });
    expect(settleSpy).not.toHaveBeenCalled();
    expect(await store.get(keyA)).toEqual(before);
  });
});

describe('store failure is fail-closed', () => {
  it('choose falls back and settle reports store_error without throwing', async () => {
    const failingGet = new InMemoryReplyStyleStore();
    vi.spyOn(failingGet, 'get').mockRejectedValue(new Error('down'));
    const a = await policy(failingGet).choose(input());
    expect(a.decisionId).toBeUndefined();
    expect(a.style).toEqual(PERSONA_DEFAULT);

    const failingAppend = new InMemoryReplyStyleStore();
    vi.spyOn(failingAppend, 'appendDecision').mockRejectedValue(new Error('down'));
    const b = await policy(failingAppend).choose(input({ explicitThisTurn: { length: 'detailed' } }));
    expect(b.decisionId).toBeUndefined();
    expect(b.style).toEqual({ ...PERSONA_DEFAULT, length: 'detailed' });
    expect(b.sources.length).toBe('explicit_turn');
    expect(Object.values(b.sources)).not.toContain('sampled');

    const throwingGate = await policy(new InMemoryReplyStyleStore()).choose(input({ personalizationAllowed: () => { throw new Error('gate'); } }));
    expect(throwingGate.decisionId).toBeUndefined();

    const badPersona = await policy(new InMemoryReplyStyleStore()).choose(input({ key: key('person-a', { personaId: 'bad/persona' }) }));
    expect(badPersona.decisionId).toBeUndefined();

    const failingSettle = new InMemoryReplyStyleStore();
    vi.spyOn(failingSettle, 'settle').mockRejectedValue(new Error('down'));
    expect(await policy(failingSettle).settle({ decisionId: 'decision-1', signals: POSITIVE, personalizationAllowed: () => true }))
      .toEqual({ updated: false, reason: 'store_error' });
  });

  it('a mutate that throws leaves the in-memory store unchanged', async () => {
    const store = new InMemoryReplyStyleStore();
    await store.appendDecision(evalRecord('row-1', keyA, T0));
    await expect(store.settle('row-1', () => { throw new Error('abort'); })).rejects.toThrow('abort');
    await expect(store.appendDecision(evalRecord('row-1', keyA, T0))).rejects.toThrow();
    await expect(store.settle('row-1', d => ({ decision: { ...d!, text: 'x' } as ReplyStyleEvalRecord, result: 1 }))).rejects.toThrow();
    expect((await store.listDecisions({}))[0]).toEqual(evalRecord('row-1', keyA, T0));
  });
});

// ---------------------------------------------------------------------------
// Content-free storage
// ---------------------------------------------------------------------------

describe('content-free rows', () => {
  const PERSON_CANARY = 'PERSON_CANARY_7f3';
  const MESSAGE_CANARY = 'MESSAGE_CANARY_91b';

  async function exercise(store: ReplyStyleStore) {
    const k = key(PERSON_CANARY);
    const p = policy(store, { propensitySamples: 16 });
    const correctionPhrase = detectCorrectionPhrase(`${MESSAGE_CANARY} no not what I meant`);
    expect(correctionPhrase).toBe(true);
    const first = await p.choose(input({ key: k }));
    expect(await p.settle({ decisionId: first.decisionId!, signals: { correctionPhrase }, personalizationAllowed: () => true })).toEqual({ updated: true, reward: 0 });
    const second = await p.choose(input({ key: k }));
    await p.settle({ decisionId: second.decisionId!, signals: POSITIVE, personalizationAllowed: () => true });
    expect((await p.describe({ personId: PERSON_CANARY, personaId: 'persona1', space: 'work' })).length).toBeGreaterThan(0);
  }

  it('the file store never writes the person id or message text', async () => {
    const file = tempFile();
    await exercise(new FileReplyStyleStore(file));
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(PERSON_CANARY);
    expect(text).not.toContain(MESSAGE_CANARY);
    expect(text).toContain(personKeyOf(PERSON_CANARY));
  });

  it('the Firestore store never writes the person id or message text', async () => {
    const fake = fakeFirestore();
    await exercise(new FirestoreReplyStyleStore(fake.db));
    const dump = JSON.stringify([...fake.rows.entries()]);
    expect(dump).not.toContain(PERSON_CANARY);
    expect(dump).not.toContain(MESSAGE_CANARY);
    for (const row of fake.rows.values()) expect(Object.keys(row)).not.toContain('personId');
  });

  it('strict schemas reject extra keys and malformed person keys', () => {
    const record = evalRecord('row-1', keyA, T0);
    expect(replyStyleEvalRecordSchema.safeParse(record).success).toBe(true);
    expect(replyStyleEvalRecordSchema.safeParse({ ...record, text: 'hello' }).success).toBe(false);
    expect(replyStyleEvalRecordSchema.safeParse({ ...record, context: { ...record.context, personKey: 'abc' } }).success).toBe(false);
    expect(replyStyleEvalRecordSchema.safeParse({ ...record, context: { ...record.context, personKey: 'person-a' } }).success).toBe(false);
    expect(replyStyleEvalRecordSchema.safeParse({ ...record, context: { ...record.context, note: 'x' } }).success).toBe(false);
    expect(replyStyleEvalRecordSchema.safeParse({ ...record, armChosen: { ...record.armChosen, length: 'essay' } }).success).toBe(false);
    expect(replyStyleEvalRecordSchema.safeParse({ ...record, propensity: 0 }).success).toBe(false);
    const doc: ReplyStylePosteriorDoc = { schemaVersion: 1, id: posteriorDocId(keyA), personKey: personKeyOf('person-a'), personaId: 'persona1',
      space: 'work', route: 'quick', arms: { length: { brief: { alpha: 2, beta: 1, updatedAt: T0 } } }, updatedAt: T0 };
    expect(replyStylePosteriorDocSchema.safeParse(doc).success).toBe(true);
    expect(replyStylePosteriorDocSchema.safeParse({ ...doc, text: 'hello' }).success).toBe(false);
    expect(replyStylePosteriorDocSchema.safeParse({ ...doc, arms: { length: { essay: { alpha: 2, beta: 1, updatedAt: T0 } } } }).success).toBe(false);
    expect(replyStylePosteriorDocSchema.safeParse({ ...doc, arms: { tone: {} } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// File store
// ---------------------------------------------------------------------------

describe('file store', () => {
  it('persists across instances with private file and directory modes', async () => {
    const file = tempFile();
    const p = policy(new FileReplyStyleStore(file), { propensitySamples: 16 });
    const choice = await p.choose(input());
    await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: () => true });
    const reopened = new FileReplyStyleStore(file);
    expect(await reopened.get(keyA)).not.toBeNull();
    expect((await reopened.listDecisions({}))[0]).toMatchObject({ id: choice.decisionId, reward: 1 });
    expect(statSync(file).mode & 0o077).toBe(0);
    expect(statSync(dirname(file)).mode & 0o077).toBe(0);
  });

  it('serialises concurrent settles on one posterior exactly', async () => {
    const store = new FileReplyStyleStore(tempFile());
    const p = policy(store, { dimensions: ['register'], propensitySamples: 16 });
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push((await p.choose(input())).decisionId!);
    const results = await Promise.all(ids.map(decisionId => p.settle({ decisionId, signals: POSITIVE, personalizationAllowed: () => true })));
    expect(results.every(r => r.updated)).toBe(true);
    const arms = (await store.get(keyA))?.arms.register ?? {};
    expect(Object.values(arms).reduce((sum, arm) => sum + (arm.alpha - 1), 0)).toBe(30);
    expect(Object.values(arms).every(arm => arm.beta === 1)).toBe(true);
  });

  it('a corrupt, invalid or symlinked file fails closed and is never overwritten', async () => {
    const file = tempFile();
    const store = new FileReplyStyleStore(file);
    await store.appendDecision(evalRecord('row-1', keyA, T0));
    for (const content of ['{not json', JSON.stringify({ schemaVersion: 1, posteriors: [], decisions: [{ ...evalRecord('row-2', keyA, T0), text: 'x' }] })]) {
      writeFileSync(file, content);
      await expect(store.get(keyA)).rejects.toThrow();
      await expect(store.appendDecision(evalRecord('row-3', keyA, T0))).rejects.toThrow();
      await expect(store.settle('row-1', () => ({ result: 1 }))).rejects.toThrow();
      await expect(store.listPosteriors({ personKey: personKeyOf('person-a') })).rejects.toThrow();
      await expect(store.listDecisions({})).rejects.toThrow();
      await expect(store.deleteScope({ personKey: personKeyOf('person-a') })).rejects.toThrow();
      await expect(store.sweep(T0 + 365 * DAY)).rejects.toThrow();
      const choice = await policy(store).choose(input());
      expect(choice.decisionId).toBeUndefined();
      expect(await policy(store).settle({ decisionId: 'row-1', signals: POSITIVE, personalizationAllowed: () => true })).toEqual({ updated: false, reason: 'store_error' });
      expect(readFileSync(file, 'utf8')).toBe(content);
    }

    const target = tempFile();
    await new FileReplyStyleStore(target).appendDecision(evalRecord('row-1', keyA, T0));
    const link = join(dirname(target), 'link.json');
    symlinkSync(target, link);
    await expect(new FileReplyStyleStore(link).listDecisions({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Firestore store
// ---------------------------------------------------------------------------

describe('Firestore store with the local fake', () => {
  it('uses exactly the two default collections and Date fields for TTL', async () => {
    const fake = fakeFirestore();
    const p = policy(new FirestoreReplyStyleStore(fake.db), { propensitySamples: 16 });
    const choice = await p.choose(input());
    await p.settle({ decisionId: choice.decisionId!, signals: POSITIVE, personalizationAllowed: () => true });
    expect(new Set([...fake.rows.keys()].map(path => path.split('/')[0]))).toEqual(new Set(['vox_reply_style', 'vox_reply_style_eval']));
    const evalRow = fake.rows.get(`vox_reply_style_eval/${choice.decisionId}`)!;
    expect(evalRow.expiresAt).toBeInstanceOf(Date);
    expect((evalRow.expiresAt as Date).getTime()).toBe(T0 + EVAL_RETENTION_MS);
    expect(evalRow.at).toBeInstanceOf(Date);
    expect(evalRow.settled).toBe(true);
    expect(Object.keys(evalRow).sort()).toEqual(['at', 'expiresAt', 'json', 'personKey', 'personaId', 'settled', 'space']);
    const posteriorRow = fake.rows.get(`vox_reply_style/${posteriorDocId(keyA)}`)!;
    expect(Object.keys(posteriorRow).sort()).toEqual(['json', 'personKey', 'personaId', 'route', 'space', 'updatedAt']);
    expect(posteriorRow.updatedAt).toBeInstanceOf(Date);
  });

  it('a failed transaction commit leaves the posterior and decision unchanged', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreReplyStyleStore(fake.db);
    const p = policy(store, { propensitySamples: 16 });
    const first = await p.choose(input());
    await p.settle({ decisionId: first.decisionId!, signals: POSITIVE, personalizationAllowed: () => true });
    const before = await store.get(keyA);
    const second = await p.choose(input());
    fake.failNextCommit();
    expect(await p.settle({ decisionId: second.decisionId!, signals: POSITIVE, personalizationAllowed: () => true })).toEqual({ updated: false, reason: 'store_error' });
    expect(await store.get(keyA)).toEqual(before);
    expect((await recordOf(store, second.decisionId)).reward).toBeNull();
    // The decision can still be settled once the store recovers.
    expect(await p.settle({ decisionId: second.decisionId!, signals: POSITIVE, personalizationAllowed: () => true })).toEqual({ updated: true, reward: 1 });
  });

  it('refuses duplicate decision ids and unsafe document ids', async () => {
    const store = new FirestoreReplyStyleStore(fakeFirestore().db);
    await store.appendDecision(evalRecord('row-1', keyA, T0));
    await expect(store.appendDecision(evalRecord('row-1', keyA, T0))).rejects.toThrow();
    await expect(store.appendDecision(evalRecord('..', keyA, T0))).rejects.toThrow();
    expect(await store.settle('a/b', d => ({ result: d }))).toBeNull();
  });

  it('deleteScope loops past the 400-row batch size', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreReplyStyleStore(fake.db);
    for (let i = 0; i < 450; i++) await store.appendDecision(evalRecord(`row-${i}`, keyA, T0 + i));
    await store.appendDecision(evalRecord('other-row', key('person-b'), T0));
    expect(await policy(store).withdraw('person-a')).toEqual({ posteriors: 0, decisions: 450 });
    expect(fake.batches()).toBeGreaterThanOrEqual(2);
    expect((await store.listDecisions({})).map(r => r.id)).toEqual(['other-row']);
  });
});
