import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { subscriptionSchema, type ConnectionContext } from '../contracts';
import { baseRecord } from '../service';
import { verifyProviderEvent } from '../events/verification';

const NOW = Date.parse('2026-10-19T12:00:00Z'); const SECRET = new Uint8Array(32).fill(49);
function fixture() {
  const context: ConnectionContext = { accountId: 'qa-events-account', personId: 'qa-person', bindingId: 'qa-binding', bindingRevision: 1,
    bindingExpiresAt: NOW + 3_600_000, currentAgentIds: ['qa-agent'], scope: { tenantId: 'qa-tenant', spaceId: 'qa-work', spaceKind: 'work',
      containerId: 'qa-private', audiencePersonIds: ['qa-person'], audienceRevision: 'qa-audience' } };
  const subscription = subscriptionSchema.parse({ ...baseRecord(context, NOW), connectionId: 'qa-slack-connection', providerId: 'slack',
    providerTenantId: 'T012345678', nativeResourceId: 'C012345678', resourceId: 'slack:channel:C012345678', eventTypes: ['message'],
    secretRef: 'qa-vault-secret-reference', secretVersion: 1, status: 'active', expiresAt: NOW + 3_600_000 });
  const signed = (overrides: Record<string, unknown> = {}, timestamp = String(NOW / 1000)) => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'event_callback', team_id: 'T012345678', event_id: 'Ev012345678', event_time: NOW / 1000,
      event: { type: 'message', channel: 'C012345678', user: 'U012345678', text: 'PRIVATE_SLACK_EVENT_CANARY' }, ...overrides }));
    const headers = { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': 'v0=' + createHmac('sha256', SECRET).update(`v0:${timestamp}:`).update(bytes).digest('hex') };
    return { bytes, headers };
  };
  return { subscription, signed };
}

describe('independent signed Slack event input (no provider calls)', () => {
  it('verifies original timestamp/body bytes and returns metadata without message content', () => {
    const f = fixture(); const input = f.signed();
    const event = verifyProviderEvent(input.bytes, input.headers, f.subscription, SECRET, NOW);
    expect(event).toMatchObject({ providerId: 'slack', providerEventId: 'Ev012345678', providerTenantId: 'T012345678', nativeResourceId: 'C012345678', secretVersion: 1 });
    expect(JSON.stringify(event)).not.toContain('PRIVATE_SLACK_EVENT_CANARY'); expect(event.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    { team_id: 'T999999999' },
    { event: { type: 'message', channel: 'C999999999' } },
    { event: { type: 'unauthorized-event', channel: 'C012345678' } },
  ])('a valid signature cannot authorize another native tenant/resource/type: %j', override => {
    const f = fixture(); const input = f.signed(override);
    expect(() => verifyProviderEvent(input.bytes, input.headers, f.subscription, SECRET, NOW)).toThrow('event_scope_or_replay_denied');
  });

  it('rejects stale timestamps, altered bodies, revoked subscriptions and an incorrect secret', () => {
    const f = fixture(); const input = f.signed(); const stale = f.signed({}, String(NOW / 1000 - 301));
    expect(() => verifyProviderEvent(stale.bytes, stale.headers, f.subscription, SECRET, NOW)).toThrow('event_signature_denied');
    expect(() => verifyProviderEvent(new TextEncoder().encode('{}'), input.headers, f.subscription, SECRET, NOW)).toThrow('event_signature_denied');
    expect(() => verifyProviderEvent(input.bytes, input.headers, { ...f.subscription, status: 'revoked' }, SECRET, NOW)).toThrow('event_signature_denied');
    expect(() => verifyProviderEvent(input.bytes, input.headers, f.subscription, new Uint8Array(32).fill(50), NOW)).toThrow('event_signature_denied');
  });

  it.each([{ bot_id: 'B012345678' }, { subtype: 'bot_message' }])('bot feedback cannot trigger another workflow: %j', extra => {
    const f = fixture(); const input = f.signed({ event: { type: 'message', channel: 'C012345678', ...extra } });
    expect(() => verifyProviderEvent(input.bytes, input.headers, f.subscription, SECRET, NOW)).toThrow('event_feedback_denied');
  });
});
