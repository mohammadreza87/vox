import { type ConsentEvidence, type ConsentPermission, type ConsentState } from './types';
import { validEpoch, validId, validRecord, validTime } from './identity';

export interface ConsentCommand {
  readonly eventId: string;
  readonly expectedRevision: number;
  readonly actor: { readonly accountId: string; readonly verifiedPersonId: string };
  readonly state: Exclude<ConsentState, 'not_asked'>;
  readonly now: number;
  readonly expiresAt?: number;
  readonly evidence?: ConsentEvidence;
  /** Explicit reopening after decline, withdrawal, expiry or resolved suspension. */
  readonly deliberateReopen?: boolean;
}

export interface ConsentEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly permissionId: string;
  readonly personId: string;
  readonly tenantId: string;
  readonly spaceId: string;
  readonly purpose: ConsentPermission['purpose'];
  readonly purposeVersion: number;
  readonly policyVersion: string;
  readonly actorAccountId: string;
  readonly state: ConsentCommand['state'];
  readonly effectiveAt: number;
  readonly epoch: number;
  readonly evidence?: ConsentEvidence;
}

export type ConsentTransition =
  | { readonly ok: false; readonly reason: 'invalid_command' | 'actor_mismatch' | 'revision_conflict' | 'event_conflict' | 'invalid_transition' | 'missing_affirmative_evidence' }
  | { readonly ok: true; readonly duplicate: boolean; readonly permission: ConsentPermission; readonly event?: ConsentEvent };

const NEXT: Record<ConsentState, readonly ConsentState[]> = {
  not_asked: ['presented'],
  presented: ['granted', 'declined', 'suspended'],
  granted: ['withdrawn', 'expired', 'reconsent_required', 'suspended'],
  declined: ['presented'],
  withdrawn: ['presented'],
  expired: ['presented'],
  reconsent_required: ['presented'],
  suspended: ['presented'],
};

/**
 * Produces a proposal only. Persist current permission + immutable event + invalidation
 * in one transaction with a revision precondition and unique event ID before acting.
 */
export function transitionConsent(current: ConsentPermission, command: ConsentCommand): ConsentTransition {
  if (!validTime(command.now) || !validRecord(current, command.now) || !validEpoch(current.epoch) ||
      !validTime(current.effectiveAt) || !validTime(current.expiresAt) || !validId(command.eventId) ||
      !validId(command.actor.accountId) || !validId(command.actor.verifiedPersonId) ||
      !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 ||
      !NEXT[current.state] || !Object.prototype.hasOwnProperty.call(NEXT, command.state)) return { ok: false, reason: 'invalid_command' };
  if (command.actor.verifiedPersonId !== current.personId) return { ok: false, reason: 'actor_mismatch' };
  const fingerprint = JSON.stringify([
    command.eventId, command.expectedRevision, command.actor.accountId, command.actor.verifiedPersonId,
    command.state, command.now, command.expiresAt ?? null, command.deliberateReopen ?? false,
    command.evidence ? [command.evidence.kind, command.evidence.noticeId, command.evidence.noticeVersion,
      command.evidence.renderedCopyHash, command.evidence.locale, command.evidence.presentedAt, command.evidence.affirmative] : null,
  ]);
  if (current.lastEventId === command.eventId) {
    return current.lastCommandFingerprint === fingerprint
      ? { ok: true, duplicate: true, permission: current }
      : { ok: false, reason: 'event_conflict' };
  }
  if (current.revision !== command.expectedRevision) return { ok: false, reason: 'revision_conflict' };
  if (!NEXT[current.state].includes(command.state) ||
      (['declined', 'withdrawn', 'expired', 'suspended'].includes(current.state) &&
        command.state === 'presented' && !command.deliberateReopen)) return { ok: false, reason: 'invalid_transition' };
  if (command.state === 'granted') {
    const evidence = command.evidence;
    if (!evidence || evidence.kind !== 'consent' || evidence.affirmative !== true ||
        ![evidence.noticeId, evidence.noticeVersion, evidence.renderedCopyHash].every(validId) ||
        !['en', 'fa'].includes(evidence.locale) || !validTime(evidence.presentedAt) ||
        evidence.presentedAt < current.effectiveAt || evidence.presentedAt > command.now ||
        command.expiresAt === undefined || !validTime(command.expiresAt) || command.expiresAt <= command.now) {
      return { ok: false, reason: 'missing_affirmative_evidence' };
    }
  }
  if (current.revision === Number.MAX_SAFE_INTEGER || current.epoch === Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'invalid_command' };
  const permission: ConsentPermission = {
    ...current, revision: current.revision + 1, updatedAt: command.now,
    state: command.state, epoch: current.epoch + 1, effectiveAt: command.now,
    expiresAt: command.state === 'granted' ? command.expiresAt! : command.now,
    lastEventId: command.eventId, lastCommandFingerprint: fingerprint,
  };
  return {
    ok: true, duplicate: false, permission,
    event: { schemaVersion: 1, eventId: command.eventId, permissionId: current.id,
      personId: current.personId, tenantId: current.tenantId, spaceId: current.spaceId,
      purpose: current.purpose, purposeVersion: current.purposeVersion, policyVersion: current.policyVersion,
      actorAccountId: command.actor.accountId, state: command.state, effectiveAt: command.now,
      epoch: permission.epoch, ...(command.state === 'granted' ? { evidence: command.evidence } : {}) },
  };
}
