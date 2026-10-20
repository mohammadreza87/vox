/** Synthetic, in-memory plans only. Deliberately absent from runtime barrels. */
import { createHmac, randomBytes } from 'node:crypto';
import { adaptFixture } from './adapters';
import { readFixtureFrames } from './codec';
import { ADAPTERS, InventoryError, LIMITS, emptyCounts, orderedReasons, safeStop, type AdapterV1, type CountsV1, type InventoryReportV1, type ManifestV1, type PlanRowV1, type StopV1 } from './contracts';

function dataObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && !Object.getOwnPropertySymbols(value).length && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.getOwnPropertyNames(value); return actual.length === keys.length && actual.every(k => keys.includes(k));
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function validateManifest(value: unknown): ManifestV1 {
  if (!dataObject(value) || !exact(value, ['schema', 'mode', 'policy', 'sources', 'expectedTransportBytes']) || value.schema !== 'vox.legacy-inventory-input/1' || value.mode !== 'synthetic-dry-run' || value.policy !== 'LIP1-deny-all-use' || !nonnegative(value.expectedTransportBytes) || value.expectedTransportBytes > LIMITS.bytes || !Array.isArray(value.sources) || Object.getPrototypeOf(value.sources) !== Array.prototype || value.sources.length > LIMITS.sources) throw new InventoryError('invalid_manifest');
  if (!value.sources.length && value.expectedTransportBytes !== 0) throw new InventoryError('invalid_manifest');
  let total = 0;
  const sources: ManifestV1['sources'] = [];
  // Descriptor inspection avoids invoking arbitrary getters on manifest/source arrays.
  const descriptors = Object.getOwnPropertyDescriptors(value.sources);
  if (Object.keys(descriptors).length !== value.sources.length + 1 || Object.getOwnPropertySymbols(value.sources).length || Object.values(descriptors).some(d => !('value' in d))) throw new InventoryError('invalid_manifest');
  for (let i = 0; i < value.sources.length; i++) {
    const entry: unknown = descriptors[String(i)]?.value;
    if (!dataObject(entry) || !exact(entry, ['source', 'adapter', 'expectedUnits']) || entry.source !== i || !nonnegative(entry.expectedUnits)) throw new InventoryError('invalid_manifest');
    if (!ADAPTERS.some(a => a === entry.adapter)) throw new InventoryError('unsupported_adapter');
    total += entry.expectedUnits;
    if (total > LIMITS.units) throw new InventoryError('invalid_manifest');
    sources.push({ source: i, adapter: entry.adapter as AdapterV1, expectedUnits: entry.expectedUnits });
  }
  return { schema: 'vox.legacy-inventory-input/1', mode: 'synthetic-dry-run', policy: 'LIP1-deny-all-use', sources, expectedTransportBytes: value.expectedTransportBytes };
}
function countRows(counts: CountsV1, rows: PlanRowV1[]) {
  for (const row of rows) {
    if (row.kind === 'source_envelope') counts.envelopeRows++; else counts.childRows++;
    if (row.disposition === 'quarantine') counts.quarantineRows++; else counts.preserveSourceOnlyRows++;
    counts.byKind[row.kind]++;
    for (const reason of row.reasons) counts.byReason[reason]++;
  }
}
function report(sources: InventoryReportV1['sources'], rows: PlanRowV1[], progress: { bytesConsumed: number; endOfInputObserved: boolean }, stop: StopV1, rejected: boolean): InventoryReportV1 {
  const counts = emptyCounts(sources.reduce((n, s) => n + s.counts.expectedUnits, 0));
  // Rebuild counts only from admitted metadata/rows, including admitted duplicate annotations.
  for (const source of sources) {
    counts.consumedUnits += source.counts.consumedUnits;
    counts.inventoriedUnits += source.counts.inventoriedUnits;
    counts.unresolvedFragments += source.counts.unresolvedFragments;
    countRows(source.counts, rows.filter(r => r.source === source.source));
  }
  countRows(counts, rows);
  const complete = stop === 'none' && progress.endOfInputObserved && counts.unresolvedFragments === 0;
  return { schema: 'vox.legacy-inventory-report/1', policy: 'LIP1-deny-all-use', mode: 'synthetic-dry-run', status: rejected ? 'rejected' : complete ? 'complete' : 'incomplete', outcome: 'quarantine_plan_only', stop, bytesConsumed: progress.bytesConsumed, endOfInputObserved: progress.endOfInputObserved, structuralCoverage: complete ? 'complete' : 'unavailable', counts, sources, rows, effects: { writes: 0, imports: 0, grants: 0, identityLinks: 0, consentReceipts: 0, enrollments: 0, notificationsQueued: 0, notificationsSent: 0, providerCalls: 0, sourceMutation: 'none', rollback: 'discard_plan_only' }, limitations: ['fixtures_only', 'no_current_authority_verification', 'no_live_inventory', 'no_import_or_restore'] };
}

export async function planLegacyFixtures(manifest: ManifestV1, chunks: AsyncIterable<Uint8Array>, options?: { signal?: AbortSignal }): Promise<InventoryReportV1> {
  const progress = { bytesConsumed: 0, endOfInputObserved: false };
  let checked: ManifestV1;
  try { checked = validateManifest(manifest); }
  catch (e) { return report([], [], progress, safeStop(e, 'invalid_manifest'), true); }
  const sources = checked.sources.map(s => ({ source: s.source, adapter: s.adapter, counts: emptyCounts(s.expectedUnits) }));
  const rows: PlanRowV1[] = [];
  let stop: StopV1 = 'none', sourceIndex = 0;
  const duplicateIndex = new Map<string, number[]>();
  let secret: Uint8Array | undefined;
  const checkCancellation = () => { if (options?.signal?.aborted) throw new InventoryError('cancelled'); };
  try {
    checkCancellation();
    secret = randomBytes(32);
    for await (const frame of readFixtureFrames(chunks, progress, options?.signal)) {
      checkCancellation();
      while (sourceIndex < sources.length && sources[sourceIndex].counts.consumedUnits === sources[sourceIndex].counts.expectedUnits) sourceIndex++;
      if (sourceIndex >= sources.length) throw new InventoryError('input_surplus');
      const value = frame.value;
      if (!dataObject(value) || !exact(value, ['schema', 'source', 'unit', 'payload']) || value.schema !== 'vox.legacy-fixture-unit/1' || !nonnegative(value.source) || !nonnegative(value.unit) || value.source !== sourceIndex || value.unit !== sources[sourceIndex].counts.consumedUnits) throw new InventoryError('invalid_transport');
      const adapted = adaptFixture(sources[sourceIndex].adapter, value.payload, sourceIndex, value.unit, frame.budget, options?.signal);
      if (rows.length + adapted.candidates.length > LIMITS.rows) throw new InventoryError('capacity_exceeded');
      // This scratch graph never aliases an array owned by the committed index.
      const stagedIndex = new Map<string, number[]>(), annotations = new Set<number>();
      for (const [offset, candidate] of adapted.candidates.entries()) {
        checkCancellation();
        if (!candidate.key) continue;
        const hash = createHmac('sha256', secret).update(JSON.stringify(candidate.key)).digest('hex');
        const previous = stagedIndex.get(hash) ?? duplicateIndex.get(hash) ?? [];
        const next = [...previous, rows.length + offset];
        stagedIndex.set(hash, next);
        if (next.length > 1) for (const index of next) annotations.add(index);
      }
      checkCancellation();
      // Synchronous admission boundary: no callback/await and no failure-capable parsing.
      for (const candidate of adapted.candidates) rows.push(candidate.row);
      for (const index of annotations) rows[index].reasons = orderedReasons([...rows[index].reasons, 'repeated_source_key']);
      for (const [hash, indices] of stagedIndex) duplicateIndex.set(hash, indices);
      const counts = sources[sourceIndex].counts;
      counts.consumedUnits++;
      counts.unresolvedFragments += adapted.unresolvedFragments;
      if (!adapted.unresolvedFragments) counts.inventoriedUnits++;
    }
    if (sources.some(s => s.counts.consumedUnits !== s.counts.expectedUnits)) stop = 'input_truncated';
    else if (progress.bytesConsumed !== checked.expectedTransportBytes) stop = 'byte_count_mismatch';
    else if (sources.some(s => s.counts.unresolvedFragments)) stop = 'invalid_payload';
  } catch (e) { stop = safeStop(e, 'internal_failed'); }
  finally { duplicateIndex.clear(); secret?.fill(0); secret = undefined; }
  return report(sources, rows, progress, stop, false);
}
