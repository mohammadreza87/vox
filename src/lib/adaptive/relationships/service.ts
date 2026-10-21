import { rightsUseAllowed, rightsUseStamp } from '../rights-use-holds/state';
import { productPauseUseStamp } from '../product-pause/state';
import { randomUUID } from 'crypto';
import type { RelationshipKey } from '../../relationships/types';
import { isQuietHour, isSelectedTimezone } from '../notifications';
import { AdaptiveError, AdaptiveService } from '../persistence/service';
import { containerIdFor, digest, spaceIdFor, tenantIdFor, type AdaptiveAuthorityDocument, type AdaptiveDocument, type OptionalPurpose, type SpaceKind } from '../persistence/repository';
import { scopedRelationshipKeySchema, type RelationshipInboxItem, type RelationshipPermit, type RelationshipPhase, type RelationshipSource } from './contracts';

type RelationshipAuthority = AdaptiveAuthorityDocument & {
  experience: Pick<AdaptiveDocument['experience'], 'settings'>;
  relationships: Pick<AdaptiveDocument['relationships'], 'bindings' | 'controls' | 'sources' | 'externalSettings'>;
};

const DAY = 86_400_000;
const PURPOSES: OptionalPurpose[] = ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions'];
const validId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 200;
const sameKey = (a: RelationshipKey, b: RelationshipKey) => digest(a) === digest(b);
const telegramFor = (key: RelationshipKey): number | null => {
  const parsed = scopedRelationshipKeySchema.safeParse(key);
  if (!parsed.success) return null;
  const match = /^telegram-account:([1-9]\d{0,15})$/.exec(parsed.data.scope.accountId);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

/** Private authority and delivery aggregate. All mutators run in the same account
 * transaction as current identity, consent, source tombstones and agent grants. */
export class AdaptiveRelationshipService {
  constructor(readonly adaptive: AdaptiveService, private readonly options: { now?: () => number } = {}) {}
  pruneDocument(d: AdaptiveDocument, now: number): void {
    for (const source of d.relationships.sources) if (source.status === 'active' && source.expiresAt <= now) { source.status = 'deleted'; source.revision++; }
    for (const item of d.relationships.inbox) if (item.expiresAt <= now || item.sourceIds.some(id => !d.relationships.sources.some(s => s.id === id && sameKey(s.key, item.key) && s.status === 'active' && s.expiresAt > now))) {
      item.status = 'cancelled'; item.text = '';
    }
    // Source time is caller-authenticated and capture rejects events older than90d;
    // after this retention boundary an expired source cannot be recreated by replay.
    d.relationships.sources = d.relationships.sources.filter(s => s.expiresAt > now);
    // No reserved/unknown receipt is ever retried, even after its budget window.
    // Keep receipts for 90 days; the intent itself expires much earlier.
    d.relationships.ledger = d.relationships.ledger.filter(e => e.at > now - 90 * DAY);
    d.relationships.inbox = d.relationships.inbox.filter(i => i.expiresAt > now || i.createdAt > now - DAY);
  }
  private purposeAllowed(d: AdaptiveAuthorityDocument, agentId: string, space: SpaceKind, purpose: OptionalPurpose, now: number): boolean {
    const permission = d.permissions.find(p => p.spaceId === spaceIdFor(d.accountId, space) && p.purpose === purpose);
    const capability = purpose === 'optional.relationship_outreach' ? 'relationship_outreach' : purpose === 'optional.auto_memory' ? 'auto_memory' : purpose === 'optional.personalization' ? 'personalization' : 'proactive_suggestions';
    const grants = d.agentGrants.filter(g => g.agentId === agentId && g.space === space);
    return !!permission && permission.state === 'granted' && permission.effectiveAt <= now && permission.expiresAt > now &&
      grants.length === 1 && grants[0].allowed && this.adaptive.capabilityStatus(d, capability, now).eligible;
  }
  private permit(d: RelationshipAuthority, agentId: string, space: SpaceKind, now: number, retained = false, retentionStoreIdentity?:string): RelationshipPermit | null {
    if (!retained && (!this.adaptive.isStoredPersonalizationUseAllowed(d, space) || !rightsUseAllowed(d,space,'optional.personalization'))) return null;
    const bindings = d.relationships.bindings.filter(b => b.space === space);
    const binding = bindings.length === 1 ? bindings[0] : null;
    if (!validId(agentId) || !['work', 'personal'].includes(space) || !this.adaptive.capabilityStatus(d, 'core_text', now).eligible || !binding || binding.status !== 'active' || binding.expiresAt <= now || binding.confirmedAt > now || binding.accountId !== d.accountId || binding.personId !== d.personId ||
        PURPOSES.some(p => !this.purposeAllowed(d, agentId, space, p, now))) return null;
    const scope = { schemaVersion: 1 as const, accountId: d.accountId, personId: d.personId, bindingId: binding.id,
      tenantId: tenantIdFor(d.accountId), space, spaceId: spaceIdFor(d.accountId, space), containerId: containerIdFor(d.accountId, space) };
    const key: RelationshipKey = { personaId: agentId, chatKey: `private-${d.personId}`, audience: { kind: 'private', personId: d.personId }, scope };
    const sourceAuthority = [scope, binding, this.adaptive.capabilityStatus(d, 'core_text', now), PURPOSES.map(p => [d.permissions.find(c => c.spaceId === scope.spaceId && c.purpose === p), this.adaptive.capabilityStatus(d, p === 'optional.auto_memory' ? 'auto_memory' : p === 'optional.personalization' ? 'personalization' : 'proactive_suggestions', now)]), d.agentGrants.filter(g => g.space === space && g.agentId === agentId)];
    // Preserve original FILE hashes; managed receipts bind each store incarnation.
    const sourceNamespace=retained && d.schemaVersion===3 ? retentionStoreIdentity : this.adaptive.storeIdentity;
    if(!sourceNamespace)return null;
    const sourceFence = digest(sourceNamespace !== 'canonical' ? [...sourceAuthority, sourceNamespace] : sourceAuthority);
    const settings = d.experience.settings;
    const external = d.relationships.externalSettings;
    const fingerprint = digest([sourceFence, settings, external, d.relationships.controls.filter(c => c.agentId === agentId && c.space === space), [d.permissions.find(p => p.spaceId === scope.spaceId && p.purpose === 'optional.relationship_outreach'), this.adaptive.capabilityStatus(d, 'relationship_outreach', now)], ...(d.schemaVersion >= 2 ? [productPauseUseStamp(d, space)] : []), ...(d.schemaVersion===3?[rightsUseStamp(d,space,'optional.personalization')]:[])]);
    const expiry = [binding.expiresAt, ...PURPOSES.map(p => d.permissions.find(c => c.spaceId === scope.spaceId && c.purpose === p)!.expiresAt),
      ...(['core_text', 'auto_memory', 'personalization', 'proactive_suggestions'] as const).map(c => this.adaptive.capabilityStatus(d, c, now).validUntil ?? now)];
    return { key, fingerprint, sourceFence, expiresAt: Math.min(...expiry), notification: { settingsRevision: settings.revision,
      timezone: settings.timezone, dailyCap: settings.dailyCap, quietStartHour: settings.quietStartHour, quietEndHour: settings.quietEndHour,
      inboxEnabled: settings[space].inboxEnabled, proactiveEnabled: settings[space].proactiveEnabled,
      externalEnabled: external[space] && this.purposeAllowed(d, agentId, space, 'optional.relationship_outreach', now) } };
  }
  private authorized(d: RelationshipAuthority, key: RelationshipKey, sourceIds: readonly string[], phase: RelationshipPhase, now: number, expected?: string): RelationshipPermit | null {
    const parsed = scopedRelationshipKeySchema.safeParse(key);
    if (!parsed.success || parsed.data.scope.accountId !== d.accountId || !sourceIds.every(validId) || sourceIds.length > 256 || new Set(sourceIds).size !== sourceIds.length) return null;
    const permit = this.permit(d, key.personaId, parsed.data.scope.space, now);
    if (!permit || !sameKey(permit.key, key) || (expected !== undefined && permit.fingerprint !== expected)) return null;
    for (const id of sourceIds) {
      const matches = d.relationships.sources.filter(s => s.id === id && sameKey(s.key, key));
      if (matches.length !== 1 || matches[0].status !== 'active' || matches[0].expiresAt <= now || matches[0].createdAt > now || matches[0].sourceFence !== this.permit(d,key.personaId,parsed.data.scope.space,now,true,matches[0].retentionStoreIdentity)?.sourceFence) return null;
    }
    const control = d.relationships.controls.find(c => c.agentId === key.personaId && c.space === parsed.data.scope.space);
    if (phase !== 'context' && control && (control.disabled || (control.pausedUntil !== undefined && control.pausedUntil > now))) return null;
    if (phase === 'inbox' || phase === 'external') {
      if (!sourceIds.length || !permit.notification.inboxEnabled || !permit.notification.proactiveEnabled) return null;
    }
    if (phase === 'external' && (!permit.notification.externalEnabled || !isSelectedTimezone(permit.notification.timezone) ||
        isQuietHour(now, permit.notification.timezone, permit.notification.quietStartHour, permit.notification.quietEndHour))) return null;
    const sourceDeadlines = sourceIds.map(id => d.relationships.sources.find(s => s.id === id && sameKey(s.key, key))!.expiresAt);
    const externalDeadlines = phase === 'external' ? [
      d.permissions.find(p => p.spaceId === parsed.data.scope.spaceId && p.purpose === 'optional.relationship_outreach')!.expiresAt,
      this.adaptive.capabilityStatus(d, 'relationship_outreach', now).validUntil ?? now,
    ] : [];
    return { ...permit, expiresAt: Math.min(permit.expiresAt, ...sourceDeadlines, ...externalDeadlines) };
  }
  /** Source retention is independent of a temporary use stop or a stale task receipt. */
  async synchronize(key: RelationshipKey, sourceIds: readonly string[]): Promise<'suspended_use' | 'invalid_source'> {
    const telegramId = telegramFor(key); if (telegramId === null) return 'invalid_source';
    const space = scopedRelationshipKeySchema.parse(key).scope.space;
    const evaluate = (d: RelationshipAuthority, now: number) => {
      const permit = this.permit(d, key.personaId, space, now, true,this.adaptive.storeIdentity);
      return permit && sameKey(permit.key, key) && sourceIds.every(id => d.relationships.sources.some(s =>
        s.id === id && sameKey(s.key, key) && s.status === 'active' && s.createdAt <= now && s.expiresAt > now && s.sourceFence === this.permit(d,key.personaId,space,now,true,s.retentionStoreIdentity)?.sourceFence)) ? 'suspended_use' as const : 'invalid_source' as const;
    };
    if (this.adaptive.repository.storage.indexed) return this.adaptive.withRuntimeControls(telegramId, space, (d, now) => ({ value: evaluate(d, now), denied: true }));
    return this.adaptive.withAccountDocument(telegramId, evaluate);
  }
  /** Reject paused use before reading relationship controls/sources from canonical FILE. */
  private pausedUse(telegramId: number, space: SpaceKind): boolean {
    if (![2,3].includes(this.adaptive.repository.storage.canonicalSchemaVersion??1)) return false;
    const state = this.adaptive.readDirectAuthorityForEffect(telegramId, space, (d, now) => ({
      value: !this.adaptive.isStoredPersonalizationUseAllowed(d, space) || !rightsUseAllowed(d,space,'optional.personalization'), denied: true,
      observedDenial: !this.adaptive.isProfileConfirmed(d, now),
    }));
    return state.status !== 'ready' || state.value;
  }
  /** Current committed authority at the final synchronous transport boundary.
   * FILE fallback reads committed controls; it never prunes or writes a draft. */
  resolveNow(telegramId: number, agentId: string, space: SpaceKind): RelationshipPermit | null {
    try {
      if (this.pausedUse(telegramId, space)) return null;
      const result = this.adaptive.readRuntimeControlsForEffect(telegramId, space, (d, now) => {
        const value = this.permit(d, agentId, space, now);
        return { value, denied: !value, ...(value ? { deadline: value.expiresAt } : {}) };
      });
      return result.status === 'ready' ? result.value : null;
    } catch { return null; }
  }
  authorizeNow(key: RelationshipKey, sourceIds: readonly string[], phase: RelationshipPhase, expectedFingerprint?: string): RelationshipPermit | null {
    const telegramId = telegramFor(key);
    if (telegramId === null) return null;
    try {
      const space = scopedRelationshipKeySchema.parse(key).scope.space;
      const result = this.adaptive.readRuntimeControlsForEffect(telegramId, space, (d, now) => {
        const value = this.authorized(d, key, sourceIds, phase, now, expectedFingerprint);
        return { value, denied: !value, ...(value ? { deadline: value.expiresAt } : {}) };
      });
      return result.status === 'ready' ? result.value : null;
    } catch { return null; }
  }
  /** Pure read: served from one committed load; pruning that must commit falls back to the transaction. */
  resolve(telegramId: number, agentId: string, space: SpaceKind): Promise<RelationshipPermit | null> {
    if (this.pausedUse(telegramId, space)) return Promise.resolve(null);
    if (this.adaptive.repository.storage.indexed) return this.adaptive.withRuntimeControls(telegramId, space, (d, now) => {
      const value = this.permit(d, agentId, space, now);
      return { value, denied: !value, ...(value ? { deadline: value.expiresAt } : {}) };
    }).catch(() => null);
    // Pure read: served from a committed load; pruning that must commit still commits.
    return this.adaptive.withAccountView(telegramId, (d, now) => { this.pruneDocument(d, now); return this.permit(d, agentId, space, now); });
  }
  async authorize(key: RelationshipKey, sourceIds: readonly string[], phase: RelationshipPhase, expectedFingerprint?: string): Promise<RelationshipPermit | null> {
    const telegramId = telegramFor(key);
    if (telegramId === null) return null;
    if (this.adaptive.repository.storage.indexed) return this.adaptive.withRuntimeControls(telegramId, scopedRelationshipKeySchema.parse(key).scope.space, (d, now) => {
      const value = this.authorized(d, key, sourceIds, phase, now, expectedFingerprint);
      return { value, denied: !value, ...(value ? { deadline: value.expiresAt } : {}) };
    }).catch(() => null);
    return this.adaptive.withAccountDocument(telegramId, (d, now) => { this.pruneDocument(d, now); return this.authorized(d, key, sourceIds, phase, now, expectedFingerprint); });
  }
  async acceptSource(permit: RelationshipPermit, input: { id: string; at: number; channel: 'telegram' | 'call'; endpointId?: string }): Promise<RelationshipSource | null> {
    const telegramId = telegramFor(permit.key);
    if (telegramId === null || !validId(input.id) || !Number.isSafeInteger(input.at) || input.at < 0 || !['telegram', 'call'].includes(input.channel) ||
        (input.endpointId !== undefined && (!validId(input.endpointId) || input.channel !== 'telegram'))) return null;
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.pruneDocument(d, now);
      const current = this.authorized(d, permit.key, [], 'observe', now, permit.fingerprint);
      const binding = d.relationships.bindings.find(b => b.id === current?.key.scope?.bindingId);
      const captureStart = Math.max(binding?.confirmedAt ?? now, ...PURPOSES.map(p => d.permissions.find(c => c.spaceId === current?.key.scope?.spaceId && c.purpose === p)?.effectiveAt ?? now),
        d.agentGrants.find(g => g.space === current?.key.scope?.space && g.agentId === current?.key.personaId)?.updatedAt ?? now);
      if (!this.adaptive.isProfileConfirmed(d, now) || !current || current.sourceFence !== permit.sourceFence || input.at > now || input.at < captureStart || input.at <= now - 90 * DAY) return null;
      const eventFingerprint = digest(input);
      const prior = d.relationships.sources.find(s => s.id === input.id && s.key.personaId === permit.key.personaId && s.key.scope.space === permit.key.scope?.space);
      if (prior) return prior.status === 'active' && prior.eventFingerprint === eventFingerprint && prior.sourceFence === current.sourceFence ? this.source(prior) : null;
      if (d.relationships.sources.length >= 500) return null;
      const source = { id: input.id, revision: 1, createdAt: input.at, expiresAt: input.at + 90 * DAY, status: 'active' as const,
        ...(d.schemaVersion===3?{retentionStoreIdentity:this.adaptive.storeIdentity}:{}), sourceFence: current.sourceFence, channel: input.channel, ...(input.endpointId !== undefined ? { endpointId: input.endpointId } : {}), key: scopedRelationshipKeySchema.parse(current.key), eventFingerprint };
      d.relationships.sources.push(source); d.revision++; d.updatedAt = now;
      return this.source(source);
    });
  }
  private source(source: RelationshipSource): RelationshipSource {
    const { id, revision, createdAt, expiresAt, status, sourceFence, channel, endpointId } = source;
    return { id, revision, createdAt, expiresAt, status, sourceFence, channel, ...(endpointId !== undefined ? { endpointId } : {}) };
  }
  async invalidate(telegramId: number, space: SpaceKind, input: { agentId?: string; sourceIds?: string[]; reason: string }): Promise<void> {
    if (!['work', 'personal'].includes(space) || (input.agentId !== undefined && !validId(input.agentId)) || (input.sourceIds && (input.sourceIds.length > 256 || !input.sourceIds.every(validId)))) throw new AdaptiveError(400, 'invalid_source');
    await this.adaptive.withAccountDocument(telegramId, (d, now) => {
      if (!input.sourceIds && !input.agentId && ['forget', 'stop', 'owner_forget_all', 'reset', 'relationship_forget'].includes(input.reason)) for (const binding of d.relationships.bindings) if (binding.space === space && binding.status === 'active') { binding.status = 'revoked'; binding.revision++; }
      for (const source of d.relationships.sources) if (source.key.scope.space === space && (!input.agentId || source.key.personaId === input.agentId) && (!input.sourceIds || input.sourceIds.includes(source.id))) {
        if (source.status !== 'deleted') { source.status = 'deleted'; source.revision++; }
      }
      for (const item of d.relationships.inbox) if (item.key.scope.space === space && (!input.agentId || item.key.personaId === input.agentId) && (!input.sourceIds || item.sourceIds.some(id => input.sourceIds!.includes(id)))) {
        item.status = 'cancelled'; item.text = '';
      }
      d.revision++; d.updatedAt = now;
    });
    // Also purge empty/source-less core state on an explicit reset.
    await this.adaptive.notifyRelationshipInvalidation({ telegramId, space, ...input });
  }
  async control(telegramId: number, agentId: string, space: SpaceKind, action: 'pause' | 'resume' | 'stop' | 'forget', until?: number): Promise<void> {
    if (!validId(agentId) || !['work', 'personal'].includes(space) || !['pause', 'resume', 'stop', 'forget'].includes(action)) throw new AdaptiveError(400, 'invalid_control');
    await this.adaptive.withAccountDocument(telegramId, (d, now) => {
      if (action === 'pause' && (until !== undefined && (!Number.isSafeInteger(until) || until <= now || until > now + 90 * DAY))) throw new AdaptiveError(400, 'invalid_pause');
      let control = d.relationships.controls.find(c => c.agentId === agentId && c.space === space);
      if (!control) {
        if (d.relationships.controls.length >= 200) throw new AdaptiveError(409, 'storage_capacity');
        control = { agentId, space, disabled: false, revision: 1 }; d.relationships.controls.push(control);
      }
      control.revision++;
      if (action === 'stop') control.disabled = true;
      if (action === 'pause') control.pausedUntil = until ?? now + 7 * DAY;
      if (action === 'resume') { control.disabled = false; delete control.pausedUntil; }
      if (action === 'stop' || action === 'forget') {
        for (const source of d.relationships.sources) if (source.key.personaId === agentId && source.key.scope.space === space && source.status === 'active') { source.status = 'deleted'; source.revision++; }
        for (const item of d.relationships.inbox) if (item.key.personaId === agentId && item.key.scope.space === space) { item.status = 'cancelled'; item.text = ''; }
      }
      d.revision++; d.updatedAt = now;
    });
    if (action === 'stop' || action === 'forget') await this.adaptive.notifyRelationshipInvalidation({ telegramId, agentId, space, reason: action });
  }
  async configureExternal(telegramId: number, space: SpaceKind, enabled: boolean): Promise<void> {
    await this.adaptive.withAccountDocument(telegramId, (d, now) => {
      if (enabled && !this.adaptive.isProfileConfirmed(d, now)) throw new AdaptiveError(403, 'profile_confirmation_required');
      if (!['work', 'personal'].includes(space) || typeof enabled !== 'boolean') throw new AdaptiveError(400, 'invalid_settings');
      d.relationships.externalSettings[space] = enabled; d.relationships.externalSettings.revision++; d.revision++; d.updatedAt = now;
    });
  }
  async publish(key: RelationshipKey, intentionId: string, text: string, sourceIds: readonly string[], expectedFingerprint: string): Promise<{ id: string; external: boolean } | null> {
    const telegramId = telegramFor(key);
    if (telegramId === null || !validId(intentionId) || typeof text !== 'string' || !text.trim() || text.length > 1000) return null;
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.pruneDocument(d, now);
      const permit = this.authorized(d, key, sourceIds, 'inbox', now, expectedFingerprint);
      if (!permit) return null;
      const prior = d.relationships.inbox.find(i => i.id === intentionId);
      if (prior) return sameKey(prior.key, key) && prior.text === text && digest(prior.sourceIds) === digest(sourceIds) && prior.status !== 'cancelled' && prior.status !== 'dismissed' ? { id: prior.id, external: false } : null;
      if (d.relationships.ledger.some(e => e.id === intentionId)) return null;
      const settings = permit.notification;
      if (isSelectedTimezone(settings.timezone) && isQuietHour(now, settings.timezone, settings.quietStartHour, settings.quietEndHour)) return null;
      const spent = d.relationships.ledger.filter(e => e.at > now - DAY).length +
        d.experience.inbox.filter(i => i.category === 'proactive' && i.createdAt > now - DAY).length;
      if (spent >= settings.dailyCap || d.relationships.inbox.length >= 100 || d.relationships.ledger.length >= 500) return null;
      const expiresAt = Math.min(now + 7 * DAY, permit.expiresAt, ...sourceIds.map(id => d.relationships.sources.find(s => s.id === id && sameKey(s.key, key))!.expiresAt));
      if (expiresAt <= now) return null;
      const checkedKey = scopedRelationshipKeySchema.parse(key);
      d.relationships.inbox.push({ id: intentionId, key: checkedKey, text, sourceIds: [...sourceIds], fingerprint: permit.fingerprint, sourceFence: permit.sourceFence,
        createdAt: now, expiresAt, status: 'unread' });
      d.relationships.ledger.push({ id: intentionId, key: checkedKey, at: now, state: 'published' }); d.revision++; d.updatedAt = now;
      return { id: intentionId, external: !!this.authorized(d, key, sourceIds, 'external', now, expectedFingerprint) };
    });
  }
  inbox(telegramId: number, agentId: string, space: SpaceKind): Promise<RelationshipInboxItem[]> {
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.pruneDocument(d, now);
      if (!this.adaptive.isProfileConfirmed(d, now)) return [];
      return d.relationships.inbox.filter(i => i.key.personaId === agentId && i.key.scope.space === space && ['unread', 'read'].includes(i.status) &&
        !!this.authorized(d, i.key, i.sourceIds, 'inbox', now) && i.sourceFence === this.permit(d, agentId, space, now)?.sourceFence);
    });
  }
  async feedback(telegramId: number, agentId: string, space: SpaceKind, id: string, action: 'read' | 'dismissed'): Promise<void> {
    await this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.pruneDocument(d, now);
      if (!this.adaptive.isProfileConfirmed(d, now)) throw new AdaptiveError(403, 'profile_confirmation_required');
      if (!['read', 'dismissed'].includes(action)) throw new AdaptiveError(400, 'invalid_action');
      const item = d.relationships.inbox.find(i => i.id === id && i.key.personaId === agentId && i.key.scope.space === space && i.status !== 'cancelled');
      if (!item) throw new AdaptiveError(404, 'not_found');
      // Dismissal is terminal, including a delayed read or repeated dismissal.
      if (item.status === 'dismissed') return;
      item.status = action; if (action === 'dismissed') item.text = ''; d.revision++; d.updatedAt = now;
    });
  }
  async reserveExternal(key: RelationshipKey, id: string, expectedFingerprint: string): Promise<{ reservationId: string; text: 'You have an update in Vox.'; reference: string } | null> {
    const telegramId = telegramFor(key); if (telegramId === null) return null;
    const reservationId = randomUUID();
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.pruneDocument(d, now);
      const item = d.relationships.inbox.find(i => i.id === id && sameKey(i.key, key) && ['unread', 'read'].includes(i.status));
      const entry = d.relationships.ledger.find(e => e.id === id && sameKey(e.key, key));
      if (!item || !entry || entry.state !== 'published' || !this.authorized(d, key, item.sourceIds, 'external', now, expectedFingerprint)) return null;
      entry.state = 'reserved'; entry.reservationId = reservationId; entry.fingerprint = expectedFingerprint; d.revision++; d.updatedAt = now;
      return { reservationId, text: 'You have an update in Vox.' as const, reference: id };
    });
  }
  async maySendExternal(key: RelationshipKey, id: string, reservationId: string): Promise<boolean> {
    const telegramId = telegramFor(key); if (telegramId === null) return false;
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.pruneDocument(d, now);
      const item = d.relationships.inbox.find(i => i.id === id && sameKey(i.key, key) && ['unread', 'read'].includes(i.status));
      const entry = d.relationships.ledger.find(e => e.id === id && sameKey(e.key, key));
      return !!item && !!entry && entry.state === 'reserved' && entry.reservationId === reservationId &&
        !!this.authorized(d, key, item.sourceIds, 'external', now, entry.fingerprint);
    });
  }
  async recordExternal(key: RelationshipKey, id: string, reservationId: string, outcome: 'accepted' | 'unknown' | 'cancelled', messageId?: string): Promise<void> {
    const telegramId = telegramFor(key); if (telegramId === null) return;
    if (!['accepted', 'unknown', 'cancelled'].includes(outcome) || (messageId !== undefined && !validId(messageId))) throw new AdaptiveError(400, 'invalid_outcome');
    await this.adaptive.withAccountDocument(telegramId, (d, now) => {
      const entry = d.relationships.ledger.find(e => e.id === id && sameKey(e.key, key));
      if (!entry || entry.state !== 'reserved' || entry.reservationId !== reservationId) return;
      entry.state = outcome; if (messageId) entry.messageId = messageId; d.revision++; d.updatedAt = now;
    });
  }
}
