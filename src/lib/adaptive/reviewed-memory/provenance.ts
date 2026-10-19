import type { AdaptiveDocument, StoredMemory } from '../persistence/repository';

/** Sources always belong to the same private account aggregate and space.
 * An unknown, changed, cyclic or expired dependency is never usable context. */
export function validMemoryLineage(d: AdaptiveDocument, memory: StoredMemory, now: number, path = new Set<string>()): boolean {
  if (memory.status !== 'active' || !memory.text?.trim() || memory.expiresAt <= now || path.has(memory.id) || path.size >= 8) return false;
  if (!memory.sourceRefs) return true;
  if (!memory.sourceRefs.length || memory.sourceRefs.length > 8 || new Set(memory.sourceRefs.map(ref => ref.id)).size !== memory.sourceRefs.length) return false;
  const next = new Set(path).add(memory.id);
  return memory.sourceRefs.every(ref => {
    const source = d.memories.find(row => row.id === ref.id);
    return !!source && source.space === memory.space && source.revision === ref.revision && memory.expiresAt <= source.expiresAt && validMemoryLineage(d, source, now, next);
  });
}

/** One-way invalidation: deleting a summary never deletes its authored sources. */
export function purgeInvalidDerivedMemory(d: AdaptiveDocument, now: number): boolean {
  let changed = false;
  for (const memory of d.memories) if (memory.sourceRefs && memory.status === 'active' && !validMemoryLineage(d, memory, now)) {
    memory.status = 'deleted'; delete memory.text; memory.revision++; memory.revocationEpoch++; memory.updatedAt = now;
    changed = true;
  }
  return changed;
}

