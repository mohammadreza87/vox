import { describe, expect, it } from 'vitest';
import { preferenceRecordSchema, resolvePreferences, type PreferenceRecord } from './index';
const now = Date.UTC(2026, 9, 19, 12);
const scope = { tenantId: 'tenant1', spaceId: 'personal', containerId: 'private1', personId: 'person1', agentId: 'agent1' };
const preference = (extra: Partial<PreferenceRecord> = {}): PreferenceRecord => ({ ...scope, schemaVersion: 1, id: 'pref1', revision: 1,
  createdAt: now - 1000, updatedAt: now - 1000, origin: 'explicit', status: 'active', setting: { key: 'response_length', value: 'brief' }, evidenceEventIds: [], ...extra });
const resolve = (records: unknown[], auth = async () => true) => resolvePreferences(records, scope, now, auth);
describe('scoped personalization', () => {
  it('always ranks an explicit setting above a newer hypothesis', async () => {
    const result = await resolve([preference(), preference({ id: 'hyp1', origin: 'hypothesis', createdAt: now - 100, updatedAt: now - 100, expiresAt: now + 1000, evidenceEventIds: ['evt1'], setting: { key: 'response_length', value: 'detailed' } })]);
    expect(result[0]).toMatchObject({ source: 'explicit', setting: { key: 'response_length', value: 'brief' } });
  });
  it('honors explicit reset without resurrecting an old inference', async () => {
    const result = await resolve([preference({ status: 'reset' }), preference({ id: 'hyp1', origin: 'hypothesis', expiresAt: now + 1000, evidenceEventIds: ['evt1'] })]);
    expect(result[0]).toMatchObject({ source: 'reset', setting: { value: 'balanced' } });
  });
  it('requires evidence and bounded expiry on every hypothesis', () => {
    expect(preferenceRecordSchema.safeParse(preference({ origin: 'hypothesis' })).success).toBe(false);
    expect(preferenceRecordSchema.safeParse(preference({ origin: 'hypothesis', evidenceEventIds: ['evt1'], expiresAt: now + 8 * 86_400_000 })).success).toBe(false);
  });
  it('rejects expired, cross-person, cross-agent, cross-space or revoked settings', async () => {
    for (const record of [preference({ expiresAt: now }), preference({ personId: 'person2' }), preference({ agentId: 'agent2' }), preference({ spaceId: 'work' })]) {
      expect((await resolve([record]))[0]).toMatchObject({ source: 'default' });
    }
    expect((await resolve([preference()], async () => false))[0]).toMatchObject({ source: 'default' });
  });
  it('permits only low-risk configurations and rejects extra content', async () => {
    expect((await resolve([{ ...preference(), text: 'PRIVATE_CANARY' }]))[0]).toMatchObject({ source: 'default' });
    expect(preferenceRecordSchema.safeParse({ ...preference(), setting: { key: 'emotion', value: 'sad' } }).success).toBe(false);
    expect(preferenceRecordSchema.safeParse({ ...preference(), setting: { key: 'language', value: 'detailed' } }).success).toBe(false);
  });
});
