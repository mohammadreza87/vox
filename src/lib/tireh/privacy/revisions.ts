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

/** The revisions a turn snapshot observed: every document it read, plus the memory safety revision and the privacy epoch. */
export interface RevisionVector {
  readonly probes: readonly RevisionProbe[];
  /** False when some input was read without a probe (no read-only path, a failed load, a source outside the probes): rechecks must recompute in full. */
  readonly complete: boolean;
}

/** Reads current revisions for a vector's probes. */
export interface RevisionSource {
  /** Current values in probe order: synchronous for in-process probes, one batched read for remote ones. Throws when a probe cannot be read. */
  read(probes: readonly RevisionProbe[]): Promise<number[]>;
  /** Change hint without I/O: true when an in-process probe moved, false when none did, undefined when only a remote read could tell. */
  changed(probes: readonly RevisionProbe[]): boolean | undefined;
}

export function sameRevisions(probes: readonly RevisionProbe[], values: readonly number[]): boolean {
  return probes.length === values.length && probes.every((probe, index) => probe.value === values[index]);
}

function localHint(probes: readonly RevisionProbe[]): boolean | undefined {
  let unknown = false;
  for (const probe of probes) {
    if (!probe.local) { unknown = true; continue; }
    if (probe.local() !== probe.value) return true;
  }
  return unknown ? undefined : false;
}

/** File / Mac profile: every probe is an in-process counter; a read is synchronous. */
export class InProcessRevisionSource implements RevisionSource {
  async read(probes: readonly RevisionProbe[]): Promise<number[]> {
    return probes.map(probe => {
      if (!probe.local) throw new Error('Revision probe is not readable in process');
      return probe.local();
    });
  }
  changed(probes: readonly RevisionProbe[]): boolean | undefined { return localHint(probes); }
}

/** Structural subset of firebase-admin's Firestore used for revision reads. */
export interface RevisionDocuments {
  doc(path: string): unknown;
  getAll(...refsOrOptions: unknown[]): Promise<Array<{ get(field: string): unknown }>>;
}

/** Firestore profile: one `getAll` of the few revision documents, masked to their counter fields. */
export class FirestoreRevisionSource implements RevisionSource {
  constructor(private readonly db: RevisionDocuments) {}
  async read(probes: readonly RevisionProbe[]): Promise<number[]> {
    const remote = [...new Map(probes.flatMap(probe => probe.remote ? [[probe.remote.path, probe.remote] as const] : [])).values()];
    const snapshots = remote.length
      ? await this.db.getAll(...remote.map(target => this.db.doc(target.path)), { fieldMask: [...new Set(remote.map(target => target.field))] })
      : [];
    if (snapshots.length !== remote.length) throw new Error('Incomplete revision read');
    const byPath = new Map(remote.map((target, index) => [target.path, snapshots[index]]));
    return probes.map(probe => {
      if (probe.local) return probe.local();
      if (!probe.remote) throw new Error('Revision probe is not readable');
      return revisionField(byPath.get(probe.remote.path)!.get(probe.remote.field));
    });
  }
  changed(probes: readonly RevisionProbe[]): boolean | undefined { return localHint(probes); }
}
