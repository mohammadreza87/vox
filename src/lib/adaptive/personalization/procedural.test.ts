import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePreferences } from './index';
import type { PreferenceScope } from './index';
import {
  ARMS, DEFAULT_DIMENSIONS, DIMENSION_ORDER, EVAL_RETENTION_MS, FOLLOW_UP_WINDOW_MS, HALF_LIFE_MS, POLICY_VERSION,
  POSTERIOR_IDLE_DELETE_MS, ReplyStyleBandit, SETTLE_WINDOW_MS, classifyFollowUp, computeReward, decayBeta,
  evalRowSchema, explicitRequestFromTurn, posteriorId, posteriorRowSchema, resolveReplyStyle, sampleBeta, seededRng,
  styleFromPreferences, subjectKey,
} from './procedural';
import type {
  BetaParams, ChooseInput, PosteriorRow, ReplyRoute, ReplyStyleBanditDeps, ReplyStyleEvalRow, ReplyStyleScope,
  ReplyStyleStore, StyleDimension, StyleSpace,
} from './procedural';
import {
  FileReplyStyleStore, FirestoreReplyStyleStore, InMemoryReplyStyleStore, MAX_FILE_EVAL_ROWS, capEvalRows,
} from './procedural-store';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const TEXT_CANARY = 'INDEPENDENT_DIAGNOSTIC_PRIVATE_TRANSCRIPT_021';
const SCOPE_A: ReplyStyleScope = { personId: 'person-a', personaId: 'p1', space: 'work', route: 'quick' };
const SCOPE_B: ReplyStyleScope = { personId: 'person-b', personaId: 'p1', space: 'work', route: 'quick' };
const POSITIVE = (at = T0 + 1_000) => [{ kind: 'reaction', polarity: 'positive', at }];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flatArms(dimension: StyleDimension): Record<string, BetaParams> {
  return Object.fromEntries((ARMS[dimension] as readonly string[]).map((arm) => [arm, { alpha: 1, beta: 1 }]));
}

function posteriorRow(scope: ReplyStyleScope, dimension: StyleDimension, arms: Record<string, BetaParams> = flatArms(dimension),
  updatedAt = T0): PosteriorRow {
  return {
    schemaVersion: 1, id: posteriorId(scope, dimension), subject: subjectKey(scope.personId), personaId: scope.personaId,
    space: scope.space, route: scope.route, dimension, arms, updatedAt,
  };
}

function skewedRow(scope: ReplyStyleScope, dimension: StyleDimension, favoured: string, updatedAt = T0): PosteriorRow {
  const arms = Object.fromEntries((ARMS[dimension] as readonly string[])
    .map((arm) => [arm, arm === favoured ? { alpha: 500, beta: 1 } : { alpha: 1, beta: 500 }]));
  return posteriorRow(scope, dimension, arms, updatedAt);
}

function evalRow(o: { id: string; scope?: ReplyStyleScope; at?: number; settledAt?: number; arm?: 'brief' | 'balanced' | 'detailed' }): ReplyStyleEvalRow {
  const scope = o.scope ?? SCOPE_A;
  const arm = o.arm ?? 'brief';
  const at = o.at ?? T0;
  return {
    schemaVersion: 1, id: o.id, policyVersion: POLICY_VERSION,
    context: { subject: subjectKey(scope.personId), personaId: scope.personaId, space: scope.space, route: scope.route, chatKind: 'private', pinned: {} },
    armChosen: { length: arm }, propensity: { length: 0.5 }, jointPropensity: 0.5,
    unchosenArms: { length: ARMS.length.filter((a) => a !== arm) },
    reward: null, rewardKinds: [], at, expiresAt: at + EVAL_RETENTION_MS,
    ...(o.settledAt === undefined ? {} : { settledAt: o.settledAt }),
  };
}

function idCounter(prefix = 'exp') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function makeBandit(store: ReplyStyleStore, overrides: Partial<ReplyStyleBanditDeps> = {}): ReplyStyleBandit {
  return new ReplyStyleBandit({
    store, authorize: async () => true, rng: seededRng(1), now: () => T0, newId: idCounter(), propensitySamples: 64, ...overrides,
  });
}

const privateTurn = (scope: ReplyStyleScope = SCOPE_A, extra: Partial<ChooseInput> = {}): ChooseInput =>
  ({ scope, chatKind: 'private', guestAudience: false, now: T0, ...extra });

const PREF_SCOPE: PreferenceScope = { tenantId: 't1', spaceId: 'work', containerId: 'c1', personId: 'person-a', agentId: 'p1' };

function preference(o: { id: string; origin: 'explicit' | 'hypothesis'; status?: 'active' | 'reset'; setting: { key: string; value: string } }) {
  return {
    schemaVersion: 1, id: o.id, revision: 1, ...PREF_SCOPE, createdAt: T0 - 1_000, updatedAt: T0 - 1_000,
    origin: o.origin, status: o.status ?? 'active', setting: o.setting,
    ...(o.origin === 'hypothesis' ? { expiresAt: T0 + DAY } : {}),
    evidenceEventIds: o.origin === 'hypothesis' ? ['evt-1'] : [],
  };
}

function spyStore(inner: ReplyStyleStore, overrides: Partial<ReplyStyleStore> = {}) {
  const calls: string[] = [];
  const wrap = <K extends keyof ReplyStyleStore>(name: K): ReplyStyleStore[K] => ((...args: unknown[]) => {
    calls.push(name);
    const target = (overrides[name] ?? inner[name].bind(inner)) as (...a: unknown[]) => unknown;
    return target(...args);
  }) as ReplyStyleStore[K];
  const store: ReplyStyleStore = {
    readPosteriors: wrap('readPosteriors'), recordExposure: wrap('recordExposure'), transact: wrap('transact'),
    listEval: wrap('listEval'), deleteSubject: wrap('deleteSubject'), sweep: wrap('sweep'),
  };
  return { store, calls };
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Replays the bandit's documented rng order over flat priors and returns every arm's Laplace propensity. */
function replayPropensities(seed: number, dims: readonly StyleDimension[], rounds: number) {
  const rng = seededRng(seed);
  const out: Partial<Record<StyleDimension, { chosen: string; all: number[] }>> = {};
  for (const d of dims) {
    const arms = ARMS[d] as readonly string[];
    const first = argmax(arms.map(() => sampleBeta(1, 1, rng)));
    const wins = arms.map(() => 0);
    for (let i = 0; i < rounds; i++) wins[argmax(arms.map(() => sampleBeta(1, 1, rng)))]++;
    out[d] = { chosen: arms[first], all: wins.map((w) => (w + 1) / (rounds + arms.length)) };
  }
  return out;
}

/** Test-local Firestore fake: collection/doc/where(==,<=,>=)/limit/get, batch deletes and transactions. */
function fakeFirestore() {
  const rows = new Map<string, Record<string, unknown>>();
  let commits = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const read = (data: unknown, path: string) => path.split('.')
    .reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), data);
  const ref = (path: string) => ({ path, id: path.slice(path.indexOf('/') + 1), get: async () => snap(path) });
  const snap = (path: string) => ({
    id: path.slice(path.indexOf('/') + 1), exists: rows.has(path), ref: ref(path),
    data: () => (rows.has(path) ? structuredClone(rows.get(path)) : undefined),
  });
  const query = (name: string, filters: Array<[string, string, unknown]>, max: number): Record<string, unknown> => ({
    where: (f: string, op: string, v: unknown) => query(name, [...filters, [f, op, v]], max),
    limit: (n: number) => query(name, filters, n),
    orderBy: () => query(name, filters, max),
    get: async () => {
      const docs = [...rows.keys()].filter((p) => p.startsWith(`${name}/`) && filters.every(([f, op, v]) => {
        const x = read(rows.get(p), f);
        if (op === '==') return x === v;
        if (typeof x !== 'number' || typeof v !== 'number') return false;
        return op === '<=' ? x <= v : op === '>=' ? x >= v : false;
      })).slice(0, max).map(snap);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const db = {
    collection: (name: string) => ({ ...query(name, [], Number.POSITIVE_INFINITY), doc: (id: string) => ref(`${name}/${id}`) }),
    batch: () => {
      const deletes: string[] = [];
      return { delete: (r: { path: string }) => { deletes.push(r.path); }, commit: async () => { commits++; for (const p of deletes) rows.delete(p); } };
    },
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
      const task = queue.then(async () => {
        const writes = new Map<string, Record<string, unknown>>();
        const result = await fn({
          get: async (r: { path: string }) => {
            if (writes.size > 0) throw new Error('Firestore transactions require all reads before writes');
            return snap(r.path);
          },
          set: (r: { path: string }, value: Record<string, unknown>) => { writes.set(r.path, structuredClone(value)); },
        });
        for (const [p, v] of writes) rows.set(p, v);
        return result;
      });
      queue = task.then(() => undefined, () => undefined);
      return task;
    },
  } as unknown as Firestore;
  return { db, rows, commits: () => commits };
}

type Kind = 'memory' | 'file' | 'firestore';
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vox-reply-style-'));
  tempDirs.push(dir);
  return join(dir, 'state', 'reply-style.json');
}

function makeStore(kind: Kind, seed: { posteriors?: unknown[]; evals?: unknown[] } = {}) {
  if (kind === 'memory') {
    const store = new InMemoryReplyStyleStore(seed);
    return { store, dumpText: () => JSON.stringify(store.dump()) };
  }
  if (kind === 'file') {
    const path = tempPath();
    if (seed.posteriors || seed.evals) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify({ version: 1, posteriors: seed.posteriors ?? [], evals: seed.evals ?? [] }), { mode: 0o600 });
    }
    return { store: new FileReplyStyleStore(path), path, dumpText: () => { try { return readFileSync(path, 'utf8'); } catch { return ''; } } };
  }
  const fake = fakeFirestore();
  for (const row of seed.posteriors ?? []) fake.rows.set(`vox_reply_style/${(row as { id: string }).id}`, structuredClone(row) as Record<string, unknown>);
  for (const row of seed.evals ?? []) fake.rows.set(`vox_reply_style_eval/${(row as { id: string }).id}`, structuredClone(row) as Record<string, unknown>);
  return { store: new FirestoreReplyStyleStore(fake.db), fake, dumpText: () => JSON.stringify([...fake.rows]) };
}

async function readAll(store: ReplyStyleStore, scope: ReplyStyleScope): Promise<PosteriorRow[]> {
  return store.readPosteriors(DIMENSION_ORDER.map((d) => posteriorId(scope, d)));
}

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

describe('precedence', () => {
  it('explicit request this turn beats stored preference, which beats the sampled arm, which beats the persona default', async () => {
    const store = new InMemoryReplyStyleStore({ posteriors: [skewedRow(SCOPE_A, 'length', 'detailed')] });
    const bandit = makeBandit(store);
    const personaDefault = { length: 'brief' as const };

    const a = await bandit.choose(privateTurn(SCOPE_A, { explicitThisTurn: { length: 'brief' }, personaDefault }));
    expect(a.style.length).toBe('brief');
    expect(a.sources.length).toBe('explicit_turn');

    const stored = await resolvePreferences([preference({ id: 'pref-len', origin: 'explicit', setting: { key: 'response_length', value: 'balanced' } })],
      PREF_SCOPE, T0, async () => true);
    const b = await bandit.choose(privateTurn(SCOPE_A, { storedPreferences: stored, personaDefault }));
    expect(b.style.length).toBe('balanced');
    expect(b.sources.length).toBe('explicit_stored');

    const c = await bandit.choose(privateTurn(SCOPE_A, { personaDefault }));
    expect(c.style.length).toBe('detailed');
    expect(c.sources.length).toBe('sampled');

    const denied = makeBandit(store, { authorize: async () => false });
    const d = await denied.choose(privateTurn(SCOPE_A, { personaDefault, storedPreferences: stored }));
    expect(d.style.length).toBe('brief');
    expect(d.sources.length).toBe('persona_default');
    expect(d.exposureId).toBeUndefined();

    const rows = await store.listEval();
    const rowA = rows.find((r) => r.id === a.exposureId)!;
    const rowB = rows.find((r) => r.id === b.exposureId)!;
    const rowC = rows.find((r) => r.id === c.exposureId)!;
    for (const [row, source] of [[rowA, 'explicit_turn'], [rowB, 'explicit_stored']] as const) {
      expect(row.armChosen.length).toBeUndefined();
      expect(row.propensity.length).toBeUndefined();
      expect(row.unchosenArms.length).toBeUndefined();
      expect(row.context.pinned).toEqual({ length: source });
      expect(Object.keys(row.armChosen).sort()).toEqual(['closingQuestion', 'register', 'structure']);
    }
    expect(rowC.armChosen.length).toBe('detailed');
    expect(rowC.context.pinned).toEqual({});
    expect(rows).toHaveLength(3);
  });

  it('resolveReplyStyle falls back to DEFAULT_REPLY_STYLE and ignores invalid layer values', () => {
    const { style, sources } = resolveReplyStyle({
      explicitThisTurn: { register: 'formal' },
      sampled: { length: 'detailed', register: 'informal' },
      personaDefault: { structure: 'steps', length: 'nonsense' as never },
    });
    expect(style).toEqual({ length: 'detailed', register: 'formal', structure: 'steps', closingQuestion: 'no', modality: 'text', language: 'auto' });
    expect(sources).toEqual({ length: 'sampled', register: 'explicit_turn', structure: 'persona_default', closingQuestion: 'persona_default', modality: 'persona_default', language: 'persona_default' });
  });

  it('stored preferences pin only through resolvePreferences explicit semantics', async () => {
    const resolved = await resolvePreferences([
      preference({ id: 'pref-fmt', origin: 'explicit', setting: { key: 'formatting', value: 'structured' } }),
      preference({ id: 'pref-len', origin: 'hypothesis', setting: { key: 'response_length', value: 'detailed' } }),
      preference({ id: 'pref-lang', origin: 'explicit', status: 'reset', setting: { key: 'language', value: 'fa' } }),
    ], PREF_SCOPE, T0, async () => true);
    expect(resolved.map((r) => [r.setting.key, r.source])).toEqual([
      ['response_length', 'hypothesis'], ['language', 'reset'], ['formatting', 'explicit'],
    ]);
    expect(styleFromPreferences(resolved)).toEqual({ structure: 'steps' });

    const plainAuto = await resolvePreferences([
      preference({ id: 'pref-fmt2', origin: 'explicit', setting: { key: 'formatting', value: 'plain' } }),
      preference({ id: 'pref-lang2', origin: 'explicit', setting: { key: 'language', value: 'auto' } }),
    ], PREF_SCOPE, T0, async () => true);
    expect(styleFromPreferences(plainAuto)).toEqual({ structure: 'plain' });
    const english = await resolvePreferences([
      preference({ id: 'pref-lang3', origin: 'explicit', setting: { key: 'language', value: 'en' } }),
    ], PREF_SCOPE, T0, async () => true);
    expect(styleFromPreferences(english)).toEqual({ language: 'en' });

    const store = new InMemoryReplyStyleStore();
    const choice = await makeBandit(store).choose(privateTurn(SCOPE_A, { storedPreferences: resolved }));
    expect(choice.style.structure).toBe('steps');
    expect(choice.sources.structure).toBe('explicit_stored');
    expect(choice.sources.length).toBe('sampled');
    expect((await store.listEval())[0].context.pinned).toEqual({ structure: 'explicit_stored' });
  });

  it('explicitRequestFromTurn mapping', () => {
    const table: Array<[Parameters<typeof explicitRequestFromTurn>, Record<string, string>]> = [
      [['brief'], { length: 'brief' }],
      [['detailed'], { length: 'detailed' }],
      [['step_by_step'], { structure: 'steps' }],
      [['listening'], { length: 'brief', closingQuestion: 'no' }],
      [['unspecified'], {}],
      [[undefined], {}],
      [[], {}],
      [[undefined, 'voice'], { modality: 'voice-default' }],
      [[undefined, 'text'], { modality: 'text' }],
      [['brief', 'voice'], { length: 'brief', modality: 'voice-default' }],
      [['unspecified', 'text'], { modality: 'text' }],
    ];
    for (const [args, expected] of table) expect(explicitRequestFromTurn(...args)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Withdrawal and reset
// ---------------------------------------------------------------------------

describe.each(['memory', 'file', 'firestore'] as const)('withdrawal deletes posteriors and eval rows (%s)', (kind) => {
  const A = 'person-a';
  const scopes = {
    aP1WorkQuick: { personId: A, personaId: 'p1', space: 'work', route: 'quick' },
    aP1WorkWeb: { personId: A, personaId: 'p1', space: 'work', route: 'web' },
    aP2Work: { personId: A, personaId: 'p2', space: 'work', route: 'quick' },
    aP1Personal: { personId: A, personaId: 'p1', space: 'personal', route: 'quick' },
    aP2Personal: { personId: A, personaId: 'p2', space: 'personal', route: 'thoughtful' },
    b: { personId: 'person-b', personaId: 'p1', space: 'work', route: 'quick' },
  } satisfies Record<string, ReplyStyleScope>;

  async function seeded() {
    const { store } = makeStore(kind);
    const bandit = makeBandit(store);
    for (const scope of Object.values(scopes)) {
      const choice = await bandit.choose(privateTurn(scope));
      expect(choice.exposureId).toBeDefined();
      const settled = await bandit.settle({ exposureId: choice.exposureId!, signals: POSITIVE(), now: T0 + 2_000 });
      expect(settled.outcome).toBe('updated');
    }
    return { store, bandit };
  }

  const count = async (bandit: ReplyStyleBandit, scope: ReplyStyleScope) =>
    (await bandit.posteriors({ personId: scope.personId, personaId: scope.personaId, space: scope.space, route: scope.route }, T0 + 2_000)).length;

  it('withdraw by space, then fully; reset by persona and space across routes; settle after deletion', async () => {
    const { store, bandit } = await seeded();
    expect(await bandit.withdraw({ personId: A, space: 'work' })).toEqual({ posteriors: 12, evals: 3 });
    expect(await count(bandit, scopes.aP1WorkQuick)).toBe(0);
    expect(await count(bandit, scopes.aP1WorkWeb)).toBe(0);
    expect(await count(bandit, scopes.aP2Work)).toBe(0);
    expect(await count(bandit, scopes.aP1Personal)).toBe(4);
    expect(await count(bandit, scopes.aP2Personal)).toBe(4);
    expect(await count(bandit, scopes.b)).toBe(4);
    expect((await store.listEval()).map((r) => r.context.subject).sort())
      .toEqual([subjectKey(A), subjectKey(A), subjectKey('person-b')].sort());

    expect(await bandit.withdraw({ personId: A })).toEqual({ posteriors: 8, evals: 2 });
    expect(await count(bandit, scopes.aP1Personal)).toBe(0);
    expect(await count(bandit, scopes.b)).toBe(4);
    expect(await store.listEval()).toHaveLength(1);
    expect(await bandit.withdraw({ personId: A })).toEqual({ posteriors: 0, evals: 0 });

    const second = await seeded();
    expect(await second.bandit.reset({ personId: A, personaId: 'p1', space: 'work' })).toEqual({ posteriors: 8, evals: 2 });
    expect(await count(second.bandit, scopes.aP1WorkQuick)).toBe(0);
    expect(await count(second.bandit, scopes.aP1WorkWeb)).toBe(0);
    expect(await count(second.bandit, scopes.aP2Work)).toBe(4);
    expect(await count(second.bandit, scopes.aP1Personal)).toBe(4);

    const pending = await second.bandit.choose(privateTurn(scopes.aP1WorkQuick));
    expect(pending.exposureId).toBeDefined();
    await second.bandit.withdraw({ personId: A });
    const late = await second.bandit.settle({ exposureId: pending.exposureId!, signals: POSITIVE(), now: T0 + 3_000, scope: scopes.aP1WorkQuick });
    expect(late).toEqual({ outcome: 'unknown_exposure', reward: null, kinds: [] });
    expect(await readAll(second.store, scopes.aP1WorkQuick)).toEqual([]);
    expect((await second.store.listEval()).every((r) => r.context.subject !== subjectKey(A))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reward
// ---------------------------------------------------------------------------

describe('reply-rate alone never changes a posterior', () => {
  async function setup() {
    const seededRows = DEFAULT_DIMENSIONS.map((d) => posteriorRow(SCOPE_A, d,
      Object.fromEntries((ARMS[d] as readonly string[]).map((arm, i) => [arm, { alpha: 3 + i, beta: 2 + i }]))));
    const store = new InMemoryReplyStyleStore({ posteriors: seededRows });
    const bandit = makeBandit(store, { propensitySamples: 16 });
    const before = await readAll(store, SCOPE_A);
    expect(before).toHaveLength(4);
    return { store, bandit, before };
  }

  it('bare replies, non-corrective follow-ups and their mix give no_update', async () => {
    const { store, bandit, before } = await setup();
    const cases: unknown[][] = [
      Array.from({ length: 50 }, (_, i) => ({ kind: 'reply', at: T0 + i * 1_000 })),
      [{ kind: 'follow_up', corrective: false, at: T0 + 60_000 }, { kind: 'follow_up', corrective: false, at: T0 + 9 * 60_000 }],
      [{ kind: 'follow_up', corrective: false, at: T0 + 1_000 }, { kind: 'reply', at: T0 + 2_000 }],
    ];
    for (const [i, signals] of cases.entries()) {
      const choice = await bandit.choose(privateTurn());
      const result = await bandit.settle({ exposureId: choice.exposureId!, signals, now: T0 + 10 * 60_000 });
      expect(result.outcome).toBe('no_update');
      expect(result.reward).toBeNull();
      if (i === 0) expect(computeReward(signals, T0)).toEqual({ reward: null, kinds: [], reason: 'reply_only' });
      expect(await readAll(store, SCOPE_A)).toEqual(before);
      const row = (await store.listEval()).find((r) => r.id === choice.exposureId)!;
      expect(row.settledAt).toBeDefined();
      expect(row.reward).toBeNull();
    }
  });

  it('property: 200 random subsets of reply and non-corrective follow-up signals never update', async () => {
    const { store, bandit, before } = await setup();
    const random = seededRng(99);
    for (let i = 0; i < 200; i++) {
      const signals: unknown[] = [];
      const n = Math.floor(random() * 6);
      for (let j = 0; j < n; j++) {
        const at = T0 + Math.floor(random() * FOLLOW_UP_WINDOW_MS);
        signals.push(random() < 0.5 ? { kind: 'reply', at } : { kind: 'follow_up', corrective: false, at });
      }
      const choice = await bandit.choose(privateTurn());
      const result = await bandit.settle({ exposureId: choice.exposureId!, signals, now: T0 + FOLLOW_UP_WINDOW_MS });
      expect(result.outcome).toBe('no_update');
      expect(result.reward).toBeNull();
    }
    expect(await readAll(store, SCOPE_A)).toEqual(before);
  });
});

describe('composite reward', () => {
  it('scores signals by the composite rules', () => {
    const at = T0;
    expect(computeReward([{ kind: 'reaction', polarity: 'positive', at: at + 1 }], at)).toEqual({ reward: 1, kinds: ['reaction_positive'], reason: 'positive' });
    expect(computeReward([{ kind: 'voice_reciprocated', at: at + 1 }], at).reward).toBe(0.5);
    expect(computeReward([{ kind: 'voice_reciprocated', at: at + 1 }, { kind: 'follow_up', corrective: false, at: at + 2 }], at))
      .toEqual({ reward: 0.75, kinds: ['follow_up', 'voice_reciprocated'], reason: 'positive' });
    expect(computeReward([{ kind: 'explicit_thanks', at: at + 1 }, { kind: 'explicit_correction', at: at + 2 }], at))
      .toEqual({ reward: 0, kinds: ['explicit_thanks', 'explicit_correction'], reason: 'negative' });
    expect(computeReward([{ kind: 'follow_up', corrective: true, at: at + 1 }], at)).toEqual({ reward: 0, kinds: ['follow_up_corrective'], reason: 'negative' });
    expect(computeReward([{ kind: 'reaction', polarity: 'negative', at: at + 1 }, { kind: 'share_offer_accepted', at: at + 1 }], at).reward).toBe(0);
    expect(computeReward([{ kind: 'share_offer_accepted', at: at + 1 }, { kind: 'explicit_thanks', at: at + 1 }], at).reward).toBe(1);
    // Windows.
    expect(computeReward([{ kind: 'voice_reciprocated', at: at + 1 }, { kind: 'follow_up', corrective: false, at: at + FOLLOW_UP_WINDOW_MS + 1 }], at).reward).toBe(0.5);
    expect(computeReward([{ kind: 'follow_up', corrective: true, at: at + FOLLOW_UP_WINDOW_MS + 1 }], at)).toEqual({ reward: null, kinds: [], reason: 'no_signal' });
    expect(computeReward([{ kind: 'reaction', polarity: 'positive', at: at + SETTLE_WINDOW_MS + 1 }], at).reward).toBeNull();
    expect(computeReward([{ kind: 'reaction', polarity: 'positive', at: at + SETTLE_WINDOW_MS }], at).reward).toBe(1);
    expect(computeReward([{ kind: 'reaction', polarity: 'positive', at: at - 1 }], at).reward).toBeNull();
    // Strict schema: malformed and text-carrying signals are dropped.
    expect(computeReward([{ kind: 'reaction', polarity: 'positive', at: at + 1, text: TEXT_CANARY }], at).reward).toBeNull();
    expect(computeReward([{ kind: 'explicit_thanks' }, { kind: 'reaction', polarity: 'maybe', at: at + 1 }, null, 'thanks', 42], at))
      .toEqual({ reward: null, kinds: [], reason: 'no_signal' });
    // A duplicate kind counts once.
    expect(computeReward([{ kind: 'voice_reciprocated', at: at + 1 }, { kind: 'voice_reciprocated', at: at + 2 }], at).reward).toBe(0.5);
    expect(computeReward([], at)).toEqual({ reward: null, kinds: [], reason: 'no_signal' });
  });

  it('updates only sampled dimensions; a corrective follow-up adds one to beta; pinned rows stay byte-equal', async () => {
    const lengthRow = posteriorRow(SCOPE_A, 'length', { brief: { alpha: 4, beta: 2 }, balanced: { alpha: 2, beta: 2 }, detailed: { alpha: 1, beta: 3 } });
    const registerRow = skewedRow(SCOPE_A, 'register', 'formal');
    const store = new InMemoryReplyStyleStore({ posteriors: [lengthRow, registerRow] });
    const bandit = makeBandit(store);
    const choice = await bandit.choose(privateTurn(SCOPE_A, { explicitThisTurn: { length: 'detailed' } }));
    expect(choice.style.register).toBe('formal');
    const result = await bandit.settle({ exposureId: choice.exposureId!, signals: [{ kind: 'follow_up', corrective: true, at: T0 + 1 }], now: T0 });
    expect(result).toEqual({ outcome: 'updated', reward: 0, kinds: ['follow_up_corrective'] });
    const after = new Map((await readAll(store, SCOPE_A)).map((r) => [r.dimension, r]));
    expect(after.get('length')).toEqual(lengthRow);
    expect(after.get('register')!.arms.formal).toEqual({ alpha: 500, beta: 2 });
    expect(after.get('register')!.arms.informal).toEqual({ alpha: 1, beta: 500 });
    expect(after.has('modality')).toBe(false);
    expect(after.has('language')).toBe(false);
    expect([...after.keys()].sort()).toEqual(['closingQuestion', 'length', 'register', 'structure']);
  });
});

describe('settle is idempotent and expires', () => {
  it('second settle is already_settled; concurrent settles update once', async () => {
    const store = new InMemoryReplyStyleStore();
    const bandit = makeBandit(store);
    const first = await bandit.choose(privateTurn());
    expect((await bandit.settle({ exposureId: first.exposureId!, signals: POSITIVE(), now: T0 + 2_000 })).outcome).toBe('updated');
    const snapshot = await readAll(store, SCOPE_A);
    expect(await bandit.settle({ exposureId: first.exposureId!, signals: POSITIVE(), now: T0 + 3_000, scope: SCOPE_A }))
      .toEqual({ outcome: 'already_settled', reward: null, kinds: [] });
    expect(await readAll(store, SCOPE_A)).toEqual(snapshot);

    const second = await bandit.choose(privateTurn());
    const outcomes = await Promise.all([
      bandit.settle({ exposureId: second.exposureId!, signals: POSITIVE(), now: T0 + 2_000, scope: SCOPE_A }),
      bandit.settle({ exposureId: second.exposureId!, signals: POSITIVE(), now: T0 + 2_000, scope: SCOPE_A }),
    ]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['already_settled', 'updated']);
    const evidence = (await readAll(store, SCOPE_A)).reduce((sum, row) =>
      sum + Object.values(row.arms).reduce((s, p) => s + p.alpha + p.beta - 2, 0), 0);
    expect(evidence).toBe(8); // two settled exposures × four dimensions × one unit of evidence
  });

  it('expired exposures and denied authorization never change posteriors', async () => {
    const store = new InMemoryReplyStyleStore();
    let allow = true;
    const bandit = makeBandit(store, { authorize: async () => allow });
    const late = await bandit.choose(privateTurn());
    expect(await bandit.settle({ exposureId: late.exposureId!, signals: POSITIVE(), now: T0 + SETTLE_WINDOW_MS + 1 }))
      .toEqual({ outcome: 'expired', reward: null, kinds: [] });
    expect(await readAll(store, SCOPE_A)).toEqual([]);
    const expiredRow = (await store.listEval()).find((r) => r.id === late.exposureId)!;
    expect(expiredRow.settledAt).toBe(T0 + SETTLE_WINDOW_MS + 1);
    expect(expiredRow.reward).toBeNull();

    const denied = await bandit.choose(privateTurn());
    allow = false;
    expect(await bandit.settle({ exposureId: denied.exposureId!, signals: POSITIVE(), now: T0 + 2_000 }))
      .toEqual({ outcome: 'not_allowed', reward: null, kinds: [] });
    expect(await readAll(store, SCOPE_A)).toEqual([]);
    const deniedRow = (await store.listEval()).find((r) => r.id === denied.exposureId)!;
    expect(deniedRow).toMatchObject({ reward: null, rewardKinds: [], settledAt: T0 + 2_000 });
  });

  it('a settle without a known or matching scope writes nothing', async () => {
    const store = new InMemoryReplyStyleStore();
    const choice = await makeBandit(store).choose(privateTurn());
    const other = makeBandit(store); // a different instance never saw this exposure
    expect((await other.settle({ exposureId: choice.exposureId!, signals: POSITIVE(), now: T0 + 1 })).outcome).toBe('not_allowed');
    expect((await other.settle({ exposureId: choice.exposureId!, signals: POSITIVE(), now: T0 + 1, scope: SCOPE_B })).outcome).toBe('not_allowed');
    expect((await store.listEval())[0].settledAt).toBeUndefined();
    expect((await other.settle({ exposureId: choice.exposureId!, signals: POSITIVE(), now: T0 + 2_000, scope: SCOPE_A })).outcome).toBe('updated');
    expect((await other.settle({ exposureId: 'missing-id', signals: POSITIVE(), scope: SCOPE_A })).outcome).toBe('unknown_exposure');
    expect((await other.settle({ exposureId: '../bad id', signals: POSITIVE() })).outcome).toBe('unknown_exposure');
  });
});

// ---------------------------------------------------------------------------
// Decay
// ---------------------------------------------------------------------------

describe('decay has a 90-day half-life', () => {
  it('decayBeta halves pseudo-counts above the prior', () => {
    expect(HALF_LIFE_MS).toBe(90 * DAY);
    expect(decayBeta({ alpha: 11, beta: 5 }, 90 * DAY)).toEqual({ alpha: 6, beta: 3 });
    expect(decayBeta({ alpha: 11, beta: 5 }, 180 * DAY)).toEqual({ alpha: 3.5, beta: 2 });
    expect(decayBeta({ alpha: 11, beta: 5 }, 0)).toEqual({ alpha: 11, beta: 5 });
    expect(decayBeta({ alpha: 11, beta: 5 }, -DAY)).toEqual({ alpha: 11, beta: 5 });
    const far = decayBeta({ alpha: 11, beta: 5 }, 100_000 * DAY);
    expect(far.alpha).toBeGreaterThanOrEqual(1);
    expect(far.beta).toBeGreaterThanOrEqual(1);
    expect(decayBeta({ alpha: 1, beta: 1 }, 90 * DAY)).toEqual({ alpha: 1, beta: 1 });
  });

  it('settle decays stored arms before the update; posteriors() reports decayed means', async () => {
    const lengthRow = posteriorRow(SCOPE_A, 'length', {
      brief: { alpha: 11, beta: 5 }, balanced: { alpha: 3, beta: 3 }, detailed: { alpha: 1, beta: 1 },
    }, T0 - 90 * DAY);
    const store = new InMemoryReplyStyleStore({ posteriors: [lengthRow], evals: [evalRow({ id: 'exp-decay', arm: 'brief' })] });
    const bandit = makeBandit(store);
    const result = await bandit.settle({ exposureId: 'exp-decay', signals: POSITIVE(), now: T0, scope: SCOPE_A });
    expect(result.outcome).toBe('updated');
    const [row] = await store.readPosteriors([posteriorId(SCOPE_A, 'length')]);
    expect(row.arms).toEqual({ brief: { alpha: 7, beta: 3 }, balanced: { alpha: 2, beta: 2 }, detailed: { alpha: 1, beta: 1 } });
    expect(row.updatedAt).toBe(T0);

    const views = await bandit.posteriors({ personId: SCOPE_A.personId, personaId: 'p1', space: 'work' }, T0 + 90 * DAY);
    expect(views).toHaveLength(1);
    expect(views[0].route).toBe('quick');
    expect(views[0].arms).toEqual([
      { arm: 'brief', mean: 4 / 6, evidence: 4 },
      { arm: 'balanced', mean: 0.5, evidence: 1 },
      { arm: 'detailed', mean: 0.5, evidence: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Propensity logging and content-freedom
// ---------------------------------------------------------------------------

describe('propensity and offline-evaluation logging', () => {
  it('logs context, chosen arms, propensities and unchosen arms that replay exactly', async () => {
    const store = new InMemoryReplyStyleStore();
    const bandit = makeBandit(store, { rng: seededRng(5), propensitySamples: 128 });
    const choice = await bandit.choose(privateTurn(SCOPE_A, { explicitThisTurn: { register: 'formal' } }));
    const [row] = await store.listEval();
    expect(row.id).toBe(choice.exposureId);
    expect(evalRowSchema.safeParse(row).success).toBe(true);
    expect(row.context).toEqual({ subject: subjectKey('person-a'), personaId: 'p1', space: 'work', route: 'quick', chatKind: 'private', pinned: { register: 'explicit_turn' } });
    expect(row.context.subject).toMatch(/^[0-9a-f]{32}$/);
    expect(row.policyVersion).toBe(POLICY_VERSION);
    expect(row.reward).toBeNull();
    expect(row.expiresAt).toBe(T0 + EVAL_RETENTION_MS);

    const sampledDims: StyleDimension[] = ['length', 'structure', 'closingQuestion'];
    const replay = replayPropensities(5, sampledDims, 128);
    let product = 1;
    for (const d of sampledDims) {
      const chosen = row.armChosen[d]!;
      expect(chosen).toBe(replay[d]!.chosen);
      expect(choice.style[d]).toBe(chosen);
      expect(row.unchosenArms[d]).toEqual((ARMS[d] as readonly string[]).filter((a) => a !== chosen));
      const p = row.propensity[d]!;
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
      const all = replay[d]!.all;
      expect(p).toBe(all[(ARMS[d] as readonly string[]).indexOf(chosen)]);
      expect(all.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
      product *= p;
    }
    expect(row.jointPropensity).toBeCloseTo(product, 12);
  });

  it('a strongly skewed posterior gives propensity above 0.95', async () => {
    const store = new InMemoryReplyStyleStore({ posteriors: [skewedRow(SCOPE_A, 'length', 'detailed')] });
    const choice = await makeBandit(store, { propensitySamples: 256 }).choose(privateTurn());
    const [row] = await store.listEval();
    expect(choice.style.length).toBe('detailed');
    expect(row.armChosen.length).toBe('detailed');
    expect(row.propensity.length).toBeGreaterThan(0.95);
  });

  it('strict schemas reject extra keys and inconsistent rows', () => {
    const row = evalRow({ id: 'exp-strict' });
    expect(evalRowSchema.safeParse(row).success).toBe(true);
    expect(evalRowSchema.safeParse({ ...row, text: 'hello' }).success).toBe(false);
    expect(evalRowSchema.safeParse({ ...row, context: { ...row.context, text: 'hello' } }).success).toBe(false);
    expect(evalRowSchema.safeParse({ ...row, unchosenArms: { length: ['detailed', 'balanced'] } }).success).toBe(false);
    expect(evalRowSchema.safeParse({ ...row, jointPropensity: 0.25 }).success).toBe(false);
    expect(evalRowSchema.safeParse({ ...row, context: { ...row.context, pinned: { length: 'explicit_turn' } } }).success).toBe(false);
    expect(evalRowSchema.safeParse({ ...row, armChosen: { length: 'huge' } }).success).toBe(false);
    expect(evalRowSchema.safeParse({ ...row, context: { ...row.context, chatKind: 'group' } }).success).toBe(false);
    expect(evalRowSchema.safeParse({ ...row, reward: 1 }).success).toBe(false); // reward without settledAt
    const posterior = posteriorRow(SCOPE_A, 'length');
    expect(posteriorRowSchema.safeParse(posterior).success).toBe(true);
    expect(posteriorRowSchema.safeParse({ ...posterior, text: 'x' }).success).toBe(false);
    expect(posteriorRowSchema.safeParse({ ...posterior, dimension: 'register' }).success).toBe(false);
    expect(posteriorRowSchema.safeParse({ ...posterior, arms: { ...posterior.arms, brief: { alpha: 0.5, beta: 1 } } }).success).toBe(false);
    expect(posteriorRowSchema.safeParse({ ...posterior, arms: { ...posterior.arms, brief: { alpha: 2e6, beta: 1 } } }).success).toBe(false);
    expect(posteriorRowSchema.safeParse({ ...posterior, personaId: 'bad persona' }).success).toBe(false);
  });
});

describe.each(['memory', 'file', 'firestore'] as const)('eval rows and posteriors are content-free (%s)', (kind) => {
  it('no canary text or raw personId reaches any stored row', async () => {
    expect(classifyFollowUp(`${TEXT_CANARY} not what I meant`)).toBe('corrective');
    const personId = 'person-canary-raw-77';
    const scope: ReplyStyleScope = { personId, personaId: 'p1', space: 'work', route: 'thoughtful' };
    const { store, dumpText } = makeStore(kind);
    const bandit = makeBandit(store, { dimensions: DIMENSION_ORDER });
    const first = await bandit.choose(privateTurn(scope));
    const label = classifyFollowUp(`${TEXT_CANARY} thanks so much`);
    expect(label).toBe('thanks');
    const signals: unknown[] = [
      { kind: 'explicit_thanks', at: T0 + 1_000 }, { kind: 'follow_up', corrective: false, at: T0 + 1_000 },
      { kind: 'reply', at: T0 + 1_000, text: TEXT_CANARY }, { kind: 'reaction', polarity: 'positive', at: T0 + 2_000, emoji: TEXT_CANARY },
    ];
    expect((await bandit.settle({ exposureId: first.exposureId!, signals, now: T0 + 3_000 })).outcome).toBe('updated');
    const second = await bandit.choose(privateTurn(scope, { now: T0 + 4_000 }));
    expect((await bandit.settle({ exposureId: second.exposureId!, signals: [{ kind: 'follow_up', corrective: true, at: T0 + 5_000 }], now: T0 + 6_000 })).outcome).toBe('updated');
    const text = dumpText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain(TEXT_CANARY);
    expect(text).not.toContain(personId);
    expect(text).toContain(subjectKey(personId));
    for (const row of await store.listEval()) expect(evalRowSchema.safeParse(row).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sampling determinism
// ---------------------------------------------------------------------------

describe('deterministic sampling with an injected RNG', () => {
  it('identical seeds and stores give identical choices and propensities', async () => {
    const run = async () => {
      const store = new InMemoryReplyStyleStore({ posteriors: [posteriorRow(SCOPE_A, 'length', { brief: { alpha: 3, beta: 2 }, balanced: { alpha: 2, beta: 2 }, detailed: { alpha: 2, beta: 3 } })] });
      const bandit = makeBandit(store, { rng: seededRng(42) });
      const choices = [];
      for (let i = 0; i < 5; i++) choices.push(await bandit.choose(privateTurn()));
      return { choices, rows: await store.listEval() };
    };
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.choices).toEqual(b.choices);
    expect(a.rows.map((r) => [r.armChosen, r.propensity, r.jointPropensity])).toEqual(b.rows.map((r) => [r.armChosen, r.propensity, r.jointPropensity]));
  });

  it('a flat prior explores across seeds and the sampler has the right mean', async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const choice = await makeBandit(new InMemoryReplyStyleStore(), { rng: seededRng(seed), propensitySamples: 16 }).choose(privateTurn());
      seen.add(choice.style.length);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
    const rng = seededRng(7);
    let sum = 0;
    for (let i = 0; i < 5000; i++) sum += sampleBeta(3, 7, rng);
    expect(Math.abs(sum / 5000 - 0.3)).toBeLessThanOrEqual(0.02);
    const small = seededRng(3);
    for (let i = 0; i < 100; i++) {
      const x = sampleBeta(0.5, 0.5, small);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

describe('gate', () => {
  const stored = () => resolvePreferences([preference({ id: 'pref-len', origin: 'explicit', setting: { key: 'response_length', value: 'detailed' } })],
    PREF_SCOPE, T0, async () => true);

  it('authorize false or throwing: zero store calls, no exposure, stored preferences ignored', async () => {
    for (const authorize of [async () => false, async () => { throw new Error('consent store down'); }]) {
      const { store, calls } = spyStore(new InMemoryReplyStyleStore());
      const bandit = makeBandit(store, { authorize });
      const choice = await bandit.choose(privateTurn(SCOPE_A, { storedPreferences: await stored(), personaDefault: { length: 'brief' }, explicitThisTurn: { register: 'formal' } }));
      expect(calls).toEqual([]);
      expect(choice.exposureId).toBeUndefined();
      expect(choice.style.length).toBe('brief');
      expect(choice.style.register).toBe('formal');
      expect(Object.values(choice.sources)).not.toContain('sampled');
      expect(Object.values(choice.sources)).not.toContain('explicit_stored');
    }
  });

  it('group chats and guest audiences never call authorize or the store, but honour explicit requests', async () => {
    for (const input of [{ chatKind: 'group' as const, guestAudience: false }, { chatKind: 'private' as const, guestAudience: true }]) {
      const { store, calls } = spyStore(new InMemoryReplyStyleStore());
      const authorize = vi.fn(async () => true);
      const bandit = makeBandit(store, { authorize });
      const choice = await bandit.choose({ ...privateTurn(SCOPE_A, { storedPreferences: await stored(), explicitThisTurn: { length: 'brief' } }), ...input });
      expect(authorize).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
      expect(choice.exposureId).toBeUndefined();
      expect(choice.style.length).toBe('brief');
      expect(choice.sources.length).toBe('explicit_turn');
      expect(Object.values(choice.sources)).not.toContain('sampled');
    }
  });

  it('a failing posterior read falls back without throwing', async () => {
    const { store } = spyStore(new InMemoryReplyStyleStore(), { readPosteriors: async () => { throw new Error('unavailable'); } });
    const choice = await makeBandit(store).choose(privateTurn(SCOPE_A, { storedPreferences: await stored(), personaDefault: { length: 'brief' } }));
    expect(choice.exposureId).toBeUndefined();
    expect(choice.style.length).toBe('brief');
    expect(Object.values(choice.sources)).not.toContain('sampled');
  });

  it('a failing recordExposure returns the non-sampled result', async () => {
    const inner = new InMemoryReplyStyleStore();
    const { store, calls } = spyStore(inner, { recordExposure: async () => { throw new Error('write failed'); } });
    const choice = await makeBandit(store).choose(privateTurn(SCOPE_A, { storedPreferences: await stored() }));
    expect(calls).toEqual(['readPosteriors', 'recordExposure']);
    expect(choice.exposureId).toBeUndefined();
    expect(choice.style.length).toBe('detailed');
    expect(choice.sources.length).toBe('explicit_stored');
    expect(Object.values(choice.sources)).not.toContain('sampled');
    expect(choice.style).toMatchObject({ register: 'informal', structure: 'plain', closingQuestion: 'no' });
  });

  it('fully pinned dimensions skip the store entirely', async () => {
    const { store, calls } = spyStore(new InMemoryReplyStyleStore());
    const choice = await makeBandit(store).choose(privateTurn(SCOPE_A, {
      explicitThisTurn: { length: 'brief', register: 'formal', structure: 'steps', closingQuestion: 'yes' },
    }));
    expect(calls).toEqual([]);
    expect(choice.exposureId).toBeUndefined();
  });

  it('reset, withdraw and sweep are ungated', async () => {
    const authorize = vi.fn(async () => false);
    const store = new InMemoryReplyStyleStore({ posteriors: [posteriorRow(SCOPE_A, 'length')], evals: [evalRow({ id: 'exp-1' })] });
    const bandit = makeBandit(store, { authorize });
    expect(await bandit.reset({ personId: 'person-a', personaId: 'p1', space: 'work' })).toEqual({ posteriors: 1, evals: 1 });
    expect(await bandit.withdraw({ personId: 'person-a' })).toEqual({ posteriors: 0, evals: 0 });
    expect(await bandit.sweep(T0)).toEqual({ posteriors: 0, evals: 0 });
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe('dimensions option', () => {
  it('rejects anything but 4 to 6 distinct known dimensions', () => {
    const store = new InMemoryReplyStyleStore();
    const bad: unknown[] = [
      ['length', 'register', 'structure'],
      [...DIMENSION_ORDER, 'length'],
      ['length', 'length', 'register', 'structure'],
      ['length', 'register', 'structure', 'tone'],
      [],
    ];
    for (const dimensions of bad) {
      expect(() => makeBandit(store, { dimensions: dimensions as StyleDimension[] })).toThrow(new RangeError('reply_style_dimensions'));
    }
    expect(() => makeBandit(store, { dimensions: DIMENSION_ORDER })).not.toThrow();
    expect(() => makeBandit(store, { propensitySamples: 8 })).toThrow(RangeError);
  });

  it('modality and language are never sampled by default', async () => {
    const store = new InMemoryReplyStyleStore();
    const bandit = makeBandit(store);
    for (let i = 0; i < 10; i++) {
      const choice = await bandit.choose(privateTurn(SCOPE_A, { personaDefault: { modality: 'voice-default' } }));
      expect(choice.style.language).toBe('auto');
      expect(choice.sources.language).toBe('persona_default');
      expect(choice.style.modality).toBe('voice-default');
      expect(choice.sources.modality).toBe('persona_default');
    }
    for (const row of await store.listEval()) {
      expect(row.armChosen.modality).toBeUndefined();
      expect(row.armChosen.language).toBeUndefined();
    }
    const all = await makeBandit(new InMemoryReplyStyleStore(), { dimensions: DIMENSION_ORDER }).choose(privateTurn());
    expect(all.sources.language).toBe('sampled');
    expect(all.sources.modality).toBe('sampled');
  });
});

describe('classifyFollowUp EN/FA', () => {
  it('classifies the table', () => {
    const table: Array<[string, 'corrective' | 'thanks' | 'neutral']> = [
      ['No, shorter please', 'corrective'],
      ['not what I meant', 'corrective'],
      ['try it again', 'corrective'],
      ["that's wrong", 'corrective'],
      ['نه، کوتاه‌تر', 'corrective'],
      ['منظورم این نبود', 'corrective'],
      ['دوباره بنویس', 'corrective'],
      ['منظورم اين نبود', 'corrective'],
      ['thanks!', 'thanks'],
      ['ممنون', 'thanks'],
      ['مرسی عالی بود', 'thanks'],
      // Documented: starts with "no", and correction wins over thanks.
      ['no problem, thanks', 'corrective'],
      ['what about tomorrow?', 'neutral'],
      ['نهار چی بخوریم؟', 'neutral'],
      ['', 'neutral'],
    ];
    for (const [text, label] of table) expect(classifyFollowUp(text), text).toBe(label);
    expect(classifyFollowUp(undefined as unknown as string)).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// Store contract
// ---------------------------------------------------------------------------

describe.each(['memory', 'file', 'firestore'] as const)('store contract (%s)', (kind: Kind) => {
  it('recordExposure round-trips through listEval and rejects duplicates and invalid rows', async () => {
    const { store } = makeStore(kind);
    const row = evalRow({ id: 'exp-1' });
    await store.recordExposure(row);
    expect(await store.listEval()).toEqual([row]);
    await expect(store.recordExposure(row)).rejects.toThrow();
    await expect(store.recordExposure({ ...row, id: 'exp-2', text: 'x' } as unknown as ReplyStyleEvalRow)).rejects.toThrow();
    await store.recordExposure(evalRow({ id: 'exp-3', at: T0 + 10, scope: { ...SCOPE_A, personaId: 'p2' } }));
    expect((await store.listEval({ personaId: 'p2' })).map((r) => r.id)).toEqual(['exp-3']);
    expect((await store.listEval({ since: T0 + 5 })).map((r) => r.id)).toEqual(['exp-3']);
    expect((await store.listEval({ until: T0 + 5 })).map((r) => r.id)).toEqual(['exp-1']);
    expect((await store.listEval({ limit: 1 })).map((r) => r.id)).toEqual(['exp-1']);
  });

  it('transact is atomic: a throw or an invalid write commits nothing', async () => {
    const { store } = makeStore(kind);
    await store.recordExposure(evalRow({ id: 'exp-1' }));
    const id = posteriorId(SCOPE_A, 'length');
    await expect(store.transact({ exposureIds: ['exp-1'], posteriorIds: [id] }, () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await expect(store.transact({ exposureIds: ['exp-1'], posteriorIds: [id] }, (snapshot) => ({
      exposures: [{ ...snapshot.exposures.get('exp-1')!, settledAt: T0 }],
      posteriors: [posteriorRow(SCOPE_A, 'length'), { ...posteriorRow(SCOPE_A, 'register'), updatedAt: -1 }],
      result: 'never',
    }))).rejects.toThrow();
    expect(await store.readPosteriors([id])).toEqual([]);
    expect((await store.listEval())[0].settledAt).toBeUndefined();

    const result = await store.transact({ exposureIds: ['exp-1', 'missing'], posteriorIds: [id] }, (snapshot) => {
      expect([...snapshot.exposures.keys()]).toEqual(['exp-1']);
      expect(snapshot.posteriors.size).toBe(0);
      return { exposures: [{ ...snapshot.exposures.get('exp-1')!, settledAt: T0 + 1 }], posteriors: [posteriorRow(SCOPE_A, 'length')], result: 42 };
    });
    expect(result).toBe(42);
    expect(await store.readPosteriors([id])).toEqual([posteriorRow(SCOPE_A, 'length')]);
    expect((await store.listEval())[0].settledAt).toBe(T0 + 1);
  });

  it('deleteSubject honours every filter combination and returns counts', async () => {
    const sA = subjectKey('person-a');
    const combos: ReplyStyleScope[] = [];
    for (const personaId of ['p1', 'p2']) for (const space of ['work', 'personal'] as StyleSpace[]) combos.push({ personId: 'person-a', personaId, space, route: 'quick' });
    const posteriors = [...combos, SCOPE_B].flatMap((scope) => [posteriorRow(scope, 'length'), posteriorRow(scope, 'register')]);
    const evals = [...combos, SCOPE_B].map((scope, i) => evalRow({ id: `exp-${i}`, scope }));
    const { store } = makeStore(kind, { posteriors, evals });
    expect(await store.deleteSubject({ subject: sA, personaId: 'p1', space: 'work' })).toEqual({ posteriors: 2, evals: 1 });
    expect(await store.deleteSubject({ subject: sA, personaId: 'p2' })).toEqual({ posteriors: 4, evals: 2 });
    expect(await store.deleteSubject({ subject: sA, space: 'personal' })).toEqual({ posteriors: 2, evals: 1 });
    expect(await store.deleteSubject({ subject: sA })).toEqual({ posteriors: 0, evals: 0 });
    expect(await store.readPosteriors(DIMENSION_ORDER.map((d) => posteriorId(SCOPE_B, d)))).toHaveLength(2);
    expect((await store.listEval()).map((r) => r.context.subject)).toEqual([subjectKey('person-b')]);
    await expect(store.deleteSubject({ subject: 'person-a' })).rejects.toThrow(RangeError);
  });

  it('sweep removes expired eval rows and idle posteriors only', async () => {
    const now = T0 + 400 * DAY;
    const idle = posteriorRow(SCOPE_A, 'length', flatArms('length'), now - POSTERIOR_IDLE_DELETE_MS);
    const fresh = posteriorRow(SCOPE_A, 'register', flatArms('register'), now - POSTERIOR_IDLE_DELETE_MS + 1);
    const expired = evalRow({ id: 'exp-old', at: now - EVAL_RETENTION_MS });
    const kept = evalRow({ id: 'exp-new', at: now - EVAL_RETENTION_MS + 1 });
    const { store } = makeStore(kind, { posteriors: [idle, fresh], evals: [expired, kept] });
    expect(await store.sweep(now)).toEqual({ posteriors: 1, evals: 1 });
    expect(await store.readPosteriors([idle.id, fresh.id])).toEqual([fresh]);
    expect((await store.listEval()).map((r) => r.id)).toEqual(['exp-new']);
    expect(await store.sweep(now)).toEqual({ posteriors: 0, evals: 0 });
  });

  it('invalid rows are skipped on read and still deleted by subject', async () => {
    const valid = posteriorRow(SCOPE_A, 'length');
    const invalidPosterior = { ...posteriorRow(SCOPE_A, 'register'), text: TEXT_CANARY };
    const validEval = evalRow({ id: 'exp-ok' });
    const invalidEval = { ...evalRow({ id: 'exp-bad' }), jointPropensity: 0.123 };
    const { store } = makeStore(kind, { posteriors: [valid, invalidPosterior], evals: [validEval, invalidEval] });
    expect(await store.readPosteriors([valid.id, invalidPosterior.id])).toEqual([valid]);
    expect(await store.listEval()).toEqual([validEval]);
    const seen = await store.transact({ exposureIds: ['exp-bad'], posteriorIds: [invalidPosterior.id] },
      (snapshot) => ({ result: [snapshot.exposures.size, snapshot.posteriors.size] }));
    expect(seen).toEqual([0, 0]);
    expect(await store.deleteSubject({ subject: subjectKey('person-a') })).toEqual({ posteriors: 2, evals: 2 });
  });

  if (kind === 'file') {
    it('writes 0600 in a private directory and reloads in a second instance', async () => {
      const path = tempPath();
      const store = new FileReplyStyleStore(path);
      await store.recordExposure(evalRow({ id: 'exp-1' }));
      await store.transact({ exposureIds: [], posteriorIds: [] }, () => ({ posteriors: [posteriorRow(SCOPE_A, 'length')], result: null }));
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(path)).mode & 0o077).toBe(0);
      const reloaded = new FileReplyStyleStore(path);
      expect(await reloaded.listEval()).toEqual([evalRow({ id: 'exp-1' })]);
      expect(await reloaded.readPosteriors([posteriorId(SCOPE_A, 'length')])).toEqual([posteriorRow(SCOPE_A, 'length')]);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      expect(Object.keys(parsed).sort()).toEqual(['evals', 'posteriors', 'version']);
    });

    it('refuses a file with a bad version or envelope', async () => {
      for (const body of ['{"version":2,"posteriors":[],"evals":[]}', '{"version":1,"posteriors":{}}', 'not json', '{"version":1,"posteriors":[],"evals":[],"extra":1}']) {
        const path = tempPath();
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, body);
        await expect(new FileReplyStyleStore(path).listEval()).rejects.toThrow('invalid_reply_style_store');
        expect(readFileSync(path, 'utf8')).toBe(body);
      }
    });

    it('caps eval rows, dropping the oldest settled rows first', async () => {
      const synthetic = Array.from({ length: MAX_FILE_EVAL_ROWS + 5 }, (_, i) =>
        evalRow({ id: `exp-${String(i).padStart(6, '0')}`, at: T0 + i, ...(i % 2 === 1 ? { settledAt: T0 + i } : {}) }));
      const capped = capEvalRows(synthetic);
      expect(capped).toHaveLength(MAX_FILE_EVAL_ROWS);
      const dropped = synthetic.filter((r) => !capped.some((c) => c.id === r.id)).map((r) => r.id);
      expect(dropped).toEqual(['exp-000001', 'exp-000003', 'exp-000005', 'exp-000007', 'exp-000009']);
      const unsettledOnly = Array.from({ length: 7 }, (_, i) => evalRow({ id: `u-${i}`, at: T0 + i }));
      expect(capEvalRows(unsettledOnly, 5).map((r) => r.id)).toEqual(['u-2', 'u-3', 'u-4', 'u-5', 'u-6']);

      const full = Array.from({ length: MAX_FILE_EVAL_ROWS }, (_, i) =>
        evalRow({ id: `exp-${String(i).padStart(6, '0')}`, at: T0 + i, ...(i < 3 ? { settledAt: T0 + i } : {}) }));
      const { store, path } = makeStore('file', { evals: full });
      await store.recordExposure(evalRow({ id: 'exp-newest', at: T0 + MAX_FILE_EVAL_ROWS }));
      const written = JSON.parse(readFileSync(path!, 'utf8')) as { evals: Array<{ id: string }> };
      expect(written.evals).toHaveLength(MAX_FILE_EVAL_ROWS);
      const ids = new Set(written.evals.map((r) => r.id));
      expect(ids.has('exp-newest')).toBe(true);
      expect(ids.has('exp-000000')).toBe(false);
      expect(ids.has('exp-000001')).toBe(true);
    }, 60_000);
  }

  if (kind === 'firestore') {
    it('pages batch deletes across more than 400 rows', async () => {
      const evals = Array.from({ length: 901 }, (_, i) => evalRow({ id: `exp-${i}`, at: T0 + i }));
      const { store, fake } = makeStore('firestore', { evals, posteriors: [posteriorRow(SCOPE_A, 'length')] });
      expect(await store.deleteSubject({ subject: subjectKey('person-a') })).toEqual({ posteriors: 1, evals: 901 });
      expect(fake!.commits()).toBeGreaterThanOrEqual(4);
      expect(fake!.rows.size).toBe(0);
      const old = Array.from({ length: 450 }, (_, i) => evalRow({ id: `old-${i}`, at: T0 - EVAL_RETENTION_MS - i }));
      const second = makeStore('firestore', { evals: old });
      expect(await second.store.sweep(T0)).toEqual({ posteriors: 0, evals: 450 });
    });

    it('uses the configured collections and stores plain numbers', async () => {
      const fake = fakeFirestore();
      const store = new FirestoreReplyStyleStore(fake.db, { posteriors: 'p_test', evals: 'e_test' });
      await store.recordExposure(evalRow({ id: 'exp-1' }));
      await store.transact({ exposureIds: [], posteriorIds: [] }, () => ({ posteriors: [posteriorRow(SCOPE_A, 'length')], result: null }));
      expect([...fake.rows.keys()].sort()).toEqual([`e_test/exp-1`, `p_test/${posteriorId(SCOPE_A, 'length')}`]);
      expect(typeof fake.rows.get('e_test/exp-1')!.at).toBe('number');
      expect(() => new FirestoreReplyStyleStore(fake.db, { posteriors: 'same', evals: 'same' })).toThrow(RangeError);
    });
  }
});

describe('keys', () => {
  it('hashes the subject and derives stable posterior ids', () => {
    expect(subjectKey('person-a')).toMatch(/^[0-9a-f]{32}$/);
    expect(subjectKey('person-a')).not.toBe(subjectKey('person-b'));
    const id = posteriorId(SCOPE_A, 'length');
    expect(id).toMatch(/^[0-9a-f]{40}$/);
    expect(posteriorId(SCOPE_A, 'length')).toBe(id);
    const routes: ReplyRoute[] = ['quick', 'thoughtful', 'web', 'untriaged'];
    expect(new Set(routes.map((route) => posteriorId({ ...SCOPE_A, route }, 'length'))).size).toBe(4);
    expect(posteriorId(SCOPE_A, 'register')).not.toBe(id);
  });
});
