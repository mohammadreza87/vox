import { describe, expect, it } from 'vitest';
import { evaluateNotification, isQuietHour, prepareNotification, type DeliveryLedgerEntry, type NotificationIntent, type NotificationPolicySnapshot, type NotificationPreferences } from './index';
const now = Date.UTC(2026, 9, 19, 12);
const intent: NotificationIntent = { schemaVersion: 1, id: 'opaque1', tenantId: 'tenant1', spaceId: 'work', containerId: 'private1',
  recipientPersonId: 'person1', category: 'proactive', channel: 'telegram', sourceIds: ['source1'], sourceRevision: 1, policyVersion: 'v1', createdAt: now - 1000, dueAt: now - 500, expiresAt: now + 1000, dedupeKey: 'dedupe1' };
const preferences: NotificationPreferences = { personId: 'person1', revision: 1, enabled: true, proactiveEnabled: true, reminderEnabled: true, channel: 'telegram', timezone: 'Europe/Tallinn' };
const consent = { purpose: true, channel: true };
const evaluate = (i: unknown = intent, p = preferences, l: DeliveryLedgerEntry[] = [], t = now, c = consent, auth = true) => evaluateNotification(i, p, l, t, c, auth);
const ledger = (extra: Partial<DeliveryLedgerEntry> = {}): DeliveryLedgerEntry => ({ personId: 'person1', intentId: 'prior', dedupeKey: 'prior', category: 'proactive', state: 'provider_accepted', at: now - 100, ...extra });
describe('notification eligibility only', () => {
  it('returns a generic external envelope without source details', () => {
    const result = evaluate();
    expect(result).toEqual({ status: 'eligible', channel: 'telegram', intentId: 'opaque1', payload: { text: 'You have an update in Vox.', reference: 'opaque1' } });
    expect(JSON.stringify(result)).not.toContain('source1');
  });
  it('defaults optional purposes off and requires separate purpose/channel choices', () => {
    expect(evaluate(intent, { ...preferences, proactiveEnabled: false })).toMatchObject({ reason: 'disabled' });
    expect(evaluate(intent, preferences, [], now, { purpose: false, channel: true })).toMatchObject({ reason: 'consent' });
    expect(evaluate(intent, preferences, [], now, { purpose: true, channel: false })).toMatchObject({ reason: 'consent' });
    expect(evaluate(intent, preferences, [], now, consent, false)).toMatchObject({ reason: 'policy' });
  });
  it('keeps unknown or invalid timezones in the authenticated inbox', () => {
    expect(evaluate(intent, { ...preferences, timezone: undefined })).toMatchObject({ status: 'inbox_only', reason: 'timezone_unknown' });
    expect(evaluate(intent, { ...preferences, timezone: 'Guess/Timezone' })).toMatchObject({ status: 'inbox_only' });
  });
  it('honors quiet hours in the selected IANA zone across DST', () => {
    expect(isQuietHour(Date.UTC(2026, 9, 24, 19), 'Europe/Tallinn')).toBe(true);
    expect(isQuietHour(Date.UTC(2026, 9, 26, 19), 'Europe/Tallinn')).toBe(true);
    expect(isQuietHour(Date.UTC(2026, 9, 26, 6), 'Europe/Tallinn')).toBe(false);
    expect(evaluate(intent, { ...preferences, timezone: 'Asia/Tokyo' })).toMatchObject({ reason: 'quiet_hours' });
  });
  it('enforces cap two across spaces and blocks uncertain/reserved duplicates', () => {
    expect(evaluate(intent, preferences, [ledger(), ledger({ intentId: 'prior2', dedupeKey: 'prior2', state: 'unknown' })])).toMatchObject({ reason: 'budget' });
    expect(evaluate(intent, preferences, [ledger({ dedupeKey: intent.dedupeKey, state: 'reserved' })])).toMatchObject({ reason: 'duplicate' });
    expect(evaluate(intent, preferences, [ledger({ at: now - 86_400_000 }), ledger({ personId: 'person2' })])).toMatchObject({ status: 'eligible' });
  });
  it('does not let semantic urgency bypass quiet hours or turn a nudge into a reminder', () => {
    expect(evaluate({ ...intent, urgency: 1 })).toMatchObject({ reason: 'invalid' });
    expect(evaluate({ ...intent, reminderQuietHours: 'allow_at_requested_time' }, { ...preferences, timezone: 'Asia/Tokyo' })).toMatchObject({ reason: 'quiet_hours' });
    expect(evaluate({ ...intent, category: 'reminder', reminderQuietHours: 'allow_at_requested_time' }, { ...preferences, timezone: 'Asia/Tokyo' })).toMatchObject({ status: 'eligible' });
  });
  it('rejects expired, premature, muted, cross-person and malformed preferences', () => {
    expect(evaluate({ ...intent, expiresAt: now })).toMatchObject({ reason: 'expired' });
    expect(evaluate({ ...intent, dueAt: now + 1 })).toMatchObject({ reason: 'not_due' });
    expect(evaluate(intent, { ...preferences, mutedUntil: now + 100 })).toMatchObject({ reason: 'muted' });
    expect(evaluate(intent, { ...preferences, personId: 'other' })).toMatchObject({ reason: 'policy' });
    expect(evaluate(intent, { ...preferences, dailyCap: NaN })).toMatchObject({ reason: 'invalid' });
    expect(evaluate(intent, preferences, [ledger({ at: NaN })])).toMatchObject({ reason: 'invalid' });
    expect(evaluate(intent, preferences, [ledger({ at: now + 1 })])).toMatchObject({ reason: 'invalid' });
  });
  it('rechecks source, endpoint, consent, preferences and ledger versions after preparing', async () => {
    const snapshot: NotificationPolicySnapshot = { preferences, ledger: [], consent, authorizationFingerprint: 'v1', revision: 'v1' };
    let calls = 0;
    expect(await prepareNotification(intent, { now: () => now, current: async () => (++calls === 1 ? snapshot : { ...snapshot, authorizationFingerprint: null }) })).toMatchObject({ reason: 'stale' });
    expect(calls).toBe(2);
    expect(await prepareNotification(intent, { now: () => now, current: async () => { throw new Error('PRIVATE_CANARY'); } })).toEqual({ status: 'suppressed', reason: 'policy' });
  });
});
