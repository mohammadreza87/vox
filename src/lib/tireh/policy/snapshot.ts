/**
 * PolicySnapshotBuilder: maps a TIREH MemoryRecord, its scope, the org
 * directory (Studio groups included) and the agent onto the adaptive
 * PolicySnapshot / AccessRequest contract, the same way
 * src/lib/adaptive/shared/service.ts maps shared containers. Step 8 of
 * docs/AGENT_INTELLIGENCE_SOLUTION.md uses it as a CI oracle: the
 * differential test checks that the visibility module's audience decision and
 * adaptive authorizeAccess agree on every fixture.
 *
 * To be a useful oracle this module must not reuse visibility.ts decisions:
 * scope membership is derived here from the org config directly (only the
 * scope key encoding is shared). The differential test greps this file for
 * the names of the visibility decision functions.
 *
 * Modelling choices (see MODELING_NOTES in the differential test):
 *  - identity is a synthetic, verified account_confirmation binding for the
 *    reader: TIREH has no binding records, so identity is not compared;
 *  - one Work space per organization until S06's `space` field lands;
 *  - purpose core.conversation with no consents: consent gates live in the
 *    turn boundary, not in visibility;
 *  - the agent grant comes from personaId (the store is per agent);
 *  - every record and membership starts at t0, the record's creation time:
 *    people outside the authorization snapshot get no membership at all, so
 *    historyPolicy can never widen access by itself.
 */

import { authorizeAccess } from '../../adaptive/policy';
import type { AccessRequest, Container, ContainerAudience, Grant, Membership, Person as PolicyPerson, PolicySnapshot } from '../../adaptive/types';
import { scopeKey } from '../memory/visibility';
import type { OrgDirectory } from '../org/directory';
import type { MemoryRecord } from '../types';

export const TIREH_POLICY_VERSION = 'tireh-visibility-v1';
const FOREVER = Number.MAX_SAFE_INTEGER;
const PURPOSE = 'core.conversation' as const;

export interface PolicyMappingInput { org: OrgDirectory; memory: MemoryRecord; readerPersonId: string; audience: readonly string[]; personaId: string; now: number }
export interface PolicyMapping { snapshot: PolicySnapshot; request: AccessRequest }

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Non-guest people in the org config, independent of visibility.ts. */
function staff(org: OrgDirectory) {
  return org.config.people.filter((person) => !person.guest);
}

/** The current members of a dynamic scope (project, company, org); null for the bounded scopes. */
function dynamicScopeMembers(org: OrgDirectory, memory: MemoryRecord): string[] | null {
  const scope = memory.scope;
  switch (scope.kind) {
    case 'project': {
      const project = org.config.projects.find((p) => p.id === scope.projectId);
      return staff(org).filter((person) => project?.memberIds.includes(person.id)).map((person) => person.id).sort();
    }
    case 'company': return staff(org).filter((person) => person.companyIds.includes(scope.companyId)).map((person) => person.id).sort();
    case 'org': return staff(org).map((person) => person.id).sort();
    default: return null;
  }
}

function isCurrentScopeMember(org: OrgDirectory, memory: MemoryRecord, personId: string): boolean {
  const scope = memory.scope;
  switch (scope.kind) {
    case 'private': return scope.personId === personId;
    case 'people': return scope.personIds.includes(personId);
    case 'group': return org.config.groups.find((g) => g.id === scope.groupId)?.memberIds.includes(personId) ?? false;
    default: return dynamicScopeMembers(org, memory)?.includes(personId) ?? false;
  }
}

function containerAudience(org: OrgDirectory, memory: MemoryRecord): ContainerAudience | null {
  const scope = memory.scope;
  switch (scope.kind) {
    case 'private': return { kind: 'private', ownerPersonId: scope.personId };
    case 'people': {
      const personIds = unique(scope.personIds).sort();
      return personIds.length ? { kind: 'exact_recipients', personIds } : null;
    }
    case 'group': return { kind: 'group', groupId: scope.groupId };
    default: {
      const personIds = dynamicScopeMembers(org, memory) ?? [];
      return personIds.length ? { kind: 'exact_recipients', personIds } : null;
    }
  }
}

/** Builds one reader's snapshot and request; null means not representable, which is a denial. */
export function buildPolicyMapping(input: PolicyMappingInput): PolicyMapping | null {
  const { org, memory, readerPersonId: reader, audience, personaId, now } = input;
  if (memory.personaId !== personaId) return null;
  if (memory.sensitivity !== 'normal' && memory.scope.kind !== 'private') return null;
  const audienceKind = containerAudience(org, memory);
  if (!audienceKind) return null;

  const tenantId = `tireh:${org.config.organization.id}`;
  const spaceId = `${tenantId}:work`;
  const containerId = `tireh:${scopeKey(memory.scope)}`;
  const scoped = { tenantId, spaceId };
  const t0 = Math.min(memory.createdAt.getTime(), now);
  const base = { schemaVersion: 1 as const, revision: 1, createdAt: t0, updatedAt: t0 };
  const accountId = `tireh-account:${reader}`;
  const exists = (id: string) => org.config.people.some((person) => person.id === id);

  const authorized = memory.authorizedPersonIds ??
    (memory.scope.kind === 'private' ? [memory.scope.personId] : memory.scope.kind === 'people' ? memory.scope.personIds : []);
  const eligible = (id: string): boolean => exists(id) && (memory.sensitivity !== 'normal'
    ? memory.scope.kind === 'private' && id === memory.scope.personId
    : authorized.includes(id) && isCurrentScopeMember(org, memory, id));

  const involved = unique([reader, ...audience]);
  const people: PolicyPerson[] = unique([reader, ...audience, memory.source.personId]).filter(exists)
    .map((id) => ({ ...base, id, status: 'active' as const }));
  const groupId = memory.scope.kind === 'group' ? memory.scope.groupId : undefined;
  const historyPolicy: Container['historyPolicy'] = groupId
    ? org.getGroup(groupId)?.historyPolicy ?? 'since_membership' : 'since_membership';
  const members = involved.filter(eligible);
  const memberships: Membership[] = members.map((id) => ({
    ...base, ...scoped, id: `${containerId}:member:${id}`, containerId, personId: id,
    ...(groupId ? { groupId } : {}), status: 'active' as const, joinedAt: t0, expiresAt: FOREVER, policyEpoch: 0,
  }));
  const grants: Grant[] = [
    ...members.map((id) => ({
      ...base, ...scoped, id: `${containerId}:person:${id}`, containerId, principal: { kind: 'person' as const, id },
      operations: ['read' as const], purpose: PURPOSE, purposeVersion: 1, status: 'active' as const, expiresAt: FOREVER, policyEpoch: 0,
    })),
    {
      ...base, ...scoped, id: `${containerId}:agent:${personaId}`, containerId, principal: { kind: 'agent' as const, id: personaId },
      operations: ['read' as const], purpose: PURPOSE, purposeVersion: 1, status: 'active' as const, expiresAt: FOREVER, policyEpoch: 0,
    },
  ];

  const snapshot: PolicySnapshot = {
    schemaVersion: 1,
    policyVersion: TIREH_POLICY_VERSION,
    account: { ...base, id: accountId, ownerPersonId: reader, status: 'active' },
    people,
    binding: {
      schemaVersion: 1, id: `tireh-binding:${reader}`, revision: 1, createdAt: t0, updatedAt: t0, accountId, personId: reader,
      status: 'verified', method: 'account_confirmation', verifiedAt: t0, expiresAt: now + 1,
    },
    space: { ...base, id: spaceId, tenantId, kind: 'work', ownerAccountId: `tireh-org:${org.config.organization.id}`, status: 'active', policyEpoch: 0 },
    container: { ...base, ...scoped, id: containerId, audience: audienceKind, status: 'active', policyEpoch: 0, spacePolicyEpoch: 0, historyPolicy },
    resource: {
      ...base, ...scoped, id: memory.id, containerId, subjectPersonIds: [memory.source.personId],
      status: memory.supersededBy ? 'deleted' : 'active', expiresAt: FOREVER, revocationEpoch: memory.shareVersion ?? 0,
    },
    memberships,
    grants,
    consents: [],
  };
  const request: AccessRequest = {
    identity: { authenticatedAccountId: accountId, selectedPerson: { personId: reader, bindingId: `tireh-binding:${reader}`, bindingRevision: 1 } },
    tenantId, spaceId, containerId, resourceId: memory.id, operation: 'read', purpose: PURPOSE, purposeVersion: 1,
    consentPolicyVersion: TIREH_POLICY_VERSION, audience: { kind: 'known', personIds: unique(audience) }, agentId: personaId,
  };
  return { snapshot, request };
}

/** Adaptive policy's answer for one chat audience: every reader must be authorized. An empty audience is denied. */
export function adaptiveAllowsAudience(org: OrgDirectory, memory: MemoryRecord, audience: readonly string[], personaId: string, now: number): boolean {
  if (audience.length === 0) return false;
  return audience.every((readerPersonId) => {
    const mapping = buildPolicyMapping({ org, memory, readerPersonId, audience, personaId, now });
    return !!mapping && authorizeAccess(mapping.request, mapping.snapshot, now).allowed;
  });
}
