import { describe, expect, it, vi } from 'vitest';
import { authorizeObservation, observationKey, parseObservation, projectOutcomes } from './index';
const now = Date.UTC(2026, 9, 19, 12);
const event = (extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, id: 'evt1', producer: 'studio', revision: 1,
  tenantId: 'tenant1', spaceId: 'work', containerId: 'private1', personId: 'person1', sessionId: 'session1', turnId: 'turn1',
  occurredAt: now - 100, receivedAt: now, sourceRevision: 1, policyVersion: 'v1', purpose: 'optional.product_analytics',
  origin: 'human', trust: 'server_verified', sampleRate: 1, expiresAt: now + 1000, name: 'turn.started', payload: { channel: 'voice' }, ...extra });
const ctx = { tenantId: 'tenant1', spaceId: 'work', containerId: 'private1', from: now - 1000, until: now + 1, now, authorize: async () => true, complete: false };
describe('observation projection', () => {
  it('rejects arbitrary and content-bearing fields at envelope and payload boundaries', () => {
    expect(parseObservation(event({ transcript: 'PRIVATE_CANARY' }), now)).toBeNull();
    expect(parseObservation(event({ payload: { channel: 'voice', text: 'PRIVATE_CANARY' } }), now)).toBeNull();
    expect(parseObservation(event({ name: '__proto__', payload: {} }), now)).toBeNull();
    expect(parseObservation(event({ name: 'screen.recording', payload: {} }), now)).toBeNull();
  });
  it('enforces current eligibility before ingestion and marks expiry separately', async () => {
    const authorize = vi.fn(async () => false);
    expect(await authorizeObservation(event(), now, authorize)).toEqual({ accepted: false, reason: 'unauthorized' });
    expect(await authorizeObservation(event({ expiresAt: now - 1, receivedAt: now - 50 }), now, authorize)).toEqual({ accepted: false, reason: 'expired' });
    expect(authorize).toHaveBeenCalledOnce();
  });
  it('keeps missing task outcomes unknown and absent audio unavailable', async () => {
    const result = await projectOutcomes([event(), event({ id: 'reply1', name: 'response.first_text', payload: { durationMs: 50 } })], ctx);
    expect(result).toMatchObject({ turnCount: 1, verifiedSuccesses: 0, unknownOutcomes: 1, firstAudioP50Ms: null, complete: false });
  });
  it('deduplicates replay and supersedes old revisions without counting generated replies as success', async () => {
    const first = event({ name: 'tool.commit_verified', payload: { outcome: 'failure' } });
    const second = event({ revision: 2, name: 'tool.commit_verified', payload: { outcome: 'success' } });
    const result = await projectOutcomes([second, first, second], ctx);
    expect(result).toMatchObject({ eventCount: 1, turnCount: 1, verifiedSuccesses: 1, verifiedFailures: 0 });
    expect(observationKey(parseObservation(first, now)!)).not.toEqual(observationKey(parseObservation(second, now)!));
  });
  it('rejects QA, denied, expired, operational, cross-space and sampled events from product outcomes', async () => {
    const events = [event({ origin: 'qa' }), event({ spaceId: 'personal' }), event({ purpose: 'ops.security_reliability' }), event({ sampleRate: 0.5 }), event({ id: 'denied' }), event({ expiresAt: now - 1, receivedAt: now - 50 })];
    const result = await projectOutcomes(events, { ...ctx, authorize: async e => e.id !== 'denied' });
    expect(result).toMatchObject({ eventCount: 0, turnCount: 0, firstAudioP95Ms: null });
  });
  it('retains client trust labels and refuses unverified successes', async () => {
    const result = await projectOutcomes([event({ trust: 'client_unverified', name: 'tool.commit_verified', payload: { outcome: 'success' } }),
      event({ id: 'audio', trust: 'client_unverified', name: 'audio.first_played', payload: { durationMs: 120 } })], ctx);
    expect(result).toMatchObject({ verifiedSuccesses: 0, unknownOutcomes: 1, firstAudioP50Ms: 120, unverifiedClientEvents: 2 });
    expect(JSON.stringify(result)).not.toContain('person1');
  });
  it('keeps contradictory verified outcomes unknown', async () => {
    const result = await projectOutcomes([event({ name: 'tool.commit_verified', payload: { outcome: 'success' } }), event({ id: 'evt2', name: 'tool.commit_verified', payload: { outcome: 'failure' } })], ctx);
    expect(result).toMatchObject({ unknownOutcomes: 1, verifiedSuccesses: 0, verifiedFailures: 0 });
  });
});
