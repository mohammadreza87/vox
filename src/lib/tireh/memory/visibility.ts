/** Code-owned audience policy, applied before any content reaches a model. */
import type { ChatContext, ChatMessage, MemoryRecord, MemoryScope } from '../types';
import type { OrgDirectory } from '../org/directory';

export function canPersonSee(org: OrgDirectory, personId: string, scope: MemoryScope): boolean {
  const person = org.getPerson(personId);
  if (!person) return false;
  if (scope.kind === 'people') return scope.personIds.includes(personId);
  if (person.guest) {
    if (scope.kind === 'private') return scope.personId === personId;
    if (scope.kind === 'group') return org.isGroupMember(personId, scope.groupId);
    return false;
  }
  switch (scope.kind) {
    case 'private': return scope.personId === personId;
    case 'group': return org.isGroupMember(personId, scope.groupId);
    case 'project': return org.isProjectMember(personId, scope.projectId);
    case 'company': return org.isCompanyMember(personId, scope.companyId);
    case 'org': return true;
  }
}

export function audienceOf(chat: ChatContext): string[] {
  return [...new Set(chat.kind === 'private' ? [chat.personId] : chat.group.memberIds)];
}

export function hasGuestAudience(org: OrgDirectory, chat: ChatContext): boolean {
  return audienceOf(chat).length === 0 || (chat.kind === 'group' && !!chat.group.hasGuests) ||
    audienceOf(chat).some((id) => !org.getPerson(id) || org.getPerson(id)?.guest);
}

export const hasRestrictedAudience = hasGuestAudience;
export function isVisibleInChat(org: OrgDirectory, memory: MemoryRecord, chat: ChatContext): boolean {
  return (chat.kind !== 'group' || (memory.scope.kind === 'group' && memory.scope.groupId === chat.group.id)) &&
    isMemoryAllowedInChat(org, memory, chat);
}

/** Capture once on creation or explicit sharing, never recalculate while reading. */
export function snapshotScopeAudience(org: OrgDirectory, scope: MemoryScope): string[] {
  return org.listPeople().filter((p) => canPersonSee(org, p.id, scope)).map((p) => p.id).sort();
}

export function isVisibleToAudience(org: OrgDirectory, memory: MemoryRecord, audience: string[]): boolean {
  if (memory.supersededBy || audience.length === 0) return false;
  if (memory.sensitivity !== 'normal') {
    return memory.scope.kind === 'private' && audience.length === 1 &&
      audience[0] === memory.scope.personId && !!org.getPerson(audience[0]);
  }
  // Private and exact-recipient scopes are intrinsically bounded. Legacy
  // dynamic shared scopes have no trustworthy original audience: fail closed.
  const authorized = memory.authorizedPersonIds ??
    (memory.scope.kind === 'private' ? [memory.scope.personId] :
      memory.scope.kind === 'people' ? memory.scope.personIds : []);
  return audience.every((id) => authorized.includes(id) && canPersonSee(org, id, memory.scope));
}

/** Unknown group readers cannot be authorized by a finite configured list. */
export function isMemoryAllowedInChat(org: OrgDirectory, memory: MemoryRecord, chat: ChatContext): boolean {
  return !(chat.kind === 'group' && chat.group.hasGuests) &&
    isVisibleToAudience(org, memory, audienceOf(chat));
}

/** Stamp the audience on both human and generated turns at write time. */
export function historyMessageForChat(chat: ChatContext, message: ChatMessage): ChatMessage {
  return { ...message, audiencePersonIds: audienceOf(chat) };
}

export function selectHistoryForChat(org: OrgDirectory, messages: ChatMessage[], chat: ChatContext): ChatMessage[] {
  const audience = audienceOf(chat);
  if (audience.length === 0 || (chat.kind === 'group' && chat.group.hasGuests)) return [];
  return messages.filter((message) => {
    // Legacy private history is already isolated by its chat key; callers must
    // clear persona history after authorized memory deletion/revocation.
    const authorized = message.audiencePersonIds ?? (chat.kind === 'private' ? audience : []);
    return audience.every((id) => !!org.getPerson(id) && authorized.includes(id));
  });
}

export function describeScope(org: OrgDirectory, scope: MemoryScope): string {
  switch (scope.kind) {
    case 'private': return `private with ${org.getPerson(scope.personId)?.name ?? scope.personId}`;
    case 'people': return scope.personIds.map((id) => org.getPerson(id)?.name ?? id).join(', ');
    case 'group': return `${org.getGroup(scope.groupId)?.name ?? scope.groupId} group`;
    case 'project': return `${org.getProject(scope.projectId)?.name ?? scope.projectId} project`;
    case 'company': return org.getCompany(scope.companyId)?.name ?? scope.companyId;
    case 'org': return org.organizationName;
  }
}

export function scopeKey(scope: MemoryScope): string {
  switch (scope.kind) {
    case 'private': return `private:${scope.personId}`;
    case 'people': return `people:${[...new Set(scope.personIds)].sort().map(encodeURIComponent).join(',')}`;
    case 'group': return `group:${scope.groupId}`;
    case 'project': return `project:${scope.projectId}`;
    case 'company': return `company:${scope.companyId}`;
    case 'org': return 'org';
  }
}

export function parseScopeKey(key: string): MemoryScope | null {
  if (key === 'org') return { kind: 'org' };
  const separator = key.indexOf(':');
  if (separator < 1) return null;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id) return null;
  switch (kind) {
    case 'private': return { kind: 'private', personId: id };
    case 'people':
      try { return { kind: 'people', personIds: [...new Set(id.split(',').map(decodeURIComponent))].sort() }; }
      catch { return null; }
    case 'group': return { kind: 'group', groupId: id };
    case 'project': return { kind: 'project', projectId: id };
    case 'company': return { kind: 'company', companyId: id };
    default: return null;
  }
}
