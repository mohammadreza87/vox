import { mayUseStoredPersonalization, productPauseUseStamp } from '../product-pause/state';
import { randomUUID } from 'crypto';
import { brandError, publicDomainError } from '../../error-contract';
import { purgeInvalidDerivedMemory, validMemoryLineage } from '../reviewed-memory/provenance';
import { transitionConsent } from '../consent';
import { evaluateCapability, type Capability, type CapabilityRequest, type JurisdictionApproval } from '../eligibility';
import { resolveVerifiedPerson } from '../identity';
import { authorizeAccess } from '../policy';
import type { AccessRequest, ConsentPermission, IdentityContext, PolicySnapshot, ResourceDescriptor } from '../types';
import { ADAPTIVE_POLICY_VERSION, OPTIONAL_PURPOSES, AdaptiveRepository, accountIdFor, containerIdFor, digest,
  spaceIdFor, tenantIdFor, type AdaptiveAuthorityDocument, type AdaptiveDocument, type OptionalPurpose, type SpaceKind, type StoredMemory } from './repository';
import type { AdaptiveNotice, AdaptiveSnapshot, AdaptivePresentation } from './contracts';
import { correctionInput, type CorrectionInput } from './validation';
import type { AgentGrantInput, ConsentInput, DeletionInput, IdentityInput, MemoryInput, PresentInput } from './validation';
import { sweepObserverDocument } from '../observation/helpers';
import { pruneLearningDocument } from '../personalization/learning/state';
import { runtimeControlsFromDocument, runtimeControlsFromIndexed, validateRuntimeControlEvaluation,
  directAuthorityControls, type DirectAuthorityEvaluator, type RuntimeControlEvaluation, type RuntimeControlEvaluator } from './authority';
import { readIndexedPrivateContext, type PrivateContextSnapshot } from './indexed-private-context';

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
  private preferenceLearningAuthority?: (telegramId: number, agentId: string) => string | null;
  setPreferenceLearningAuthority(handler: (telegramId: number, agentId: string) => string | null): void { this.preferenceLearningAuthority = handler; }
  private preferenceLearningInvalidator?: (telegramId: number) => void;
  setPreferenceLearningInvalidator(handler: (telegramId: number) => void): void { this.preferenceLearningInvalidator = handler; }
  setVoiceIdentityInvalidator(handler: (input: { telegramId: number; space?: SpaceKind; reason: string }) => Promise<void>): void { this.voiceIdentityInvalidator = handler; }
  setRelationshipInvalidator(handler: (input: RelationshipInvalidation) => Promise<void>): void { this.relationshipInvalidator = handler; }
  async notifyRelationshipInvalidation(input: RelationshipInvalidation): Promise<void> { await this.relationshipInvalidator?.(input); }
  constructor(readonly repository: AdaptiveRepository, private readonly options: AdaptiveServiceOptions = {}) { this.now = options.now ?? Date.now; }
  /** Record a trusted clock observation, never a deadline or document timestamp.
   * Managed writers latch this without I/O; original FILE behavior is unchanged. */
  sampleClock(clock: () => number): number { return this.repository.storage.sampleClock?.(clock) ?? clock(); }
  /** Opt-in pure authority evaluation after clock publication. Unlike a bare
   * clock read, the declared deadline fences publication and evaluation time. */
  evaluateAuthorityClock<T>(clock: () => number, evaluate: (now: number) => RuntimeControlEvaluation<T>): T {
    let observed = this.sampleClock(clock);
    const publish = () => { this.sampleClock(() => observed); };
    const fresh = () => {
      let value: number;
      try { value = clock(); } catch (error) { publish(); throw error; }
      if (!Number.isSafeInteger(value) || value < observed) { publish(); return fail(503, 'adaptive_controls_unavailable'); }
      observed = value; return value;
    };
    let result: RuntimeControlEvaluation<T>;
    try { result = validateRuntimeControlEvaluation<T>(evaluate(fresh())); }
    catch (error) { publish(); throw error; }
    const after = fresh();
    if (!result.denied && result.deadline !== undefined && result.deadline <= after) { publish(); return fail(503, 'adaptive_controls_unavailable'); }
    if (result.denied || result.observedDenial) {
      publish();
      const final = fresh();
      if (!result.denied && result.deadline !== undefined && result.deadline <= final) { publish(); return fail(503, 'adaptive_controls_unavailable'); }
    }
    return result.value;
  }
  /** Stable receipt namespace, safe inside a writer. This is not access authority. */
  get storeIdentity(): string {
    const identity = this.repository.storage.identity ?? this.repository.storage.indexed?.identity;
    return identity ? digest([identity.incarnation, identity.generation]) : 'canonical';
  }
  private account(telegramId: number): string {
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return fail(401, 'authentication_required');
    return accountIdFor(telegramId);
  }
  private async transact<T>(telegramId: number, fn: (d: AdaptiveDocument, now: number) => T, beforeCommit?: () => void): Promise<T> {
    const invalidations: RelationshipInvalidation[] = [];
    const voiceInvalidations: Array<{ telegramId: number; space?: SpaceKind; reason: string }> = [];
    let learningChanged = false;
    const result = await this.repository.transaction(this.account(telegramId), this.now, (d, now) => {
      invalidations.length = 0;
      voiceInvalidations.length = 0;
      const learningControl = () => digest([d.binding, d.permissions.filter(p => p.purpose === 'optional.personalization'),
        d.agentGrants, d.experience.preferences, d.experience.preferenceLearning?.intents,
        d.schemaVersion === 2 ? ['work', 'personal'].map(s => productPauseUseStamp(d, s as SpaceKind)) : null]);
      const priorLearning = learningControl();
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
      const priorMemories = new Map(d.memories.map(m => [m.id, { status: m.status, revision: m.revision }]));
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
      if (purgeInvalidDerivedMemory(d, now)) this.bump(d, now);
      if (sweepObserverDocument(d, now, (doc, space, agentId, time) =>
        this.isPurposeAllowed(doc, space, 'optional.product_analytics', time, agentId), this.storeIdentity)) this.bump(d, now);
      if (pruneLearningDocument(this, d, now, this.preferenceLearningAuthority ? agentId => this.preferenceLearningAuthority!(telegramId, agentId) : undefined)) this.bump(d, now);
      const value = fn(d, now);
      if (pruneLearningDocument(this, d, now, this.preferenceLearningAuthority ? agentId => this.preferenceLearningAuthority!(telegramId, agentId) : undefined)) this.bump(d, now);
      learningChanged = priorLearning !== learningControl();
      if (purgeInvalidDerivedMemory(d, now)) this.bump(d, now);
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
        for (const m of d.memories) if (priorMemories.get(m.id)?.status === 'active') {
          if (m.status === 'deleted' && !invalidations.some(i => i.space === m.space && i.reason === 'source_memory_deleted' && !i.agentId && !i.sourceIds)) enqueue(m.space, 'source_memory_deleted');
          else if (m.status === 'active' && priorMemories.get(m.id)!.revision !== m.revision && !invalidations.some(i => i.space === m.space && i.reason === 'source_memory_corrected' && !i.agentId && !i.sourceIds)) enqueue(m.space, 'source_memory_corrected');
        }
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
        this.isPurposeAllowed(doc, space, 'optional.product_analytics', time, agentId), this.storeIdentity);
      if ((observerChanged || priorRelationships !== digest(d.relationships)) && d.revision === priorRevision) this.bump(d, now);
      return value;
    }, beforeCommit);
    if (learningChanged) this.preferenceLearningInvalidator?.(telegramId);
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
  private identity(d: AdaptiveAuthorityDocument): IdentityContext {
    const binding = d.binding;
    return { authenticatedAccountId: d.accountId, ...(binding ? { selectedPerson: {
      personId: d.personId, bindingId: binding.id, bindingRevision: binding.revision,
    } } : {}) };
  }
  private confirmed(d: AdaptiveAuthorityDocument, now: number): boolean {
    return !!resolveVerifiedPerson(this.identity(d), { schemaVersion: 1, id: d.accountId, revision: 1,
      createdAt: d.createdAt, updatedAt: d.createdAt, status: 'active', ownerPersonId: d.personId }, d.binding, now);
  }
  private requirePerson(d: AdaptiveAuthorityDocument, now: number): void {
    if (!this.confirmed(d, now)) fail(403, 'profile_confirmation_required');
  }
  private eligible(d: AdaptiveAuthorityDocument, capability: Capability, now: number): { eligible: boolean; reason?: string; validUntil?: number; approvalVersions?: readonly string[] } {
    // Enrollment/provider/communications release gates have no implementation in this slice.
    if (capability === 'content_quality_review' || (capability === 'biometric_recognition' && this.options.voiceRecognitionEnabled !== true) ||
        (['auto_memory', 'relationship_outreach'].includes(capability) && this.options.scopedRelationshipsEnabled !== true) ||
        (['reminder_delivery', 'proactive_suggestions'].includes(capability) && this.options.inboxEnabled !== true)) return { eligible: false, reason: 'feature_not_released' };
    const policy = this.options.capabilityPolicy?.({ accountId: d.accountId, personId: d.personId, capability, declaration: d.declaration }, now);
    if (!policy || policy.request.personId !== d.personId || policy.request.capability !== capability) return { eligible: false, reason: 'approval_missing' };
    return evaluateCapability(policy.request, policy.approvals, now);
  }
  capabilityStatus(d: AdaptiveAuthorityDocument, capability: Capability, now: number): { eligible: boolean; reason?: string; validUntil?: number; approvalVersions?: readonly string[] } {
    return this.eligible(d, capability, now);
  }
  /** Trusted backend seam: same aggregate/expiry transaction as consent and memory. */
  withAccountDocument<T>(telegramId: number, fn: (document: AdaptiveDocument, now: number) => T, beforeCommit?: () => void): Promise<T> {
    return this.transact(telegramId, fn, beforeCommit);
  }
  /** Bounded protective controls bypass generic event/outbox admission and never invoke consent invalidation. */
  productPauseTransaction<T>(telegramId: number, fn: (document: AdaptiveDocument, now: number) => T, beforeCommit?: () => void): Promise<T> {
    return this.repository.transaction(this.account(telegramId), this.now, fn, beforeCommit);
  }
  sampleServiceClock(): number { return this.sampleClock(this.now); }
  notifyProductPauseCommitted(telegramId: number): void { this.preferenceLearningInvalidator?.(telegramId); }
  /** Current-input authority never needs stored note/preference/relationship payloads in prepared stores. */
  async withDirectAuthority<T>(telegramId: number, space: SpaceKind, fn: DirectAuthorityEvaluator<T>): Promise<T> {
    if (this.repository.storage.indexed || this.repository.storage.canonicalSchemaVersion === 2) {
      const result = this.readDirectAuthorityForEffect(telegramId, space, fn);
      if (result.status !== 'ready') return fail(503, 'adaptive_controls_unavailable');
      return result.value;
    }
    return this.withAccountDocument(telegramId, (d, now) => this.evaluateAuthorityClock(this.now,
      fresh => fn(directAuthorityControls(d), Math.max(now, fresh), this.storeIdentity, undefined)));
  }
  readDirectAuthorityForEffect<T>(telegramId: number, space: SpaceKind, fn: DirectAuthorityEvaluator<T>):
    { status: 'ready'; value: T } | { status: 'busy' | 'unsupported' | 'missing' } {
    const storage = this.repository.storage;
    if (storage.canonicalSchemaVersion === 2 && !storage.indexed &&
        (storage.fileAuthorityProjectionVersion !== 1 || !storage.readDirectAuthorityForEffect)) return { status: 'unsupported' };
    if (storage.canonicalSchemaVersion === 2 && storage.readDirectAuthorityForEffect) {
      try { return storage.readDirectAuthorityForEffect(this.account(telegramId), space, fn); }
      catch { return { status: 'busy' }; }
    }
    if (storage.indexed) return this.readRuntimeControlsForEffect(telegramId, space,
      (d, now, identity, stamp) => fn(directAuthorityControls(d), now, identity, stamp));
    return this.readCommittedAuthorityForEffect(telegramId, this.now,
      (d, now) => fn(directAuthorityControls(d), now, this.storeIdentity, undefined));
  }
  /** Pure authority consumers use compact controls on an explicitly selected
   * indexed store. Mutations and detailed UI snapshots retain the canonical API.
   * The callback must be synchronous. Store identity must bind retained work. */
  async withRuntimeControls<T>(telegramId: number, space: SpaceKind, fn: RuntimeControlEvaluator<T>): Promise<T> {
    if (!this.repository.storage.indexed) {
      // The fallback may await canonical durability. Suppress an expired result
      // again after that I/O; managed FILE publishes its lifecycle watermark.
      let evaluated: RuntimeControlEvaluation<T> | undefined; let observedAt = 0;
      const result = await this.transact(telegramId, (d, now) => {
        observedAt = now;
        evaluated = validateRuntimeControlEvaluation<T>(fn(runtimeControlsFromDocument(d), now, this.storeIdentity, undefined));
        this.checkRuntimeEvaluation(evaluated, now);
        return evaluated.value;
      });
      this.checkRuntimeEvaluation(evaluated!, observedAt, true);
      return result;
    }
    const result = this.readRuntimeControlsForEffect(telegramId, space, fn);
    return result.status === 'ready' ? Promise.resolve(result.value) : Promise.reject(new AdaptiveError(503, 'adaptive_controls_unavailable'));
  }
  /** Synchronous current-state controls for the configured provider export fence.
   * Evaluators are pure, body-free and synchronous. A denial remains a data result;
   * it never grants private-body access or authorizes an external side effect. */
  readRuntimeControlsForEffect<T>(telegramId: number, space: SpaceKind, fn: RuntimeControlEvaluator<T>):
    { status: 'ready'; value: T } | { status: 'busy' | 'unsupported' | 'missing' } {
    const indexed = this.repository.storage.indexed;
    if (!indexed) {
      try {
        return this.readCommittedAuthorityForEffect(telegramId, this.now,
          (d, now) => fn(runtimeControlsFromDocument(d), now, this.storeIdentity, undefined));
      } catch { return { status: 'busy' }; }
    }
    let evaluation: RuntimeControlEvaluation<T> | undefined;
    const snapshot = indexed.readControls(this.account(telegramId), space, (controls, now, stamp) => {
      evaluation = validateRuntimeControlEvaluation<T>(fn(runtimeControlsFromIndexed(controls), now,
        digest([stamp.incarnation, stamp.generation]), stamp));
      return { ...(evaluation.deadline === undefined ? {} : { deadline: evaluation.deadline }),
        ...(evaluation.denied === undefined ? {} : { denied: evaluation.denied }),
        ...(evaluation.observedDenial === undefined ? {} : { observedDenial: evaluation.observedDenial }) };
    });
    if (snapshot.status !== 'ready' || !evaluation) return { status: snapshot.status !== 'ready' && snapshot.reason === 'missing' ? 'missing' : 'busy' };
    return { status: 'ready', value: evaluation.value };
  }
  private checkRuntimeEvaluation<T>(evaluation: RuntimeControlEvaluation<T>, observedAt: number, publish = false): void {
    const observed = publish ? this.now() : this.sampleClock(this.now);
    if (!Number.isSafeInteger(observed) || observed < observedAt) fail(503, 'adaptive_controls_unavailable');
    if (publish) this.repository.storage.observeLifecycleTime?.(observed);
    const fresh = publish ? this.now() : this.sampleClock(this.now);
    if (!Number.isSafeInteger(fresh) || fresh < observed ||
        (!evaluation.denied && evaluation.deadline !== undefined && evaluation.deadline <= fresh)) {
      // Publication itself may cross a deadline. Retain that denial observation
      // before returning unavailable, so a regressed clock cannot revive it.
      if (publish && Number.isSafeInteger(fresh) && fresh >= observed) this.repository.storage.observeLifecycleTime?.(fresh);
      fail(503, 'adaptive_controls_unavailable');
    }
  }
  /** Validated committed file snapshot only. No mutation or awaited work. */
  readCommittedForEffect<T>(telegramId: number, fn: (document: AdaptiveDocument, now: number) => T):
    { status: 'ready'; value: T } | { status: 'busy' | 'unsupported' | 'missing' } {
    const snapshot = this.repository.readCommittedForEffect(this.account(telegramId), this.now);
    if (snapshot.status !== 'ready') return snapshot;
    if (!snapshot.document) return { status: 'missing' };
    // Synchronous disk/schema work can itself cross an authority deadline.
    return { status: 'ready', value: fn(snapshot.document, this.now()) };
  }
  /** Explicit complete-document authority seam. Generic committed reads never
   * infer denial or deadlines from an arbitrary return value. */
  readCommittedAuthorityForEffect<T>(telegramId: number, clock: (() => number) | undefined,
    evaluate: (document: AdaptiveDocument, now: number) => RuntimeControlEvaluation<T>):
    { status: 'ready'; value: T } | { status: 'busy' | 'unsupported' | 'missing' } {
    return this.readCommittedForEffect(telegramId, document => this.evaluateAuthorityClock(clock ?? this.now, now => evaluate(document, now)));
  }
  isProfileConfirmed(d: AdaptiveAuthorityDocument, now: number): boolean { return this.confirmed(d, now); }
  isCoreAllowed(d: AdaptiveAuthorityDocument, now: number): boolean { return this.confirmed(d, now) && this.eligible(d, 'core_text', now).eligible; }
  purposeRetentionFingerprint(d: AdaptiveAuthorityDocument, space: SpaceKind, purpose: OptionalPurpose, now: number, agentId?: string): string {
    return digest([d.accountId, d.binding, this.confirmed(d, now),
      space, purpose, agentId, this.permission(d, space, purpose), this.eligible(d, CAPABILITY[purpose], now),
      agentId ? d.agentGrants.filter(g => g.space === space && g.agentId === agentId) : null]);
  }
  isStoredPersonalizationUseAllowed(d: AdaptiveAuthorityDocument, space: SpaceKind): boolean { return mayUseStoredPersonalization(d, space); }
  purposeFingerprint(d: AdaptiveAuthorityDocument, space: SpaceKind, purpose: OptionalPurpose, now: number, agentId?: string): string {
    const retention = this.purposeRetentionFingerprint(d, space, purpose, now, agentId);
    return d.schemaVersion === 1 || !this.pauseCoveredPurpose(purpose) ? retention : digest([retention, productPauseUseStamp(d, space)]);
  }
  private pauseCoveredPurpose(purpose: OptionalPurpose): boolean {
    return ['optional.personalization', 'optional.auto_memory', 'optional.proactive_suggestions', 'optional.relationship_outreach'].includes(purpose);
  }
  /** Primary source retention/management remains independent from voluntary use suspension. */
  isPurposeRetentionAllowed(d: AdaptiveAuthorityDocument, space: SpaceKind, purpose: OptionalPurpose, now: number, agentId?: string): boolean {
    const permission = this.permission(d, space, purpose);
    return this.confirmed(d, now) && this.eligible(d, CAPABILITY[purpose], now).eligible &&
      permission.state === 'granted' && permission.expiresAt > now &&
      (!agentId || d.agentGrants.some(g => g.space === space && g.agentId === agentId && g.allowed));
  }
  coreFingerprint(d: AdaptiveAuthorityDocument, now: number): string {
    return digest([d.accountId, d.binding, this.confirmed(d, now), this.eligible(d, 'core_text', now)]);
  }
  /** Explicit preferences may be saved as a user directive. Applying them to an
   * agent still requires current optional purpose consent and an exact grant. */
  isPurposeAllowed(d: AdaptiveAuthorityDocument, space: SpaceKind, purpose: OptionalPurpose, now: number, agentId?: string): boolean {
    return (!this.pauseCoveredPurpose(purpose) || this.isStoredPersonalizationUseAllowed(d, space)) &&
      this.isPurposeRetentionAllowed(d, space, purpose, now, agentId);
  }

  private permission(d: AdaptiveAuthorityDocument, space: SpaceKind, purpose: OptionalPurpose): ConsentPermission {
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
  /** Current authorized, valid-lineage projection only. Never persist inherited
   * labels or reuse this invocation-local set across source/authority changes. */
  private reviewedClaimOrigins(memories: readonly StoredMemory[]): Set<string> {
    const claims = new Set(memories.filter(memory => memory.origin === 'user_reviewed_claim').map(memory => memory.id));
    // Valid lineage is at most eight nodes deep. Fixed-point propagation is
    // bounded even for reverse-ordered shared DAGs; it never changes rows.
    for (let depth = 0; depth < 8; depth++) {
      let changed = false;
      for (const memory of memories) if (!claims.has(memory.id) && memory.sourceRefs?.some(ref => claims.has(ref.id))) {
        claims.add(memory.id); changed = true;
      }
      if (!changed) break;
    }
    return claims;
  }
  private authoritySnapshot(d: AdaptiveAuthorityDocument & Pick<AdaptiveDocument, 'revision'>,
    space: SpaceKind, now: number, locale: 'en' | 'fa' = 'en'): AdaptiveSnapshot {
    const confirmed = this.confirmed(d, now);
    const memory = this.eligible(d, 'core_text', now);
    return { schemaVersion: 1, identity: { accountId: d.accountId, confirmed,
      verification: confirmed ? 'account_confirmation' : 'unconfirmed', adultDeclared: d.declaration?.adultConfirmed === true,
      ...(d.declaration?.declaredJurisdiction ? { declaredJurisdiction: d.declaration.declaredJurisdiction } : {}),
      ...(confirmed ? { personId: d.personId, bindingId: d.binding!.id, bindingRevision: d.binding!.revision,
        bindingExpiresAt: d.binding!.expiresAt, bindingCreatedAt: d.binding!.createdAt,
        bindingUpdatedAt: d.binding!.updatedAt, bindingVerifiedAt: d.binding!.verifiedAt } : {}) },
      ...(d.schemaVersion === 2 ? { storedPersonalizationUseStamp: productPauseUseStamp(d, space), storedPersonalizationAllowed: this.isStoredPersonalizationUseAllowed(d, space) } : {}),
      space, revision: d.revision, scope: 'private_account_profile',
      purposes: OPTIONAL_PURPOSES.map(purpose => {
        const permission = this.permission(d, space, purpose), eligibility = this.eligible(d, CAPABILITY[purpose], now);
        return { purpose, state: permission.state === 'granted' && permission.expiresAt <= now ? 'expired' : permission.state,
          revision: permission.revision, available: confirmed && eligibility.eligible,
          ...(!confirmed ? { reason: 'profile_confirmation_required' } : !eligibility.eligible ? { reason: eligibility.reason } : {}), notice: adaptiveNotice(purpose, locale) };
      }),
      memories: [],
      agents: confirmed ? d.agentGrants.filter(g => g.space === space).map(g => ({ agentId: g.agentId, allowed: g.allowed, revision: g.revision })) : [],
      explicitMemoryAvailable: confirmed && memory.eligible,
      memoryCorrectionAvailable: confirmed && memory.eligible && this.repository.storage.supportsCommittedWriteFence === true && !!this.repository.storage.readCommittedForEffect,
      ...(memory.eligible && memory.validUntil !== undefined ? { explicitMemoryValidUntil: memory.validUntil } : {}),
      ...(!confirmed ? { explicitMemoryReason: 'profile_confirmation_required' } : !memory.eligible ? { explicitMemoryReason: memory.reason } : {}),
    };
  }
  private snapshot(d: AdaptiveDocument, space: SpaceKind, now: number, locale: 'en' | 'fa' = 'en'): AdaptiveSnapshot {
    const authority = this.authoritySnapshot(d, space, now, locale);
    const memories = authority.identity.confirmed ? d.memories.filter(m => m.space === space && validMemoryLineage(d, m, now))
      .filter(m => this.authorized(d, space, m, 'read', now)) : [];
    const claimOrigins = this.reviewedClaimOrigins(memories);
    return { ...authority, memories: memories.map(m => ({ id: m.id, revision: m.revision, text: m.text!, createdAt: m.createdAt, expiresAt: m.expiresAt,
      ...(claimOrigins.has(m.id) ? { origin: 'user_reviewed_claim' as const } : {}), ...(m.sourceRefs ? { sourceRefs: m.sourceRefs } : {}) })) };
  }
  read(telegramId: number, space: SpaceKind, locale: 'en' | 'fa' = 'en'): Promise<AdaptiveSnapshot> {
    return this.transact(telegramId, (d, now) => this.snapshot(d, space, now, locale));
  }
  /** Indexed mode reads compact controls only. The FILE compatibility path keeps
   * its existing canonical lifecycle sweep; neither projection returns bodies. */
  readAuthority(telegramId: number, space: SpaceKind, locale: 'en' | 'fa' = 'en'): Promise<AdaptiveSnapshot> {
    if (!this.repository.storage.indexed && this.repository.storage.canonicalSchemaVersion !== 2) return this.transact(telegramId, (d, now) => this.authoritySnapshot(d, space, now, locale));
    return this.withDirectAuthority(telegramId, space, (d, now) => this.authorityEvaluation(d, space, now, locale));
  }
  /** Exact authority projection at the configured transport boundary. */
  readAuthorityNow(telegramId: number, space: SpaceKind, locale: 'en' | 'fa' = 'en'): AdaptiveSnapshot & { validUntil: number } {
    const current = this.readDirectAuthorityForEffect(telegramId, space, (d, now) => {
      const evaluation = this.authorityEvaluation(d, space, now, locale);
      return { ...evaluation, value: { ...evaluation.value, validUntil: evaluation.deadline ?? INFINITY } };
    });
    return current.status === 'ready' ? current.value : fail(503, 'adaptive_controls_unavailable');
  }
  private authorityEvaluation(d: AdaptiveAuthorityDocument & Pick<AdaptiveDocument, 'revision'>,
    space: SpaceKind, now: number, locale: 'en' | 'fa'): RuntimeControlEvaluation<AdaptiveSnapshot> {
    const confirmed = this.confirmed(d, now);
    const statuses = ['core_text' as const, ...Object.values(CAPABILITY)].map(c => this.eligible(d, c, now));
    return { value: this.authoritySnapshot(d, space, now, locale), denied: !confirmed,
      observedDenial: statuses.some(status => !status.eligible) || d.permissions.some(p => p.spaceId === spaceIdFor(d.accountId, space) && p.state === 'granted' && p.expiresAt <= now),
      ...(confirmed ? { deadline: Math.min(d.binding!.expiresAt,
        ...d.permissions.filter(p => p.spaceId === spaceIdFor(d.accountId, space) && p.state === 'granted' && p.expiresAt > now).map(p => p.expiresAt),
        ...statuses.flatMap(s => s.eligible && s.validUntil !== undefined ? [s.validUntil] : [])) } : {}) };
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
  private authorized(d: AdaptiveDocument, space: SpaceKind, memory: StoredMemory, operation: 'read' | 'contribute' | 'edit' | 'delete', now: number, agentId?: string): boolean {
    if (operation === 'read' && !validMemoryLineage(d, memory, now)) return false;
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
        operations: ['read', 'contribute', 'edit', 'delete'], purpose: 'explicit.memory_request', purposeVersion: 1,
        status: 'active', expiresAt: INFINITY, policyEpoch: 0 },
        ...(agentId ? d.agentGrants.filter(g => g.agentId === agentId && g.space === space && g.allowed).map(g => ({
          ...base, ...scope, id: `${containerId}:agent:${g.agentId}`, revision: g.revision, updatedAt: g.updatedAt, containerId,
          principal: { kind: 'agent' as const, id: agentId }, operations: ['read' as const], purpose: 'explicit.memory_request' as const,
          purposeVersion: 1, status: 'active' as const, expiresAt: INFINITY, policyEpoch: 0,
        })) : [])], consents: d.permissions };
    return memory.space === space && authorizeAccess(request, snapshot, now).allowed;
  }
  /** Trusted explicit-request service seam; optional purposes are not inferred. */
  isExplicitMemoryAllowed(d: AdaptiveDocument, space: SpaceKind, memory: StoredMemory, operation: 'read' | 'contribute', now: number, agentId?: string): boolean {
    return this.authorized(d, space, memory, operation, now, agentId);
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
  /** Ordinary own notes and explicitly reviewed claims only. No supersession
   * copy or retention extension; derived summaries are retired in this commit. */
  correctMemory(telegramId: number, memoryId: string, value: CorrectionInput,
    options: { authorizeNow(): boolean; signal?: AbortSignal }): Promise<AdaptiveSnapshot> {
    const input = correctionInput.parse(value);
    if (this.repository.storage.supportsCommittedWriteFence !== true || !this.repository.storage.readCommittedForEffect) return Promise.reject(new AdaptiveError(503, 'memory_correction_unavailable'));
    let draft: AdaptiveDocument | undefined, core: string | undefined, replay = false;
    return this.transact(telegramId, (d, now) => {
      draft = d; this.requirePerson(d, now);
      if (!this.isCoreAllowed(d, now) || options.signal?.aborted || !options.authorizeNow()) return fail(403, 'access_denied');
      core = this.coreFingerprint(d, now);
      const fingerprint = digest(['memory-correction-v1', memoryId, input]);
      // A replay reports current state. It never replays the historical text,
      // including after another correction, expiry or deletion.
      if (this.event(d, input.eventId, fingerprint)) { replay = true; return this.snapshot(d, input.space, now); }
      const memory = d.memories.find(row => row.id === memoryId && row.space === input.space);
      if (!memory || memory.status !== 'active' || memory.expiresAt <= now) return fail(404, 'not_found');
      if (memory.sourceRefs) return fail(409, 'derived_memory_not_editable');
      if (memory.revision !== input.expectedRevision) return fail(409, 'revision_conflict');
      if (!this.authorized(d, input.space, memory, 'edit', now)) return fail(403, 'access_denied');
      if (memory.text === input.text) return fail(409, 'memory_unchanged');
      this.requireCapacity(d);
      memory.text = input.text; memory.revision++; memory.revocationEpoch++; memory.updatedAt = now;
      this.bump(d, now);
      purgeInvalidDerivedMemory(d, now, descendant => {
        d.outbox.push({ eventId: `correction-derived:${digest([input.eventId, descendant.id])}`, kind: 'memory_deleted', space: descendant.space,
          personId: d.personId, revision: d.revision, memoryId: descendant.id, epoch: descendant.revocationEpoch, createdAt: now });
      });
      this.record(d, input.eventId, fingerprint, 'memory_corrected', memory.id);
      return this.snapshot(d, input.space, now);
    }, () => {
      // Studio I/O precedes fresh canonical deadlines immediately before rename.
      const authority = options.authorizeNow(), now = this.sampleClock(this.now);
      if (!draft || !authority || options.signal?.aborted || !this.isCoreAllowed(draft, now) || this.coreFingerprint(draft, now) !== core) return fail(409, 'memory_correction_changed');
      if (!replay) {
        const memory = draft.memories.find(row => row.id === memoryId && row.space === input.space);
        if (!memory || !this.authorized(draft, input.space, memory, 'edit', now)) return fail(409, 'memory_correction_changed');
      }
    });
  }
  memorySnapshotCurrentNow(telegramId: number, snapshot: AdaptiveSnapshot, locale: 'en' | 'fa'): boolean {
    const current = this.readCommittedAuthorityForEffect(telegramId, this.now, (d, now) => {
      const authority = this.authorityEvaluation(d, snapshot.space, now, locale);
      const value = digest(this.snapshot(d, snapshot.space, now, locale)) === digest(snapshot);
      const expiries = d.memories.filter(m => m.space === snapshot.space && m.status === 'active').map(m => m.expiresAt);
      return { ...authority, value, observedDenial: authority.observedDenial || !value || expiries.some(at => at <= now),
        ...(authority.deadline === undefined ? {} : { deadline: Math.min(authority.deadline, ...expiries.filter(at => at > now)) }) };
    });
    return current.status === 'ready' && current.value;
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
  private runtimePrivacyEvaluation(d: AdaptiveAuthorityDocument, now: number, namespace: string, personaId: string,
    space: SpaceKind): RuntimeControlEvaluation<{ revision: string; memoryEnabled: boolean; historyEnabled: boolean; storedContextAllowed: boolean }> {
    const consent = this.permission(d, space, 'optional.auto_memory'), eligible = this.eligible(d, 'auto_memory', now);
    const confirmed = this.confirmed(d, now);
    const parts: unknown[] = [d.accountId, d.binding, confirmed, consent, eligible, d.agentGrants.filter(g => g.space === space && g.agentId === personaId)];
    if (d.schemaVersion === 2) parts.push(productPauseUseStamp(d, space));
    return { value: { revision: digest(namespace === 'canonical' ? parts : [namespace, ...parts]), memoryEnabled: false, historyEnabled: false, storedContextAllowed: this.isStoredPersonalizationUseAllowed(d, space) },
      denied: !confirmed, observedDenial: !eligible.eligible || consent.state === 'granted' && consent.expiresAt <= now,
      ...(confirmed ? { deadline: Math.min(d.binding!.expiresAt, eligible.validUntil ?? INFINITY) } : {}) };
  }
  /** Runtime gets no private text from this helper. Legacy history cannot inherit consent. */
  runtimePrivacy = {
    read: async (personaId: string, legacyPersonId: string, space: SpaceKind = 'work'): Promise<{ revision: string; memoryEnabled: boolean; historyEnabled: boolean; storedContextAllowed: boolean }> => {
      const match = /^tg-([1-9]\d*)$/.exec(legacyPersonId);
      if (!match) return { revision: 'unconfirmed', memoryEnabled: false, historyEnabled: false, storedContextAllowed: false };
      if (this.repository.storage.indexed || this.repository.storage.canonicalSchemaVersion === 2) return this.withDirectAuthority(Number(match[1]), space,
        (d, now, namespace) => this.runtimePrivacyEvaluation(d, now, namespace, personaId, space));
      return this.transact(Number(match[1]), (d, now) => this.runtimePrivacyEvaluation(d, now, this.storeIdentity, personaId, space).value);
    },
    readNow: (personaId: string, legacyPersonId: string, space: SpaceKind = 'work'): { revision: string; memoryEnabled: boolean; historyEnabled: boolean; storedContextAllowed: boolean; validUntil: number } => {
      const match = /^tg-([1-9]\d*)$/.exec(legacyPersonId);
      if (!match) return { revision: 'unconfirmed', memoryEnabled: false, historyEnabled: false, storedContextAllowed: false, validUntil: INFINITY };
      const result = this.readDirectAuthorityForEffect(Number(match[1]), space,
        (d, now, namespace) => {
          const evaluation = this.runtimePrivacyEvaluation(d, now, namespace, personaId, space);
          return { ...evaluation, value: { ...evaluation.value, validUntil: evaluation.deadline ?? INFINITY } };
        });
      return result.status === 'ready' ? result.value : fail(503, 'adaptive_controls_unavailable');
    },
  };
  /** Authorized, fresh explicit-private context for the separately gated runtime path.
   * The caller must recheck returned revision before provider use/output. */
  readPrivateContext(telegramId: number, space: SpaceKind, agentId: string, query = ''): Promise<PrivateContextSnapshot> {
    if (this.repository.storage.indexed) {
      try { return Promise.resolve(readIndexedPrivateContext(this, telegramId, space, agentId, query)); }
      catch { return Promise.reject(new AdaptiveError(503, 'adaptive_context_unavailable')); }
    }
    return this.transact(telegramId, (d, now) => this.canonicalPrivateContext(d, now, space, agentId));
  }
  private canonicalPrivateContext(d: AdaptiveDocument, now: number, space: SpaceKind, agentId: string): PrivateContextSnapshot {
    const permission = this.permission(d, space, 'optional.personalization');
    const eligibility = this.eligible(d, 'personalization', now);
    const confirmed = this.confirmed(d, now);
    const allowed = confirmed && permission.state === 'granted' && permission.expiresAt > now && eligibility.eligible && this.isStoredPersonalizationUseAllowed(d, space);
    const authorized = allowed ? d.memories.filter(m => this.authorized(d, space, m, 'read', now, agentId)) : [];
    const byId = new Map(authorized.map(memory => [memory.id, memory]));
    const claimOrigins = this.reviewedClaimOrigins(authorized);
    const ancestors = (memory: StoredMemory, ids = new Set<string>()): string[] => {
      for (const ref of memory.sourceRefs ?? []) {
        if (ids.has(ref.id)) continue;
        ids.add(ref.id);
        const source = byId.get(ref.id);
        if (source) ancestors(source, ids);
      }
      return [...ids];
    };
    const revision = digest([d.accountId, d.personId, space, agentId, d.binding, confirmed, permission, allowed, eligibility,
      d.agentGrants.filter(g => g.space === space && g.agentId === agentId),
      authorized.map(m => [m.id, m.revision, m.expiresAt, m.revocationEpoch, m.sourceRefs, m.origin]),
      ...(d.schemaVersion === 2 ? [productPauseUseStamp(d, space)] : [])]);
    return { revision: this.storeIdentity === 'canonical' ? revision : digest([this.storeIdentity, revision]),
      memories: authorized.map(m => {
        const sourceIds = m.sourceRefs ? ancestors(m) : undefined;
        const claim = claimOrigins.has(m.id);
        return { id: m.id, text: claim ? `User-reviewed claim (not independently verified): ${m.text!}` : m.text!, ...(sourceIds ? { sourceIds } : {}) };
      }) };
  }
  /** Same full private catalog/authority revision, without candidate or body
   * reads in indexed mode. Rechecks never rehydrate previously selected text. */
  async readPrivateContextAuthority(telegramId: number, space: SpaceKind, agentId: string): Promise<{ revision: string }> {
    if (!this.repository.storage.indexed) return { revision: (await this.readPrivateContext(telegramId, space, agentId)).revision };
    return { revision: this.readPrivateContextAuthorityNow(telegramId, space, agentId).revision };
  }
  readPrivateContextAuthorityNow(telegramId: number, space: SpaceKind, agentId: string): { revision: string; validUntil: number } {
    if (!this.repository.storage.indexed) {
      const result = this.readCommittedAuthorityForEffect(telegramId, this.now, (d, now) => {
        const authority = this.authorityEvaluation(d, space, now, 'en');
        const deadline = Math.min(authority.deadline ?? INFINITY, ...d.memories.filter(m => m.space === space && m.status === 'active' && m.expiresAt > now).map(m => m.expiresAt));
        return { ...authority, deadline, observedDenial: authority.observedDenial || d.memories.some(m => m.space === space && m.status === 'active' && m.expiresAt <= now),
          value: { revision: this.canonicalPrivateContext(d, now, space, agentId).revision, validUntil: deadline } };
      });
      if (result.status !== 'ready') return fail(503, 'adaptive_context_unavailable');
      return result.value;
    }
    try {
      const context = readIndexedPrivateContext(this, telegramId, space, agentId, '', true);
      return { revision: context.revision, validUntil: context.validUntil ?? INFINITY };
    } catch { return fail(503, 'adaptive_context_unavailable'); }
  }

}
