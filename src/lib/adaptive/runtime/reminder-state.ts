import { digest, type AdaptiveDocument, type SpaceKind } from '../persistence/repository';
import type { AdaptiveService } from '../persistence/service';
import { REMINDER_DISCLOSURE_VERSION, emptyReminderDelivery, type ReminderTelegramStatus } from './reminder-contracts';
export const REMINDER_PURPOSE = 'optional.reminder_delivery' as const;
/** Background authority authorizes generic requested alerts only. It grants no
 * interactive identity, private reads, exports, provider context or new commands. */
export function reminderPermit(adaptive: AdaptiveService, d: AdaptiveDocument, space: SpaceKind, now: number, agentId?: string): { fingerprint: string; expiresAt: number } | null {
  const state = d.experience.reminderDelivery, channel = state?.[space], authorization = channel?.authorization;
  const permission = d.permissions.find(p => p.id === `permission:${space}:${REMINDER_PURPOSE}`);
  const capability = adaptive.capabilityStatus(d, 'reminder_delivery', now);
  if (!channel?.enabled || !authorization || authorization.version !== REMINDER_DISCLOSURE_VERSION || authorization.accountId !== d.accountId || authorization.personId !== d.personId || authorization.space !== space ||
      !d.binding || d.binding.status !== 'verified' || d.binding.accountId !== d.accountId || d.binding.personId !== d.personId ||
      authorization.issuedAt > now || authorization.expiresAt <= now || authorization.expiresAt > authorization.issuedAt + 30 * 86400_000 ||
      channel.endpointId !== authorization.endpointId || state?.recipient?.endpointId !== authorization.endpointId || state.recipient.revision !== authorization.recipientRevision ||
      !permission || permission.state !== 'granted' || permission.effectiveAt > now || permission.expiresAt <= now || permission.revision !== authorization.permissionRevision || permission.epoch !== authorization.consentEpoch ||
      !capability.eligible || (agentId && !d.agentGrants.some(g => g.space === space && g.agentId === agentId && g.allowed))) return null;
  const expiresAt = Math.min(authorization.expiresAt, permission.expiresAt, capability.validUntil ?? now);
  if (expiresAt <= now) return null;
  return { fingerprint: digest([d.accountId, d.personId, authorization, channel.revision, permission, capability, state.recipient,
    agentId ? d.agentGrants.filter(g => g.space === space && g.agentId === agentId) : null]), expiresAt };
}
export function reminderDisclosureAuthority(adaptive: AdaptiveService, d: AdaptiveDocument, space: SpaceKind, now: number): string {
  return digest([adaptive.purposeFingerprint(d, space, REMINDER_PURPOSE, now), d.experience.reminderDelivery?.recipient]);
}
export function reminderChannelStatus(adaptive: AdaptiveService, d: AdaptiveDocument, space: SpaceKind, now: number,
  enabled: boolean, endpointId?: string): ReminderTelegramStatus {
  const state = d.experience.reminderDelivery, channel = state?.[space];
  const connected = !!endpointId && state?.recipient?.endpointId === endpointId;
  const available = enabled && connected && adaptive.isPurposeAllowed(d, space, REMINDER_PURPOSE, now);
  const permit = enabled && connected && channel?.endpointId === endpointId ? reminderPermit(adaptive, d, space, now) : null;
  const presentation = channel?.presentation;
  const disclosure = available && presentation && presentation.expiresAt > now && presentation.authority === reminderDisclosureAuthority(adaptive, d, space, now)
    ? { version: presentation.version, receipt: presentation.receipt, expiresAt: presentation.expiresAt } : undefined;
  return { available, connected, enabled: !!permit, ...(permit ? { expiresAt: permit.expiresAt } : {}), ...(disclosure ? { disclosure } : {}),
    ...(channel?.enabled && !permit ? { renewalRequired: true } : {}),
    ...(!enabled ? { reason: 'feature_disabled' } : !connected ? { reason: 'private_dm_required' } : !available ? { reason: 'reminder_consent_required' } : {}) };
}
export function ensureReminderDelivery(d: AdaptiveDocument) { return d.experience.reminderDelivery ??= emptyReminderDelivery(); }
/** Minimized terminal state is kept for dedupe; cancelled/expired labels are removed by the experience pruner. */
export function pruneReminderDelivery(d: AdaptiveDocument, now: number): void {
  const state = d.experience.reminderDelivery;
  if (!state) return;
  state.ledger = state.ledger.filter(row => row.at > now - 30 * 86_400_000);
  for (const item of d.experience.inbox) {
    if (!item.delivery || ['accepted', 'unknown', 'failed', 'cancelled'].includes(item.delivery.state)) continue;
    if (item.status === 'cancelled' || item.status === 'dismissed' || item.expiresAt <= now) {
      item.delivery.state = 'cancelled';
      for (const row of state.ledger.filter(row => row.itemId === item.id && row.generation === item.delivery!.generation && ['claimed', 'dispatching'].includes(row.state))) {
        // Once dispatching, transport may already have accepted it. Suppress use,
        // but preserve unknown outcome rather than inventing a cancelled send.
        row.state = row.state === 'dispatching' ? 'unknown' : 'cancelled';
      }
    }
  }
}
