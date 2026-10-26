/**
 * Hardening H1 (F136, VF-S14-low-eval-retention): FirestoreReplyStyleStore.listEval
 * combines personaId with since/until in one query ordered by at, so a persona
 * with more rows than the fetch cap still gets its window (the oldest rows of
 * it, never an arbitrary subset); and startReplyStyleRetentionSweep schedules
 * sweep() now and daily, best effort, reporting a failure through onError.
 * Local Firestore fake; no Firestore, no network. The sweep helper is not wired
 * (S14 is unwired; the retention period is product decision (f)).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARMS, EVAL_RETENTION_MS, POLICY_VERSION, subjectKey, type ReplyStyleEvalRow } from './procedural';
import { DEFAULT_REPLY_STYLE_COLLECTIONS, FirestoreReplyStyleStore, InMemoryReplyStyleStore, startReplyStyleRetentionSweep } from './procedural-store';

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const FETCH_CAP = 10_000;

function evalRow(id: string, personaId: string, at: number): ReplyStyleEvalRow {
  return {
    schemaVersion: 1, id, policyVersion: POLICY_VERSION,
    context: { subject: subjectKey('person-a'), personaId, space: 'work', route: 'quick', chatKind: 'private', pinned: {} },
    armChosen: { length: 'brief' }, propensity: { length: 0.5 }, jointPropensity: 0.5,
    unchosenArms: { length: ARMS.length.filter((a) => a !== 'brief') },
    reward: null, rewardKinds: [], at, expiresAt: at + EVAL_RETENTION_MS,
  };
}

type Filter = [string, string, unknown];

/** collection/where(==,>=,<=)/orderBy/limit/get over plain rows; records every query it runs. */
function fakeFirestore(rows: ReplyStyleEvalRow[]) {
  const queries: Array<{ collection: string; filters: Filter[]; orderBy: string | null; limit: number }> = [];
  const read = (data: unknown, path: string) => path.split('.')
    .reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), data);
  const query = (name: string, filters: Filter[], order: string | null, max: number): Record<string, unknown> => ({
    where: (f: string, op: string, v: unknown) => query(name, [...filters, [f, op, v]], order, max),
    orderBy: (f: string) => query(name, filters, f, max),
    limit: (n: number) => query(name, filters, order, n),
    get: async () => {
      queries.push({ collection: name, filters, orderBy: order, limit: max });
      let docs = rows.filter((row) => filters.every(([f, op, v]) => {
        const x = read(row, f);
        if (op === '==') return x === v;
        if (typeof x !== 'number' || typeof v !== 'number') return false;
        return op === '<=' ? x <= v : op === '>=' ? x >= v : false;
      }));
      // Without orderBy, Firestore returns documents in document-id order.
      docs = order
        ? [...docs].sort((a, b) => (read(a, order) as number) - (read(b, order) as number))
        : [...docs].sort((a, b) => a.id.localeCompare(b.id));
      const out = docs.slice(0, max).map((row) => ({ id: row.id, data: () => structuredClone(row) }));
      return { docs: out, empty: out.length === 0, size: out.length };
    },
  });
  const db = { collection: (name: string) => query(name, [], null, Number.POSITIVE_INFINITY) } as unknown as Firestore;
  return { db, queries };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('FirestoreReplyStyleStore.listEval (H1, F136)', () => {
  it('one query carries personaId, since and until together, ordered by at and capped', async () => {
    const { db, queries } = fakeFirestore([evalRow('exp-1', 'p1', T0)]);
    const store = new FirestoreReplyStyleStore(db);
    await store.listEval({ personaId: 'p1', since: T0 - 10, until: T0 + 10 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual({
      collection: DEFAULT_REPLY_STYLE_COLLECTIONS.evals,
      filters: [['context.personaId', '==', 'p1'], ['at', '>=', T0 - 10], ['at', '<=', T0 + 10]],
      orderBy: 'at',
      limit: FETCH_CAP,
    });
  });

  it('a persona with more rows than the fetch cap still gets the requested window', async () => {
    const rows = Array.from({ length: FETCH_CAP + 1 }, (_, i) => evalRow(`exp-${String(i).padStart(5, '0')}`, 'p1', T0 + i));
    rows.push(evalRow('exp-other', 'p2', T0 + FETCH_CAP));
    const { db } = fakeFirestore(rows);
    const store = new FirestoreReplyStyleStore(db);
    const newest = rows[FETCH_CAP];
    const got = await store.listEval({ personaId: 'p1', since: newest.at });
    expect(got.map((row) => row.id)).toEqual([newest.id]);
    const window = await store.listEval({ personaId: 'p1', since: T0 + 5, until: T0 + 7 });
    expect(window.map((row) => row.at)).toEqual([T0 + 5, T0 + 6, T0 + 7]);
  });

  it('a full page is the oldest rows of the window, in at order', async () => {
    const rows = Array.from({ length: FETCH_CAP + 5 }, (_, i) => evalRow(`exp-${String(i).padStart(5, '0')}`, 'p1', T0 + i));
    const { db } = fakeFirestore(rows);
    const got = await new FirestoreReplyStyleStore(db).listEval({ personaId: 'p1', limit: FETCH_CAP });
    expect(got).toHaveLength(FETCH_CAP);
    expect(got[0].at).toBe(T0);
    expect(got.at(-1)!.at).toBe(T0 + FETCH_CAP - 1);
  });

  it('firestore.indexes.json holds the (context.personaId ASC, at ASC) composite for vox_reply_style_eval', () => {
    const parsed = JSON.parse(readFileSync(join(process.cwd(), 'firestore.indexes.json'), 'utf8')) as { indexes: Array<{ collectionGroup: string; fields: unknown[] }> };
    expect(parsed.indexes.filter((index) => index.collectionGroup === 'vox_reply_style_eval').map((index) => index.fields)).toEqual([
      [{ fieldPath: 'context.personaId', order: 'ASCENDING' }, { fieldPath: 'at', order: 'ASCENDING' }],
    ]);
  });
});

describe('startReplyStyleRetentionSweep (H1, VF-S14-low-eval-retention)', () => {
  it('sweeps once now, then daily on the timer', async () => {
    vi.useFakeTimers();
    let clock = T0;
    const store = { sweep: vi.fn().mockResolvedValue({ posteriors: 0, evals: 0 }) };
    const handle = startReplyStyleRetentionSweep(store, { now: () => clock });
    await handle.flush();
    expect(store.sweep).toHaveBeenCalledTimes(1);
    expect(store.sweep).toHaveBeenLastCalledWith(T0);
    clock = T0 + 86_400_000;
    await vi.advanceTimersByTimeAsync(86_400_000 - 1);
    expect(store.sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await handle.flush();
    expect(store.sweep).toHaveBeenCalledTimes(2);
    expect(store.sweep).toHaveBeenLastCalledWith(T0 + 86_400_000);
    handle.stop();
    await vi.advanceTimersByTimeAsync(3 * 86_400_000);
    expect(store.sweep).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected sweep through onError('sweep_failed'), never throws, and keeps the schedule", async () => {
    vi.useFakeTimers();
    const store = { sweep: vi.fn().mockRejectedValue(new Error('unavailable')) };
    const onError = vi.fn();
    const handle = startReplyStyleRetentionSweep(store, { now: () => T0, everyMs: 1_000, onError });
    await handle.flush();
    expect(onError).toHaveBeenCalledWith('sweep_failed');
    await vi.advanceTimersByTimeAsync(1_000);
    await handle.flush();
    expect(store.sweep).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it('a throwing onError is ignored', async () => {
    const store = { sweep: vi.fn().mockRejectedValue(new Error('unavailable')) };
    const handle = startReplyStyleRetentionSweep(store, { onError: () => { throw new Error('callback down'); } });
    await expect(handle.flush()).resolves.toBeUndefined();
    handle.stop();
  });

  it('removes expired eval rows from a real store', async () => {
    const store = new InMemoryReplyStyleStore({ evals: [evalRow('exp-old', 'p1', T0), evalRow('exp-new', 'p1', T0 + EVAL_RETENTION_MS)] });
    const handle = startReplyStyleRetentionSweep(store, { now: () => T0 + EVAL_RETENTION_MS + 1 });
    await handle.flush();
    handle.stop();
    expect((await store.listEval()).map((row) => row.id)).toEqual(['exp-new']);
  });
});
