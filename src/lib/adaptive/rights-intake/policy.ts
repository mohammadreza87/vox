import { z } from 'zod';
import { createHash } from 'crypto';
import { rightsCopy, RIGHTS_COPY_VERSION } from './notice';
import { integer, kindSchema, spaceSchema } from './contracts';
/** Every duration is supplied by a reviewed server policy. No legal/retention defaults. */
export const rightsPolicySchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(100), revision: integer.positive(),
  effectiveAt: integer, expiresAt: integer, reviewOwner: z.string().min(1).max(100), reviewReference: z.string().min(1).max(200),
  topology: z.literal('single_persistent_process'), assurance: z.literal('signed_telegram_account'),
  supportedKinds: z.array(kindSchema).min(1).max(7),
  privacyOperatorIds: z.array(integer.positive()).min(1).max(20),
  copyVersion: z.string().min(1).max(100), noticeHashes: z.object({ en: z.string().regex(/^[a-f0-9]{64}$/), fa: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  retention: z.object({ requestReviewAfterMs: integer.positive(), auditRetentionMs: integer.positive(), receiptRetentionMs: integer.positive() }).strict(),
  /** Explicit RI2 approval; absence disables operator retention mutations. */
  retentionOperations: z.object({ terminalRetentionMs: integer.positive(), continuityRetentionMs: integer.positive() }).strict().optional(),
  handleLifetimeMs: integer.positive(),
  /** Exact server-owned account rules; locale/IP/client claims never resolve jurisdiction. */
  deadlineRules: z.array(z.object({ id: z.string().min(1).max(100), accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/), space: spaceSchema, kind: kindSchema, dueAfterMs: integer.positive() }).strict()).max(100),
}).strict().superRefine((p, ctx) => {
  if (p.copyVersion !== RIGHTS_COPY_VERSION || (['en','fa'] as const).some(locale => p.noticeHashes[locale] !== createHash('sha256').update(JSON.stringify(rightsCopy[locale])).digest('hex')) ||
    p.effectiveAt >= p.expiresAt || new Set(p.supportedKinds).size !== p.supportedKinds.length || new Set(p.privacyOperatorIds).size !== p.privacyOperatorIds.length ||
    p.retention.auditRetentionMs < p.retention.requestReviewAfterMs || new Set(p.deadlineRules.map(r => [r.accountId,r.space,r.kind].join(':'))).size !== p.deadlineRules.length)
    ctx.addIssue({ code: 'custom', message: 'Invalid rights policy' });
});
export type RightsPolicy = z.infer<typeof rightsPolicySchema>;
export function parseRightsPolicy(raw: string | undefined): RightsPolicy | undefined {
  if (!raw || Buffer.byteLength(raw) > 65_536) return undefined;
  try { return rightsPolicySchema.parse(JSON.parse(raw)); } catch { return undefined; }
}
