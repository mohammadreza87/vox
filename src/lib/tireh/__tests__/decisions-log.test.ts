/** S09: the content-free decision log: schema, row builder, stores and sink. No network. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, statSync } from 'fs';
import os from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import {
  createDecisionLogSink, createFileDecisionLogStore, decisionLogRow, FirestoreDecisionLogStore, InMemoryDecisionLogStore,
  DECISION_LOG_COLLECTION, DECISION_LOG_RETENTION_DAYS, newDecisionLogRowSchema,
  type DecisionLogRowInput, type DecisionLogStore, type NewDecisionLogRow,
} from '../decisions/log';
import { SKILL_SELECTED } from '../decisions/catalog';
import { scriptLanguage } from '../decisions/language';
import { triageQuestions, type Triage } from '../triage';
import type { Persona } from '../types';
import { testOrgConfig } from './fixtures';
import { pred, v1Answers } from './decisions-fixtures';

const DAY = 86_400_000;
const NOW = new Date('2026-10-20T12:00:00Z');
const row = (at: Date, extra: Partial<NewDecisionLogRow> = {}): NewDecisionLogRow => ({
  questionSetVersion: 'v1', names: ['effort', 'memorable'],
  answers: [{ name: 'effort', type: 'choice', choice: 'quick', confidence: 0.8, probabilities: [{ value: 'quick', probability: 0.8 }, { value: 'thoughtful', probability: 0.2 }] }, { name: 'memorable', type: 'predicate', probability: 0.3 }],
  outcome: 'answered', elapsedMs: 312, inputTokens: 90, routeTaken: 'quick', personaId: 'aria', chatKind: 'private', language: 'en', at, ...extra,
});

/** A minimal Firestore fake: one collection, doc(id).set, where/orderBy/limit/get, batch delete. Dates come back Timestamp-like. */
function fakeFirestore() {
  class Ts { constructor(readonly ms: number) {} toDate() { return new Date(this.ms); } }
  const docs = new Map<string, Record<string, unknown>>();
  const encode = (v: unknown) => (v instanceof Date ? new Ts(v.getTime()) : v);
  const ms = (v: unknown) => (v instanceof Ts ? v.ms : v instanceof Date ? v.getTime() : NaN);
  type Filter = { field: string; op: string; value: unknown };
  const query = (filters: Filter[], order?: string, max?: number): Record<string, unknown> => ({
    where: (field: string, op: string, value: unknown) => query([...filters, { field, op, value }], order, max),
    orderBy: (field: string) => query(filters, field, max),
    limit: (n: number) => query(filters, order, n),
    get: async () => {
      let entries = [...docs.entries()].filter(([, d]) => filters.every((f) => {
        const a = ms(d[f.field]), b = ms(f.value);
        return f.op === '<' ? a < b : f.op === '>=' ? a >= b : false;
      }));
      if (order) entries = entries.sort(([, a], [, b]) => ms(a[order]) - ms(b[order]));
      if (max !== undefined) entries = entries.slice(0, max);
      const out = entries.map(([id, d]) => ({ id, data: () => ({ ...d }), ref: { id } }));
      return { docs: out, empty: out.length === 0, size: out.length };
    },
  });
  const collectionNames: string[] = [];
  const commits: number[] = [];
  const db = {
    collection: (name: string) => {
      collectionNames.push(name);
      return { ...query([]), doc: (id: string) => ({ set: async (data: Record<string, unknown>) => { docs.set(id, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)]))); } }) };
    },
    batch: () => { const refs: Array<{ id: string }> = []; return { delete: (ref: { id: string }) => refs.push(ref), commit: async () => { commits.push(refs.length); refs.forEach((r) => docs.delete(r.id)); } }; },
  };
  return { db: db as unknown as Firestore, docs, collectionNames, commits, rawPut: (id: string, data: Record<string, unknown>) => docs.set(id, data) };
}

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const tempFile = () => { const dir = mkdtempSync(join(os.tmpdir(), 'vox-decision-log-')); dirs.push(dir); return join(dir, 'decision-log-v1.jsonl'); };

describe('newDecisionLogRowSchema', () => {
  it('accepts a valid row', () => {
    expect(newDecisionLogRowSchema.safeParse(row(NOW)).success).toBe(true);
  });

  it.each([
    ['an extra text key', { ...row(NOW), text: 'CANARY_TEXT' }],
    ['an unknown name', row(NOW, { names: ['effort', 'mood_of_member'] })],
    ['an unknown answer name', row(NOW, { answers: [{ name: 'other', type: 'predicate', probability: 0.5 }] })],
    ['a choice outside the catalogue', row(NOW, { answers: [{ name: 'effort', type: 'choice', choice: 'quick reply', confidence: 0.8 }] })],
    ['a skill id as the choice', row(NOW, { names: ['skill'], answers: [{ name: 'skill', type: 'choice', choice: 'x.alpha', confidence: 0.8 }] })],
    ['a probabilities value outside the catalogue', row(NOW, { answers: [{ name: 'effort', type: 'choice', choice: 'quick', confidence: 0.8, probabilities: [{ value: 'CANARY', probability: 0.2 }] }] })],
    ['a probability > 1', row(NOW, { answers: [{ name: 'memorable', type: 'predicate', probability: 1.5 }] })],
    ['a negative elapsedMs', row(NOW, { elapsedMs: -1 })],
    ['a fractional elapsedMs', row(NOW, { elapsedMs: 1.5 })],
    ['a personaId with a space', row(NOW, { personaId: 'aria persona' })],
    ['an unknown unknownReason', row(NOW, { outcome: 'unknown', unknownReason: 'CANARY reason' })],
    ['more than 32 names', row(NOW, { names: Array.from({ length: 33 }, () => 'effort') })],
  ])('rejects %s', (_label, bad) => {
    expect(newDecisionLogRowSchema.safeParse(bad).success).toBe(false);
  });
});

describe('decisionLogRow', () => {
  const canaryPersona = (): Persona => ({ ...testOrgConfig().personas.find((p) => p.id === 'aria')!, name: 'CANARY_PERSONA', role: 'CANARY_ROLE' });
  const routable = [{ id: 'x.alpha', title: 'Alpha', whenToUse: 'Alpha.' }, { id: 'x.beta', title: 'Beta', whenToUse: 'Beta.' }];
  const triage = (extra: Partial<Triage> = {}): Triage => ({ effort: 'thoughtful', needsWeb: false, memorable: false, wantsVoice: false, ...extra });
  const input = (extra: Partial<DecisionLogRowInput> = {}): DecisionLogRowInput => ({
    set: 'v1', questions: triageQuestions(canaryPersona(), false, routable, 'v1'), answers: v1Answers(), triage: triage(), elapsedMs: 123.4,
    webSearchAvailable: false, fastModel: true, personaId: 'aria', chatKind: 'private', latestMessage: 'CANARY_MSG_7f3 hello there', at: NOW, ...extra,
  });

  it('never carries the message, persona name or skill id', () => {
    const r = decisionLogRow(input({ answers: v1Answers({ skill: { type: 'choice', choice: 'x.alpha', confidence: 0.9, probabilities: [{ value: 'x.alpha', probability: 0.9 }, { value: 'x.beta', probability: 0.05 }, { value: 'none', probability: 0.05 }] } }) }))!;
    expect(r).not.toBeNull();
    const json = JSON.stringify(r);
    for (const canary of ['CANARY_MSG_7f3', 'CANARY_PERSONA', 'CANARY_ROLE', 'x.alpha', 'x.beta', 'hello']) expect(json).not.toContain(canary);
    expect(r.answers.find((a) => a.name === 'skill')).toEqual({ name: 'skill', type: 'choice', choice: SKILL_SELECTED, confidence: 0.9 });
    expect(r).toMatchObject({ questionSetVersion: 'v1', names: ['effort', 'live_info', 'memorable', 'wants_voice', 'skill'], outcome: 'answered', elapsedMs: 123, language: 'en', personaId: 'aria', chatKind: 'private', at: NOW });
    expect(newDecisionLogRowSchema.safeParse(r).success).toBe(true);
  });

  it('a skill answer of none stays none', () => {
    const r = decisionLogRow(input({ answers: v1Answers({ skill: { type: 'choice', choice: 'none', confidence: 0.7 } }) }))!;
    expect(r.answers.find((a) => a.name === 'skill')).toEqual({ name: 'skill', type: 'choice', choice: 'none', confidence: 0.7 });
  });

  it('drops choices outside the catalogue and non-catalogue probabilities', () => {
    const questions = triageQuestions(canaryPersona(), false, undefined, 'v2');
    const r = decisionLogRow(input({ set: 'v2', questions, answers: { ...v1Answers(), stray: pred(0.5), route: { type: 'choice', choice: 'banter', confidence: 0.9 },
      context_need: { type: 'choice', choice: 'none', confidence: 0.6, probabilities: [{ value: 'none', probability: 0.6 }, { value: 'CANARY value', probability: 0.4 }] } } }))!;
    expect(r.answers.map((a) => a.name)).toEqual(['effort', 'live_info', 'memorable', 'wants_voice', 'context_need']);
    expect(r.answers.find((a) => a.name === 'context_need')).toEqual({ name: 'context_need', type: 'choice', choice: 'none', confidence: 0.6, probabilities: [{ value: 'none', probability: 0.6 }] });
    expect(r.questionSetVersion).toBe('v2');
    expect(JSON.stringify(r)).not.toContain('CANARY');
  });

  it.each([
    ['triage null', { triage: null }, 'untriaged'],
    ['needsWeb with webSearchAvailable', { triage: triage({ needsWeb: true, effort: 'quick' }), webSearchAvailable: true }, 'web'],
    ['quick with fastModel', { triage: triage({ effort: 'quick' }) }, 'quick'],
    ['quick without fastModel', { triage: triage({ effort: 'quick' }), fastModel: false }, 'thoughtful'],
    ['needsWeb without webSearchAvailable', { triage: triage({ needsWeb: true }) }, 'thoughtful'],
  ] as Array<[string, Partial<DecisionLogRowInput>, string]>)('routeTaken for %s', (_label, extra, expected) => {
    expect(decisionLogRow(input(extra))!.routeTaken).toBe(expected);
  });

  it('outcome and unknownReason: failed, detail unknown timeout, and empty answers', () => {
    expect(decisionLogRow(input({ failed: true, answers: undefined, triage: null }))).toMatchObject({ outcome: 'unknown', unknownReason: 'decider_error', answers: [], routeTaken: 'untriaged' });
    expect(decisionLogRow(input({ answers: {}, triage: null, detail: { answers: {}, elapsedMs: 2001.6, outcome: 'unknown', unknownReason: 'timeout' } })))
      .toMatchObject({ outcome: 'unknown', unknownReason: 'timeout', elapsedMs: 2002 });
    expect(decisionLogRow(input({ answers: {}, triage: null }))).toMatchObject({ outcome: 'unknown', unknownReason: 'no_answers' });
    const answered = decisionLogRow(input({ detail: { answers: v1Answers(), elapsedMs: 40, inputTokens: 77, outcome: 'answered' } }))!;
    expect(answered).toMatchObject({ outcome: 'answered', elapsedMs: 40, inputTokens: 77 });
    expect(answered).not.toHaveProperty('unknownReason');
  });

  it('returns null when the row cannot validate', () => {
    expect(decisionLogRow(input({ personaId: 'not a valid id' }))).toBeNull();
  });
});

describe('scriptLanguage', () => {
  it.each([
    ['سلام خوبی', 'fa'],
    ['hello there', 'en'],
    ['سلام hello friend', 'mixed'],
    // Exactly 80% Latin letters (16 of 20): the >= 80% rule makes this 'en'.
    ['سلام hello there friend', 'en'],
    ['123 !!', 'unknown'],
    ['۱۲۳ ٤٥', 'unknown'],
  ])('%s gives %s', (text, expected) => { expect(scriptLanguage(text)).toBe(expected); });
});

describe.each([
  ['in-memory', () => new InMemoryDecisionLogStore() as DecisionLogStore],
  ['file', () => createFileDecisionLogStore(tempFile())],
  ['firestore', () => new FirestoreDecisionLogStore(fakeFirestore().db)],
])('%s decision-log store', (_name, make) => {
  it('round-trips `at` as a Date', async () => {
    const store = make();
    await store.append(row(new Date(NOW.getTime() - DAY)));
    const [stored] = await store.list();
    expect(stored.at).toBeInstanceOf(Date);
    expect(stored).toEqual({ ...row(new Date(NOW.getTime() - DAY)), id: expect.any(String) });
  });

  it('filters since <= at < until, sorts ascending and applies limit', async () => {
    const store = make();
    for (const d of [5, 1, 3, 2, 4]) await store.append(row(new Date(NOW.getTime() - d * DAY), { elapsedMs: d }));
    const since = new Date(NOW.getTime() - 4 * DAY), until = new Date(NOW.getTime() - DAY);
    expect((await store.list({ since, until })).map((r) => r.elapsedMs)).toEqual([4, 3, 2]);
    expect((await store.list({ limit: 2 })).map((r) => r.elapsedMs)).toEqual([5, 4]);
  });

  it('sweep removes rows strictly older than 90 days, keeps the row at the cutoff and returns the count', async () => {
    const store = make();
    const cutoff = NOW.getTime() - DECISION_LOG_RETENTION_DAYS * DAY;
    await store.append(row(new Date(cutoff - 1), { elapsedMs: 1 }));
    await store.append(row(new Date(cutoff - DAY), { elapsedMs: 2 }));
    await store.append(row(new Date(cutoff), { elapsedMs: 3 }));
    await store.append(row(new Date(NOW.getTime() - DAY), { elapsedMs: 4 }));
    expect(await store.sweep(NOW)).toBe(2);
    expect((await store.list()).map((r) => r.elapsedMs)).toEqual([3, 4]);
  });
});

describe('file decision-log store', () => {
  it('creates the file with mode 0600, skips a corrupt line, and keeps 0600 after a sweep', async () => {
    const path = tempFile();
    await createFileDecisionLogStore(path).append(row(NOW));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    appendFileSync(path, '{not json\n{"id":"x","text":"CANARY"}\n');
    const reopened = createFileDecisionLogStore(path);
    await reopened.append(row(new Date(NOW.getTime() + 1000)));
    expect(await reopened.list()).toHaveLength(2);
    expect(await reopened.sweep(new Date(NOW.getTime() + 100 * DAY))).toBe(2);
    expect(await reopened.list()).toHaveLength(0);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('Firestore decision-log store', () => {
  it('writes to vox_decision_log with `at` as a Date and drops invalid stored rows', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreDecisionLogStore(fake.db);
    await store.append(row(NOW, { inputTokens: undefined }));
    fake.rawPut('bad', { ...row(NOW), text: 'CANARY' });
    expect(fake.collectionNames.every((n) => n === DECISION_LOG_COLLECTION)).toBe(true);
    expect(DECISION_LOG_COLLECTION).toBe('vox_decision_log');
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('inputTokens');
  });

  it('sweep deletes in batches of 400', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreDecisionLogStore(fake.db);
    for (let i = 0; i < 405; i++) fake.rawPut(`old${i}`, { ...row(NOW), at: new Date(NOW.getTime() - 100 * DAY) });
    fake.rawPut('new', { ...row(NOW) });
    expect(await store.sweep(NOW)).toBe(405);
    expect(fake.commits).toEqual([400, 5]);
    expect(fake.docs.size).toBe(1);
  });
});

describe('createDecisionLogSink', () => {
  it('with enabled() false nothing is appended', async () => {
    const store = new InMemoryDecisionLogStore();
    const sink = createDecisionLogSink(store, { enabled: () => false });
    sink.record(row(NOW));
    await sink.flush();
    expect(store.rows).toHaveLength(0);
  });

  it('the default enabled() reads TIREH_DECISION_LOG on every record()', async () => {
    const store = new InMemoryDecisionLogStore();
    const sink = createDecisionLogSink(store, { now: () => NOW });
    vi.stubEnv('TIREH_DECISION_LOG', '');
    sink.record(row(NOW));
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    sink.record(row(NOW));
    await sink.flush();
    expect(store.rows).toHaveLength(1);
  });

  it('an invalid row gives onError(invalid_row) and is not appended', async () => {
    const store = new InMemoryDecisionLogStore();
    const onError = vi.fn();
    const sink = createDecisionLogSink(store, { enabled: () => true, onError });
    sink.record({ ...row(NOW), text: 'CANARY_TEXT' } as NewDecisionLogRow);
    await sink.flush();
    expect(store.rows).toHaveLength(0);
    expect(onError.mock.calls).toEqual([['invalid_row']]);
  });

  it('a rejected append gives onError(append_failed) and record() does not throw', async () => {
    const store = new InMemoryDecisionLogStore();
    vi.spyOn(store, 'append').mockRejectedValue(new Error('CANARY_ERROR'));
    const onError = vi.fn();
    const sink = createDecisionLogSink(store, { enabled: () => true, onError, sweepEveryMs: Infinity });
    expect(() => sink.record(row(NOW))).not.toThrow();
    await sink.flush();
    expect(onError.mock.calls).toEqual([['append_failed']]);
  });

  it('a synchronously throwing store or onError never escapes record()', async () => {
    const store = { append: () => { throw new Error('sync'); }, list: async () => [], sweep: () => { throw new Error('sync'); } } as unknown as DecisionLogStore;
    const sink = createDecisionLogSink(store, { enabled: () => true, onError: () => { throw new Error('handler'); } });
    expect(() => sink.record(row(NOW))).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it('sweeps at most once per sweepEveryMs', async () => {
    const store = new InMemoryDecisionLogStore();
    const sweep = vi.spyOn(store, 'sweep');
    let now = NOW.getTime();
    const sink = createDecisionLogSink(store, { enabled: () => true, now: () => new Date(now), sweepEveryMs: 1000 });
    sink.record(row(NOW));
    now += 500; sink.record(row(NOW));
    now += 499; sink.record(row(NOW));
    now += 1; sink.record(row(NOW));
    await sink.flush();
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(sweep.mock.calls[0]).toEqual([NOW, 90]);
  });

  it('more than maxPending appends in flight gives dropped', async () => {
    const store = new InMemoryDecisionLogStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(store, 'append').mockImplementation(() => gate);
    const onError = vi.fn();
    const sink = createDecisionLogSink(store, { enabled: () => true, onError, maxPending: 2, sweepEveryMs: Infinity });
    sink.record(row(NOW)); sink.record(row(NOW)); sink.record(row(NOW));
    expect(onError.mock.calls).toEqual([['dropped']]);
    release();
    await sink.flush();
    sink.record(row(NOW));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
