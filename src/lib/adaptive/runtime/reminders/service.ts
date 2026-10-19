import { randomUUID } from 'node:crypto';
import { digest, type AdaptiveDocument, type SpaceKind } from '../../persistence/repository';
import { isQuietHour, isSelectedTimezone } from '../../notifications';
import type { AdaptiveExperienceService } from '../service';
import type { InboxItem } from '../contracts';
import { reminderChannelStatus, reminderPermit } from '../reminder-state';
export const GENERIC_REMINDER_TEXT = 'You have a reminder in Vox.';
export interface ReminderRecipient { telegramId: number; endpointId: string; revision: string }
export type ReminderSendResult = { state: 'accepted'; messageId: string } | { state: 'failed' | 'unknown' | 'cancelled' | 'deferred' };
export interface ReminderTransport {
  /** One request only. Recheck immediately before fetch; never retry an ambiguous POST. */
  send(input: { telegramId: number; reference: string; text: typeof GENERIC_REMINDER_TEXT; authorize: () => Promise<boolean>; authorizeNow: () => 'allowed' | 'denied' | 'busy'; signal: AbortSignal }): Promise<ReminderSendResult>;
}
export interface ReminderDeliveryOptions {
  enabled: boolean; endpointId: string; now?: () => number;
  recipient: (telegramId: number, agentId: string, space: SpaceKind) => Promise<ReminderRecipient | null>;
  recipientNow?: (telegramId: number, agentId: string, space: SpaceKind) => ReminderRecipient | null;
  transport: ReminderTransport;
}
export interface ReminderDrainResult { claimed: number; accepted: number; unknown: number; failed: number; cancelled: number; deferred: number }
/** The aggregate is the queue and delivery ledger. There is no in-memory queue to
 * lose on restart, no private label in the transport projection, and no promise
 * of exactly-once Telegram delivery. Ambiguous sends are never automatically retried. */
export class ReminderDeliveryService {
  constructor(readonly experience: AdaptiveExperienceService, private readonly options: ReminderDeliveryOptions) {}
  private current(d: AdaptiveDocument, item: InboxItem, now: number, target: ReminderRecipient): string | null {
    const state = d.experience.reminderDelivery, delivery = item.delivery, channel = state?.[item.space];
    const settings = d.experience.settings, selected = settings[item.space];
    const telegramId = Number(d.accountId.split(':')[1]);
    if (!this.options.enabled || target.telegramId !== telegramId || target.endpointId !== this.options.endpointId || !delivery ||
        delivery.endpointId !== target.endpointId || channel?.revision !== delivery.channelRevision || item.category !== 'reminder' ||
        item.status !== 'unread' || !selected.inboxEnabled || !selected.reminderEnabled || !isSelectedTimezone(settings.timezone) ||
        delivery.quietHours === 'respect' && isQuietHour(now, settings.timezone!, settings.quietStartHour, settings.quietEndHour) || item.dueAt > now || item.expiresAt <= now ||
        !reminderPermit(this.experience.adaptive, d, item.space, now, item.agentId) ||
        !reminderChannelStatus(this.experience.adaptive, d, item.space, now, true, this.options.endpointId).enabled) return null;
    return digest([reminderPermit(this.experience.adaptive, d, item.space, now, item.agentId)!.fingerprint,
      target.revision, target.telegramId, target.endpointId, state!.recipient, channel,
      settings.revision, selected.inboxEnabled, selected.reminderEnabled, settings.timezone, settings.quietStartHour, settings.quietEndHour,
      item.id, item.sourceEventId, item.dueAt, item.expiresAt, item.consentEpoch, item.grantRevision, delivery.generation, delivery.quietHours]);
  }
  private recover(d: AdaptiveDocument, now: number): void {
    for (const row of d.experience.reminderDelivery?.ledger ?? []) {
      if (row.leaseUntil > now || !['claimed', 'dispatching'].includes(row.state)) continue;
      const item = d.experience.inbox.find(i => i.id === row.itemId && i.delivery?.generation === row.generation && i.delivery.attemptId === row.id);
      if (row.state === 'dispatching') { row.state = 'unknown'; if (item?.delivery) item.delivery.state = 'unknown'; }
      else { row.state = 'cancelled'; if (item?.delivery && item.status === 'unread') { item.delivery.state = 'scheduled'; delete item.delivery.attemptId; } }
      d.revision++; d.updatedAt = now;
    }
  }
  async drainAccount(telegramId: number, options: { limit?: number; signal?: AbortSignal } = {}): Promise<ReminderDrainResult> {
    const report: ReminderDrainResult = { claimed: 0, accepted: 0, unknown: 0, failed: 0, cancelled: 0, deferred: 0 };
    if (!this.options.enabled || options.signal?.aborted) return report;
    const limit = options.limit ?? 2;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('invalid_reminder_limit');
    const pending = await this.experience.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.experience.pruneDocument(d, now); this.recover(d, now);
      const settings = d.experience.settings;
      return d.experience.inbox.filter(i => isSelectedTimezone(settings.timezone) && (i.delivery?.quietHours === 'allow_at_requested_time' || !isQuietHour(now, settings.timezone!, settings.quietStartHour, settings.quietEndHour)))
        .filter(i => i.category === 'reminder' && i.delivery?.state === 'scheduled' && i.status === 'unread' && i.dueAt <= now && i.expiresAt > now)
        .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id)).slice(0, limit).map(i => ({ id: i.id, agentId: i.agentId, space: i.space }));
    });
    for (const candidate of pending) {
      if (options.signal?.aborted) break;
      let target: ReminderRecipient | null;
      try { target = await this.options.recipient(telegramId, candidate.agentId, candidate.space); } catch { report.deferred++; continue; }
      if (!target) { report.deferred++; continue; }
      const reservation = await this.experience.adaptive.withAccountDocument(telegramId, (d, now) => {
        this.experience.pruneDocument(d, now); this.recover(d, now);
        const item = d.experience.inbox.find(i => i.id === candidate.id);
        if (!item?.delivery || item.delivery.state !== 'scheduled') return null;
        const settings = d.experience.settings;
        if (!isSelectedTimezone(settings.timezone) || item.delivery.quietHours === 'respect' && isQuietHour(now, settings.timezone, settings.quietStartHour, settings.quietEndHour)) return null;
        const fingerprint = this.current(d, item, now, target!);
        if (!fingerprint) { item.delivery.state = 'cancelled'; d.revision++; d.updatedAt = now; return null; }
        const state = d.experience.reminderDelivery!;
        const dedupeKey = digest([d.accountId, item.id, item.delivery.generation]);
        if (state.ledger.some(row => row.dedupeKey === dedupeKey && row.state !== 'cancelled') || state.ledger.length >= 500) return null;
        const id = randomUUID();
        state.ledger.push({ id, dedupeKey, itemId: item.id, generation: item.delivery.generation, space: item.space, agentId: item.agentId,
          state: 'claimed', at: now, leaseUntil: now + 15_000, fingerprint });
        item.delivery.state = 'claimed'; item.delivery.attemptId = id; d.revision++; d.updatedAt = now;
        return { id, fingerprint, itemId: item.id, generation: item.delivery.generation };
      });
      if (!reservation) { report.deferred++; continue; }
      report.claimed++;
      const authorize = async (phase: 'claimed' | 'dispatching'): Promise<boolean> => {
        if (options.signal?.aborted) return false;
        let latest: ReminderRecipient | null;
        try { latest = await this.options.recipient(telegramId, candidate.agentId, candidate.space); } catch { return false; }
        if (!latest || options.signal?.aborted) return false;
        let clockPolicy: { at: number; timezone: string; start: number; end: number; override: boolean; expiresAt: number } | undefined;
        const allowed = await this.experience.adaptive.withAccountDocument(telegramId, (d, now) => {
          this.experience.pruneDocument(d, now);
          const row = d.experience.reminderDelivery?.ledger.find(row => row.id === reservation.id);
          const item = d.experience.inbox.find(i => i.id === candidate.id);
          if (item?.delivery && d.experience.settings.timezone) clockPolicy = { at: now, timezone: d.experience.settings.timezone, start: d.experience.settings.quietStartHour, end: d.experience.settings.quietEndHour, override: item.delivery.quietHours === 'allow_at_requested_time', expiresAt: Math.min(item.expiresAt, row?.leaseUntil ?? 0, reminderPermit(this.experience.adaptive, d, item.space, now, item.agentId)?.expiresAt ?? 0) };
          return !!item && row?.state === phase && row.leaseUntil > now && item.delivery?.attemptId === row.id &&
            item.delivery.generation === reservation.generation && this.current(d, item, now, latest!) === reservation.fingerprint;
        });
        if (!allowed || !clockPolicy || options.signal?.aborted) return false;
        // Canonical I/O may await. Fence Studio authority again after it, then
        // evaluate the clock synchronously before the adapter's single fetch.
        let final: ReminderRecipient | null;
        try { final = await this.options.recipient(telegramId, candidate.agentId, candidate.space); } catch { return false; }
        const now = (this.options.now ?? Date.now)();
        return !!final && !options.signal?.aborted && final.telegramId === latest.telegramId && final.endpointId === latest.endpointId &&
          final.revision === latest.revision && now < clockPolicy.expiresAt && (clockPolicy.override || !isQuietHour(now, clockPolicy.timezone, clockPolicy.start, clockPolicy.end));
      };
      let result: ReminderSendResult = { state: 'cancelled' };
      if (await authorize('claimed')) {
        const dispatching = await this.experience.adaptive.withAccountDocument(telegramId, (d, now) => {
          const row = d.experience.reminderDelivery?.ledger.find(row => row.id === reservation.id);
          const item = d.experience.inbox.find(i => i.id === candidate.id);
          if (!row || row.state !== 'claimed' || !item?.delivery || item.delivery.attemptId !== row.id || options.signal?.aborted) return false;
          row.state = 'dispatching'; item.delivery.state = 'dispatching'; d.revision++; d.updatedAt = now; return true;
        });
        if (dispatching) {
          const controller = new AbortController(), abort = () => controller.abort();
          options.signal?.addEventListener('abort', abort, { once: true });
          if (options.signal?.aborted) controller.abort();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const send = this.options.transport.send({ telegramId, reference: reservation.itemId, text: GENERIC_REMINDER_TEXT,
              authorize: () => !controller.signal.aborted ? authorize('dispatching') : Promise.resolve(false), authorizeNow: () => {
                try {
                  if (controller.signal.aborted || options.signal?.aborted || !this.options.recipientNow) return 'denied';
                  const now = (this.options.now ?? Date.now)();
                  const snapshot = this.experience.adaptive.repository.readCommittedForEffect(`telegram-account:${telegramId}`, now);
                  if (snapshot.status === 'busy') return 'busy';
                  if (snapshot.status !== 'ready' || !snapshot.document) return 'denied';
                  const d = snapshot.document, item = d.experience.inbox.find(i => i.id === reservation.itemId);
                  const row = d.experience.reminderDelivery?.ledger.find(row => row.id === reservation.id);
                  const recipient = this.options.recipientNow(telegramId, candidate.agentId, candidate.space);
                  return recipient && item && row?.state === 'dispatching' && row.leaseUntil > now && item.delivery?.attemptId === row.id && item.delivery.generation === reservation.generation && this.current(d, item, now, recipient) === reservation.fingerprint ? 'allowed' : 'denied';
                } catch { return 'denied'; }
              }, signal: controller.signal });
            result = await Promise.race([send.catch((): ReminderSendResult => ({ state: 'unknown' })), new Promise<ReminderSendResult>(resolve => {
              timer = setTimeout(() => { controller.abort(); resolve({ state: 'unknown' }); }, 5000);
            })]);
          } catch { result = { state: 'unknown' }; }
          finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
        }
      }
      await this.experience.adaptive.withAccountDocument(telegramId, (d, now) => {
        const row = d.experience.reminderDelivery?.ledger.find(row => row.id === reservation.id);
        if (!row) return;
        row.state = result.state === 'deferred' ? 'cancelled' : result.state;
        if (result.state === 'accepted') row.messageId = result.messageId;
        const item = d.experience.inbox.find(i => i.id === reservation.itemId);
        if (item?.delivery?.generation === reservation.generation && item.delivery.attemptId === row.id && item.status === 'unread') {
          item.delivery.state = result.state === 'deferred' ? 'scheduled' : result.state;
          if (result.state === 'deferred') delete item.delivery.attemptId;
        }
        d.revision++; d.updatedAt = now;
      });
      report[result.state]++;
    }
    return report;
  }
}
