import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const time = z.number().int().nonnegative().safe();
export const notificationIntentSchema = z.object({
  schemaVersion: z.literal(1), id, tenantId: id, spaceId: id, containerId: id, recipientPersonId: id,
  category: z.enum(['service', 'reminder', 'proactive']), channel: z.enum(['inbox', 'telegram']),
  sourceIds: z.array(id).min(1).max(16), sourceRevision: z.number().int().positive(), policyVersion: id,
  createdAt: time, dueAt: time, expiresAt: time, dedupeKey: id,
  /** Only exact user requested reminders can deliberately bypass quiet hours. */
  reminderQuietHours: z.enum(['respect', 'allow_at_requested_time']).optional(),
}).strict().refine(i => i.createdAt <= i.dueAt && i.dueAt < i.expiresAt);
export type NotificationIntent = z.infer<typeof notificationIntentSchema>;
export interface NotificationPreferences {
  readonly personId: string;
  readonly revision: number;
  readonly enabled: boolean;
  readonly proactiveEnabled: boolean;
  readonly reminderEnabled: boolean;
  readonly channel: 'inbox' | 'telegram';
  readonly timezone?: string;
  readonly dailyCap?: number;
  readonly quietStartHour?: number;
  readonly quietEndHour?: number;
  readonly mutedUntil?: number;
}
const preferencesSchema = z.object({
  personId: id, revision: z.number().int().positive(), enabled: z.boolean(), proactiveEnabled: z.boolean(),
  reminderEnabled: z.boolean(), channel: z.enum(['inbox', 'telegram']), timezone: z.string().max(128).optional(),
  dailyCap: z.number().int().min(0).max(20).optional(), quietStartHour: z.number().int().min(0).max(23).optional(),
  quietEndHour: z.number().int().min(0).max(23).optional(), mutedUntil: time.optional(),
}).strict();
export interface DeliveryLedgerEntry {
  readonly personId: string;
  readonly intentId: string;
  readonly dedupeKey: string;
  readonly category: NotificationIntent['category'];
  readonly state: 'reserved' | 'provider_accepted' | 'delivered' | 'unknown' | 'failed' | 'cancelled';
  readonly at: number;
}
const ledgerEntrySchema = z.object({
  personId: id, intentId: id, dedupeKey: id, category: z.enum(['service', 'reminder', 'proactive']),
  state: z.enum(['reserved', 'provider_accepted', 'delivered', 'unknown', 'failed', 'cancelled']), at: time,
}).strict();
export type NotificationPlan =
  | { status: 'suppressed'; reason: 'invalid' | 'disabled' | 'consent' | 'policy' | 'expired' | 'not_due' | 'quiet_hours' | 'budget' | 'duplicate' | 'muted' | 'stale' }
  | { status: 'inbox_only'; reason: 'timezone_unknown'; intentId: string }
  | { status: 'eligible'; channel: 'inbox' | 'telegram'; intentId: string;
      /** Detailed private text is rendered in the authenticated inbox after reauthorization. */
      payload: { text: 'You have an update in Vox.'; reference: string } };

export function isSelectedTimezone(timezone: string | undefined): timezone is string {
  if (!timezone || (timezone !== 'UTC' && !/^[A-Za-z_]+\/[A-Za-z_+\-/0-9]+$/.test(timezone))) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0); return true; } catch { return false; }
}
export function isQuietHour(now: number, timezone: string, start = 21, end = 8): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (start === end) return false; // Explicitly equal endpoints disable quiet hours.
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** Eligibility only. Actual external dispatch must transactionally reserve the
 * per-person budget and recheck this policy immediately before sending. No sender
 * exists in this module; this result is never a reusable authorization token. */
export function evaluateNotification(input: unknown, preferences: NotificationPreferences,
  ledger: readonly DeliveryLedgerEntry[], now: number, consent: { purpose: boolean; channel: boolean },
  sourceAuthorized: boolean): NotificationPlan {
  const result = notificationIntentSchema.safeParse(input);
  if (!result.success || !Number.isSafeInteger(now) || now < 0) return { status: 'suppressed', reason: 'invalid' };
  if (!preferencesSchema.safeParse(preferences).success || !z.array(ledgerEntrySchema).safeParse(ledger).success ||
      ledger.some(entry => entry.at > now)) return { status: 'suppressed', reason: 'invalid' };
  const intent = result.data;
  if (!sourceAuthorized || preferences.personId !== intent.recipientPersonId) return { status: 'suppressed', reason: 'policy' };
  if (intent.expiresAt <= now) return { status: 'suppressed', reason: 'expired' };
  if (intent.dueAt > now || intent.createdAt > now) return { status: 'suppressed', reason: 'not_due' };
  if (!preferences.enabled || intent.channel !== preferences.channel ||
      (intent.category === 'proactive' && !preferences.proactiveEnabled) ||
      (intent.category === 'reminder' && !preferences.reminderEnabled)) return { status: 'suppressed', reason: 'disabled' };
  if (!consent.purpose || !consent.channel) return { status: 'suppressed', reason: 'consent' };
  if (preferences.mutedUntil !== undefined && (!Number.isFinite(preferences.mutedUntil) || preferences.mutedUntil > now)) return { status: 'suppressed', reason: 'muted' };
  const cap = preferences.dailyCap ?? 2;
  const start = preferences.quietStartHour ?? 21;
  const end = preferences.quietEndHour ?? 8;
  if (!Number.isInteger(cap) || cap < 0 || cap > 20 || !Number.isInteger(start) || start < 0 || start > 23 ||
      !Number.isInteger(end) || end < 0 || end > 23) return { status: 'suppressed', reason: 'invalid' };
  const own = ledger.filter(entry => entry.personId === intent.recipientPersonId);
  const pending = (entry: DeliveryLedgerEntry) => ['reserved', 'provider_accepted', 'delivered', 'unknown'].includes(entry.state);
  if (own.some(entry => (entry.intentId === intent.id || entry.dedupeKey === intent.dedupeKey) && pending(entry))) return { status: 'suppressed', reason: 'duplicate' };
  if (intent.category === 'proactive' && own.filter(entry => entry.category === 'proactive' && pending(entry) && entry.at > now - 86_400_000 && entry.at <= now).length >= cap) return { status: 'suppressed', reason: 'budget' };
  if (!isSelectedTimezone(preferences.timezone)) return { status: 'inbox_only', reason: 'timezone_unknown', intentId: intent.id };
  if (isQuietHour(now, preferences.timezone, start, end) &&
      !(intent.category === 'reminder' && intent.reminderQuietHours === 'allow_at_requested_time')) return { status: 'suppressed', reason: 'quiet_hours' };
  return { status: 'eligible', channel: intent.channel, intentId: intent.id,
    payload: { text: 'You have an update in Vox.', reference: intent.id } };
}

export interface NotificationPolicySnapshot {
  readonly preferences: NotificationPreferences;
  readonly ledger: readonly DeliveryLedgerEntry[];
  readonly consent: { readonly purpose: boolean; readonly channel: boolean };
  /** Covers verified recipient, current endpoint owner, scope/subject grants,
   * purpose versions, source expiry/revisions, audience and deletion tombstones. */
  readonly authorizationFingerprint: string | null;
  /** Includes ledger/budget, consent and preference versions. */
  readonly revision: string;
}
export async function prepareNotification(input: unknown, hooks: {
  now: () => number;
  current: (intent: NotificationIntent) => Promise<NotificationPolicySnapshot>;
}): Promise<NotificationPlan> {
  const result = notificationIntentSchema.safeParse(input);
  if (!result.success) return { status: 'suppressed', reason: 'invalid' };
  try {
    const before = await hooks.current(result.data);
    const plan = evaluateNotification(result.data, before.preferences, before.ledger, hooks.now(), before.consent, !!before.authorizationFingerprint);
    if (plan.status === 'suppressed') return plan;
    const current = await hooks.current(result.data);
    if (!current.authorizationFingerprint || current.authorizationFingerprint !== before.authorizationFingerprint || current.revision !== before.revision) return { status: 'suppressed', reason: 'stale' };
    // Time and quiet-hour boundaries can advance while loading policy.
    return evaluateNotification(result.data, current.preferences, current.ledger, hooks.now(), current.consent, true);
  } catch { return { status: 'suppressed', reason: 'policy' }; }
}
