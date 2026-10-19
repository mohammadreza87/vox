import type { AccessRequest, ConsentPermission, Grant, Membership, Person, PolicySnapshot, Purpose } from '../index';

export const NOW = 10_000;
export const END = 20_000;
export const base = { schemaVersion: 1 as const, revision: 1, createdAt: 100, updatedAt: 100 };
export const scope = { tenantId: 'tenant', spaceId: 'work' };

export function person(id: string): Person {
  return { ...base, id, status: 'active' };
}

export function membership(personId: string): Membership {
  return { ...base, ...scope, id: `membership-${personId}`, containerId: 'container', personId,
    status: 'active', joinedAt: 100, expiresAt: END, policyEpoch: 1 };
}

export function grant(personId: string, purpose: Purpose = 'core.conversation'): Grant {
  return { ...base, ...scope, id: `grant-${personId}`, containerId: 'container',
    principal: { kind: 'person', id: personId }, operations: ['read'], purpose, purposeVersion: 1,
    status: 'active', expiresAt: END, policyEpoch: 1 };
}

export function consent(personId = 'alice'): ConsentPermission {
  return { ...base, ...scope, id: `consent-${personId}`, personId, purpose: 'optional.personalization',
    purposeVersion: 1, policyVersion: 'consent-1', state: 'granted', epoch: 1,
    effectiveAt: 100, expiresAt: END };
}

export function fixture(): { request: AccessRequest; snapshot: PolicySnapshot } {
  return {
    request: { identity: { authenticatedAccountId: 'shared-account', selectedPerson: {
      personId: 'alice', bindingId: 'binding-alice', bindingRevision: 1,
    } }, ...scope, containerId: 'container', resourceId: 'source', operation: 'read',
    purpose: 'core.conversation', purposeVersion: 1, consentPolicyVersion: 'consent-1',
    audience: { kind: 'known', personIds: ['alice'] } },
    snapshot: { schemaVersion: 1, policyVersion: 'policy-1',
      account: { ...base, id: 'shared-account', status: 'active', ownerPersonId: 'bob' },
      people: [person('alice')],
      binding: { ...base, id: 'binding-alice', accountId: 'shared-account', personId: 'alice',
        status: 'verified', method: 'authenticated_person_confirmation', verifiedAt: 100, expiresAt: END },
      space: { ...base, id: 'work', tenantId: 'tenant', kind: 'work', ownerAccountId: 'shared-account', status: 'active', policyEpoch: 1 },
      container: { ...base, ...scope, id: 'container', audience: { kind: 'private', ownerPersonId: 'alice' },
        status: 'active', policyEpoch: 1, spacePolicyEpoch: 1, historyPolicy: 'all_authorized_history' },
      resource: { ...base, ...scope, id: 'source', containerId: 'container', subjectPersonIds: ['alice'],
        status: 'active', expiresAt: END, revocationEpoch: 1 },
      memberships: [membership('alice')], grants: [grant('alice')], consents: [],
    },
  };
}
