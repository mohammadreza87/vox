import { z } from 'zod';
import type { AdaptiveStorage } from '../persistence/storage';
import { digest } from '../persistence/repository';
import type { SharedRecipient, SharedSpace } from './contracts';
export interface SharedMember extends SharedRecipient { bindingRevision: number; status: 'active' | 'revoked' }
export interface SharedMemory {
  id: string; revision: number; text?: string; authorPersonId: string; status: 'pending' | 'active' | 'deleted';
  createdAt: number; updatedAt: number; expiresAt: number; recipientPersonIds: string[]; tombstoneEventId?: string;
  publication?: { operationId: string; authorityKey: string; intentFingerprint: string; contentDigest: string; audienceKey: string; stagedAt: number; validUntil: number; finalizedAt?: number };
}
export interface SharedContainer {
  id: string; space: SharedSpace; kind: 'selected' | 'group'; groupId?: string; groupRevision?: string; audienceInvalidatedAt?: number;
  ownerPersonId: string; revision: number; createdAt: number; updatedAt: number; status: 'pending' | 'active' | 'deleted';
  members: SharedMember[]; agents: { agentId: string; allowed: boolean; revision: number }[]; memories: SharedMemory[];
}
export interface SharedDocument {
  schemaVersion: 1; namespace: string; revision: number; containers: SharedContainer[];
  previews: { token: string; ownerPersonId: string; space: SharedSpace; kind: 'selected' | 'group'; groupId?: string;
    groupRevision?: string; members: SharedMember[]; authorityRevision: string; expiresAt: number; consumedBy?: string }[];
  events: { id: string; fingerprint: string; resultId: string; revision: number; state?: 'pending' | 'committed' | 'aborted'; operationId?: string }[];
}
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(200);
const memberSchema = z.object({ telegramId: integer.positive(), personId: id, bindingRevision: integer.positive(), status: z.enum(['active', 'revoked']) }).strict();
const memorySchema = z.object({ id, revision: integer.positive(), text: z.string().min(1).max(2000).optional(), authorPersonId: id,
  status: z.enum(['pending', 'active', 'deleted']), createdAt: integer, updatedAt: integer, expiresAt: integer,
  recipientPersonIds: z.array(id).min(1).max(12), tombstoneEventId: id.optional(),
  publication: z.object({ operationId: id, authorityKey: id, intentFingerprint: id, contentDigest: id, audienceKey: id, stagedAt: integer, validUntil: integer, finalizedAt: integer.optional() }).strict().optional() }).strict()
  .refine(m => (m.status === 'deleted' ? m.text === undefined : typeof m.text === 'string') &&
    (m.status !== 'pending' || !!m.publication && m.publication.finalizedAt === undefined), 'Invalid memory retention');
const containerSchema = z.object({ id, space: z.enum(['work', 'personal']), kind: z.enum(['selected', 'group']), groupId: id.optional(), groupRevision: id.optional(), audienceInvalidatedAt: integer.optional(),
  ownerPersonId: id, revision: integer.positive(), createdAt: integer, updatedAt: integer, status: z.enum(['pending', 'active', 'deleted']),
  members: z.array(memberSchema).min(2).max(12), agents: z.array(z.object({ agentId: id, allowed: z.boolean(), revision: integer.positive() }).strict()).max(10),
  memories: z.array(memorySchema).max(200) }).strict().superRefine((c, ctx) => {
    const people = c.members.map(m => m.personId), accounts = c.members.map(m => m.telegramId);
    if (new Set(people).size !== people.length || new Set(accounts).size !== accounts.length || !people.includes(c.ownerPersonId) ||
        new Set(c.agents.map(a => a.agentId)).size !== c.agents.length || new Set(c.memories.map(m => m.id)).size !== c.memories.length ||
        (c.kind === 'group' ? !c.groupId || !c.groupRevision : !!c.groupId || !!c.groupRevision) ||
        c.memories.some(m => !people.includes(m.authorPersonId) || m.recipientPersonIds.some(p => !people.includes(p)) || new Set(m.recipientPersonIds).size !== m.recipientPersonIds.length) ||
        (c.status === 'deleted' && c.memories.some(m => m.status !== 'deleted')) ||
        (c.status === 'pending' && c.memories.some(m => m.status !== 'pending'))) ctx.addIssue({ code: 'custom', message: 'Invalid container partition' });
  });
const documentSchema = z.object({ schemaVersion: z.literal(1), namespace: id, revision: integer,
  containers: z.array(containerSchema).max(100),
  previews: z.array(z.object({ token: id, ownerPersonId: id, space: z.enum(['work', 'personal']), kind: z.enum(['selected', 'group']),
    groupId: id.optional(), groupRevision: id.optional(), members: z.array(memberSchema).min(2).max(12), authorityRevision: id, expiresAt: integer, consumedBy: id.optional() }).strict()).max(100),
  events: z.array(z.object({ id, fingerprint: id, resultId: id, revision: integer.positive(), state: z.enum(['pending', 'committed', 'aborted']).optional(), operationId: id.optional() }).strict()).max(2000),
}).strict().refine(d => new Set(d.containers.map(c => c.id)).size === d.containers.length &&
  new Set(d.previews.map(p => p.token)).size === d.previews.length && new Set(d.events.map(e => e.id)).size === d.events.length);

/** All registry/index/content mutations share one transaction. Separate namespace/storage
 * from Studio admin state and private account documents; bounded capacity fails closed. */
export class SharedMemoryRepository {
  constructor(readonly storage: AdaptiveStorage, readonly namespace = 'studio') {}
  /** Canonical shared aggregate, synchronously validated. No text is returned by
   * the service authority projection; this is not a shared-body index. */
  readCommittedForEffect(): SharedDocument {
    const snapshot = this.storage.readCommittedForEffect?.(`shared-memory:v1:${this.namespace}`);
    if (!snapshot || snapshot.status !== 'ready') throw new Error('Shared authority unavailable');
    const document: SharedDocument = snapshot.document === null
      ? { schemaVersion: 1, namespace: this.namespace, revision: 0, containers: [], previews: [], events: [] }
      : documentSchema.parse(snapshot.document);
    if (document.namespace !== this.namespace || Buffer.byteLength(JSON.stringify(document)) > 650_000) throw new Error('Invalid shared memory document');
    return document;
  }
  transaction<T>(fn: (document: SharedDocument) => T): Promise<T> {
    return this.storage.transact(`shared-memory:v1:${this.namespace}`, (raw) => {
      const parsed = raw === null ? undefined : documentSchema.safeParse(raw);
      if (parsed && !parsed.success) throw new Error('Invalid shared memory document');
      const document: SharedDocument = parsed?.success ? parsed.data : { schemaVersion: 1, namespace: this.namespace, revision: 0, containers: [], previews: [], events: [] };
      if (!document || document.schemaVersion !== 1 || document.namespace !== this.namespace ||
          !Number.isSafeInteger(document.revision) || document.revision < 0 || !Array.isArray(document.containers) ||
          !Array.isArray(document.previews) || !Array.isArray(document.events)) throw new Error('Invalid shared memory document');
      const result = fn(document);
      if (!documentSchema.safeParse(document).success) throw new Error('Invalid shared memory mutation');
      if (Buffer.byteLength(JSON.stringify(document)) > 650_000) throw new Error('Shared memory storage capacity reached');
      return { document, result };
    });
  }
}
export const sharedDigest = digest;
