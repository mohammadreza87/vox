import { z } from 'zod';
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = { space: z.enum(['work', 'personal']), agentId: id };
export const previewClaimsSchema = z.array(z.string().min(1).max(1000).refine(text => text.trim().length > 0)).max(3)
  .refine(claims => new Set(claims).size === claims.length && claims.reduce((sum, text) => sum + text.length, 0) <= 3000);
export const claimsSchema = previewClaimsSchema.refine(claims => claims.length > 0);
export const messagePreviewInputSchema = z.object({ ...scope, locale: z.enum(['en', 'fa']), text: z.string().min(1).max(4096).refine(text => text.trim().length > 0) }).strict();
export const messageAcceptInputSchema = z.object({ ...scope, claims: claimsSchema, sourceTextHash: hash, receipt: z.string().min(1).max(8192) }).strict();
export type MessagePreviewInput = z.infer<typeof messagePreviewInputSchema>;
export type MessageAcceptInput = z.infer<typeof messageAcceptInputSchema>;
export interface MessageMemoryPreview { claims: string[]; sourceTextHash: string; receipt: string; expiresAt: number }
