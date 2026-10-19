import { describe, expect, it } from 'vitest';
import {
  authorizeAccess, evaluateCapability, isAuthorizationCurrent, resolveVerifiedPerson, transitionConsent,
  type AccessRequest, type CapabilityRequest, type ConsentCommand, type JurisdictionApproval,
  type PolicySnapshot,
} from '../index';
import { base, consent, END, fixture, grant, membership, NOW, person } from './fixtures';

function optionalFixture() {
  const { request, snapshot } = fixture();
  const optional: AccessRequest = { ...request, purpose: 'optional.personalization' };
  const permitted: PolicySnapshot = {
    ...snapshot, grants: [grant('alice', optional.purpose)], consents: [consent()],
  };
  return { request: optional, snapshot: permitted };
}

function capabilityFixture(): { request: CapabilityRequest; approvals: JurisdictionApproval[] } {
  return {
    request: {
      capability: 'auto_memory', personId: 'alice', configurationVersion: 'config-1', enabled: true,
      jurisdiction: { status: 'known', requiredKeys: ['US-IL', 'US-TX'] },
      adultEntry: { personId: 'alice', state: 'adult_confirmed', method: 'explicit_declaration',
        effectiveAt: 100, expiresAt: END, revision: 1 },
    },
    approvals: ['US-IL', 'US-TX'].map((jurisdiction, i) => ({
      ...base, id: `approval-${jurisdiction}`, jurisdiction, capability: 'auto_memory', state: 'approved',
      configurationVersion: 'config-1', effectiveAt: 100, reviewExpiresAt: END - i * 1000,
      owner: 'review-owner', approvalReference: 'synthetic-reference',
    })),
  };
}

describe('independent adaptive contract review', () => {
  it('account ownership and model hints cannot supply a missing person selection', () => {
    const { request, snapshot } = fixture();
    const identity = { authenticatedAccountId: snapshot.account.id,
      hint: { source: 'model_suggestion', claimedPersonId: 'alice' } };
    expect(resolveVerifiedPerson(identity, { ...snapshot.account, ownerPersonId: 'alice' }, snapshot.binding, NOW)).toBeUndefined();
    expect(authorizeAccess({ ...request, identity }, snapshot, NOW).allowed).toBe(false);
  });

  it('changing the selected person or binding revision cannot reuse verified selection', () => {
    const { request, snapshot } = fixture();
    const selection = request.identity.selectedPerson!;
    for (const patch of [{ personId: 'bob' }, { bindingId: 'another-binding' }, { bindingRevision: 2 }]) {
      expect(authorizeAccess({ ...request, identity: { ...request.identity, selectedPerson: { ...selection, ...patch } } }, snapshot, NOW).allowed).toBe(false);
    }
  });

  it('account confirmation cannot select someone other than the account owner', () => {
    const { request, snapshot } = fixture();
    const accountOnly = { ...snapshot.binding!, method: 'account_confirmation' as const };
    expect(snapshot.account.ownerPersonId).toBe('bob');
    expect(resolveVerifiedPerson(request.identity, snapshot.account, accountOnly, NOW)).toBeUndefined();
    expect(authorizeAccess(request, { ...snapshot, binding: accountOnly }, NOW).allowed).toBe(false);
    expect(resolveVerifiedPerson(request.identity, snapshot.account, snapshot.binding, NOW)).toBe('alice');
    expect(resolveVerifiedPerson(request.identity, { ...snapshot.account, ownerPersonId: 'alice' }, accountOnly, NOW)).toBe('alice');
  });

  it('exact-recipient output requires each current active person and their independent read grant', () => {
    const { request, snapshot } = fixture();
    const sharedRequest: AccessRequest = { ...request, audience: { kind: 'known', personIds: ['bob'] } };
    const shared: PolicySnapshot = {
      ...snapshot, people: [person('alice'), person('bob')],
      container: { ...snapshot.container, audience: { kind: 'exact_recipients', personIds: ['alice', 'bob'] } },
      memberships: [membership('alice'), membership('bob')], grants: [grant('alice'), grant('bob')],
    };
    expect(authorizeAccess(sharedRequest, shared, NOW).allowed).toBe(true);
    for (const status of ['suspended', 'deleted'] as const) {
      expect(authorizeAccess(sharedRequest, { ...shared, people: [person('alice'), { ...person('bob'), status }] }, NOW).allowed).toBe(false);
    }
    expect(authorizeAccess(sharedRequest, { ...shared, grants: [grant('alice'), { ...grant('bob'), operations: ['manage'] }] }, NOW).allowed).toBe(false);
    expect(authorizeAccess({ ...sharedRequest, audience: { kind: 'known', personIds: ['bob', 'eve'] } }, shared, NOW).allowed).toBe(false);
  });

  it('group history checks the newest recipient join and rejects old source lineage', () => {
    const { request, snapshot } = fixture();
    const sharedRequest: AccessRequest = { ...request, audience: { kind: 'known', personIds: ['alice', 'bob'] } };
    const grouped: PolicySnapshot = {
      ...snapshot, people: [person('alice'), person('bob')],
      container: { ...snapshot.container, audience: { kind: 'group', groupId: 'g' }, historyPolicy: 'since_membership' },
      memberships: [{ ...membership('alice'), groupId: 'g' }, { ...membership('bob'), groupId: 'g', joinedAt: 500 }],
      grants: [grant('alice'), grant('bob')],
    };
    expect(authorizeAccess(sharedRequest, grouped, NOW)).toEqual({ allowed: false, reason: 'history_denied' });
    expect(authorizeAccess(sharedRequest, { ...grouped, resource: { ...grouped.resource, createdAt: 500, updatedAt: 500 } }, NOW).allowed).toBe(true);
    // A new summary does not authorize its older source: every descriptor is checked.
    expect(authorizeAccess(sharedRequest, grouped, NOW).allowed).toBe(false);
  });

  it('optional processing requires active protected subjects even when they are not output recipients', () => {
    const { request, snapshot } = optionalFixture();
    const shared: PolicySnapshot = { ...snapshot, resource: { ...snapshot.resource, subjectPersonIds: ['bob'] },
      people: [person('alice'), person('bob')], consents: [consent(), consent('bob')] };
    expect(authorizeAccess(request, shared, NOW).allowed).toBe(true);
    expect(authorizeAccess(request, { ...shared, people: [person('alice')] }, NOW).allowed).toBe(false);
    for (const status of ['suspended', 'deleted'] as const) {
      expect(authorizeAccess(request, { ...shared, people: [person('alice'), { ...person('bob'), status }] }, NOW).allowed).toBe(false);
    }
  });

  it('container-wide epoch changes require explicit membership and grant refresh and invalidate old work', () => {
    const { request, snapshot } = fixture();
    const allowed = authorizeAccess(request, snapshot, NOW);
    if (!allowed.allowed) throw new Error('synthetic fixture denied');
    const advanced: PolicySnapshot = { ...snapshot, container: { ...snapshot.container, revision: 2, policyEpoch: 2 } };
    expect(authorizeAccess(request, advanced, NOW).allowed).toBe(false);
    const refreshed: PolicySnapshot = { ...advanced,
      memberships: [{ ...membership('alice'), revision: 2, policyEpoch: 2 }],
      grants: [{ ...grant('alice'), revision: 2, policyEpoch: 2 }],
    };
    expect(authorizeAccess(request, refreshed, NOW).allowed).toBe(true);
    expect(isAuthorizationCurrent(allowed.stamp, request, refreshed, NOW)).toBe(false);
  });

  it('a new matching binding revision needs a new selection and cannot revive prepared work', () => {
    const { request, snapshot } = fixture();
    const allowed = authorizeAccess(request, snapshot, NOW);
    if (!allowed.allowed) throw new Error('synthetic fixture denied');
    const updated = { ...snapshot, binding: { ...snapshot.binding!, revision: 2 } };
    const reselected: AccessRequest = { ...request, identity: { ...request.identity,
      selectedPerson: { ...request.identity.selectedPerson!, bindingRevision: 2 } } };
    expect(authorizeAccess(request, updated, NOW).allowed).toBe(false);
    expect(authorizeAccess(reselected, updated, NOW).allowed).toBe(true);
    expect(isAuthorizationCurrent(allowed.stamp, reselected, updated, NOW)).toBe(false);
  });

  it('the earliest binding, membership, grant, resource or consent expiry ends prepared optional access', () => {
    const { request, snapshot } = optionalFixture();
    for (const shorter of [
      { ...snapshot, binding: { ...snapshot.binding!, expiresAt: NOW + 1 } },
      { ...snapshot, memberships: [{ ...snapshot.memberships[0], expiresAt: NOW + 1 }] },
      { ...snapshot, grants: [{ ...snapshot.grants[0], expiresAt: NOW + 1 }] },
      { ...snapshot, resource: { ...snapshot.resource, expiresAt: NOW + 1 } },
      { ...snapshot, consents: [{ ...snapshot.consents[0], expiresAt: NOW + 1 }] },
    ]) {
      const allowed = authorizeAccess(request, shorter, NOW);
      if (!allowed.allowed) throw new Error('synthetic fixture denied');
      expect(allowed.stamp.validUntil).toBe(NOW + 1);
      expect(isAuthorizationCurrent(allowed.stamp, request, shorter, NOW + 1)).toBe(false);
    }
  });

  it('withdrawal immediately invalidates access, and regrant cannot reuse its earlier stamp', () => {
    const { request, snapshot } = optionalFixture();
    const allowed = authorizeAccess(request, snapshot, NOW);
    if (!allowed.allowed) throw new Error('synthetic fixture denied');
    const command: ConsentCommand = { eventId: 'withdrawal', expectedRevision: 1,
      actor: { accountId: 'shared-account', verifiedPersonId: 'alice' }, state: 'withdrawn', now: NOW };
    const withdrawn = transitionConsent(snapshot.consents[0], command);
    if (!withdrawn.ok) throw new Error(withdrawn.reason);
    expect(isAuthorizationCurrent(allowed.stamp, request, { ...snapshot, consents: [withdrawn.permission] }, NOW)).toBe(false);
    expect(transitionConsent(withdrawn.permission, command)).toEqual({ ok: true, duplicate: true, permission: withdrawn.permission });
    const regranted = { ...snapshot.consents[0], revision: 4, epoch: 4 };
    expect(authorizeAccess(request, { ...snapshot, consents: [regranted] }, NOW).allowed).toBe(true);
    expect(isAuthorizationCurrent(allowed.stamp, request, { ...snapshot, consents: [regranted] }, NOW)).toBe(false);
  });

  it.each(['declined', 'withdrawn', 'expired', 'suspended'] as const)(
    'a %s permission cannot reopen through an unsolicited presentation', (state) => {
      const command: ConsentCommand = { eventId: `present-${state}`, expectedRevision: 1,
        actor: { accountId: 'shared-account', verifiedPersonId: 'alice' }, state: 'presented', now: NOW };
      const permission = { ...consent(), state };
      expect(transitionConsent(permission, command)).toEqual({ ok: false, reason: 'invalid_transition' });
      const reopened = transitionConsent(permission, { ...command, deliberateReopen: true });
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(reopened.permission.state).toBe('presented');
      expect(reopened.permission.expiresAt).toBe(NOW);
    },
  );

  it('eligibility expires at the earliest exact jurisdiction or adult-entry expiry', () => {
    const { request, approvals } = capabilityFixture();
    expect(evaluateCapability(request, approvals, NOW)).toMatchObject({ eligible: true, validUntil: END - 1000 });
    expect(evaluateCapability(request, approvals, END - 1000).eligible).toBe(false);
    expect(evaluateCapability({ ...request, adultEntry: { ...request.adultEntry, expiresAt: NOW + 1 } }, approvals, NOW))
      .toMatchObject({ eligible: true, validUntil: NOW + 1 });
    expect(evaluateCapability({ ...request, adultEntry: { ...request.adultEntry, expiresAt: NOW + 1 } }, approvals, NOW + 1).eligible).toBe(false);
  });

  it('a current eligibility result grants neither missing content rights nor optional consent', () => {
    const capability = capabilityFixture();
    expect(evaluateCapability(capability.request, capability.approvals, NOW).eligible).toBe(true);
    const { request, snapshot } = optionalFixture();
    expect(authorizeAccess(request, { ...snapshot, consents: [] }, NOW).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, grants: [] }, NOW).allowed).toBe(false);
  });
});
