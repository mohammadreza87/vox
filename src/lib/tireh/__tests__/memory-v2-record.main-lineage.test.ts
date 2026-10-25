// Main-lineage (9a6751e) memory-v2-record cases that pass against the chosen wave A record-v2.ts.
// Cases that could not be kept are listed in the S06 merge report.
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { contentHash, DEFAULT_IMPORTANCE, memoryV2 } from '../memory/record-v2';
import type { MemoryType } from '../types';
import { memory } from './fixtures';

const TYPES: MemoryType[] = ['fact', 'decision', 'preference', 'event', 'relationship'];

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

  // Main lineage also listed 0, 11, 3.5 and -1; wave A clamps finite values into 1..10 instead (recorded in the S06 merge report).
  it.each([Number.NaN, '7' as unknown as number, Infinity])('invalid importance %s falls back to the type default', (importance) => {
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
    expect(contentHash('\uFEE1\uFE8E\uFEE7')).toBe(contentHash('\u0645\u0627\u0646'));
    expect(contentHash('\uFEE1\uFE8E\uFEE7')).not.toBe(contentHash('\u0645\u0627'));
  });
});
