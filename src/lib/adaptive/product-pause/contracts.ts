import { z } from 'zod';

export const PRODUCT_PAUSE_RESERVED_BYTES = 2048;
export const PRODUCT_PAUSE_ENFORCEMENT = 'product-personalization-pause-v1' as const;
const counter = z.number().int().nonnegative().safe();
export const productPauseSpaceSchema = z.enum(['work', 'personal']);
export const productPauseReceiptSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  seq: counter.min(1), result: z.enum(['changed', 'unchanged']), resultingUseEpoch: counter, recordedAt: counter,
}).strict();
export const productPauseScopeSchema = z.object({ space: productPauseSpaceSchema, productPaused: z.boolean(),
  useEpoch: counter, commandSeq: counter, latest: productPauseReceiptSchema.optional(),
}).strict().superRefine((s, ctx) => {
  if (s.useEpoch > s.commandSeq || (s.commandSeq === 0 ? !!s.latest : !s.latest) ||
      s.latest && (s.latest.seq !== s.commandSeq || s.latest.resultingUseEpoch !== s.useEpoch ||
        s.latest.result === 'changed' && s.useEpoch === 0)) ctx.addIssue({ code: 'custom', message: 'Invalid pause counters/receipt' });
});
export const productPauseSchema = z.object({ version: z.literal(1),
  scopes: z.tuple([productPauseScopeSchema, productPauseScopeSchema]),
}).strict().superRefine((p, ctx) => { if (p.scopes[0].space !== 'work' || p.scopes[1].space !== 'personal')
  ctx.addIssue({ code: 'custom', message: 'Pause scopes must be work, personal' }); });
export const productPauseUseScopeSchema = z.object({ space: productPauseSpaceSchema, productPaused: z.boolean(), useEpoch: counter }).strict();
export const productPauseUseControlsSchema = z.object({ version: z.literal(1),
  scopes: z.tuple([productPauseUseScopeSchema, productPauseUseScopeSchema]),
}).strict().superRefine((p, ctx) => { if (p.scopes[0].space !== 'work' || p.scopes[1].space !== 'personal')
  ctx.addIssue({ code: 'custom', message: 'Pause scopes must be work, personal' }); });
export const productPauseCommandSchema = z.object({ version: z.literal(1),
  eventId: productPauseReceiptSchema.shape.eventId, expectedCommandSeq: counter,
  space: productPauseSpaceSchema, action: z.enum(['pause', 'resume']),
}).strict();
export type ProductPauseV1 = z.infer<typeof productPauseSchema>;
export type ProductPauseScopeV1 = z.infer<typeof productPauseScopeSchema>;
export type ProductPauseUseControlsV1 = z.infer<typeof productPauseUseControlsSchema>;
export type ProductPauseCommandV1 = z.infer<typeof productPauseCommandSchema>;
export type ProductPauseReceiptV1 = z.infer<typeof productPauseReceiptSchema>;
/** Server-projected facts, never command or receipt authority. Missing/unknown v2 fails closed. */
export type ProductPauseAuthority = { schemaVersion: 1 | 2; productPause?: ProductPauseV1 | ProductPauseUseControlsV1 };
export interface ProductPauseStatus { version: 1; accountId: string; space: 'work' | 'personal'; available: boolean;
  productPaused: boolean | null; useEpoch: number | null; commandSeq?: number; latest?: ProductPauseReceiptV1; reason?: string; canPause: boolean; canResume: boolean }
export interface ProductPauseCommandResult { status: ProductPauseStatus; receipt: ProductPauseReceiptV1; replayed: boolean }
