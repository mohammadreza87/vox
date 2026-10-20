import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose, type SpaceKind } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { FileAdaptiveStorage, type AdaptiveStorage } from '../persistence/storage';
import { DecisionService } from '../decisions';
import { AdaptiveExperienceService } from './service';
import { MemoryAdaptiveStorage } from './storage';
const NOW = Date.UTC(2026, 9, 19, 12);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const capabilities = ['single_party_image', 'core_text', 'personalization', 'product_analytics', 'reminder_delivery', 'proactive_suggestions'];
const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-config', enabledCapabilities: capabilities,
  accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
  approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `synthetic-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
    jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-config', effectiveAt: NOW,
    reviewExpiresAt: capability === 'single_party_image' ? NOW + 2000 : NOW + 400 * 86_400_000, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
async function setup(file = false) {
  let now = NOW;
  let storage: AdaptiveStorage = new MemoryAdaptiveStorage();
  let directory: string | undefined;
  if (file) { directory = await mkdtemp(join(tmpdir(), 'vox-experience-')); directories.push(directory); storage = new FileAdaptiveStorage(directory); }
  const factory = () => {
    const adaptive = new AdaptiveService(new AdaptiveRepository(file ? new FileAdaptiveStorage(directory!) : storage), { ...adaptiveOptionsFromManifest(manifest), now: () => now });
    return { adaptive, experience: new AdaptiveExperienceService(adaptive) };
  };
  const { adaptive, experience } = factory();
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  let event = 0;
  async function grant(purpose: OptionalPurpose, space: SpaceKind = 'work') {
    const snapshot = await adaptive.read(123, space);
    const permission = snapshot.purposes.find(p => p.purpose === purpose)!;
    const presented = await adaptive.present(123, { space, purpose, locale: 'en', expectedRevision: permission.revision, eventId: `present-${++event}`, ...(permission.state !== 'not_asked' ? { deliberateReopen: true } : {}) });
    await adaptive.changeConsent(123, { space, purpose, state: 'granted', expectedRevision: presented.purposes.find(p => p.purpose === purpose)!.revision, eventId: `granted-${++event}`, receipt: presented.receipt });
  }
  async function agent(space: SpaceKind = 'work', allowed = true) {
    const current = await adaptive.read(123, space);
    return adaptive.setAgentAccess(123, 'agent1', { space, allowed, expectedRevision: current.revision, eventId: `agent-grant-${++event}` });
  }
  return { adaptive, experience, factory, directory, grant, agent, setNow: (t: number) => { now = t; } };
}
const turn = (turnId: string, space: SpaceKind = 'work') => ({ agentId: 'agent1', turnId, space, channel: 'voice' as const, durationMs: 150, status: 'failed' as const });
async function feedbackFixture() {
  const fixture = await setup(true);
  await fixture.grant('optional.reminder_delivery'); await fixture.agent();
  let current = await fixture.experience.read(123, 'work');
  current = await fixture.experience.settings(123, { space: 'work', eventId: 'feedback-settings', expectedRevision: current.revision,
    dailyCap: 2, quietStartHour: 21, quietEndHour: 8, inboxEnabled: true, proactiveEnabled: false, reminderEnabled: true });
  const itemId = 'feedback-reminder';
  await fixture.experience.reminder(123, { space: 'work', agentId: 'agent1', expectedRevision: current.revision,
    eventId: itemId, label: 'Synthetic reminder', dueAt: NOW });
  return { ...fixture, itemId };
}
describe('durable experience runtime', () => {
  it.each(['read', 'useful', 'not_useful', 'dismiss'] as const)('keeps dismissal terminal after restart when delayed %s feedback arrives', async action => {
    const { experience, adaptive, factory, itemId } = await feedbackFixture();
    const initial = await experience.read(123, 'work');
    const dismissal = { space: 'work' as const, itemId, action: 'dismiss' as const, eventId: 'dismiss-feedback', expectedRevision: initial.revision };
    await experience.feedback(123, dismissal);
    const dismissed = await adaptive.withAccountDocument(123, d => structuredClone(d.experience.inbox[0]));
    const restarted = factory();
    const current = await restarted.experience.read(123, 'work');
    const delayed = { space: 'work' as const, itemId, action, eventId: 'delayed-feedback', expectedRevision: current.revision };
    expect((await restarted.experience.feedback(123, delayed)).inbox).toEqual([]);
    expect(await restarted.adaptive.withAccountDocument(123, d => d.experience.inbox[0])).toEqual(dismissed);
    const after = await restarted.adaptive.withAccountDocument(123, d => structuredClone(d));
    await restarted.experience.feedback(123, delayed);
    await restarted.experience.feedback(123, dismissal);
    expect(await restarted.adaptive.withAccountDocument(123, d => d)).toEqual(after);
  });
  it('preserves active read/usefulness transitions and rejects cancelled or wrong-space items', async () => {
    const { experience, adaptive, agent, itemId } = await feedbackFixture();
    for (const action of ['useful', 'read', 'not_useful'] as const) {
      const current = await experience.read(123, 'work');
      await experience.feedback(123, { space: 'work', itemId, action, eventId: `active-${action}`, expectedRevision: current.revision });
      expect((await experience.read(123, 'work')).inbox[0]).toMatchObject(action === 'read' ? { status: 'read', feedback: 'useful' } : { feedback: action });
    }
    let current = await experience.read(123, 'personal');
    await expect(experience.feedback(123, { space: 'personal', itemId, action: 'read', eventId: 'wrong-space-read', expectedRevision: current.revision })).rejects.toMatchObject({ code: 'not_found' });
    await agent('work', false);
    current = await experience.read(123, 'work');
    const cancelled = await adaptive.withAccountDocument(123, d => structuredClone(d.experience.inbox[0]));
    expect(cancelled.status).toBe('cancelled');
    for (const action of ['read', 'useful', 'dismiss'] as const) {
      await expect(experience.feedback(123, { space: 'work', itemId, action, eventId: `cancelled-${action}`, expectedRevision: current.revision })).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(await adaptive.withAccountDocument(123, d => d.experience.inbox[0])).toEqual(cancelled);
  });
  it('persists no optional observation until purpose consent AND exact agent grant exist', async () => {
    const { adaptive, experience, grant, agent } = await setup();
    expect(await experience.recordTurn(123, turn('turn1'))).toEqual({ recorded: false, inboxCreated: false });
    await grant('optional.product_analytics');
    expect(await experience.recordTurn(123, turn('turn1'))).toEqual({ recorded: false, inboxCreated: false });
    await agent();
    expect(await experience.recordTurn(123, turn('turn1'))).toEqual({ recorded: true, inboxCreated: false });
    expect(await experience.recordTurn(123, turn('turn1'))).toEqual({ recorded: false, inboxCreated: false });
    await expect(experience.recordTurn(123, { ...turn('turn1'), status: 'responded' })).rejects.toMatchObject({ code: 'event_conflict' });
    expect((await experience.read(123, 'work')).observations).toMatchObject({ total: 1, failed: 1, responded: 0, verifiedTaskSuccess: null, complete: false });
    const current = await adaptive.read(123, 'work');
    await adaptive.changeConsent(123, { space: 'work', purpose: 'optional.product_analytics', state: 'withdrawn', expectedRevision: current.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: 'withdraw-analytics' });
    const stored = await adaptive.withAccountDocument(123, d => d.experience.observations);
    expect(stored).toEqual([]);
    expect(await experience.recordTurn(123, turn('turn2'))).toEqual({ recorded: false, inboxCreated: false });
  });
  it('survives file restart and rejects raw text from server producer contracts', async () => {
    const { experience, factory, directory, grant, agent } = await setup(true);
    await grant('optional.product_analytics'); await agent();
    await experience.recordTurn(123, { ...turn('turn1'), status: 'responded' });
    expect(() => experience.recordTurn(123, { ...turn('turn2'), transcript: 'PRIVATE_CANARY' } as never)).toThrow();
    expect((await factory().experience.read(123, 'work')).observations).toMatchObject({ total: 1, responded: 1, verifiedTaskSuccess: null });
    const stored = await readFile(join(directory!, (await readdir(directory!)).find(f => f.endsWith('.json'))!), 'utf8');
    expect(stored).not.toContain('PRIVATE_CANARY');
    expect((await experience.read(124, 'work')).observations.total).toBe(0);
    expect((await experience.read(123, 'personal')).observations.total).toBe(0);
  });
  it('saves explicit directives before opt-in, applies only with personalization/agent grant, and resets durably', async () => {
    const { experience, adaptive, factory, grant, agent } = await setup(true);
    const before = await experience.read(123, 'work');
    const command = { space: 'work' as const, agentId: 'agent1', expectedRevision: before.revision, eventId: 'preference-set', setting: { key: 'response_length' as const, value: 'brief' as const }, action: 'set' as const };
    const saved = await experience.savePreference(123, command);
    expect(saved.preferences[0]).toMatchObject({ applied: false });
    expect((await experience.readPreferences(123, 'work', 'agent1')).settings).toEqual([]);
    await grant('optional.personalization'); await agent();
    expect((await factory().experience.readPreferences(123, 'work', 'agent1')).settings).toEqual([{ key: 'response_length', value: 'brief' }]);
    const current = await experience.read(123, 'work');
    const reset = await experience.savePreference(123, { ...command, eventId: 'preference-reset', expectedRevision: current.revision, action: 'reset' });
    expect(reset.preferences[0].status).toBe('reset');
    expect((await factory().experience.readPreferences(123, 'work', 'agent1')).settings).toEqual([]);
    expect((await experience.savePreference(123, command)).preferences[0].status).toBe('reset');
    const denied = await adaptive.readPrivateContext(124, 'work', 'agent1'); expect(denied.memories).toEqual([]);
  });
  it('reserves inbox caps transactionally across Work/Personal under concurrent writers and deduplicates replay', async () => {
    const { experience, factory, grant, agent } = await setup(true);
    for (const space of ['work', 'personal'] as const) {
      await grant('optional.proactive_suggestions', space); await agent(space);
      const snapshot = await experience.read(123, space);
      await experience.settings(123, { space, eventId: `settings-${space}`, expectedRevision: snapshot.revision,
        dailyCap: 2, quietStartHour: 21, quietEndHour: 8, inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false });
    }
    const results = await Promise.all([experience.recordTurn(123, turn('turn1')), factory().experience.recordTurn(123, turn('turn2', 'personal')), factory().experience.recordTurn(123, turn('turn3'))]);
    expect(results.filter(r => r.inboxCreated)).toHaveLength(2);
    expect(await factory().experience.recordTurn(123, turn('turn1'))).toEqual({ recorded: false, inboxCreated: false });
    const count = (await experience.read(123, 'work')).inbox.length + (await experience.read(123, 'personal')).inbox.length;
    expect(count).toBe(2);
  });
  it('revocation hides a queued reminder and erases the explicit label before the due time', async () => {
    const { adaptive, experience, factory, grant, agent, setNow, directory } = await setup(true);
    await grant('optional.reminder_delivery'); await agent();
    let current = await experience.read(123, 'work');
    current = await experience.settings(123, { space: 'work', eventId: 'settings-reminder', expectedRevision: current.revision, dailyCap: 2, quietStartHour: 21, quietEndHour: 8, inboxEnabled: true, proactiveEnabled: false, reminderEnabled: true });
    await experience.reminder(123, { space: 'work', agentId: 'agent1', expectedRevision: current.revision, eventId: 'reminder-0001', label: 'EXPLICIT_PRIVATE_LABEL', dueAt: NOW + 1000 });
    const snapshot = await adaptive.read(123, 'work');
    await adaptive.changeConsent(123, { space: 'work', purpose: 'optional.reminder_delivery', state: 'withdrawn', expectedRevision: snapshot.purposes.find(p => p.purpose === 'optional.reminder_delivery')!.revision, eventId: 'withdraw-reminder' });
    setNow(NOW + 2000);
    expect((await factory().experience.read(123, 'work')).inbox).toEqual([]);
    const raw = await readFile(join(directory!, (await readdir(directory!)).find(f => f.endsWith('.json'))!), 'utf8');
    expect(raw).not.toContain('EXPLICIT_PRIVATE_LABEL');
  });
  it('performs CAS on settings and keeps user-selected IANA timezone account-wide', async () => {
    const { experience, factory } = await setup(true);
    const state = await experience.read(123, 'work');
    const command = { space: 'work' as const, eventId: 'settings-event', expectedRevision: state.revision, timezone: 'Europe/Tallinn', dailyCap: 2, quietStartHour: 21, quietEndHour: 8, inboxEnabled: true, proactiveEnabled: true, reminderEnabled: true };
    const results = await Promise.allSettled([experience.settings(123, command), factory().experience.settings(123, { ...command, eventId: 'settings-other', timezone: 'UTC' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await factory().experience.read(123, 'personal')).settings.timezone).toBeDefined();
    await expect(experience.settings(123, { ...command, eventId: 'settings-invalid', timezone: 'guess' })).rejects.toMatchObject({ code: 'invalid_timezone' });
  });
  it('excludes QA events and keeps response context stamps stable across authorized analytics writes', async () => {
    const { adaptive, experience, grant, agent } = await setup();
    await grant('optional.product_analytics'); await grant('optional.personalization'); await agent();
    const before = await adaptive.readPrivateContext(123, 'work', 'agent1');
    const privacy = await adaptive.runtimePrivacy.read('agent1', 'tg-123');
    const preferences = await experience.readPreferences(123, 'work', 'agent1');
    expect(await experience.recordTurn(123, { ...turn('qa-turn'), origin: 'qa' })).toEqual({ recorded: false, inboxCreated: false });
    await experience.recordTurn(123, { ...turn('human-turn'), status: 'responded' });
    expect((await experience.read(123, 'work')).observations.total).toBe(1);
    expect((await adaptive.readPrivateContext(123, 'work', 'agent1')).revision).toBe(before.revision);
    expect((await adaptive.runtimePrivacy.read('agent1', 'tg-123')).revision).toBe(privacy.revision);
    expect((await experience.readPreferences(123, 'work', 'agent1')).revision).toBe(preferences.revision);
    await agent('work', false);
    expect((await adaptive.readPrivateContext(123, 'work', 'agent1')).revision).not.toBe(before.revision);
    expect((await experience.readPreferences(123, 'work', 'agent1')).revision).not.toBe(preferences.revision);
  });
  it('keeps prediction text ephemeral, budgets durable, registry fixed and provider revoked midflight discarded', async () => {
    const { adaptive, agent, directory } = await setup(true); await agent();
    let calls = 0;
    const decisions = new DecisionService({ evaluate: async () => { calls++; return { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'explicit_correction', probability: 0.7 }] }; } });
    const experience = new AdaptiveExperienceService(adaptive, { decisions, decisionsEnabled: true });
    const input = { space: 'work' as const, agentId: 'agent1', sessionId: 'session1', turnId: 'turn1', revision: 1, text: 'PRIVATE_PREDICTION_CANARY', question: 'explicit_correction' as const };
    expect(await experience.predict(123, input)).toMatchObject({ status: 'answered', revision: 1, questionVersion: 'vox-semantic-v1' });
    expect(await experience.predict(123, { ...input, revision: 2 })).toMatchObject({ status: 'answered' });
    expect(await experience.predict(123, { ...input, revision: 3 })).toMatchObject({ reason: 'budget' });
    expect(calls).toBe(2);
    const raw = await readFile(join(directory!, (await readdir(directory!)).find(f => f.endsWith('.json'))!), 'utf8');
    expect(raw).not.toContain('PRIVATE_PREDICTION_CANARY');
    const finalHook = await experience.predict(123, { ...input, turnId: 'final-hook-turn' }, undefined, async () => {
      const current = await adaptive.read(123, 'work');
      await adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed: false, expectedRevision: current.revision, eventId: 'revoke-final-hook' });
      return true;
    });
    expect(finalHook).toMatchObject({ reason: 'stale' });
    await agent();
    const blocked = new AdaptiveExperienceService(adaptive, { decisions: new DecisionService({ evaluate: async () => {
      const current = await adaptive.read(123, 'work'); await adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed: false, expectedRevision: current.revision, eventId: 'revoke-predict' });
      return { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'explicit_correction', probability: 0.7 }] };
    } }), decisionsEnabled: true });
    expect(await blocked.predict(123, { ...input, turnId: 'turn2' })).toMatchObject({ reason: 'stale' });
  });
});

const syntheticImage = { sourceId: 'explicit-shared', revision: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==' };
const predictionInput = { space: 'work' as const, agentId: 'agent1', sessionId: 'live-session', turnId: 'turn-1', revision: 1, contextKey: 'audience1', text: 'Synthetic current draft', question: 'explicit_correction' as const };
const syntheticAnswer = { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'explicit_correction', probability: 0.8 }], usage: { input_tokens: 12 } };
describe('live prediction session delivery guards', () => {
  it('does not export to Decisions when access is blocked during its final canonical authority read', async () => {
    const { adaptive, agent } = await setup(); await agent();
    let allowed = true, checks = 0;
    const evaluate = vi.fn(async () => syntheticAnswer);
    const decisions = new DecisionService({ evaluate });
    const run = decisions.evaluate.bind(decisions);
    vi.spyOn(decisions, 'evaluate').mockImplementation(context => run({ ...context, authorize: async () => {
      // DecisionService checks again after loading evidence, immediately before
      // the real provider seam. Block while that check awaits canonical state.
      if (++checks === 2) {
        const read = adaptive.withAccountDocument.bind(adaptive);
        const spy = vi.spyOn(adaptive, 'withAccountDocument').mockImplementationOnce(async (id, fn) => {
          allowed = false;
          return read(id, fn);
        });
        try { return await context.authorize(); } finally { spy.mockRestore(); }
      }
      return context.authorize();
    } }));
    const experience = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true, decisions });
    expect(await experience.predict(123, predictionInput, undefined, async () => allowed)).toMatchObject({ status: 'unknown' });
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('invalidates a prediction receipt when access is blocked during canonical receipt validation', async () => {
    const { adaptive, agent } = await setup(); await agent();
    const experience = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true,
      decisions: new DecisionService({ evaluate: async () => syntheticAnswer }) });
    const result = await experience.predict(123, predictionInput);
    let allowed = true;
    const read = adaptive.withAccountDocument.bind(adaptive);
    const spy = vi.spyOn(adaptive, 'withAccountDocument').mockImplementationOnce(async (id, fn) => {
      allowed = false;
      return read(id, fn);
    });
    try {
      expect(await experience.validatePrediction(123, { agentId: predictionInput.agentId, space: predictionInput.space,
        sessionId: predictionInput.sessionId, turnId: predictionInput.turnId, revision: predictionInput.revision,
        contextKey: predictionInput.contextKey, policyReceipt: result.policyReceipt! }, async () => allowed)).toEqual({ valid: false });
    } finally { spy.mockRestore(); }
  });
  it('cancels active provider and rejects delayed request behind a tombstone across service instances', async () => {
    const { adaptive, agent } = await setup(); await agent();
    let started!: () => void; const began = new Promise<void>(r => { started = r; }); let providerSignal!: AbortSignal;
    const decisions = new DecisionService({ evaluate: async (_input, signal) => { providerSignal = signal; started(); return new Promise(() => {}); } });
    const experience = new AdaptiveExperienceService(adaptive, { decisions, decisionsEnabled: true });
    const pending = experience.predict(123, predictionInput); await began;
    const scope = { space: predictionInput.space, agentId: predictionInput.agentId, sessionId: predictionInput.sessionId, turnId: predictionInput.turnId, revision: predictionInput.revision, contextKey: predictionInput.contextKey };
    await experience.cancelPrediction(123, scope);
    expect(await pending).toMatchObject({ status: 'unknown' }); expect(providerSignal.aborted).toBe(true);
    const restarted = new AdaptiveExperienceService(adaptive, { decisions, decisionsEnabled: true });
    expect(await restarted.predict(123, predictionInput)).toMatchObject({ reason: 'stale' });
    await restarted.cancelPrediction(123, { ...scope, turnId: 'late-turn' });
    expect(await restarted.predict(123, { ...predictionInput, turnId: 'late-turn' })).toMatchObject({ reason: 'stale' });
  });
  it('new turn permanently supersedes old turn even if provider completes out of order', async () => {
    const { adaptive, agent } = await setup(); await agent();
    let resolve!: (value: unknown) => void, started!: () => void;
    const began = new Promise<void>(r => { started = r; });
    const decisions = new DecisionService({ evaluate: () => { started(); return new Promise(r => { resolve = r; }); } });
    const experience = new AdaptiveExperienceService(adaptive, { decisions, decisionsEnabled: true });
    const pending = experience.predict(123, predictionInput); await began;
    expect(await experience.predict(123, { ...predictionInput, turnId: 'turn-2' })).toMatchObject({ reason: 'busy' });
    resolve(syntheticAnswer); expect(await pending).toMatchObject({ status: 'unknown' });
    expect(await experience.predict(123, { ...predictionInput, revision: 100 })).toMatchObject({ reason: 'stale' });
  });
  it('validates the same short-lived receipt and invalidates it on scope, revocation or expiry', async () => {
    const { adaptive, agent, setNow } = await setup(); await agent();
    const experience = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true, decisions: new DecisionService({ evaluate: async () => syntheticAnswer }) });
    const result = await experience.predict(123, predictionInput);
    const receipt = { ...predictionInput, policyReceipt: result.policyReceipt! }; delete (receipt as Partial<typeof predictionInput>).text; delete (receipt as Partial<typeof predictionInput>).question;
    expect(await experience.validatePrediction(123, receipt)).toEqual({ valid: true });
    expect(await experience.validatePrediction(123, { ...receipt, contextKey: 'audience2' })).toEqual({ valid: false });
    expect(await experience.validatePrediction(123, receipt, async () => false)).toEqual({ valid: false });
    setNow(NOW + 1500); expect(await experience.validatePrediction(123, receipt)).toEqual({ valid: false });
    setNow(NOW); await agent('work', false); expect(await experience.validatePrediction(123, receipt)).toEqual({ valid: false });
  });
  it('rejects unapproved images, binds image policy and strips media bytes from durable budget records', async () => {
    const { adaptive, agent, setNow } = await setup(); await agent();
    const evaluate = vi.fn(async () => syntheticAnswer);
    const experience = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true, decisions: new DecisionService({ evaluate }) });
    const input = { ...predictionInput, image: syntheticImage };
    const original = adaptive.capabilityStatus.bind(adaptive);
    const policy = vi.spyOn(adaptive, 'capabilityStatus').mockImplementation((d, capability, now) => capability === 'single_party_image' ? { eligible: false } : original(d, capability, now));
    await expect(experience.predict(123, input)).rejects.toMatchObject({ code: 'image_capability_unavailable' }); expect(evaluate).not.toHaveBeenCalled(); policy.mockRestore();
    expect(await experience.predict(123, input)).toMatchObject({ status: 'answered' });
    expect(evaluate.mock.calls[0][0].input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: input.text }, { type: 'input_image', image_url: syntheticImage.dataUrl, detail: 'low' }] }]);
    const stored = JSON.stringify(await adaptive.withAccountDocument(123, d => d.experience)); expect(stored).not.toContain(syntheticImage.dataUrl); expect(stored).not.toContain(input.text);
    const expiring = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true, decisions: new DecisionService({ evaluate: async () => { setNow(NOW + 2001); return syntheticAnswer; } }) });
    expect(await expiring.predict(123, { ...input, turnId: 'expires-inflight' })).toMatchObject({ reason: 'stale' });
  });
  it('rechecks Studio permission before model export and returns baseline if it is revoked while loading', async () => {
    const { adaptive, agent } = await setup(); await agent();
    const evaluate = vi.fn(async () => syntheticAnswer);
    const experience = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true, decisions: new DecisionService({ evaluate }) });
    let checks = 0;
    expect(await experience.predict(123, predictionInput, undefined, async () => ++checks < 2)).toMatchObject({ status: 'unknown' });
    expect(evaluate).not.toHaveBeenCalled();
  });
});

it('disabled prediction cancellation never introduces extended-schema records, and denied scopes cannot seed tombstones', async () => {
  const { adaptive, experience, agent } = await setup(); await agent();
  const scope = { space: predictionInput.space, agentId: predictionInput.agentId, sessionId: predictionInput.sessionId, turnId: predictionInput.turnId, revision: predictionInput.revision };
  const before = await adaptive.withAccountDocument(123, d => structuredClone(d.experience.predictionTurns));
  expect(await experience.cancelPrediction(123, scope)).toEqual({ cancelled: true });
  expect(await adaptive.withAccountDocument(123, d => d.experience.predictionTurns)).toEqual(before);
  const enabled = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true, decisions: new DecisionService({ evaluate: async () => syntheticAnswer }) });
  await enabled.cancelPrediction(123, { ...scope, agentId: 'not-granted' });
  expect(await adaptive.withAccountDocument(123, d => d.experience.predictionTurns)).toEqual(before);
});
