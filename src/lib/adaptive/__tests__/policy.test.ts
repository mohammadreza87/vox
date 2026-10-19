import { describe, expect, it } from 'vitest';
import { authorizeAccess, isAuthorizationCurrent, resolveVerifiedPerson, type AccessRequest, type PolicySnapshot } from '../index';
import { END, NOW, consent, fixture, grant, membership, person } from './fixtures';

describe('explicit person verification', () => {
  it('selects the authenticated verified person independently of the account owner', () => {
    const { request, snapshot } = fixture();
    expect(snapshot.account.ownerPersonId).toBe('bob');
    expect(resolveVerifiedPerson(request.identity, snapshot.account, snapshot.binding, NOW)).toBe('alice');
    expect(authorizeAccess(request, snapshot, NOW).allowed).toBe(true);
  });

  it('account ownership or a selected person without a binding never opens private context', () => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess({ ...request, identity: { authenticatedAccountId: 'shared-account' } }, snapshot, NOW)).toEqual({ allowed: false, reason: 'identity_unverified' });
    expect(authorizeAccess(request, { ...snapshot, binding: undefined }, NOW).allowed).toBe(false);
    expect(authorizeAccess({ ...request, identity: { ...request.identity, selectedPerson: {
      personId: 'bob', bindingId: 'binding-alice', bindingRevision: 1,
    } } }, snapshot, NOW).allowed).toBe(false);
  });

  it('requires the other person\'s authenticated confirmation when sharing an account', () => {
    const { request, snapshot } = fixture();
    const accountConfirmed = { ...snapshot, binding: { ...snapshot.binding!, method: 'account_confirmation' as const } };
    expect(authorizeAccess(request, accountConfirmed, NOW)).toEqual({ allowed: false, reason: 'identity_unverified' });
    expect(authorizeAccess(request, { ...accountConfirmed, account: { ...snapshot.account, ownerPersonId: 'alice' } }, NOW).allowed).toBe(true);
    expect(authorizeAccess(request, snapshot, NOW).allowed).toBe(true);
  });

  it.each(['pending', 'revoked'] as const)('rejects a %s person binding', status => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess(request, { ...snapshot, binding: { ...snapshot.binding!, status } }, NOW).allowed).toBe(false);
  });

  it.each(['suspended', 'deleted'] as const)('rejects a %s person even with an active account and verified binding', status => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess(request, { ...snapshot, people: [{ ...person('alice'), status }] }, NOW))
      .toEqual({ allowed: false, reason: 'identity_unverified' });
    expect(authorizeAccess(request, { ...snapshot, people: [person('bob')] }, NOW).allowed).toBe(false);
  });

  it('rejects stale binding revisions, other accounts, future verification and expired proof', () => {
    const { request, snapshot } = fixture();
    for (const patch of [{ revision: 2 }, { accountId: 'another' }, { verifiedAt: NOW + 1 }, { expiresAt: NOW }]) {
      expect(authorizeAccess(request, { ...snapshot, binding: { ...snapshot.binding!, ...patch } }, NOW).allowed).toBe(false);
    }
    // Untrusted extra fields cannot override the missing explicit verified selection.
    const hinted = { authenticatedAccountId: 'shared-account', speakerLabel: 'alice', claimedPersonId: 'alice' };
    expect(authorizeAccess({ ...request, identity: hinted }, snapshot, NOW).allowed).toBe(false);
  });
});

describe('exact scopes and audiences', () => {
  it.each(['tenantId', 'spaceId', 'containerId', 'resourceId'] as const)('rejects an altered %s', field => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess({ ...request, [field]: 'elsewhere' }, snapshot, NOW)).toEqual({ allowed: false, reason: 'scope_mismatch' });
  });

  it('never mixes Work and Personal containers even when their recipients match', () => {
    const { request, snapshot } = fixture();
    const personal = { ...request, spaceId: 'personal' };
    expect(authorizeAccess(personal, snapshot, NOW).allowed).toBe(false);
    expect(authorizeAccess(personal, { ...snapshot,
      space: { ...snapshot.space, id: 'personal', kind: 'personal' },
      container: { ...snapshot.container, spaceId: 'personal' },
      resource: { ...snapshot.resource, spaceId: 'personal' },
    }, NOW).allowed).toBe(false); // Work membership/grants do not migrate.
  });

  it('fails closed for unknown, empty or duplicate audiences', () => {
    const { request, snapshot } = fixture();
    for (const audience of [{ kind: 'unknown' as const }, { kind: 'known' as const, personIds: [] },
      { kind: 'known' as const, personIds: ['alice', 'alice'] }]) {
      expect(authorizeAccess({ ...request, audience }, snapshot, NOW)).toEqual({ allowed: false, reason: 'unknown_audience' });
    }
  });

  it('an account owner or guest added to the audience cannot read a private source', () => {
    const { request, snapshot } = fixture();
    for (const id of ['bob', 'guest']) {
      expect(authorizeAccess({ ...request, audience: { kind: 'known', personIds: ['alice', id] } }, {
        ...snapshot, memberships: [...snapshot.memberships, membership(id)], grants: [...snapshot.grants, grant(id)],
      }, NOW)).toEqual({ allowed: false, reason: 'audience_denied' });
    }
  });

  it('exact recipients require membership and read rights for every recipient', () => {
    const { request, snapshot } = fixture();
    const sharedRequest: AccessRequest = { ...request, audience: { kind: 'known', personIds: ['alice', 'bob'] } };
    const shared: PolicySnapshot = { ...snapshot,
      people: [person('alice'), person('bob')],
      container: { ...snapshot.container, audience: { kind: 'exact_recipients', personIds: ['alice', 'bob'] } },
      memberships: [membership('alice'), membership('bob')], grants: [grant('alice'), grant('bob')],
    };
    expect(authorizeAccess(sharedRequest, shared, NOW).allowed).toBe(true);
    expect(authorizeAccess(sharedRequest, { ...shared, people: [person('alice'), { ...person('bob'), status: 'suspended' }] }, NOW).allowed).toBe(false);
    expect(authorizeAccess(sharedRequest, { ...shared, people: [person('alice')] }, NOW).allowed).toBe(false);
    expect(authorizeAccess(sharedRequest, { ...shared, grants: [grant('alice')] }, NOW).allowed).toBe(false);
    expect(authorizeAccess(sharedRequest, { ...shared, memberships: [membership('alice')] }, NOW).allowed).toBe(false);
    expect(authorizeAccess({ ...sharedRequest, audience: { kind: 'known', personIds: ['alice', 'guest'] } }, shared, NOW).allowed).toBe(false);
  });

  it('requires current exact group membership and applies the explicit history policy', () => {
    const { request, snapshot } = fixture();
    const grouped: PolicySnapshot = { ...snapshot,
      container: { ...snapshot.container, audience: { kind: 'group', groupId: 'group-1' }, historyPolicy: 'since_membership' },
      memberships: [{ ...membership('alice'), groupId: 'group-1', joinedAt: 200 }],
    };
    expect(authorizeAccess(request, grouped, NOW)).toEqual({ allowed: false, reason: 'history_denied' });
    const current = { ...grouped, resource: { ...grouped.resource, createdAt: 200, updatedAt: 200 } };
    expect(authorizeAccess(request, current, NOW).allowed).toBe(true);
    expect(authorizeAccess(request, { ...current, memberships: [{ ...membership('alice'), groupId: 'different' }] }, NOW).allowed).toBe(false);
  });
});

describe('operation, agent and purpose intersections', () => {
  it.each(['contribute', 'edit', 'reshare', 'manage', 'delete'] as const)('read alone never grants %s', operation => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess({ ...request, operation }, snapshot, NOW)).toEqual({ allowed: false, reason: 'grant_denied' });
  });

  it('contribution alone permits a scoped write but cannot load or disclose source text', () => {
    const { request, snapshot } = fixture();
    const contributor: PolicySnapshot = { ...snapshot, grants: [{ ...grant('alice'), operations: ['contribute'] }] };
    expect(authorizeAccess({ ...request, operation: 'contribute' }, contributor, NOW).allowed).toBe(true);
    expect(authorizeAccess(request, contributor, NOW).allowed).toBe(false);
  });

  it('an agent needs its own purpose and operation grant as well as the person grant', () => {
    const { request, snapshot } = fixture();
    const agentRequest = { ...request, agentId: 'agent-1' };
    expect(authorizeAccess(agentRequest, snapshot, NOW).allowed).toBe(false);
    const agentGrant = { ...grant('agent-1'), principal: { kind: 'agent' as const, id: 'agent-1' } };
    const agentSnapshot = { ...snapshot, grants: [...snapshot.grants, agentGrant] };
    expect(authorizeAccess(agentRequest, agentSnapshot, NOW).allowed).toBe(true);
    expect(authorizeAccess({ ...agentRequest, agentId: 'agent-2' }, agentSnapshot, NOW).allowed).toBe(false);
    expect(authorizeAccess(agentRequest, { ...agentSnapshot, grants: [agentGrant] }, NOW).allowed).toBe(false);
  });

  it('rejects mismatched purpose/version and disabled training/marketing', () => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess({ ...request, purpose: 'ops.security_reliability' }, snapshot, NOW).allowed).toBe(false);
    expect(authorizeAccess({ ...request, purposeVersion: 2 }, snapshot, NOW).allowed).toBe(false);
    for (const purpose of ['model_training', 'optional.marketing'] as const) {
      expect(authorizeAccess({ ...request, purpose }, snapshot, NOW)).toEqual({ allowed: false, reason: 'purpose_disabled' });
    }
  });

  it('optional processing needs exact current consent for actor and every source subject', () => {
    const { request, snapshot } = fixture();
    const optional = { ...request, purpose: 'optional.personalization' as const };
    const permitted: PolicySnapshot = { ...snapshot, grants: [grant('alice', optional.purpose)], consents: [consent()] };
    expect(authorizeAccess(optional, permitted, NOW).allowed).toBe(true);
    expect(authorizeAccess(optional, { ...permitted, consents: [] }, NOW).allowed).toBe(false);
    for (const state of ['not_asked', 'presented', 'declined', 'withdrawn', 'expired', 'reconsent_required', 'suspended'] as const) {
      expect(authorizeAccess(optional, { ...permitted, consents: [{ ...consent(), state }] }, NOW).allowed).toBe(false);
    }
    for (const patch of [{ purposeVersion: 2 }, { policyVersion: 'new' }, { spaceId: 'personal' }, { effectiveAt: NOW + 1 }, { expiresAt: NOW }]) {
      expect(authorizeAccess(optional, { ...permitted, consents: [{ ...consent(), ...patch }] }, NOW).allowed).toBe(false);
    }
    const multiSubject = { ...permitted, people: [person('alice'), person('bob')], resource: { ...permitted.resource, subjectPersonIds: ['alice', 'bob'] } };
    expect(authorizeAccess(optional, multiSubject, NOW).allowed).toBe(false);
    expect(authorizeAccess(optional, { ...multiSubject, consents: [consent(), consent('bob')] }, NOW).allowed).toBe(true);
  });
});

describe('expiry, malformed state and stale work', () => {
  it('enforces expiry exactly at the boundary and rejects deleted sources', () => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess(request, snapshot, END - 1).allowed).toBe(true);
    expect(authorizeAccess(request, snapshot, END).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, resource: { ...snapshot.resource, status: 'deleted' } }, NOW).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, grants: [{ ...grant('alice'), expiresAt: NOW }] }, NOW).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, memberships: [{ ...membership('alice'), expiresAt: NOW }] }, NOW).allowed).toBe(false);
  });

  it('rejects unknown versions, nonfinite clocks, duplicate ledger states and stale epochs', () => {
    const { request, snapshot } = fixture();
    expect(authorizeAccess(request, snapshot, Number.NaN).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, schemaVersion: 2 } as unknown as PolicySnapshot, NOW).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, grants: [...snapshot.grants, grant('alice')] }, NOW).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, memberships: [membership('alice'), { ...membership('alice'), id: 'conflict' }] }, NOW).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, container: { ...snapshot.container, policyEpoch: 2 } }, NOW).allowed).toBe(false);
    expect(authorizeAccess(request, { ...snapshot, space: { ...snapshot.space, policyEpoch: 2 } }, NOW).allowed).toBe(false);
  });

  it('re-evaluates current policy before using cached or queued work', () => {
    const { request, snapshot } = fixture();
    const decision = authorizeAccess(request, snapshot, NOW);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error('fixture denied');
    expect(isAuthorizationCurrent(decision.stamp, request, snapshot, NOW + 1)).toBe(true);
    expect(isAuthorizationCurrent(decision.stamp, request, snapshot, END)).toBe(false);
    for (const changed of [
      { ...snapshot, policyVersion: 'policy-2' },
      { ...snapshot, people: [{ ...person('alice'), status: 'suspended' as const, revision: 2 }] },
      { ...snapshot, resource: { ...snapshot.resource, revision: 2, revocationEpoch: 2 } },
      { ...snapshot, grants: [{ ...grant('alice'), status: 'revoked' as const, revision: 2 }] },
      { ...snapshot, memberships: [{ ...membership('alice'), status: 'revoked' as const, revision: 2 }] },
    ]) expect(isAuthorizationCurrent(decision.stamp, request, changed, NOW + 1)).toBe(false);
    expect(isAuthorizationCurrent(decision.stamp, { ...request, audience: { kind: 'unknown' } }, snapshot, NOW + 1)).toBe(false);
  });

  it('withdrawal then regrant never revives old prepared work', () => {
    const { request, snapshot } = fixture();
    const optional = { ...request, purpose: 'optional.personalization' as const };
    const permitted = { ...snapshot, grants: [grant('alice', optional.purpose)], consents: [consent()] };
    const decision = authorizeAccess(optional, permitted, NOW);
    if (!decision.allowed) throw new Error('fixture denied');
    for (const state of ['withdrawn', 'granted'] as const) {
      expect(isAuthorizationCurrent(decision.stamp, optional, { ...permitted,
        consents: [{ ...consent(), state, revision: 3, epoch: 3 }],
      }, NOW + 1)).toBe(false);
    }
  });
});
