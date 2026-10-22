/** Explicit source-owner grants. Scope mutation alone is never authorization. */
import type { MemoryRecord } from '../types';
import type { OrgDirectory } from '../org/directory';
import type { NewMemory } from './store';

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

/** Scopes a successor agent may inherit (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.6 Successor agent). */
export const SUCCESSOR_SCOPES = ['group', 'people', 'project'] as const;

/** Normal-sensitivity group, people or project records that are still active. Private records never transfer here. */
export function isSuccessorTransferable(memory: MemoryRecord): boolean {
  return memory.sensitivity === 'normal' && !memory.supersededBy &&
    (SUCCESSOR_SCOPES as readonly string[]).includes(memory.scope.kind);
}

/**
 * A successor's copy: same scope, authorization snapshot, shareVersion, source
 * lineage (eventIds) and aboutPersonIds; no id, times or supersession links
 * (copying `supersedes` would make add() throw for every corrected record).
 */
export function successorCopy(memory: MemoryRecord, successorId: string): NewMemory {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, updatedAt, supersedes, supersededBy, ...rest } = memory;
  return { ...rest, personaId: successorId };
}

/** Structural view of the optional S06 MemoryStore tombstone methods. */
export interface TombstoneCarrier {
  tombstonesOf?(personaId: string): Promise<string[]>;
  addTombstones?(personaId: string, eventIds: readonly string[]): Promise<void>;
}

/**
 * Adds exactly one named member to a group record's authorization snapshot.
 * Null when nothing may change: sensitive, other scope or group, superseded,
 * legacy rows without a snapshot (never widened) or already authorized.
 */
export function resnapshotPatch(memory: MemoryRecord, groupId: string, personId: string): Pick<MemoryRecord, 'authorizedPersonIds' | 'shareVersion'> | null {
  if (memory.sensitivity !== 'normal' || memory.scope.kind !== 'group' || memory.scope.groupId !== groupId ||
      memory.supersededBy || !memory.authorizedPersonIds || memory.authorizedPersonIds.includes(personId)) return null;
  return {
    authorizedPersonIds: [...new Set([...memory.authorizedPersonIds, personId])].sort(),
    shareVersion: (memory.shareVersion ?? 0) + 1,
  };
}

/** Who saw a shared record and must be told it was updated (never the owner). */
export function supersedeNoticeRecipients(predecessor: MemoryRecord): string[] {
  if (predecessor.sensitivity !== 'normal' || (predecessor.scope.kind !== 'people' && predecessor.scope.kind !== 'project')) return [];
  const audience = predecessor.authorizedPersonIds ?? (predecessor.scope.kind === 'people' ? predecessor.scope.personIds : []);
  return [...new Set(audience)].filter((id) => id !== predecessor.source.personId).sort();
}
