import { z } from 'zod';
import { idSchema } from '../contracts';
export const verifiedEventSchema = z.object({ subscriptionId: idSchema, providerId: z.enum(['github', 'slack']), providerEventId: idSchema,
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), safeType: idSchema, providerTenantId: idSchema, nativeResourceId: idSchema,
  occurredAt: z.number().int().nonnegative(), secretVersion: z.number().int().positive() }).strict();
export const registerSubscriptionSchema = z.object({ connectionId: idSchema, providerId: z.enum(['github', 'slack']), providerTenantId: idSchema,
  nativeResourceId: idSchema, resourceId: idSchema, eventTypes: z.array(idSchema).min(1).max(10), secretRef: idSchema,
  secretVersion: z.number().int().positive(), expiresAt: z.number().int().positive() }).strict();
