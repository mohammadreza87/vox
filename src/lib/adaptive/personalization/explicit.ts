import { rightsUseAllowed } from '../rights-use-holds/state';
import { containerIdFor, digest, spaceIdFor, tenantIdFor, type AdaptiveAuthorityDocument, type AdaptiveDocument, type SpaceKind } from '../persistence/repository';
import { AdaptiveError, type AdaptiveService } from '../persistence/service';
import type { PreferenceExplanation, StoredPreference, PreferenceInput } from '../runtime/contracts';
import { suppressLearningScope } from './learning/state';
import type { PreferenceRecord, PreferenceScope } from './index';

export const PREFERENCE_UNDO_MS = 10 * 60_000;
/** Shared synchronous write: reviewed Use and ordinary controls have identical
 * absence/reset preserving Undo semantics inside their own canonical transaction. */
export function applyExplicitPreference(d: AdaptiveDocument, input: PreferenceInput, now: number): void {
  const prior = d.experience.preferences.find(p => p.space === input.space && p.agentId === input.agentId && p.setting.key === input.setting.key);
  if (!prior && d.experience.preferences.length >= 120) throw new AdaptiveError(409, 'storage_capacity');
  const before = prior ? structuredClone(prior) : null;
  suppressLearningScope(d, input, now);
  if (prior) { prior.setting = input.setting; prior.status = input.action === 'reset' ? 'reset' : 'active'; prior.updatedAt = now; prior.revision++; }
  else d.experience.preferences.push({ id: input.eventId, revision: 1, space: input.space, agentId: input.agentId,
    setting: input.setting, status: input.action === 'reset' ? 'reset' : 'active', updatedAt: now });
  const after = d.experience.preferences.find(p => p.space === input.space && p.agentId === input.agentId && p.setting.key === input.setting.key)!;
  const undo = (d.experience.preferenceUndo ?? []).filter(row => row.space !== input.space || row.agentId !== input.agentId || row.key !== input.setting.key);
  if (undo.length >= 120) throw new AdaptiveError(409, 'storage_capacity');
  undo.push({ changeId: input.eventId, space: input.space, agentId: input.agentId, key: input.setting.key, before,
    afterFingerprint: digest(after), bindingId: d.binding!.id, createdAt: now, expiresAt: Math.min(now + PREFERENCE_UNDO_MS, d.binding!.expiresAt) });
  d.experience.preferenceUndo = undo;
}
/** An expired or replaced account confirmation can never restore an old choice. */
export function prunePreferenceUndo(d: AdaptiveDocument, now: number): void {
  if (!d.experience.preferenceUndo) return;
  const rows = d.experience.preferenceUndo.filter(row => row.expiresAt > now && row.createdAt <= now &&
    d.binding?.id === row.bindingId && d.binding.expiresAt > now &&
    d.experience.preferences.some(p => p.space === row.space && p.agentId === row.agentId && p.setting.key === row.key && digest(p) === row.afterFingerprint));
  if (rows.length) d.experience.preferenceUndo = rows; else delete d.experience.preferenceUndo;
}
/** Pure enum context needs authority and preferences, never memory bodies,
 * mutation ledgers or a fabricated partial AdaptiveDocument. */
export type ExplicitPreferenceControls = AdaptiveAuthorityDocument & Pick<AdaptiveDocument, 'revision'> & {
  experience: Pick<AdaptiveDocument['experience'], 'preferences'>;
};
/** All scope comes from current server controls; old explicit rows are not
 * reclassified as inferred evidence. updatedAt dates the current revision. */
export function explicitPreferenceContextSnapshot(adaptive: AdaptiveService, d: ExplicitPreferenceControls, space: SpaceKind, agentId: string, now: number, storeIdentity?: string) {
  const scope: PreferenceScope = { tenantId: tenantIdFor(d.accountId), spaceId: spaceIdFor(d.accountId, space),
    containerId: containerIdFor(d.accountId, space), personId: d.personId, agentId };
  const confirmed = adaptive.isProfileConfirmed(d, now);
  const saved: StoredPreference[] = confirmed ? d.experience.preferences.filter(p => p.space === space && p.agentId === agentId) : [];
  const allowed = adaptive.isPurposeAllowed(d, space, 'optional.personalization', now, agentId);
  const permission = d.permissions.find(p => p.id === `permission:${space}:optional.personalization`)!;
  const reason: PreferenceExplanation | undefined = !adaptive.isStoredPersonalizationUseAllowed(d,space) ? 'product_personalization_paused' : !rightsUseAllowed(d,space,'optional.personalization') ? 'rights_use_restricted' : permission.state !== 'granted' || permission.expiresAt <= now ? 'personalization_off'
    : !adaptive.capabilityStatus(d, 'personalization', now).eligible ? 'capability_unavailable'
      : !d.agentGrants.some(g => g.space === space && g.agentId === agentId && g.allowed) ? 'agent_grant_missing' : undefined;
  const records: PreferenceRecord[] = saved.map(p => ({ ...scope, schemaVersion: 1, id: p.id, revision: p.revision,
    createdAt: p.updatedAt, updatedAt: p.updatedAt, origin: 'explicit', status: p.status, setting: p.setting, evidenceEventIds: [] }));
  const context = [adaptive.purposeFingerprint(d, space, 'optional.personalization', now, agentId), allowed,
    saved.map(p => [p.id, p.revision, p.status])];
  const contextReceipt = digest(storeIdentity === undefined || storeIdentity === 'canonical' ? context : [storeIdentity, ...context]);
  return { revision: d.revision, confirmed, scope, allowed, reason, records, saved, contextReceipt, now };
}
/** Detailed controls and Undo still read the canonical document. FILE receipts
 * retain their original bytes; managed receipts bind the same store namespace. */
export function explicitPreferenceSnapshot(adaptive: AdaptiveService, d: AdaptiveDocument, space: SpaceKind, agentId: string, now: number) {
  const context = explicitPreferenceContextSnapshot(adaptive, d, space, agentId, now,
    adaptive.storeIdentity !== 'canonical' ? adaptive.storeIdentity : undefined);
  const undo = context.confirmed ? (d.experience.preferenceUndo ?? []).filter(row => row.space === space && row.agentId === agentId) : [];
  const receipt = digest([context.contextReceipt, context.reason, context.saved, undo]);
  return { ...context, undo, receipt };
}
