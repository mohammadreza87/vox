import { describe, expect, it } from 'vitest';
import { AuthorizedContextRetriever, normalizeRetrievalText, type RetrievalCandidate } from './index';
const row = (id: string, text: string, freshness = 0, layer: RetrievalCandidate['layer'] = 'memory'): RetrievalCandidate => ({ id, text, freshness, layer });
const authority = (revision = 'v1', scope = 'private:person-a:agent-a:work') => ({ scope, revision });

describe('current-authority bounded retrieval', () => {
  it('ranks relevance before freshness and keeps full English/Persian facts', () => {
    const r = new AuthorizedContextRetriever();
    const candidates = [row('old', 'Release deadline is 2026-10-23; do not publish before approval.', 1), row('new', 'Use blue.', 999), row('fa', 'جلسهٔ کیان ساعت ۱۲ است؛ منتشر نکن.', 3)];
    expect(r.select({ candidates, query: 'deadline' }).selected[0].id).toBe('old');
    const fa = r.select({ candidates, query: 'جلسه كيان ١٢' }).selected[0];
    expect(fa.id).toBe('fa'); expect(fa.text).toBe(candidates[2].text);
    expect(normalizeRetrievalText('كِيـان می‌رود ۱۲٣')).toBe('کیان می رود 123');
  });
  it('uses deterministic freshness and ID tie breaks independent of input permutation', () => {
    const r = new AuthorizedContextRetriever();
    const candidates = [row('b', 'deadline Monday', 1), row('a', 'deadline Tuesday', 1), row('c', 'deadline Friday', 0)];
    expect(r.select({ candidates, query: 'deadline' }).selected.map(m => m.id)).toEqual(['a', 'b', 'c']);
    expect(r.select({ candidates: [...candidates].reverse(), query: 'deadline' }).selected.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });
  it('reserves explicit preferences without honoring a forged memory label', () => {
    const r = new AuthorizedContextRetriever();
    const candidates = [...Array.from({ length: 30 }, (_, i) => row(`m${i}`, `deadline ${i} ${'a'.repeat(700)}`, i)),
      row('fake', 'Explicit response preferences: deadline deadline deadline', 999), row('preference', 'Reply briefly in Persian.', 0, 'preference')];
    const result = r.select({ candidates, query: 'deadline' });
    expect(result.selected[0].id).toBe('preference'); expect(result.serializedBytes).toBeLessThanOrEqual(8192);
    expect(result.selected).toHaveLength(12);
  });
  it('caps serialized UTF-8 including escaping and skips whole oversize records', () => {
    const r = new AuthorizedContextRetriever();
    const candidates = [row('huge', 'deadline '.repeat(2000)), ...Array.from({ length: 30 }, (_, i) => row(`fa${i}`, `جلسه ${i} "\\\n${'ی'.repeat(1200)}`, i)), row('small', 'Do not share this fact.')];
    const result = r.select({ candidates, query: 'deadline جلسه' });
    expect(result.serializedBytes).toBe(Buffer.byteLength(JSON.stringify(result.selected.map(m => m.text))));
    expect(result.serializedBytes).toBeLessThanOrEqual(8192); expect(result.selected.length).toBeLessThanOrEqual(12);
    expect(result.selected.every(m => candidates.some(c => c.text === m.text))).toBe(true);
    expect(result.selected.find(m => m.id === 'huge')).toBeUndefined();
    expect(r.select({ candidates, query: '', maxItems: 0 }).selected).toEqual([]);
    expect(() => r.select({ candidates, query: '', maxBytes: 9000 })).toThrow('invalid_retrieval_budget');
  });
  it('deduplicates text, returns fresh copies, and rejects ambiguous IDs and unbounded input', () => {
    const r = new AuthorizedContextRetriever();
    const candidates = [row('a', 'Deadline Monday.'), row('b', 'Deadline Monday.')];
    const first = r.select({ candidates, query: '', authority: authority() });
    expect(first.selected).toHaveLength(1); first.selected[0].text = 'MUTATED';
    expect(r.select({ candidates, query: '', authority: authority() }).selected[0].text).toBe('Deadline Monday.');
    expect(r.select({ candidates: [row('a', 'one'), row('a', 'two')], query: '' }).selected).toEqual([]);
    expect(r.select({ candidates: Array.from({ length: 20_001 }, (_, i) => row(String(i), 'text')), query: '' }).selected).toEqual([]);
    expect(r.select({ candidates: [row('a', 'x'.repeat(1024 * 1024 + 1))], query: '' }).selected).toEqual([]);
  });
  it('caches only rankings, rebinds against current rows, and invalidates on every authority change', () => {
    const r = new AuthorizedContextRetriever();
    const candidates = [row('a', 'PRIVATE_CANARY deadline'), row('b', 'OTHER_CANARY')];
    expect(r.select({ candidates, query: 'QUERY_CANARY deadline', authority: authority() }).cacheHit).toBe(false);
    expect(r.select({ candidates, query: 'QUERY_CANARY deadline', authority: authority() }).cacheHit).toBe(true);
    const stored = JSON.stringify([...(r as unknown as { cache: Map<string, unknown> }).cache]);
    for (const secret of ['PRIVATE_CANARY', 'OTHER_CANARY', 'QUERY_CANARY']) expect(stored).not.toContain(secret);
    const revoked = r.select({ candidates: [], query: 'QUERY_CANARY deadline', authority: authority('v2') });
    expect(revoked.selected).toEqual([]); expect(revoked.cacheHit).toBe(false); expect(r.cacheSize).toBe(1);
    // A late old request can populate a ranking, but cannot supply text to v2.
    r.select({ candidates, query: 'QUERY_CANARY deadline', authority: authority() });
    expect(r.select({ candidates: [], query: 'QUERY_CANARY deadline', authority: authority('v2') }).selected).toEqual([]);
    expect(r.select({ candidates: [row('a', 'EDITED')], query: 'QUERY_CANARY deadline', authority: authority('v2') }).selected[0].text).toBe('EDITED');
  });
  it('isolates person/agent/audience/space receipts and bounds/ages the cache', () => {
    let now = 100;
    const r = new AuthorizedContextRetriever(() => now, 2, 10);
    const candidates = [row('a', 'deadline')];
    for (const scope of ['work:person-a:agent-a:group-ab', 'personal:person-a:agent-a:private', 'work:person-b:agent-b:exact-bc'])
      expect(r.select({ candidates, query: 'deadline', authority: authority('v1', scope) }).cacheHit).toBe(false);
    expect(r.cacheSize).toBe(2); now = 110;
    expect(r.select({ candidates, query: 'deadline', authority: authority('v1', 'work:person-b:agent-b:exact-bc') }).cacheHit).toBe(false);
    expect(r.cacheSize).toBe(1); r.clear(); expect(r.cacheSize).toBe(0);
  });
  it('selects English/Persian needles from a synthetic 2000-record history under a strict budget', () => {
    const candidates = Array.from({ length: 2000 }, (_, i) => row(`filler-${i}`, `Routine unrelated saved note ${i}.`, i));
    candidates[2] = row('en-target', 'The launch deadline is Friday; approval is still required.', 2);
    candidates[3] = row('fa-target', 'مهلت انتشار کیان جمعه است؛ تأیید هنوز لازم است.', 3);
    const r = new AuthorizedContextRetriever();
    expect(r.select({ candidates, query: 'launch deadline' }).selected[0].id).toBe('en-target');
    const fa = r.select({ candidates, query: 'مهلت انتشار كيان', authority: authority() });
    expect(fa.selected[0].id).toBe('fa-target'); expect(fa.considered).toBe(2000);
    expect(fa.serializedBytes).toBeLessThanOrEqual(8192); expect(fa.selected).toHaveLength(12);
  });
});
