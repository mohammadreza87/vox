/** The sole offline consumer of accepted LIP1 codec/adapter; no runtime entry. */
import { createHmac, randomBytes } from 'node:crypto';
import { adaptFixture } from '../adapters';
import { parseBoundedJson } from '../codec';
import { InventoryError, orderedReasons, safeStop } from '../contracts';
import { acquireOfflineSnapshot } from './acquire';
import { OFFLINE_LIMITS, OfflineError, checkCancelled, fixedStop, initialProgress, offlineReport, type OfflineInventoryReportV1 } from './contracts';

export async function inspectOfflineTirehSnapshot(snapshotFd: number, selectionFd: number, options?: { signal?: AbortSignal }): Promise<OfflineInventoryReportV1> {
  const progress = initialProgress();
  let bytes: Uint8Array | undefined, secret: Uint8Array | undefined;
  try {
    bytes = await acquireOfflineSnapshot(snapshotFd, selectionFd, progress, options?.signal);
    checkCancelled(options?.signal);
    let payload: unknown;
    const budget = { tokens: 0, depth: 0 };
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      payload = parseBoundedJson(text, budget);
    } catch (error) {
      throw new OfflineError(error instanceof InventoryError && safeStop(error, 'invalid_transport') === 'capacity_exceeded' ? 'capacity_exceeded' : 'invalid_native_json');
    }
    checkCancelled(options?.signal);
    let adapted;
    try { adapted = adaptFixture('tireh-file-state/1', payload, 0, 0, budget, options?.signal); }
    catch (error) {
      const stop = safeStop(error, 'internal_failed');
      throw new OfflineError(stop === 'cancelled' || stop === 'capacity_exceeded' ? stop : 'internal_failed');
    }
    if (adapted.candidates.length > OFFLINE_LIMITS.rows) throw new OfflineError('capacity_exceeded');
    const rows = adapted.candidates.map(candidate => candidate.row);
    const keys = new Map<string, number[]>();
    secret = randomBytes(32);
    try {
      for (const [index, candidate] of adapted.candidates.entries()) {
        checkCancelled(options?.signal);
        if (!candidate.key) continue;
        const hash = createHmac('sha256', secret).update(JSON.stringify(candidate.key)).digest('hex');
        const indices = keys.get(hash) ?? []; indices.push(index); keys.set(hash, indices);
      }
      for (const indices of keys.values()) if (indices.length > 1) for (const index of indices) {
        rows[index].reasons = orderedReasons([...rows[index].reasons, 'repeated_source_key']);
      }
    } finally { keys.clear(); }
    checkCancelled(options?.signal);
    const result = offlineReport(progress, adapted.unresolvedFragments ? 'unsupported_native_shape' : 'none', rows, adapted.unresolvedFragments);
    if (Buffer.byteLength(JSON.stringify(result)) + 1 > OFFLINE_LIMITS.reportBytes) throw new OfflineError('capacity_exceeded');
    checkCancelled(options?.signal);
    return result;
  } catch (error) { return offlineReport(progress, fixedStop(error, 'internal_failed')); }
  finally { bytes?.fill(0); secret?.fill(0); }
}
