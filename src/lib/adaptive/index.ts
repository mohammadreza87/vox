export * from './types';
export { resolveVerifiedPerson } from './identity';
export { authorizeAccess, isAuthorizationCurrent, requiresConsent } from './policy';
export { transitionConsent } from './consent';
export type { ConsentCommand, ConsentEvent, ConsentTransition } from './consent';
export { CAPABILITIES, evaluateCapability } from './eligibility';
export type { Capability, AdultEntry, JurisdictionApproval, CapabilityRequest, CapabilityDecision } from './eligibility';
