import { z } from 'zod';
import { OPTIONAL_PURPOSES } from './repository';
const eventId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const space = z.enum(['work', 'personal']);
const purpose = z.enum(OPTIONAL_PURPOSES);
export const identityInput = z.object({ confirm: z.literal(true), adultConfirmed: z.boolean().optional(),
  declaredJurisdiction: z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/).optional(),
}).strict();
export const presentInput = z.object({ space, purpose, locale: z.enum(['en', 'fa']), expectedRevision: revision,
  eventId, deliberateReopen: z.boolean().optional(),
}).strict();
export const consentInput = z.object({ space, purpose, state: z.enum(['granted', 'declined', 'withdrawn']),
  expectedRevision: revision, eventId, receipt: z.string().uuid().optional(),
}).strict();
export const memoryInput = z.object({ space, text: z.string().trim().min(1).max(2000), expectedRevision: revision, eventId }).strict();
/** expectedRevision is the selected memory revision, never the aggregate. */
export const correctionInput = memoryInput;
export type CorrectionInput = z.infer<typeof correctionInput>;
export const deletionInput = z.object({ space, expectedRevision: revision, eventId }).strict();
export const spaceInput = space;
export type PresentInput = z.infer<typeof presentInput>;
export type ConsentInput = z.infer<typeof consentInput>;
export type MemoryInput = z.infer<typeof memoryInput>;
export type DeletionInput = z.infer<typeof deletionInput>;
export type IdentityInput = z.infer<typeof identityInput>;

/** expectedRevision is the aggregate snapshot revision for per-agent grants. */
export const agentGrantInput = z.object({ space, allowed: z.boolean(), expectedRevision: revision, eventId }).strict();
export type AgentGrantInput = z.infer<typeof agentGrantInput>;
