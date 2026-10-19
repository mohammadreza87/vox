import { type VersionedRecord } from './types';
import { validId, validRecord, validTime } from './identity';

export const CAPABILITIES = ['core_text', 'single_party_audio', 'multi_party_audio',
  'biometric_recognition', 'product_analytics', 'personalization', 'auto_memory',
  'reminder_delivery', 'proactive_suggestions', 'content_quality_review'] as const;
export type Capability = typeof CAPABILITIES[number];

export interface AdultEntry {
  readonly personId: string;
  readonly state: 'adult_confirmed' | 'unknown' | 'underage' | 'suspended';
  readonly method: 'explicit_declaration' | 'approved_verification';
  readonly effectiveAt: number;
  readonly expiresAt: number;
  readonly revision: number;
}

export interface JurisdictionApproval extends VersionedRecord {
  /** Exact server-resolved key, e.g. US-IL. No EU/US wildcard inheritance. */
  readonly jurisdiction: string;
  readonly capability: Capability;
  readonly state: 'blocked' | 'review_pending' | 'approved';
  readonly configurationVersion: string;
  readonly effectiveAt: number;
  readonly reviewExpiresAt: number;
  readonly owner: string;
  readonly approvalReference: string;
}

export interface CapabilityRequest {
  readonly capability: Capability;
  readonly personId: string;
  readonly configurationVersion: string;
  readonly enabled: boolean;
  readonly jurisdiction: { readonly status: 'known'; readonly requiredKeys: readonly string[] } |
    { readonly status: 'unknown' | 'conflicting' };
  readonly adultEntry: AdultEntry;
}

export type CapabilityDecision =
  | { readonly eligible: false; readonly reason: 'disabled' | 'adult_required' | 'jurisdiction_unknown' | 'approval_missing' | 'approval_invalid' | 'blocked' | 'review_pending' }
  | { readonly eligible: true; readonly validUntil: number; readonly approvalVersions: readonly string[] };

/** Eligibility alone grants neither content access nor consent/provider/capture permission. */
export function evaluateCapability(request: CapabilityRequest, approvals: readonly JurisdictionApproval[], now: number): CapabilityDecision {
  if (request.enabled !== true || !CAPABILITIES.includes(request.capability)) return { eligible: false, reason: 'disabled' };
  const adult = request.adultEntry;
  if (!validTime(now) || !validId(request.personId) || adult.personId !== request.personId ||
      adult.state !== 'adult_confirmed' || !['explicit_declaration', 'approved_verification'].includes(adult.method) ||
      !validTime(adult.effectiveAt) || adult.effectiveAt > now || !validTime(adult.expiresAt) || adult.expiresAt <= now ||
      !Number.isSafeInteger(adult.revision) || adult.revision < 1) return { eligible: false, reason: 'adult_required' };
  if (request.jurisdiction.status !== 'known' || !request.jurisdiction.requiredKeys.length ||
      !request.jurisdiction.requiredKeys.every(validId) ||
      new Set(request.jurisdiction.requiredKeys).size !== request.jurisdiction.requiredKeys.length) return { eligible: false, reason: 'jurisdiction_unknown' };
  const bounds = [adult.expiresAt];
  const versions: string[] = [];
  for (const key of request.jurisdiction.requiredKeys) {
    const matches = approvals.filter(a => a.jurisdiction === key && a.capability === request.capability);
    if (!matches.length) return { eligible: false, reason: 'approval_missing' };
    if (matches.length !== 1) return { eligible: false, reason: 'approval_invalid' };
    const approval = matches[0];
    if (!validRecord(approval, now) || !validId(request.configurationVersion) ||
        approval.configurationVersion !== request.configurationVersion || !validId(approval.owner) ||
        !validId(approval.approvalReference) || !validTime(approval.effectiveAt) || approval.effectiveAt > now ||
        !validTime(approval.reviewExpiresAt) || approval.reviewExpiresAt <= now) return { eligible: false, reason: 'approval_invalid' };
    if (approval.state === 'blocked') return { eligible: false, reason: 'blocked' };
    if (approval.state === 'review_pending') return { eligible: false, reason: 'review_pending' };
    if (approval.state !== 'approved') return { eligible: false, reason: 'approval_invalid' };
    bounds.push(approval.reviewExpiresAt);
    versions.push(JSON.stringify([approval.id, approval.revision]));
  }
  return { eligible: true, validUntil: Math.min(...bounds), approvalVersions: versions.sort() };
}
