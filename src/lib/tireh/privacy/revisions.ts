/**
 * Monotonic revisions of every input the turn privacy boundary covers.
 *
 * A turn loads its privacy inputs once (see `read-scope.ts`) and records, for
 * each document it read, a probe: the document's revision observed no later
 * than the read, plus how to read that revision again. Rechecks compare the
 * probes instead of reloading and re-deriving every input. Probes are
 * process-local: they are never persisted or logged and carry no content.
 */

/** One document's revision as observed by a turn snapshot. */
export interface RevisionProbe {
  /** Unique in this process: the owning store instance plus the document. */
  readonly key: string;
  /** Value observed before (or atomically with) the read of the document. */
  readonly value: number;
  /** In-process stores (file / Mac profile): synchronous current value. */
  readonly local?: () => number;
  /** Firestore stores: the document path and the numeric field holding the counter. */
  readonly remote?: { readonly path: string; readonly field: string };
}

let instances = 0;

/**
 * The in-process bus: one monotonic counter per document, bumped by the
 * owning store after every commit in this process. Correct for the
 * single-process Mac profile, the same topology `StudioStore` already assumes
 * by caching its state in memory.
 */
export class RevisionCounter {
  private readonly values = new Map<string, number>();
  private readonly id: string;
  constructor(name: string) { this.id = `${name}#${++instances}`; }
  get(key: string): number { return this.values.get(key) ?? 0; }
  bump(key: string): void {
    const next = this.get(key) + 1;
    if (!Number.isSafeInteger(next)) throw new Error('Revision counter exhausted');
    this.values.set(key, next);
  }
  /** Capture before reading the document: a commit racing the read can only make the probe look stale (fail closed). */
  probe(key: string): RevisionProbe {
    return { key: `${this.id}:${key}`, value: this.get(key), local: () => this.get(key) };
  }
}

/** Unique probe-key prefix for stores whose revisions live in their own maps. */
export function revisionOwnerId(name: string): string { return `${name}#${++instances}`; }

/** Firestore numeric revision fields default to zero for documents written before the field existed. */
export function revisionField(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
