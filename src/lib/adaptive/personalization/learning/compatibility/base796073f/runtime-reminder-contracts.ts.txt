import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const time = z.number().int().nonnegative().safe();
const revision = z.number().int().positive().safe();
export const reminderItemDeliverySchema = z.object({ generation: revision,
  state: z.enum(['scheduled', 'claimed', 'dispatching', 'accepted', 'unknown', 'failed', 'cancelled']),
  channelRevision: revision, endpointId: id, attemptId: id.optional(), acknowledgedAt: time.optional(),
  quietHours: z.enum(['respect', 'allow_at_requested_time']),
}).strict();
export const REMINDER_DISCLOSURE_VERSION = 'generic-reminders-30d-v1' as const;
const authorization = z.object({ id, version: z.literal(REMINDER_DISCLOSURE_VERSION), accountId: z.string().max(200), personId: z.string().max(200), space: z.enum(['work', 'personal']), originBindingId: id, issuedAt: time, expiresAt: time, permissionRevision: revision, consentEpoch: time, recipientRevision: revision, endpointId: id }).strict();
const presentation = z.object({ receipt: id, version: z.literal(REMINDER_DISCLOSURE_VERSION), authority: id, presentedAt: time, expiresAt: time }).strict();
const channel = z.object({ enabled: z.boolean(), revision, authority: id.optional(), endpointId: id.optional(), authorization: authorization.optional(), presentation: presentation.optional() }).strict();
export const reminderDeliveryDocumentSchema = z.object({
  recipient: z.object({ endpointId: id, revision, verifiedAt: time }).strict().optional(),
  work: channel, personal: channel,
  ledger: z.array(z.object({ id, dedupeKey: id, itemId: id, generation: revision, space: z.enum(['work', 'personal']), agentId: id,
    state: z.enum(['claimed', 'dispatching', 'accepted', 'unknown', 'failed', 'cancelled']), at: time, leaseUntil: time,
    fingerprint: id, messageId: z.string().regex(/^[1-9]\d{0,19}$/).optional(), acknowledgedAt: time.optional(),
  }).strict()).max(500),
}).strict();
export type ReminderDeliveryDocument = z.infer<typeof reminderDeliveryDocumentSchema>;
const command = { space: z.enum(['work', 'personal']), expectedRevision: revision, eventId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/) };
export const reminderChannelPresentSchema = z.object({ ...command }).strict();
export const reminderChannelInputSchema = z.object({ ...command, enabled: z.boolean(), receipt: id.optional(), disclosureVersion: z.literal(REMINDER_DISCLOSURE_VERSION).optional() }).strict();
export const reminderActionInputSchema = z.object({ ...command, itemId: id,
  action: z.enum(['snooze', 'cancel', 'acknowledge_unknown']), dueAt: time.optional() }).strict()
  .refine(input => input.action === 'snooze' ? input.dueAt !== undefined : input.dueAt === undefined);
export type ReminderChannelPresentInput = z.infer<typeof reminderChannelPresentSchema>;
export type ReminderChannelInput = z.infer<typeof reminderChannelInputSchema>;
export type ReminderActionInput = z.infer<typeof reminderActionInputSchema>;
export interface ReminderTelegramStatus { available: boolean; connected: boolean; enabled: boolean; reason?: string; expiresAt?: number; renewalRequired?: boolean; disclosure?: { version: typeof REMINDER_DISCLOSURE_VERSION; receipt: string; expiresAt: number } }
export function emptyReminderDelivery(): ReminderDeliveryDocument { return { work: { enabled: false, revision: 1 }, personal: { enabled: false, revision: 1 }, ledger: [] }; }
