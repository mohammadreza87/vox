import { createHash } from 'crypto';
import { z } from 'zod';
import type { ConsentEvent } from '../consent';
import type { ConsentPermission, PersonAccountBinding } from '../types';
import type { AdaptiveStorage } from './storage';
import { emptyExperience, experienceDocumentSchema } from '../runtime/contracts';
import { emptyRelationshipDocument, relationshipDocumentSchema } from '../relationships/contracts';

export const OPTIONAL_PURPOSES = [
  'optional.product_analytics', 'optional.personalization', 'optional.auto_memory',
  'optional.biometric_recognition', 'optional.reminder_delivery', 'optional.proactive_suggestions',
  'optional.content_quality_review', 'optional.relationship_outreach',
] as const;
export type OptionalPurpose = typeof OPTIONAL_PURPOSES[number];
export type SpaceKind = 'work' | 'personal';
export const ADAPTIVE_POLICY_VERSION = 'adaptive-privacy-v1';
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = integer.min(1);
const id = z.string().min(1).max(200);
const space = z.enum(['work', 'personal']);
const purpose = z.enum(OPTIONAL_PURPOSES);
const states = z.enum(['not_asked', 'presented', 'granted', 'declined', 'withdrawn', 'expired', 'reconsent_required', 'suspended']);
const base = { schemaVersion: z.literal(1), id, revision, createdAt: integer, updatedAt: integer };
const permissionSchema = z.object({ ...base, tenantId: id, spaceId: id, personId: id, purpose,
  purposeVersion: z.literal(1), policyVersion: z.literal(ADAPTIVE_POLICY_VERSION), state: states,
  epoch: integer, effectiveAt: integer, expiresAt: integer, lastEventId: id.optional(), lastCommandFingerprint: z.string().max(3000).optional(),
}).strict();
const bindingSchema = z.object({ ...base, accountId: id, personId: id, status: z.literal('verified'),
  method: z.literal('account_confirmation'), verifiedAt: integer, expiresAt: integer,
}).strict();
const memorySchema = z.object({ id, revision, space, text: z.string().max(2000).optional(), status: z.enum(['active', 'deleted']),
  createdAt: integer, updatedAt: integer, expiresAt: integer, revocationEpoch: integer,
}).strict();
export type StoredMemory = z.infer<typeof memorySchema>;
const receiptSchema = z.object({ id, purpose, space, permissionRevision: revision, locale: z.enum(['en', 'fa']),
  presentedAt: integer, expiresAt: integer, copyHash: id, bindingRevision: revision,
}).strict();
export type PresentationReceipt = z.infer<typeof receiptSchema>;
const eventSchema = z.object({ eventId: id, fingerprint: id, kind: id, resultId: id, revision }).strict();
const outboxSchema = z.object({ eventId: id, kind: z.enum(['consent_changed', 'memory_deleted', 'agent_grant_changed']), space,
  personId: id, revision, memoryId: id.optional(), agentId: id.optional(), epoch: integer, createdAt: integer,
}).strict();
const documentSchema = z.object({ schemaVersion: z.literal(1), accountId: id, personId: id, revision,
  createdAt: integer, updatedAt: integer, binding: bindingSchema.optional(),
  declaration: z.object({ adultConfirmed: z.boolean(), declaredAt: integer, declaredJurisdiction: z.string().max(20).optional() }).strict().optional(),
  permissions: z.array(permissionSchema).max(16), receipts: z.array(receiptSchema).max(100),
  agentGrants: z.array(z.object({ agentId: id, space, allowed: z.boolean(), revision, updatedAt: integer }).strict()).max(100).default([]),
  memories: z.array(memorySchema).max(300), events: z.array(eventSchema).max(2000),
  experience: experienceDocumentSchema.default(emptyExperience),
  relationships: relationshipDocumentSchema.default(emptyRelationshipDocument),
  consentEvents: z.array(z.unknown()).max(2000), outbox: z.array(outboxSchema).max(2000),
}).strict();
export type AdaptiveDocument = Omit<z.infer<typeof documentSchema>, 'permissions' | 'binding' | 'consentEvents'> & {
  permissions: ConsentPermission[]; binding?: PersonAccountBinding; consentEvents: ConsentEvent[];
};
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export const accountIdFor = (telegramId: number) => `telegram-account:${telegramId}`;
export const tenantIdFor = (accountId: string) => `private-tenant:${digest(accountId).slice(0, 24)}`;
export const spaceIdFor = (accountId: string, space: SpaceKind) => `${tenantIdFor(accountId)}:${space}`;
export const containerIdFor = (accountId: string, space: SpaceKind) => `${spaceIdFor(accountId, space)}:private`;

function create(accountId: string, now: number): AdaptiveDocument {
  const personId = `account-profile:${digest(accountId).slice(0, 32)}`;
  return { schemaVersion: 1, accountId, personId, revision: 1, createdAt: now, updatedAt: now,
    experience: emptyExperience(), relationships: emptyRelationshipDocument(), permissions: (['work', 'personal'] as const).flatMap(s => OPTIONAL_PURPOSES.map(p => ({
      schemaVersion: 1 as const, id: `permission:${s}:${p}`, revision: 1, createdAt: now, updatedAt: now,
      tenantId: tenantIdFor(accountId), spaceId: spaceIdFor(accountId, s), personId, purpose: p,
      purposeVersion: 1, policyVersion: ADAPTIVE_POLICY_VERSION, state: 'not_asked' as const,
      epoch: 0, effectiveAt: now, expiresAt: now,
    }))), receipts: [], agentGrants: [], memories: [], events: [], consentEvents: [], outbox: [] };
}

export class AdaptiveRepository {
  constructor(readonly storage: AdaptiveStorage) {}
  transaction<T>(accountId: string, now: number, fn: (document: AdaptiveDocument) => T): Promise<T> {
    if (!/^telegram-account:[1-9]\d{0,15}$/.test(accountId) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid adaptive account');
    return this.storage.transact(accountId, current => {
      // Only an exact, otherwise valid old 14-purpose document is upgraded. Existing
      // permissions and receipts are preserved; the new purpose starts unasked.
      let input = current;
      if (input && typeof input === 'object' && 'permissions' in input && Array.isArray(input.permissions) && input.permissions.length === 14) {
        const old = input.permissions;
        const expected = create(accountId, now).permissions.filter(p => p.purpose !== 'optional.relationship_outreach');
        if (old.every(p => p && typeof p === 'object' && 'id' in p) && new Set(old.map(p => p.id)).size === 14 &&
            expected.every(p => old.some(row => row.id === p.id && row.purpose === p.purpose))) {
          input = { ...input, permissions: [...old, ...create(accountId, now).permissions.filter(p => p.purpose === 'optional.relationship_outreach')] };
        }
      }
      const draft = input === null ? create(accountId, now) : documentSchema.parse(input) as AdaptiveDocument;
      if (draft.accountId !== accountId || draft.personId !== create(accountId, now).personId || draft.updatedAt > now ||
          new Set(draft.permissions.map(p => p.id)).size !== 16 || draft.permissions.length !== 16 ||
          new Set(draft.events.map(e => e.eventId)).size !== draft.events.length ||
          new Set(draft.memories.map(m => m.id)).size !== draft.memories.length) throw new Error('Invalid adaptive document');
      // Validate immutable partition keys. Corrupt identity/scope cannot become authoritative.
      for (const s of ['work', 'personal'] as const) for (const p of OPTIONAL_PURPOSES) {
        const permission = draft.permissions.find(row => row.id === `permission:${s}:${p}`);
        if (!permission || permission.personId !== draft.personId || permission.purpose !== p ||
            permission.tenantId !== tenantIdFor(accountId) || permission.spaceId !== spaceIdFor(accountId, s)) throw new Error('Invalid adaptive permission');
      }
      if (new Set(draft.relationships.controls.map(c => digest([c.agentId, c.space]))).size !== draft.relationships.controls.length ||
          new Set(draft.relationships.bindings.map(b => b.space)).size !== draft.relationships.bindings.length ||
          draft.relationships.bindings.some(b => b.accountId !== accountId || b.personId !== draft.personId || b.confirmedAt > b.expiresAt || b.confirmedAt > now) ||
          new Set(draft.relationships.sources.map(s => digest([s.key.personaId, s.key.scope.space, s.id]))).size !== draft.relationships.sources.length ||
          new Set(draft.relationships.inbox.map(i => i.id)).size !== draft.relationships.inbox.length ||
          new Set(draft.relationships.ledger.map(i => i.id)).size !== draft.relationships.ledger.length) throw new Error('Invalid relationship authority');
      for (const key of [...draft.relationships.sources.map(s => s.key), ...draft.relationships.inbox.map(i => i.key), ...draft.relationships.ledger.map(i => i.key)]) {
        const scope = key.scope;
        if (scope.accountId !== accountId || scope.personId !== draft.personId || scope.tenantId !== tenantIdFor(accountId) ||
            scope.spaceId !== spaceIdFor(accountId, scope.space) || scope.containerId !== containerIdFor(accountId, scope.space) ||
            key.audience.personId !== draft.personId || key.chatKey !== `private-${draft.personId}`) throw new Error('Invalid relationship partition');
      }
      const result = fn(draft);
      documentSchema.parse(draft);
      return { document: draft, result };
    });
  }
}
