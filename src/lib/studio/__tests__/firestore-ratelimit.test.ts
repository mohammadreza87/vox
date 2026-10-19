import { describe, expect, it, vi } from 'vitest';
import { FirestoreStudioRateLimiter } from '../firestore-ratelimit';
import { StudioRateLimitError } from '../ratelimit';

/** Serialize commits, as real conflicting Firestore transactions do. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  let pending = Promise.resolve();
  let failedCommit = false;
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const result = pending.then(async () => {
        const writes = new Map<string, Record<string, unknown>>();
        const out = await fn({
          get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), get: (field: string) => docs.get(ref.path)?.[field] }),
          set: (ref: { path: string }, data: Record<string, unknown>) => writes.set(ref.path, data),
        });
        if (failedCommit) { failedCommit = false; throw new Error('Database unavailable'); }
        for (const [path, data] of writes) docs.set(path, data);
        return out;
      });
      pending = result.then(() => undefined, () => undefined);
      return result;
    }),
  };
  return { db, docs, failNextCommit: () => { failedCommit = true; } };
}

describe('FirestoreStudioRateLimiter', () => {
  it('shares atomic budgets between concurrent instances', async () => {
    const { db, docs } = fakeFirestore();
    const options = { now: () => 1000, policies: { api: { requests: 2, windowMs: 1500 } } };
    const a = new FirestoreStudioRateLimiter(db as never, options);
    const b = new FirestoreStudioRateLimiter(db as never, options);
    const results = await Promise.allSettled([
      a.consume('api', 'alice'), b.consume('api', 'alice'), a.consume('api', 'alice'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const blocked = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(blocked.reason).toBeInstanceOf(StudioRateLimitError);
    expect(blocked.reason.retryAfterSeconds).toBe(2);
    expect([...docs.values()]).toEqual([{ requests: 2, expiresAtMs: 2500, expiresAt: new Date(2500) }]);
  });

  it('separates scopes and users and reuses expired documents', async () => {
    const { db, docs } = fakeFirestore();
    let now = 1000;
    const options = { now: () => now, policies: { api: { requests: 1, windowMs: 1000 } } };
    const a = new FirestoreStudioRateLimiter(db as never, options);
    await a.consume('api', 'alice');
    await a.consume('api', 'bob');
    await a.consume('voice', 'alice');
    expect(docs.size).toBe(3);
    expect([...docs.keys()].some((key) => key.includes('alice') || key.includes('bob'))).toBe(false);
    now = 2000;
    const freshInstance = new FirestoreStudioRateLimiter(db as never, options);
    await freshInstance.consume('api', 'alice');
    expect(docs.size).toBe(3);
    expect([...docs.values()].filter((counter) => counter.expiresAtMs === 3000)).toHaveLength(1);
  });

  it('sheds repeated local bursts before making more database calls', async () => {
    const { db } = fakeFirestore();
    const limiter = new FirestoreStudioRateLimiter(db as never, { policies: { api: { requests: 1, windowMs: 1000 } } });
    await limiter.consume('api', 1);
    await expect(limiter.consume('api', 1)).rejects.toBeInstanceOf(StudioRateLimitError);
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('fails closed on persistence failures and invalid counters', async () => {
    const { db, docs, failNextCommit } = fakeFirestore();
    const limiter = new FirestoreStudioRateLimiter(db as never);
    failNextCommit();
    await expect(limiter.consume('api', 1)).rejects.toThrow('Database unavailable');
    expect(docs.size).toBe(0);
    await limiter.consume('api', 1);
    const path = [...docs.keys()][0];
    docs.set(path, { requests: 'invalid', expiresAtMs: Date.now() + 60_000 });
    const freshInstance = new FirestoreStudioRateLimiter(db as never);
    await expect(freshInstance.consume('api', 1)).rejects.toThrow('Invalid persisted Studio rate limit');
  });
});
