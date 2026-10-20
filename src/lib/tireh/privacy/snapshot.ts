/**
 * One read-only snapshot of a turn's privacy inputs.
 *
 * `loadSnapshot` runs the caller's own evaluation inside a turn read scope, so
 * every Studio, adaptive and shared read is served from one committed copy of
 * each document (loaded in parallel by `prefetch`, parsed once) and the probes
 * of those documents form the turn's revision vector. The value is exactly what
 * the evaluation computes from that committed state; nothing is re-derived.
 *
 * `replay()` re-runs the same evaluation over the same loaded documents with
 * the current clock and no I/O. A recheck whose revisions are unchanged uses it
 * to stay exact for time-based expiry (consent, binding, approval windows) and
 * for in-process configuration, without reloading anything.
 */
import { TurnReadScope } from './read-scope';
import type { RevisionVector } from './revisions';

export interface PrivacySnapshot<T> {
  readonly value: T;
  readonly vector: RevisionVector;
  /** Absent when the vector is incomplete. Null when the replay cannot be served from the loaded documents. */
  replay?(): Promise<{ value: T } | null>;
}

export async function loadSnapshot<T>(prefetch: () => Promise<unknown>, evaluate: () => Promise<T>): Promise<PrivacySnapshot<T>> {
  let value!: T;
  // A read that had to commit (expiry normalisation, first creation) leaves
  // values that may mix pre- and post-commit state: evaluate once more over
  // the committed documents. Normalisation is idempotent, so one retry settles.
  for (let attempt = 0; attempt < 2; attempt++) {
    const scope = TurnReadScope.load();
    try { value = await scope.run(async () => { await prefetch().catch(() => undefined); return evaluate(); }); }
    finally { scope.close(); }
    if (scope.wrote) continue;
    const probes = await scope.probes();
    const complete = !scope.incomplete && !scope.volatile;
    return { value, vector: { probes, complete }, ...(complete ? { replay: () => replay(scope, evaluate) } : {}) };
  }
  // Still writing after a committed attempt: serve this turn as before, with full rechecks.
  return { value, vector: { probes: [], complete: false } };
}

async function replay<T>(loaded: TurnReadScope, evaluate: () => Promise<T>): Promise<{ value: T } | null> {
  const scope = loaded.replay();
  try {
    const value = await scope.run(evaluate);
    return scope.wrote || scope.missed || scope.incomplete || scope.volatile ? null : { value };
  } catch { return null; }
  finally { scope.close(); }
}
