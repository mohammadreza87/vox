import {
  ADAPTIVE_SCHEMA_VERSION, OPERATIONS, PURPOSES, type AccessDecision, type AccessRequest,
  type AuthorizationStamp, type DenialReason, type Grant, type PolicySnapshot,
} from './types';
import { resolveVerifiedPerson, validEpoch, validId, validRecord, validRevision, validTime } from './identity';

export function requiresConsent(purpose: AccessRequest['purpose']): boolean {
  return purpose.startsWith('optional.');
}

function uniqueIds(ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every(validId) && new Set(ids).size === ids.length;
}

function sameScope(record: { tenantId: string; spaceId: string; containerId?: string }, request: AccessRequest): boolean {
  return record.tenantId === request.tenantId && record.spaceId === request.spaceId &&
    (record.containerId === undefined || record.containerId === request.containerId);
}

function requestFingerprint(request: AccessRequest): string {
  return JSON.stringify([
    request.identity.authenticatedAccountId, request.identity.selectedPerson?.personId,
    request.identity.selectedPerson?.bindingId, request.identity.selectedPerson?.bindingRevision,
    request.tenantId, request.spaceId, request.containerId, request.resourceId, request.operation,
    request.purpose, request.purposeVersion, request.consentPolicyVersion, request.agentId ?? null,
    request.audience.kind === 'known' ? [...request.audience.personIds].sort() : null,
  ]);
}

/**
 * Evaluate trusted metadata BEFORE loading source text and again before output/commit.
 * A successful stamp is an invalidation hint, never a bearer permission or persistence lock.
 */
export function authorizeAccess(request: AccessRequest, snapshot: PolicySnapshot, now: number): AccessDecision {
  const deny = (reason: DenialReason): AccessDecision => ({ allowed: false, reason });
  const { account, people, binding, space, container, resource, grants, memberships, consents } = snapshot;
  const records = [account, ...people, ...(binding ? [binding] : []), space, container, resource, ...grants, ...memberships, ...consents];
  if (!validTime(now) || snapshot.schemaVersion !== ADAPTIVE_SCHEMA_VERSION || !validId(snapshot.policyVersion) ||
      !records.every(record => validRecord(record, now)) ||
      ![request.tenantId, request.spaceId, request.containerId, request.resourceId, request.consentPolicyVersion].every(validId) ||
      !OPERATIONS.includes(request.operation) || !PURPOSES.includes(request.purpose) || !validRevision(request.purposeVersion) ||
      (request.agentId !== undefined && !validId(request.agentId)) ||
      !validEpoch(space.policyEpoch) || !validEpoch(container.policyEpoch) || !validEpoch(container.spacePolicyEpoch) || !validEpoch(resource.revocationEpoch) ||
      !validTime(resource.expiresAt) || !uniqueIds(resource.subjectPersonIds) ||
      !memberships.every(m => validEpoch(m.policyEpoch) && validTime(m.joinedAt) && m.joinedAt <= now && validTime(m.expiresAt)) ||
      !grants.every(g => validEpoch(g.policyEpoch) && validTime(g.expiresAt) && validRevision(g.purposeVersion) &&
        validId(g.principal.id) && ['person', 'agent'].includes(g.principal.kind) && g.operations.every(op => OPERATIONS.includes(op))) ||
      !consents.every(c => validEpoch(c.epoch) && validTime(c.effectiveAt) && validTime(c.expiresAt))) return deny('invalid_contract');

  // A normalized snapshot must not contain two states for one authoritative record.
  for (const group of [people, grants, memberships, consents]) {
    if (new Set(group.map(record => record.id)).size !== group.length) return deny('invalid_contract');
  }
  const personId = resolveVerifiedPerson(request.identity, account, binding, now);
  const activePerson = (id: string): boolean => people.some(person => person.id === id && person.status === 'active');
  if (!personId || !activePerson(personId)) return deny('identity_unverified');
  if (space.id !== request.spaceId || space.tenantId !== request.tenantId ||
      container.id !== request.containerId || !sameScope(container, request) ||
      resource.id !== request.resourceId || resource.containerId !== request.containerId || !sameScope(resource, request)) return deny('scope_mismatch');
  if (!['work', 'personal'].includes(space.kind) || !['all_authorized_history', 'since_membership'].includes(container.historyPolicy)) return deny('invalid_contract');
  if (space.status !== 'active' || container.status !== 'active' || resource.status !== 'active' || resource.expiresAt <= now) return deny('inactive_resource');
  if (container.spacePolicyEpoch !== space.policyEpoch) return deny('scope_mismatch');
  if (request.purpose === 'model_training' || request.purpose === 'optional.marketing') return deny('purpose_disabled');
  if (request.audience.kind !== 'known' || !uniqueIds(request.audience.personIds)) return deny('unknown_audience');

  const bounds = [binding!.expiresAt, resource.expiresAt];
  const involvedPeople = [...new Set([personId, ...request.audience.personIds])];
  for (const id of involvedPeople) {
    if (!activePerson(id)) return deny('audience_denied');
    switch (container.audience.kind) {
      case 'private':
        if (id !== container.audience.ownerPersonId) return deny('audience_denied');
        break;
      case 'exact_recipients':
        if (!uniqueIds(container.audience.personIds) || !container.audience.personIds.includes(id)) return deny('audience_denied');
        break;
      case 'group':
        if (!validId(container.audience.groupId)) return deny('invalid_contract');
        break;
      default: return deny('invalid_contract');
    }
    const matching = memberships.filter(m => sameScope(m, request) && m.containerId === container.id && m.personId === id);
    if (matching.length !== 1) return deny('membership_denied');
    const membership = matching[0];
    if (membership.status !== 'active' || membership.expiresAt <= now || membership.policyEpoch !== container.policyEpoch ||
        (container.audience.kind === 'group' && membership.groupId !== container.audience.groupId)) return deny('membership_denied');
    if ((request.operation === 'read' || request.operation === 'reshare') &&
        container.historyPolicy === 'since_membership' && resource.createdAt < membership.joinedAt) return deny('history_denied');
    bounds.push(membership.expiresAt);
  }

  const findGrant = (kind: 'person' | 'agent', id: string, operation: AccessRequest['operation']): Grant | undefined =>
    grants.filter(g => sameScope(g, request) && g.containerId === container.id &&
      g.principal.kind === kind && g.principal.id === id && g.status === 'active' &&
      g.policyEpoch === container.policyEpoch && g.purpose === request.purpose &&
      g.purposeVersion === request.purposeVersion && g.expiresAt > now && g.operations.includes(operation))
      .sort((a, b) => b.expiresAt - a.expiresAt || a.id.localeCompare(b.id))[0];
  const requireGrant = (kind: 'person' | 'agent', id: string, operation: AccessRequest['operation']): boolean => {
    const grant = findGrant(kind, id, operation);
    if (!grant) return false;
    bounds.push(grant.expiresAt);
    return true;
  };
  if (!requireGrant('person', personId, request.operation)) return deny('grant_denied');
  if (request.agentId && !requireGrant('agent', request.agentId, request.operation)) return deny('grant_denied');
  // Mutation permission never implies permission to render source content.
  if (request.operation === 'read' || request.operation === 'reshare') {
    for (const recipient of request.audience.personIds) {
      if (!requireGrant('person', recipient, 'read')) return deny('grant_denied');
    }
    if (request.agentId && !requireGrant('agent', request.agentId, 'read')) return deny('grant_denied');
  }

  if (requiresConsent(request.purpose)) {
    for (const subject of new Set([personId, ...resource.subjectPersonIds])) {
      if (!activePerson(subject)) return deny('consent_denied');
      const matching = consents.filter(c => sameScope(c, request) && c.personId === subject && c.purpose === request.purpose);
      if (matching.length !== 1) return deny('consent_denied');
      const consent = matching[0];
      if (consent.state !== 'granted' || consent.purposeVersion !== request.purposeVersion ||
          consent.policyVersion !== request.consentPolicyVersion || consent.effectiveAt > now || consent.expiresAt <= now) return deny('consent_denied');
      bounds.push(consent.expiresAt);
    }
  }

  const versions = [
    ...records.map(record => JSON.stringify([record.id, record.revision])),
    JSON.stringify(['space_epoch', space.policyEpoch]), JSON.stringify(['container_epoch', container.policyEpoch]),
    JSON.stringify(['resource_epoch', resource.revocationEpoch]),
    ...consents.map(c => JSON.stringify(['consent_epoch', c.id, c.epoch])),
  ].sort();
  return {
    allowed: true, personId,
    stamp: { schemaVersion: ADAPTIVE_SCHEMA_VERSION, policyVersion: snapshot.policyVersion,
      requestFingerprint: requestFingerprint(request), versions, validUntil: Math.min(...bounds) },
  };
}

/** Re-runs policy on current authoritative state; stale cached/queued work is discarded. */
export function isAuthorizationCurrent(stamp: AuthorizationStamp, request: AccessRequest, snapshot: PolicySnapshot, now: number): boolean {
  if (stamp.schemaVersion !== ADAPTIVE_SCHEMA_VERSION || !validTime(now) || now >= stamp.validUntil) return false;
  const decision = authorizeAccess(request, snapshot, now);
  return decision.allowed && stamp.policyVersion === decision.stamp.policyVersion &&
    stamp.requestFingerprint === decision.stamp.requestFingerprint && stamp.validUntil === decision.stamp.validUntil &&
    stamp.versions.length === decision.stamp.versions.length && stamp.versions.every((version, index) => version === decision.stamp.versions[index]);
}
