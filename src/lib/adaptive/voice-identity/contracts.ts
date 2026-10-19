import { z } from 'zod';

export const voiceScopeSchema = z.object({ space: z.enum(['work', 'personal']), deviceId: z.string().uuid() }).strict();
export type VoiceScope = z.infer<typeof voiceScopeSchema>;
export const voiceCommandSchema = voiceScopeSchema.extend({ expectedRevision: z.number().int().nonnegative() }).strict();
export const voicePresentSchema = voiceCommandSchema.extend({ locale: z.enum(['en', 'fa']) }).strict();
export const voiceConsentSchema = voiceCommandSchema.extend({ receipt: z.string().uuid(), statement: z.literal('enroll_my_voice'),
  /** Separate deliberate self-only choice, never microphone permission. */
  selfOnly: z.literal(true) }).strict();
export const voiceBeginSchema = voiceCommandSchema.extend({ mode: z.enum(['enroll', 'test']), selfOnly: z.literal(true) }).strict();
export interface VoiceNotice {
  version: string; locale: 'en' | 'fa'; title: string; body: string; copyHash: string;
}
export interface VoiceIdentitySnapshot {
  scope: VoiceScope; revision: number; available: boolean; reason?: string;
  consent: 'not_asked' | 'granted' | 'withdrawn' | 'expired';
  enrollment: 'none' | 'enrolled' | 'purge_pending'; expiresAt?: number;
  deletion: 'not_required' | 'online_completed' | 'provider_pending';
  /** Online completion never asserts deletion from infrastructure backups. */
  backupExpiry: 'operator_policy'; notice?: VoiceNotice; receipt?: string;
  capture?: { id: string; mode: 'enroll' | 'test'; challenge: string; expiresAt: number; maxBytes: number; maxDurationMs: number };
}
export interface VoiceHint {
  outcome: 'possible_self' | 'unknown'; authenticationRequired: true;
  /** Deliberately no person/account/profile identifiers or confidence claims. */
  identityChanged: false;
}
export const MAX_VOICE_BYTES = 1_000_000;
export const MAX_VOICE_DURATION_MS = 10_000;
export const VOICE_NOTICE_VERSION = 'voice-enrollment-v1';
