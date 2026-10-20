import { createHash } from 'crypto';
import { z } from 'zod';
import { kindSchema, integer } from './contracts';
import { GUEST_COPY_VERSION, guestRightsCopy } from './notice';
export const guestPolicySchema = z.object({ version: z.literal(1), id: z.string().min(1).max(100), revision: integer.positive(), effectiveAt: integer, expiresAt: integer, reviewOwner: z.string().min(1).max(100), reviewReference: z.string().min(1).max(200), topology: z.literal('single_persistent_process'), assurance: z.literal('request_credential_only'), admissionEnabled: z.boolean(), supportedKinds: z.array(kindSchema).min(1).max(7), privacyOperatorIds: z.array(integer.positive()).min(1).max(20), copyVersion: z.literal(GUEST_COPY_VERSION), noticeHashes: z.object({ en: z.string().regex(/^[a-f0-9]{64}$/), fa: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), draftLifetimeMs: integer.positive(), operationLifetimeMs: integer.positive(), admission: z.object({ windowMs: integer.positive(), maxPerWindow: integer.positive().max(100), maxOpen: integer.positive().max(20), maxRecords: integer.positive().max(100) }).strict(), retention: z.object({ reviewAfterMs: integer.positive(), auditMs: integer.positive(), terminalMs: integer.positive(), continuityMs: integer.positive(), receiptMs: integer.positive() }).strict() }).strict().superRefine((p, ctx) => { if (p.effectiveAt >= p.expiresAt || new Set(p.supportedKinds).size !== p.supportedKinds.length || new Set(p.privacyOperatorIds).size !== p.privacyOperatorIds.length || p.admission.maxRecords < p.admission.maxOpen || p.retention.auditMs < p.retention.reviewAfterMs || (['en', 'fa'] as const).some(l => p.noticeHashes[l] !== createHash('sha256').update(JSON.stringify(guestRightsCopy[l])).digest('hex')))
    ctx.addIssue({ code: 'custom', message: 'Invalid guest policy' }); });
export type GuestPolicy = z.infer<typeof guestPolicySchema>;
export function parseGuestPolicy(raw: string | undefined): GuestPolicy | undefined { if (!raw || Buffer.byteLength(raw) > 65536)
    return; try {
    return guestPolicySchema.parse(JSON.parse(raw));
}
catch {
    return;
} }
