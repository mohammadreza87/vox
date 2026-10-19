import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdaptiveService } from '../../persistence/service';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose } from '../../persistence/repository';
import { FileAdaptiveStorage, MemoryAdaptiveStorage } from '../../persistence/storage';
import { adaptiveOptionsFromManifest } from '../../persistence/config';
import { AdaptiveExperienceService } from '../../runtime/service';
import type { PreferenceValue } from '../index';
export const NOW = Date.UTC(2026, 9, 19, 12);
export async function preferenceFixture(options: { file?: boolean; telegramId?: number; agentId?: string } = {}) {
  const telegramId = options.telegramId ?? 123, agentId = options.agentId ?? 'agent1';
  let now = NOW, personalizationEligible = true, personalizationReviewExpiresAt = Infinity;
  const directory = options.file ? await mkdtemp(join(tmpdir(), 'vox-preferences-')) : undefined;
  const storage = directory ? new FileAdaptiveStorage(directory) : new MemoryAdaptiveStorage();
  const capabilities = ['core_text', 'personalization', 'product_analytics'];
  const policy = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-preferences', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(telegramId), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, index) => ({ schemaVersion: 1, id: `pref-approval-${index}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-preferences', effectiveAt: NOW,
      reviewExpiresAt: NOW + 400 * 86_400_000, owner: 'synthetic', approvalReference: 'synthetic-only' })) }));
  const factory = () => {
    const adaptive = new AdaptiveService(new AdaptiveRepository(directory ? new FileAdaptiveStorage(directory) : storage), { ...policy, now: () => now,
      capabilityPolicy: (context, at) => {
        if (context.capability === 'personalization' && !personalizationEligible) return undefined;
        const result = policy.capabilityPolicy?.(context, at);
        return result && context.capability === 'personalization' && Number.isFinite(personalizationReviewExpiresAt)
          ? { ...result, approvals: result.approvals.map(a => ({ ...a, reviewExpiresAt: Math.min(a.reviewExpiresAt, personalizationReviewExpiresAt) })) } : result;
      } });
    return { adaptive, experience: new AdaptiveExperienceService(adaptive) };
  };
  const { adaptive, experience } = factory();
  await adaptive.confirm(telegramId, { confirm: true, adultConfirmed: true });
  async function grant(purpose: OptionalPurpose = 'optional.personalization', space: 'work' | 'personal' = 'work') {
    const state = await adaptive.read(telegramId, space), permission = state.purposes.find(row => row.purpose === purpose)!;
    const shown = await adaptive.present(telegramId, { space, purpose, locale: 'en', expectedRevision: permission.revision,
      eventId: randomUUID(), ...(permission.state !== 'not_asked' ? { deliberateReopen: true } : {}) });
    return adaptive.changeConsent(telegramId, { space, purpose, state: 'granted', expectedRevision: shown.purposes.find(row => row.purpose === purpose)!.revision,
      eventId: randomUUID(), receipt: shown.receipt });
  }
  async function agent(allowed = true, space: 'work' | 'personal' = 'work') {
    const state = await adaptive.read(telegramId, space);
    return adaptive.setAgentAccess(telegramId, agentId, { space, allowed, expectedRevision: state.revision, eventId: randomUUID() });
  }
  async function save(setting: PreferenceValue, action: 'set' | 'reset' = 'set', space: 'work' | 'personal' = 'work') {
    const state = await experience.read(telegramId, space);
    const input = { space, agentId, setting, action, expectedRevision: state.revision, eventId: randomUUID() };
    return { input, snapshot: await experience.savePreference(telegramId, input) };
  }
  const state = (space: 'work' | 'personal' = 'work') => experience.readPreferenceState(telegramId, space, agentId);
  return { adaptive, experience, factory, storage, directory, telegramId, agentId, grant, agent, save, state,
    setNow: (value: number) => { now = value; }, denyPersonalization: () => { personalizationEligible = false; },
    expirePersonalizationAt: (value: number) => { personalizationReviewExpiresAt = value; },
    close: async () => { if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3 }); } };
}
