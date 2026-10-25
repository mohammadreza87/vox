/**
 * Audit decorators for the TIREH memory and share-offer stores (S08).
 *
 * Both are Proxies: they intercept only the write methods and forward every
 * other property with `Reflect.get(target, prop, target)`, binding functions
 * to the target. This keeps private fields, the file store's lock wrappers,
 * `records`, `instanceof` and the optional S06 methods (findNearest,
 * tombstonesOf, addTombstones) working without explicit forwarding.
 *
 * Intercepted: add, addIfEpoch, update, updateIfShareVersion and delete. Each
 * calls the target first and returns or throws exactly what the target does;
 * the base InMemory addIfEpoch calls prototype.add on the target, so it is
 * never counted twice. Flags are read on every call: with TIREH_AUDIT_LOG and
 * TIREH_SHARING_V2 off every intercepted method is a pure pass-through (same
 * arguments, same result or error, no extra store reads).
 *
 * Rows and notices are written best effort after the store call and awaited
 * (deterministic in tests); a rejected or invalid row never changes a memory
 * result. Rows carry ids, person ids, a hashed policy key and an outcome,
 * never content, topics or message text.
 *
 * TODO(worker / Step 1): chatKeyHash is omitted at store level; supply it when
 * the worker or the Step 1 turn snapshot passes chat context.
 * TODO(worker / Step 1 / S10L): the reserved kinds retrieval, prompt_memory,
 * consent_change and identity_change are not written here.
 * TODO(Step 7): delete rows list only the requested id; the forget cascade
 * will record the full closure.
 */

import { tirehFlags } from '../flags';
import { supersedeNoticeRecipients } from '../memory/sharing';
import { isStaleMemoryWriteError, type MemoryStore, type NewMemory, type ShareOfferStore } from '../memory/store';
import type { MemoryRecord, ShareOffer } from '../types';
import type { SupersededNoticeStore } from './notices';
import { memoryPolicyKey, type AuditKind, type AuditOutcome, type AuditStore, type NewAuditRow } from './store';

type MemoryPatch = Partial<Omit<MemoryRecord, 'id' | 'personaId'>>;

/** The write methods the memory decorator intercepts; pinned by the decorator tests. */
export const AUDITED_MEMORY_METHODS = ['add', 'addIfEpoch', 'update', 'updateIfShareVersion', 'delete'] as const;
export const AUDITED_OFFER_METHODS = ['create', 'setStatus'] as const;

function errorOutcome(error: unknown): AuditOutcome {
  return isStaleMemoryWriteError(error) ? 'denied' : 'failed';
}

/** Awaited, never throws: an audit or notice failure never changes a memory result. */
async function bestEffort(operation: () => Promise<unknown>): Promise<void> {
  await Promise.resolve().then(operation).catch(() => undefined);
}

async function safeGet(store: MemoryStore, id: string): Promise<MemoryRecord | null> {
  try { return await store.get(id); } catch { return null; }
}

/** updateIfShareVersion patch classification; null = no decorator row (the admin re-snapshot writes its own). */
function shareVersionKind(patch: MemoryPatch): AuditKind | null {
  if (patch.scope?.kind === 'private') return 'revoke';
  if (patch.scope && patch.authorizedPersonIds) return 'share_approve';
  if (!patch.scope && patch.authorizedPersonIds) return null;
  return 'write';
}

function proxy<T extends object>(target: T, wrapped: Record<string, unknown>): T {
  return new Proxy(target, {
    get(object, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(wrapped, prop)) return wrapped[prop];
      const value: unknown = Reflect.get(object, prop, object);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(object) : value;
    },
  });
}

export function auditMemoryStore(inner: MemoryStore, audit: AuditStore, notices?: SupersededNoticeStore): MemoryStore {
  const target = inner;
  const append = (row: NewAuditRow) => bestEffort(() => audit.append(row));
  const addRow = (memory: NewMemory, record: MemoryRecord | null, outcome: AuditOutcome): NewAuditRow => ({
    kind: memory.supersedes ? 'supersede' : 'write',
    personaId: memory.personaId,
    audiencePersonIds: (record ?? memory).authorizedPersonIds ?? [],
    memoryIds: [...(record ? [record.id] : []), ...(memory.supersedes ? [memory.supersedes] : [])],
    policyKey: memoryPolicyKey(record ?? memory),
    actorPersonId: memory.source.personId,
    outcome,
    at: new Date(),
  });

  /** Shared by add and addIfEpoch: target call first, then the row and (sharingV2) the notice. */
  async function audited(memory: NewMemory, call: () => Promise<MemoryRecord | null>): Promise<MemoryRecord | null> {
    const flags = tirehFlags();
    const wantsNotice = flags.sharingV2 && !!notices && !!memory.supersedes;
    if (!flags.auditLog && !wantsNotice) return call();
    const predecessor = wantsNotice ? await safeGet(target, memory.supersedes!) : null;
    let record: MemoryRecord | null;
    try {
      record = await call();
    } catch (error) {
      if (flags.auditLog) await append(addRow(memory, null, errorOutcome(error)));
      throw error;
    }
    if (flags.auditLog) await append(addRow(memory, record, record ? 'applied' : 'denied'));
    if (record && wantsNotice && predecessor && tirehFlags().sharingV2) {
      const recipientPersonIds = supersedeNoticeRecipients(predecessor);
      const newMemoryId = record.id;
      if (recipientPersonIds.length) {
        await bestEffort(() => notices!.record({ personaId: predecessor.personaId, oldMemoryId: predecessor.id, newMemoryId,
          ownerPersonId: predecessor.source.personId, recipientPersonIds, at: new Date() }));
      }
    }
    return record;
  }

  const wrapped: Pick<MemoryStore, (typeof AUDITED_MEMORY_METHODS)[number]> = {
    async add(...args: Parameters<MemoryStore['add']>) {
      return (await audited(args[0], () => target.add(...args)))!;
    },

    async addIfEpoch(...args: Parameters<MemoryStore['addIfEpoch']>) {
      return audited(args[0], () => target.addIfEpoch(...args));
    },

    async updateIfShareVersion(...args: Parameters<MemoryStore['updateIfShareVersion']>) {
      const [id, , patch] = args;
      const kind = patch ? shareVersionKind(patch) : null;
      if (!tirehFlags().auditLog || !kind) return target.updateIfShareVersion(...args);
      let result: boolean;
      let outcome: AuditOutcome;
      let failure: { error: unknown } | null = null;
      try {
        result = await target.updateIfShareVersion(...args);
        outcome = result ? 'applied' : 'denied';
      } catch (error) {
        failure = { error };
        result = false;
        outcome = errorOutcome(error);
      }
      // Owner-only paths: the actor is the record's source owner, read after the call.
      const record = await safeGet(target, id);
      if (record) {
        await append({ kind, personaId: record.personaId, audiencePersonIds: patch.authorizedPersonIds ?? record.authorizedPersonIds ?? [],
          memoryIds: [id], policyKey: memoryPolicyKey(record), actorPersonId: record.source.personId, outcome, at: new Date() });
      }
      if (failure) throw failure.error;
      return result;
    },

    async update(...args: Parameters<MemoryStore['update']>) {
      if (!tirehFlags().auditLog) return target.update(...args);
      const [id] = args;
      let failure: { error: unknown } | null = null;
      try { await target.update(...args); } catch (error) { failure = { error }; }
      const record = await safeGet(target, id);
      if (record) {
        await append({ kind: 'write', personaId: record.personaId, audiencePersonIds: record.authorizedPersonIds ?? [], memoryIds: [id],
          policyKey: memoryPolicyKey(record), actorPersonId: record.source.personId, outcome: failure ? errorOutcome(failure.error) : 'applied', at: new Date() });
      }
      if (failure) throw failure.error;
    },

    async delete(...args: Parameters<MemoryStore['delete']>) {
      const [id] = args;
      // Erasure: a deleted memory leaves no supersede notice naming it, whatever the flags are now
      // (notices recorded while TIREH_SHARING_V2 was on must still go). Never a read of the memory store.
      const eraseNotices = () => notices ? bestEffort(() => notices.deleteByMemoryIds([id])) : undefined;
      if (!tirehFlags().auditLog) { await target.delete(...args); await eraseNotices(); return; }
      const before = await safeGet(target, id);
      let failure: { error: unknown } | null = null;
      try { await target.delete(...args); } catch (error) { failure = { error }; }
      // The store cannot attest who deleted, so the row has no actor.
      if (before) {
        await append({ kind: 'delete', personaId: before.personaId, audiencePersonIds: before.authorizedPersonIds ?? [], memoryIds: [id],
          policyKey: memoryPolicyKey(before), outcome: failure ? errorOutcome(failure.error) : 'applied', at: new Date() });
      }
      if (failure) throw failure.error;
      await eraseNotices();
    },
  };

  return proxy(inner, wrapped);
}

export function auditShareOfferStore(inner: ShareOfferStore, audit: AuditStore): ShareOfferStore {
  const target = inner;
  const offerRow = (offer: Pick<ShareOffer, 'personaId' | 'memoryId' | 'ownerPersonId' | 'proposedAudiencePersonIds'>, outcome: AuditOutcome): NewAuditRow => ({
    kind: 'share_offer',
    personaId: offer.personaId,
    audiencePersonIds: offer.proposedAudiencePersonIds ?? [],
    memoryIds: [offer.memoryId],
    actorPersonId: offer.ownerPersonId,
    outcome,
    at: new Date(),
  });
  const wrapped: Pick<ShareOfferStore, (typeof AUDITED_OFFER_METHODS)[number]> = {
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
      let offer: ShareOffer | null = null;
      try { offer = await target.get(id); } catch { offer = null; }
      await target.setStatus(...args);
      if (offer) await bestEffort(() => audit.append(offerRow(offer!, 'denied')));
    },
  };
  return proxy(inner, wrapped);
}
