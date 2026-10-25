/**
 * QA r3 (code quality, wave A on main): the vox_decision_log 90-day retention ran only from the sink's record(),
 * which is wired (and checks the flag) only with TIREH_DECISION_LOG set. After a rollback, or with no triage
 * traffic, rows already stored never aged out. wireDecisionLog now runs the sweep at startup and daily whatever
 * the flag is, without creating the file or collection. Content-free rows only; no network, no Firestore.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import type { NewDecisionLogRow } from '../../tireh/decisions/log';
import { wireDecisionLog } from '../runtime';
import type { Studio } from '../service';

const DAY = 86_400_000;
const T0 = new Date('2026-07-01T12:00:00Z');
const row = (at: Date): NewDecisionLogRow => ({
  questionSetVersion: 'v1', names: ['effort', 'memorable'],
  answers: [{ name: 'effort', type: 'choice', choice: 'quick', confidence: 0.8, probabilities: [{ value: 'quick', probability: 0.8 }, { value: 'thoughtful', probability: 0.2 }] }, { name: 'memorable', type: 'predicate', probability: 0.3 }],
  outcome: 'answered', elapsedMs: 312, inputTokens: 90, routeTaken: 'quick', personaId: 'aria', chatKind: 'private', language: 'en', at,
});
const studioDeps = () => ({ deps: {} } as unknown as Pick<Studio, 'deps'>);
const lines = (path: string) => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempDir() { const d = mkdtempSync(join(os.tmpdir(), 'vox-decision-log-')); dirs.push(d); return d; }

describe('decision log retention after a TIREH_DECISION_LOG rollback (QA r3)', () => {
  it('rows written with the flag on are swept after a restart with it unset', async () => {
    const dir = tempDir(), path = join(dir, 'decision-log-v1.jsonl');
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    const on = studioDeps();
    const first = await wireDecisionLog(on, dir, null, { now: () => T0 });
    expect(on.deps.decisionLog).toBeDefined();
    on.deps.decisionLog!.record(row(T0));
    await (on.deps.decisionLog as unknown as { flush(): Promise<void> }).flush();
    await first.flush(); first.stop();
    expect(lines(path)).toHaveLength(1);

    // Rollback: restart with the flag unset, 91 days later.
    vi.stubEnv('TIREH_DECISION_LOG', '');
    const off = studioDeps();
    const later = new Date(T0.getTime() + 91 * DAY);
    const second = await wireDecisionLog(off, dir, null, { now: () => later });
    await second.flush(); second.stop();
    expect(off.deps.decisionLog).toBeUndefined();
    expect(lines(path)).toHaveLength(0);
  });

  it('rows inside the 90 days are kept, and the daily timer sweeps again', async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      const dir = tempDir(), path = join(dir, 'decision-log-v1.jsonl');
      vi.stubEnv('TIREH_DECISION_LOG', '1');
      const on = studioDeps();
      const first = await wireDecisionLog(on, dir, null);
      on.deps.decisionLog!.record(row(new Date()));
      await (on.deps.decisionLog as unknown as { flush(): Promise<void> }).flush();
      await first.flush(); first.stop();
      vi.stubEnv('TIREH_DECISION_LOG', '');
      vi.setSystemTime(new Date(T0.getTime() + 89 * DAY));
      const off = studioDeps();
      const sweeper = await wireDecisionLog(off, dir, null);
      await sweeper.flush();
      expect(lines(path)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2 * DAY);
      await sweeper.flush(); sweeper.stop();
      expect(lines(path)).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it('with the flag unset and nothing stored, no file is created', async () => {
    vi.stubEnv('TIREH_DECISION_LOG', '');
    const dir = tempDir();
    const sweeper = await wireDecisionLog(studioDeps(), dir, null, { now: () => T0 });
    await sweeper.flush(); sweeper.stop();
    expect(existsSync(join(dir, 'decision-log-v1.jsonl'))).toBe(false);
  });

  it('on Firestore with the flag unset, expired vox_decision_log rows are deleted and nothing is written', async () => {
    vi.stubEnv('TIREH_DECISION_LOG', '');
    const docs = new Map<string, { at: Date }>([['old', { at: new Date(T0.getTime() - 100 * DAY) }], ['new', { at: new Date(T0.getTime() - DAY) }]]);
    const sets: string[] = [];
    const query = (cutoff?: number, max = Infinity) => ({
      where: (_f: string, _op: string, value: Date) => query(value.getTime(), max),
      limit: (n: number) => query(cutoff, n),
      get: async () => {
        const out = [...docs.entries()].filter(([, d]) => cutoff === undefined || d.at.getTime() < cutoff).slice(0, max).map(([id]) => ({ id, ref: { id } }));
        return { docs: out, empty: out.length === 0, size: out.length };
      },
    });
    const db = {
      collection: () => ({ ...query(), doc: (id: string) => ({ set: async () => { sets.push(id); } }) }),
      batch: () => { const refs: Array<{ id: string }> = []; return { delete: (r: { id: string }) => refs.push(r), commit: async () => { refs.forEach((r) => docs.delete(r.id)); } }; },
    } as unknown as Firestore;
    const studio = studioDeps();
    const sweeper = await wireDecisionLog(studio, '/nonexistent-qa-dir', db, { now: () => T0 });
    await sweeper.flush(); sweeper.stop();
    expect([...docs.keys()]).toEqual(['new']);
    expect(sets).toEqual([]);
    expect(studio.deps.decisionLog).toBeUndefined();
  });
});
