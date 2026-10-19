import { containerIdFor, digest, spaceIdFor, tenantIdFor, type AdaptiveDocument, type SpaceKind } from '../persistence/repository';
import type { AdaptiveService } from '../persistence/service';
import type { PreferenceExplanation, StoredPreference } from '../runtime/contracts';
import type { PreferenceRecord, PreferenceScope } from './index';

export const PREFERENCE_UNDO_MS = 10 * 60_000;
/** An expired or replaced account confirmation can never restore an old choice. */
export function prunePreferenceUndo(d: AdaptiveDocument, now: number): void {
  if (!d.experience.preferenceUndo) return;
  const rows = d.experience.preferenceUndo.filter(row => row.expiresAt > now && row.createdAt <= now &&
    d.binding?.id === row.bindingId && d.binding.expiresAt > now &&
    d.experience.preferences.some(p => p.space === row.space && p.agentId === row.agentId && p.setting.key === row.key && digest(p) === row.afterFingerprint));
  if (rows.length) d.experience.preferenceUndo = rows; else delete d.experience.preferenceUndo;
}
/** All scope comes from the canonical account; old explicit rows are not
 * reclassified as inferred evidence. updatedAt dates the current revision. */
export function explicitPreferenceSnapshot(adaptive: AdaptiveService, d: AdaptiveDocument, space: SpaceKind, agentId: string, now: number) {
  const scope: PreferenceScope = { tenantId: tenantIdFor(d.accountId), spaceId: spaceIdFor(d.accountId, space),
    containerId: containerIdFor(d.accountId, space), personId: d.personId, agentId };
  const confirmed = adaptive.isProfileConfirmed(d, now);
  const saved: StoredPreference[] = confirmed ? d.experience.preferences.filter(p => p.space === space && p.agentId === agentId) : [];
  const allowed = adaptive.isPurposeAllowed(d, space, 'optional.personalization', now, agentId);
  const permission = d.permissions.find(p => p.id === `permission:${space}:optional.personalization`)!;
  const reason: PreferenceExplanation | undefined = permission.state !== 'granted' || permission.expiresAt <= now ? 'personalization_off'
    : !adaptive.capabilityStatus(d, 'personalization', now).eligible ? 'capability_unavailable'
      : !d.agentGrants.some(g => g.space === space && g.agentId === agentId && g.allowed) ? 'agent_grant_missing' : undefined;
  const records: PreferenceRecord[] = saved.map(p => ({ ...scope, schemaVersion: 1, id: p.id, revision: p.revision,
    createdAt: p.updatedAt, updatedAt: p.updatedAt, origin: 'explicit', status: p.status, setting: p.setting, evidenceEventIds: [] }));
  const undo = confirmed ? (d.experience.preferenceUndo ?? []).filter(row => row.space === space && row.agentId === agentId) : [];
  const contextReceipt = digest([adaptive.purposeFingerprint(d, space, 'optional.personalization', now, agentId), allowed,
    saved.map(p => [p.id, p.revision, p.status])]);
  const receipt = digest([contextReceipt, reason, saved, undo]);
  return { revision: d.revision, confirmed, scope, allowed, reason, records, saved, undo, contextReceipt, receipt, now };
}
