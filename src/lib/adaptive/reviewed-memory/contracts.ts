import { z } from 'zod';
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/);
export const sourceRefSchema = z.object({ id, revision: z.number().int().positive().safe() }).strict();
export const sourceRefsSchema = z.array(sourceRefSchema).min(2).max(8).refine(refs => new Set(refs.map(ref => ref.id)).size === refs.length);
const scope = { space: z.enum(['work', 'personal']), agentId: id };
export const reviewedPreviewInputSchema = z.object({ ...scope, sourceRefs: sourceRefsSchema, locale: z.enum(['en', 'fa']) }).strict();
export const reviewedAcceptInputSchema = z.object({ ...scope, text: z.string().trim().min(1).max(2000), receipt: z.string().min(1).max(8192) }).strict();
export type ReviewedPreviewInput = z.infer<typeof reviewedPreviewInputSchema>;
export type ReviewedAcceptInput = z.infer<typeof reviewedAcceptInputSchema>;
export interface ReviewedMemoryPreview { text: string; receipt: string; expiresAt: number; sourceRefs: { id: string; revision: number }[] }
