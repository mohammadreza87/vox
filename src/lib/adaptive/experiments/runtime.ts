import { rightsUseStamp } from '../rights-use-holds/state';
import { productPauseUseStamp } from '../product-pause/state';
import { accountIdFor, tenantIdFor, type SpaceKind } from '../persistence/repository';
import type { AdaptiveService } from '../persistence/service';
import { canUseAgent } from '../../studio/permissions';
import type { StudioStorage } from '../../studio/store';
import { experimentExposureInputSchema, type ExperimentExposureInput, type ResponsePresentation } from './contracts';
import { ControlledExperimentService, experimentDigest, type ExperimentAuthority } from './service';
/** First consumption surface is a private Studio text response. Shared-container
 * allocation is supported by the controller, never inferred from private DMs. */
export class StudioExperimentRuntime {
  constructor(readonly controller: ControlledExperimentService, readonly adaptive: AdaptiveService,
    readonly store: StudioStorage, private readonly clock: () => number = Date.now, private readonly effectsEnabled = true) {}
  private scope(telegramId: number, space: SpaceKind) {
    if (!Number.isSafeInteger(telegramId) || telegramId < 1 || !['work', 'personal'].includes(space)) throw new Error('Invalid experiment scope');
    const accountId = accountIdFor(telegramId);
    return { kind: 'private_person' as const, tenantId: tenantIdFor(accountId), space, personId: `account-profile:${experimentDigest(accountId).slice(0, 32)}` };
  }
  /** Post-commit reconciliation; never reenters a canonical write transaction.
   * Busy authority/storage propagates so the caller can retry on its next read. */
  reconcileAccount(telegramId: number): void {
    this.controller.sweepDue(this.clock());
    for (const space of ['work', 'personal'] as const) {
      const read = this.adaptive.readDirectAuthorityForEffect(telegramId, space, (d, now, identity) => {
        const permissions = d.permissions.filter(p => p.spaceId.endsWith(`:${space}`) && ['optional.product_analytics', 'optional.personalization'].includes(p.purpose));
        // Pause suspends use; withdrawal/expiry/unconfirmed identity ends retention.
        const allowed = this.adaptive.isPurposeRetentionAllowed(d, space, 'optional.product_analytics', now) &&
          this.adaptive.isPurposeRetentionAllowed(d, space, 'optional.personalization', now);
        return { value: { allowed, revision: experimentDigest([d.schemaVersion===3?d.retentionStoreIdentity:identity, d.binding, permissions]) }, denied: !allowed };
      });
      if (read.status !== 'ready') throw new Error('Experiment reconciliation authority unavailable');
      const scope = this.scope(telegramId, space);
      if (!read.value.allowed) this.controller.purgeScope(scope, this.clock());
      else {
        if (this.controller.scopeRevisionChanged(scope, read.value.revision)) this.controller.purgeScope(scope, this.clock());
      }
    }
  }
  /** Management operations do not depend on optional consent or an active binding.
   * Their caller must authenticate this exact account before returning data. */
  purgeScope(telegramId: number, space: SpaceKind): void { this.controller.purgeScope(this.scope(telegramId, space), this.clock()); }
  exportScope(telegramId: number, space: SpaceKind) { return this.controller.exportScope(this.scope(telegramId, space), this.clock()); }
  prepareScopeExport(telegramId: number, space: SpaceKind) {
    const data = this.exportScope(telegramId, space), fingerprint = experimentDigest(data);
    return { data, revalidate: () => {
      if (experimentDigest(this.exportScope(telegramId, space)) !== fingerprint) throw new Error('Experiment export changed');
    } };
  }
  private authority(telegramId: number, agentId: string, space: SpaceKind): ExperimentAuthority | undefined {
    if (!this.effectsEnabled) return;
    if (!Number.isSafeInteger(telegramId) || telegramId < 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(agentId) || !['work', 'personal'].includes(space)) return;
    const state = this.store.readCommittedForEffect?.();
    if (!state) return;
    const members = state.members.filter(m => m.telegramId === telegramId), agents = state.agents.filter(a => a.id === agentId);
    if (members.length !== 1 || agents.length !== 1 || !canUseAgent(members[0], agents[0]) || (agents[0].blocked ?? []).includes(telegramId)) return;
    const studioStamp = experimentDigest([members[0].role, members[0].learningAuthorityRevision ?? 0,
      agents[0].learningAuthorityRevision ?? 0, agents[0].createdBy, agents[0].status, agents[0].visibility, agents[0].access, agents[0].blocked]);
    const read = this.adaptive.readDirectAuthorityForEffect(telegramId, space, (d, now, identity) => {
      const sampledAt = Math.max(now, this.clock());
      const allowed = this.adaptive.isPurposeAllowed(d, space, 'optional.product_analytics', sampledAt, agentId) &&
        this.adaptive.isPurposeAllowed(d, space, 'optional.personalization', sampledAt, agentId) &&
        this.adaptive.isStoredPersonalizationUseAllowed(d, space);
      const permissions = d.permissions.filter(p => p.spaceId.endsWith(`:${space}`) && ['optional.product_analytics', 'optional.personalization'].includes(p.purpose));
      const capabilities = (['product_analytics', 'personalization', 'core_text'] as const).map(c => this.adaptive.capabilityStatus(d, c, sampledAt));
      const expiresAt = Math.min(d.binding?.expiresAt ?? sampledAt, ...permissions.map(p => p.expiresAt), ...capabilities.map(c => c.validUntil ?? sampledAt));
      const value: ExperimentAuthority | undefined = allowed && capabilities.every(c => c.eligible) && expiresAt > sampledAt ? {
        scopeRevision: experimentDigest([d.schemaVersion===3?d.retentionStoreIdentity:identity, d.binding, permissions]),
        scope: { kind: 'private_person', tenantId: tenantIdFor(d.accountId), space, personId: d.personId }, expiresAt,
        revision: experimentDigest([identity, studioStamp, agentId, d.binding, permissions, d.agentGrants.filter(g => g.agentId === agentId && g.space === space),
          productPauseUseStamp(d, space), capabilities, ...(d.schemaVersion===3?[rightsUseStamp(d,space,'optional.personalization'),rightsUseStamp(d,space,'optional.product_analytics')]:[])]),
      } : undefined;
      return { value, denied: !value, ...(value ? { deadline: expiresAt } : {}) };
    });
    return read.status === 'ready' ? read.value : undefined;
  }
  private fence(telegramId: number, agentId: string, space: SpaceKind, expected: ExperimentAuthority): () => void {
    return () => { const fresh = this.authority(telegramId, agentId, space);
      if (!fresh || fresh.revision !== expected.revision || fresh.expiresAt <= this.clock()) throw new Error('Experiment authority changed'); };
  }
  async prepare(telegramId: number, agentId: string, space: SpaceKind, turnId: string): Promise<ResponsePresentation | undefined> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(turnId)) return;
    try {
      const authority = this.authority(telegramId, agentId, space); if (!authority) return;
      const presentation = this.controller.prepare(authority, { id: experimentDigest(['studio-text', agentId, space, turnId]), revision: 1 }, this.clock(), this.fence(telegramId, agentId, space, authority));
      return presentation && this.current(telegramId, agentId, space, presentation) ? presentation : undefined;
    } catch { return undefined; }
  }
  current(telegramId: number, agentId: string, space: SpaceKind, presentation: ResponsePresentation): boolean {
    try { const authority = this.authority(telegramId, agentId, space);
      return !!authority && this.controller.current(authority, presentation, this.clock()); } catch { return false; }
  }
  async acknowledge(telegramId: number, raw: ExperimentExposureInput): Promise<{ recorded: boolean; duplicate: boolean }> {
    const input = experimentExposureInputSchema.parse(raw), denied = { recorded: false, duplicate: false };
    try { const authority = this.authority(telegramId, input.agentId, input.space); if (!authority) return denied;
      return this.controller.expose(authority, input.receipt, this.clock(), this.fence(telegramId, input.agentId, input.space, authority));
    } catch { return denied; }
  }
}
