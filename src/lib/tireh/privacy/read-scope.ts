/**
 * Read-only scope for privacy reads.
 *
 * Inside `scope.run(fn)`, scope-aware stores (adaptive account documents, the
 * shared-memory document, Studio state) serve a call from a committed copy of
 * the document and do not rewrite it when the call leaves it unchanged. A call
 * that does change it (expiry normalisation, pruning, first creation, or a
 * genuine write that happens to run inside the scope) commits for real through
 * the ordinary transaction, exactly as before; the scope only records that a
 * write happened. A scope therefore never blocks, defers or drops a write.
 *
 * Two lifetimes:
 *  - `TurnReadScope.load()`, a turn snapshot: each document is loaded and
 *    parsed at most once and its revision probe recorded. The turn's revision
 *    compare fences concurrent writes made after the load.
 *  - `TurnReadScope.fresh()`, a standalone pure read (`readOnce`): every call
 *    loads the committed document again, so a read that re-reads to fence its
 *    own awaits still sees concurrent writes.
 * A replay (`scope.replay()`) re-evaluates a snapshot over the same loaded
 * documents with the current clock and never loads.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RevisionProbe } from './revisions';

export class SnapshotUnavailable extends Error {
  readonly name = 'SnapshotUnavailable';
  constructor() { super('Read-only snapshot does not hold this document'); }
}

/** One loaded document, shared by every call (and every replay) of a snapshot. */
export interface ScopedDocument<T = unknown> {
  readonly value: T;
  readonly probe: RevisionProbe;
  /** Per-document derived forms (parsed, canonical JSON), computed once. */
  readonly memo: Map<string, unknown>;
}

type Loaded = Promise<ScopedDocument>;
const active = new AsyncLocalStorage<TurnReadScope>();
const scoped = <T>(load: () => Promise<{ value: T; probe: RevisionProbe }>): Promise<ScopedDocument<T>> =>
  load().then(({ value, probe }) => ({ value, probe, memo: new Map<string, unknown>() }));

export class TurnReadScope {
  /** A real write committed inside the scope: values may mix pre- and post-write state. */
  wrote = false;
  /** A replay needed a document the snapshot never loaded. */
  missed = false;
  /** Some read bypassed the scope (no read-only path) or failed: probes do not cover every input. */
  incomplete = false;
  /** A source outside the probes was consulted (e.g. the relationship store). */
  volatile = false;
  private closed = false;

  private constructor(readonly mode: 'load' | 'replay' | 'fresh', private readonly documents: Map<object, Map<string, Loaded>>) {}
  /** Turn snapshot: each document loaded once, probes recorded. */
  static load(): TurnReadScope { return new TurnReadScope('load', new Map()); }
  /** Standalone pure read: every call loads the committed document again. */
  static fresh(): TurnReadScope { return new TurnReadScope('fresh', new Map()); }

  get isClosed(): boolean { return this.closed; }
  run<T>(fn: () => Promise<T>): Promise<T> { return active.run(this, fn); }
  close(): void { this.closed = true; }

  /** Committed copy of a document: memoised in a snapshot, fresh otherwise. A
   * replay that needs a document the snapshot never loaded fails. */
  document<T>(owner: object, key: string, load: () => Promise<{ value: T; probe: RevisionProbe }>): Promise<ScopedDocument<T>> {
    if (this.mode === 'fresh') return scoped(load);
    let byKey = this.documents.get(owner);
    if (!byKey) this.documents.set(owner, byKey = new Map());
    let entry = byKey.get(key);
    if (!entry) {
      if (this.mode === 'replay') { this.missed = true; return Promise.reject(new SnapshotUnavailable()); }
      entry = scoped(load);
      // A failed load is served as the same failure to every caller; no probe
      // vouches for it, so rechecks must recompute in full.
      entry.catch(() => { this.incomplete = true; });
      byKey.set(key, entry);
    }
    return entry as Promise<ScopedDocument<T>>;
  }

  /** A call changed the document and committed for real. A snapshot drops its
   * copy so later calls read the committed result, like sequential transactions. */
  committed(owner: object, key: string): void {
    this.wrote = true;
    if (this.mode === 'load') this.documents.get(owner)?.delete(key);
  }
  /** A real write the scope does not hold a copy for (e.g. Studio state update). */
  noteWrite(): void { this.wrote = true; }
  passThrough(): void { this.incomplete = true; }
  markVolatile(): void { this.volatile = true; }

  /** Probes of every document loaded and still held. Call after the scoped work settled. */
  async probes(): Promise<RevisionProbe[]> {
    const loaded = await Promise.allSettled([...this.documents.values()].flatMap(byKey => [...byKey.values()]));
    return loaded.flatMap(result => result.status === 'fulfilled' ? [result.value.probe] : []);
  }

  /** A scope over the same loaded documents that never loads again. */
  replay(): TurnReadScope { return new TurnReadScope('replay', this.documents); }
}

export function activeReadScope(): TurnReadScope | undefined {
  const scope = active.getStore();
  return scope && !scope.isClosed ? scope : undefined;
}

/** Derived form of a scoped document, computed once per snapshot. */
export function memoized<T>(document: ScopedDocument, name: string, compute: () => T): T {
  if (document.memo.has(name)) return document.memo.get(name) as T;
  const value = compute();
  document.memo.set(name, value);
  return value;
}

/**
 * Runs a pure read without rewriting the documents it reads; a call that does
 * change a document still commits. Inside an enclosing scope the read is
 * served by that scope.
 */
export async function readOnce<T>(read: () => Promise<T>): Promise<T> {
  if (activeReadScope()) return read();
  const scope = TurnReadScope.fresh();
  try { return await scope.run(read); } finally { scope.close(); }
}
