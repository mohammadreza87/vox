import { z } from 'zod';
import { reminderDeliveryDocumentSchema, reminderItemDeliverySchema, type ReminderTelegramStatus } from './reminder-contracts';
import { sharedImageDataUrlSchema } from '../prediction/image';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const time = z.number().int().nonnegative().safe();
const revision = z.number().int().positive().safe();
export const experienceSpaceSchema = z.enum(['work', 'personal']);
export const preferenceSettingSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('response_length'), value: z.enum(['brief', 'balanced', 'detailed']) }).strict(),
  z.object({ key: z.literal('language'), value: z.enum(['auto', 'en', 'fa']) }).strict(),
  z.object({ key: z.literal('formatting'), value: z.enum(['plain', 'structured']) }).strict(),
]);
export const storedPreferenceSchema = z.object({ id, revision, space: experienceSpaceSchema, agentId: id,
  setting: preferenceSettingSchema, status: z.enum(['active', 'reset']), updatedAt: time,
}).strict();
export const storedObservationSchema = z.object({ eventId: id, space: experienceSpaceSchema, agentId: id,
  turnId: id, channel: z.enum(['voice', 'text', 'telegram']), status: z.enum(['responded', 'failed', 'cancelled']),
  durationMs: z.number().finite().min(0).max(86_400_000), at: time, consentEpoch: z.number().int().nonnegative(),
}).strict();
export const inboxItemSchema = z.object({ id, revision, space: experienceSpaceSchema, agentId: id,
  category: z.enum(['reminder', 'proactive']), kind: z.enum(['reply_failed', 'requested_reminder']),
  /** Only an explicit user-created reminder may contain a label. Never model/user conversation text. */
  label: z.string().trim().min(1).max(160).optional(), sourceEventId: id,
  status: z.enum(['unread', 'read', 'dismissed', 'cancelled']), createdAt: time, dueAt: time, expiresAt: time,
  consentEpoch: z.number().int().nonnegative(), grantRevision: revision,
  feedback: z.enum(['useful', 'not_useful']).optional(), delivery: reminderItemDeliverySchema.optional(),
}).strict();
export const experienceSettingsSchema = z.object({ revision,
  timezone: z.string().max(128).optional(), dailyCap: z.number().int().min(0).max(20),
  quietStartHour: z.number().int().min(0).max(23), quietEndHour: z.number().int().min(0).max(23),
  work: z.object({ inboxEnabled: z.boolean(), proactiveEnabled: z.boolean(), reminderEnabled: z.boolean() }).strict(),
  personal: z.object({ inboxEnabled: z.boolean(), proactiveEnabled: z.boolean(), reminderEnabled: z.boolean() }).strict(),
}).strict();
export const experienceDocumentSchema = z.object({
  preferences: z.array(storedPreferenceSchema).max(120), observations: z.array(storedObservationSchema).max(500),
  inbox: z.array(inboxItemSchema).max(100),
  settings: experienceSettingsSchema, reminderDelivery: reminderDeliveryDocumentSchema.optional(),
  /** Content-free dedupe tombstones retained independently of the observation opt-in. */
  turnKeys: z.array(z.object({ key: id, fingerprint: id.optional(), expiresAt: time }).strict()).max(1000),
  predictionTurns: z.array(z.object({ agentId: id, space: experienceSpaceSchema, sessionId: id,
    turnId: id, revision: z.number().int().nonnegative(), evaluations: z.number().int().min(0).max(2),
    reservation: id.optional(), policyReceipt: id.optional(), authorizationFingerprint: id.optional(), requiresImage: z.boolean().optional(), receiptExpiresAt: time.optional(), cancelled: z.boolean().optional(), superseded: z.boolean().optional(), contextKey: id.optional(), inFlightUntil: time, expiresAt: time }).strict()).max(100),
}).strict();
export type ExperienceDocument = z.infer<typeof experienceDocumentSchema>;
export type StoredPreference = z.infer<typeof storedPreferenceSchema>;
export type StoredObservation = z.infer<typeof storedObservationSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type ExperienceSettings = z.infer<typeof experienceSettingsSchema>;
export function emptyExperience(): ExperienceDocument {
  return { preferences: [], observations: [], inbox: [], turnKeys: [], predictionTurns: [], settings: {
    revision: 1, dailyCap: 2, quietStartHour: 21, quietEndHour: 8,
    work: { inboxEnabled: false, proactiveEnabled: false, reminderEnabled: false },
    personal: { inboxEnabled: false, proactiveEnabled: false, reminderEnabled: false },
  } };
}
export interface ExperienceSnapshot {
  schemaVersion: 1; revision: number; space: 'work' | 'personal'; confirmed: boolean;
  preferences: (StoredPreference & { applied: boolean })[];
  settings: ExperienceSettings;
  inbox: InboxItem[]; reminders?: InboxItem[]; reminderTelegram?: ReminderTelegramStatus;
  observations: { available: boolean; responded: number; failed: number; cancelled: number;
    total: number; meanResponseMs: number | null; verifiedTaskSuccess: null; complete: false };
  capabilities: { personalization: boolean; productAnalytics: boolean; proactiveInbox: boolean; reminders: boolean; decisions: boolean };
}
const command = { space: experienceSpaceSchema, expectedRevision: revision, eventId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/) };
export const preferenceInputSchema = z.object({ ...command, agentId: id, setting: preferenceSettingSchema, action: z.enum(['set', 'reset']) }).strict();
export const settingsInputSchema = z.object({ ...command, timezone: z.string().max(128).nullable().optional(),
  dailyCap: z.number().int().min(0).max(20), quietStartHour: z.number().int().min(0).max(23), quietEndHour: z.number().int().min(0).max(23),
  inboxEnabled: z.boolean(), proactiveEnabled: z.boolean(), reminderEnabled: z.boolean(),
}).strict();
export const feedbackInputSchema = z.object({ ...command, itemId: id,
  action: z.enum(['read', 'dismiss', 'useful', 'not_useful']) }).strict();
export const reminderInputSchema = z.object({ ...command, agentId: id, label: z.string().trim().min(1).max(160), dueAt: time, quietHours: z.enum(['respect', 'allow_at_requested_time']).optional() }).strict();
export const turnInputSchema = z.object({ space: experienceSpaceSchema, agentId: id, turnId: id,
  channel: z.enum(['voice', 'text', 'telegram']), durationMs: z.number().finite().min(0).max(86_400_000),
  status: z.enum(['responded', 'failed', 'cancelled']), origin: z.enum(['human', 'agent', 'system', 'qa']).default('human') }).strict();
export const predictionScopeSchema = z.object({ space: experienceSpaceSchema, agentId: id, sessionId: id, turnId: id,
  revision: z.number().int().nonnegative().safe(), contextKey: id.optional() }).strict();
export const predictionCancelSchema = predictionScopeSchema;
export const predictionValidateSchema = predictionScopeSchema.extend({ policyReceipt: id });
export type PredictionValidateInput = z.infer<typeof predictionValidateSchema>;
export type PredictionCancelInput = z.infer<typeof predictionCancelSchema>;
export const sharedImageSchema = z.object({ sourceId: id, revision: z.number().int().nonnegative().safe(),
  dataUrl: sharedImageDataUrlSchema }).strict();
export const predictInputSchema = z.object({ space: experienceSpaceSchema, agentId: id, sessionId: id, turnId: id,
  revision: z.number().int().nonnegative().safe(), contextKey: id.optional(), image: sharedImageSchema.optional(), text: z.string().trim().min(1).max(4096),
  question: z.enum(['intent_route', 'explicit_correction', 'next_step', 'image_route']) }).strict();
export type PreferenceInput = z.infer<typeof preferenceInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type ReminderInput = z.input<typeof reminderInputSchema>;
export type TurnInput = z.input<typeof turnInputSchema>;
export type PredictInput = z.infer<typeof predictInputSchema>;

export type PredictionReply = import('../decisions').DecisionResult & { policyReceipt?: string; revision?: number; questionVersion?: string; sessionId?: string; turnId?: string; contextKey?: string; expiresAt?: number; preparedContext?: boolean; routeHint?: 'conversation' | 'recall' | 'task' | 'continue' | 'clarify' | 'prepare' | 'screenshot' | 'document' | 'scene' };
