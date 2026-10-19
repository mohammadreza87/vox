/** Explicit source-owner grants. Scope mutation alone is never authorization. */
import type { MemoryRecord } from '../types';
import type { OrgDirectory } from '../org/directory';

function assertOwner(memory: MemoryRecord, actorId: string): void {
  if (memory.source.personId !== actorId) throw new Error('Only the source owner can change sharing.');
  if (memory.supersededBy) throw new Error('This memory has been replaced.');
}

export function ownerSharePatch(org: OrgDirectory, memory: MemoryRecord, actorId: string, recipientIds: string[]): Pick<MemoryRecord, 'scope' | 'authorizedPersonIds' | 'shareVersion'> {
  assertOwner(memory, actorId);
  if (memory.sensitivity !== 'normal') throw new Error('Sensitive memories remain private.');
  if (!recipientIds.length || recipientIds.some((id) => !org.getPerson(id))) throw new Error('Choose known recipients.');
  const personIds = [...new Set([actorId, ...recipientIds])].sort();
  return { scope: { kind: 'people', personIds }, authorizedPersonIds: personIds, shareVersion: (memory.shareVersion ?? 0) + 1 };
}

export function ownerRevokePatch(memory: MemoryRecord, actorId: string): Pick<MemoryRecord, 'scope' | 'authorizedPersonIds' | 'shareVersion'> {
  assertOwner(memory, actorId);
  return { scope: { kind: 'private', personId: actorId }, authorizedPersonIds: [actorId], shareVersion: (memory.shareVersion ?? 0) + 1 };
}
