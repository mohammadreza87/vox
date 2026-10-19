import { expect, it } from 'vitest';
import type { AdaptiveDocument, StoredMemory } from '../persistence/repository';
import { purgeInvalidDerivedMemory, validMemoryLineage } from './provenance';
const row = (id: string, sources?: string[]): StoredMemory => ({ id, revision: 1, space: 'work', text: `Synthetic ${id}.`, status: 'active',
  createdAt: 0, updatedAt: 0, expiresAt: 1000, revocationEpoch: 0, ...(sources ? { sourceRefs: sources.map(id => ({ id, revision: 1 })) } : {}) });
const document = (memories: StoredMemory[]) => ({ memories } as AdaptiveDocument);
function dag(layers: number) {
  return document(Array.from({ length: layers + 1 }, (_, level) => Array.from({ length: 8 }, (_, index) =>
    row(`${level}:${index}`, level ? Array.from({ length: 8 }, (_, source) => `${level - 1}:${source}`) : undefined))).flat());
}
function work(d: AdaptiveDocument) {
  const counts = { nodes: 0, edges: 0, finds: 0 };
  for (const memory of d.memories) {
    const text = memory.text;
    Object.defineProperty(memory, 'text', { configurable: true, get: () => { counts.nodes++; return text; } });
    for (const ref of memory.sourceRefs ?? []) {
      const revision = ref.revision;
      Object.defineProperty(ref, 'revision', { configurable: true, get: () => { counts.edges++; return revision; } });
    }
  }
  // A future reintroduction of linear source scans fails independently of
  // elapsed time or the speed of the machine running this regression.
  d.memories.find = () => { counts.finds++; throw new Error('linear_source_lookup'); };
  return counts;
}
it.each([6, 7])('bounds a shared eight-source DAG at %i summary layers by nodes and edges', layers => {
  const d = dag(layers), counts = work(d);
  expect(validMemoryLineage(d, d.memories.at(-1)!, 1)).toBe(true);
  expect(counts).toEqual({ nodes: 1 + layers * 8, edges: 8 + (layers - 1) * 64, finds: 0 });
});
it('validates every purge candidate in one immutable pass without revisiting shared ancestors', () => {
  const d = dag(7), counts = work(d);
  expect(purgeInvalidDerivedMemory(d, 1)).toBe(false);
  expect(counts).toEqual({ nodes: d.memories.length, edges: 7 * 64, finds: 0 });
});
it('retains the eight-node depth bound when an ancestor is cached through a shorter root', () => {
  // Ascending document order primes short-path heights before the deepest root.
  const d = document(Array.from({ length: 9 }, (_, i) => row(`n${i}`, i ? [`n${i - 1}`] : undefined)));
  expect(validMemoryLineage(d, d.memories[7], 1)).toBe(true);
  expect(validMemoryLineage(d, d.memories[8], 1)).toBe(false);
  expect(purgeInvalidDerivedMemory(d, 1)).toBe(true);
  expect(d.memories[7].status).toBe('active'); expect(d.memories[8].status).toBe('deleted'); expect(d.memories[8].text).toBeUndefined();
  expect(validMemoryLineage(d, d.memories[6], 1, new Set(['external']))).toBe(true);
  expect(validMemoryLineage(d, d.memories[7], 1, new Set(['external']))).toBe(false);
});
it('rejects cycles and all descendants regardless of document traversal order, retaining unrelated originals', () => {
  for (const reversed of [false, true]) {
    const rows = [row('a', ['b']), row('b', ['a']), row('child', ['a']), row('original')], d = document(reversed ? rows.reverse() : rows);
    expect(purgeInvalidDerivedMemory(d, 1)).toBe(true);
    expect(d.memories.filter(row => row.status === 'active').map(row => row.id)).toEqual(['original']);
    expect(d.memories.filter(row => row.sourceRefs).every(row => row.text === undefined)).toBe(true);
  }
});
it.each(['revision', 'deleted', 'expiry', 'space', 'missing', 'duplicate_ref', 'duplicate_id'] as const)('rejects %s changes on a new invocation and purges descendants without deleting originals', change => {
  const source = row('source'), summary = row('summary', ['source']), child = row('child', ['summary']), d = document([source, summary, child]);
  expect(validMemoryLineage(d, child, 1)).toBe(true); expect(purgeInvalidDerivedMemory(d, 1)).toBe(false);
  if (change === 'revision') source.revision++;
  if (change === 'deleted') source.status = 'deleted';
  if (change === 'expiry') source.expiresAt = 1;
  if (change === 'space') source.space = 'personal';
  if (change === 'missing') d.memories = [summary, child];
  if (change === 'duplicate_ref') summary.sourceRefs!.push({ id: 'source', revision: 1 });
  if (change === 'duplicate_id') d.memories.push({ ...source });
  expect(validMemoryLineage(d, child, 1)).toBe(false); expect(purgeInvalidDerivedMemory(d, 1)).toBe(true);
  expect(summary.status).toBe('deleted'); expect(child.status).toBe('deleted'); expect(summary.text).toBeUndefined(); expect(child.text).toBeUndefined();
  expect(source.text).toBe('Synthetic source.');
});
it('allows a new unsaved summary but never allows its ID to shadow an authoritative row', () => {
  const source = row('source'), d = document([source]);
  expect(validMemoryLineage(d, row('new', ['source']), 1)).toBe(true);
  expect(validMemoryLineage(d, { ...source, sourceRefs: [{ id: 'source', revision: 1 }] }, 1)).toBe(false);
});
it('rejects child expiry beyond a source and does not retain failed results across later revisions', () => {
  const source = row('source'), summary = row('summary', ['source']), d = document([source, summary]);
  source.expiresAt = 900; expect(validMemoryLineage(d, summary, 1)).toBe(false);
  summary.expiresAt = 900; expect(validMemoryLineage(d, summary, 1)).toBe(true);
  source.revision++; expect(validMemoryLineage(d, summary, 1)).toBe(false);
});
