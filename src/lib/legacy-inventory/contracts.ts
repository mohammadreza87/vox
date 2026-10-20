/** LIP1-r2: synthetic-only inventory, with no authority or migration effects. */
export const ADAPTERS = ['tireh-file-state/1', 'tireh-document/1', 'tireh-org-config/1', 'app-contact-memory/1', 'app-user/1', 'app-chat/1', 'app-local-chats/1', 'studio-state/1'] as const;
export type AdapterV1 = typeof ADAPTERS[number];
export const KINDS = ['source_envelope', 'memory', 'memory_fact', 'summary', 'continuity', 'history', 'history_metadata', 'identity', 'notification_setting', 'share_offer', 'relationship_assertion', 'group_configuration', 'agent_configuration', 'scope_configuration', 'legacy_audit', 'control', 'opaque_fragment'] as const;
export type ItemKindV1 = typeof KINDS[number];
export const REASONS = ['dry_run_only', 'current_authority_unverified', 'identity_unverified', 'space_unresolved', 'audience_unresolved', 'purpose_unresolved', 'consent_not_established', 'history_policy_unresolved', 'subject_authority_unresolved', 'legacy_scope_not_transferable', 'historical_flag_not_consent', 'restrictive_flag_observed', 'missing_notification_setting', 'invalid_notification_setting', 'historical_configuration_not_grant', 'lineage_or_lifecycle_unverified', 'source_suppression_observed', 'superseded_or_expired_marker', 'repeated_source_key', 'conflicting_source_metadata', 'malformed_record', 'unsupported_fields', 'unsupported_fragment', 'source_control_preserved'] as const;
export type ReasonV1 = typeof REASONS[number];
export type StopV1 = 'none' | 'invalid_manifest' | 'invalid_transport' | 'unsupported_adapter' | 'invalid_payload' | 'input_truncated' | 'input_surplus' | 'byte_count_mismatch' | 'capacity_exceeded' | 'cancelled' | 'reader_failed' | 'internal_failed';
export const LIMITS = Object.freeze({ sources: 16, units: 2000, bytes: 64 * 1024 * 1024, chunkBytes: 64 * 1024, frameBytes: 1024 * 1024, depth: 32, tokens: 50_000, children: 1000, rows: 20_000, keyBytes: 256 });
export interface ManifestV1 {
  schema: 'vox.legacy-inventory-input/1'; mode: 'synthetic-dry-run'; policy: 'LIP1-deny-all-use';
  sources: Array<{ source: number; adapter: AdapterV1; expectedUnits: number }>;
  expectedTransportBytes: number;
}
export interface FixtureUnitV1 { schema: 'vox.legacy-fixture-unit/1'; source: number; unit: number; payload: unknown }
export interface PlanRowV1 {
  source: number; unit: number; item: number; kind: ItemKindV1;
  disposition: 'quarantine' | 'preserve_source_only'; reasons: ReasonV1[]; hasUnsupportedFields: boolean;
  notificationObservation: 'not_applicable' | 'true' | 'false' | 'missing' | 'invalid';
  proposedClass: 'memory_review' | 'history_review' | 'identity_review' | 'preference_review' | 'configuration_review' | 'source_controls' | 'unknown';
  target: null; currentAuthority: 'unverified'; use: 'denied';
}
export interface CountsV1 {
  expectedUnits: number; consumedUnits: number; inventoriedUnits: number; unresolvedFragments: number;
  envelopeRows: number; childRows: number; quarantineRows: number; preserveSourceOnlyRows: number;
  byKind: Record<ItemKindV1, number>; byReason: Record<ReasonV1, number>;
}
export interface InventoryReportV1 {
  schema: 'vox.legacy-inventory-report/1'; policy: 'LIP1-deny-all-use'; mode: 'synthetic-dry-run';
  status: 'complete' | 'incomplete' | 'rejected'; outcome: 'quarantine_plan_only'; stop: StopV1;
  bytesConsumed: number; endOfInputObserved: boolean; structuralCoverage: 'complete' | 'unavailable';
  counts: CountsV1; sources: Array<{ source: number; adapter: AdapterV1; counts: CountsV1 }>; rows: PlanRowV1[];
  effects: { writes: 0; imports: 0; grants: 0; identityLinks: 0; consentReceipts: 0; enrollments: 0; notificationsQueued: 0; notificationsSent: 0; providerCalls: 0; sourceMutation: 'none'; rollback: 'discard_plan_only' };
  limitations: ['fixtures_only', 'no_current_authority_verification', 'no_live_inventory', 'no_import_or_restore'];
}
/** Only constant codes cross the boundary; never retain an original error/cause. */
export class InventoryError extends Error {
  constructor(readonly code: StopV1) { super(code); this.name = 'InventoryError'; }
}
/** TypeScript types are not a runtime allowlist for errors thrown by a producer. */
export function safeStop(error: unknown, fallback: StopV1): StopV1 {
  try {
    if (error instanceof InventoryError) {
      const code: unknown = error.code;
      if (['invalid_manifest', 'invalid_transport', 'unsupported_adapter', 'invalid_payload', 'input_truncated', 'input_surplus', 'byte_count_mismatch', 'capacity_exceeded', 'cancelled', 'reader_failed', 'internal_failed'].some(allowed => allowed === code)) return code as StopV1;
    }
  } catch { /* Even an error's code accessor is untrusted. */ }
  return fallback;
}
export function emptyCounts(expectedUnits = 0): CountsV1 {
  return { expectedUnits, consumedUnits: 0, inventoriedUnits: 0, unresolvedFragments: 0, envelopeRows: 0, childRows: 0, quarantineRows: 0, preserveSourceOnlyRows: 0, byKind: Object.fromEntries(KINDS.map(k => [k, 0])) as Record<ItemKindV1, number>, byReason: Object.fromEntries(REASONS.map(k => [k, 0])) as Record<ReasonV1, number> };
}
export function orderedReasons(reasons: Iterable<ReasonV1>): ReasonV1[] {
  const set = new Set(reasons); return REASONS.filter(reason => set.has(reason));
}
