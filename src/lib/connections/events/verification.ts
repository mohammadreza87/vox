import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionSubscription } from '../contracts';
import { ConnectionsError } from '../errors';
export interface VerifiedConnectionEvent {
  subscriptionId: string; providerId: 'github' | 'slack'; providerEventId: string; payloadDigest: string; safeType: string;
  providerTenantId: string; nativeResourceId: string; occurredAt: number; secretVersion: number;
}
const object = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const nativeId = (value: unknown): string => {
  if (typeof value === 'string' && /^[A-Za-z0-9_.:@/-]{1,200}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new ConnectionsError(400, 'event_native_identity_invalid');
};
const refuse = (): never => { throw new ConnectionsError(401, 'event_signature_denied'); };
/** Broker-only raw-byte boundary. A successfully signed event still grants no workflow/action authority. */
export function verifyProviderEvent(raw: Uint8Array, headers: Readonly<Record<string, string | undefined>>,
  subscription: ConnectionSubscription, secret: Uint8Array, now = Date.now()): VerifiedConnectionEvent {
  if (raw.byteLength > 128_000 || raw.byteLength === 0 || secret.byteLength < 32 || subscription.status !== 'active' || subscription.expiresAt <= now) return refuse();
  let providerEventId: string; let safeType: string;
  if (subscription.providerId === 'github') {
    const signature = headers['x-hub-signature-256'];
    if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return refuse();
    const expected = createHmac('sha256', secret).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) return refuse();
    providerEventId = nativeId(headers['x-github-delivery']); safeType = nativeId(headers['x-github-event']);
  } else {
    const timestamp = headers['x-slack-request-timestamp']; const signature = headers['x-slack-signature'];
    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || Math.abs(Number(timestamp) * 1000 - now) > 300_000 || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return refuse();
    const expected = createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), 'hex'))) return refuse();
    providerEventId = ''; safeType = '';
  }
  let parsed: Record<string, unknown>;
  try { parsed = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); }
  catch { throw new ConnectionsError(400, 'event_json_invalid'); }
  let providerTenantId: string; let nativeResourceId: string; let occurredAt: number;
  if (subscription.providerId === 'github') {
    if (!['issues', 'pull_request', 'push'].includes(safeType)) throw new ConnectionsError(400, 'event_type_unavailable');
    const repository = object(parsed.repository);
    // App installation IDs are a distinct namespace from repository owner IDs.
    // This implementation admits owner-scoped repository hooks only until a
    // separately reviewed native installation-membership readback exists.
    if (parsed.installation) throw new ConnectionsError(403, 'event_installation_qualification_required');
    providerTenantId = nativeId(object(repository.owner).id);
    nativeResourceId = nativeId(repository.id);
    const item = safeType === 'issues' ? object(parsed.issue) : safeType === 'pull_request' ? object(parsed.pull_request) : object(parsed.head_commit);
    const date = safeType === 'push' ? item.timestamp : item.updated_at;
    occurredAt = typeof date === 'string' ? Date.parse(date) : NaN;
  } else {
    if (parsed.type !== 'event_callback') throw new ConnectionsError(400, 'event_type_unavailable');
    const event = object(parsed.event);
    if ('bot_id' in event || event.subtype === 'bot_message') throw new ConnectionsError(400, 'event_feedback_denied');
    providerTenantId = nativeId(parsed.team_id); nativeResourceId = nativeId(event.channel);
    providerEventId = nativeId(parsed.event_id); safeType = nativeId(event.type);
    occurredAt = typeof parsed.event_time === 'number' ? parsed.event_time * 1000 : NaN;
  }
  if (!Number.isSafeInteger(occurredAt) || Math.abs(occurredAt - now) > 300_000 || providerTenantId !== subscription.providerTenantId ||
      nativeResourceId !== subscription.nativeResourceId || !subscription.eventTypes.includes(safeType)) throw new ConnectionsError(403, 'event_scope_or_replay_denied');
  return { subscriptionId: subscription.id, providerId: subscription.providerId, providerEventId, safeType, providerTenantId, nativeResourceId,
    occurredAt, secretVersion: subscription.secretVersion, payloadDigest: createHmac('sha256', secret).update('vox-event-replay:').update(raw).digest('hex') };
}
