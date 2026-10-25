import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { contentHash, DEFAULT_IMPORTANCE, memoryV2, stripEmbeddingUnlessNormal } from '../memory/record-v2';
import { memory } from './fixtures';

describe('memoryV2 defaults', () => {
  it('views a legacy fixture record with the documented defaults', () => {
    const at = new Date('2026-10-01T09:00:00Z');
    const legacy = memory({ content: 'Reza prefers async standups', scope: { kind: 'private', personId: 'reza' }, source: { personId: 'reza', chatKind: 'private', at } });
    const view = memoryV2(legacy);
    expect(view).toEqual({ space: 'work', status: 'asserted', validFrom: at, importance: 5, retrievalCount: 0, subjectConfirmed: false });
    expect(view.validFrom).toBe(legacy.source.at);
    expect('lastRetrievedAt' in view || 'expiresAt' in view || 'invalidatedAt' in view).toBe(false);
  });

  it('defaults importance by type', () => {
    const scope = { kind: 'org' as const };
    expect(memoryV2(memory({ content: 'x', scope, type: 'decision' })).importance).toBe(7);
    expect(memoryV2(memory({ content: 'x', scope, type: 'preference' })).importance).toBe(6);
    expect(memoryV2(memory({ content: 'x', scope, type: 'fact' })).importance).toBe(5);
    expect(memoryV2(memory({ content: 'x', scope, type: 'event' })).importance).toBe(5);
    expect(memoryV2(memory({ content: 'x', scope, type: 'relationship' })).importance).toBe(5);
    expect(DEFAULT_IMPORTANCE).toEqual({ fact: 5, decision: 7, preference: 6, event: 5, relationship: 5 });
  });

  it('clamps or falls back for out-of-range importance', () => {
    const scope = { kind: 'org' as const };
    expect(memoryV2(memory({ content: 'x', scope, importance: 0 })).importance).toBe(1);
    expect(memoryV2(memory({ content: 'x', scope, importance: 11 })).importance).toBe(10);
    expect(memoryV2(memory({ content: 'x', scope, importance: 3.6 })).importance).toBe(4);
    expect(memoryV2(memory({ content: 'x', scope, importance: NaN })).importance).toBe(5);
    expect(memoryV2(memory({ content: 'x', scope, type: 'decision', importance: Infinity })).importance).toBe(7);
  });

  it('keeps valid stored values and ignores invalid ones', () => {
    const scope = { kind: 'org' as const };
    const valid = new Date('2026-10-05T00:00:00Z');
    const view = memoryV2(memory({
      content: 'x', scope, space: 'personal', status: 'confirmed', validFrom: valid, retrievalCount: 4,
      subjectConfirmed: true, lastRetrievedAt: valid, expiresAt: valid, invalidatedAt: valid,
    }));
    expect(view).toMatchObject({ space: 'personal', status: 'confirmed', validFrom: valid, retrievalCount: 4, subjectConfirmed: true, lastRetrievedAt: valid, expiresAt: valid, invalidatedAt: valid });

    const bad = new Date('not a date');
    const legacy = memory({ content: 'x', scope });
    const ignored = memoryV2({
      ...legacy, validFrom: bad, lastRetrievedAt: bad, expiresAt: bad, invalidatedAt: bad,
      status: 'bogus' as never, space: 'other' as never, retrievalCount: -1, subjectConfirmed: 'yes' as never,
    });
    expect(ignored.validFrom).toBe(legacy.source.at);
    expect(ignored.status).toBe('asserted');
    expect(ignored.space).toBe('work');
    expect(ignored.retrievalCount).toBe(0);
    expect(ignored.subjectConfirmed).toBe(false);
    expect('lastRetrievedAt' in ignored || 'expiresAt' in ignored || 'invalidatedAt' in ignored).toBe(false);
    expect(memoryV2({ ...legacy, retrievalCount: 1.5 }).retrievalCount).toBe(0);
  });
});

describe('contentHash', () => {
  it('is sha256 of the NFKC-trimmed content', () => {
    const text = 'GameEnd launch is Feb 20';
    expect(contentHash(text)).toBe(createHash('sha256').update(text).digest('hex'));
    expect(contentHash(`  ${text}\n`)).toBe(contentHash(text));
    expect(contentHash('ＧａｍｅＥｎｄ launch is Feb 20')).toBe(contentHash(text));
    expect(contentHash('GameEnd launch is Feb 21')).not.toBe(contentHash(text));
  });
});

describe('stripEmbeddingUnlessNormal', () => {
  const withEmbedding = { content: 'x', embedding: [0.1, 0.2], embeddingModel: 'm', embeddingVersion: 1, confidence: 0.5 };

  it('returns the same reference for normal sensitivity', () => {
    expect(stripEmbeddingUnlessNormal(withEmbedding, 'normal')).toBe(withEmbedding);
  });

  it('drops the three embedding keys for personal and confidential', () => {
    for (const sensitivity of ['personal', 'confidential'] as const) {
      const stripped = stripEmbeddingUnlessNormal(withEmbedding, sensitivity);
      expect(stripped).toEqual({ content: 'x', confidence: 0.5 });
      expect('embedding' in stripped || 'embeddingModel' in stripped || 'embeddingVersion' in stripped).toBe(false);
      expect(withEmbedding.embedding).toEqual([0.1, 0.2]);
    }
  });
});
