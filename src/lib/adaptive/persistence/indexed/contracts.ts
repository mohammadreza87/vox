import type { RightsUseControls } from '../../rights-use-holds/contracts';
/** Internal server-only persistence evidence. These records never grant Studio or
 * capability-policy authority and must never be accepted from an HTTP client. */
import type { ProductPauseUseControlsV1 } from '../../product-pause/contracts';
import type { AdaptiveDocument, OptionalPurpose, SpaceKind } from '../repository';

export const INDEXED_FORMAT_VERSION = 1 as const;
export const INDEXED_SCHEMA_VERSION = 1 as const;
export const INDEXED_LIMITS = Object.freeze({ memories: 300, canonicalBytes: 700_000,
  queryChars: 8192, queryTerms: 128, candidates: 64, bodyBytes: 128 * 1024, lineageDepth: 8 });
export interface IndexedStoreMetadata {
  formatVersion: 1; schemaVersion: 1 | 2 | 3; incarnation: string; generation: number; lifecycleWatermark: number;
}
export interface IndexedScope {
  accountId: string; personId: string; tenantId: string; space: SpaceKind; spaceId: string;
  containerId: string; agentId: string; purpose: OptionalPurpose | 'core_text';
}
/** A separate strict body-free schema, never a partial AdaptiveDocument. */
export interface IndexedControls {
  schemaVersion: 1 | 2 | 3; productPause?: ProductPauseUseControlsV1; rightsUseControls?:RightsUseControls; retentionStoreIdentity?:string; accountId: string; personId: string; createdAt: number; revision: number; updatedAt: number;
  binding?: AdaptiveDocument['binding']; declaration?: AdaptiveDocument['declaration'];
  permissions: AdaptiveDocument['permissions']; agentGrants: AdaptiveDocument['agentGrants'];
  preferences: AdaptiveDocument['experience']['preferences']; settings: AdaptiveDocument['experience']['settings'];
  predictionTurns: AdaptiveDocument['experience']['predictionTurns'];
  preferenceLearning?: AdaptiveDocument['experience']['preferenceLearning'];
  relationshipControls: AdaptiveDocument['relationships']['controls'];
  relationshipBindings: AdaptiveDocument['relationships']['bindings'];
  relationshipSources: AdaptiveDocument['relationships']['sources'];
  relationshipExternalSettings: AdaptiveDocument['relationships']['externalSettings'];
}
export interface IndexedIoCounters {
  canonicalImageReads: number; controlRowsRead: number; metadataRowsRead: number;
  postingRowsRead: number; bodyRowsRead: number; bodyBytesRead: number; watermarkWrites: number;
}
export const emptyIndexedIo = (): IndexedIoCounters => ({ canonicalImageReads: 0, controlRowsRead: 0,
  metadataRowsRead: 0, postingRowsRead: 0, bodyRowsRead: 0, bodyBytesRead: 0, watermarkWrites: 0 });
export type IndexedUnavailableReason = 'busy' | 'closed' | 'missing' | 'invalid_scope' | 'invalid_controls' |
  'clock_regression' | 'expired' | 'denied' | 'stale_receipt' | 'stale_handle' | 'stale_cursor' |
  'corrupt' | 'capacity' | 'commit_uncertain';
export type IndexedFailure = { status: 'unavailable'; reason: IndexedUnavailableReason; io: IndexedIoCounters };
export class IndexedStorageError extends Error {
  constructor(readonly reason: IndexedUnavailableReason, readonly committed: boolean | 'unknown' = false) {
    super(`Indexed adaptive storage unavailable: ${reason}`); this.name = 'IndexedStorageError';
  }
}
export interface RuntimeAuthorityReceipt {
  version: 1 | 2; incarnation: string; generation: number; catalogVersion: number; catalogDigest: string;
  scope: IndexedScope; issuedAt: number; deadline: number; seal: string;
}
export interface CandidateHandle {
  version: 1 | 2; incarnation: string; generation: number; catalogVersion: number; catalogDigest: string;
  deadline: number; scope: IndexedScope; id: string; revision: number; epoch: number;
  layer: 'summary' | 'memory'; sourceRefs: { id: string; revision: number }[];
  bodyBytes: number; bodyDigest: string; freshness: number; claim: boolean; seal: string;
}
export interface CandidateCursor {
  version: 1 | 2; incarnation: string; generation: number; catalogVersion: number; catalogDigest: string;
  scope: IndexedScope; deadline: number; queryDigest: string; offset: number; seal: string;
}
export interface IndexedControlStamp { incarnation: string; generation: number; catalogVersion: number; catalogDigest: string }
export interface IndexedControlEvaluation { deadline?: number; denied?: boolean; observedDenial?: boolean }
/** Trusted synchronous, side-effect-free, body-free code only. No host reentry.
 * Denied data remains data; this evaluator never mints a memory access receipt. */
export type IndexedControlEvaluator = (controls: Readonly<IndexedControls>, now: number, stamp: Readonly<IndexedControlStamp>) => IndexedControlEvaluation;
export type ControlsResult = { status: 'ready'; controls: IndexedControls; observedAt: number;
  /** Data-only current-state stamp, never a body access receipt. */
  stamp: IndexedControlStamp;
  io: IndexedIoCounters } | IndexedFailure;
export type AuthorityResult = { status: 'ready'; controls: IndexedControls; receipt: RuntimeAuthorityReceipt;
  /** Canonical identity/consent/grant checks only. Caller must evaluate current capability/Studio policy. */
  canonicalAllowed: true; io: IndexedIoCounters } | IndexedFailure;
export type CandidateResult = { status: 'ready'; completion: 'complete' | 'partial'; handles: CandidateHandle[];
  cursor?: CandidateCursor; io: IndexedIoCounters } | IndexedFailure;
export type BodyResult = { status: 'ready'; completion: 'complete' | 'partial';
  bodies: { handle: CandidateHandle; text: string; sourceIds?: string[] }[]; io: IndexedIoCounters } | IndexedFailure;
export type ValidationResult = { status: 'ready'; io: IndexedIoCounters } | IndexedFailure;
export interface IndexedAdaptiveQueries {
  /** Stable startup-validated namespace only; no catalog, lifecycle or access
   * authority. Safe to read inside canonical callbacks without nested SQL. */
  readonly identity: Readonly<Pick<IndexedStoreMetadata, 'incarnation' | 'generation'>>;
  readControls(accountId: string, space: SpaceKind, evaluateFresh?: IndexedControlEvaluator): ControlsResult;
  readRuntimeAuthority(scope: IndexedScope, now?: number): AuthorityResult;
  queryCandidateIds(scope: IndexedScope, query: string, receipt: RuntimeAuthorityReceipt, cursor?: CandidateCursor): CandidateResult;
  loadCandidateBodies(receipt: RuntimeAuthorityReceipt, handles: readonly CandidateHandle[]): BodyResult;
  validateRuntimeReceiptNow(receipt: RuntimeAuthorityReceipt): ValidationResult;
}
