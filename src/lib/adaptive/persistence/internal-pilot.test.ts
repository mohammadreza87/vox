import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adaptiveOptionsFromManifest, INTERNAL_PILOT_CAPABILITIES, type InternalPilotAuthority } from './config';
import { AdaptiveService } from './service';
import { AdaptiveRepository, type AdaptiveDocument, type OptionalPurpose } from './repository';
import { FileAdaptiveStorage } from './storage';
import { StudioStore, type StudioStorage } from '../../studio/store';
import { internalPilotAuthority, validateStudioConfig } from '../../studio/runtime';
import { identityInput } from './validation';
import { applyProductPauseCommand, emptyProductPause } from '../product-pause/state';
import { emptyRightsUseHolds } from '../rights-use-holds/state';
import { randomUUID } from 'node:crypto';
import { AdaptiveRelationshipService } from '../relationships/service';
import { AdaptiveExperienceService } from '../runtime/service';
import { reminderPermit } from '../runtime/reminder-state';
import { GENERIC_REMINDER_TEXT, ReminderDeliveryService } from '../runtime/reminders/service';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const DAY = 86_400_000;
const accountId = 'telegram-account:123';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function manifest() {
  return { schemaVersion: 2, basis: 'internal_company_pilot', configurationVersion: 'internal-pilot-v1',
    enabledCapabilities: [...INTERNAL_PILOT_CAPABILITIES], accounts: [{ accountId }],
    review: { id: 'operational-pilot-1', revision: 1, owner: 'company-owner', reviewReference: 'internal-operations-record', effectiveAt: NOW, reviewExpiresAt: NOW + 30 * DAY } };
}
function policy(current = manifest(), authority: InternalPilotAuthority = { currentInternalMember: () => ({ allowed: true, authorityVersion: 'role-1' }) }) {
  return adaptiveOptionsFromManifest(JSON.stringify(current), authority);
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'vox-pilot-')); directories.push(directory);
  const store = new StudioStore(directory);
  await store.update(state => { state.members.push({ telegramId: 123, role: 'owner', name: 'Synthetic owner', joinedAt: new Date(NOW).toISOString() }); });
  let now = NOW;
  const repository = new AdaptiveRepository(new FileAdaptiveStorage(join(directory, 'adaptive')));
  const adaptive = new AdaptiveService(repository, { ...policy(manifest(), internalPilotAuthority(store)), scopedRelationshipsEnabled: true, now: () => now });
  const document = async () => { let result!: AdaptiveDocument; await repository.transaction(accountId, now, d => { result = structuredClone(d); }); return result; };
  return { store, repository, adaptive, document, at: (value: number) => { now = value; }, now: () => now };
}

describe('internal company pilot operational manifest', () => {
  it('keeps absent configuration off and exposes a distinct truthful policy path', () => {
    expect(adaptiveOptionsFromManifest(undefined)).toEqual({});
    const options = policy(); expect(options.capabilityPolicy).toBeUndefined();
    const result = options.internalPilotPolicy!({ accountId, personId: 'person-123', capability: 'core_text', declaration: { adultConfirmed: true, declaredAt: NOW } }, NOW);
    expect(result).toMatchObject({ basis: 'internal_company_pilot', decision: { eligible: true, validUntil: NOW + 30 * DAY } });
    expect(JSON.stringify(result)).not.toContain('jurisdiction'); expect(JSON.stringify(result)).not.toContain('approved');
    if (result.decision.eligible) expect(result.decision.approvalVersions[0]).toContain('internal_company_pilot');
  });

  it.each(['single_party_audio', 'multi_party_audio', 'single_party_image', 'biometric_recognition', 'content_quality_review', 'unknown'])('rejects unsupported capability %s at startup', capability => {
    const current = manifest(); current.enabledCapabilities = [capability] as typeof current.enabledCapabilities;
    expect(() => policy(current)).toThrow();
  });

  it('rejects duplicates, overlong windows, overflow, raw jurisdiction fields and oversized cohorts', () => {
    const base = manifest();
    for (const current of [
      { ...base, accounts: [...base.accounts, ...base.accounts] },
      { ...base, enabledCapabilities: ['core_text', 'core_text'] },
      { ...base, basis: 'jurisdiction_approved' },
      { ...base, configurationVersion: ' ' },
      { ...base, review: { ...base.review, reviewExpiresAt: NOW + 90 * DAY + 1 } },
      { ...base, review: { ...base.review, reviewExpiresAt: Number.MAX_SAFE_INTEGER + 1 } },
      { ...base, review: { ...base.review, reviewExpiresAt: NOW } },
      { ...base, review: { ...base.review, owner: ' ' } },
      { ...base, accounts: Array.from({ length: 21 }, (_, i) => ({ accountId: `telegram-account:${i + 1}` })) },
      { ...base, accounts: [{ accountId, jurisdictionKeys: ['EE'] }] },
      { ...base, accounts: [{ accountId: 'telegram-account:9999999999999999' }] },
      { ...base, approvals: [] },
    ]) expect(() => policy(current as ReturnType<typeof manifest>)).toThrow();
  });

  it.each(['missing', 'throw', 'promise', 'string', 'versionless'] as const)('fails closed for %s current membership resolver', mode => {
    const authority: InternalPilotAuthority = mode === 'missing' ? {} : { currentInternalMember: (() => {
      if (mode === 'throw') throw new Error('offline');
      if (mode === 'promise') return Promise.resolve({ allowed: true, authorityVersion: 'future' });
      if (mode === 'string') return { allowed: 'true', authorityVersion: 'not-boolean' };
      return { allowed: true };
    }) as InternalPilotAuthority['currentInternalMember'] };
    expect(policy(manifest(), authority).internalPilotPolicy!({ accountId, personId: 'person', capability: 'core_text', declaration: { adultConfirmed: true, declaredAt: NOW } }, NOW).decision.eligible).toBe(false);
  });

  it.each([undefined, { adultConfirmed: false, declaredAt: NOW }, { adultConfirmed: true, declaredAt: NOW + 1 }, { adultConfirmed: true, declaredAt: NOW - 366 * DAY }])('requires a current explicit adult declaration %j', declaration => {
    const decision = policy().internalPilotPolicy!({ accountId, personId: 'person', capability: 'core_text', declaration }, NOW).decision;
    expect(decision).toMatchObject({ eligible: false, reason: 'adult_required' });
  });

  it('rejects future/expired pilots and unknown accounts; bounds availability by adult expiry', () => {
    const evaluate = (at: number, id = accountId, declaredAt = NOW) => policy().internalPilotPolicy!({ accountId: id, personId: 'person', capability: 'core_text', declaration: { adultConfirmed: true, declaredAt } }, at).decision;
    expect(evaluate(NOW - 1).eligible).toBe(false);
    expect(evaluate(NOW + 30 * DAY).eligible).toBe(false);
    expect(evaluate(NOW, 'telegram-account:999').eligible).toBe(false);
    expect(evaluate(NOW, accountId, NOW - 364 * DAY)).toMatchObject({ eligible: true, validUntil: NOW + DAY });
  });

  it('does not let raw client identity input declare pilot enrollment or role', () => {
    expect(identityInput.safeParse({ confirm: true, adultConfirmed: true, basis: 'internal_company_pilot' }).success).toBe(false);
    expect(identityInput.safeParse({ confirm: true, internalCompanyPilot: true, role: 'owner' }).success).toBe(false);
  });

  it('rejects an invalid supplied operational manifest during runtime validation', () => {
    expect(() => validateStudioConfig({ STUDIO_SECRET: 's'.repeat(32), ANTHROPIC_API_KEY: 'synthetic',
      STUDIO_ADAPTIVE_POLICY_JSON: JSON.stringify({ ...manifest(), review: { ...manifest().review, reviewReference: '' } }),
    })).toThrow();
  });

  it('preserves the existing version1 jurisdiction requirements', () => {
    const current = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'legacy', enabledCapabilities: ['core_text'],
      accounts: [{ accountId, jurisdictionKeys: ['EE'], allowDeclaredAdult: true }], approvals: [] }));
    expect(current.internalPilotPolicy).toBeUndefined();
    const result = current.capabilityPolicy!({ accountId, personId: 'person', capability: 'core_text', declaration: { adultConfirmed: true, declaredAt: NOW } }, NOW)!;
    expect(result.request.jurisdiction).toEqual({ status: 'known', requiredKeys: ['EE'] });
    expect(result.approvals).toEqual([]);
  });
});

async function backgroundFixture() {
  const f = await fixture();
  await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  for (const purpose of ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions', 'optional.relationship_outreach', 'optional.reminder_delivery'] as OptionalPurpose[]) {
    const current = await f.adaptive.read(123, 'work');
    const presented = await f.adaptive.present(123, { space: 'work', purpose, locale: 'en', eventId: randomUUID(),
      expectedRevision: current.purposes.find(p => p.purpose === purpose)!.revision, deliberateReopen: true });
    await f.adaptive.changeConsent(123, { space: 'work', purpose, state: 'granted', eventId: randomUUID(), receipt: presented.receipt,
      expectedRevision: presented.purposes.find(p => p.purpose === purpose)!.revision });
  }
  const current = await f.adaptive.read(123, 'work');
  await f.adaptive.setAgentAccess(123, 'agent', { space: 'work', allowed: true, eventId: randomUUID(), expectedRevision: current.revision });
  await f.adaptive.withAccountDocument(123, d => {
    d.experience.settings.timezone = 'UTC'; d.experience.settings.quietStartHour = 0; d.experience.settings.quietEndHour = 0;
    d.experience.settings.work = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: true };
  });
  const relationships = new AdaptiveRelationshipService(f.adaptive);
  await relationships.configureExternal(123, 'work', true);
  const permit = (await relationships.resolve(123, 'agent', 'work'))!;
  expect(permit).not.toBeNull();
  const source = (await relationships.acceptSource(permit, { id: 'pilot-source', at: NOW, channel: 'telegram' }))!;
  const experience = new AdaptiveExperienceService(f.adaptive, { notificationsEnabled: true, notificationEndpointId: 'pilot-endpoint' });
  await experience.noteReminderRecipient(123, 'pilot-endpoint');
  const command = async () => ({ space: 'work' as const, eventId: randomUUID(), expectedRevision: (await f.adaptive.read(123, 'work')).revision });
  const presented = await experience.presentReminderChannel(123, await command());
  await experience.reminderChannel(123, { ...await command(), enabled: true,
    receipt: presented.reminderTelegram!.disclosure!.receipt, disclosureVersion: presented.reminderTelegram!.disclosure!.version });
  return { ...f, relationships, permit, source, experience, command };
}

describe('pilot availability with existing durable background authority', () => {
  it('preserves disclosed30day background grants after next-day interactive expiry without unlocking interactive reads or commands', async () => {
    const f = await backgroundFixture();
    const dueAt = NOW + 25 * 60 * 60 * 1000;
    await f.experience.reminder(123, { ...await f.command(), agentId: 'agent', label: 'Synthetic requested reminder', dueAt });
    expect((await f.document()).experience.reminderDelivery!.work.authorization!.expiresAt).toBe(NOW + 30 * DAY);
    f.at(dueAt);
    const current = await f.adaptive.read(123, 'work');
    expect(current.identity.confirmed).toBe(false); expect(current.explicitMemoryAvailable).toBe(false);
    expect(current.purposes.every(p => !p.available)).toBe(true);
    const nextDay = await f.relationships.authorize(f.permit.key, [f.source.id], 'external', f.permit.fingerprint);
    expect(nextDay).not.toBeNull(); expect(nextDay!.expiresAt).toBe(NOW + 30 * DAY);
    expect(f.relationships.authorizeNow(f.permit.key, [f.source.id], 'external', f.permit.fingerprint)).not.toBeNull();
    const document = await f.document();
    expect(reminderPermit(f.adaptive, document, 'work', f.now(), 'agent')?.expiresAt).toBe(NOW + 30 * DAY);
    expect(f.adaptive.isCoreAllowed(document, f.now())).toBe(false);
    expect(f.adaptive.isPurposeAllowed(document, 'work', 'optional.personalization', f.now(), 'agent')).toBe(false);
    await expect(f.adaptive.createMemory(123, { space: 'work', text: 'Unconfirmed private write', eventId: randomUUID(), expectedRevision: current.revision })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    await expect(f.adaptive.present(123, { space: 'work', purpose: 'optional.personalization', locale: 'en', eventId: randomUUID(), expectedRevision: document.permissions.find(p => p.id === 'permission:work:optional.personalization')!.revision })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    expect(await f.relationships.inbox(123, 'agent', 'work')).toEqual([]);
    expect(await f.relationships.acceptSource(nextDay!, { id: 'new-unconfirmed-source', at: f.now(), channel: 'telegram' })).toBeNull();
    let sends = 0;
    const recipient = { telegramId: 123, endpointId: 'pilot-endpoint', revision: 'synthetic-committed-recipient' };
    const delivery = new ReminderDeliveryService(f.experience, { enabled: true, endpointId: 'pilot-endpoint', now: f.now,
      recipient: async () => recipient, recipientNow: () => recipient,
      transport: { send: async input => {
        expect(await input.authorize()).toBe(true); expect(input.authorizeNow()).toBe('allowed');
        expect(input.text).toBe(GENERIC_REMINDER_TEXT); sends++;
        return { state: 'accepted', messageId: '101' };
      } },
    });
    expect(await delivery.drainAccount(123)).toMatchObject({ claimed: 1, accepted: 1 }); expect(sends).toBe(1);
  });

  it.each(['missing', 'revoked', 'expired', 'purpose_withdrawn'] as const)('denies next-day relationship authority with %s durable grant', async mode => {
    const f = await backgroundFixture(); f.at(NOW + DAY);
    await f.repository.transaction(accountId, f.now(), d => {
      if (mode === 'missing') d.relationships.bindings = [];
      if (mode === 'revoked') d.relationships.bindings[0].status = 'revoked';
      if (mode === 'expired') d.relationships.bindings[0].expiresAt = f.now();
      if (mode === 'purpose_withdrawn') d.permissions.find(p => p.id === 'permission:work:optional.auto_memory')!.state = 'withdrawn';
    });
    expect(await f.relationships.authorize(f.permit.key, [f.source.id], 'external', f.permit.fingerprint)).toBeNull();
    expect(f.relationships.authorizeNow(f.permit.key, [f.source.id], 'external', f.permit.fingerprint)).toBeNull();
  });

  it.each(['missing', 'disabled', 'expired', 'purpose_withdrawn', 'identity_clear'] as const)('denies next-day reminders with %s background authorization', async mode => {
    const f = await backgroundFixture(); f.at(NOW + DAY);
    await f.repository.transaction(accountId, f.now(), d => {
      if (mode === 'missing') delete d.experience.reminderDelivery!.work.authorization;
      if (mode === 'disabled') d.experience.reminderDelivery!.work.enabled = false;
      if (mode === 'expired') d.experience.reminderDelivery!.work.authorization!.expiresAt = f.now();
      if (mode === 'purpose_withdrawn') d.permissions.find(p => p.id === 'permission:work:optional.reminder_delivery')!.state = 'withdrawn';
      if (mode === 'identity_clear') delete d.binding;
    });
    expect(reminderPermit(f.adaptive, await f.document(), 'work', f.now(), 'agent')).toBeNull();
  });

  it('revokes both background paths immediately on current role loss', async () => {
    const f = await backgroundFixture(); f.at(NOW + DAY);
    await f.store.update(state => { state.members[0].role = 'member'; state.members[0].learningAuthorityRevision = 1; });
    expect(f.relationships.authorizeNow(f.permit.key, [f.source.id], 'external', f.permit.fingerprint)).toBeNull();
    expect(await f.relationships.authorize(f.permit.key, [f.source.id], 'external', f.permit.fingerprint)).toBeNull();
    expect(reminderPermit(f.adaptive, await f.document(), 'work', f.now(), 'agent')).toBeNull();
  });

  it('revokes relationship authority when the confirmed account profile is explicitly cleared', async () => {
    const f = await backgroundFixture(); f.at(NOW + DAY);
    await f.repository.transaction(accountId, f.now(), d => { delete d.binding; });
    expect(f.relationships.authorizeNow(f.permit.key, [f.source.id], 'external', f.permit.fingerprint)).toBeNull();
    expect(await f.relationships.authorize(f.permit.key, [f.source.id], 'external', f.permit.fingerprint)).toBeNull();
  });

  it.each(['missing', 'person', 'account', 'revoked'] as const)('denies pilot capability availability for %s persisted profile identity', async mode => {
    const f = await fixture(); await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    const document = await f.document();
    if (mode === 'missing') delete document.binding;
    if (mode === 'person') document.binding!.personId = 'another-person';
    if (mode === 'account') document.binding!.accountId = 'telegram-account:999';
    if (mode === 'revoked') (document.binding as unknown as { status: string }).status = 'revoked';
    expect(f.adaptive.capabilityStatus(document, 'core_text', NOW)).toMatchObject({ eligible: false, reason: 'profile_confirmation_required' });
  });
});

describe('pilot current Studio authority and independent personal choices', () => {
  it('makes working controls available only after profile confirmation, without creating grants or consents', async () => {
    const f = await fixture();
    expect((await f.adaptive.read(123, 'work')).explicitMemoryAvailable).toBe(false);
    const confirmed = await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    expect(confirmed.explicitMemoryAvailable).toBe(true);
    for (const purpose of confirmed.purposes) {
      const expected = !['optional.biometric_recognition', 'optional.content_quality_review'].includes(purpose.purpose);
      expect(purpose.available).toBe(expected); expect(purpose.state).toBe('not_asked');
    }
    const document = await f.document(); expect(document.agentGrants).toEqual([]);
    expect(f.adaptive.capabilityStatus(document, 'core_text', NOW).validUntil).toBe(NOW + 30 * DAY);
    expect(f.adaptive.isPurposeAllowed(document, 'work', 'optional.personalization', NOW, 'agent')).toBe(false);
  });

  it('rejects unconfirmed/underage profiles and preserves unreleased implementation gates', async () => {
    const f = await fixture(); await f.adaptive.confirm(123, { confirm: true, adultConfirmed: false });
    expect((await f.adaptive.read(123, 'work')).explicitMemoryAvailable).toBe(false);
    await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    const document = await f.document();
    const gated = new AdaptiveService(f.repository, { ...policy(manifest(), internalPilotAuthority(f.store)), now: f.now });
    for (const capability of ['auto_memory', 'relationship_outreach', 'biometric_recognition', 'content_quality_review'] as const) {
      expect(gated.capabilityStatus(document, capability, NOW)).toMatchObject({ eligible: false, reason: 'feature_not_released' });
    }
    f.at(NOW + 12 * 60 * 60 * 1000 + 1);
    expect((await f.adaptive.read(123, 'work')).explicitMemoryAvailable).toBe(false);
  });

  it('rechecks committed roles after configuration, denies revocation, and changes stamps after regrant', async () => {
    const f = await fixture(); await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    const document = await f.document(); const before = f.adaptive.coreFingerprint(document, NOW);
    await f.store.update(state => { state.members[0].role = 'member'; state.members[0].learningAuthorityRevision = 1; });
    expect(f.adaptive.isCoreAllowed(document, NOW)).toBe(false);
    expect(f.adaptive.coreFingerprint(document, NOW)).not.toBe(before);
    expect((await f.adaptive.read(123, 'work')).purposes.every(p => !p.available)).toBe(true);
    await f.store.update(state => { state.members[0].role = 'superadmin'; state.members[0].learningAuthorityRevision = 2; });
    expect(f.adaptive.isCoreAllowed(document, NOW)).toBe(true); expect(f.adaptive.coreFingerprint(document, NOW)).not.toBe(before);
    await f.store.update(state => { state.members.push({ ...state.members[0] }); });
    expect(f.adaptive.isCoreAllowed(document, NOW)).toBe(false);
  });

  it('requires exactly one current owner/superadmin and never writes or bootstraps membership', async () => {
    const f = await fixture();
    expect(internalPilotAuthority(f.store).currentInternalMember('telegram-account:999')).toBeUndefined();
    expect((await f.store.read()).members).toHaveLength(1);
    const missing = internalPilotAuthority({ read: async () => ({ members: [], agents: [], groups: [], audit: [] }) } as StudioStorage);
    expect(missing.currentInternalMember(accountId)).toBeUndefined();
    const corrupt = internalPilotAuthority({ readCommittedForEffect: () => { throw new Error('busy'); } } as unknown as StudioStorage);
    expect(corrupt.currentInternalMember(accountId)).toBeUndefined();
  });

  it('still requires individual purpose consent AND the selected agent grant at current effect evaluation', async () => {
    const f = await fixture(); await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    await f.repository.transaction(accountId, NOW, d => {
      const permission = d.permissions.find(p => p.id === 'permission:work:optional.personalization')!;
      permission.state = 'granted'; permission.expiresAt = NOW + DAY;
    });
    expect(f.adaptive.isPurposeAllowed(await f.document(), 'work', 'optional.personalization', NOW, 'agent')).toBe(false);
    await f.repository.transaction(accountId, NOW, d => { d.agentGrants.push({ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: NOW }); });
    const document = await f.document();
    expect(f.adaptive.isPurposeAllowed(document, 'work', 'optional.personalization', NOW, 'agent')).toBe(true);
    const before = f.adaptive.purposeFingerprint(document, 'work', 'optional.personalization', NOW, 'agent');
    await f.store.update(state => { state.members[0].role = 'pending'; state.members[0].learningAuthorityRevision = 1; });
    expect(f.adaptive.isPurposeAllowed(document, 'work', 'optional.personalization', NOW, 'agent')).toBe(false);
    expect(f.adaptive.purposeFingerprint(document, 'work', 'optional.personalization', NOW, 'agent')).not.toBe(before);
  });

  it('keeps product pauses and rights use holds effective under pilot availability', async () => {
    const f = await fixture(); await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    const document = await f.document();
    const permission = document.permissions.find(p => p.id === 'permission:work:optional.personalization')!;
    permission.state = 'granted'; permission.expiresAt = NOW + DAY;
    document.agentGrants.push({ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: NOW });
    document.schemaVersion = 3; document.rightsUseHolds = emptyRightsUseHolds(); document.productPause = emptyProductPause();
    expect(f.adaptive.isPurposeAllowed(document, 'work', 'optional.personalization', NOW, 'agent')).toBe(true);
    document.productPause = applyProductPauseCommand(document.productPause, accountId, {
      version: 1, eventId: 'synthetic-pilot-pause-0001', expectedCommandSeq: 0, space: 'work', action: 'pause',
    }, NOW).pause;
    expect(f.adaptive.isPurposeAllowed(document, 'work', 'optional.personalization', NOW, 'agent')).toBe(false);
    document.productPause = emptyProductPause();
    document.rightsUseHolds.effects.push({ version: 1, effectId: randomUUID(), requestId: randomUUID(), space: 'work', purpose: 'optional.personalization',
      revision: 1, state: 'active', appliedAt: NOW, applyIntentDigest: 'a'.repeat(64),
      policy: { id: 'synthetic-rights-policy', revision: 1, digest: 'b'.repeat(64), approvalReference: 'synthetic', decisionReference: 'synthetic' },
      notice: { version: 'synthetic', digest: 'c'.repeat(64) }, reviewAt: NOW + DAY, metadataRetainUntil: NOW + DAY, replayRetainUntil: NOW + DAY,
    });
    document.rightsUseHolds.scopes[0].useEpoch = 1;
    expect(f.adaptive.isPurposeAllowed(document, 'work', 'optional.personalization', NOW, 'agent')).toBe(false);
    expect(f.adaptive.capabilityStatus(document, 'personalization', NOW).eligible).toBe(true);
  });
});
