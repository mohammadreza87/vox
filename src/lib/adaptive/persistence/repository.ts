import { parseAssistantDeliveryControl, assistantCapacityProjection, assertAssistantDeliveryTransition, type AssistantDeliveryControl } from '../assistant-delivery-control';
import { telegramArchivesSchema } from '../telegram-archive-state';
import { rightsUseHoldsSchema, type RightsUseHolds, type RightsUseControls } from '../rights-use-holds/contracts';
import { emptyRightsUseHolds, requireRightsUseHoldCapacity } from '../rights-use-holds/state';
import { productPauseSchema, PRODUCT_PAUSE_RESERVED_BYTES, type ProductPauseV1, type ProductPauseUseControlsV1 } from '../product-pause/contracts';
import { emptyProductPause } from '../product-pause/state';
import { createHash, randomBytes } from 'crypto';
import { resolve } from 'path';
import { memoryLifecycleSchema, parseMemoryLifecycle, parseMemoryAccountErasing, isMemoryAccountErasing, memoryAccountCutoff, assertMemoryAccountSource, assertMemoryAccountId, memoryAccountSynchronous, registerMemoryAccountWork, memoryAccountWorkDetails, currentMemoryAccountWork, type MemoryLifecycle, type MemoryAccountStatus, type MemoryAccountWork } from '../memory-account-lifecycle';
import { checkMemoryAccountTime, observeMemoryAccountTime } from '../memory-account-lifecycle-file';
import { z } from 'zod';
import { activeReadScope, memoized, type TurnReadScope } from '../../tireh/privacy/read-scope';
import type { ConsentEvent } from '../consent';
import type { ConsentPermission, PersonAccountBinding } from '../types';
import { committedLoader, CommittedReadBusy, FileAdaptiveStorage, type AdaptiveStorage } from './storage';
import { emptyExperience, experienceDocumentSchema } from '../runtime/contracts';
import { emptyRelationshipDocument, relationshipDocumentSchema } from '../relationships/contracts';
import { emptyObserverDocument, observerDocumentSchema } from '../observation/contracts';

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
  origin: z.literal('user_reviewed_claim').optional(),
  sourceRefs: z.array(z.object({ id, revision }).strict()).min(1).max(8).refine(refs => new Set(refs.map(ref => ref.id)).size === refs.length).optional(),
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
const legacyDocumentSchema = z.object({ schemaVersion: z.literal(1), accountId: id, personId: id, revision,
  createdAt: integer, updatedAt: integer, binding: bindingSchema.optional(),
  declaration: z.object({ adultConfirmed: z.boolean(), declaredAt: integer, declaredJurisdiction: z.string().max(20).optional() }).strict().optional(),
  permissions: z.array(permissionSchema).max(16), receipts: z.array(receiptSchema).max(100),
  agentGrants: z.array(z.object({ agentId: id, space, allowed: z.boolean(), revision, updatedAt: integer }).strict()).max(100).default([]),
  memories: z.array(memorySchema).max(300), events: z.array(eventSchema).max(2000),
  experience: experienceDocumentSchema.default(emptyExperience),
  relationships: relationshipDocumentSchema.default(emptyRelationshipDocument),
  observer: observerDocumentSchema.default(emptyObserverDocument),
  telegramArchives: telegramArchivesSchema.optional(),
  assistantDeliveryControl: z.unknown().optional(),
  memoryLifecycle: memoryLifecycleSchema.optional(),
  consentEvents: z.array(z.unknown()).max(2000), outbox: z.array(outboxSchema).max(2000),
}).strict();
const productPauseDocumentSchema = legacyDocumentSchema.extend({ schemaVersion: z.literal(2), productPause: productPauseSchema }).strict();
const rightsUseDocumentSchema = productPauseDocumentSchema.extend({schemaVersion:z.literal(3),rightsUseHolds:rightsUseHoldsSchema,retentionStoreIdentity:z.union([z.string().regex(/^[a-f0-9]{64}$/),z.literal('canonical')])}).strict();
const documentSchema = z.union([legacyDocumentSchema, productPauseDocumentSchema, rightsUseDocumentSchema]);
export type AdaptiveDocument = Omit<z.infer<typeof legacyDocumentSchema>, 'schemaVersion' | 'permissions' | 'binding' | 'consentEvents' | 'assistantDeliveryControl'> & {
  assistantDeliveryControl?: AssistantDeliveryControl;
  schemaVersion: 1 | 2 | 3; productPause?: ProductPauseV1; rightsUseHolds?: RightsUseHolds; retentionStoreIdentity?:string;
  permissions: ConsentPermission[]; binding?: PersonAccountBinding; consentEvents: ConsentEvent[];
};
/** Canonical facts needed to evaluate identity and current capability policy.
 * A body-free projection is this type, never a fabricated AdaptiveDocument. */
export type AdaptiveAuthorityDocument = Pick<AdaptiveDocument,
  'schemaVersion' | 'accountId' | 'personId' | 'createdAt' | 'binding' | 'declaration' | 'permissions' | 'agentGrants'> & { productPause?: ProductPauseV1 | ProductPauseUseControlsV1; retentionStoreIdentity?:string; rightsUseHolds?:RightsUseHolds; rightsUseControls?:RightsUseControls };
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export const accountIdFor = (telegramId: number) => `telegram-account:${telegramId}`;
export const tenantIdFor = (accountId: string) => `private-tenant:${digest(accountId).slice(0, 24)}`;
export const spaceIdFor = (accountId: string, space: SpaceKind) => `${tenantIdFor(accountId)}:${space}`;
export const containerIdFor = (accountId: string, space: SpaceKind) => `${spaceIdFor(accountId, space)}:private`;

function create(accountId: string, now: number, schemaVersion: 1 | 2 | 3 = 1,retentionStoreIdentity?:string): AdaptiveDocument {
  const personId = `account-profile:${digest(accountId).slice(0, 32)}`;
  return { schemaVersion, ...(schemaVersion >= 2 ? { productPause: emptyProductPause() } : {}), ...(schemaVersion === 3 ? {rightsUseHolds:emptyRightsUseHolds(),retentionStoreIdentity:retentionStoreIdentity!}: {}), accountId, personId, revision: 1, createdAt: now, updatedAt: now,
    experience: emptyExperience(), relationships: emptyRelationshipDocument(), observer: emptyObserverDocument(), permissions: (['work', 'personal'] as const).flatMap(s => OPTIONAL_PURPOSES.map(p => ({
      schemaVersion: 1 as const, id: `permission:${s}:${p}`, revision: 1, createdAt: now, updatedAt: now,
      tenantId: tenantIdFor(accountId), spaceId: spaceIdFor(accountId, s), personId, purpose: p,
      purposeVersion: 1, policyVersion: ADAPTIVE_POLICY_VERSION, state: 'not_asked' as const,
      epoch: 0, effectiveAt: now, expiresAt: now,
    }))), receipts: [], agentGrants: [], memories: [], events: [], consentEvents: [], outbox: [] };
}

/** Strict complete canonical document validation shared with transactional indexed storage.
 * Partial authority projections must use their own schema, never this function. */
export function validateAdaptiveDocument(value: unknown, accountId: string, now: number): AdaptiveDocument {
  if (!/^telegram-account:[1-9]\d{0,15}$/.test(accountId) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid adaptive account');
  return checkAdaptiveDocument(documentSchema.parse(value) as AdaptiveDocument, accountId, now);
}
/** The invariant half of validateAdaptiveDocument, for a document already
 * parsed by its schema (a read scope parses a loaded document once). */
function checkAdaptiveDocument(draft: AdaptiveDocument, accountId: string, now: number): AdaptiveDocument {
  if (!/^telegram-account:[1-9]\d{0,15}$/.test(accountId) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid adaptive account');
  if (draft.accountId !== accountId || draft.personId !== create(accountId, now).personId || draft.updatedAt > now ||
      new Set(draft.permissions.map(p => p.id)).size !== 16 || draft.permissions.length !== 16 ||
      new Set(draft.events.map(e => e.eventId)).size !== draft.events.length ||
      new Set(draft.memories.map(m => m.id)).size !== draft.memories.length ||
      new Set(draft.observer.events.map(e => e.id)).size !== draft.observer.events.length) throw new Error('Invalid adaptive document');
  if (draft.memoryLifecycle !== undefined) {
    if (draft.schemaVersion !== 1) throw new Error('Memory lifecycle requires original FILE schema');
    parseMemoryLifecycle(draft.memoryLifecycle, now);
  }
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
  for (const row of draft.telegramArchives ?? []) {
    const scope = row.state?.scope;
    if (scope && (scope.accountId !== accountId || scope.personId !== draft.personId || scope.agentId !== row.agentId || scope.space !== row.space || scope.containerId !== containerIdFor(accountId, row.space))) throw new Error('Invalid Telegram archive partition');
    const retired = row.retiredOperation?.scope;
    if (retired && (retired.accountId !== accountId || retired.personId !== draft.personId || retired.agentId !== row.agentId || retired.space !== row.space || retired.containerId !== containerIdFor(accountId, row.space))) throw new Error('Invalid retired Telegram archive partition');
    if (row.state && row.retiredOperation && row.state.botId !== row.retiredOperation.botId) throw new Error('Invalid retired Telegram archive bot');
  }
  if(draft.assistantDeliveryControl!==undefined){
    if(draft.schemaVersion!==1)throw new Error('Assistant control requires original FILE schema');
    draft.assistantDeliveryControl=parseAssistantDeliveryControl(draft.assistantDeliveryControl,accountId,draft.personId,now);
    if(Buffer.byteLength(JSON.stringify(assistantCapacityProjection(draft)))>700000)throw new Error('Assistant control reserved capacity exceeded');
    requireProductPauseCapacity(assistantCapacityProjection(draft));requireRightsUseHoldCapacity(assistantCapacityProjection(draft));
  }
  if (draft.schemaVersion >= 2) {
    if (draft.productPause!.scopes.some(s => s.latest && s.latest.recordedAt > now)) throw new Error('Invalid pause receipt time');
    requireProductPauseCapacity(draft);
    requireRightsUseHoldCapacity(draft);
    if(draft.schemaVersion===3 && ([...draft.relationships.sources,...draft.observer.events,...(draft.observer.corrections??[]),...(draft.experience.preferenceLearning?.presentations??[]),...(draft.experience.preferenceLearning?.intents??[]),...(draft.experience.preferenceLearning?.candidates??[])].some(r=>!r.retentionStoreIdentity)))throw new Error('Missing retained source namespace');
    if (draft.rightsUseHolds?.effects.some(e=>e.appliedAt>now || e.release && e.release.releasedAt>now)) throw new Error('Invalid rights use time');
  }
  return draft;
}

/** The old fourteen-purpose normalization is limited to exact supported v1;
 * full validation follows before it can become canonical or be converted. */
export function normalizeLegacyAdaptiveDocument(raw: unknown, accountId: string, now: number): unknown {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === 1 &&
      'permissions' in raw && Array.isArray(raw.permissions) && raw.permissions.length === 14) {
    const old = raw.permissions, expected = create(accountId, now).permissions.filter(p => p.purpose !== 'optional.relationship_outreach');
    if (old.every(p => p && typeof p === 'object' && 'id' in p) && new Set(old.map(p => p.id)).size === 14 &&
        expected.every(p => old.some(row => row.id === p.id && row.purpose === p.purpose)))
      return { ...raw, permissions: [...old, ...create(accountId, now).permissions.filter(p => p.purpose === 'optional.relationship_outreach')] };
  }
  return raw;
}
/** Explicit transition-only initialization. V2 corruption never enters this path. */
export function upgradeLegacyAdaptiveDocumentV1ForProductPause(raw: unknown, accountId: string, now: number): AdaptiveDocument {
  const legacy = validateAdaptiveDocument(normalizeLegacyAdaptiveDocument(raw, accountId, now), accountId, now);
  if (legacy.schemaVersion !== 1) throw new Error('Product pause conversion requires legacy v1');
  return validateAdaptiveDocument({ ...legacy, schemaVersion: 2, productPause: emptyProductPause() }, accountId, now);
}
export function upgradeAdaptiveDocumentForRightsUseHolds(raw:unknown,accountId:string,now:number,sourceIdentity:string):AdaptiveDocument {
  const current=validateAdaptiveDocument(normalizeLegacyAdaptiveDocument(raw,accountId,now),accountId,now);
  if(current.schemaVersion===3)return current;
  if(sourceIdentity!=='canonical' && !/^[a-f0-9]{64}$/.test(sourceIdentity))throw new Error('Invalid retained source namespace');
  const converted={...current,schemaVersion:3 as const,productPause:current.productPause??emptyProductPause(),rightsUseHolds:emptyRightsUseHolds(),retentionStoreIdentity:sourceIdentity};
  for(const e of [...converted.relationships.sources,...converted.observer.events,...(converted.observer.corrections??[])])e.retentionStoreIdentity=sourceIdentity;
  const learning=converted.experience.preferenceLearning;
  if(learning)for(const r of [...learning.presentations,...learning.intents,...learning.candidates])r.retentionStoreIdentity=sourceIdentity;
  return validateAdaptiveDocument(converted,accountId,now);
}
export function requireProductPauseCapacity(document: AdaptiveDocument): void {
  if (document.schemaVersion < 2) return;
  const { productPause, ...payload } = document;
  // Count the complete property wrapper as part of the reserved block.
  if (Buffer.byteLength(JSON.stringify({ productPause })) > PRODUCT_PAUSE_RESERVED_BYTES ||
      Buffer.byteLength(JSON.stringify(payload)) > 700_000 - PRODUCT_PAUSE_RESERVED_BYTES ||
      Buffer.byteLength(JSON.stringify(document)) > 700_000) throw new Error('Product pause reserved capacity exceeded');
}

/** Keep the disabled rollout readable by the previous strict schema. A future
 * enabled observer rollout needs an explicit rollback migration; never restore
 * an old account backup over newer rights/tombstones. */
function storedForm(draft: AdaptiveDocument): Partial<AdaptiveDocument> {
  const stored: Partial<AdaptiveDocument> = { ...draft };
  if (!draft.observer.events.length && !draft.observer.projections.length) delete stored.observer;
  return stored;
}

export class AdaptiveRepository {
  constructor(readonly storage: AdaptiveStorage) {}
  memoryAccountMarked(): boolean {
    return this.storage instanceof FileAdaptiveStorage && this.storage.constructor === FileAdaptiveStorage && this.storage.memoryAccountMarked();
  }
  private originalMemoryAccountFile(): FileAdaptiveStorage {
    if (!(this.storage instanceof FileAdaptiveStorage) || this.storage.constructor !== FileAdaptiveStorage) throw new Error('Original FILE required');
    return this.storage;
  }
  memoryAccountStatus(accountId: string, at?: () => number): MemoryAccountStatus {
    assertMemoryAccountId(accountId);
    const storage = this.originalMemoryAccountFile();
    if (!storage.memoryAccountMarked()) return { state: 'unmarked', expected: { kind: 'missing' } };
    const loaded = storage.readMemoryAccountState(accountId);
    if (loaded.status !== 'ready') throw new Error('Memory account is busy');
    // Structural owner status needs no UTC claim. Expiry is evaluated only with qualified time.
    const now = at ? checkMemoryAccountTime(storage.directory, at) : Number.MAX_SAFE_INTEGER;
    if (loaded.document === null) return { state: 'missing', expected: { kind: 'missing' } };
    if (isMemoryAccountErasing(loaded.document)) {
      const closed = parseMemoryAccountErasing(loaded.document, accountId, now);
      return { state: 'erasing', expected: { kind: 'current', incarnation: closed.incarnation, revision: closed.revision, documentDigest: loaded.digest! }, closed: { ...closed, dispatchedOutcomes: at ? closed.dispatchedOutcomes.filter(row => row.retainUntil > now) : [] } };
    }
    const document = validateAdaptiveDocument(normalizeLegacyAdaptiveDocument(loaded.document, accountId, now), accountId, now);
    const lifecycle = document.memoryLifecycle;
    if (!lifecycle) return { state: 'legacy-current', expected: { kind: 'legacy', documentDigest: loaded.digest! } };
    return { state: lifecycle.mode === 'legacy-current' ? 'legacy-current' : 'active', lifecycle,
      expected: { kind: 'current', incarnation: lifecycle.incarnation, revision: lifecycle.revision, documentDigest: loaded.digest! } };
  }
  /** Capture only at original ingress/job creation, before awaited work. */
  captureMemoryAccountWork(accountId: string, at: () => number, originalDateSeconds?: number): MemoryAccountWork {
    const storage = this.originalMemoryAccountFile(), status = this.memoryAccountStatus(accountId, at);
    if ((status.state !== 'active' && status.state !== 'legacy-current') || !status.lifecycle) throw new Error('Memory account admission refused');
    const now = checkMemoryAccountTime(storage.directory, at);
    assertMemoryAccountSource(status.lifecycle, originalDateSeconds, now);
    return registerMemoryAccountWork({ directory: resolve(storage.directory), accountId, incarnation: status.lifecycle.incarnation, clock: at, ...(originalDateSeconds === undefined ? {} : { sourceDateSeconds: originalDateSeconds }) });
  }
  isMemoryAccountWorkCurrent(work: MemoryAccountWork, at: () => number): boolean {
    try {
      const storage = this.originalMemoryAccountFile(), captured = memoryAccountWorkDetails(work);
      const actual = storage.readMemoryAccountState(captured.accountId);
      if (actual.status !== 'ready') return false;
      const now = checkMemoryAccountTime(storage.directory, at);
      storage.assertMemoryAccountWork(captured.accountId, actual.document, work, now);
      return true;
    } catch { return false; }
  }
  async bootstrapMemoryAccount(accountId: string, input: { clock: () => number; authorizeAtAcceptance: (acceptedAt: number) => void; authorizeCommit: (acceptedAt: number, currentNow: number) => void }): Promise<MemoryLifecycle> {
    assertMemoryAccountId(accountId);
    const storage = this.originalMemoryAccountFile();
    let acceptedAt: number | undefined;
    return storage.transactMemoryAccountLifecycle(accountId, 'bootstrap', current => {
      if (current !== null) throw new Error('Memory account expected absence changed');
      const validationAt = checkMemoryAccountTime(storage.directory, input.clock);
      memoryAccountSynchronous(input.authorizeAtAcceptance, validationAt);
      // t0 follows locked fresh-intent validation; slow authentication I/O
      // must not leave the source cutoff anchored to an earlier sample.
      acceptedAt = checkMemoryAccountTime(storage.directory, input.clock);
      observeMemoryAccountTime(storage.directory, input.clock);
      const memoryLifecycle: MemoryLifecycle = { version: 1, mode: 'fresh-confirmed', incarnation: randomBytes(32).toString('hex'), revision: 1, confirmedAt: acceptedAt, sourceCutoffMs: memoryAccountCutoff(acceptedAt) };
      const document = validateAdaptiveDocument({ ...create(accountId, acceptedAt), memoryLifecycle }, accountId, acceptedAt);
      return { document: storedForm(document), result: memoryLifecycle };
    }, () => {
      if (acceptedAt === undefined) throw new Error('Memory account acceptance unavailable');
      observeMemoryAccountTime(storage.directory, input.clock);
      const now = checkMemoryAccountTime(storage.directory, input.clock);
      memoryAccountSynchronous(input.authorizeCommit, acceptedAt, now);
    });
  }
  /** Explicit existing-only migration; no account creation or consent changes. */
  async migrateExistingMemoryAccount(accountId: string, clock: () => number): Promise<MemoryLifecycle> {
    assertMemoryAccountId(accountId);
    const storage = this.originalMemoryAccountFile();
    return storage.transactMemoryAccountLifecycle(accountId, 'migration', current => {
      if (current === null || isMemoryAccountErasing(current)) throw new Error('Existing active memory account required');
      const now = checkMemoryAccountTime(storage.directory, clock);
      // Exact current canonical validation; migration does not normalize grants or payload.
      const document = validateAdaptiveDocument(current, accountId, now);
      if (document.schemaVersion !== 1) throw new Error('Original FILE schema required');
      const lifecycle: MemoryLifecycle = document.memoryLifecycle ?? { version: 1, mode: 'legacy-current', incarnation: randomBytes(32).toString('hex'), revision: 1 };
      // Preserve original optional/default omissions and every existing payload byte value.
      return { document: { ...(current as object), memoryLifecycle: lifecycle }, result: lifecycle };
    }, () => { observeMemoryAccountTime(storage.directory, clock); });
  }
  readCommittedForEffect(accountId: string, at: number | (() => number)): { status: 'ready'; document: AdaptiveDocument | null } | { status: 'busy' | 'unsupported' } {
    if (!this.storage.readCommittedForEffect) return { status: 'unsupported' };
    if (!/^telegram-account:[1-9]\d{0,15}$/.test(accountId)) throw new Error('Invalid adaptive account');
    const result = this.storage.readCommittedForEffect(accountId);
    if (result.status !== 'ready') return result;
    const now = typeof at === 'function' ? at() : at;
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid adaptive account');
    if (result.document === null) return { status: 'ready', document: null };
    const document = validateAdaptiveDocument(result.document, accountId, now);
    if (this.memoryAccountMarked()) {
      const storage = this.originalMemoryAccountFile();
      const observed = checkMemoryAccountTime(storage.directory, () => typeof at === 'function' ? at() : at);
      storage.assertMemoryAccountWork(accountId, document, currentMemoryAccountWork(), observed);
    }
    if(document.schemaVersion===3 && this.storage.canonicalSchemaVersion!==3)throw new Error('Prepared rights storage required');
    return { status: 'ready', document };
  }
  transaction<T>(accountId: string, at: number | (() => number), fn: (document: AdaptiveDocument, now: number) => T, beforeCommit?: () => void, existingOnly = false): Promise<T> {
    if (!/^telegram-account:[1-9]\d{0,15}$/.test(accountId) || typeof at !== 'function' && (!Number.isSafeInteger(at) || at < 0)) throw new Error('Invalid adaptive account');
    if (beforeCommit && this.storage.supportsCommittedWriteFence !== true) throw new Error('Committed write fence unsupported');
    if (this.memoryAccountMarked()) {
      if (!currentMemoryAccountWork()) throw new Error('Original memory account work required');
      // Marked accounts never serve cached complete documents as current authority.
      activeReadScope()?.noteWrite();
      return this.committed(accountId, at, fn, beforeCommit, true);
    }
    const scope = activeReadScope();
    if (scope && !beforeCommit) return this.served(scope, accountId, at, fn, existingOnly);
    // A fenced write inside a read scope is a real commit the scope cannot vouch for.
    if (scope) scope.noteWrite();
    return this.committed(accountId, at, fn, beforeCommit, existingOnly);
  }
  /** Starts the read-only load of an account in the active read scope; no-op outside one. */
  async preload(accountId: string): Promise<void> {
    const scope = activeReadScope(), load = committedLoader(this.storage);
    if (!scope || !load || !/^telegram-account:[1-9]\d{0,15}$/.test(accountId)) return;
    await scope.document(this.storage, accountId, () => load(accountId)).catch(() => undefined);
  }
  /** ARC only: bypasses read-scope drafts and selects the explicit FILE mutation seam. */
  assistantDeliveryTransaction<T>(accountId:string,at:()=>number,fn:(document:AdaptiveDocument,now:number)=>T):Promise<T>{
    if(!(this.storage instanceof FileAdaptiveStorage)||this.storage.constructor!==FileAdaptiveStorage)throw new Error('Original FILE required');
    return this.committed(accountId,at,fn,undefined,true,true);
  }
  private committed<T>(accountId: string, at: number | (() => number), fn: (document: AdaptiveDocument, now: number) => T, beforeCommit?: () => void, existingOnly = false, assistantMutation=false): Promise<T> {
    const transaction=assistantMutation?(this.storage as FileAdaptiveStorage).transactAssistantDeliveryControl.bind(this.storage):this.storage.transact.bind(this.storage);
    let committedLifecycle: MemoryLifecycle | undefined;
    return transaction(accountId, current => {
      // Sample after the backend acquires its serialization/lock and reads the
      // committed document. The same time drives validation and business expiry.
      const now = typeof at === 'function' ? this.storage.sampleClock?.(at) ?? at() : at;
      if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid adaptive account');
      if (existingOnly && current === null) throw new Error('Adaptive existing account required');
      const input = normalizeLegacyAdaptiveDocument(current, accountId, now);
      const draft = input === null ? create(accountId, now, this.storage.canonicalSchemaVersion ?? 1,this.storage.identity?digest([this.storage.identity.incarnation,this.storage.identity.generation]):undefined) : validateAdaptiveDocument(input, accountId, now);
      if(draft.schemaVersion===3 && this.storage.canonicalSchemaVersion!==3)throw new Error('Prepared rights storage required');
      const prior=structuredClone(draft);
      committedLifecycle = prior.memoryLifecycle;
      const result = fn(draft, now);
      assertAssistantDeliveryTransition(prior,draft,assistantMutation);
      validateAdaptiveDocument(draft, accountId, this.storage.sampleClock?.(() => typeof at === 'function' ? at() : at) ?? now);
      return { document: storedForm(draft), result };
    }, this.memoryAccountMarked() ? () => {
      const storage = this.originalMemoryAccountFile(), now = checkMemoryAccountTime(storage.directory, () => typeof at === 'function' ? at() : at);
      if (!committedLifecycle) throw new Error('Memory lifecycle required');
      const work = currentMemoryAccountWork();
      if (!work) throw new Error('Original memory account work required');
      assertMemoryAccountSource(committedLifecycle, memoryAccountWorkDetails(work).sourceDateSeconds, now);
      return beforeCommit?.();
    } : beforeCommit);
  }
  /** Inside a read scope: the same normalisation, validation and callback over
   * a committed copy (schema-parsed once per snapshot), without rewriting it.
   * A callback that changes the document, or a document that must first be
   * created or upgraded, commits through the ordinary transaction instead. */
  private async served<T>(scope: TurnReadScope, accountId: string, at: number | (() => number), fn: (document: AdaptiveDocument, now: number) => T, existingOnly: boolean): Promise<T> {
    const load = committedLoader(this.storage);
    if (!load) { scope.passThrough(); return this.committed(accountId, at, fn, undefined, existingOnly); }
    let loaded;
    try { loaded = await scope.document(this.storage, accountId, () => load(accountId)); }
    catch (error) {
      if (!(error instanceof CommittedReadBusy)) throw error;
      scope.passThrough(); return this.committed(accountId, at, fn, undefined, existingOnly);
    }
    const now = typeof at === 'function' ? this.storage.sampleClock?.(at) ?? at() : at;
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid adaptive account');
    if (existingOnly && loaded.value === null) throw new Error('Adaptive existing account required');
    if (loaded.value === null || normalizeLegacyAdaptiveDocument(loaded.value, accountId, now) !== loaded.value) return this.commitInScope(scope, accountId, at, fn, existingOnly);
    const parsed = memoized(loaded, 'adaptive:parsed', () => documentSchema.parse(loaded.value) as AdaptiveDocument);
    const canonical = memoized(loaded, 'adaptive:canonical', () => JSON.stringify(storedForm(parsed)));
    const draft = checkAdaptiveDocument(structuredClone(parsed), accountId, now);
    if (draft.schemaVersion === 3 && this.storage.canonicalSchemaVersion !== 3) throw new Error('Prepared rights storage required');
    const result = fn(draft, now);
    if (JSON.stringify(storedForm(draft)) !== canonical) return this.commitInScope(scope, accountId, at, fn, existingOnly);
    return result === undefined ? result : structuredClone(result);
  }
  /** Storage callbacks are retry safe, so rerunning `fn` for the commit is a retry. */
  private async commitInScope<T>(scope: TurnReadScope, accountId: string, at: number | (() => number), fn: (document: AdaptiveDocument, now: number) => T, existingOnly: boolean): Promise<T> {
    try { return await this.committed(accountId, at, fn, undefined, existingOnly); } finally { scope.committed(this.storage, accountId); }
  }
}
