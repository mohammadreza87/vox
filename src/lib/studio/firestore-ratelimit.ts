/** Shared Studio rate windows for concurrent serverless instances. */
import { createHash } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import {
  StudioRateLimiter, StudioRateLimitError, studioRatePolicies,
  type StudioRateLimiterOptions, type StudioRateScope, type StudioRequestRateLimiter,
} from './ratelimit';

/**
 * A stable document per scope/identity prevents documents accumulating every
 * window. expiresAt may also be configured as a Firestore TTL field for idle
 * identities. Transactions fail closed when persistence is unavailable.
 */
export class FirestoreStudioRateLimiter implements StudioRequestRateLimiter {
  private readonly local: StudioRateLimiter;
  private readonly now: () => number;
  private readonly policies: ReturnType<typeof studioRatePolicies>;

  constructor(private readonly db: Firestore, options: StudioRateLimiterOptions = {}) {
    this.local = new StudioRateLimiter(options);
    this.now = options.now ?? Date.now;
    this.policies = studioRatePolicies(options.policies);
  }

  async consume(scope: StudioRateScope, identity: string | number): Promise<void> {
    // Bound local memory and shed repeated bursts before paying for a DB call.
    this.local.consume(scope, identity);
    const key = createHash('sha256').update(`${scope}:${identity}`).digest('hex');
    const ref = this.db.doc(`studioRateLimits/${scope}-${key}`);
    const policy = this.policies[scope];
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = this.now();
      const requests: unknown = snap.get('requests');
      const expiresAtMs: unknown = snap.get('expiresAtMs');
      if (snap.exists && (
        typeof requests !== 'number' || !Number.isSafeInteger(requests) || requests < 1 ||
        typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0
      )) throw new Error('Invalid persisted Studio rate limit');

      const active = typeof expiresAtMs === 'number' && expiresAtMs > now;
      const count = active && typeof requests === 'number' ? requests : 0;
      if (count >= policy.requests) {
        throw new StudioRateLimitError(Math.max(1, Math.ceil(((expiresAtMs as number) - now) / 1000)));
      }
      const expiry = active ? expiresAtMs as number : now + policy.windowMs;
      tx.set(ref, { requests: count + 1, expiresAtMs: expiry, expiresAt: new Date(expiry) });
    });
  }
}
