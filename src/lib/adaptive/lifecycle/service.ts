import { accountIdFor, digest, type AdaptiveDocument, type SpaceKind } from '../persistence/repository';
import { AdaptiveError, type AdaptiveService } from '../persistence/service';
import { AdaptiveExperienceService } from '../runtime/service';
import { AdaptiveRelationshipService } from '../relationships/service';
import type { SharedMemoryService } from '../shared/service';
import { z } from 'zod';
import type { ObserverDocument } from '../observation/contracts';

export interface LifecycleOptions {
  shared?: SharedMemoryService;
  /** Called within the authoritative transaction, before export/recovery projection. */
  pruneObserver?: (document: AdaptiveDocument, now: number) => void;
}
const fail = (status: number, code: string): never => { throw new AdaptiveError(status, code); };
function selectedSpace(space: SpaceKind): void {
  if (space !== 'work' && space !== 'personal') fail(400, 'invalid_space');
}

/** Account rights never accept account/person IDs from request bodies. Callers pass
 * the Telegram identity established by server authentication. No export is persisted. */
export class AdaptiveLifecycleService {
  private readonly experience: AdaptiveExperienceService;
  private readonly relationships: AdaptiveRelationshipService;
  constructor(readonly adaptive: AdaptiveService, readonly options: LifecycleOptions = {}) {
    this.experience = new AdaptiveExperienceService(adaptive);
    this.relationships = new AdaptiveRelationshipService(adaptive);
  }
  private prune(d: AdaptiveDocument, now: number): void {
    const before = digest([d.experience, d.relationships, d.receipts]);
    this.experience.pruneDocument(d, now);
    this.relationships.pruneDocument(d, now);
    d.receipts = d.receipts.filter(r => r.expiresAt > now);
    this.options.pruneObserver?.(d, now);
    if (before !== digest([d.experience, d.relationships, d.receipts])) { d.revision++; d.updatedAt = now; }
  }
  async exportAccount(telegramId: number, space: SpaceKind) {
    selectedSpace(space);
    const own = await this.adaptive.withAccountDocument(telegramId, (d, now) => {
      if (!this.adaptive.isProfileConfirmed(d, now)) fail(403, 'profile_confirmation_required');
      this.prune(d, now);
      const observer = (d as AdaptiveDocument & { observer?: ObserverDocument }).observer;
      const observerEvents = (observer?.events ?? []).filter(e => e.space === space && e.expiresAt > now &&
        this.adaptive.isPurposeAllowed(d, space, 'optional.product_analytics', now, e.agentId));
      return { schemaVersion: 1 as const, accountId: d.accountId, space, generatedAt: now,
        revision: d.revision, confirmedUntil: d.binding!.expiresAt,
        memories: d.memories.filter(m => m.space === space && m.status === 'active' && m.expiresAt > now)
          .map(m => ({ id: m.id, revision: m.revision, text: m.text!, createdAt: m.createdAt, expiresAt: m.expiresAt })),
        preferences: d.experience.preferences.filter(p => p.space === space).map(p => ({ id: p.id, revision: p.revision,
          agentId: p.agentId, setting: p.setting, status: p.status, updatedAt: p.updatedAt })),
        preferenceChanges: (d.experience.preferenceUndo ?? []).filter(p => p.space === space).map(p => ({
          changeId: p.changeId, agentId: p.agentId, key: p.key, createdAt: p.createdAt, expiresAt: p.expiresAt,
          previous: p.before ? { setting: p.before.setting, status: p.before.status } : null,
        })),
        preferenceLearning: d.experience.preferenceLearning ? {
          version: d.experience.preferenceLearning.version,
          intents: d.experience.preferenceLearning.intents.filter(i => i.space === space).map(({ agentId, createdAt, expiresAt }) => ({ agentId, createdAt, expiresAt })),
          candidates: d.experience.preferenceLearning.candidates.filter(c => c.space === space).map(({ id, agentId, setting, reason, evidenceIds, createdAt, expiresAt }) => ({ id, agentId, setting, reason, evidenceIds, createdAt, expiresAt })),
          suppressions: d.experience.preferenceLearning.suppressions.filter(s => s.space === space).map(({ agentId, evidenceId, createdAt, expiresAt }) => ({ agentId, evidenceId, createdAt, expiresAt })),
        } : null,
        purposes: d.permissions.filter(p => p.id.startsWith(`permission:${space}:`)).map(p => ({ purpose: p.purpose,
          state: p.state, revision: p.revision, epoch: p.epoch, effectiveAt: p.effectiveAt, expiresAt: p.expiresAt })),
        agents: d.agentGrants.filter(g => g.space === space).map(g => ({ agentId: g.agentId, allowed: g.allowed, revision: g.revision })),
        settings: { ...d.experience.settings[space], timezone: d.experience.settings.timezone,
          dailyCap: d.experience.settings.dailyCap, quietStartHour: d.experience.settings.quietStartHour,
          quietEndHour: d.experience.settings.quietEndHour },
        reminders: d.experience.inbox.filter(i => i.space === space && i.status !== 'cancelled' && i.expiresAt > now)
          .map(i => ({ id: i.id, agentId: i.agentId, category: i.category, label: i.label, status: i.status,
            createdAt: i.createdAt, dueAt: i.dueAt, expiresAt: i.expiresAt })),
        observations: d.experience.observations.filter(o => o.space === space).map(o => ({ agentId: o.agentId,
          channel: o.channel, status: o.status, durationMs: o.durationMs, at: o.at })),
        checkIns: d.relationships.inbox.filter(i => i.key.scope.space === space && i.status !== 'cancelled' && i.expiresAt > now)
          .map(i => ({ id: i.id, agentId: i.key.personaId, text: i.text, status: i.status, createdAt: i.createdAt, expiresAt: i.expiresAt })),
        observerEvents: observerEvents.map(e => ({ agentId: e.agentId, trust: e.trust, channel: e.channel,
          outcome: e.outcome, durationMs: e.durationMs, occurredAt: e.occurredAt, expiresAt: e.expiresAt, state: e.state })),
      };
    });
    // Existing shared service applies current membership, group revision, resource
    // publication, recipient and grant checks. Private account stores are never scanned.
    const shared = this.options.shared ? await this.options.shared.list(telegramId, space) : undefined;
    const contributions = (shared?.containers ?? []).flatMap(c => c.memories.map(m => ({
      containerId: c.id, id: m.id, revision: m.revision, text: m.text, createdAt: m.createdAt, expiresAt: m.expiresAt,
    })));
    const checkPrivateAccount = () => this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.prune(d, now);
      if (!this.adaptive.isProfileConfirmed(d, now) || d.revision !== own.revision || d.binding!.expiresAt !== own.confirmedUntil) fail(409, 'export_authority_changed');
    });
    if (shared) await this.options.shared!.revalidateExport(telegramId, space, shared, checkPrivateAccount);
    else await checkPrivateAccount();
    return { ...own, sharedContributions: contributions,
      coverage: { privateAccount: 'included' as const, shared: shared ? 'authorized_published_only' as const : 'not_configured' as const,
        providers: 'unavailable' as const, backups: 'unavailable' as const } };
  }
  /** Runs without profile confirmation or feature activation; uses existing expiry,
   * revocation and lineage invalidation in AdaptiveService's transaction. */
  sweepAccount(telegramId: number): Promise<void> {
    return this.adaptive.withAccountDocument(telegramId, (d, now) => { this.prune(d, now); });
  }
  async sweepShared(): Promise<void> {
    const shared = this.options.shared;
    if (shared) await shared.repository.transaction(d => { shared.pruneDocument(d); });
  }

  /** Backup reconciliation requires an independently preserved live authority
   * aggregate. It never imports old permissions, bindings, queues or payloads.
   * Snapshot-only disaster recovery must remain offline until authority is restored. */
  async reconcileSnapshot(telegramId: number, snapshot: unknown) {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) fail(401, 'authentication_required');
    await this.adaptive.repository.storage.transact(accountIdFor(telegramId), current => {
      if (current === null) fail(409, 'recovery_authority_unavailable');
      return { document: current, result: undefined };
    });
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.prune(d, now);
      const parsed = z.object({ accountId: z.string(), revision: z.number().int().nonnegative().safe(),
        memories: z.array(z.object({ id: z.string().min(1).max(200) }).passthrough()).max(300),
      }).passthrough().safeParse(snapshot);
      if (!parsed.success || parsed.data.accountId !== d.accountId) return fail(400, 'invalid_recovery_snapshot');
      if (parsed.data.revision > d.revision) return fail(409, 'recovery_authority_unavailable');
      const rows = parsed.data.memories;
      const accepted: string[] = [], suppressed: string[] = [];
      for (const row of rows) {
        const current = d.memories.find(m => m.id === row.id);
        // Even matching IDs are not enough: current content/revision and expiry win.
        if (current?.status === 'active' && current.expiresAt > now && digest(current) === digest(row)) accepted.push(current.id);
        else suppressed.push(row.id as string);
      }
      return { schemaVersion: 1 as const, authorityRevision: d.revision, acceptedMemoryIds: accepted,
        suppressedMemoryIds: suppressed, importedPayloads: 0 as const, permissions: 'current_authority_only' as const,
        providerDeletion: 'unverified' as const, backupDeletion: 'unverified' as const };
    });
  }
}
