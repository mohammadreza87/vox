/**
 * Memory visibility — the single rule that keeps shared personas safe.
 *
 *   A persona may use a memory only if EVERY person who can read the current
 *   conversation is allowed to see it.
 *
 * Private chat → audience is that one person.
 * Registered group → audience is every group member (whether or not they
 * have spoken), because anyone in the group can read the reply.
 *
 * This is enforced in code before anything reaches the model; the model is
 * never trusted to filter memories itself.
 */

import type { ChatContext, MemoryRecord, MemoryScope } from '../types';
import type { OrgDirectory } from '../org/directory';

export function canPersonSee(org: OrgDirectory, personId: string, scope: MemoryScope): boolean {
  const person = org.getPerson(personId);
  if (!person) return false;
  if (person.guest) {
    // Outsiders never see project, company or organization knowledge.
    if (scope.kind === 'private') return scope.personId === personId;
    if (scope.kind === 'group') return org.isGroupMember(personId, scope.groupId);
    return false;
  }
  switch (scope.kind) {
    case 'private':
      return scope.personId === personId;
    case 'group':
      return org.isGroupMember(personId, scope.groupId);
    case 'project':
      return org.isProjectMember(personId, scope.projectId);
    case 'company':
      return org.isCompanyMember(personId, scope.companyId);
    case 'org':
      return true;
  }
}

/** Everyone who can read replies in this conversation */
export function audienceOf(chat: ChatContext): string[] {
  return chat.kind === 'private' ? [chat.personId] : [...chat.group.memberIds];
}

/** Unknown readers are restrictive even when no named guest has spoken. */
export function hasRestrictedAudience(org: OrgDirectory, chat: ChatContext): boolean {
  const audience = audienceOf(chat);
  return (chat.kind === 'group' && Boolean(chat.group.hasGuests)) || audience.length === 0 ||
    audience.some((id) => !org.getPerson(id) || org.getPerson(id)?.guest);
}

/** Apply the same conversation boundary at retrieval and both model prompts. */
export function isVisibleInChat(org: OrgDirectory, memory: MemoryRecord, chat: ChatContext): boolean {
  if (memory.supersededBy) return false;
  if (memory.sensitivity === 'personal' && chat.kind !== 'private') return false;
  if (chat.kind === 'group' && hasRestrictedAudience(org, chat) &&
      !(memory.scope.kind === 'group' && memory.scope.groupId === chat.group.id)) return false;
  return isVisibleToAudience(org, memory, audienceOf(chat));
}

export function isVisibleToAudience(
  org: OrgDirectory,
  memory: MemoryRecord,
  audience: string[]
): boolean {
  if (audience.length === 0 || audience.some((id) => !org.getPerson(id))) return false;
  if (memory.authorizedPersonIds && audience.some((id) => !memory.authorizedPersonIds!.includes(id))) return false;
  // Personal memories never leave a one-to-one conversation with their owner.
  if (memory.sensitivity === 'personal') {
    return (
      memory.scope.kind === 'private' &&
      audience.length === 1 &&
      audience[0] === memory.scope.personId
    );
  }
  return audience.every((personId) => canPersonSee(org, personId, memory.scope));
}

export function describeScope(org: OrgDirectory, scope: MemoryScope): string {
  switch (scope.kind) {
    case 'private':
      return `private with ${org.getPerson(scope.personId)?.name ?? scope.personId}`;
    case 'group':
      return `${org.getGroup(scope.groupId)?.name ?? scope.groupId} group`;
    case 'project':
      return `${org.getProject(scope.projectId)?.name ?? scope.projectId} project`;
    case 'company':
      return `${org.getCompany(scope.companyId)?.name ?? scope.companyId}`;
    case 'org':
      return org.organizationName;
  }
}

export function scopeKey(scope: MemoryScope): string {
  switch (scope.kind) {
    case 'private':
      return `private:${scope.personId}`;
    case 'group':
      return `group:${scope.groupId}`;
    case 'project':
      return `project:${scope.projectId}`;
    case 'company':
      return `company:${scope.companyId}`;
    case 'org':
      return 'org';
  }
}

export function parseScopeKey(key: string): MemoryScope | null {
  if (key === 'org') return { kind: 'org' };
  const [kind, id] = key.split(':');
  if (!id) return null;
  switch (kind) {
    case 'private':
      return { kind: 'private', personId: id };
    case 'group':
      return { kind: 'group', groupId: id };
    case 'project':
      return { kind: 'project', projectId: id };
    case 'company':
      return { kind: 'company', companyId: id };
    default:
      return null;
  }
}
