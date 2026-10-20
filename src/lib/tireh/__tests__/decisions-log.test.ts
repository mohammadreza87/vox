/** S09: the content-free decision log (stores, sink, row building, gateway canary). No network. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { DecisionService } from '../../adaptive/decisions';
import {
  createDecisionLogSink, createFileDecisionLogStore, FirestoreDecisionLogStore, InMemoryDecisionLogStore, recordTriageDecision,
  DECISION_LOG_COLLECTION, type DecisionLogStore, type NewDecisionLogRow, type TriageDecisionEvent,
} from '../decisions/log';
import { scriptLanguage } from '../decisions/language';
import { ServiceDecider } from '../decisions/service-decider';
import { triageQuestions, type Triage } from '../triage';
import { GAMEEND_CHAT, groupText, privateText, TG, testOrgConfig } from './fixtures';
import { collectingSink, decisionsGateway, pred, scriptedProvider, v1Answers } from './decisions-fixtures';

const DAY = 86_400_000;
const NOW = new Date('2026-10-20T12:00:00Z');
const row = (at: Date, extra: Partial<NewDecisionLogRow> = {}): NewDecisionLogRow => ({
  questionSetVersion: 'v1', names: ['effort', 'memorable'],
  answers: [{ name: 'effort', type: 'choice', choice: 'quick', confidence: 0.8, probabilities: [{ value: 'quick', probability: 0.8 }, { value: 'thoughtful', probability: 0.2 }] }, { name: 'memorable', type: 'predicate', probability: 0.3 }],
  outcome: 'answered', elapsedMs: 312, inputTokens: 90, routeTaken: 'quick', personaId: 'aria', chatKind: 'private', language: 'en', at, ...extra,
});

/** A minimal Firestore fake: one collection, where/orderBy/limit, batch delete. Dates stored as Timestamp-like values. */
function fakeFirestore() {
  class Ts { constructor(readonly ms: number) {} toDate() { return new Date(this.ms); } }
  const docs = new Map<string, Record<string, unknown>>();
  let next = 0;
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
  const db = {
    collection: (name: string) => {
      collectionNames.push(name);
      return { ...query([]), doc: () => { const id = `d${next++}`; return { set: async (data: Record<string, unknown>) => { docs.set(id, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)]))); } }; } };
    },
    batch: () => { const refs: Array<{ id: string }> = []; return { delete: (ref: { id: string }) => refs.push(ref), commit: async () => { refs.forEach((r) => docs.delete(r.id)); } }; },
  };
  return { db: db as unknown as Firestore, docs, collectionNames, rawPut: (id: string, data: Record<string, unknown>) => docs.set(id, data) };
}

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const tempFile = () => { const dir = mkdtempSync(join(tmpdir(), 'declog-')); dirs.push(dir); return join(dir, 'decision-log-v1.jsonl'); };

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
    expect(stored.at.toISOString()).toBe(new Date(NOW.getTime() - DAY).toISOString());
    expect(stored).toEqual({ ...row(new Date(NOW.getTime() - DAY)), id: expect.any(String) });
  });

  it('filters since <= at < until, sorts ascending and applies limit', async () => {
    const store = make();
    for (const d of [5, 1, 3, 2, 4]) await store.append(row(new Date(NOW.getTime() - d * DAY), { elapsedMs: d }));
    const since = new Date(NOW.getTime() - 4 * DAY), until = new Date(NOW.getTime() - DAY);
    expect((await store.list({ since, until })).map((r) => r.elapsedMs)).toEqual([4, 3, 2]);
    expect((await store.list({ limit: 2 })).map((r) => r.elapsedMs)).toEqual([5, 4]);
  });

  it('sweeps rows older than 90 days', async () => {
    const store = make();
    await store.append(row(new Date(NOW.getTime() - 91 * DAY), { elapsedMs: 91 }));
    await store.append(row(new Date(NOW.getTime() - 89 * DAY), { elapsedMs: 89 }));
    expect(await store.sweep(NOW)).toBe(1);
    expect((await store.list()).map((r) => r.elapsedMs)).toEqual([89]);
  });
});

describe('file decision-log store', () => {
  it('creates the file with mode 0600, survives a reopen and skips a corrupt line', async () => {
    const path = tempFile();
    await createFileDecisionLogStore(path).append(row(NOW));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    appendFileSync(path, '{not json\n{"id":"x","text":"CANARY"}\n');
    const reopened = createFileDecisionLogStore(path);
    await reopened.append(row(new Date(NOW.getTime() + 1000)));
    expect(await reopened.list()).toHaveLength(2);
    expect(await reopened.sweep(new Date(NOW.getTime() + 100 * DAY))).toBe(2);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('Firestore decision-log store', () => {
  it('uses the vox_decision_log collection and drops invalid stored rows', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreDecisionLogStore(fake.db);
    await store.append(row(NOW, { inputTokens: undefined }));
    fake.rawPut('bad', { ...row(NOW), text: 'CANARY' });
    expect(fake.collectionNames).toContain(DECISION_LOG_COLLECTION);
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('inputTokens');
  });
});

describe('decision-log sink', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('does nothing while TIREH_DECISION_LOG is unset', async () => {
    vi.stubEnv('TIREH_DECISION_LOG', undefined);
    const store = new InMemoryDecisionLogStore();
    const append = vi.spyOn(store, 'append');
    createDecisionLogSink(store).record(row(NOW));
    await flush();
    expect(append).not.toHaveBeenCalled();
  });

  it('appends a valid row when TIREH_DECISION_LOG=1', async () => {
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    const store = new InMemoryDecisionLogStore();
    createDecisionLogSink(store, { now: () => NOW }).record(row(NOW));
    await flush();
    expect(store.rows).toHaveLength(1);
  });

  it.each([
    ['an extra text key', { ...row(NOW), text: 'CANARY_TEXT' }],
    ['a choice value with a space', row(NOW, { answers: [{ name: 'effort', type: 'choice', choice: 'quick reply', confidence: 0.8 }] })],
    ['an answer not in names', row(NOW, { answers: [{ name: 'other', type: 'predicate', probability: 0.5 }] })],
    ['a probability of 2', row(NOW, { answers: [{ name: 'memorable', type: 'predicate', probability: 2 }] })],
  ])('drops a row with %s and warns with a fixed code', async (_label, bad) => {
    const store = new InMemoryDecisionLogStore();
    const warn = vi.fn();
    createDecisionLogSink(store, { enabled: () => true, warn }).record(bad as NewDecisionLogRow);
    await flush();
    expect(store.rows).toHaveLength(0);
    expect(warn.mock.calls).toEqual([['decision_log_invalid_row']]);
  });

  it('a rejecting append warns and record() does not throw', async () => {
    const store = new InMemoryDecisionLogStore();
    vi.spyOn(store, 'append').mockRejectedValue(new Error('CANARY_ERROR'));
    const warn = vi.fn();
    expect(() => createDecisionLogSink(store, { enabled: () => true, warn, sweepEveryMs: Infinity }).record(row(NOW))).not.toThrow();
    await flush();
    expect(warn.mock.calls).toEqual([['decision_log_append_failed']]);
  });

  it('a throwing store never escapes record()', () => {
    const store = { append: () => { throw new Error('sync'); }, list: async () => [], sweep: () => { throw new Error('sync'); } } as unknown as DecisionLogStore;
    expect(() => createDecisionLogSink(store, { enabled: () => true }).record(row(NOW))).not.toThrow();
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
    await flush();
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(sweep.mock.calls[0]).toEqual([NOW, 90]);
  });
});

describe('recordTriageDecision', () => {
  const questions = triageQuestions(testOrgConfig().personas[0], false, undefined, 'v1');
  const triage = (extra: Partial<Triage> = {}): Triage => ({ effort: 'thoughtful', needsWeb: false, memorable: false, wantsVoice: false, ...extra });
  const event = (extra: Partial<TriageDecisionEvent> = {}): TriageDecisionEvent => ({
    questions, answers: v1Answers(), elapsedMs: 123.4, triage: triage(), personaId: 'aria', chatKind: 'private', space: 'work',
    webSearch: false, fastLlm: true, latestText: 'CANARY_TEXT_77 hello', at: NOW, ...extra,
  });
  const record = (e: TriageDecisionEvent) => { const sink = collectingSink(); recordTriageDecision(sink, e); return sink.rows[0]; };
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    ['null triage', { triage: null }, 'untriaged'],
    ['work + webSearch + needsWeb', { triage: triage({ needsWeb: true, effort: 'quick' }), webSearch: true }, 'web'],
    ['personal + needsWeb', { triage: triage({ needsWeb: true }), webSearch: true, space: 'personal' as const }, 'thoughtful'],
    ['quick + fastLlm', { triage: triage({ effort: 'quick' }) }, 'quick'],
    ['quick without fastLlm', { triage: triage({ effort: 'quick' }), fastLlm: false }, 'thoughtful'],
  ] as Array<[string, Partial<TriageDecisionEvent>, string]>)('routeTaken for %s', (_label, extra, expected) => {
    expect(record(event(extra)).routeTaken).toBe(expected);
  });

  it('sets the question-set version from the questions sent and the flag', () => {
    expect(record(event()).questionSetVersion).toBe('v1');
    const v2 = triageQuestions(testOrgConfig().personas[0], false, undefined, 'v2');
    expect(record(event({ questions: v2 })).questionSetVersion).toBe('v2');
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2-live');
    expect(record(event({ questions: v2 })).questionSetVersion).toBe('v2-live');
  });

  it('keeps only asked questions and catalogue values, and never the text', () => {
    const v2 = triageQuestions(testOrgConfig().personas[0], false, undefined, 'v2');
    const r = record(event({ questions: v2, answers: { ...v1Answers(), stray: pred(0.5), route: { type: 'choice', choice: 'not in catalogue', confidence: 0.9 },
      context_need: { type: 'choice', choice: 'none', confidence: 0.6, probabilities: [{ value: 'none', probability: 0.6 }, { value: 'CANARY value', probability: 0.4 }] } } }));
    expect(r.answers.map((a) => a.name)).toEqual(['effort', 'live_info', 'memorable', 'wants_voice', 'context_need']);
    expect(r.answers.find((a) => a.name === 'context_need')).toEqual({ name: 'context_need', type: 'choice', choice: 'none', confidence: 0.6, probabilities: [{ value: 'none', probability: 0.6 }] });
    expect(r).toMatchObject({ outcome: 'answered', elapsedMs: 123, language: 'en' });
    expect(r).not.toHaveProperty('unknownReason');
    expect(JSON.stringify(r)).not.toContain('CANARY');
  });

  it('null answers give unknown/threw and {} gives unknown/empty; detail reason wins', () => {
    expect(record(event({ answers: null, triage: null }))).toMatchObject({ outcome: 'unknown', unknownReason: 'threw', answers: [] });
    expect(record(event({ answers: {}, triage: null }))).toMatchObject({ outcome: 'unknown', unknownReason: 'empty' });
    expect(record(event({ answers: {}, triage: null, detail: { answers: {}, elapsedMs: 9, outcome: 'unknown', unknownReason: 'timeout' } }))).toMatchObject({ unknownReason: 'timeout' });
  });

  it('never throws, even when the sink does', () => {
    expect(() => recordTriageDecision({ record: () => { throw new Error('x'); } }, event())).not.toThrow();
  });
});

describe('scriptLanguage', () => {
  it.each([
    ['سلام، فردا جلسه داریم', 'fa'],
    ['see you tomorrow', 'en'],
    ['سلام meeting at 5', 'mixed'],
    ['123 !!', 'unknown'],
    ['۱۲۳ ٤٥', 'unknown'],
  ])('%s gives %s', (text, expected) => { expect(scriptLanguage(text)).toBe(expected); });
});

describe('gateway decision log', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('a private turn logs exactly one content-free row', async () => {
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    const sink = collectingSink();
    const h = decisionsGateway({ decisionLog: sink });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'CANARY_LOG_5521 please plan the launch'))).toBe('replied');
    expect(sink.rows).toHaveLength(1);
    const json = JSON.stringify(sink.rows[0]);
    for (const forbidden of ['CANARY_LOG_5521', 'launch', 'Aria', 'Product Lead', 'reza', 'Reza', String(TG.reza)]) expect(json).not.toContain(forbidden);
    expect(sink.rows[0]).toMatchObject({ chatKind: 'private', outcome: 'answered', personaId: 'aria', questionSetVersion: 'v1', language: 'en' });
  });

  it('a group turn logs chatKind group', async () => {
    const sink = collectingSink();
    const h = decisionsGateway({ decisionLog: sink });
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, '@hoor_aria_bot launch date?'));
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0].chatKind).toBe('group');
    expect(JSON.stringify(sink.rows[0])).not.toContain('launch');
    expect(JSON.stringify(sink.rows[0])).not.toContain(String(GAMEEND_CHAT));
  });

  it('a throwing decider logs unknown/threw/untriaged and still reports triage_failed', async () => {
    const sink = collectingSink();
    const h = decisionsGateway({ decisionLog: sink, decider: { decide: async () => { throw new Error('CANARY_DECIDER'); } } });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]).toMatchObject({ outcome: 'unknown', unknownReason: 'threw', routeTaken: 'untriaged', answers: [] });
    // The 'triage_failed' diagnostic is still emitted (stage triage, full reply path).
    expect(h.logger.warn.mock.calls).toContainEqual([{ type: 'telegram_ingress', stage: 'triage', reason: 'operation_failed', outcome: 'full_reply_path' }]);
    expect(JSON.stringify(sink.rows[0])).not.toContain('CANARY_DECIDER');
  });

  it('a throwing sink, or no sink, still delivers the reply', async () => {
    const throwing = decisionsGateway({ decisionLog: { record: () => { throw new Error('sink'); } } });
    expect(await throwing.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    expect(throwing.bot.sent.some((s) => s.method === 'sendMessage')).toBe(true);
    const none = decisionsGateway();
    expect(await none.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    expect(none.bot.sent.some((s) => s.method === 'sendMessage')).toBe(true);
  });

  it('with a ServiceDecider the row carries inputTokens and the service elapsedMs', async () => {
    const sink = collectingSink();
    let clock = 1_000;
    const { provider } = scriptedProvider({ effort: { choice: 'thoughtful', confidence: 0.9 }, live_info: { probability: 0 }, memorable: { probability: 0 }, wants_voice: { probability: 0 } });
    const decider = new ServiceDecider(new DecisionService(provider, () => (clock += 37)));
    const detailed = vi.spyOn(decider, 'decideDetailed');
    const h = decisionsGateway({ decisionLog: sink, decider });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    const detail = await detailed.mock.results[0].value;
    expect(detail.elapsedMs).toBeGreaterThan(0);
    expect(sink.rows[0]).toMatchObject({ inputTokens: 42, elapsedMs: Math.round(detail.elapsedMs), outcome: 'answered' });
  });
});
