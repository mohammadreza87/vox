import type { AdaptiveService } from './service';
import { containerIdFor, digest, spaceIdFor, tenantIdFor, type SpaceKind } from './repository';
import type { IndexedControlStamp, IndexedScope, RuntimeAuthorityReceipt } from './indexed/contracts';

export interface PrivateContextSnapshot {
  revision: string;
  /** Fresh synchronous export deadline, never a grant by itself. */
  validUntil?: number;
  memories: { id: string; text: string; sourceIds?: string[] }[];
  /** Indexed candidate/body limits are independent of the final prompt budget. */
  completion?: 'complete' | 'partial';
}
interface ControlState {
  allowed: boolean; revision: string; validUntil: number; scope: IndexedScope; stamp: Readonly<IndexedControlStamp>;
}
const unavailable = (): never => { throw new Error('Indexed private context unavailable'); };
const sameCatalog = (a: IndexedControlStamp, b: IndexedControlStamp) =>
  a.incarnation === b.incarnation && a.generation === b.generation &&
  a.catalogVersion === b.catalogVersion && a.catalogDigest === b.catalogDigest;

/** One synchronous metadata-first acquisition. No aggregate read, model call or
 * cached text; canonical grants and fresh code-owned capability policy both gate
 * candidate bodies. A retained revision covers unselected sources too. */
export function readIndexedPrivateContext(adaptive: AdaptiveService, telegramId: number, space: SpaceKind,
  agentId: string, query: string, authorityOnly = false): PrivateContextSnapshot {
  const indexed = adaptive.repository.storage.indexed;
  if (!indexed) return unavailable();
  const controls = (receipt?: RuntimeAuthorityReceipt): ControlState => {
    const result = adaptive.readRuntimeControlsForEffect(telegramId, space, (d, now, namespace, stamp) => {
      if (!stamp) return unavailable();
      const core = adaptive.capabilityStatus(d, 'core_text', now);
      const personalization = adaptive.capabilityStatus(d, 'personalization', now);
      const permission = d.permissions.find(p => p.spaceId === spaceIdFor(d.accountId, space) && p.purpose === 'optional.personalization')!;
      const allowed = adaptive.isCoreAllowed(d, now) && adaptive.isPurposeAllowed(d, space, 'optional.personalization', now, agentId);
      const scope: IndexedScope = { accountId: d.accountId, personId: d.personId, tenantId: tenantIdFor(d.accountId),
        space, spaceId: spaceIdFor(d.accountId, space), containerId: containerIdFor(d.accountId, space),
        agentId, purpose: 'optional.personalization' };
      if (receipt && (!allowed || !sameCatalog(stamp, receipt) || digest(scope) !== digest(receipt.scope))) return unavailable();
      const revision = digest(['indexed-private-context-v1', namespace, stamp, scope,
        adaptive.coreFingerprint(d, now), adaptive.purposeFingerprint(d, space, 'optional.personalization', now, agentId),
        allowed, receipt?.deadline ?? null]);
      const validUntil = allowed ? Math.min(d.binding!.expiresAt, permission.expiresAt, core.validUntil ?? Number.MAX_SAFE_INTEGER,
        personalization.validUntil ?? Number.MAX_SAFE_INTEGER, receipt?.deadline ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      return { value: { allowed, revision, validUntil, scope, stamp }, denied: !allowed, ...(allowed ? { deadline: validUntil } : {}) };
    });
    if (result.status !== 'ready') return unavailable();
    return result.value;
  };
  const initial = controls();
  if (!initial.allowed) return { revision: initial.revision, validUntil: initial.validUntil, memories: [], completion: 'complete' };
  const authority = indexed.readRuntimeAuthority(initial.scope);
  if (authority.status !== 'ready' || !sameCatalog(initial.stamp, authority.receipt)) return unavailable();
  const receipt = authority.receipt, before = controls(receipt);
  if (authorityOnly) return { revision: before.revision, validUntil: before.validUntil, memories: [], completion: 'complete' };
  const candidates = indexed.queryCandidateIds(initial.scope, query, receipt);
  if (candidates.status !== 'ready') return unavailable();
  // A query's native I/O may cross an external-policy boundary. Check it before
  // any private body is loaded, then again after bounded body I/O before export.
  if (controls(receipt).revision !== before.revision) return unavailable();
  const loaded = indexed.loadCandidateBodies(receipt, candidates.handles);
  if (loaded.status !== 'ready' || controls(receipt).revision !== before.revision) return unavailable();
  return { revision: before.revision, validUntil: before.validUntil,
    memories: loaded.bodies.map(({ handle, text, sourceIds }) => ({ id: handle.id, text, ...(sourceIds ? { sourceIds } : {}) })),
    completion: candidates.completion === 'partial' || loaded.completion === 'partial' ? 'partial' : 'complete' };
}
