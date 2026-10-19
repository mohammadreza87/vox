import { describe, expect, it } from 'vitest';
import { evaluateCapability, type CapabilityRequest, type JurisdictionApproval } from '../index';
import { END, NOW, base } from './fixtures';

function request(): CapabilityRequest {
  return { capability: 'biometric_recognition', personId: 'alice', configurationVersion: 'config-1', enabled: true,
    jurisdiction: { status: 'known', requiredKeys: ['US-IL'] },
    adultEntry: { personId: 'alice', state: 'adult_confirmed', method: 'explicit_declaration',
      effectiveAt: 100, expiresAt: END, revision: 1 } };
}

function approval(jurisdiction = 'US-IL'): JurisdictionApproval {
  return { ...base, id: `approval-${jurisdiction}`, jurisdiction, capability: 'biometric_recognition',
    state: 'approved', configurationVersion: 'config-1', effectiveAt: 100, reviewExpiresAt: END,
    owner: 'legal-owner', approvalReference: 'restricted-review-reference' };
}

describe('deterministic capability eligibility', () => {
  it('approves only an enabled exact capability/config with current adult and jurisdiction facts', () => {
    expect(evaluateCapability(request(), [approval()], NOW)).toEqual({ eligible: true, validUntil: END,
      approvalVersions: ['["approval-US-IL",1]'] });
    expect(evaluateCapability({ ...request(), enabled: false }, [approval()], NOW)).toEqual({ eligible: false, reason: 'disabled' });
    expect(evaluateCapability({ ...request(), capability: 'multi_party_audio' }, [approval()], NOW).eligible).toBe(false);
  });

  it.each(['unknown', 'underage', 'suspended'] as const)('a %s participant cannot enable optional capability', state => {
    const current = request();
    expect(evaluateCapability({ ...current, adultEntry: { ...current.adultEntry, state } }, [approval()], NOW)).toEqual({ eligible: false, reason: 'adult_required' });
  });

  it('rejects expired age proof, another person and non-approved proof methods', () => {
    const current = request();
    for (const patch of [{ expiresAt: NOW }, { personId: 'bob' }, { method: 'voice_match' }]) {
      expect(evaluateCapability({ ...current, adultEntry: { ...current.adultEntry, ...patch } } as CapabilityRequest, [approval()], NOW).eligible).toBe(false);
    }
  });

  it.each(['unknown', 'conflicting'] as const)('fails closed for %s jurisdiction', status => {
    expect(evaluateCapability({ ...request(), jurisdiction: { status } }, [approval()], NOW)).toEqual({ eligible: false, reason: 'jurisdiction_unknown' });
  });

  it('requires every participant/applicable jurisdiction and never inherits EU or US approvals', () => {
    const current = { ...request(), jurisdiction: { status: 'known' as const, requiredKeys: ['US-IL', 'US-TX'] } };
    expect(evaluateCapability(current, [approval()], NOW).eligible).toBe(false);
    expect(evaluateCapability(current, [approval(), approval('US-TX')], NOW).eligible).toBe(true);
    expect(evaluateCapability(request(), [approval('US')], NOW).eligible).toBe(false);
    expect(evaluateCapability({ ...request(), jurisdiction: { status: 'known', requiredKeys: ['EE'] } }, [approval('EU')], NOW).eligible).toBe(false);
  });

  it.each(['blocked', 'review_pending'] as const)('cannot turn a %s legal registry row into approval', state => {
    expect(evaluateCapability(request(), [{ ...approval(), state }], NOW)).toEqual({ eligible: false, reason: state });
  });

  it('rejects duplicate/conflicting rows, expired review, future effective date and changed config', () => {
    expect(evaluateCapability(request(), [approval(), { ...approval(), id: 'conflict', state: 'blocked' }], NOW).eligible).toBe(false);
    for (const patch of [{ reviewExpiresAt: NOW }, { effectiveAt: NOW + 1 }, { configurationVersion: 'different' }, { owner: '' }, { schemaVersion: 2 }]) {
      expect(evaluateCapability(request(), [{ ...approval(), ...patch } as JurisdictionApproval], NOW).eligible).toBe(false);
    }
  });
});
