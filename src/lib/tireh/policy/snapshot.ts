/**
 * PolicySnapshotBuilder (S08): maps a TIREH MemoryRecord, its scope, the org
 * directory (Studio groups included) and the agent onto the adaptive
 * PolicySnapshot / AccessRequest contract, modelled on allowed() in
 * src/lib/adaptive/shared/service.ts. The differential test uses it as an
 * oracle: the visibility module's audience decision and adaptive
 * authorizeAccess must agree on every fixture.
 *
 * To stay independent it never calls the visibility decision functions:
 * memberships are derived from OrgDirectory primitives (getPerson,
 * isGroupMember, isProjectMember, isCompanyMember). Only the scope-key
 * encoding is shared, for a stable container id.
 *
 * Modelling choices (documented in the differential test):
 *  - identity: a synthetic, verified account_confirmation binding per reader.
 *    TIREH trusts the transport-authenticated id; identity is not compared.
 *  - Work space only: TIREH records are Work records.
 *  - purpose core.conversation with no consents: consent gates live in the
 *    turn boundary, not in visibility.
 *  - the agent grant comes from personaId; a record of another persona maps
 *    to null (a denial).
 *  - joinedAt 0 for every snapshot member: TIREH has no join times, and the
 *    authorizedPersonIds snapshot is the history fence, so historyPolicy can
 *    never widen access by itself.
 *
 * Pure and synchronous: no I/O, no logging, no content read (metadata only).
 */

import { authorizeAccess } from '../../adaptive/policy';
import type { AccessRequest, ContainerAudience, Grant, Membership, Person as PolicyPerson, PolicySnapshot } from '../../adaptive/types';
import { scopeKey } from '../memory/visibility';
import type { OrgDirectory } from '../org/directory';
import type { MemoryRecord } from '../types';

export const TIREH_POLICY_VERSION = 'tireh-visibility-v1';
const MAX = Number.MAX_SAFE_INTEGER;
const PURPOSE = 'core.conversation' as const;

export interface PolicyMappingInput { org: OrgDirectory; memory: MemoryRecord; readerPersonId: string; audience: readonly string[]; personaId: string; now: number }
export interface PolicyMapping { snapshot: PolicySnapshot; request: AccessRequest }

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** The current scope rule for one person, written out from directory primitives. */
function scopeRuleHolds(org: OrgDirectory, memory: MemoryRecord, id: string): boolean {
  const person = org.getPerson(id);
  if (!person) return false;
  const scope = memory.scope;
  if (scope.kind === 'private') return id === scope.personId;
  if (scope.kind === 'people') return scope.personIds.includes(id);
  if (person.guest) return scope.kind === 'group' && org.isGroupMember(id, scope.groupId);
  switch (scope.kind) {
    case 'group': return org.isGroupMember(id, scope.groupId);
    case 'project': return org.isProjectMember(id, scope.projectId);
    case 'company': return org.isCompanyMember(id, scope.companyId);
    case 'org': return true;
  }
}

/** Builds one reader's snapshot and request; null means not representable, which is a denial. */
export function buildPolicyMapping(input: PolicyMappingInput): PolicyMapping | null {
  const { org, memory, readerPersonId: reader, audience, personaId, now } = input;
  // Another agent's record is never readable by this agent (main's guard, kept on the merge).
  if (memory.personaId !== personaId) return null;
  const scope = memory.scope;
  const sensitive = memory.sensitivity !== 'normal';
  if (sensitive && scope.kind !== 'private') return null;

  const tenantId = `tireh:${org.config.organization.id}`;
  const spaceId = `${tenantId}:work`;
  const containerId = `${tenantId}:container:${scopeKey(scope)}`;
  const scoped = { tenantId, spaceId };
  const base = { schemaVersion: 1 as const, revision: 1, createdAt: 0, updatedAt: 0 };
  const exists = (id: string) => !!org.getPerson(id);

  // Sensitive records map only to their private owner; normal ones use the snapshot with the base legacy fallback.
  const authorized = sensitive ? [(scope as { personId: string }).personId]
    : memory.authorizedPersonIds ?? (scope.kind === 'private' ? [scope.personId] : scope.kind === 'people' ? scope.personIds : []);
  const memberIds = unique(authorized).filter((id) => exists(id) && scopeRuleHolds(org, memory, id)).sort();
  const groupId = scope.kind === 'group' ? scope.groupId : undefined;

  let containerAudience: ContainerAudience;
  if (scope.kind === 'private') containerAudience = { kind: 'private', ownerPersonId: scope.personId };
  else if (groupId) containerAudience = { kind: 'group', groupId };
  else {
    if (!memberIds.length) return null;
    containerAudience = { kind: 'exact_recipients', personIds: memberIds };
  }
  const historyPolicy = groupId ? (org.getGroup(groupId)?.historyPolicy ?? 'since_membership') : 'all_authorized_history';

  const accountId = `acct:${reader}`;
  const bindingId = `bind:${reader}`;
  const people: PolicyPerson[] = unique([reader, ...audience, memory.source.personId, ...(scope.kind === 'people' ? scope.personIds : []),
    ...(scope.kind === 'private' ? [scope.personId] : [])]).filter(exists).map((id) => ({ ...base, id, status: 'active' as const }));
  const memberships: Membership[] = memberIds.map((id) => ({
    ...base, ...scoped, id: `${containerId}:member:${id}`, containerId, personId: id, ...(groupId ? { groupId } : {}),
    status: 'active' as const, joinedAt: 0, expiresAt: MAX, policyEpoch: 0,
  }));
  const grant = (kind: 'person' | 'agent', id: string): Grant => ({
    ...base, ...scoped, id: `${containerId}:${kind}:${id}`, containerId, principal: { kind, id }, operations: ['read'],
    purpose: PURPOSE, purposeVersion: 1, status: 'active', expiresAt: MAX, policyEpoch: 0,
  });
  const createdAt = Math.max(0, Math.min(memory.createdAt.getTime(), now));
  const updatedAt = Math.max(createdAt, Math.min(memory.updatedAt.getTime(), now));

  const snapshot: PolicySnapshot = {
    schemaVersion: 1,
    policyVersion: TIREH_POLICY_VERSION,
    account: { ...base, id: accountId, ownerPersonId: reader, status: 'active' },
    people,
    binding: { ...base, id: bindingId, accountId, personId: reader, status: 'verified', method: 'account_confirmation', verifiedAt: 0, expiresAt: MAX },
    space: { ...base, id: spaceId, tenantId, kind: 'work', ownerAccountId: `acct:org:${org.config.organization.id}`, status: 'active', policyEpoch: 0 },
    container: { ...base, ...scoped, id: containerId, audience: containerAudience, status: 'active', policyEpoch: 0, spacePolicyEpoch: 0, historyPolicy },
    resource: {
      schemaVersion: 1, revision: (memory.shareVersion ?? 0) + 1, createdAt, updatedAt, ...scoped, id: memory.id, containerId,
      subjectPersonIds: [memory.source.personId], status: memory.supersededBy ? 'deleted' : 'active', expiresAt: MAX, revocationEpoch: 0,
    },
    memberships,
    grants: [...memberIds.map((id) => grant('person', id)), grant('agent', personaId)],
    consents: [],
  };
  const request: AccessRequest = {
    identity: { authenticatedAccountId: accountId, selectedPerson: { personId: reader, bindingId, bindingRevision: 1 } },
    tenantId, spaceId, containerId, resourceId: memory.id, operation: 'read', purpose: PURPOSE, purposeVersion: 1,
    consentPolicyVersion: TIREH_POLICY_VERSION, audience: { kind: 'known', personIds: unique(audience) }, agentId: personaId,
  };
  return { snapshot, request };
}

/** Adaptive policy's answer for one chat audience: every reader must be allowed. An empty audience is denied. */
export function adaptiveAllowsAudience(org: OrgDirectory, memory: MemoryRecord, audience: readonly string[], personaId: string, now: number): boolean {
  const readers = unique(audience);
  if (readers.length === 0) return false;
  return readers.every((readerPersonId) => {
    const mapping = buildPolicyMapping({ org, memory, readerPersonId, audience: readers, personaId, now });
    return !!mapping && authorizeAccess(mapping.request, mapping.snapshot, now).allowed;
  });
}
