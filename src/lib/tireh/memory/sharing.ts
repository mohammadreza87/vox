/** Explicit source-owner grants. Scope mutation alone is never authorization. */
import type { MemoryRecord } from '../types';
import type { OrgDirectory } from '../org/directory';

export const MAX_SHARE_RECIPIENTS = 30;

export interface ShareRecipientPolicy {
  /** Live access to the agent that holds the memory. Callers with an agent
   * access model (Studio) must pass it; without one, every non-guest member
   * of the directory may use the persona. */
  mayUseAgent?: (personId: string) => boolean;
}

function assertOwner(memory: MemoryRecord, actorId: string): void {
  if (memory.source.personId !== actorId) throw new Error('Only the source owner can change sharing.');
  if (memory.supersededBy) throw new Error('This memory has been replaced.');
}

/** Exact recipients must be known, non-guest members who may use the agent. */
export function validateShareRecipients(org: OrgDirectory, recipientIds: unknown, policy: ShareRecipientPolicy = {}): string[] {
  if (!Array.isArray(recipientIds) || !recipientIds.length || recipientIds.length > MAX_SHARE_RECIPIENTS) {
    throw new Error('Choose people who can use this agent.');
  }
  for (const id of recipientIds) {
    const person = typeof id === 'string' ? org.getPerson(id) : undefined;
    if (!person || person.guest || (policy.mayUseAgent && policy.mayUseAgent(id) !== true)) {
      throw new Error('Choose people who can use this agent.');
    }
  }
  return [...new Set(recipientIds as string[])];
}

export function ownerSharePatch(org: OrgDirectory, memory: MemoryRecord, actorId: string, recipientIds: string[], policy: ShareRecipientPolicy = {}): Pick<MemoryRecord, 'scope' | 'authorizedPersonIds' | 'shareVersion'> {
  assertOwner(memory, actorId);
  if (memory.sensitivity !== 'normal') throw new Error('Sensitive memories remain private.');
  const recipients = validateShareRecipients(org, recipientIds, policy);
  const personIds = [...new Set([actorId, ...recipients])].sort();
  return { scope: { kind: 'people', personIds }, authorizedPersonIds: personIds, shareVersion: (memory.shareVersion ?? 0) + 1 };
}

export function ownerRevokePatch(memory: MemoryRecord, actorId: string): Pick<MemoryRecord, 'scope' | 'authorizedPersonIds' | 'shareVersion'> {
  assertOwner(memory, actorId);
  return { scope: { kind: 'private', personId: actorId }, authorizedPersonIds: [actorId], shareVersion: (memory.shareVersion ?? 0) + 1 };
}
