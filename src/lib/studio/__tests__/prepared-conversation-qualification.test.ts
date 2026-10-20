/** Author qualification fixture derived from the reported consumer setup.
 * Real signed handlers, prepared canonical files and installed provider adapter;
 * the configured provider fetch is synthetic and global network is forbidden.
 * This is regression evidence, not independent acceptance or provider approval. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { prepareProductPauseAdaptiveStorage } from '../../adaptive/persistence/indexed/migration';
import { openLocalAdaptiveStorage } from '../../adaptive/persistence/runtime-storage';
import { hasCommittedPersonalizationTransport } from '../../adaptive/persistence/indexed-private-context';
import { ManagedFileV2Storage } from '../../adaptive/persistence/indexed/managed-storage';
import { AdaptiveExperienceService } from '../../adaptive/runtime/service';
import { AdaptiveObserverService } from '../../adaptive/observation/service';
import { FileExperimentStorage } from '../../adaptive/experiments/storage';
import { ControlledExperimentService } from '../../adaptive/experiments/service';
import { StudioExperimentRuntime } from '../../adaptive/experiments/runtime';
import { AnthropicLLM } from '../../tireh/llm';
import { handleConversationRequest } from '../conversation';
import { handleExperimentExposure } from '../experiments-http';
import { signInitData } from '../auth';
import { personId } from '../org-bridge';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const disposers: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const close of disposers.splice(0).reverse()) close(); });
const TOKEN = 'synthetic-prepared-consumer-token', REPLY = 'SYNTHETIC_VALID_PROVIDER_REPLY', SOURCE = 'QUALIFICATION_SOURCE_CANARY';
type Format = 'sqlite-v1' | 'file-v2';
async function fixture(format: Format) {
  const now = Date.now(), dir = mkdtempSync(join(realpathSync(tmpdir()), 'vox-prepared-consumer-author-'));
  disposers.push(() => rmSync(dir, { recursive: true, force: true }));
  const h = makeStudio(); disposers.push(() => rmSync(h.dir, { recursive: true, force: true })); h.clock.now = new Date(now);
  const users = await seedOrg(h), { agent } = await hire(h, users.alice);
  // Same explicit preparation and opener as persistent production runtime. No
  // direct default-schema constructor can accidentally select a legacy cohort.
  const root = join(dir, 'adaptive'); mkdirSync(root);
  await prepareProductPauseAdaptiveStorage(root, format, { quiesced: true, now: () => now });
  const opened = openLocalAdaptiveStorage(root, format, () => now); disposers.push(opened.close);
  expect(opened.storage.canonicalSchemaVersion).toBe(2); expect(hasCommittedPersonalizationTransport(opened.storage)).toBe(true);
  const capabilities = ['core_text', 'personalization', 'product_analytics'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-consumer', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: now, updatedAt: now,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-consumer', effectiveAt: now, reviewExpiresAt: now + 3_600_000, owner: 'synthetic', approvalReference: 'synthetic-only' })) }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(opened.storage), { ...options, now: () => now });
  h.studio.deps.adaptive = adaptive; h.studio.deps.experience = new AdaptiveExperienceService(adaptive); h.studio.deps.observer = new AdaptiveObserverService(adaptive);
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true, expectedRevision: (await adaptive.read(ID.alice, 'work')).revision, eventId: randomUUID() });
  for (const purpose of ['optional.personalization', 'optional.product_analytics'] as const) {
    const before = await adaptive.read(ID.alice, 'work'), shown = await adaptive.present(ID.alice, { space: 'work', purpose, locale: 'en', expectedRevision: before.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID() });
    await adaptive.changeConsent(ID.alice, { space: 'work', purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), receipt: shown.receipt });
  }
  await adaptive.createMemory(ID.alice, { space: 'work', text: `Launchcodename is ${SOURCE}.`, expectedRevision: (await adaptive.read(ID.alice, 'work')).revision, eventId: randomUUID() });
  const ledger = new FileExperimentStorage(join(dir, 'experiments')), controller = new ControlledExperimentService(ledger);
  controller.install({ schemaVersion: 1, id: 'prepared-consumer', assignmentVersion: 1, assignmentKind: 'private_person', salt: 'a'.repeat(64), baselineArtifact: 'b'.repeat(64), candidateArtifact: 'c'.repeat(64), candidateBasisPoints: 5000, candidateDensity: 'compact', baselineDensity: 'comfortable', startsAt: now, expiresAt: now + 600_000,
    review: { owner: 'owner', reviewer: 'reviewer', reference: 'synthetic', reviewedAt: now, offlineEvidence: 'synthetic', shadowEvidence: 'synthetic' }, retention: { policyVersion: 'synthetic', approvalReference: 'synthetic', retainUntil: now + 1_000_000 },
    stoppingRules: { maxAssignments: 20, maxExposures: 20, maxFailures: 2, successMetric: 'client_reported_readability', guardrail: 'presentation_failure' } }, now);
  for (const [i, phase] of (['offline', 'shadow', 'pilot'] as const).entries()) controller.transition('prepared-consumer', i + 1, phase, now);
  const experiments = new StudioExperimentRuntime(controller, adaptive, h.store, () => now); h.studio.deps.experiments = experiments;
  adaptive.setExperimentLifecycleReconciler(async id => experiments.reconcileAccount(id));
  const headers = { origin: 'https://synthetic.test', 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN) };
  const converse = () => handleConversationRequest(h.studio, new Request('https://synthetic.test/api/studio/conversation', { method: 'POST', headers, body: JSON.stringify({ agentId: agent.id, space: 'work', text: 'What is launchcodename?' }) }), TOKEN);
  const acknowledge = (receipt: string) => handleExperimentExposure(h.studio, new Request('https://synthetic.test/api/studio/experiments/exposure', { method: 'POST', headers, body: JSON.stringify({ agentId: agent.id, space: 'work', receipt }) }), TOKEN);
  const wire: string[] = [], guards = { asynchronous: 0, synchronous: 0 };
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    wire.push(String(init?.body));
    // Read the actual committed Studio/canonical boundary at configured fetch.
    expect(h.studio.adaptiveContextAuthorityNow(agent.id, personId(ID.alice), 'work').validUntil).toBeGreaterThan(now);
    return Response.json({ id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic-model', content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  });
  const installProvider = () => {
    const llm = new AnthropicLLM('synthetic-not-real-key', 'synthetic-model', transport), complete = llm.complete.bind(llm);
    vi.spyOn(llm, 'complete').mockImplementation(async request => {
      expect(request.authorize).toBeTypeOf('function'); expect(request.authorizeNow).toBeTypeOf('function');
      return complete({ ...request, authorize: async () => { guards.asynchronous++; return request.authorize!(); }, authorizeNow: () => { guards.synchronous++; return request.authorizeNow!(); } });
    });
    // Same wrapper as runtime chatLLM when STUDIO_WEB_SEARCH=off.
    h.studio.deps.chatLLM = { identity: llm.identity, committedExportFence: llm.committedExportFence, complete: request => llm.complete(request) }; return llm;
  };
  // Installed SDK runs as a server; all outgoing fetch attempts except the
  // explicitly injected synthetic provider transport are forbidden.
  vi.stubGlobal('window', undefined); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external_network_forbidden'); }));
  return { h, agent, adaptive, storage: opened.storage, ledger, controller, experiments, converse, acknowledge, installProvider, transport, wire, guards, now };
}

describe('prepared canonical conversation consumer qualification', () => {
  it.each(['sqlite-v1', 'file-v2'] as const)('%s qualifies guarded provider, actual private lookup, exposure and kill baseline', async format => {
    const f = await fixture(format);
    // Reproduce the reported fallback without experiments. Generic FakeLLM
    // intentionally lacks a committed transport fence and is never called.
    delete f.h.studio.deps.experiments;
    const unqualified = await f.converse(); expect(unqualified.status).toBe(200);
    expect((await unqualified.json()).reply).toBe('The conversation settings changed. Please try again.'); expect(f.h.chatLLM.replyRequests).toHaveLength(0);
    f.installProvider(); const acquire = vi.spyOn(f.adaptive, 'readPrivateContext');
    const baseline = await f.converse(); expect(baseline.status).toBe(200); expect((await baseline.json()).reply).toBe(REPLY);
    expect(f.transport).toHaveBeenCalledOnce(); expect(f.wire[0]).toContain(SOURCE); expect(acquire).toHaveBeenCalledWith(ID.alice, 'work', f.agent.id, 'What is launchcodename?');
    expect(f.guards.asynchronous).toBeGreaterThan(0); expect(f.guards.synchronous).toBeGreaterThanOrEqual(2); expect(f.wire[0]).not.toMatch(/authorizeNow|authorizeExportNow/);
    f.h.studio.deps.experiments = f.experiments;
    const response = await f.converse(); expect(response.status).toBe(200); const data = await response.json(); expect(data.reply).toBe(REPLY);
    expect(data.responsePresentation).toEqual({ density: expect.stringMatching(/^(comfortable|compact)$/), receipt: expect.stringMatching(/^[a-f0-9]{64}$/) }); expect(f.ledger.read().exposures).toHaveLength(0);
    expect(await (await f.acknowledge(data.responsePresentation.receipt)).json()).toEqual({ recorded: true, duplicate: false }); expect(f.ledger.read().exposures).toHaveLength(1);
    f.controller.kill('prepared-consumer', 4, 'quarantine', f.now);
    const killed = await f.converse(); expect(killed.status).toBe(200); const killedData = await killed.json(); expect(killedData.reply).toBe(REPLY); expect(killedData.responsePresentation).toBeUndefined();
    expect(await (await f.acknowledge(data.responsePresentation.receipt)).json()).toEqual({ recorded: false, duplicate: false });
    expect(f.transport).toHaveBeenCalledTimes(3); expect(JSON.stringify(f.ledger.read())).not.toContain(SOURCE);
  });
  it.each((['sqlite-v1', 'file-v2'] as const).flatMap(format => (['optional.product_analytics', 'optional.personalization'] as const).map(purpose => ({ format, purpose }))))('$format withdrawal of $purpose denies stale exposure while preserving a real core reply', async ({ format, purpose }) => {
    const f = await fixture(format); f.installProvider();
    const response = await f.converse(), data = await response.json(); expect(response.status).toBe(200); expect(data.reply).toBe(REPLY); expect(data.responsePresentation).toBeDefined(); expect(f.wire[0]).toContain(SOURCE);
    const current = await f.adaptive.read(ID.alice, 'work');
    await f.adaptive.changeConsent(ID.alice, { space: 'work', purpose, state: 'withdrawn', expectedRevision: current.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID() });
    expect(await (await f.acknowledge(data.responsePresentation.receipt)).json()).toEqual({ recorded: false, duplicate: false }); expect(f.ledger.read().exposures).toHaveLength(0);
    const after = await f.converse(); expect(after.status).toBe(200); const afterData = await after.json(); expect(afterData.reply).toBe(REPLY); expect(afterData.responsePresentation).toBeUndefined(); expect(f.transport).toHaveBeenCalledTimes(2);
    if (purpose === 'optional.personalization') expect(f.wire[1]).not.toContain(SOURCE); else { expect(f.wire[1]).toContain(SOURCE); expect(afterData.turnId).toBeUndefined(); }
    expect(JSON.stringify(f.ledger.read())).not.toContain(SOURCE);
  });
  it.each(['sqlite-v1', 'file-v2'] as const)('%s final configured SDK fetch refuses a grant revoked during asynchronous SDK preparation', async format => {
    const f = await fixture(format), llm = f.installProvider();
    const client = (llm as unknown as { getClient(): { prepareOptions(options: unknown): Promise<void> } }).getClient(), prepare = client.prepareOptions.bind(client);
    let prepared = false;
    client.prepareOptions = async options => {
      await prepare(options); prepared = true;
      const current = await f.adaptive.readAuthority(ID.alice, 'work');
      await f.adaptive.setAgentAccess(ID.alice, f.agent.id, { space: 'work', allowed: false, expectedRevision: current.revision, eventId: randomUUID() });
    };
    const response = await f.converse(); expect(prepared).toBe(true); expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain(REPLY); expect(f.transport).not.toHaveBeenCalled(); expect(f.wire).toEqual([]);
    expect(f.guards.asynchronous).toBeGreaterThan(0); expect(f.guards.synchronous).toBeGreaterThanOrEqual(2);
    expect(f.ledger.read().exposures).toHaveLength(0);
  });
  it('default FILEv2 constructor is schema 1 and cannot qualify the prepared schema 2 comparison', () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'vox-unprepared-file-control-')); disposers.push(() => rmSync(dir, { recursive: true, force: true }));
    const storage = new ManagedFileV2Storage(join(dir, 'store')); disposers.push(() => storage.close());
    expect(storage.canonicalSchemaVersion).toBe(1); expect(hasCommittedPersonalizationTransport(storage)).toBe(false);
  });
});
