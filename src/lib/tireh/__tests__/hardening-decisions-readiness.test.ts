/**
 * H3 (F070, F121): section 4.8's pre-production gates for Decisions as
 * content-free readiness codes. Deployment attestations, not feature flags:
 * they never switch a code path on, and they are logged only when the service
 * decider is selected. Pure unit tests over an injected environment.
 */
import { describe, expect, it, vi } from 'vitest';
import { decisionsReadiness, reportDecisionsReadiness, safetyIdSalt } from '../decisions/readiness';

const SALT = 'synthetic-salt-0123456789abcdef-0123456789';
const READY: NodeJS.ProcessEnv = { DECISIONS_ZDR_APPROVED: '1', DECISIONS_EU_ENDPOINT_CONFIRMED: '1', DECISIONS_SAFETY_ID_SALT: SALT };

describe('decisionsReadiness', () => {
  it('names every missing attestation, in a fixed order', () => {
    expect(decisionsReadiness({})).toEqual(['zdr_unconfirmed', 'eu_endpoint_unconfirmed', 'safety_identifier_salt_missing']);
  });

  it('one code per missing attestation', () => {
    expect(decisionsReadiness(READY)).toEqual([]);
    expect(decisionsReadiness({ ...READY, DECISIONS_ZDR_APPROVED: '' })).toEqual(['zdr_unconfirmed']);
    expect(decisionsReadiness({ ...READY, DECISIONS_ZDR_APPROVED: 'true' })).toEqual(['zdr_unconfirmed']);
    expect(decisionsReadiness({ ...READY, DECISIONS_EU_ENDPOINT_CONFIRMED: '0' })).toEqual(['eu_endpoint_unconfirmed']);
    expect(decisionsReadiness({ ...READY, DECISIONS_SAFETY_ID_SALT: undefined })).toEqual(['safety_identifier_salt_missing']);
    expect(decisionsReadiness({ ...READY, DECISIONS_SAFETY_ID_SALT: '   ' })).toEqual(['safety_identifier_salt_missing']);
  });

  it('a short salt or one equal to STUDIO_SECRET is reported as invalid and ignored', () => {
    expect(decisionsReadiness({ ...READY, DECISIONS_SAFETY_ID_SALT: 'x'.repeat(31) })).toEqual(['safety_identifier_salt_invalid']);
    expect(decisionsReadiness({ ...READY, STUDIO_SECRET: SALT })).toEqual(['safety_identifier_salt_invalid']);
    expect(safetyIdSalt({ DECISIONS_SAFETY_ID_SALT: 'x'.repeat(31) })).toBeUndefined();
    expect(safetyIdSalt({ DECISIONS_SAFETY_ID_SALT: 'x'.repeat(32) })).toBe('x'.repeat(32));
    expect(safetyIdSalt({ DECISIONS_SAFETY_ID_SALT: SALT, STUDIO_SECRET: SALT })).toBeUndefined();
  });

  it('codes are content-free: never the salt or any other value', () => {
    const codes = decisionsReadiness({ DECISIONS_SAFETY_ID_SALT: 'PRIVATE_SALT_CANARY' });
    expect(JSON.stringify(codes)).not.toContain('PRIVATE_SALT_CANARY');
    for (const code of codes) expect(code).toMatch(/^[a-z_]+$/);
  });
});

describe('reportDecisionsReadiness', () => {
  it('logs one [vox] decisions_readiness line per code under the service decider', () => {
    const warn = vi.fn();
    expect(reportDecisionsReadiness({ ...READY, DECISIONS_ZDR_APPROVED: '' }, 'service', warn)).toEqual(['zdr_unconfirmed']);
    expect(warn.mock.calls).toEqual([['[vox] decisions_readiness:zdr_unconfirmed']]);
  });

  it('logs nothing when the decider is default, whatever is missing', () => {
    const warn = vi.fn();
    expect(reportDecisionsReadiness({}, 'default', warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs nothing when everything is attested', () => {
    const warn = vi.fn();
    expect(reportDecisionsReadiness(READY, 'service', warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
