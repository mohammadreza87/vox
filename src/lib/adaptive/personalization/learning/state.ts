import { rightsUseStamp } from '../../rights-use-holds/state';
import { productPauseUseStamp } from '../../product-pause/state';
import { digest, type AdaptiveAuthorityDocument, type AdaptiveDocument, type SpaceKind } from '../../persistence/repository';
import type { AdaptiveService } from '../../persistence/service';
import { emptyLearning, LEARNING_TTL, type LearningIntent } from './contracts';
type Scope = { space: SpaceKind; agentId: string };
export function learningStudioFingerprint(adaptive: AdaptiveService, raw: string | null): string | null {
  return raw && adaptive.storeIdentity !== 'canonical' ? digest([raw, adaptive.storeIdentity]) : raw;
}
export function learningAuthority(adaptive: AdaptiveService, d: AdaptiveAuthorityDocument, scope: Scope, now: number, retention=false) {
  if (!adaptive.isCoreAllowed(d, now) || !(retention ? adaptive.isPurposeRetentionAllowed(d,scope.space,'optional.personalization',now,scope.agentId) : adaptive.isPurposeAllowed(d, scope.space, 'optional.personalization', now, scope.agentId))) return undefined;
  const permission = d.permissions.find(p => p.id === `permission:${scope.space}:optional.personalization`)!,
    grant = d.agentGrants.find(g => g.space === scope.space && g.agentId === scope.agentId && g.allowed)!;
  if (adaptive.storeIdentity !== 'canonical' && permission.effectiveAt > now) return undefined;
  return { ...(d.schemaVersion===3?{rightsUseStamp:rightsUseStamp(d,scope.space,'optional.personalization')}:{}), ...(d.schemaVersion >= 2 ? { productPauseUseStamp: productPauseUseStamp(d, scope.space) } : {}), personId: d.personId, bindingId: d.binding!.id, permissionRevision: permission.revision, consentEpoch: permission.epoch,
    grantRevision: grant.revision, expiresAt: Math.min(d.binding!.expiresAt, permission.expiresAt,
      adaptive.capabilityStatus(d, 'personalization', now).validUntil ?? now, adaptive.capabilityStatus(d, 'core_text', now).validUntil ?? now),
    fingerprint: digest(adaptive.storeIdentity !== 'canonical'
      ? [adaptive.purposeFingerprint(d, scope.space, 'optional.personalization', now, scope.agentId), adaptive.coreFingerprint(d, now), adaptive.storeIdentity]
      : [adaptive.purposeFingerprint(d, scope.space, 'optional.personalization', now, scope.agentId), adaptive.coreFingerprint(d, now)]) };
}
export function sameLearningAuthority(row: Pick<LearningIntent, 'personId' | 'bindingId' | 'permissionRevision' | 'consentEpoch' | 'grantRevision' | 'expiresAt' | 'productPauseUseStamp' | 'rightsUseStamp'>,
  authority: ReturnType<typeof learningAuthority>, now: number) {
  return !!authority && row.expiresAt > now && authority.expiresAt > now && row.personId === authority.personId && row.bindingId === authority.bindingId &&
    row.rightsUseStamp === authority.rightsUseStamp && row.productPauseUseStamp === authority.productPauseUseStamp && row.permissionRevision === authority.permissionRevision && row.consentEpoch === authority.consentEpoch && row.grantRevision === authority.grantRevision;
}
function sameRetainedLearningAuthority(row:Parameters<typeof sameLearningAuthority>[0],authority:ReturnType<typeof learningAuthority>,now:number) {
 return !!authority && row.expiresAt>now && authority.expiresAt>now && row.personId===authority.personId && row.bindingId===authority.bindingId && row.permissionRevision===authority.permissionRevision && row.consentEpoch===authority.consentEpoch && row.grantRevision===authority.grantRevision;
}
export function suppressLearningScope(d: AdaptiveDocument, scope: Scope, now: number, evidenceIds: string[] = []) {
  const learning = d.experience.preferenceLearning;
  if (!learning) return;
  const ids = new Set([...evidenceIds, ...learning.candidates.filter(c => c.space === scope.space && c.agentId === scope.agentId).flatMap(c => c.evidenceIds),
    ...d.experience.predictionTurns.filter(t => t.space === scope.space && t.agentId === scope.agentId && t.learningEvidenceId).map(t => t.learningEvidenceId!)]);
  for (const evidenceId of ids) if (!learning.suppressions.some(s => s.space === scope.space && s.agentId === scope.agentId && s.evidenceId === evidenceId) && learning.suppressions.length < 200) {
    learning.suppressions.push({ space: scope.space, agentId: scope.agentId, evidenceId, createdAt: now, expiresAt: now + LEARNING_TTL });
  }
  // Revision is an additional ABA barrier even when a suppression list is full.
  // No existing unexpired tombstone is evicted to admit more learning work.
  for (const intent of learning.intents.filter(i => i.space === scope.space && i.agentId === scope.agentId)) intent.revision++;
  learning.candidates = learning.candidates.filter(c => c.space !== scope.space || c.agentId !== scope.agentId);
}
export function pruneLearningDocument(adaptive: AdaptiveService, d: AdaptiveDocument, now: number, studioAuthority?: (agentId: string) => string | null): boolean {
  const learning = d.experience.preferenceLearning;
  if (!learning) return false;
  const before = digest(learning);
  const studioMatches = (row: { agentId: string; studioFingerprint: string; retentionStoreIdentity?:string }) => {
    if (!studioAuthority) return true; // Unwired legacy backend cannot view/use learning.
    try { const raw=studioAuthority(row.agentId),identity=d.schemaVersion===3?row.retentionStoreIdentity:adaptive.storeIdentity;
      if(!identity)return false;return (raw && identity!=='canonical'?digest([raw,identity]):raw)===row.studioFingerprint; } catch { return false; }
  };
  learning.suppressions = learning.suppressions.filter(s => s.expiresAt > now);
  for (const intent of [...learning.intents]) if (!studioMatches(intent) || !sameRetainedLearningAuthority(intent, learningAuthority(adaptive, d, intent, now,true), now)) {
    suppressLearningScope(d, intent, now);
    learning.intents = learning.intents.filter(i => i !== intent);
  }
  learning.presentations = learning.presentations.filter(p => studioMatches(p) && sameRetainedLearningAuthority(p, learningAuthority(adaptive, d, p, now,true), now));
  learning.candidates = learning.candidates.filter(c => studioMatches(c) && c.expiresAt > now && sameRetainedLearningAuthority(c, learningAuthority(adaptive, d, c, now,true), now) &&
    learning.intents.some(i => i.id === c.intentId && i.revision === c.intentRevision) && !c.evidenceIds.some(id => learning.suppressions.some(s => s.evidenceId === id && s.space === c.space && s.agentId === c.agentId)));
  if (!learning.intents.length && !learning.presentations.length && !learning.candidates.length && !learning.suppressions.length) delete d.experience.preferenceLearning;
  return before !== digest(d.experience.preferenceLearning ?? emptyLearning());
}
