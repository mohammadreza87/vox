import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { AdaptiveStorage } from '../persistence/storage';
import type { AdaptiveLifecycleService } from './service';

export const CHECKPOINT = 'adaptive-maintenance:v1';
export const checkpointSchema = z.object({ schemaVersion: z.literal(1),
  cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lease: z.object({ token: z.string().uuid(), workerId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), until: z.number().int().nonnegative().safe() }).strict().optional(),
  status: z.enum(['continued', 'completed', 'failed']), pages: z.number().int().nonnegative().safe(),
  accounts: z.number().int().nonnegative().safe(), updatedAt: z.number().int().nonnegative().safe(),
  failure: z.enum(['sweep_failed']).optional(),
}).strict();
type Checkpoint = z.infer<typeof checkpointSchema>;
export interface MaintenanceOptions {
  now?: () => number;
  leaseMs?: number;
  /** Awaited before checkpoint advancement. Failure retries the same bounded page. */
  afterAccount?: (telegramId: number, context: { signal?: AbortSignal }) => Promise<void>;
}
export type MaintenanceResult = { state: 'continued' | 'completed' | 'busy' | 'failed'; scanned: number; next?: string; failure?: 'sweep_failed' };

/** No timers, provider calls or automatic activation. The server scheduler injects
 * a separate restricted maintenance store for durable cursor, lease and failure state.
 * At-least-once page delivery survives restarts; sweep hooks must be idempotent. */
export class AdaptiveMaintenanceRunner {
  private readonly now: () => number;
  private readonly leaseMs: number;
  constructor(readonly lifecycle: AdaptiveLifecycleService, readonly accounts: AdaptiveStorage,
    readonly checkpoints: AdaptiveStorage, private readonly options: MaintenanceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 60_000;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1000 || this.leaseMs > 300_000) throw new Error('Invalid maintenance lease');
    if (accounts === checkpoints) throw new Error('Maintenance requires separate checkpoint storage');
  }
  async runPage(input: { workerId: string; limit?: number; signal?: AbortSignal }): Promise<MaintenanceResult> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.workerId) || !Number.isSafeInteger(input.limit ?? 20) ||
        (input.limit ?? 20) < 1 || (input.limit ?? 20) > 100) throw new Error('Invalid maintenance request');
    if (!this.accounts.listAccounts) throw new Error('Adaptive enumeration unavailable');
    const token = randomUUID(), now = this.now();
    const claimed = await this.checkpoints.transact<{ acquired: boolean; cursor?: string }>(CHECKPOINT, raw => {
      const d: Checkpoint = raw === null ? { schemaVersion: 1, status: 'continued', pages: 0, accounts: 0, updatedAt: now } : checkpointSchema.parse(raw);
      if (d.lease && d.lease.until > now) return { document: d, result: { acquired: false as const } };
      // A completed pass begins again at the front, including inserts behind cursor.
      if (d.status === 'completed') { delete d.cursor; d.pages = 0; d.accounts = 0; }
      d.lease = { token, workerId: input.workerId, until: now + this.leaseMs }; d.updatedAt = now;
      return { document: d, result: { acquired: true as const, cursor: d.cursor } };
    });
    if (!claimed.acquired) return { state: 'busy', scanned: 0 };
    let scanned = 0;
    const renew = async () => this.checkpoints.transact(CHECKPOINT, raw => {
      const d = checkpointSchema.parse(raw), time = this.now();
      if (d.lease?.token !== token || d.lease.until <= time) throw new Error('Maintenance lease lost');
      d.lease.until = time + this.leaseMs; d.updatedAt = time;
      return { document: d, result: undefined };
    });
    try {
      input.signal?.throwIfAborted();
      const page = await this.accounts.listAccounts({ after: claimed.cursor, limit: input.limit ?? 20 });
      for (const accountId of page.accountIds) {
        input.signal?.throwIfAborted();
        await renew();
        const match = /^telegram-account:([1-9]\d{0,15})$/.exec(accountId), telegramId = match ? Number(match[1]) : NaN;
        if (!Number.isSafeInteger(telegramId)) throw new Error('Invalid maintenance account');
        await this.lifecycle.sweepAccount(telegramId);
        await this.options.afterAccount?.(telegramId, { signal: input.signal });
        scanned++;
      }
      input.signal?.throwIfAborted();
      await renew();
      await this.lifecycle.sweepShared();
      const state = page.next ? 'continued' as const : 'completed' as const;
      await this.checkpoints.transact(CHECKPOINT, raw => {
        const d = checkpointSchema.parse(raw), time = this.now();
        if (d.lease?.token !== token || d.lease.until <= time) throw new Error('Maintenance lease lost');
        d.cursor = page.next; d.status = state; d.pages++; d.accounts += scanned;
        d.updatedAt = time; delete d.lease; delete d.failure;
        return { document: d, result: undefined };
      });
      return { state, scanned, ...(page.next ? { next: page.next } : {}) };
    } catch {
      // Fixed catalog failure only. No account IDs, private text or raw exceptions.
      await this.checkpoints.transact(CHECKPOINT, raw => {
        const d = checkpointSchema.parse(raw);
        if (d.lease?.token === token) { d.status = 'failed'; d.failure = 'sweep_failed'; d.updatedAt = this.now(); delete d.lease; }
        return { document: d, result: undefined };
      });
      return { state: 'failed', scanned, failure: 'sweep_failed' };
    }
  }
}
