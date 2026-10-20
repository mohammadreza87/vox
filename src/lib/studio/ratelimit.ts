/** Process-local limits for Studio's single persistent server process. */
import { brandError, namedError } from '../error-contract';
export type StudioRateScope = 'ingress' | 'api' | 'mutation' | 'route' | 'expensive' | 'avatar' | 'voice' | 'call';

export interface StudioRatePolicy {
  requests: number;
  windowMs: number;
}

export interface StudioRateLimiterOptions {
  now?: () => number;
  maxKeys?: number;
  policies?: Partial<Record<StudioRateScope, StudioRatePolicy>>;
}

export interface StudioRequestRateLimiter {
  consume(scope: StudioRateScope, identity: string | number): void | Promise<void>;
}

const MINUTE = 60_000;
const DEFAULT_POLICIES: Record<StudioRateScope, StudioRatePolicy> = {
  // A shared entrance limit also bounds invalid authentication and public media.
  // Request headers cannot establish a trustworthy client IP on direct exposure.
  ingress: { requests: 600, windowMs: MINUTE },
  api: { requests: 120, windowMs: MINUTE },
  mutation: { requests: 30, windowMs: MINUTE },
  // Role suggestions while the creator types (local matching, no provider call).
  route: { requests: 90, windowMs: MINUTE },
  expensive: { requests: 60, windowMs: 10 * MINUTE },
  avatar: { requests: 6, windowMs: 10 * MINUTE },
  voice: { requests: 20, windowMs: 10 * MINUTE },
  call: { requests: 20, windowMs: MINUTE },
};

/** Keep local and distributed windows identical, with validated immutable input. */
export function studioRatePolicies(overrides: StudioRateLimiterOptions['policies'] = {}): Record<StudioRateScope, StudioRatePolicy> {
  const policies = { ...DEFAULT_POLICIES, ...overrides };
  for (const [scope, policy] of Object.entries(policies)) {
    if (!policy || !Number.isSafeInteger(policy.requests) || policy.requests < 1 || !Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1) {
      throw new Error('Invalid rate limit policy');
    }
    policies[scope as StudioRateScope] = { ...policy };
  }
  return policies;
}

interface Counter {
  requests: number;
  expiresAt: number;
}

export class StudioRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Please try again shortly.');
    this.name = 'StudioRateLimitError';
    brandError(this, 'StudioRateLimitError');
  }
  static is(error: unknown): error is StudioRateLimitError {
    try {
      if (!namedError(error, 'StudioRateLimitError')) return false;
      const retry: unknown = Object.getOwnPropertyDescriptor(error, 'retryAfterSeconds')?.value;
      return typeof retry === 'number' && Number.isSafeInteger(retry) && retry >= 1;
    } catch { return false; }
  }
}

/**
 * Fixed windows with a hard key bound. Full capacity rejects new keys rather
 * than evicting live counters, so cycling user IDs cannot reset their limits.
 */
export class StudioRateLimiter implements StudioRequestRateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly now: () => number;
  private readonly maxKeys: number;
  private readonly policies: Record<StudioRateScope, StudioRatePolicy>;
  private nextCleanupAt = 0;

  constructor(options: StudioRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.policies = studioRatePolicies(options.policies);
    if (!Number.isSafeInteger(this.maxKeys) || this.maxKeys < 1) throw new Error('Invalid rate limiter capacity');
  }

  consume(scope: StudioRateScope, identity: string | number): void {
    const now = this.now();
    if (now >= this.nextCleanupAt) this.cleanup(now);
    const key = `${scope}:${identity}`;
    const policy = this.policies[scope];
    let counter = this.counters.get(key);
    if (counter && counter.expiresAt <= now) {
      this.counters.delete(key);
      counter = undefined;
    }
    if (counter) {
      if (counter.requests >= policy.requests) throw new StudioRateLimitError(this.retryAfter(counter.expiresAt, now));
      counter.requests++;
      return;
    }
    if (this.counters.size >= this.maxKeys) {
      this.cleanup(now);
      if (this.counters.size >= this.maxKeys) {
        let firstExpiry = Infinity;
        for (const current of this.counters.values()) firstExpiry = Math.min(firstExpiry, current.expiresAt);
        throw new StudioRateLimitError(this.retryAfter(firstExpiry, now));
      }
    }
    this.counters.set(key, { requests: 1, expiresAt: now + policy.windowMs });
  }

  private retryAfter(expiresAt: number, now: number): number {
    return Math.max(1, Math.ceil((expiresAt - now) / 1000));
  }

  private cleanup(now: number): void {
    for (const [key, counter] of this.counters) {
      if (counter.expiresAt <= now) this.counters.delete(key);
    }
    this.nextCleanupAt = now + MINUTE;
  }
}
