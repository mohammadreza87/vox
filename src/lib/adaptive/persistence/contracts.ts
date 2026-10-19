/** Browser-safe contract. A confirmed profile is account-confirmed, never biometric identity proof. */
export type AdaptiveSpace = 'work' | 'personal';
export const ADAPTIVE_OPTIONAL_PURPOSES = [
  'optional.product_analytics', 'optional.personalization', 'optional.auto_memory', 'optional.biometric_recognition',
  'optional.reminder_delivery', 'optional.proactive_suggestions', 'optional.content_quality_review', 'optional.relationship_outreach',
] as const;
export type AdaptiveOptionalPurpose = typeof ADAPTIVE_OPTIONAL_PURPOSES[number];
export interface AdaptiveNotice {
  id: string; version: string; title: string; body: string; locale: 'en' | 'fa'; copyHash: string;
}
export interface AdaptiveSnapshot {
  schemaVersion: 1;
  identity: { accountId: string; personId?: string; bindingId?: string; bindingRevision?: number; confirmed: boolean;
    bindingExpiresAt?: number; bindingCreatedAt?: number; bindingUpdatedAt?: number; bindingVerifiedAt?: number;
    verification: 'account_confirmation' | 'unconfirmed'; adultDeclared: boolean; declaredJurisdiction?: string };
  space: AdaptiveSpace;
  revision: number;
  purposes: { purpose: AdaptiveOptionalPurpose; state: string; revision: number; available: boolean; reason?: string; notice: AdaptiveNotice }[];
  memories: { id: string; revision: number; text: string; createdAt: number; expiresAt: number; origin?: 'user_reviewed_claim'; sourceRefs?: { id: string; revision: number }[] }[];
  agents: { agentId: string; allowed: boolean; revision: number }[];
  explicitMemoryAvailable: boolean;
  explicitMemoryValidUntil?: number;
  explicitMemoryReason?: string;
  /** No optional notices constitute acknowledgement of a legal privacy policy. */
  scope: 'private_account_profile';
}
export type AdaptivePresentation = AdaptiveSnapshot & { receipt: string; notice: AdaptiveNotice };
