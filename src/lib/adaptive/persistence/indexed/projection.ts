import { productPauseUseControlsSchema } from '../../product-pause/contracts';
import { compactProductPause, productPauseUseStamp } from '../../product-pause/state';
import { z } from 'zod';
import { createHash } from 'crypto';
import { ADAPTIVE_POLICY_VERSION, OPTIONAL_PURPOSES, containerIdFor, digest, spaceIdFor, tenantIdFor,
  type AdaptiveDocument, type SpaceKind } from '../repository';
import { experienceDocumentSchema } from '../../runtime/contracts';
import { relationshipDocumentSchema } from '../../relationships/contracts';
import { normalizeRetrievalText } from '../../retrieval';
import { INDEXED_LIMITS, IndexedStorageError, type IndexedControls } from './contracts';
const time = z.number().int().nonnegative().safe(), revision = time.min(1), id = z.string().min(1).max(200);
const base = { schemaVersion: z.literal(1), id, revision, createdAt: time, updatedAt: time };
const binding = z.object({ ...base, accountId: id, personId: id, status: z.literal('verified'),
  method: z.literal('account_confirmation'), verifiedAt: time, expiresAt: time }).strict();
const permission = z.object({ ...base, tenantId: id, spaceId: id, personId: id, purpose: z.enum(OPTIONAL_PURPOSES),
  purposeVersion: z.literal(1), policyVersion: z.literal(ADAPTIVE_POLICY_VERSION),
  state: z.enum(['not_asked', 'presented', 'granted', 'declined', 'withdrawn', 'expired', 'reconsent_required', 'suspended']),
  epoch: time, effectiveAt: time, expiresAt: time, lastEventId: id.optional(), lastCommandFingerprint: z.string().max(3000).optional() }).strict();
const legacyIndexedControlsSchema = z.object({ schemaVersion: z.literal(1), accountId: id, personId: id, createdAt: time, revision, updatedAt: time,
  binding: binding.optional(), declaration: z.object({ adultConfirmed: z.boolean(), declaredAt: time,
    declaredJurisdiction: z.string().max(20).optional() }).strict().optional(),
  permissions: z.array(permission).length(16), agentGrants: z.array(z.object({ agentId: id,
    space: z.enum(['work', 'personal']), allowed: z.boolean(), revision, updatedAt: time }).strict()).max(100),
  preferences: experienceDocumentSchema.shape.preferences, settings: experienceDocumentSchema.shape.settings,
  predictionTurns: experienceDocumentSchema.shape.predictionTurns,
  preferenceLearning: experienceDocumentSchema.shape.preferenceLearning,
  relationshipControls: relationshipDocumentSchema.shape.controls,
  relationshipBindings: relationshipDocumentSchema.shape.bindings,
  relationshipSources: relationshipDocumentSchema.shape.sources,
  relationshipExternalSettings: relationshipDocumentSchema.shape.externalSettings }).strict();
export const indexedControlsSchema = z.union([legacyIndexedControlsSchema, legacyIndexedControlsSchema.extend({ schemaVersion: z.literal(2), productPause: productPauseUseControlsSchema }).strict()]);
export function validateAccountId(accountId: string): void {
  if (!/^telegram-account:[1-9]\d{0,15}$/.test(accountId) || !Number.isSafeInteger(Number(accountId.slice(17))))
    throw new IndexedStorageError('invalid_scope');
}
export const accountKey = (id: string): string => createHash('sha256').update(id).digest('hex');
export function parseControls(raw: unknown, accountId: string): IndexedControls {
  const parsed = indexedControlsSchema.safeParse(raw);
  if (!parsed.success) throw new IndexedStorageError('invalid_controls');
  const c = parsed.data as IndexedControls;
  validateAccountId(accountId);
  if (c.accountId !== accountId || c.personId !== `account-profile:${digest(accountId).slice(0, 32)}` ||
      new Set(c.permissions.map(p => p.id)).size !== 16 ||
      new Set(c.agentGrants.map(g => digest([g.space, g.agentId]))).size !== c.agentGrants.length ||
      new Set(c.preferences.map(p => digest([p.space, p.agentId, p.setting.key]))).size !== c.preferences.length ||
      new Set(c.relationshipControls.map(p => digest([p.space, p.agentId]))).size !== c.relationshipControls.length ||
      new Set(c.relationshipBindings.map(p => p.space)).size !== c.relationshipBindings.length ||
      c.relationshipBindings.some(b => b.accountId !== accountId || b.personId !== c.personId || b.confirmedAt > b.expiresAt) ||
      new Set(c.relationshipSources.map(s => digest([s.key.personaId, s.key.scope.space, s.id]))).size !== c.relationshipSources.length ||
      c.relationshipSources.some(s => s.key.scope.accountId !== accountId || s.key.scope.personId !== c.personId ||
        s.key.scope.tenantId !== tenantIdFor(accountId) || s.key.scope.spaceId !== spaceIdFor(accountId, s.key.scope.space) ||
        s.key.scope.containerId !== containerIdFor(accountId, s.key.scope.space) || s.key.audience.personId !== c.personId ||
        s.key.chatKey !== `private-${c.personId}`) ||
      c.binding && (c.binding.accountId !== accountId || c.binding.personId !== c.personId)) throw new IndexedStorageError('invalid_controls');
  for (const s of ['work', 'personal'] as const) for (const purpose of OPTIONAL_PURPOSES) {
    const p = c.permissions.find(row => row.id === `permission:${s}:${purpose}`);
    if (!p || p.spaceId !== spaceIdFor(accountId, s) || p.tenantId !== tenantIdFor(accountId) ||
        p.personId !== c.personId || p.purpose !== purpose) throw new IndexedStorageError('invalid_controls');
  }
  return c;
}
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'and', 'in', 'on', 'it', 'what', 'my', 'for', 'please',
  'از', 'به', 'در', 'را', 'و', 'است', 'من', 'این', 'آن', 'که', 'برای', 'چیست']);
export function lexicalTerms(text: string): string[] {
  return [...new Set(normalizeRetrievalText(text).match(/[\p{L}\p{N}]+/gu) ?? [])].filter(t => !STOP.has(t));
}
export interface MemoryMetadata {
  id: string; revision: number; space: SpaceKind; epoch: number; status: 'active' | 'deleted';
  createdAt: number; updatedAt: number; expiresAt: number; bodyPresent: boolean; bodyBytes: number;
  bodyDigest: string; origin?: 'user_reviewed_claim'; sourceRefs: { id: string; revision: number }[];
}
export interface IndexedProjection {
  canonical: string; controls: IndexedControls; controlsJson: string; controlsDigest: string;
  memories: { metadata: MemoryMetadata; metadataJson: string; text?: string; terms: string[] }[];
  catalogs: { space: SpaceKind; digest: string }[]; outbox: AdaptiveDocument['outbox'];
}
/** Caller supplies the complete validated document; no aggregate validators run
 * on a fabricated partial document. Canonical compatibility mutations still
 * reconstruct and validate the complete image in this first normalization stage. */
export function projectDocument(document: AdaptiveDocument, canonical: string): IndexedProjection {
  if (Buffer.byteLength(canonical) > INDEXED_LIMITS.canonicalBytes || document.memories.length > INDEXED_LIMITS.memories ||
      new Set(document.memories.map(m => m.id)).size !== document.memories.length) throw new IndexedStorageError('capacity');
  const c: IndexedControls = { schemaVersion: document.schemaVersion, ...(document.schemaVersion === 2 ? { productPause: compactProductPause(document.productPause!) } : {}), accountId: document.accountId, personId: document.personId,
    createdAt: document.createdAt, revision: document.revision, updatedAt: document.updatedAt, ...(document.binding ? { binding: document.binding } : {}),
    ...(document.declaration ? { declaration: document.declaration } : {}),
    permissions: document.permissions, agentGrants: document.agentGrants,
    preferences: document.experience.preferences, settings: document.experience.settings,
    predictionTurns: document.experience.predictionTurns,
    ...(document.experience.preferenceLearning ? { preferenceLearning: document.experience.preferenceLearning } : {}),
    relationshipControls: document.relationships.controls, relationshipBindings: document.relationships.bindings,
    relationshipSources: document.relationships.sources, relationshipExternalSettings: document.relationships.externalSettings };
  const controls = parseControls(c, document.accountId), controlsJson = JSON.stringify(controls);
  const memories = document.memories.map(m => {
    const text = m.status === 'active' && m.text?.trim() ? m.text : undefined;
    const metadata: MemoryMetadata = { id: m.id, revision: m.revision, space: m.space, epoch: m.revocationEpoch,
      status: m.status, createdAt: m.createdAt, updatedAt: m.updatedAt, expiresAt: m.expiresAt, bodyPresent: text !== undefined,
      bodyBytes: text === undefined ? 0 : Buffer.byteLength(text), bodyDigest: digest(text ?? null),
      ...(m.origin ? { origin: m.origin } : {}), sourceRefs: m.sourceRefs ?? [] };
    return { metadata, metadataJson: JSON.stringify(metadata), text, terms: text === undefined ? [] : lexicalTerms(text) };
  });
  const catalogs = (['work', 'personal'] as const).map(space => ({ space, digest: digest([
    controls.accountId, controls.personId, controls.createdAt, controls.binding, controls.declaration,
    controls.permissions.filter(p => p.spaceId === spaceIdFor(document.accountId, space)),
    controls.agentGrants.filter(g => g.space === space), controls.preferences.filter(p => p.space === space),
    controls.settings, controls.predictionTurns.filter(p => p.space === space),
    controls.preferenceLearning && Object.fromEntries(Object.entries(controls.preferenceLearning).map(([key, rows]) =>
      [key, Array.isArray(rows) ? rows.filter(row => row.space === space) : rows])),
    controls.relationshipControls.filter(c => c.space === space), controls.relationshipBindings.filter(b => b.space === space),
    controls.relationshipSources.filter(s => s.key.scope.space === space),
    [controls.relationshipExternalSettings.revision, controls.relationshipExternalSettings[space]],
    memories.filter(m => m.metadata.space === space).map(m => m.metadata), containerIdFor(document.accountId, space),
    ...(document.schemaVersion === 2 ? [productPauseUseStamp(controls, space)] : []),
  ]) }));
  return { canonical, controls, controlsJson, controlsDigest: digest(controls), memories, catalogs, outbox: document.outbox };
}
export const memoryMetadataSchema = z.object({ id, revision, space: z.enum(['work', 'personal']), epoch: time,
  status: z.enum(['active', 'deleted']), createdAt: time, updatedAt: time, expiresAt: time, bodyPresent: z.boolean(),
  bodyBytes: time.max(16_384), bodyDigest: z.string().regex(/^[a-f0-9]{64}$/), origin: z.literal('user_reviewed_claim').optional(),
  sourceRefs: z.array(z.object({ id, revision }).strict()).max(8)
    .refine(refs => new Set(refs.map(ref => ref.id)).size === refs.length) }).strict();
