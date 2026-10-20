/** LIA1-r2: offline inspection is a plan, never an authority or import operation. */
import { emptyCounts, type CountsV1, type PlanRowV1 } from '../contracts';

export const OFFLINE_LIMITS = Object.freeze({ selectionBytes: 4096, selectionTokens: 64, selectionDepth: 2,
  snapshotBytes: 524288, chunkBytes: 65536, readCalls: 4096, children: 1000, rows: 1001, reportBytes: 2 * 1024 * 1024 });
export const OFFLINE_STOPS = ['none', 'invalid_selection', 'invalid_descriptor', 'unsupported_platform',
  'source_changed', 'integrity_mismatch', 'input_truncated', 'capacity_exceeded', 'invalid_native_json',
  'unsupported_native_shape', 'cancelled', 'reader_failed', 'internal_failed'] as const;
export type OfflineStop = typeof OFFLINE_STOPS[number];
export interface OfflineSelectionV1 {
  schema: 'vox.legacy-offline-selection/1'; format: 'tireh-file-state/1';
  purpose: 'offline-deny-all-inventory'; expectedBytes: number; expectedSha256: string;
  provenance: 'operator_asserted_offline_copy';
}
export interface AcquisitionProgress {
  selectionBytesRead: number; selectionReadCalls: number; selectionEof: boolean;
  snapshotBytesRead: number; snapshotReadCalls: number; snapshotEof: boolean;
  acquisition: 'verified_selected_bytes' | 'failed' | 'not_started';
}
export interface OfflineInventoryReportV1 {
  schema: 'vox.legacy-offline-inventory-report/1'; mode: 'offline-snapshot-dry-run';
  policy: 'LIA1-deny-all-use'; outcome: 'inventory_plan_only';
  status: 'complete' | 'incomplete' | 'rejected'; stop: OfflineStop;
  acquisition: AcquisitionProgress;
  provenance: 'operator_assertion_only'; creatorConsistency: 'unavailable'; currentness: 'unavailable'; sourceCoverage: 'unavailable';
  selectedDocumentCoverage: 'complete' | 'unavailable'; counts: CountsV1;
  sources: Array<{ source: 0; adapter: 'tireh-file-state/1'; counts: CountsV1 }>; rows: PlanRowV1[];
  effects: { sourceByteMutations: 0; imports: 0; grants: 0; identityLinks: 0; consentReceipts: 0;
    enrollments: 0; notificationsQueued: 0; notificationsSent: 0; providerCalls: 0; durableRawCopies: 0; rollback: 'discard_plan_only' };
  limitations: ['selected_document_only', 'source_coverage_unavailable', 'provenance_not_authenticated', 'no_current_authority', 'no_import_or_restore'];
}
export class OfflineError extends Error {
  constructor(readonly code: OfflineStop) { super(code); this.name = 'OfflineError'; }
}
export function fixedStop(error: unknown, fallback: OfflineStop): OfflineStop {
  try {
    if (error instanceof OfflineError) {
      const code: unknown = error.code;
      if (OFFLINE_STOPS.some(s => s !== 'none' && s === code)) return code as OfflineStop;
    }
  } catch { /* Do not expose an untrusted code accessor. */ }
  return fallback;
}
export function validDescriptor(fd: unknown): fd is number {
  return typeof fd === 'number' && Number.isSafeInteger(fd) && fd >= 3 && fd <= 2147483647;
}
export function initialProgress(): AcquisitionProgress {
  return { selectionBytesRead: 0, selectionReadCalls: 0, selectionEof: false,
    snapshotBytesRead: 0, snapshotReadCalls: 0, snapshotEof: false, acquisition: 'not_started' };
}
export function checkCancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new OfflineError('cancelled'); }

/** Construct only from internal bounded rows and counts; raw objects never cross here. */
export function offlineReport(progress: AcquisitionProgress, stop: OfflineStop, rows: PlanRowV1[] = [], unresolved = 0): OfflineInventoryReportV1 {
  const counts = emptyCounts(1);
  if (rows.length) {
    counts.consumedUnits = 1; counts.inventoriedUnits = unresolved ? 0 : 1; counts.unresolvedFragments = unresolved;
    for (const row of rows) {
      if (row.kind === 'source_envelope') counts.envelopeRows++; else counts.childRows++;
      if (row.disposition === 'quarantine') counts.quarantineRows++; else counts.preserveSourceOnlyRows++;
      counts.byKind[row.kind]++;
      for (const reason of row.reasons) counts.byReason[reason]++;
    }
  }
  const complete = stop === 'none' && progress.acquisition === 'verified_selected_bytes' && !!rows.length && unresolved === 0;
  return { schema: 'vox.legacy-offline-inventory-report/1', mode: 'offline-snapshot-dry-run', policy: 'LIA1-deny-all-use',
    outcome: 'inventory_plan_only', status: stop === 'invalid_selection' || stop === 'invalid_descriptor' || stop === 'unsupported_platform' ? 'rejected' : complete ? 'complete' : 'incomplete', stop,
    acquisition: { selectionBytesRead: progress.selectionBytesRead, selectionReadCalls: progress.selectionReadCalls, selectionEof: progress.selectionEof,
      snapshotBytesRead: progress.snapshotBytesRead, snapshotReadCalls: progress.snapshotReadCalls, snapshotEof: progress.snapshotEof, acquisition: progress.acquisition },
    provenance: 'operator_assertion_only', creatorConsistency: 'unavailable', currentness: 'unavailable', sourceCoverage: 'unavailable',
    selectedDocumentCoverage: complete ? 'complete' : 'unavailable', counts, sources: [{ source: 0, adapter: 'tireh-file-state/1', counts: structuredClone(counts) }], rows,
    effects: { sourceByteMutations: 0, imports: 0, grants: 0, identityLinks: 0, consentReceipts: 0, enrollments: 0,
      notificationsQueued: 0, notificationsSent: 0, providerCalls: 0, durableRawCopies: 0, rollback: 'discard_plan_only' },
    limitations: ['selected_document_only', 'source_coverage_unavailable', 'provenance_not_authenticated', 'no_current_authority', 'no_import_or_restore'] };
}
