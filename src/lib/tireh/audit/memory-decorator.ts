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
 * (deterministic in tests). Each wait for an audit append or a notice record is
 * bounded by AUDIT_WRITE_TIMEOUT_MS: a hung append never stalls a memory write
 * (the append itself may still complete later, which is acceptable for
 * append-only rows). Notice erasure on delete is not bounded: it is a privacy
 * erasure, not an append, so delete() waits for it to finish (the memory delete
 * has already happened, so nothing else waits on it) and only a rejection is
 * reported. A rejected, invalid or timed-out write never changes a memory
 * result; it is signalled by one fixed, content-free log line (`[vox] <code>`,
 * see AuditSignalCode), never with row fields, ids or content. Rows carry ids,
 * person ids, a hashed policy key and an outcome, never content, topics or
 * message text.
 *
 * A delete row lists every id the store reports removed with the requested one
 * (its forget closure), in rows of at most MAX_AUDIT_IDS ids, appended in
 * parallel so a large closure waits for at most one AUDIT_WRITE_TIMEOUT_MS.
 *
 * TODO(worker / Step 1): chatKeyHash is omitted at store level; supply it when
 * the worker or the Step 1 turn snapshot passes chat context.
 * TODO(worker / Step 1 / S10L): the reserved kinds retrieval, prompt_memory,
 * consent_change and identity_change are not written here.
 */

import { tirehFlags } from '../flags';
import { supersedeNoticeRecipients } from '../memory/sharing';
import { isStaleMemoryWriteError, type MemoryStore, type NewMemory, type ShareOfferStore } from '../memory/store';
import type { MemoryRecord, ShareOffer } from '../types';
import type { SupersededNoticeEraser, SupersededNoticeStore } from './notices';
import { MAX_AUDIT_IDS, memoryPolicyKey, type AuditKind, type AuditOutcome, type AuditStore, type NewAuditRow } from './store';

type MemoryPatch = Partial<Omit<MemoryRecord, 'id' | 'personaId'>>;

/** The write methods the memory decorator intercepts; pinned by the decorator tests. */
export const AUDITED_MEMORY_METHODS = ['add', 'addIfEpoch', 'update', 'updateIfShareVersion', 'delete'] as const;
export const AUDITED_OFFER_METHODS = ['create', 'setStatus'] as const;

function errorOutcome(error: unknown): AuditOutcome {
  return isStaleMemoryWriteError(error) ? 'denied' : 'failed';
}

/** The longest a memory write waits for one audit or notice write. */
export const AUDIT_WRITE_TIMEOUT_MS = 2000;

/** The only strings the decorators log, each as `[vox] <code>`: fixed and content-free. */
export type AuditSignalCode = 'audit_append_failed' | 'audit_append_timeout' | 'notice_record_failed' | 'notice_erasure_failed';
export type AuditLogger = Pick<Console, 'warn'>;
export interface AuditDecoratorOptions { /** Default console. Receives only `[vox] <AuditSignalCode>`. */ log?: AuditLogger }

function signal(log: AuditLogger, code: AuditSignalCode): void {
  try { log.warn(`[vox] ${code}`); } catch { /* a broken logger never changes a memory result */ }
}

/**
 * Awaited for at most AUDIT_WRITE_TIMEOUT_MS, never throws: an audit or notice failure never changes a memory
 * result. A rejection logs `code`; the timeout logs 'audit_append_timeout' for an audit append and `code` for a
 * notice record. A write that settles after the timeout is not reported again.
 */
async function bestEffort(operation: () => Promise<unknown>, code: Exclude<AuditSignalCode, 'audit_append_timeout' | 'notice_erasure_failed'>, log: AuditLogger): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The write's own promise never rejects (a late rejection after the timeout is not an unhandled rejection).
  const write = Promise.resolve().then(operation).then(() => 'done' as const, () => 'failed' as const);
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), AUDIT_WRITE_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    const outcome = await Promise.race([write, timeout]);
    if (outcome === 'failed') signal(log, code);
    else if (outcome === 'timeout') signal(log, code === 'audit_append_failed' ? 'audit_append_timeout' : code);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Notice erasure on delete: awaited to the end, never time-bounded and never throws. Unlike an append it is a
 * privacy erasure, so a slow erasure is not cut off, left running detached or reported as a failure; only a
 * rejection logs 'notice_erasure_failed'. The memory delete has already happened when this runs.
 */
async function eraseFully(operation: () => Promise<unknown>, log: AuditLogger): Promise<void> {
  try { await operation(); } catch { signal(log, 'notice_erasure_failed'); }
}

/** Splits ids into chunks of at most MAX_AUDIT_IDS (normalizeAuditRow caps a row at that many). */
function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_AUDIT_IDS) chunks.push(ids.slice(i, i + MAX_AUDIT_IDS));
  return chunks.length ? chunks : [[]];
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

/** The requested id and every id the store reports removed with it (its forget closure); defensive about the shape. */
function forgottenIds(id: string, removed: unknown): string[] {
  const ids = Array.isArray(removed) ? removed.filter((r): r is string => typeof r === 'string') : [];
  return [...new Set([id, ...ids])];
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

export function auditMemoryStore(inner: MemoryStore, audit: AuditStore, notices?: SupersededNoticeStore, options: AuditDecoratorOptions = {}): MemoryStore {
  const target = inner;
  const log = options.log ?? console;
  const append = (row: NewAuditRow) => bestEffort(() => audit.append(row), 'audit_append_failed', log);
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
          ownerPersonId: predecessor.source.personId, recipientPersonIds, at: new Date() }), 'notice_record_failed', log);
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
      // Erasure: a deleted memory leaves no supersede notice naming it or any record its forget closure removed,
      // whatever the flags are now (notices recorded while TIREH_SHARING_V2 was on must still go). Never a read
      // of the memory store.
      const eraseNotices = (removed: string[]) => notices
        ? eraseFully(() => notices.deleteByMemoryIds(forgottenIds(id, removed)), log) : undefined;
      if (!tirehFlags().auditLog) { const removed = await target.delete(...args); await eraseNotices(removed); return removed; }
      const before = await safeGet(target, id);
      let failure: { error: unknown } | null = null;
      let removed: string[] = [];
      try { removed = await target.delete(...args); } catch (error) { failure = { error }; }
      // The store cannot attest who deleted, so the row has no actor. A delete removes the record's whole forget
      // closure, so the row lists every id the store reports removed (one row per MAX_AUDIT_IDS ids); a failed
      // delete keeps the single requested id. audiencePersonIds stays the requested record's audience: the
      // cascaded records are not read before the delete (a read per closure member would add store round trips
      // and could race the delete), and their audiences are recorded on their own write and share rows.
      if (before) {
        const outcome: AuditOutcome = failure ? errorOutcome(failure.error) : 'applied';
        const at = new Date();
        // In parallel (appended in chunk order): a large closure waits for one AUDIT_WRITE_TIMEOUT_MS, not one per chunk.
        await Promise.all(chunkIds(failure ? [id] : forgottenIds(id, removed)).map((memoryIds) =>
          append({ kind: 'delete', personaId: before.personaId, audiencePersonIds: before.authorizedPersonIds ?? [], memoryIds,
            policyKey: memoryPolicyKey(before), outcome, at })));
      }
      if (failure) throw failure.error;
      await eraseNotices(removed);
      return removed;
    },
  };

  return proxy(inner, wrapped);
}

/**
 * Erasure after a flag rollback: with both S08 flags off the audit decorator is not installed, yet notices
 * recorded while TIREH_SHARING_V2 was on must still go with their memories. This proxy intercepts only delete:
 * the store call first (its result or error unchanged), then every notice naming the id or any id of its forget
 * closure (the ids the store reports removed) is erased, awaited to the end (a rejection is logged, never thrown).
 * Every other method is the inner store's own.
 */
export function noticeErasingMemoryStore(inner: MemoryStore, notices: SupersededNoticeEraser, options: AuditDecoratorOptions = {}): MemoryStore {
  const log = options.log ?? console;
  const wrapped: Pick<MemoryStore, 'delete'> = {
    async delete(...args: Parameters<MemoryStore['delete']>) {
      const removed = await inner.delete(...args);
      await eraseFully(() => notices.deleteByMemoryIds(forgottenIds(args[0], removed)), log);
      return removed;
    },
  };
  return proxy(inner, wrapped);
}

export function auditShareOfferStore(inner: ShareOfferStore, audit: AuditStore, options: AuditDecoratorOptions = {}): ShareOfferStore {
  const target = inner;
  const log = options.log ?? console;
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
      await bestEffort(() => audit.append(offerRow(offer, 'applied')), 'audit_append_failed', log);
      return offer;
    },
    async setStatus(...args: Parameters<ShareOfferStore['setStatus']>) {
      const [id, status] = args;
      // share_approve is recorded from the memory update itself; only declines are audited here.
      if (!tirehFlags().auditLog || status !== 'declined') return target.setStatus(...args);
      let offer: ShareOffer | null = null;
      try { offer = await target.get(id); } catch { offer = null; }
      await target.setStatus(...args);
      if (offer) await bestEffort(() => audit.append(offerRow(offer!, 'denied')), 'audit_append_failed', log);
    },
  };
  return proxy(inner, wrapped);
}
