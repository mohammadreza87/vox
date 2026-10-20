import { z } from 'zod';
import { preferenceValueSchema } from '..';
export const LEARNING_VERSION = 'preference-learning-v1' as const;
export const LEARNING_TTL = 24 * 60 * 60_000;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const scopeId = z.string().min(1).max(200);
const time = z.number().int().nonnegative().safe();
const revision = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const learningScope = { space: z.enum(['work', 'personal']), agentId: id };
export const logicalTurnSchema = z.object({ sessionId: id, turnId: id, revision: z.number().int().nonnegative().safe(), contextKey: id }).strict();
export type LogicalTurn = z.infer<typeof logicalTurnSchema>;
const authority = { productPauseUseStamp: hash.optional(), studioFingerprint: hash, personId: scopeId, bindingId: scopeId, permissionRevision: revision, consentEpoch: time, grantRevision: revision };
const presentation = z.object({ ...learningScope, ...authority, version: z.literal(LEARNING_VERSION), receipt: id,
  copyHash: hash, locale: z.enum(['en', 'fa']), createdAt: time, expiresAt: time }).strict();
const intent = z.object({ ...learningScope, ...authority, version: z.literal(LEARNING_VERSION), id, revision, createdAt: time, expiresAt: time }).strict();
export const learningReasonSchema = z.enum(['length_cue', 'language_cue', 'formatting_cue']);
const candidate = z.object({ ...learningScope, ...authority, id, version: z.literal(LEARNING_VERSION), revision,
  intentId: id, intentRevision: revision, setting: preferenceValueSchema, reason: learningReasonSchema, evidenceIds: z.array(hash).min(1).max(16),
  createdAt: time, expiresAt: time }).strict().refine(row => row.expiresAt > row.createdAt && row.expiresAt - row.createdAt <= LEARNING_TTL &&
  row.reason === ({ response_length: 'length_cue', language: 'language_cue', formatting: 'formatting_cue' } as const)[row.setting.key]);
/** Suppression is purpose-local metadata, never a retained transcript or a new grant. */
const suppression = z.object({ ...learningScope, evidenceId: hash, createdAt: time, expiresAt: time }).strict();
export const learningDocumentSchema = z.object({ version: z.literal(LEARNING_VERSION),
  presentations: z.array(presentation).max(24), intents: z.array(intent).max(24), candidates: z.array(candidate).max(24),
  suppressions: z.array(suppression).max(200),
}).strict();
export type LearningDocument = z.infer<typeof learningDocumentSchema>;
export type LearningCandidate = z.infer<typeof candidate>;
export type LearningIntent = z.infer<typeof intent>;
export type LearningPresentation = z.infer<typeof presentation>;
const command = { ...learningScope, expectedRevision: revision, eventId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/) };
export const learningPresentSchema = z.object({ ...command, locale: z.enum(['en', 'fa']) }).strict();
export const learningToggleSchema = z.object({ ...command, enabled: z.boolean(), receipt: id.optional(), version: z.literal(LEARNING_VERSION).optional() }).strict();
export const learningReviewSchema = z.object({ ...command, candidateId: id, action: z.enum(['use', 'dismiss']) }).strict();
export const learningCancelSchema = z.object(learningScope).strict();
export type LearningPresentInput = z.infer<typeof learningPresentSchema>;
export type LearningToggleInput = z.infer<typeof learningToggleSchema>;
export type LearningReviewInput = z.infer<typeof learningReviewSchema>;
export interface LearningView {
  schemaVersion: 1; version: typeof LEARNING_VERSION; revision: number; space: 'work' | 'personal'; agentId: string;
  available: boolean; enabled: boolean; reason?: 'product_personalization_paused' | 'unavailable' | 'personalization_off' | 'agent_grant_missing' | 'profile_confirmation_required';
  presentation?: { receipt: string; expiresAt: number; copyHash: string; locale: 'en' | 'fa' };
  intentExpiresAt?: number;
  candidates: Array<Pick<LearningCandidate, 'id' | 'revision' | 'setting' | 'reason' | 'createdAt' | 'expiresAt'>>;
  /** Server-only verification receipt, never mutation authority. */
  receipt: string;
}
export type LearningPublicView = Omit<LearningView, 'receipt'>;
export function emptyLearning(): LearningDocument { return { version: LEARNING_VERSION, presentations: [], intents: [], candidates: [], suppressions: [] }; }
export const learningNotice = {
  en: 'Suggest reply preferences from new messages to this agent in this space? Vox may send your current message or final tap-to-talk transcript to OpenAI, its configured text processor to suggest reply length, language or formatting. Suggestions may be wrong and are never applied until you choose Use. Vox saves no recording or message text for this learning. Suggestions expire within 24 hours or when this account confirmation ends. This is separate from usage analytics, automatic memory and voice recognition. You can turn it off and remove suggestions at any time.',
  fa: 'از پیام‌های جدید به این عامل در همین فضا، ترجیح پاسخ پیشنهاد شود؟ وکس می‌تواند پیام فعلی یا متن نهایی گفتارِ ضبط‌شده با دکمه را برای پیشنهاد اندازه، زبان یا قالب پاسخ به OpenAI، پردازشگر متن پیکربندی‌شده، بفرستد. پیشنهاد ممکن است اشتباه باشد و تا انتخاب «استفاده» اعمال نمی‌شود. وکس برای این یادگیری، صدای ضبط‌شده یا متن پیام ذخیره نمی‌کند. پیشنهادها حداکثر تا ۲۴ ساعت یا پایان تأیید این حساب معتبرند. این انتخاب از آمار استفاده، حافظهٔ خودکار و تشخیص صدا جداست. هر زمان می‌توانید آن را خاموش و پیشنهادها را حذف کنید.',
} as const;
