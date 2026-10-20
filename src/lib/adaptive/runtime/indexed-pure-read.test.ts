import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {accountIdFor, AdaptiveRepository, type AdaptiveDocument, type OptionalPurpose, type SpaceKind} from '../persistence/repository';
import {AdaptiveService} from '../persistence/service';
import {adaptiveOptionsFromManifest} from '../persistence/config';
import {SqliteAdaptiveStorage} from '../persistence/indexed/sqlite-storage';
import {AdaptiveExperienceService} from './service';
import {AdaptiveObserverService} from '../observation/service';
import {DecisionService} from '../decisions';

const NOW = Date.UTC(2026, 9, 19, 12);
const directories: string[] = [];
const stores: SqliteAdaptiveStorage[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true});
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'vox-indexed-pure-consumer-')); directories.push(directory);
  let now = NOW, policyExpiry = NOW + 86_400_000; const capabilityExpiries = new Map<string, number>();
  const capabilities = ['core_text', 'single_party_image', 'personalization', 'product_analytics'];
  const configured = adaptiveOptionsFromManifest(JSON.stringify({schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: capabilities,
    accounts: [{accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true}],
    approvals: capabilities.map((capability, i) => ({schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: NOW,
      reviewExpiresAt: NOW + 86_400_000, owner: 'synthetic', approvalReference: 'synthetic-only'}))}));
  const path = join(directory, 'synthetic.sqlite');
  const storage = new SqliteAdaptiveStorage(path, {now: () => now}); stores.push(storage);
  const repository = new AdaptiveRepository(storage);
  const options = {...configured, now: () => now, capabilityPolicy: (context: Parameters<NonNullable<typeof configured.capabilityPolicy>>[0], at: number) => {
    const policy = configured.capabilityPolicy?.(context, at);
    return policy && {...policy, approvals: policy.approvals.map(approval => ({...approval, reviewExpiresAt: capabilityExpiries.get(context.capability) ?? policyExpiry}))};
  }};
  const adaptive = new AdaptiveService(repository, options), experience = new AdaptiveExperienceService(adaptive), observer = new AdaptiveObserverService(adaptive);
  await adaptive.confirm(123, {confirm: true, adultConfirmed: true});
  async function grant(purpose: OptionalPurpose, space: SpaceKind = 'work') {
    const before = await adaptive.read(123, space), permission = before.purposes.find(p => p.purpose === purpose)!;
    const shown = await adaptive.present(123, {space, purpose, locale: 'en', expectedRevision: permission.revision, eventId: randomUUID(), deliberateReopen: true});
    await adaptive.changeConsent(123, {space, purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), receipt: shown.receipt});
  }
  async function agent(allowed: boolean, space: SpaceKind = 'work') {
    const current = await adaptive.read(123, space);
    await adaptive.setAgentAccess(123, 'agent', {space, allowed, expectedRevision: current.revision, eventId: randomUUID()});
  }
  for (const purpose of ['optional.personalization', 'optional.product_analytics'] as const) await grant(purpose);
  await agent(true);
  const write = (fn: (d: AdaptiveDocument) => void) => adaptive.withAccountDocument(123, (d, at) => {fn(d); d.revision++; d.updatedAt = at;});
  await write(d => {
    d.memories = Array.from({length: 300}, (_, i) => ({id: `body-${i}`, revision: 1, space: 'work', text: `PRIVATE_BODY_CANARY_${i}`,
      status: 'active', createdAt: now, updatedAt: now, expiresAt: NOW + 80_000, revocationEpoch: 0}));
    d.experience.preferences.push(
      {id: 'brief-setting', revision: 1, space: 'work', agentId: 'agent', setting: {key: 'response_length', value: 'brief'}, status: 'active', updatedAt: now},
      {id: 'fa-setting', revision: 1, space: 'work', agentId: 'agent', setting: {key: 'language', value: 'fa'}, status: 'active', updatedAt: now},
      {id: 'reset-setting', revision: 1, space: 'work', agentId: 'agent', setting: {key: 'formatting', value: 'structured'}, status: 'reset', updatedAt: now},
      {id: 'other-agent', revision: 1, space: 'work', agentId: 'other', setting: {key: 'language', value: 'en'}, status: 'active', updatedAt: now},
      {id: 'personal-setting', revision: 1, space: 'personal', agentId: 'agent', setting: {key: 'language', value: 'en'}, status: 'active', updatedAt: now});
  });
  const resetIo = () => {for (const key of Object.keys(storage.io) as (keyof typeof storage.io)[]) storage.io[key] = 0;};
  const noBody = () => {
    expect(storage.io.canonicalImageReads).toBe(0); expect(storage.io.bodyRowsRead).toBe(0); expect(storage.io.bodyBytesRead).toBe(0);
    expect(storage.io.controlRowsRead).toBeGreaterThan(0);
  };
  resetIo();
  return {adaptive, experience, observer, storage, repository, directory, path, options, grant, agent, write, resetIo, noBody,
    setNow: (value: number) => {now = value;}, setPolicyExpiry: (value: number) => {policyExpiry = value;}, setCapabilityExpiry: (capability: string, value: number) => {capabilityExpiries.set(capability, value);}};
}

describe('indexed pure experience consumers', () => {
  it('reads only current explicit enums for the exact space/agent with 300 bodies untouched', async () => {
    const f = await fixture();
    const snapshot = await f.experience.readPreferences(123, 'work', 'agent');
    expect(snapshot.settings).toEqual([{key: 'response_length', value: 'brief'}, {key: 'language', value: 'fa'}]);
    expect(await f.experience.readPreferences(123, 'personal', 'agent')).toMatchObject({settings: []});
    expect(await f.experience.readPreferences(123, 'work', 'ungranted')).toMatchObject({settings: []});
    f.noBody();
  });
  it('retains canonical detailed/Undo reads and exact reset semantics', async () => {
    const f = await fixture();
    const detailed = await f.experience.readPreferenceState(123, 'work', 'agent');
    expect(detailed.entries.find(e => e.setting.key === 'formatting')).toMatchObject({source: 'reset', applied: false, setting: {key: 'formatting', value: 'plain'}});
    expect(f.storage.io.canonicalImageReads).toBeGreaterThan(0);
    f.resetIo(); expect((await f.experience.readPreferences(123, 'work', 'agent')).settings).not.toContainEqual({key: 'formatting', value: 'structured'}); f.noBody();
  });
  it('invalidates a retained enum receipt on exact grant revoke/restore ABA', async () => {
    const f = await fixture(), before = await f.experience.readPreferences(123, 'work', 'agent');
    await f.agent(false); f.resetIo();
    const denied = await f.experience.readPreferences(123, 'work', 'agent'); expect(denied.settings).toEqual([]); expect(denied.revision).not.toBe(before.revision); f.noBody();
    await f.agent(true); f.resetIo();
    const after = await f.experience.readPreferences(123, 'work', 'agent'); expect(after.settings).toEqual(before.settings); expect(after.revision).not.toBe(before.revision); f.noBody();
  });
  it('keeps explicit enums saved but never applies them across withdrawal or a stale regrant receipt', async () => {
    const f = await fixture(), first = await f.experience.readPreferences(123, 'work', 'agent');
    const current = await f.adaptive.read(123, 'work');
    await f.adaptive.changeConsent(123, {space: 'work', purpose: 'optional.personalization', state: 'withdrawn', expectedRevision: current.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID()});
    f.resetIo(); const denied = await f.experience.readPreferences(123, 'work', 'agent');
    expect(denied.settings).toEqual([]); expect(denied.revision).not.toBe(first.revision); f.noBody();
    await f.grant('optional.personalization'); f.resetIo();
    const restored = await f.experience.readPreferences(123, 'work', 'agent');
    expect(restored.settings).toEqual(first.settings); expect(restored.revision).not.toBe(first.revision); f.noBody();
  });
  it('detects an actual canonical grant mutation between async enum resolution and its final compact read', async () => {
    const f = await fixture(), read = f.adaptive.withRuntimeControls.bind(f.adaptive);
    vi.spyOn(f.adaptive, 'withRuntimeControls').mockImplementationOnce(async (...args) => {
      const result = await read(...args); await f.agent(false); f.resetIo(); return result;
    });
    await expect(f.experience.readPreferences(123, 'work', 'agent')).rejects.toMatchObject({code: 'preference_authority_changed'}); f.noBody();
  });
  it.each(['binding', 'permission', 'capability'] as const)('denies expired %s without parsing the canonical memory image', async kind => {
    const f = await fixture();
    if (kind === 'binding') await f.write(d => {d.binding!.expiresAt = NOW + 10;});
    if (kind === 'permission') await f.write(d => {d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.expiresAt = NOW + 10;});
    if (kind === 'capability') f.setPolicyExpiry(NOW + 10);
    f.resetIo(); expect((await f.experience.readPreferences(123, 'work', 'agent')).settings).toHaveLength(2);
    f.setNow(NOW + 11); expect((await f.experience.readPreferences(123, 'work', 'agent')).settings).toEqual([]); f.noBody();
    expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(NOW + 11);
  });
  it('rechecks capability expiry during native watermark publication and never releases stale settings', async () => {
    const f = await fixture(); f.setPolicyExpiry(NOW + 10); f.setNow(NOW + 1);
    const exec = f.storage.database.exec.bind(f.storage.database); let crossed = false;
    vi.spyOn(f.storage.database, 'exec').mockImplementation(sql => {
      const result = exec(sql); if (sql === 'COMMIT' && !crossed) {crossed = true; f.setNow(NOW + 11);} return result;
    });
    expect((await f.experience.readPreferences(123, 'work', 'agent')).settings).toEqual([]); expect(crossed).toBe(true); f.noBody();
  });
  it('binds enum receipts to fresh store identity even for an identical imported account', async () => {
    const f = await fixture(), first = await f.experience.readPreferences(123, 'work', 'agent');
    const detailed = await f.experience.readPreferenceState(123, 'work', 'agent');
    const document = await f.adaptive.withAccountDocument(123, d => structuredClone(d));
    const secondStorage = new SqliteAdaptiveStorage(join(f.directory, 'second.sqlite'), {now: () => NOW}); stores.push(secondStorage);
    const repository = new AdaptiveRepository(secondStorage);
    await repository.transaction(accountIdFor(123), NOW, d => Object.assign(d, document));
    const experience = new AdaptiveExperienceService(new AdaptiveService(repository, f.options));
    const second = await experience.readPreferences(123, 'work', 'agent');
    expect(second.settings).toEqual(first.settings); expect(second.revision).not.toBe(first.revision);
    expect((await experience.readPreferenceState(123, 'work', 'agent')).receipt).not.toBe(detailed.receipt);
  });
});

const predictionInput = {space: 'work' as const, agentId: 'agent', sessionId: 'session', turnId: 'turn', revision: 1, contextKey: 'context', text: 'Synthetic final text', question: 'explicit_correction' as const};
const image = {sourceId: 'shared-current', revision: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='};
function predictionService(adaptive: AdaptiveService) {
  return new AdaptiveExperienceService(adaptive, {decisionsEnabled: true, decisions: new DecisionService({evaluate: async () => ({model: 'gpt-6-luna', answers: [{type: 'predicate', name: 'explicit_correction', probability: 0.8}]})})});
}
function validation(policyReceipt: string) {
  const {space, agentId, sessionId, turnId, revision, contextKey} = predictionInput;
  return {space, agentId, sessionId, turnId, revision, contextKey, policyReceipt};
}

describe('indexed pure observer authorization', () => {
  it('authorizes with zero aggregate/body reads and its namespace receipt is accepted by real canonical recording', async () => {
    const f = await fixture(), receipt = await f.observer.authorize(123, 'work', 'agent');
    expect(receipt).toMatch(/^[a-f0-9]{64}$/); expect(await f.observer.authorize(123, 'personal', 'agent')).toBeNull();
    expect(await f.observer.authorize(123, 'work', 'other')).toBeNull(); f.noBody();
    expect(await f.observer.recordServer(123, {eventId: 'server-event', kind: 'response', space: 'work', agentId: 'agent', turnId: 'server-turn', channel: 'text', outcome: 'responded', policyReceipt: receipt!})).toMatchObject({recorded: true});
    expect(f.storage.io.canonicalImageReads).toBeGreaterThan(0);
    await f.observer.process(123); const state = await f.observer.snapshot(123, 'work');
    expect(state.projection.responded).toBe(1);
    f.resetIo(); expect(await f.observer.authorize(123, 'work', 'agent')).toBe(receipt); f.noBody();
  });
  it.each(['binding', 'permission', 'capability'] as const)('denies expired analytics %s without canonical materialization', async kind => {
    const f = await fixture();
    if (kind === 'binding') await f.write(d => {d.binding!.expiresAt = NOW + 10;});
    if (kind === 'permission') await f.write(d => {d.permissions.find(p => p.id === 'permission:work:optional.product_analytics')!.expiresAt = NOW + 10;});
    if (kind === 'capability') f.setCapabilityExpiry('product_analytics', NOW + 10);
    f.resetIo(); expect(await f.observer.authorize(123, 'work', 'agent')).not.toBeNull();
    f.setNow(NOW + 11); expect(await f.observer.authorize(123, 'work', 'agent')).toBeNull(); f.noBody();
  });
  it('never reuses an observer receipt after actual analytics withdrawal/regrant or exact grant ABA', async () => {
    const f = await fixture(), first = await f.observer.authorize(123, 'work', 'agent');
    const current = await f.adaptive.read(123, 'work');
    await f.adaptive.changeConsent(123, {space: 'work', purpose: 'optional.product_analytics', state: 'withdrawn', expectedRevision: current.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID()});
    f.resetIo(); expect(await f.observer.authorize(123, 'work', 'agent')).toBeNull(); f.noBody();
    await f.grant('optional.product_analytics'); f.resetIo();
    const regranted = await f.observer.authorize(123, 'work', 'agent'); expect(regranted).not.toBe(first); f.noBody();
    await f.agent(false); f.resetIo(); expect(await f.observer.authorize(123, 'work', 'agent')).toBeNull(); f.noBody();
    await f.agent(true); f.resetIo(); expect(await f.observer.authorize(123, 'work', 'agent')).not.toBe(regranted); f.noBody();
  });
  it('does not accept source-store observation work on an identical imported account', async () => {
    const f = await fixture(), oldReceipt = await f.observer.authorize(123, 'work', 'agent');
    const document = await f.adaptive.withAccountDocument(123, d => structuredClone(d));
    const storage = new SqliteAdaptiveStorage(join(f.directory, 'observer-target.sqlite'), {now: () => NOW}); stores.push(storage);
    const repository = new AdaptiveRepository(storage); await repository.transaction(accountIdFor(123), NOW, d => Object.assign(d, document));
    const observer = new AdaptiveObserverService(new AdaptiveService(repository, f.options));
    const current = await observer.authorize(123, 'work', 'agent'); expect(current).not.toBe(oldReceipt);
    expect(storage.io.bodyRowsRead).toBe(0);
    const input = {eventId: 'old-server-event', kind: 'response' as const, space: 'work' as const, agentId: 'agent', turnId: 'server-turn', channel: 'text' as const, outcome: 'responded' as const};
    expect(await observer.recordServer(123, {...input, policyReceipt: oldReceipt!})).toMatchObject({recorded: false});
    expect(await observer.recordServer(123, {...input, policyReceipt: current!})).toMatchObject({recorded: true});
  });
});

describe('indexed pure prediction validation', () => {
  it('validates a genuine prepared result with zero canonical/body reads, and rejects mismatched scope', async () => {
    const f = await fixture(), experience = predictionService(f.adaptive), result = await experience.predict(123, predictionInput);
    expect(result.status).toBe('answered'); f.resetIo();
    expect(await experience.validatePrediction(123, validation(result.policyReceipt!))).toEqual({valid: true});
    expect(await experience.validatePrediction(123, {...validation(result.policyReceipt!), space: 'personal'})).toEqual({valid: false});
    expect(await experience.validatePrediction(123, {...validation(result.policyReceipt!), policyReceipt: 'wrong-receipt'})).toEqual({valid: false}); f.noBody();
  });
  it('rejects a receipt after real exact grant revoke/restore and after cancellation', async () => {
    const f = await fixture(), experience = predictionService(f.adaptive), result = await experience.predict(123, predictionInput), input = validation(result.policyReceipt!);
    await f.agent(false); await f.agent(true); f.resetIo();
    expect(await experience.validatePrediction(123, input)).toEqual({valid: false}); f.noBody();
    const newer = await experience.predict(123, {...predictionInput, turnId: 'next-turn'});
    await experience.cancelPrediction(123, {space: 'work', agentId: 'agent', sessionId: 'session', turnId: 'next-turn', revision: 1, contextKey: 'context'}); f.resetIo();
    expect(await experience.validatePrediction(123, {...validation(newer.policyReceipt!), turnId: 'next-turn'})).toEqual({valid: false}); f.noBody();
  });
  it('rechecks canonical authority after awaited external Studio authorization', async () => {
    const f = await fixture(), experience = predictionService(f.adaptive), result = await experience.predict(123, predictionInput); let calls = 0; f.resetIo();
    const valid = await experience.validatePrediction(123, validation(result.policyReceipt!), async () => {
      if (++calls === 2) {await f.agent(false); f.resetIo();} return true;
    });
    expect(valid).toEqual({valid: false}); expect(calls).toBe(2); f.noBody();
  });
  it.each(['binding', 'core_text', 'single_party_image'] as const)('fences the current %s expiry on prepared image results', async kind => {
    const f = await fixture(), experience = predictionService(f.adaptive);
    if (kind === 'binding') await f.write(d => {d.binding!.expiresAt = NOW + 10;});
    else f.setCapabilityExpiry(kind, NOW + 10);
    const result = await experience.predict(123, {...predictionInput, image}); expect(result.status).toBe('answered'); f.resetIo();
    expect(await experience.validatePrediction(123, validation(result.policyReceipt!))).toEqual({valid: true});
    f.setNow(NOW + 11); expect(await experience.validatePrediction(123, validation(result.policyReceipt!))).toEqual({valid: false}); f.noBody();
  });
  it('rejects imported old prepared receipts while a new target-store preparation still works', async () => {
    const f = await fixture(), experience = predictionService(f.adaptive), result = await experience.predict(123, predictionInput);
    const document = await f.adaptive.withAccountDocument(123, d => structuredClone(d));
    const storage = new SqliteAdaptiveStorage(join(f.directory, 'prediction-target.sqlite'), {now: () => NOW}); stores.push(storage);
    const repository = new AdaptiveRepository(storage); await repository.transaction(accountIdFor(123), NOW, d => Object.assign(d, document));
    const target = predictionService(new AdaptiveService(repository, f.options));
    for (const key of Object.keys(storage.io) as (keyof typeof storage.io)[]) storage.io[key] = 0;
    expect(await target.validatePrediction(123, validation(result.policyReceipt!))).toEqual({valid: false});
    expect(storage.io.canonicalImageReads).toBe(0); expect(storage.io.bodyRowsRead).toBe(0);
    const next = await target.predict(123, {...predictionInput, turnId: 'target-turn'}); expect(next.status).toBe('answered');
    expect(await target.validatePrediction(123, {...validation(next.policyReceipt!), turnId: 'target-turn'})).toEqual({valid: true});
  });
});
