import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { contentHash, DEFAULT_IMPORTANCE, isExpired, isInvalidated, memoryV2 } from '../memory/record-v2';
import type { MemoryRecord, MemoryType } from '../types';
import { memory } from './fixtures';

const TYPES: MemoryType[] = ['fact', 'decision', 'preference', 'event', 'relationship'];
const now = new Date('2026-10-20T12:00:00Z');

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('memoryV2 defaults', () => {
  it.each(TYPES)('legacy %s record gets the documented defaults', (type) => {
    const m = memory({ content: 'legacy', scope: { kind: 'org' }, type });
    const v = memoryV2(m);
    expect(v).toEqual({
      space: 'work',
      status: 'asserted',
      validFrom: m.source.at,
      importance: DEFAULT_IMPORTANCE[type],
      retrievalCount: 0,
      subjectConfirmed: false,
      lastRetrievedAt: undefined,
      expiresAt: undefined,
      invalidatedAt: undefined,
    });
  });

  it('type defaults are decision 7, preference 6, otherwise 5', () => {
    expect(DEFAULT_IMPORTANCE).toEqual({ decision: 7, preference: 6, fact: 5, event: 5, relationship: 5 });
  });

  it('keeps valid v2 values', () => {
    const at = new Date('2026-09-01T00:00:00Z');
    const m = memory({ content: 'x', scope: { kind: 'org' }, space: 'personal', status: 'confirmed', validFrom: at, importance: 9,
      retrievalCount: 4, subjectConfirmed: true, lastRetrievedAt: at, expiresAt: at, invalidatedAt: at });
    expect(memoryV2(m)).toEqual({ space: 'personal', status: 'confirmed', validFrom: at, importance: 9, retrievalCount: 4,
      subjectConfirmed: true, lastRetrievedAt: at, expiresAt: at, invalidatedAt: at });
  });

  it.each([0, 11, 3.5, Number.NaN, '7' as unknown as number, -1, Infinity])('invalid importance %s falls back to the type default', (importance) => {
    expect(memoryV2(memory({ content: 'x', scope: { kind: 'org' }, type: 'decision', importance })).importance).toBe(7);
    expect(memoryV2(memory({ content: 'x', scope: { kind: 'org' }, type: 'fact', importance })).importance).toBe(5);
  });

  it('accepts the importance bounds 1 and 10', () => {
    expect(memoryV2(memory({ content: 'x', scope: { kind: 'org' }, importance: 1 })).importance).toBe(1);
    expect(memoryV2(memory({ content: 'x', scope: { kind: 'org' }, importance: 10 })).importance).toBe(10);
  });

  it('invalid dates, enum values and counts fall back', () => {
    const bad = new Date('not a date');
    const m = memory({ content: 'x', scope: { kind: 'org' }, validFrom: bad, lastRetrievedAt: bad, expiresAt: bad, invalidatedAt: bad,
      space: 'home' as never, status: 'maybe' as never, retrievalCount: -2, subjectConfirmed: 'yes' as never });
    const v = memoryV2(m);
    expect(v.validFrom).toBe(m.source.at);
    expect(v.lastRetrievedAt).toBeUndefined();
    expect(v.expiresAt).toBeUndefined();
    expect(v.invalidatedAt).toBeUndefined();
    expect(v.space).toBe('work');
    expect(v.status).toBe('asserted');
    expect(v.retrievalCount).toBe(0);
    expect(v.subjectConfirmed).toBe(false);
    expect(memoryV2({ ...m, retrievalCount: 1.5 }).retrievalCount).toBe(0);
    expect(memoryV2({ ...m, expiresAt: '2026-01-01' as unknown as Date }).expiresAt).toBeUndefined();
  });

  it('never mutates the input', () => {
    const m = deepFreeze(memory({ content: 'frozen', scope: { kind: 'org' }, importance: 42, lastRetrievedAt: new Date('bad') }));
    const before = JSON.stringify(m);
    expect(() => memoryV2(m)).not.toThrow();
    expect(() => isInvalidated(m, now)).not.toThrow();
    expect(() => isExpired(m, now)).not.toThrow();
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('isInvalidated / isExpired', () => {
  const base = memory({ content: 'x', scope: { kind: 'org' } });
  it('legacy records are neither invalidated nor expired', () => {
    expect(isInvalidated(base, now)).toBe(false);
    expect(isExpired(base, now)).toBe(false);
  });
  it('invalidatedBy alone invalidates', () => {
    expect(isInvalidated({ ...base, invalidatedBy: 'm-2' }, now)).toBe(true);
  });
  it('invalidatedAt boundaries: past and == now invalidate, future does not', () => {
    expect(isInvalidated({ ...base, invalidatedAt: new Date(now.getTime() - 1) }, now)).toBe(true);
    expect(isInvalidated({ ...base, invalidatedAt: new Date(now.getTime()) }, now)).toBe(true);
    expect(isInvalidated({ ...base, invalidatedAt: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(isInvalidated({ ...base, invalidatedAt: new Date('bad') }, now)).toBe(false);
  });
  it('expiresAt boundaries: past and == now expire, future does not', () => {
    expect(isExpired({ ...base, expiresAt: new Date(now.getTime() - 1) }, now)).toBe(true);
    expect(isExpired({ ...base, expiresAt: new Date(now.getTime()) }, now)).toBe(true);
    expect(isExpired({ ...base, expiresAt: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(isExpired({ ...base, expiresAt: new Date('bad') } as MemoryRecord, now)).toBe(false);
  });
});

describe('contentHash', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  it('is sha256 of the NFKC-normalised trimmed text', () => {
    expect(contentHash('  GameEnd launch  ')).toBe(sha('GameEnd launch'));
    expect(contentHash('ﬁle')).toBe(sha('file'));
    expect(contentHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('Arabic presentation forms hash the same as the base letters', () => {
    // U+FEE1 MEEM ISOLATED, U+FE8E ALEF FINAL, U+FEE7 NOON INITIAL -> base letters under NFKC
    expect(contentHash('ﻡﺎﻧ')).toBe(contentHash('مان'));
    expect(contentHash('ﻡﺎﻧ')).not.toBe(contentHash('ما'));
  });
});
