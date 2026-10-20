import { z } from 'zod';
import type { RelationshipKey } from '../../relationships/types';
const id = z.string().min(1).max(200);
const time = z.number().int().nonnegative().safe();
export const relationshipScopeSchema = z.object({ schemaVersion: z.literal(1), accountId: id, personId: id, bindingId: id,
  tenantId: id, space: z.enum(['work', 'personal']), spaceId: id, containerId: id }).strict();
export const scopedRelationshipKeySchema = z.object({ personaId: id, chatKey: id,
  audience: z.object({ kind: z.literal('private'), personId: id }).strict(), scope: relationshipScopeSchema }).strict();
export const relationshipSourceSchema = z.object({ id, revision: z.number().int().positive().safe(), createdAt: time,
  expiresAt: time, status: z.enum(['active', 'deleted']), retentionStoreIdentity:z.union([z.string().regex(/^[a-f0-9]{64}$/),z.literal('canonical')]).optional(), sourceFence: id, channel: z.enum(['telegram', 'call']),
  /** Opaque current bot endpoint identity from trusted server capture; never a token. */
  endpointId: id.optional() }).strict();
export type RelationshipSource = z.infer<typeof relationshipSourceSchema>;
export const relationshipInboxItemSchema = z.object({ id, key: scopedRelationshipKeySchema, text: z.string().max(1000),
  sourceIds: z.array(id).min(1).max(256), fingerprint: id, sourceFence: id, createdAt: time, expiresAt: time,
  status: z.enum(['unread', 'read', 'dismissed', 'cancelled']) }).strict();
export type RelationshipInboxItem = z.infer<typeof relationshipInboxItemSchema>;
export const relationshipBindingSchema = z.object({ id, revision: z.number().int().positive().safe(), accountId: id, personId: id,
  space: z.enum(['work', 'personal']), status: z.enum(['active', 'revoked', 'expired']), confirmedAt: time, expiresAt: time, originBindingId: id }).strict();
export const relationshipDocumentSchema = z.object({
  bindings: z.array(relationshipBindingSchema).max(2).default([]),
  controls: z.array(z.object({ agentId: id, space: z.enum(['work', 'personal']), disabled: z.boolean(),
    pausedUntil: time.optional(), revision: z.number().int().positive().safe() }).strict()).max(200).default([]),
  sources: z.array(relationshipSourceSchema.extend({ key: scopedRelationshipKeySchema, eventFingerprint: id }).strict()).max(500),
  inbox: z.array(relationshipInboxItemSchema).max(100),
  ledger: z.array(z.object({ id, key: scopedRelationshipKeySchema, at: time,
    state: z.enum(['published', 'reserved', 'accepted', 'unknown', 'cancelled']),
    reservationId: id.optional(), fingerprint: id.optional(), messageId: id.optional() }).strict()).max(500),
  externalSettings: z.object({ work: z.boolean(), personal: z.boolean(), revision: z.number().int().positive().safe() }).strict(),
}).strict();
export type RelationshipDocument = z.infer<typeof relationshipDocumentSchema>;
export function emptyRelationshipDocument(): RelationshipDocument { return { bindings: [], controls: [], sources: [], inbox: [], ledger: [], externalSettings: { work: false, personal: false, revision: 1 } }; }
export interface RelationshipPermit {
  key: RelationshipKey; fingerprint: string; sourceFence: string; expiresAt: number;
  notification: { settingsRevision: number; timezone?: string; dailyCap: number; quietStartHour: number; quietEndHour: number;
    inboxEnabled: boolean; proactiveEnabled: boolean; externalEnabled: boolean };
}
export type RelationshipPhase = 'observe' | 'context' | 'inbox' | 'external';
