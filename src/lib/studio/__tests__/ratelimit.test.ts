import { describe, expect, it } from 'vitest';
import { StudioRateLimiter, StudioRateLimitError } from '../ratelimit';

describe('StudioRateLimiter', () => {
  it('separates verified users and scopes, then resets at the window boundary', () => {
    let now = 1000;
    const limiter = new StudioRateLimiter({ now: () => now, policies: { api: { requests: 2, windowMs: 1500 } } });
    limiter.consume('api', 1);
    limiter.consume('api', 1);
    limiter.consume('api', 2);
    limiter.consume('voice', 1);
    try {
      limiter.consume('api', 1);
      expect.fail('The exhausted budget should reject the request');
    } catch (error) {
      expect(error).toBeInstanceOf(StudioRateLimitError);
      expect((error as StudioRateLimitError).retryAfterSeconds).toBe(2);
    }
    now = 2499;
    expect(() => limiter.consume('api', 1)).toThrow(StudioRateLimitError);
    now = 2500;
    expect(() => limiter.consume('api', 1)).not.toThrow();
  });

  it('bounds retained identities without evicting live budgets and frees expired capacity', () => {
    let now = 0;
    const limiter = new StudioRateLimiter({
      now: () => now, maxKeys: 2, policies: { api: { requests: 1, windowMs: 1000 } },
    });
    limiter.consume('api', 'one');
    limiter.consume('api', 'two');
    for (let id = 0; id < 100; id++) expect(() => limiter.consume('api', `new-${id}`)).toThrow(StudioRateLimitError);
    expect(() => limiter.consume('api', 'one')).toThrow(StudioRateLimitError);
    now = 1000;
    expect(() => limiter.consume('api', 'three')).not.toThrow();
    expect(() => limiter.consume('api', 'four')).not.toThrow();
    expect(() => limiter.consume('api', 'five')).toThrow(StudioRateLimitError);
  });

  it('rejects invalid limits instead of silently disabling protection', () => {
    expect(() => new StudioRateLimiter({ maxKeys: 0 })).toThrow();
    expect(() => new StudioRateLimiter({ policies: { api: { requests: 0, windowMs: 1000 } } })).toThrow();
    expect(() => new StudioRateLimiter({ policies: { api: { requests: 1, windowMs: NaN } } })).toThrow();
  });
});
