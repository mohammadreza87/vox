/**
 * Optimistic care (brief §3.7, contracts decision 4). The engine says an action finished; the page
 * applies it locally at once (same care.ts as the server), posts it, then eases to whatever the server
 * answers. pet/tickle taps are counted and flushed every 2 s as one request each. A late answer never
 * wins over a newer one (its guard and Bond milestone still reach the page), and on top of every answer
 * the page re-applies what the server has not seen yet: actions posted after it and still in flight,
 * and taps still waiting for their flush. So racing actions never make the rings flicker back.
 */

import type { CareResponse, PetAction, PetCare, PetGuard } from '@/lib/pet/types';
import { applyLocal, decayTo } from './care-local';
import type { PetApi } from './contract';

export type CareSource = 'local' | 'server';
export interface CareUpdate { care: PetCare; source: CareSource; action?: PetAction; guard?: PetGuard; bondMilestone?: number }

export interface CareSyncOptions {
  api: PetApi;
  agentId: string;
  onCare: (u: CareUpdate) => void;
  onError?: (e: unknown) => void;
  /** batch window for pet/tickle taps */
  flushMs?: number;
  clock?: () => number;
}

const BATCHED: ReadonlySet<PetAction> = new Set<PetAction>(['pet', 'tickle']);
/** server cap on one batch (CareRequest.n is 1..50) */
const MAX_N = 50;

export class CareSync {
  private care: PetCare | null = null;
  /** server clock − local clock, from the last answer */
  private skew = 0;
  private pending: Partial<Record<PetAction, number>> = {};
  /** posted and not answered yet, by seq (an answer re-applies the newer ones) */
  private inflight = new Map<number, { action: PetAction; n?: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private applied = 0;
  private disposed = false;
  private readonly o: Required<Pick<CareSyncOptions, 'flushMs' | 'clock'>> & CareSyncOptions;

  constructor(o: CareSyncOptions) {
    this.o = { flushMs: 2000, clock: () => Date.now(), ...o };
  }

  /** server time now (the client decays from the server clock, never Date.now() alone) */
  now() { return this.o.clock() + this.skew; }
  get current() { return this.care; }

  /** A fresh server view (GET or a talk response): adopt it, keep any taps still waiting. */
  adopt(care: PetCare, serverNow?: number) {
    if (serverNow !== undefined) this.skew = serverNow - this.o.clock();
    this.care = this.withPending(care);
    this.o.onCare({ care: this.care, source: 'server' });
  }

  /** The engine finished an action: apply it now, post it (batched for pet/tickle). Returns the local guard. */
  act(action: PetAction, n = 1): PetGuard | undefined {
    if (!this.care || this.disposed) return undefined;
    const r = applyLocal(this.care, action, this.now(), BATCHED.has(action) ? n : undefined);
    this.care = r.care;
    this.o.onCare({ care: r.care, source: 'local', action, guard: r.guard });
    if (BATCHED.has(action)) {
      this.pending[action] = (this.pending[action] ?? 0) + n;
      this.timer ??= setTimeout(() => { this.timer = null; void this.flush(); }, this.o.flushMs);
    } else {
      void this.post(action);
    }
    return r.guard;
  }

  /**
   * Send every waiting tap count now. `keepalive` on hide: Telegram may close the page right after,
   * and a keepalive request outlives it (the bodies are a few bytes of JSON).
   */
  async flush(o: { keepalive?: boolean } = {}) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const batch = this.pending;
    this.pending = {};
    // disposed (unmounted, or the pet was forgotten): waiting taps are dropped, never posted
    if (this.disposed) return;
    await Promise.all((Object.keys(batch) as PetAction[]).map((a) => this.post(a, Math.min(MAX_N, batch[a] ?? 0), o.keepalive)));
  }

  /** Live while mounted; returns the dispose (StrictMode re-attaches after its simulated unmount). */
  attach(): () => void {
    this.disposed = false;
    return () => this.dispose();
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async post(action: PetAction, n?: number, keepalive?: boolean) {
    if (n === 0) return;
    const seq = ++this.seq;
    this.inflight.set(seq, n === undefined ? { action } : { action, n });
    const req = n === undefined ? { action } : { action, n };
    let res: CareResponse;
    try {
      res = await (keepalive ? this.o.api.care(this.o.agentId, req, { keepalive: true }) : this.o.api.care(this.o.agentId, req));
    } catch (e) {
      // the optimistic value stays; the next answer (or GET) corrects it
      this.inflight.delete(seq);
      this.o.onError?.(e);
      return;
    }
    this.inflight.delete(seq);
    if (this.disposed || !res?.care) return;
    // a late answer: a newer one already landed, so its care is stale, but what it reports still plays
    if (seq < this.applied) {
      if ((res.guard || res.bondMilestone !== undefined) && this.care) this.o.onCare({ care: this.care, source: 'server', action, guard: res.guard, bondMilestone: res.bondMilestone });
      return;
    }
    this.applied = seq;
    this.skew = res.now - this.o.clock();
    this.care = this.withPending(res.care);
    this.o.onCare({ care: this.care, source: 'server', action, guard: res.guard, bondMilestone: res.bondMilestone });
  }

  /** server care decayed to now, plus what it has not seen yet: newer posts still in flight, then waiting taps */
  private withPending(care: PetCare): PetCare {
    let c = decayTo(care, this.now());
    for (const [seq, q] of [...this.inflight].sort((a, b) => a[0] - b[0])) {
      if (seq > this.applied) c = applyLocal(c, q.action, this.now(), q.n).care;
    }
    for (const a of Object.keys(this.pending) as PetAction[]) {
      const n = this.pending[a];
      if (n) c = applyLocal(c, a, this.now(), n).care;
    }
    return c;
  }
}
