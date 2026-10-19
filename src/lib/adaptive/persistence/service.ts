import { randomUUID } from 'crypto';
import { brandError, publicDomainError } from '../../error-contract';
import { transitionConsent } from '../consent';
import { evaluateCapability, type Capability, type CapabilityRequest, type JurisdictionApproval } from '../eligibility';
import { resolveVerifiedPerson } from '../identity';
import { authorizeAccess } from '../policy';
import type { AccessRequest, ConsentPermission, IdentityContext, PolicySnapshot, ResourceDescriptor } from '../types';
import { ADAPTIVE_POLICY_VERSION, OPTIONAL_PURPOSES, AdaptiveRepository, accountIdFor, containerIdFor, digest,
  spaceIdFor, tenantIdFor, type AdaptiveDocument, type OptionalPurpose, type SpaceKind, type StoredMemory } from './repository';
import type { AdaptiveNotice, AdaptiveSnapshot, AdaptivePresentation } from './contracts';
import type { AgentGrantInput, ConsentInput, DeletionInput, IdentityInput, MemoryInput, PresentInput } from './validation';
import { sweepObserverDocument } from '../observation/helpers';

export class AdaptiveError extends Error {
  readonly name = 'AdaptiveError';
  constructor(readonly status: number, readonly code: string) { super(code); brandError(this, 'AdaptiveError'); }
  static is(error: unknown): error is AdaptiveError { return publicDomainError(error, 'AdaptiveError'); }
}
const fail = (status: number, code: string): never => { throw new AdaptiveError(status, code); };
export interface RelationshipInvalidation { telegramId: number; space: SpaceKind; agentId?: string; sourceIds?: string[]; reason: string }
const YEAR = 365 * 24 * 60 * 60 * 1000;
const RETENTION = 90 * 24 * 60 * 60 * 1000;
const INFINITY = Number.MAX_SAFE_INTEGER;
export interface AdaptiveServiceOptions {
  now?: () => number;
  /** Explicit server release switch for authenticated in-app notifications only. */
  inboxEnabled?: boolean;
  /** Releases only the fresh scoped relationship implementation, never legacy memory. */
  scopedRelationshipsEnabled?: boolean;
  /** True only with an explicitly qualified, injected voice-identity provider. */
  voiceRecognitionEnabled?: boolean;
  /** Trusted server registry/resolver. Client declarations alone cannot provide approvals. */
  capabilityPolicy?: (context: { accountId: string; personId: string; capability: Capability;
    declaration?: AdaptiveDocument['declaration'] }, now: number) => { request: CapabilityRequest; approvals: readonly JurisdictionApproval[] } | undefined;
}
const CAPABILITY: Record<OptionalPurpose, Capability> = {
  'optional.product_analytics': 'product_analytics', 'optional.personalization': 'personalization',
  'optional.auto_memory': 'auto_memory', 'optional.biometric_recognition': 'biometric_recognition',
  'optional.reminder_delivery': 'reminder_delivery', 'optional.proactive_suggestions': 'proactive_suggestions',
  'optional.content_quality_review': 'content_quality_review', 'optional.relationship_outreach': 'relationship_outreach',
};
const COPY: Record<OptionalPurpose, { en: [string, string]; fa: [string, string] }> = {
  'optional.product_analytics': { en: ['Product analytics', 'Allow optional product usage measurements in this space. This does not allow conversation content review, personalization, or model training. You can withdraw at any time.'], fa: ['آمار استفاده', 'اجازه می‌دهم آمار اختیاری استفاده در این فضا ثبت شود. این انتخاب اجازه بررسی متن گفتگو، شخصی‌سازی یا آموزش مدل نیست. هر زمان می‌توانم آن را لغو کنم.'] },
  'optional.personalization': { en: ['Personalization', 'Allow Vox to use your permitted preferences to adapt responses in this space. This does not enable automatic memory collection or analytics. You can withdraw at any time.'], fa: ['شخصی‌سازی', 'اجازه می‌دهم ووکس از ترجیحات مجازم برای تنظیم پاسخ‌ها در این فضا استفاده کند. این انتخاب جمع‌آوری خودکار حافظه یا آمار را فعال نمی‌کند. هر زمان می‌توانم آن را لغو کنم.'] },
  'optional.auto_memory': { en: ['Automatic memory', 'Allow Vox to save permitted relationship context in this space and use this confirmed account profile for check-ins for up to 30 days, including while you are away. Private details stay in Vox; Telegram alerts require a separate choice. You can inspect, delete, or disable this context and withdraw at any time.'], fa: ['حافظه خودکار', 'اجازه می‌دهم وکس زمینهٔ مجاز رابطه را در این فضا ذخیره کند و تا ۳۰ روز، از جمله زمانی که حضور ندارم، از این نمایهٔ تأییدشده برای پیگیری استفاده کند. جزئیات خصوصی در وکس می‌ماند و اعلان تلگرام به انتخاب جداگانه نیاز دارد. می‌توانم زمینه را ببینم، حذف یا غیرفعال کنم و هر زمان رضایت را پس بگیرم.'] },
  'optional.biometric_recognition': { en: ['Voice recognition', 'Allow optional voice matching in this space after separate enrollment and provider disclosure. This choice does not record or enroll your voice and never unlocks private data. Withdrawing disables matching and starts deletion of enrolled templates in this space.'], fa: ['تشخیص صدا', 'اجازهٔ تطبیق اختیاری صدا در این فضا پس از ثبت جداگانه و اطلاع از ارائه‌دهنده. این انتخاب صدای شما را ضبط یا ثبت نمی‌کند و هرگز دسترسی به دادهٔ خصوصی نمی‌دهد. پس‌گرفتن رضایت، تطبیق را غیرفعال و حذف الگوهای ثبت‌شدهٔ این فضا را آغاز می‌کند.'] },
  'optional.reminder_delivery': { en: ['Reminder delivery', 'Allow delivery of reminders you explicitly request. Channels and recipients need separate confirmation. This does not allow marketing or proactive suggestions.'], fa: ['ارسال یادآوری', 'اجازه می‌دهم یادآوری‌هایی که صریحاً درخواست کرده‌ام ارسال شوند. کانال و گیرنده به تأیید جداگانه نیاز دارند. این انتخاب اجازه بازاریابی یا پیشنهاد خودکار نیست.'] },
  'optional.proactive_suggestions': { en: ['Proactive suggestions', 'Allow suggestions based on permitted information in this space. This does not grant access to other spaces or enable external messages. You can withdraw at any time.'], fa: ['پیشنهادهای خودکار', 'اجازه می‌دهم براساس اطلاعات مجاز در این فضا پیشنهاد دریافت کنم. این انتخاب اجازه دسترسی به فضاهای دیگر یا ارسال پیام بیرونی نیست. هر زمان می‌توانم آن را لغو کنم.'] },
  'optional.relationship_outreach': { en: ['Telegram check-in alerts', 'Allow generic Telegram alerts when a private check-in is ready in your authenticated Vox inbox. Private check-in details stay inside Vox. This choice applies only to this space and requires a separately enabled Telegram channel. You can withdraw at any time.'], fa: ['اعلان پیگیری در تلگرام', 'اجازه می‌دهم وقتی پیگیری خصوصی در صندوق احراز هویت‌شدهٔ وکس آماده است، اعلان عمومی تلگرام دریافت کنم. جزئیات خصوصی در وکس می‌ماند. این انتخاب فقط برای همین فضا است و به فعال‌سازی جداگانهٔ کانال تلگرام نیاز دارد. هر زمان می‌توانم آن را لغو کنم.'] },
  'optional.content_quality_review': { en: ['Content quality review', 'Allow specifically permitted content to be reviewed for quality in this space. This does not allow model training or access to other private spaces. You can withdraw at any time.'], fa: ['بررسی کیفیت محتوا', 'اجازه می‌دهم محتوای دارای مجوز مشخص در این فضا برای کیفیت بررسی شود. این انتخاب اجازه آموزش مدل یا دسترسی به فضاهای خصوصی دیگر نیست. هر زمان می‌توانم آن را لغو کنم.'] },
};
export function adaptiveNotice(purpose: OptionalPurpose, locale: 'en' | 'fa'): AdaptiveNotice {
  const [title, body] = COPY[purpose][locale];
  const version = purpose === 'optional.auto_memory' ? 'adaptive-relationship-memory-v1' : purpose === 'optional.biometric_recognition' ? 'adaptive-voice-identity-v1' : ADAPTIVE_POLICY_VERSION;
  return { id: `notice:${purpose}`, version, title, body, locale,
    copyHash: digest([version, purpose, locale, title, body]) };
}

/** Private account-profile slice. No group sharing, account linking, enrollment or legacy backfill. */
export class AdaptiveService {
  private readonly now: () => number;
  private relationshipInvalidator?: (input: RelationshipInvalidation) => Promise<void>;
  private voiceIdentityInvalidator?: (input: { telegramId: number; space?: SpaceKind; reason: string }) => Promise<void>;
  setVoiceIdentityInvalidator(handler: (input: { telegramId: number; space?: SpaceKind; reason: string }) => Promise<void>): void { this.voiceIdentityInvalidator = handler; }
  setRelationshipInvalidator(handler: (input: RelationshipInvalidation) => Promise<void>): void { this.relationshipInvalidator = handler; }
  async notifyRelationshipInvalidation(input: RelationshipInvalidation): Promise<void> { await this.relationshipInvalidator?.(input); }
  constructor(readonly repository: AdaptiveRepository, private readonly options: AdaptiveServiceOptions = {}) { this.now = options.now ?? Date.now; }
  private account(telegramId: number): string {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return fail(401, 'authentication_required');
    return accountIdFor(telegramId);
  }
  private async transact<T>(telegramId: number, fn: (d: AdaptiveDocument, now: number) => T): Promise<T> {
    const now = this.now();
    const invalidations: RelationshipInvalidation[] = [];
    const voiceInvalidations: Array<{ telegramId: number; space?: SpaceKind; reason: string }> = [];
    const result = await this.repository.transaction(this.account(telegramId), now, d => {
      invalidations.length = 0;
      voiceInvalidations.length = 0;
      const revokeReminderIdentity = () => {
        for (const space of ['work', 'personal'] as const) {
          const channel = d.experience.reminderDelivery?.[space];
          if (!channel?.authorization && !channel?.presentation) continue;
          delete channel.authorization; delete channel.presentation; channel.enabled = false; channel.revision++;
          for (const item of d.experience.inbox.filter(i => i.space === space && i.category === 'reminder')) { item.status = 'cancelled'; delete item.label; item.revision++; }
          d.revision++; d.updatedAt = now;
        }
      };
      // A previously cleared identity cannot acquire its old background grant
      // again when confirmation creates a new interactive binding.
      if (!d.binding || d.binding.accountId !== d.accountId || d.binding.personId !== d.personId) revokeReminderIdentity();
      const priorBinding = digest(d.binding ?? null);
      const priorRevision = d.revision;
      const priorRelationships = digest(d.relationships);
      const priorPermissions = new Map(d.permissions.map(p => [p.id, p.revision]));
      for (const binding of d.relationships.bindings) if (binding.status === 'active' && binding.expiresAt <= now) { binding.status = 'expired'; binding.revision++; }
      // Earlier automatic-memory consent never enrolled the new durable identity.
      // Record an explicit required-disclosure transition; never invent a grant.
      for (let index = 0; index < d.permissions.length; index++) {
        const p = d.permissions[index];
        if (p.purpose !== 'optional.auto_memory' || p.state !== 'granted' || p.expiresAt <= now) continue;
        const space = p.spaceId === spaceIdFor(d.accountId, 'work') ? 'work' : 'personal';
        const binding = d.relationships.bindings.find(b => b.space === space && b.status === 'active' && b.expiresAt > now && b.accountId === d.accountId && b.personId === d.personId);
        if (binding) continue;
        const eventId = `relationship-reconsent:${p.id}:${p.epoch}`;
        const transition = transitionConsent(p, { eventId, expectedRevision: p.revision, actor: { accountId: d.accountId, verifiedPersonId: d.personId }, state: 'reconsent_required', now });
        if (!transition.ok) return fail(503, 'relationship_reconsent_failed');
        d.permissions[index] = transition.permission;
        if (transition.event) d.consentEvents.push(transition.event);
        this.bump(d, now); this.record(d, eventId, digest(['relationship-reconsent', p.id, p.epoch]), 'relationship_reconsent', p.id);
      }
      const priorGrants = new Map(d.agentGrants.map(g => [`${g.space}:${g.agentId}`, g.revision]));
      const priorMemories = new Map(d.memories.map(m => [m.id, m.status]));
      const priorSources = structuredClone(d.relationships.sources);
      // System expiry is authoritative; a UI must not see an expired choice that cannot reopen.
      for (let index = 0; index < d.permissions.length; index++) {
        const current = d.permissions[index];
        if (current.state !== 'granted' || current.expiresAt > now) continue;
        const eventId = `system-expiry:${current.id}:${current.epoch}`;
        const transition = transitionConsent(current, { eventId, expectedRevision: current.revision,
          actor: { accountId: d.accountId, verifiedPersonId: d.personId }, state: 'expired', now });
        if (!transition.ok) return fail(503, 'permission_expiry_failed');
        d.permissions[index] = transition.permission;
        if (transition.event) d.consentEvents.push(transition.event);
        this.invalidateExperience(d, current.spaceId === spaceIdFor(d.accountId, 'work') ? 'work' : 'personal', current.purpose as OptionalPurpose);
        this.bump(d, now);
        this.record(d, eventId, digest(['system-expiry', current.id, current.epoch]), 'system_expiry', current.id);
        d.outbox.push({ eventId, kind: 'consent_changed', space: current.spaceId === spaceIdFor(d.accountId, 'work') ? 'work' : 'personal',
          personId: d.personId, revision: d.revision, epoch: transition.permission.epoch, createdAt: now });
      }
      // Text retention is enforced even on reads; metadata remains as a replay tombstone.
      for (const memory of d.memories) if (memory.status === 'active' && memory.expiresAt <= now) this.tombstone(d, memory, now, `expiry:${memory.id}`);
      if (sweepObserverDocument(d, now, (doc, space, agentId, time) =>
        this.isPurposeAllowed(doc, space, 'optional.product_analytics', time, agentId))) this.bump(d, now);
      const value = fn(d, now);
      if (!d.binding || d.binding.accountId !== d.accountId || d.binding.personId !== d.personId) revokeReminderIdentity();
      // The separate template store is suppressed/purged only after canonical
      // authority commits. Its invalidator never re-enters this transaction.
      if (priorBinding !== digest(d.binding ?? null) || (d.binding && d.binding.expiresAt <= now)) {
        voiceInvalidations.push({ telegramId, reason: 'profile_changed' });
      } else for (const p of d.permissions) if (p.purpose === 'optional.biometric_recognition' &&
          priorPermissions.get(p.id) !== p.revision) {
        voiceInvalidations.push({ telegramId, space: p.spaceId === spaceIdFor(d.accountId, 'work') ? 'work' : 'personal', reason: 'voice_consent_changed' });
      }
      const enqueue = (space: SpaceKind, reason: string, agentId?: string, sourceIds?: string[]) => {
        for (const source of d.relationships.sources) if (source.key.scope.space === space && (!agentId || source.key.personaId === agentId) && (!sourceIds || sourceIds.includes(source.id))) {
          if (source.status !== 'deleted') { source.status = 'deleted'; source.revision++; }
        }
        for (const item of d.relationships.inbox) if (item.key.scope.space === space && (!agentId || item.key.personaId === agentId) && (!sourceIds || item.sourceIds.some(id => sourceIds.includes(id)))) {
          item.status = 'cancelled'; item.text = '';
        }
        invalidations.push({ telegramId, space, reason, ...(agentId ? { agentId } : {}), ...(sourceIds ? { sourceIds } : {}) });
      };
      {
        for (const p of d.permissions) if (priorPermissions.get(p.id) !== p.revision && ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions'].includes(p.purpose)) {
          const space = p.spaceId === spaceIdFor(d.accountId, 'work') ? 'work' : 'personal';
          if (p.purpose === 'optional.auto_memory' && p.state !== 'granted') for (const binding of d.relationships.bindings) if (binding.space === space && binding.status === 'active') { binding.status = 'revoked'; binding.revision++; }
          enqueue(space, 'consent_changed');
        }
        for (const g of d.agentGrants) if (priorGrants.has(`${g.space}:${g.agentId}`) && priorGrants.get(`${g.space}:${g.agentId}`) !== g.revision) enqueue(g.space, 'agent_grant_changed', g.agentId);
        for (const m of d.memories) if (priorMemories.get(m.id) === 'active' && m.status === 'deleted') enqueue(m.space, 'source_memory_deleted');
        const removed = new Map<string, { space: SpaceKind; agentId: string; ids: string[] }>();
        for (const source of priorSources) if (source.status === 'active' && !d.relationships.sources.some(s => s.id === source.id && digest(s.key) === digest(source.key) && s.status === 'active')) {
          const space = source.key.scope.space, agentId = source.key.personaId;
          if (invalidations.some(i => i.space === space && (!i.agentId || i.agentId === agentId) && (!i.sourceIds || i.sourceIds.includes(source.id)))) continue;
          const key = digest([space, agentId]);
          const group = removed.get(key) ?? { space, agentId, ids: [] }; group.ids.push(source.id); removed.set(key, group);
        }
        for (const group of removed.values()) enqueue(group.space, 'source_deleted', group.agentId, group.ids);
      }
      const observerChanged = sweepObserverDocument(d, now, (doc, space, agentId, time) =>
        this.isPurposeAllowed(doc, space, 'optional.product_analytics', time, agentId));
      if ((observerChanged || priorRelationships !== digest(d.relationships)) && d.revision === priorRevision) this.bump(d, now);
      return value;
    });
    // Authority is already durably revoked. Purge failures are visible to caller;
    // no rollback can restore permission or permit an in-flight send.
    const cleanup = await Promise.allSettled([
      ...invalidations.map(input => this.notifyRelationshipInvalidation(input)),
      ...voiceInvalidations.map(input => this.voiceIdentityInvalidator?.(input)),
    ]);
    const failed = cleanup.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    if (failed) throw failed.reason;
    return result;
  }
  private identity(d: AdaptiveDocument): IdentityContext {
    const binding = d.binding;
    return { authenticatedAccountId: d.accountId, ...(binding ? { selectedPerson: {
      personId: d.personId, bindingId: binding.id, bindingRevision: binding.revision,
    } } : {}) };
  }
  private confirmed(d: AdaptiveDocument, now: number): boolean {
    return !!resolveVerifiedPerson(this.identity(d), { schemaVersion: 1, id: d.accountId, revision: 1,
      createdAt: d.createdAt, updatedAt: d.createdAt, status: 'active', ownerPersonId: d.personId }, d.binding, now);
  }
  private requirePerson(d: AdaptiveDocument, now: number): void {
    if (!this.confirmed(d, now)) fail(403, 'profile_confirmation_required');
  }
  private eligible(d: AdaptiveDocument, capability: Capability, now: number): { eligible: boolean; reason?: string; validUntil?: number; approvalVersions?: readonly string[] } {
    // Enrollment/provider/communications release gates have no implementation in this slice.
    if (capability === 'content_quality_review' || (capability === 'biometric_recognition' && this.options.voiceRecognitionEnabled !== true) ||
        (['auto_memory', 'relationship_outreach'].includes(capability) && this.options.scopedRelationshipsEnabled !== true) ||
        (['reminder_delivery', 'proactive_suggestions'].includes(capability) && this.options.inboxEnabled !== true)) return { eligible: false, reason: 'feature_not_released' };
    const policy = this.options.capabilityPolicy?.({ accountId: d.accountId, personId: d.personId, capability, declaration: d.declaration }, now);
    if (!policy || policy.request.personId !== d.personId || policy.request.capability !== capability) return { eligible: false, reason: 'approval_missing' };
    return evaluateCapability(policy.request, policy.approvals, now);
  }
  capabilityStatus(d: AdaptiveDocument, capability: Capability, now: number): { eligible: boolean; reason?: string; validUntil?: number; approvalVersions?: readonly string[] } {
    return this.eligible(d, capability, now);
  }
  /** Trusted backend seam: same aggregate/expiry transaction as consent and memory. */
  withAccountDocument<T>(telegramId: number, fn: (document: AdaptiveDocument, now: number) => T): Promise<T> {
    return this.transact(telegramId, fn);
  }
  isProfileConfirmed(d: AdaptiveDocument, now: number): boolean { return this.confirmed(d, now); }
  isCoreAllowed(d: AdaptiveDocument, now: number): boolean { return this.confirmed(d, now) && this.eligible(d, 'core_text', now).eligible; }
  purposeFingerprint(d: AdaptiveDocument, space: SpaceKind, purpose: OptionalPurpose, now: number, agentId?: string): string {
    return digest([d.accountId, d.binding, this.confirmed(d, now),
      space, purpose, agentId, this.permission(d, space, purpose), this.eligible(d, CAPABILITY[purpose], now),
      agentId ? d.agentGrants.filter(g => g.space === space && g.agentId === agentId) : null]);
  }
  coreFingerprint(d: AdaptiveDocument, now: number): string {
    return digest([d.accountId, d.binding, this.confirmed(d, now), this.eligible(d, 'core_text', now)]);
  }
  /** Explicit preferences may be saved as a user directive. Applying them to an
   * agent still requires current optional purpose consent and an exact grant. */
  isPurposeAllowed(d: AdaptiveDocument, space: SpaceKind, purpose: OptionalPurpose, now: number, agentId?: string): boolean {
    const permission = this.permission(d, space, purpose);
    return this.confirmed(d, now) && this.eligible(d, CAPABILITY[purpose], now).eligible &&
      permission.state === 'granted' && permission.expiresAt > now &&
      (!agentId || d.agentGrants.some(g => g.space === space && g.agentId === agentId && g.allowed));
  }
  private permission(d: AdaptiveDocument, space: SpaceKind, purpose: OptionalPurpose): ConsentPermission {
    return d.permissions.find(p => p.spaceId === spaceIdFor(d.accountId, space) && p.purpose === purpose)!;
  }
  private invalidateExperience(d: AdaptiveDocument, space: SpaceKind, purpose: OptionalPurpose): void {
    if (purpose === 'optional.product_analytics') d.experience.observations = d.experience.observations.filter(e => e.space !== space);
    if (purpose === 'optional.reminder_delivery' || purpose === 'optional.proactive_suggestions') {
      const category = purpose === 'optional.reminder_delivery' ? 'reminder' : 'proactive';
      for (const item of d.experience.inbox) if (item.space === space && item.category === category) { item.status = 'cancelled'; delete item.label; item.revision++; }
    }
  }
  private bump(d: AdaptiveDocument, now: number): void {
    if (d.revision >= Number.MAX_SAFE_INTEGER) fail(409, 'revision_exhausted');
    d.revision++; d.updatedAt = now;
  }
  private event(d: AdaptiveDocument, eventId: string, fingerprint: string): boolean {
    const existing = d.events.find(e => e.eventId === eventId);
    if (!existing) return false;
    if (existing.fingerprint !== fingerprint) fail(409, 'event_conflict');
    return true;
  }
  private requireCapacity(d: AdaptiveDocument): void {
    // Reserve room for withdrawals/deletions, including one tombstone per source.
    if (d.events.length >= 1500 || d.consentEvents.length >= 1500 || d.outbox.length >= 1500 || Buffer.byteLength(JSON.stringify(d)) >= 450_000) fail(409, 'storage_capacity');
  }
  private record(d: AdaptiveDocument, eventId: string, fingerprint: string, kind: string, resultId: string): void {
    d.events.push({ eventId, fingerprint, kind, resultId, revision: d.revision });
  }
  private snapshot(d: AdaptiveDocument, space: SpaceKind, now: number, locale: 'en' | 'fa' = 'en', includeMemories = true): AdaptiveSnapshot {
    const confirmed = this.confirmed(d, now);
    const memory = this.eligible(d, 'core_text', now);
    return { schemaVersion: 1, identity: { accountId: d.accountId, confirmed,
      verification: confirmed ? 'account_confirmation' : 'unconfirmed', adultDeclared: d.declaration?.adultConfirmed === true,
      ...(d.declaration?.declaredJurisdiction ? { declaredJurisdiction: d.declaration.declaredJurisdiction } : {}),
      ...(confirmed ? { personId: d.personId, bindingId: d.binding!.id, bindingRevision: d.binding!.revision,
        bindingExpiresAt: d.binding!.expiresAt, bindingCreatedAt: d.binding!.createdAt,
        bindingUpdatedAt: d.binding!.updatedAt, bindingVerifiedAt: d.binding!.verifiedAt } : {}) },
      space, revision: d.revision, scope: 'private_account_profile',
      purposes: OPTIONAL_PURPOSES.map(purpose => {
        const permission = this.permission(d, space, purpose), eligibility = this.eligible(d, CAPABILITY[purpose], now);
        return { purpose, state: permission.state === 'granted' && permission.expiresAt <= now ? 'expired' : permission.state,
          revision: permission.revision, available: confirmed && eligibility.eligible,
          ...(!confirmed ? { reason: 'profile_confirmation_required' } : !eligibility.eligible ? { reason: eligibility.reason } : {}), notice: adaptiveNotice(purpose, locale) };
      }),
      memories: confirmed && includeMemories ? d.memories.filter(m => m.space === space && m.status === 'active' && m.expiresAt > now)
        .filter(m => this.authorized(d, space, m, 'read', now)).map(m => ({ id: m.id, revision: m.revision, text: m.text!, createdAt: m.createdAt, expiresAt: m.expiresAt })) : [],
      agents: confirmed ? d.agentGrants.filter(g => g.space === space).map(g => ({ agentId: g.agentId, allowed: g.allowed, revision: g.revision })) : [],
      explicitMemoryAvailable: confirmed && memory.eligible,
      ...(memory.eligible && memory.validUntil !== undefined ? { explicitMemoryValidUntil: memory.validUntil } : {}),
      ...(!confirmed ? { explicitMemoryReason: 'profile_confirmation_required' } : !memory.eligible ? { explicitMemoryReason: memory.reason } : {}),
    };
  }
  read(telegramId: number, space: SpaceKind, locale: 'en' | 'fa' = 'en'): Promise<AdaptiveSnapshot> {
    return this.transact(telegramId, (d, now) => this.snapshot(d, space, now, locale));
  }
  /** Metadata-only authorization projection. The account aggregate remains the
   * storage boundary; no private text is mapped into shared-service authority. */
  readAuthority(telegramId: number, space: SpaceKind, locale: 'en' | 'fa' = 'en'): Promise<AdaptiveSnapshot> {
    return this.transact(telegramId, (d, now) => this.snapshot(d, space, now, locale, false));
  }
  confirm(telegramId: number, input: IdentityInput, space: SpaceKind = 'work'): Promise<AdaptiveSnapshot> {
    const bindingId = randomUUID();
    return this.transact(telegramId, (d, now) => {
      if (input.confirm !== true) return fail(400, 'confirmation_required');
      d.binding = { schemaVersion: 1, id: bindingId, revision: (d.binding?.revision ?? 0) + 1, createdAt: d.binding?.createdAt ?? now,
        updatedAt: now, accountId: d.accountId, personId: d.personId, status: 'verified', method: 'account_confirmation',
        verifiedAt: now, expiresAt: now + 12 * 60 * 60 * 1000 };
      if (input.adultConfirmed !== undefined || input.declaredJurisdiction !== undefined) {
        d.declaration = { adultConfirmed: input.adultConfirmed === true, declaredAt: now,
          ...(input.declaredJurisdiction ? { declaredJurisdiction: input.declaredJurisdiction } : {}) };
      }
      this.bump(d, now);
      return this.snapshot(d, space, now);
    });
  }
  present(telegramId: number, input: PresentInput): Promise<AdaptivePresentation> {
    const receiptId = randomUUID();
    return this.transact(telegramId, (d, now) => {
      this.requirePerson(d, now);
      const fingerprint = digest(['present', input]);
      const existing = d.events.find(e => e.eventId === input.eventId);
      if (this.event(d, input.eventId, fingerprint)) {
        const receipt = d.receipts.find(r => r.id === existing!.resultId);
        if (!receipt || receipt.expiresAt <= now) return fail(409, 'presentation_expired');
        return { ...this.snapshot(d, input.space, now, input.locale), receipt: receipt.id, notice: adaptiveNotice(input.purpose, input.locale) };
      }
      this.requireCapacity(d);
      const permission = this.permission(d, input.space, input.purpose);
      if (permission.state === 'suspended') return fail(403, 'suspension_requires_review');
      const transition = transitionConsent(permission, { eventId: input.eventId, expectedRevision: input.expectedRevision,
        actor: { accountId: d.accountId, verifiedPersonId: d.personId }, state: 'presented', now, deliberateReopen: input.deliberateReopen });
      if (!transition.ok) return fail(409, transition.reason);
      d.permissions[d.permissions.indexOf(permission)] = transition.permission;
      if (transition.event) d.consentEvents.push(transition.event);
      const notice = adaptiveNotice(input.purpose, input.locale);
      d.receipts = d.receipts.filter(r => r.expiresAt > now).slice(-99);
      d.receipts.push({ id: receiptId, purpose: input.purpose, space: input.space, permissionRevision: transition.permission.revision,
        locale: input.locale, presentedAt: now, expiresAt: now + 10 * 60 * 1000, copyHash: notice.copyHash, bindingRevision: d.binding!.revision });
      this.bump(d, now); this.record(d, input.eventId, fingerprint, 'present', receiptId);
      return { ...this.snapshot(d, input.space, now, input.locale), receipt: receiptId, notice };
    });
  }
  changeConsent(telegramId: number, input: ConsentInput): Promise<AdaptiveSnapshot> {
    const relationshipBindingId = randomUUID();
    return this.transact(telegramId, (d, now) => {
      this.requirePerson(d, now);
      const fingerprint = digest(['consent', input]);
      if (this.event(d, input.eventId, fingerprint)) return this.snapshot(d, input.space, now);
      const permission = this.permission(d, input.space, input.purpose);
      const receipt = d.receipts.find(r => r.id === input.receipt);
      if (input.state === 'granted') {
        this.requireCapacity(d);
        if (!this.eligible(d, CAPABILITY[input.purpose], now).eligible) return fail(403, 'capability_unavailable');
        if (!receipt || receipt.expiresAt <= now || receipt.space !== input.space || receipt.purpose !== input.purpose ||
            receipt.bindingRevision !== d.binding!.revision || receipt.permissionRevision !== permission.revision ||
            receipt.copyHash !== adaptiveNotice(input.purpose, receipt.locale).copyHash) return fail(409, 'presentation_required');
      }
      const transition = transitionConsent(permission, { eventId: input.eventId, expectedRevision: input.expectedRevision,
        actor: { accountId: d.accountId, verifiedPersonId: d.personId }, state: input.state, now,
        ...(input.state === 'granted' ? { expiresAt: now + YEAR, evidence: {
          kind: 'consent' as const, noticeId: `notice:${input.purpose}`, noticeVersion: adaptiveNotice(input.purpose, receipt!.locale).version,
          renderedCopyHash: receipt!.copyHash, locale: receipt!.locale, presentedAt: receipt!.presentedAt, affirmative: true as const,
        } } : {}) });
      if (!transition.ok) return fail(409, transition.reason);
      d.permissions[d.permissions.indexOf(permission)] = transition.permission;
      if (transition.event) d.consentEvents.push(transition.event);
      if (input.purpose === 'optional.auto_memory' && input.state === 'granted') {
        const prior = d.relationships.bindings.find(b => b.space === input.space);
        d.relationships.bindings = d.relationships.bindings.filter(b => b.space !== input.space);
        d.relationships.bindings.push({ id: relationshipBindingId, revision: (prior?.revision ?? 0) + 1, accountId: d.accountId, personId: d.personId, space: input.space, status: 'active', confirmedAt: now, expiresAt: now + 30 * 86400_000, originBindingId: d.binding!.id });
      }
      d.receipts = d.receipts.filter(r => r.id !== input.receipt);
      if (input.state !== 'granted') this.invalidateExperience(d, input.space, input.purpose);
      this.bump(d, now); this.record(d, input.eventId, fingerprint, 'consent', permission.id);
      d.outbox.push({ eventId: input.eventId, kind: 'consent_changed', space: input.space, personId: d.personId,
        revision: d.revision, epoch: transition.permission.epoch, createdAt: now });
      return this.snapshot(d, input.space, now);
    });
  }
  private authorized(d: AdaptiveDocument, space: SpaceKind, memory: StoredMemory, operation: 'read' | 'contribute' | 'delete', now: number, agentId?: string): boolean {
    const base = { schemaVersion: 1 as const, revision: d.revision, createdAt: d.createdAt, updatedAt: d.updatedAt };
    const tenantId = tenantIdFor(d.accountId), spaceId = spaceIdFor(d.accountId, space), containerId = containerIdFor(d.accountId, space);
    const scope = { tenantId, spaceId };
    const resource: ResourceDescriptor = { ...base, ...scope, id: memory.id, revision: memory.revision, createdAt: memory.createdAt,
      updatedAt: memory.updatedAt, containerId, subjectPersonIds: [d.personId], status: memory.status, expiresAt: memory.expiresAt,
      revocationEpoch: memory.revocationEpoch };
    const request: AccessRequest = { identity: this.identity(d), ...scope, containerId, resourceId: memory.id, operation,
      purpose: 'explicit.memory_request', purposeVersion: 1, consentPolicyVersion: ADAPTIVE_POLICY_VERSION,
      audience: { kind: 'known', personIds: [d.personId] }, ...(agentId ? { agentId } : {}) };
    const snapshot: PolicySnapshot = { schemaVersion: 1, policyVersion: ADAPTIVE_POLICY_VERSION,
      account: { ...base, id: d.accountId, ownerPersonId: d.personId, status: 'active' },
      people: [{ ...base, id: d.personId, status: 'active' }], binding: d.binding,
      space: { ...base, id: spaceId, tenantId, kind: space, ownerAccountId: d.accountId, status: 'active', policyEpoch: 0 },
      container: { ...base, ...scope, id: containerId, audience: { kind: 'private', ownerPersonId: d.personId },
        status: 'active', policyEpoch: 0, spacePolicyEpoch: 0, historyPolicy: 'all_authorized_history' }, resource,
      memberships: [{ ...base, ...scope, id: `${containerId}:member`, containerId, personId: d.personId,
        status: 'active', joinedAt: d.createdAt, expiresAt: INFINITY, policyEpoch: 0 }],
      grants: [{ ...base, ...scope, id: `${containerId}:grant`, containerId, principal: { kind: 'person', id: d.personId },
        operations: ['read', 'contribute', 'delete'], purpose: 'explicit.memory_request', purposeVersion: 1,
        status: 'active', expiresAt: INFINITY, policyEpoch: 0 },
        ...(agentId ? d.agentGrants.filter(g => g.agentId === agentId && g.space === space && g.allowed).map(g => ({
          ...base, ...scope, id: `${containerId}:agent:${g.agentId}`, revision: g.revision, updatedAt: g.updatedAt, containerId,
          principal: { kind: 'agent' as const, id: agentId }, operations: ['read' as const], purpose: 'explicit.memory_request' as const,
          purposeVersion: 1, status: 'active' as const, expiresAt: INFINITY, policyEpoch: 0,
        })) : [])], consents: d.permissions };
    return memory.space === space && authorizeAccess(request, snapshot, now).allowed;
  }
  createMemory(telegramId: number, input: MemoryInput): Promise<AdaptiveSnapshot> {
    const memoryId = randomUUID();
    return this.transact(telegramId, (d, now) => {
      this.requirePerson(d, now);
      const fingerprint = digest(['memory', input]);
      if (this.event(d, input.eventId, fingerprint)) return this.snapshot(d, input.space, now);
      if (d.revision !== input.expectedRevision) return fail(409, 'revision_conflict');
      this.requireCapacity(d);
      if (d.memories.length >= 300) return fail(409, 'storage_capacity');
      if (!this.eligible(d, 'core_text', now).eligible) return fail(403, 'capability_unavailable');
      const memory: StoredMemory = { id: memoryId, revision: 1, space: input.space, text: input.text, status: 'active',
        createdAt: now, updatedAt: now, expiresAt: now + RETENTION, revocationEpoch: 0 };
      if (!this.authorized(d, input.space, memory, 'contribute', now)) return fail(403, 'access_denied');
      d.memories.push(memory); this.bump(d, now); this.record(d, input.eventId, fingerprint, 'memory', memory.id);
      return this.snapshot(d, input.space, now);
    });
  }
  private tombstone(d: AdaptiveDocument, memory: StoredMemory, now: number, eventId: string): void {
    memory.status = 'deleted'; delete memory.text; memory.revision++; memory.revocationEpoch++; memory.updatedAt = now;
    this.bump(d, now);
    d.outbox.push({ eventId, kind: 'memory_deleted', space: memory.space, personId: d.personId,
      revision: d.revision, memoryId: memory.id, epoch: memory.revocationEpoch, createdAt: now });
  }
  deleteMemory(telegramId: number, memoryId: string, input: DeletionInput): Promise<AdaptiveSnapshot> {
    return this.transact(telegramId, (d, now) => {
      this.requirePerson(d, now);
      const fingerprint = digest(['delete', memoryId, input]);
      if (this.event(d, input.eventId, fingerprint)) return this.snapshot(d, input.space, now);
      const memory = d.memories.find(m => m.id === memoryId && m.space === input.space);
      if (!memory || memory.status !== 'active') return fail(404, 'not_found');
      if (memory.revision !== input.expectedRevision) return fail(409, 'revision_conflict');
      if (!this.authorized(d, input.space, memory, 'delete', now)) return fail(403, 'access_denied');
      this.tombstone(d, memory, now, input.eventId); this.record(d, input.eventId, fingerprint, 'delete', memoryId);
      return this.snapshot(d, input.space, now);
    });
  }
  setAgentAccess(telegramId: number, agentId: string, input: AgentGrantInput): Promise<AdaptiveSnapshot> {
    return this.transact(telegramId, (d, now) => {
      this.requirePerson(d, now);
      const fingerprint = digest(['agent_grant', agentId, input]);
      if (this.event(d, input.eventId, fingerprint)) return this.snapshot(d, input.space, now);
      if (d.revision !== input.expectedRevision) return fail(409, 'revision_conflict');
      if (input.allowed) this.requireCapacity(d);
      const grant = d.agentGrants.find(g => g.agentId === agentId && g.space === input.space);
      if (!grant && d.agentGrants.length >= 100) return fail(409, 'storage_capacity');
      if (grant) { grant.allowed = input.allowed; grant.revision++; grant.updatedAt = now; }
      else d.agentGrants.push({ agentId, space: input.space, allowed: input.allowed, revision: 1, updatedAt: now });
      if (!input.allowed) for (const item of d.experience.inbox) if (item.space === input.space && item.agentId === agentId) { item.status = 'cancelled'; delete item.label; item.revision++; }
      this.bump(d, now); this.record(d, input.eventId, fingerprint, 'agent_grant', agentId);
      d.outbox.push({ eventId: input.eventId, kind: 'agent_grant_changed', space: input.space, personId: d.personId,
        revision: d.revision, agentId, epoch: grant?.revision ?? 1, createdAt: now });
      return this.snapshot(d, input.space, now);
    });
  }
  /** Runtime gets no private text from this helper. Legacy history cannot inherit consent. */
  runtimePrivacy = {
    read: async (personaId: string, legacyPersonId: string, space: SpaceKind = 'work'): Promise<{ revision: string; memoryEnabled: boolean; historyEnabled: boolean }> => {
      const match = /^tg-([1-9]\d*)$/.exec(legacyPersonId);
      if (!match) return { revision: 'unconfirmed', memoryEnabled: false, historyEnabled: false };
      return this.transact(Number(match[1]), (d, now) => {
        const consent = this.permission(d, space, 'optional.auto_memory');
        return { revision: digest([d.accountId, d.binding, this.confirmed(d, now), consent, this.eligible(d, 'auto_memory', now), d.agentGrants.filter(g => g.space === space && g.agentId === personaId)]),
          // Legacy unscoped stores have no authoritative source lineage: never unlock them.
          memoryEnabled: false, historyEnabled: false };
      });
    },
  };
  /** Authorized, fresh explicit-private context for the separately gated runtime path.
   * The caller must recheck returned revision before provider use/output. */
  readPrivateContext(telegramId: number, space: SpaceKind, agentId: string): Promise<{ revision: string; memories: { id: string; text: string }[] }> {
    return this.transact(telegramId, (d, now) => {
      const permission = this.permission(d, space, 'optional.personalization');
      const eligibility = this.eligible(d, 'personalization', now);
      const confirmed = this.confirmed(d, now);
      const allowed = confirmed && permission.state === 'granted' && permission.expiresAt > now && eligibility.eligible;
      const memories = allowed ? d.memories.filter(m => this.authorized(d, space, m, 'read', now, agentId)) : [];
      return { revision: digest([d.accountId, d.personId, space, agentId, d.binding, confirmed, permission, allowed, eligibility,
        d.agentGrants.filter(g => g.space === space && g.agentId === agentId),
        memories.map(m => [m.id, m.revision, m.expiresAt, m.revocationEpoch])]),
        memories: memories.map(m => ({ id: m.id, text: m.text! })) };
    });
  }
}
