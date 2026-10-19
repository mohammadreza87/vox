import type { AdaptiveDocument, StoredMemory } from '../persistence/repository';

/** One immutable validation pass. Memoized values are lineage heights (zero is
 * invalid), not a permission/content cache. Heights preserve the eight-node
 * depth bound even when a shared ancestor is first reached by a shorter path. */
function validationPass(d: AdaptiveDocument, now: number, ancestors: ReadonlySet<string> = new Set()) {
  const rows = new Map<string, StoredMemory>();
  let malformed = d.memories.length > 300 || ancestors.size >= 8;
  for (const row of d.memories) {
    if (rows.has(row.id)) malformed = true;
    rows.set(row.id, row);
  }
  const heights = new Map<string, number>(), visiting = new Set(ancestors);
  const height = (memory: StoredMemory): number => {
    if (malformed || visiting.has(memory.id)) return 0;
    // Pending new summaries may not yet be inserted, but cannot shadow a row.
    if (rows.has(memory.id) && rows.get(memory.id) !== memory) return 0;
    const cached = heights.get(memory.id);
    if (cached !== undefined) return cached;
    visiting.add(memory.id);
    let result = 1;
    const refs = memory.sourceRefs;
    if (memory.status !== 'active' || !memory.text?.trim() || memory.expiresAt <= now ||
        (refs && (!refs.length || refs.length > 8 || new Set(refs.map(ref => ref.id)).size !== refs.length))) result = 0;
    else for (const ref of refs ?? []) {
      const source = rows.get(ref.id);
      if (!source || source.space !== memory.space || source.revision !== ref.revision || memory.expiresAt > source.expiresAt) { result = 0; break; }
      const sourceHeight = height(source);
      if (!sourceHeight || sourceHeight >= 8) { result = 0; break; }
      result = Math.max(result, sourceHeight + 1);
    }
    visiting.delete(memory.id);
    heights.set(memory.id, result);
    return result;
  };
  return (memory: StoredMemory) => { const depth = height(memory); return depth > 0 && depth + ancestors.size <= 8; };
}

/** Sources always belong to the same private account aggregate and space.
 * An unknown, changed, cyclic or expired dependency is never usable context. */
export function validMemoryLineage(d: AdaptiveDocument, memory: StoredMemory, now: number, path = new Set<string>()): boolean {
  return validationPass(d, now, path)(memory);
}

/** Compute invalids against one immutable snapshot, then mutate. No memo may
 * outlive a mutation. Deleting a summary never deletes its authored sources. */
export function purgeInvalidDerivedMemory(d: AdaptiveDocument, now: number): boolean {
  const valid = validationPass(d, now);
  const invalid = d.memories.filter(memory => memory.sourceRefs && memory.status === 'active' && !valid(memory));
  for (const memory of invalid) {
    memory.status = 'deleted'; delete memory.text; memory.revision++; memory.revocationEpoch++; memory.updatedAt = now;
  }
  return invalid.length > 0;
}
