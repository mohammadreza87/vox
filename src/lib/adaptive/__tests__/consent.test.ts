import { describe, expect, it } from 'vitest';
import { transitionConsent, type ConsentCommand, type ConsentPermission, type ConsentTransition } from '../index';
import { END, NOW, consent } from './fixtures';

const command = (state: ConsentCommand['state'], overrides: Partial<ConsentCommand> = {}): ConsentCommand => ({
  eventId: `event-${state}`, expectedRevision: 1,
  actor: { accountId: 'shared-account', verifiedPersonId: 'alice' }, state, now: NOW, ...overrides,
});

function accepted(result: ConsentTransition): Extract<ConsentTransition, { ok: true }> {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('purpose permission transition proposals', () => {
  it('requires presentation and affirmative evidence before a fresh grant', () => {
    const initial: ConsentPermission = { ...consent(), state: 'not_asked', epoch: 0 };
    expect(transitionConsent(initial, command('granted')).ok).toBe(false);
    const presented = accepted(transitionConsent(initial, command('presented')));
    expect(presented.permission.state).toBe('presented');
    expect(presented.permission.epoch).toBe(1);
    expect(transitionConsent(presented.permission, command('granted', { expectedRevision: 2 })).ok).toBe(false);
    const granted = accepted(transitionConsent(presented.permission, command('granted', {
      expectedRevision: 2, expiresAt: END,
      evidence: { kind: 'consent', noticeId: 'notice', noticeVersion: 'v1', renderedCopyHash: 'hash',
        locale: 'fa', presentedAt: NOW, affirmative: true },
    })));
    expect(granted.permission).toMatchObject({ state: 'granted', epoch: 2, revision: 3, expiresAt: END });
    expect(granted.event).toMatchObject({ personId: 'alice', purpose: 'optional.personalization',
      actorAccountId: 'shared-account', state: 'granted', evidence: { locale: 'fa' } });
    expect(initial.state).toBe('not_asked'); // Proposal functions do not mutate inputs.
  });

  it('withdrawal is immediate and advances epoch independently of deletion', () => {
    const next = accepted(transitionConsent(consent(), command('withdrawn')));
    expect(next.permission).toMatchObject({ state: 'withdrawn', epoch: 2, revision: 2, effectiveAt: NOW, expiresAt: NOW });
    expect(next.event?.evidence).toBeUndefined();
    expect(transitionConsent(next.permission, command('granted', { expectedRevision: 1 }))).toEqual({ ok: false, reason: 'revision_conflict' });
    expect(transitionConsent(next.permission, command('granted', { expectedRevision: 2 }))).toEqual({ ok: false, reason: 'invalid_transition' });
  });

  it('recognizes an exact immediate duplicate and rejects changed reuse of the event ID', () => {
    const withdrawal = command('withdrawn');
    const next = accepted(transitionConsent(consent(), withdrawal));
    expect(transitionConsent(next.permission, withdrawal)).toEqual({ ok: true, duplicate: true, permission: next.permission });
    expect(transitionConsent(next.permission, { ...withdrawal, state: 'presented' })).toEqual({ ok: false, reason: 'event_conflict' });
  });

  it('a stale grant cannot override a newer withdrawal, including reordered replay', () => {
    const next = accepted(transitionConsent(consent(), command('withdrawn')));
    expect(transitionConsent(next.permission, command('presented', { eventId: 'old-grant', expectedRevision: 1 }))).toEqual({ ok: false, reason: 'revision_conflict' });
  });

  it('does not grant another person through shared account ownership', () => {
    expect(transitionConsent(consent('bob'), command('withdrawn'))).toEqual({ ok: false, reason: 'actor_mismatch' });
  });

  it.each(['declined', 'withdrawn', 'expired', 'suspended'] as const)('does not re-present %s permission without a deliberate action', state => {
    const stopped = { ...consent(), state };
    expect(transitionConsent(stopped, command('presented'))).toEqual({ ok: false, reason: 'invalid_transition' });
    expect(transitionConsent(stopped, command('presented', { deliberateReopen: true })).ok).toBe(true);
    expect(transitionConsent(stopped, command('granted', { deliberateReopen: true })).ok).toBe(false);
  });

  it('can show required new disclosure without reopening stopped optional processing', () => {
    const current = { ...consent(), state: 'reconsent_required' as const };
    const presented = accepted(transitionConsent(current, command('presented')));
    expect(presented.permission.state).toBe('presented');
    expect(presented.permission.expiresAt).toBe(NOW);
    expect(transitionConsent(current, command('granted')).ok).toBe(false);
  });

  it('notice acknowledgement, expired permission, blank copy and future presentation never grant', () => {
    const presented = { ...consent(), state: 'presented' as const };
    const evidence = { kind: 'consent' as const, noticeId: 'notice', noticeVersion: 'v1', renderedCopyHash: 'hash',
      locale: 'en' as const, presentedAt: 100, affirmative: true as const };
    for (const patch of [
      { evidence: { ...evidence, kind: 'notice_acknowledgement' } },
      { evidence: { ...evidence, affirmative: false } },
      { evidence: { ...evidence, renderedCopyHash: '' } },
      { evidence: { ...evidence, presentedAt: NOW + 1 } },
      { expiresAt: NOW },
    ]) {
      const invalid = { ...command('granted', { evidence, expiresAt: END }), ...patch } as unknown as ConsentCommand;
      expect(transitionConsent(presented, invalid).ok).toBe(false);
    }
  });

  it('fails closed on epoch overflow and invalid timestamps', () => {
    expect(transitionConsent({ ...consent(), epoch: Number.MAX_SAFE_INTEGER }, command('withdrawn')).ok).toBe(false);
    expect(transitionConsent(consent(), command('withdrawn', { now: Number.NaN })).ok).toBe(false);
  });
});
