/** Draft engineering contract. These types do not establish identity or legal approval. */
export const ADAPTIVE_SCHEMA_VERSION = 1 as const;

export interface VersionedRecord {
  readonly schemaVersion: typeof ADAPTIVE_SCHEMA_VERSION;
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ScopedRecord extends VersionedRecord {
  readonly tenantId: string;
  readonly spaceId: string;
}

export interface Account extends VersionedRecord {
  readonly status: 'active' | 'suspended';
  /** Administrative fact only: never substitutes for the selected, verified person. */
  readonly ownerPersonId: string;
}

export interface Person extends VersionedRecord {
  readonly status: 'active' | 'suspended' | 'deleted';
}

export interface PersonAccountBinding extends VersionedRecord {
  readonly accountId: string;
  readonly personId: string;
  readonly status: 'verified' | 'pending' | 'revoked';
  readonly method: 'account_confirmation' | 'authenticated_person_confirmation';
  readonly verifiedAt: number;
  readonly expiresAt: number;
}

export interface IdentityContext {
  /** Supplied by authenticated server middleware, never by a speaker/model claim. */
  readonly authenticatedAccountId: string;
  readonly selectedPerson?: {
    readonly personId: string;
    readonly bindingId: string;
    readonly bindingRevision: number;
  };
}

/** Non-authoritative data: intentionally absent from IdentityContext and policy input. */
export interface IdentityHint {
  readonly source: 'speaker_label' | 'voice_match' | 'model_suggestion';
  readonly claimedPersonId?: string;
  readonly speakerLabel?: string;
}

export interface Space extends VersionedRecord {
  readonly tenantId: string;
  readonly kind: 'work' | 'personal';
  readonly ownerAccountId: string;
  readonly status: 'active' | 'suspended';
  readonly policyEpoch: number;
}

export type ContainerAudience =
  | { readonly kind: 'private'; readonly ownerPersonId: string }
  | { readonly kind: 'group'; readonly groupId: string }
  | { readonly kind: 'exact_recipients'; readonly personIds: readonly string[] };

export interface Container extends ScopedRecord {
  readonly audience: ContainerAudience;
  readonly status: 'active' | 'deleted';
  readonly policyEpoch: number;
  /** Invalidated when the parent space policy changes; must be explicitly refreshed. */
  readonly spacePolicyEpoch: number;
  readonly historyPolicy: 'all_authorized_history' | 'since_membership';
}

export interface Membership extends ScopedRecord {
  readonly containerId: string;
  readonly personId: string;
  /** Group memberships must match the container's exact group. */
  readonly groupId?: string;
  readonly status: 'active' | 'revoked';
  readonly joinedAt: number;
  readonly expiresAt: number;
  readonly policyEpoch: number;
}

export const OPERATIONS = ['read', 'contribute', 'edit', 'reshare', 'manage', 'delete'] as const;
export type Operation = typeof OPERATIONS[number];
export type Principal = { readonly kind: 'person' | 'agent'; readonly id: string };

export const PURPOSES = [
  'core.conversation', 'ops.security_reliability', 'explicit.memory_request',
  'optional.product_analytics', 'optional.personalization', 'optional.auto_memory',
  'optional.biometric_recognition', 'optional.reminder_delivery',
  'optional.proactive_suggestions', 'optional.content_quality_review',
  'optional.marketing', 'model_training',
] as const;
export type Purpose = typeof PURPOSES[number];

export interface Grant extends ScopedRecord {
  readonly containerId: string;
  readonly principal: Principal;
  readonly operations: readonly Operation[];
  readonly purpose: Purpose;
  readonly purposeVersion: number;
  readonly status: 'active' | 'revoked';
  readonly expiresAt: number;
  readonly policyEpoch: number;
}

export type ConsentState = 'not_asked' | 'presented' | 'granted' | 'declined' |
  'withdrawn' | 'expired' | 'reconsent_required' | 'suspended';

export interface ConsentPermission extends ScopedRecord {
  readonly personId: string;
  readonly purpose: Purpose;
  readonly purposeVersion: number;
  readonly policyVersion: string;
  readonly state: ConsentState;
  readonly epoch: number;
  readonly effectiveAt: number;
  readonly expiresAt: number;
  readonly lastEventId?: string;
  readonly lastCommandFingerprint?: string;
}

export interface ConsentEvidence {
  readonly kind: 'consent';
  readonly noticeId: string;
  readonly noticeVersion: string;
  readonly renderedCopyHash: string;
  readonly locale: 'en' | 'fa';
  readonly presentedAt: number;
  readonly affirmative: true;
}

/** A notice acknowledgement can never be used as ConsentEvidence. */
export interface NoticeAcknowledgement extends ScopedRecord {
  readonly kind: 'notice_acknowledgement';
  readonly personId: string;
  readonly noticeVersion: string;
}

/** Trusted server metadata for the exact source/projection; never text from a model. */
export interface ResourceDescriptor extends ScopedRecord {
  readonly containerId: string;
  readonly subjectPersonIds: readonly string[];
  readonly status: 'active' | 'deleted';
  readonly expiresAt: number;
  readonly revocationEpoch: number;
}

export type Audience =
  | { readonly kind: 'known'; readonly personIds: readonly string[] }
  | { readonly kind: 'unknown' };

export interface AccessRequest {
  readonly identity: IdentityContext;
  readonly tenantId: string;
  readonly spaceId: string;
  readonly containerId: string;
  readonly resourceId: string;
  readonly operation: Operation;
  readonly purpose: Purpose;
  readonly purposeVersion: number;
  readonly consentPolicyVersion: string;
  readonly audience: Audience;
  readonly agentId?: string;
}

export interface PolicySnapshot {
  readonly schemaVersion: typeof ADAPTIVE_SCHEMA_VERSION;
  /** Read from the authoritative store; callers must not concatenate stale snapshots. */
  readonly policyVersion: string;
  readonly account: Account;
  /** Current actor/recipient/subject records; never a directory-wide permission grant. */
  readonly people: readonly Person[];
  readonly binding?: PersonAccountBinding;
  readonly space: Space;
  readonly container: Container;
  readonly resource: ResourceDescriptor;
  readonly memberships: readonly Membership[];
  readonly grants: readonly Grant[];
  readonly consents: readonly ConsentPermission[];
}

export type DenialReason = 'invalid_contract' | 'identity_unverified' | 'scope_mismatch' |
  'inactive_resource' | 'unknown_audience' | 'audience_denied' | 'membership_denied' |
  'history_denied' | 'grant_denied' | 'consent_denied' | 'purpose_disabled';

export interface AuthorizationStamp {
  readonly schemaVersion: typeof ADAPTIVE_SCHEMA_VERSION;
  readonly policyVersion: string;
  readonly requestFingerprint: string;
  readonly versions: readonly string[];
  readonly validUntil: number;
}

export type AccessDecision =
  | { readonly allowed: false; readonly reason: DenialReason }
  | { readonly allowed: true; readonly personId: string; readonly stamp: AuthorizationStamp };
