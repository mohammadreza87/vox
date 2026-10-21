/**
 * Audit decorators for the TIREH memory and share-offer stores.
 *
 * Both are Proxies: they intercept only the write methods and forward every
 * other property with `Reflect.get(target, prop, target)`, binding functions
 * to the target. This keeps #private fields, the file store's own-property
 * lock wrappers, `instanceof` and the optional S06 methods (findNearest,
 * tombstonesOf, addTombstones) working without explicit forwarding.
 *
 * Flags are read on every call. With TIREH_AUDIT_LOG and TIREH_SHARING_V2
 * both off, every intercepted method is a pure pass-through: same arguments,
 * same result or error, no extra store reads.
 *
 * Audit appends are awaited after the store write and every failure is
 * swallowed: a failed audit never changes a memory result or error. Rows and
 * notices carry ids, person ids, a chat-key hash, a policy key and an outcome,
 * never content, topics or message text.
 */

import { tirehFlags } from '../flags';
import { supersedeNoticeRecipients } from '../memory/sharing';
import type { MemoryStore, NewMemory, ShareOfferStore } from '../memory/store';
import type { MemoryRecord, MemoryScope, ShareOffer } from '../types';
import type { SupersededNoticeStore } from './notices';
import { chatKeyHash, sourceChatKey, type AuditKind, type AuditOutcome, type AuditStore, type NewAuditRow } from './store';

type MemoryPatch = Partial<Omit<MemoryRecord, 'id' | 'personaId'>>;

/** Readers a record is bounded to when it carries no explicit snapshot. */
function implicitAudience(scope: MemoryScope): string[] {
  return scope.kind === 'private' ? [scope.personId] : scope.kind === 'people' ? [...scope.personIds] : [];
}

function audienceOf(memory: Pick<MemoryRecord, 'authorizedPersonIds' | 'scope'>): string[] {
  return memory.authorizedPersonIds ?? implicitAudience(memory.scope);
}

function policyKey(scope: MemoryScope, sensitivity: MemoryRecord['sensitivity']): string {
  return `tireh.visibility.v1:${scope.kind}:${sensitivity}`;
}

function scopeChangeKind(patch: MemoryPatch, before: MemoryRecord | null): AuditKind {
  return patch.scope?.kind === 'private' && before?.scope.kind !== 'private' ? 'revoke' : 'share_approve';
}

function errorOutcome(error: unknown): AuditOutcome {
  return (error as { name?: unknown } | null)?.name === 'StaleMemoryWriteError' ? 'denied' : 'failed';
}

async function bestEffort(operation: () => Promise<unknown>): Promise<void> {
  try { await operation(); } catch { /* best effort: never changes the memory result */ }
}

export function auditMemoryStore(inner: MemoryStore, audit: AuditStore, notices?: SupersededNoticeStore): MemoryStore {
  const target = inner;
  const append = (row: NewAuditRow) => bestEffort(() => audit.append(row));
  const writeRow = (memory: NewMemory, record: { id: string; authorizedPersonIds?: string[] } | null, outcome: AuditOutcome): NewAuditRow => ({
    kind: memory.supersedes ? 'supersede' : 'write',
    personaId: memory.personaId,
    chatKeyHash: chatKeyHash(sourceChatKey(memory)),
    audiencePersonIds: audienceOf({ authorizedPersonIds: record ? record.authorizedPersonIds : memory.authorizedPersonIds, scope: memory.scope }),
    memoryIds: [...(record ? [record.id] : []), ...(memory.supersedes ? [memory.supersedes] : [])],
    policyKey: policyKey(memory.scope, memory.sensitivity),
    actorPersonId: memory.source.personId,
    outcome,
    at: new Date(),
  });
  const rowFor = (kind: AuditKind, before: MemoryRecord, memoryIds: string[], audiencePersonIds: string[], outcome: AuditOutcome, scope: MemoryScope, actor: boolean): NewAuditRow => ({
    kind,
    personaId: before.personaId,
    chatKeyHash: chatKeyHash(sourceChatKey(before)),
    audiencePersonIds,
    memoryIds,
    policyKey: policyKey(scope, before.sensitivity),
    ...(actor ? { actorPersonId: before.source.personId } : {}),
    outcome,
    at: new Date(),
  });

  const wrapped: Pick<MemoryStore, 'add' | 'update' | 'updateIfShareVersion' | 'delete'> = {
    async add(...args: Parameters<MemoryStore['add']>) {
      const flags = tirehFlags();
      if (!flags.auditLog && !(flags.sharingV2 && notices)) return target.add(...args);
      const [memory] = args;
      let record: MemoryRecord;
      try {
        record = await target.add(...args);
      } catch (error) {
        if (flags.auditLog) await append(writeRow(memory, null, errorOutcome(error)));
        throw error;
      }
      if (flags.auditLog) await append(writeRow(memory, record, 'applied'));
      if (flags.sharingV2 && notices && memory.supersedes) {
        const predecessorId = memory.supersedes;
        await bestEffort(async () => {
          const predecessor = await target.get(predecessorId);
          if (!predecessor) return;
          const recipientPersonIds = supersedeNoticeRecipients(predecessor);
          if (!recipientPersonIds.length) return;
          await notices.record({ personaId: predecessor.personaId, oldMemoryId: predecessor.id, newMemoryId: record.id,
            ownerPersonId: predecessor.source.personId, recipientPersonIds, at: new Date() });
        });
      }
      return record;
    },

    async updateIfShareVersion(...args: Parameters<MemoryStore['updateIfShareVersion']>) {
      const [id, , patch] = args;
      // Patches without a scope change (the admin re-snapshot) are audited by their caller with the real actor.
      if (!tirehFlags().auditLog || !patch || !('scope' in patch)) return target.updateIfShareVersion(...args);
      const before = await target.get(id);
      const kind = scopeChangeKind(patch, before);
      const scope = patch.scope ?? before?.scope;
      let result: boolean;
      try {
        result = await target.updateIfShareVersion(...args);
      } catch (error) {
        if (before && scope) await append(rowFor(kind, before, [id], patch.authorizedPersonIds ?? [], errorOutcome(error), scope, true));
        throw error;
      }
      if (before && scope) await append(rowFor(kind, before, [id], patch.authorizedPersonIds ?? [], result ? 'applied' : 'denied', scope, true));
      return result;
    },

    async update(...args: Parameters<MemoryStore['update']>) {
      if (!tirehFlags().auditLog) return target.update(...args);
      const [id, patch] = args;
      const before = await target.get(id);
      await target.update(...args);
      if (!before) return;
      const kind: AuditKind = 'supersededBy' in patch ? 'supersede' : 'scope' in patch ? scopeChangeKind(patch, before) : 'write';
      const scope = patch.scope ?? before.scope;
      const audience = patch.authorizedPersonIds ?? (patch.scope ? implicitAudience(patch.scope) : audienceOf(before));
      await append(rowFor(kind, before, [id, ...(patch.supersededBy ? [patch.supersededBy] : [])], audience, 'applied', scope, true));
    },

    async delete(...args: Parameters<MemoryStore['delete']>) {
      if (!tirehFlags().auditLog) return target.delete(...args);
      const [id] = args;
      const before = await target.get(id);
      await target.delete(...args);
      // The store cannot attest who deleted, so the row has no actor.
      if (before) await append(rowFor('delete', before, [id], audienceOf(before), 'applied', before.scope, false));
    },
  };

  return new Proxy(inner, {
    get(object, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(wrapped, prop)) return wrapped[prop as keyof typeof wrapped];
      const value: unknown = Reflect.get(object, prop, object);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(object) : value;
    },
  });
}

export function auditShareOfferStore(inner: ShareOfferStore, audit: AuditStore): ShareOfferStore {
  const target = inner;
  const offerRow = (offer: Pick<ShareOffer, 'personaId' | 'memoryId' | 'proposedAudiencePersonIds' | 'proposedScope'>, outcome: AuditOutcome): NewAuditRow => ({
    kind: 'share_offer',
    personaId: offer.personaId,
    audiencePersonIds: offer.proposedAudiencePersonIds ?? [],
    memoryIds: [offer.memoryId],
    policyKey: `tireh.share_offer.v1:${offer.proposedScope.kind}`,
    outcome,
    at: new Date(),
  });
  const wrapped: Pick<ShareOfferStore, 'create' | 'setStatus'> = {
    async create(...args: Parameters<ShareOfferStore['create']>) {
      if (!tirehFlags().auditLog) return target.create(...args);
      const offer = await target.create(...args);
      await bestEffort(() => audit.append(offerRow(offer, 'applied')));
      return offer;
    },
    async setStatus(...args: Parameters<ShareOfferStore['setStatus']>) {
      const [id, status] = args;
      // share_approve is recorded from the memory update itself; only declines are audited here.
      if (!tirehFlags().auditLog || status !== 'declined') return target.setStatus(...args);
      const offer = await target.get(id);
      await target.setStatus(...args);
      if (offer) await bestEffort(() => audit.append(offerRow(offer, 'denied')));
    },
  };
  return new Proxy(inner, {
    get(object, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(wrapped, prop)) return wrapped[prop as keyof typeof wrapped];
      const value: unknown = Reflect.get(object, prop, object);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(object) : value;
    },
  });
}
