import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveService } from '../persistence/service';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { StudioStore } from '../../studio/store';
import type { Agent } from '../../studio/types';
import { ControlledExperimentService } from './service';
import { MemoryExperimentStorage } from './storage';
import { StudioExperimentRuntime } from './runtime';
import { emptyProductPause, applyProductPauseCommand } from '../product-pause/state';
import { signInitData } from '../../studio/auth';
import { handleExperimentExposure } from '../../studio/experiments-http';
import type { Studio } from '../../studio/service';
import { config, NOW } from './test-fixtures';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { rightsExportSchema } from '../../../app/studio/_lib/rights-client';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
export async function runtimeFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'vox-experiment-runtime-')); directories.push(directory);
  const store = new StudioStore(join(directory, 'studio'));
  let now = NOW, event = 0;
  const capabilities = ['core_text', 'personalization', 'product_analytics'] as const;
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-config', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `synthetic-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-config', effectiveAt: NOW,
      reviewExpiresAt: NOW + 100_000, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(directory, 'adaptive'))), { ...adaptiveOptionsFromManifest(manifest), now: () => now });
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  await store.update(d => {
    d.members.push({ telegramId: 123, name: 'Synthetic', role: 'member', joinedAt: new Date(NOW).toISOString() });
    d.agents.push({ id: 'agent1', status: 'active', createdBy: 123, access: [123], visibility: 'private', blocked: [] } as unknown as Agent);
  });
  const storage = new MemoryExperimentStorage(), controller = new ControlledExperimentService(storage);
  controller.install(config(), NOW); for (const [i, phase] of ['offline', 'shadow', 'pilot'].entries()) controller.transition(config().id, i + 1, phase as 'offline' | 'shadow' | 'pilot', NOW);
  const runtime = new StudioExperimentRuntime(controller, adaptive, store, () => now);
  async function grant(purpose: OptionalPurpose) {
    const snapshot = await adaptive.read(123, 'work'), p = snapshot.purposes.find(r => r.purpose === purpose)!;
    const presented = await adaptive.present(123, { space: 'work', purpose, locale: 'en', expectedRevision: p.revision, eventId: `present-${++event}` });
    await adaptive.changeConsent(123, { space: 'work', purpose, state: 'granted', expectedRevision: presented.purposes.find(r => r.purpose === purpose)!.revision, eventId: `grant-${++event}`, receipt: presented.receipt });
  }
  async function grantAgent() { const s = await adaptive.read(123, 'work'); await adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed: true, expectedRevision: s.revision, eventId: `agent-${++event}` }); }
  async function enable() { await grant('optional.product_analytics'); await grant('optional.personalization'); await grantAgent(); }
  return { runtime, controller, storage, adaptive, store, grant, grantAgent, enable, setNow: (t: number) => { now = t; } };
}
describe('private Studio experiment consumption', () => {
  it('requires analytics AND personalization consent, exact agent grant, and active Studio membership', async () => {
    const f = await runtimeFixture(); expect(await f.runtime.prepare(123, 'agent1', 'work', 'turn1')).toBeUndefined();
    await f.grant('optional.product_analytics'); await f.grantAgent(); expect(await f.runtime.prepare(123, 'agent1', 'work', 'turn1')).toBeUndefined();
    await f.grant('optional.personalization'); const p = await f.runtime.prepare(123, 'agent1', 'work', 'turn1'); expect(p).toBeDefined();
    expect(f.storage.read().exposures).toEqual([]);
    expect(await f.runtime.acknowledge(123, { space: 'work', agentId: 'agent1', receipt: p!.receipt })).toEqual({ recorded: true, duplicate: false });
    expect(await f.runtime.acknowledge(124, { space: 'work', agentId: 'agent1', receipt: p!.receipt })).toEqual({ recorded: false, duplicate: false });
    await f.store.update(d => { d.members[0].role = 'pending'; });
    expect(f.runtime.current(123, 'agent1', 'work', p!)).toBe(false);
  });
  it('purges withdrawn optional analytics on reconciliation and prevents old-version queued replay', async () => {
    const f = await runtimeFixture(); await f.enable(); const p = await f.runtime.prepare(123, 'agent1', 'work', 'turn1');
    await f.runtime.acknowledge(123, { space: 'work', agentId: 'agent1', receipt: p!.receipt });
    const snapshot = await f.adaptive.read(123, 'work');
    await f.adaptive.changeConsent(123, { space: 'work', purpose: 'optional.product_analytics', state: 'withdrawn',
      expectedRevision: snapshot.purposes.find(r => r.purpose === 'optional.product_analytics')!.revision, eventId: 'withdraw-analytics' });
    expect(f.runtime.current(123, 'agent1', 'work', p!)).toBe(false);
    f.runtime.reconcileAccount(123);
    expect(f.storage.read()).toMatchObject({ assignments: [], derived: [], exposures: [], tombstones: [{ kind: 'scope_suppressed' }] });
    expect(f.runtime.exportScope(123, 'work')).toMatchObject({ assignments: [], derived: [], exposures: [], suppressed: true });
    expect(await f.runtime.acknowledge(123, { space: 'work', agentId: 'agent1', receipt: p!.receipt })).toEqual({ recorded: false, duplicate: false });
  });
  it('pause stops presentation without deleting retained experiment records; resume invalidates old receipts', async () => {
    const f = await runtimeFixture(); await f.enable();
    await f.adaptive.withAccountDocument(123, d => { d.schemaVersion = 2; d.productPause = emptyProductPause(); });
    const p = (await f.runtime.prepare(123, 'agent1', 'work', 'turn1'))!; expect(p).toBeDefined();
    await f.adaptive.withAccountDocument(123, (d, now) => { d.productPause = applyProductPauseCommand(d.productPause!, d.accountId,
      { version: 1, eventId: 'synthetic-pause-event-0001', expectedCommandSeq: 0, space: 'work', action: 'pause' }, now).pause; });
    expect(f.runtime.current(123, 'agent1', 'work', p)).toBe(false); f.runtime.reconcileAccount(123);
    expect(f.storage.read().derived).toHaveLength(1);
    expect(await f.runtime.prepare(123, 'agent1', 'work', 'paused-turn')).toBeUndefined();
    await f.adaptive.withAccountDocument(123, (d, now) => { d.productPause = applyProductPauseCommand(d.productPause!, d.accountId,
      { version: 1, eventId: 'synthetic-resume-event-001', expectedCommandSeq: 1, space: 'work', action: 'resume' }, now).pause; });
    expect(f.runtime.current(123, 'agent1', 'work', p)).toBe(false);
    expect(await f.runtime.prepare(123, 'agent1', 'work', 'resumed-turn')).toBeDefined();
  });
  it('binding changes purge retained rows and preserve suppression after identity changes', async () => {
    const f = await runtimeFixture(); await f.enable(); const p = (await f.runtime.prepare(123, 'agent1', 'work', 'turn1'))!;
    await f.adaptive.withAccountDocument(123, d => { d.binding!.revision++; });
    expect(f.runtime.current(123, 'agent1', 'work', p)).toBe(false); f.runtime.reconcileAccount(123);
    expect(f.storage.read().derived).toHaveLength(0); expect(f.storage.read().assignments).toHaveLength(0);
    expect(await f.runtime.prepare(123, 'agent1', 'work', 'later-turn')).toBeUndefined();
  });
  it('invalidates export preparation after a ledger purge, and preserves exact private account/space boundary', async () => {
    const f = await runtimeFixture(); await f.enable(); await f.runtime.prepare(123, 'agent1', 'work', 'turn1');
    const prepared = f.runtime.prepareScopeExport(123, 'work'); expect(prepared.data.derived).toHaveLength(1); prepared.revalidate();
    expect(f.runtime.exportScope(124, 'work').derived).toEqual([]); expect(f.runtime.exportScope(123, 'personal').derived).toEqual([]);
    f.runtime.purgeScope(123, 'work'); expect(() => prepared.revalidate()).toThrow('changed');
  });
  it('denies at the config deadline, kill, agent revoke and fake-clock regression', async () => {
    const f = await runtimeFixture(); await f.enable(); const p = (await f.runtime.prepare(123, 'agent1', 'work', 'turn1'))!;
    f.setNow(NOW + 10_000); expect(f.runtime.current(123, 'agent1', 'work', p)).toBe(false);
    f.setNow(NOW); expect(f.runtime.current(123, 'agent1', 'work', p)).toBe(false);
    expect(await f.runtime.prepare(123, 'agent1', 'work', 'turn2')).toBeUndefined();
  });
});

describe('authenticated experiment exposure handler with real local runtime', () => {
  const token = 'synthetic-only-bot-token';
  const request = (body: unknown, actor: number | null = 123, origin = 'https://local.test') => new Request('https://local.test/api/studio/experiments/exposure', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...(actor === null ? {} : { 'x-telegram-init-data': signInitData({ id: actor, first_name: 'Synthetic' }, token) }) }, body: JSON.stringify(body),
  });
  it('records only an authenticated same-origin server receipt; rejects extra variant/scope fields and forged actor', async () => {
    const f = await runtimeFixture(); await f.enable(); const p = (await f.runtime.prepare(123, 'agent1', 'work', 'visible-turn'))!;
    const studio = { deps: { experiments: f.runtime } } as unknown as Parameters<typeof handleExperimentExposure>[0];
    const body = { space: 'work', agentId: 'agent1', receipt: p.receipt };
    expect((await handleExperimentExposure(studio, request(body, null), token)).status).toBe(401);
    expect((await handleExperimentExposure(studio, request(body, 123, 'https://attacker.test'), token)).status).toBe(403);
    expect((await handleExperimentExposure(studio, request({ ...body, variant: 'candidate' }), token)).status).toBe(400);
    expect(await (await handleExperimentExposure(studio, request(body, 124), token)).json()).toEqual({ recorded: false, duplicate: false });
    const accepted = await handleExperimentExposure(studio, request(body), token);
    expect(accepted.headers.get('cache-control')).toBe('no-store'); expect(await accepted.json()).toEqual({ recorded: true, duplicate: false });
    expect(await (await handleExperimentExposure(studio, request(body), token)).json()).toEqual({ recorded: false, duplicate: true });
  });
  it('rejects an acknowledgement after kill and accepts no configuration through the exposure endpoint', async () => {
    const f = await runtimeFixture(); await f.enable(); const p = (await f.runtime.prepare(123, 'agent1', 'work', 'visible-turn'))!;
    const studio = { deps: { experiments: f.runtime } } as unknown as Studio;
    f.controller.kill(config().id, 4, 'purge', NOW);
    expect(await (await handleExperimentExposure(studio, request({ space: 'work', agentId: 'agent1', receipt: p.receipt }), token)).json()).toEqual({ recorded: false, duplicate: false });
    expect((await handleExperimentExposure(studio, request(config()), token)).status).toBe(400);
  });
});


describe('composed experiment lifecycle integration', () => {
  it('purges after canonical withdrawal and retries an interrupted separate-store cleanup', async () => {
    const f = await runtimeFixture(); await f.enable();
    const presentation = (await f.runtime.prepare(123, 'agent1', 'work', 'composed-turn'))!;
    await f.runtime.acknowledge(123, { space: 'work', agentId: 'agent1', receipt: presentation.receipt });
    const before = await f.adaptive.read(123, 'work');
    let unavailable = true, attempts = 0;
    f.adaptive.setExperimentLifecycleReconciler(async id => {
      attempts++;
      if (unavailable) throw new Error('synthetic cleanup unavailable');
      f.runtime.reconcileAccount(id);
    });
    await expect(f.adaptive.changeConsent(123, { space: 'work', purpose: 'optional.product_analytics', state: 'withdrawn',
      expectedRevision: before.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision,
      eventId: 'composed-withdrawal' })).rejects.toThrow('cleanup unavailable');
    // A failed purge does not roll back the committed choice or permit use.
    expect(f.runtime.current(123, 'agent1', 'work', presentation)).toBe(false);
    expect(f.storage.read().derived).toHaveLength(1);
    unavailable = false;
    const after = await f.adaptive.read(123, 'work');
    expect(after.purposes.find(p => p.purpose === 'optional.product_analytics')!.state).toBe('withdrawn');
    expect(attempts).toBe(2);
    expect(f.storage.read()).toMatchObject({ assignments: [], derived: [], exposures: [], tombstones: [{ kind: 'scope_suppressed' }] });
  });
  it('includes minimized experiment data only in the authenticated selected-space export', async () => {
    const f = await runtimeFixture(); await f.enable();
    await f.runtime.prepare(123, 'agent1', 'work', 'exported-turn');
    const lifecycle = new AdaptiveLifecycleService(f.adaptive, {
      prepareExperimentExport: (id, space) => f.runtime.prepareScopeExport(id, space),
    });
    const exported = await lifecycle.exportAccount(123, 'work');
    expect(exported.experiments?.derived).toHaveLength(1);
    expect(rightsExportSchema.safeParse(exported).success).toBe(true);
    for (const internal of ['authorityRevision', 'scopeRevision', 'assignmentId', 'receipt', 'unit', 'source']) {
      expect(Object.keys(exported.experiments!.derived[0])).not.toContain(internal);
    }
    expect((await lifecycle.exportAccount(123, 'personal')).experiments?.derived).toEqual([]);
    await expect(lifecycle.exportAccount(124, 'work')).rejects.toMatchObject({ code: 'profile_confirmation_required' });
  });
});
