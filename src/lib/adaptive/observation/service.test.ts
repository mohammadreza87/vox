import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { accountIdFor, AdaptiveRepository, digest, type SpaceKind } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { AdaptiveObserverService, projectObserverEvents, sweepObserverDocument, type ObserverServiceOptions } from './service';
import { OBSERVER_LEASE_MS, OBSERVER_MAX_EVENTS, OBSERVER_RETENTION_MS, type ServerObservationInput } from './contracts';
const NOW = Date.UTC(2026, 9, 19, 12);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vox-observer-')); directories.push(directory);
  let now = NOW;
  let analyticsEligible = true;
  const capabilities = ['core_text', 'product_analytics'];
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `test-${i}`, revision: 1,
      createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic',
      effectiveAt: NOW, reviewExpiresAt: NOW + 100 * 86_400_000, owner: 'synthetic', approvalReference: 'synthetic-only' })) });
  const configured = adaptiveOptionsFromManifest(manifest);
  const factory = (options?: ObserverServiceOptions) => {
    const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), { ...configured, now: () => now, capabilityPolicy: (context, time) => context.capability === 'product_analytics' && !analyticsEligible ? undefined : configured.capabilityPolicy?.(context, time) });
    return { adaptive, observer: new AdaptiveObserverService(adaptive, options) };
  };
  const { adaptive, observer } = factory();
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  async function grant(space: SpaceKind = 'work') {
    const before = await adaptive.read(123, space);
    const p = before.purposes.find(p => p.purpose === 'optional.product_analytics')!;
    const shown = await adaptive.present(123, { space, purpose: 'optional.product_analytics', locale: 'en', expectedRevision: p.revision, eventId: randomUUID(), deliberateReopen: true });
    await adaptive.changeConsent(123, { space, purpose: 'optional.product_analytics', state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID(), receipt: shown.receipt });
    const current = await adaptive.read(123, space);
    await adaptive.setAgentAccess(123, 'agent', { space, allowed: true, expectedRevision: current.revision, eventId: randomUUID() });
  }
  const withdraw = async () => {
    const before = await adaptive.read(123, 'work');
    await adaptive.changeConsent(123, { space: 'work', purpose: 'optional.product_analytics', state: 'withdrawn', expectedRevision: before.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID() });
  };
  const input = async (eventId = 'event', overrides: Partial<ServerObservationInput> = {}): Promise<ServerObservationInput> => ({
    eventId, kind: 'response', space: 'work', agentId: 'agent', turnId: 'turn', channel: 'voice', outcome: 'responded', durationMs: 150,
    policyReceipt: (await observer.authorize(123, 'work', 'agent')) ?? '0'.repeat(64), ...overrides,
  });
  return { adaptive, observer, factory, grant, withdraw, input, setNow: (value: number) => { now = value; },
    disableAnalytics: () => { analyticsEligible = false; },
    raw: () => adaptive.withAccountDocument(123, d => structuredClone(d.observer)) };
}

describe('private bounded observation journal', () => {
  it('stores nothing before consent+grant, excludes QA, and rejects payload/identity forgery', async () => {
    const { observer, raw, grant, input } = await fixture();
    expect(await observer.recordServer(123, await input())).toEqual({ recorded: false, duplicate: false });
    expect(await raw()).toEqual({ schemaVersion: 1, events: [], projections: [] });
    await grant();
    const accepted = await input();
    for (const extra of [{ text: 'PRIVATE_CANARY' }, { error: 'PRIVATE_CANARY' }, { url: 'https://private.invalid' }, { accountId: 'forged' }, { personId: 'forged' }]) {
      expect(() => observer.recordServer(123, { ...accepted, ...extra } as never)).toThrow();
    }
    expect(await observer.recordServer(123, { ...accepted, origin: 'qa' })).toEqual({ recorded: false, duplicate: false });
    expect(() => observer.recordServer(123, { ...accepted, policyReceipt: undefined } as never)).toThrow();
    expect(await raw()).toEqual({ schemaVersion: 1, events: [], projections: [] });
  });
  it('requires a retained server voice turn before accepting unverified client reports', async () => {
    const { observer, grant, input } = await fixture(); await grant();
    const client = { eventId: 'playback', space: 'work' as const, agentId: 'agent', turnId: 'turn', outcome: 'playback_completed' as const };
    expect((await observer.recordClient(123, client)).recorded).toBe(false);
    expect(() => observer.recordClient(123, { ...client, trust: 'server', outcome: 'responded' } as never)).toThrow();
    await observer.recordServer(123, await input()); await observer.process(123);
    let snapshot = await observer.snapshot(123, 'work');
    expect(snapshot.projection).toMatchObject({ responded: 1, playbackCompleted: 0, playbackUnknown: 1 });
    expect(snapshot.completeness).toMatchObject({ verifiedTaskSuccess: null, complete: false });
    expect((await observer.recordClient(124, client)).recorded).toBe(false);
    expect((await observer.recordClient(123, { ...client, space: 'personal' })).recorded).toBe(false);
    expect((await observer.recordClient(123, client)).recorded).toBe(true); await observer.process(123);
    snapshot = await observer.snapshot(123, 'work');
    expect(snapshot.projection).toMatchObject({ responded: 1, playbackCompleted: 1, playbackUnknown: 0 });
    expect(snapshot.completeness.playbackEvidence).toBe('client_unverified');
  });
  it('deduplicates independent concurrent writers and rejects conflicting replay', async () => {
    const { observer, factory, grant, input, raw } = await fixture(); await grant(); const event = await input();
    const peer = factory().observer;
    const results = await Promise.all([observer.recordServer(123, event), peer.recordServer(123, event)]);
    expect(results.filter(r => r.recorded)).toHaveLength(1); expect(results.filter(r => r.duplicate)).toHaveLength(1);
    expect((await raw()).events).toHaveLength(1);
    await expect(peer.recordServer(123, { ...event, outcome: 'failed' })).rejects.toMatchObject({ code: 'observer_event_conflict' });
    const processing = await Promise.all([observer.process(123), peer.process(123)]);
    expect(processing.reduce((sum, p) => sum + p.processed, 0)).toBe(1);
    expect((await factory().observer.snapshot(123, 'work')).projection.responded).toBe(1);
  });
  it('replays deterministic projections independently of delivery order and converges revisions', async () => {
    const { observer, grant, input, raw } = await fixture(); await grant();
    const event = await input(); await observer.recordServer(123, event); await observer.process(123);
    await observer.recordServer(123, { ...event, revision: 2, outcome: 'failed' });
    expect((await observer.recordServer(123, event)).duplicate).toBe(true);
    await observer.recordServer(123, await input('second', { turnId: 'turn2', outcome: 'cancelled' }));
    await observer.process(123);
    const events = (await raw()).events;
    expect(projectObserverEvents(events, 'work')).toEqual(projectObserverEvents([...events].reverse(), 'work'));
    const snapshot = await observer.snapshot(123, 'work');
    expect(snapshot.projection).toMatchObject({ responded: 0, failed: 1, cancelled: 1 });
    expect(snapshot.findings[0]).toMatchObject({ rule: 'response_failure', inferredCause: null, confidence: 'observation_only', count: 1 });
    expect(snapshot.findings[0].evidenceIds).toEqual([events.find(e => e.outcome === 'failed')!.id]);
  });
  it('keeps response/playback failure and interruption evidence distinct with negative controls', async () => {
    const { observer, grant, input } = await fixture(); await grant();
    await observer.recordServer(123, await input());
    await observer.recordServer(123, await input('failed', { turnId: 'failed', outcome: 'failed' }));
    const client = { space: 'work' as const, agentId: 'agent', turnId: 'turn' };
    await observer.recordClient(123, { ...client, eventId: 'client1', outcome: 'playback_failed' });
    await observer.recordClient(123, { ...client, eventId: 'client2', outcome: 'interrupted' });
    await observer.recordClient(123, { ...client, eventId: 'client3', outcome: 'interrupted' });
    await observer.process(123);
    const snapshot = await observer.snapshot(123, 'work');
    expect(snapshot.findings.map(f => [f.rule, f.count])).toEqual([['response_failure', 1], ['playback_failure', 1], ['interruption', 1]]);
    expect(snapshot.projection).toMatchObject({ responded: 1, failed: 1, playbackFailed: 1, interruptions: 1 });
    expect((await observer.snapshot(123, 'personal')).findings).toEqual([]);
  });
  it('purges queued, leased and derived results on withdrawal, and stale receipt cannot resurrect after regrant', async () => {
    const { adaptive, observer, factory, grant, input, withdraw, raw } = await fixture(); await grant();
    const old = await input(); await observer.recordServer(123, old);
    let enter!: () => void, leave!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }); const release = new Promise<void>(resolve => { leave = resolve; });
    const worker = factory({ beforeConsume: async () => { enter(); await release; } }).observer;
    const process = worker.process(123); await entered; await withdraw();
    // Core read, rather than an observer read, proves mutation hook eagerly purges.
    await adaptive.read(123, 'work'); expect(await raw()).toEqual({ schemaVersion: 1, events: [], projections: [] });
    leave(); expect(await process).toEqual({ processed: 0, failed: 0 });
    await grant(); expect((await observer.recordServer(123, old)).recorded).toBe(false);
    expect((await observer.snapshot(123, 'work')).findings).toEqual([]);
  });
  it('rechecks the server eligibility registry during delayed consumption', async () => {
    const { observer, factory, grant, input, raw, disableAnalytics } = await fixture(); await grant();
    await observer.recordServer(123, await input());
    const worker = factory({ beforeConsume: async () => { disableAnalytics(); } }).observer;
    expect(await worker.process(123)).toEqual({ processed: 0, failed: 0 });
    expect(await raw()).toEqual({ schemaVersion: 1, events: [], projections: [] });
    expect((await observer.snapshot(123, 'work')).available).toBe(false);
  });
  it.each(['withdrawal', 'eligibility', 'lease_expiry'] as const)('does not dispatch later claimed callbacks after %s during an earlier callback', async change => {
    const f = await fixture(); await f.grant();
    await f.observer.recordServer(123, await f.input('first', { turnId: 'first' }));
    await f.observer.recordServer(123, await f.input('second', { turnId: 'second' }));
    let callbacks = 0;
    const worker = f.factory({ beforeConsume: async () => {
      callbacks++;
      if (callbacks !== 1) return;
      if (change === 'withdrawal') await f.withdraw();
      if (change === 'eligibility') f.disableAnalytics();
      if (change === 'lease_expiry') f.setNow(NOW + OBSERVER_LEASE_MS + 1);
    } }).observer;
    expect(await worker.process(123)).toEqual({ processed: 0, failed: 0 });
    expect(callbacks).toBe(1);
    expect((await f.observer.snapshot(123, 'work')).projection.sourceEvents).toBe(0);
  });
  it('does not dispatch a replaced event from an earlier batch copy', async () => {
    const f = await fixture(); await f.grant();
    const second = await f.input('second', { turnId: 'second' });
    await f.observer.recordServer(123, await f.input('first', { turnId: 'first' }));
    f.setNow(NOW + 1);
    await f.observer.recordServer(123, second);
    let callbacks = 0;
    const worker = f.factory({ beforeConsume: async () => {
      callbacks++;
      if (callbacks === 1) await f.observer.recordServer(123, { ...second, revision: 2, outcome: 'failed' });
    } }).observer;
    expect(await worker.process(123)).toEqual({ processed: 1, failed: 0 });
    expect(callbacks).toBe(1);
    expect(await f.observer.process(123)).toEqual({ processed: 1, failed: 0 });
    expect((await f.observer.snapshot(123, 'work')).projection).toMatchObject({ responded: 1, failed: 1 });
  });
  it('purges prior findings and refuses in-flight results when exact agent grant changes', async () => {
    const { adaptive, observer, grant, input, raw } = await fixture(); await grant();
    const old = await input('failure', { outcome: 'failed' }); await observer.recordServer(123, old); await observer.process(123);
    expect((await raw()).projections[0].findings).toHaveLength(1);
    let snapshot = await adaptive.read(123, 'work');
    await adaptive.setAgentAccess(123, 'agent', { space: 'work', allowed: false, expectedRevision: snapshot.revision, eventId: randomUUID() });
    expect((await raw()).events).toEqual([]);
    snapshot = await adaptive.read(123, 'work');
    await adaptive.setAgentAccess(123, 'agent', { space: 'work', allowed: true, expectedRevision: snapshot.revision, eventId: randomUUID() });
    expect((await observer.recordServer(123, old)).recorded).toBe(false);
  });
  it('reclaims a crashed lease after restart and suppresses the stale worker commit', async () => {
    const { observer, factory, grant, input, setNow, raw } = await fixture(); await grant(); await observer.recordServer(123, await input());
    let enter!: () => void, leave!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }); const release = new Promise<void>(resolve => { leave = resolve; });
    const worker = factory({ beforeConsume: async () => { enter(); await release; } }).observer;
    const first = worker.process(123); await entered;
    setNow(NOW + OBSERVER_LEASE_MS + 1);
    expect(await factory().observer.process(123)).toEqual({ processed: 1, failed: 0 });
    leave(); expect(await first).toEqual({ processed: 0, failed: 0 });
    expect((await raw()).events[0]).toMatchObject({ state: 'processed', attempts: 2 });
    expect((await observer.snapshot(123, 'work')).projection.responded).toBe(1);
  });
  it('bounds backoff and failed events, stores no thrown errors, and repairs with same ID', async () => {
    const { factory, observer, grant, input, setNow, raw } = await fixture(); await grant(); await observer.recordServer(123, await input());
    const failing = factory({ beforeConsume: async () => { throw new Error('PRIVATE_ERROR_CANARY'); } }).observer;
    expect(await failing.process(123)).toEqual({ processed: 0, failed: 1 });
    expect(await failing.process(123)).toEqual({ processed: 0, failed: 0 });
    setNow(NOW + 1000); await failing.process(123); setNow(NOW + 3000); await failing.process(123);
    expect((await raw()).events[0]).toMatchObject({ state: 'failed', attempts: 3, failureCode: 'retry_exhausted' });
    expect(JSON.stringify(await raw())).not.toContain('PRIVATE_ERROR_CANARY');
    const snapshot = await observer.snapshot(123, 'work');
    expect(snapshot.queue.failed).toBe(1); expect(snapshot.completeness.processedEvents).toBe(0);
    expect(await observer.retryFailed(123, 'work')).toEqual({ retried: 1 });
    expect(await observer.process(123)).toEqual({ processed: 1, failed: 0 });
  });
  it('expires journal+findings and never counts expired client outcomes', async () => {
    const { observer, adaptive, grant, input, raw, setNow } = await fixture(); await grant();
    await observer.recordServer(123, await input('failed', { outcome: 'failed' })); await observer.process(123);
    setNow(NOW + OBSERVER_RETENTION_MS);
    await adaptive.withAccountDocument(123, (d, now) => {
      sweepObserverDocument(d, now, (doc, space, agentId, time) => adaptive.isPurposeAllowed(doc, space, 'optional.product_analytics', time, agentId));
    });
    expect(await raw()).toEqual({ schemaVersion: 1, events: [], projections: [] });
    expect((await observer.snapshot(123, 'work')).projection.responseTurns).toBe(0);
  });
  it('applies trusted Studio agent filters before consuming or projecting evidence', async () => {
    const { observer, grant, input } = await fixture(); await grant();
    await observer.recordServer(123, await input('failure', { outcome: 'failed' }));
    expect(await observer.process(123, { allowedAgentIds: [] })).toEqual({ processed: 0, failed: 0 });
    expect((await observer.snapshot(123, 'work', { allowedAgentIds: [] })).completeness.acceptedEvents).toBe(0);
    await observer.process(123, { allowedAgentIds: ['agent'] });
    expect((await observer.snapshot(123, 'work', { allowedAgentIds: ['other'] })).findings).toEqual([]);
    expect((await observer.snapshot(123, 'work', { allowedAgentIds: ['agent'] })).findings).toHaveLength(1);
  });
  it('rejects capacity without evicting accepted or failed evidence', async () => {
    const { adaptive, observer, factory, grant, input, raw, setNow } = await fixture(); await grant();
    await observer.recordServer(123, await input('processed', { turnId: 'processed' }));
    expect(await observer.process(123)).toEqual({ processed: 1, failed: 0 });
    await observer.recordServer(123, await input('failed', { turnId: 'failed' }));
    const failing = factory({ beforeConsume: async () => { throw new Error('synthetic worker failure'); } }).observer;
    await failing.process(123); setNow(NOW + 1000); await failing.process(123); setNow(NOW + 3000); await failing.process(123);
    await observer.recordServer(123, await input('pending', { turnId: 'pending' }));
    const admitted = await raw();
    expect(admitted.events.map(event => event.state).sort()).toEqual(['failed', 'pending', 'processed']);
    const pending = admitted.events.find(event => event.state === 'pending')!;
    // Admission and processing are exercised above. Fill repetitive setup in
    // one schema-validated FILE transaction; both boundary writes remain real.
    await adaptive.withAccountDocument(123, (d, now) => {
      for (let n = d.observer.events.length; n < OBSERVER_MAX_EVENTS - 1; n++) d.observer.events.push({ ...structuredClone(pending),
        id: digest(['capacity-fixture', n]), turnKey: digest(['capacity-turn', n]), fingerprint: digest(['capacity-payload', n]) });
      d.revision++; d.updatedAt = now;
    });
    expect((await raw()).events).toHaveLength(OBSERVER_MAX_EVENTS - 1);
    const last = await input('last-slot', { turnId: 'last-slot' });
    expect(await observer.recordServer(123, last)).toMatchObject({ recorded: true, duplicate: false });
    const full = await raw(); expect(full.events).toHaveLength(OBSERVER_MAX_EVENTS);
    expect(full.events).toEqual(expect.arrayContaining(admitted.events));
    await expect(observer.recordServer(123, { ...last, eventId: 'overflow', turnId: 'overflow' })).rejects.toMatchObject({ code: 'observer_capacity' });
    expect(await raw()).toEqual(full);
  });
});

describe('stage/usage and explicit task outcome journal', () => {
  it('persists numeric receipts only with current consent, correlates task feedback and purges all on withdrawal', async () => {
    const { adaptive, observer, grant, withdraw, input, raw } = await fixture(); await grant();
    const telemetry = { version: 1 as const, stages: [{ stage: 'generation' as const, outcome: 'succeeded' as const, durationMs: 24 }],
      usage: [{ provider: 'anthropic' as const, modelFamily: 'claude' as const, inputTokens: 10, outputTokens: 4, cacheReadTokens: null, cacheWriteTokens: null, status: 'complete' as const }], truncated: false };
    const captured = await input('telemetry', { channel: 'text', telemetry });
    await observer.recordServer(123, captured); await observer.process(123);
    expect(await observer.recordClient(124, { eventId: 'task-report', space: 'work', agentId: 'agent', turnId: 'turn', outcome: 'task_succeeded' })).toMatchObject({ recorded: false });
    expect(await observer.recordClient(123, { eventId: 'task-report', space: 'personal', agentId: 'agent', turnId: 'turn', outcome: 'task_succeeded' })).toMatchObject({ recorded: false });
    expect(await observer.recordClient(123, { eventId: 'task-report', space: 'work', agentId: 'agent', turnId: 'turn', outcome: 'task_succeeded' })).toMatchObject({ recorded: true });
    await observer.process(123);
    const snapshot = await observer.snapshot(123, 'work');
    expect(snapshot.projection.telemetry).toMatchObject({ inputTokens: 10, outputTokens: 4, reportedTaskSucceeded: 1, billedCost: null });
    expect(snapshot.completeness.verifiedTaskSuccess).toBeNull();
    await withdraw(); expect(await raw()).toEqual({ schemaVersion: 1, events: [], projections: [] });
    expect(await observer.recordServer(123, captured)).toMatchObject({ recorded: false });
    expect(await adaptive.withAccountDocument(123, d => d.observer.events.length)).toBe(0);
  });
  it('retains cancelled usage, idempotently replaces a revised report and excludes prediction responses', async () => {
    const { observer, grant, input } = await fixture(); await grant();
    await observer.recordServer(123, await input('prediction', { operation: 'prediction', telemetry: { version: 1, stages: [{ stage: 'decisions', outcome: 'cancelled', durationMs: 400 }], usage: [], truncated: false } }));
    await observer.recordServer(123, await input('cancelled', { turnId: 'cancelled-turn', outcome: 'cancelled' }));
    await observer.process(123);
    const result = await observer.snapshot(123, 'work');
    expect(result.projection).toMatchObject({ responseTurns: 1, cancelled: 1, responded: 0 });
    expect(result.projection.telemetry?.stages.find(s => s.stage === 'decisions')).toMatchObject({ cancelled: 1, samples: 1 });
    expect(result.projection.telemetry?.inputTokens).toBeNull();
  });
});

describe('committed text and correction metadata', () => {
  it('accepts text only on the exact accepted text conversation, deduplicates and never verifies task success', async () => {
    const f = await fixture(); await f.grant();
    const report = { eventId: 'text-turn', space: 'work' as const, agentId: 'agent', turnId: 'turn', outcome: 'text_rendered' as const, durationMs: 321 };
    expect(await f.observer.recordClient(123, report)).toMatchObject({ recorded: false });
    await f.observer.recordServer(123, await f.input());
    expect(await f.observer.recordClient(123, report)).toMatchObject({ recorded: false });
    await f.observer.recordServer(123, await f.input('text', { channel: 'text', turnId: 'text-turn' }));
    const text = { ...report, turnId: 'text-turn' };
    expect(await f.observer.recordClient(124, text)).toMatchObject({ recorded: false });
    expect(await f.observer.recordClient(123, { ...text, space: 'personal' })).toMatchObject({ recorded: false });
    expect(await f.observer.recordClient(123, text)).toMatchObject({ recorded: true });
    expect(await f.observer.recordClient(123, text)).toMatchObject({ duplicate: true });
    await f.observer.process(123);
    const snapshot = await f.observer.snapshot(123, 'work');
    expect(snapshot.projection.clientExperience).toMatchObject({ version: 1, trust: 'client_unverified', textRendered: 1, meanTimeToTextMs: 321 });
    expect(snapshot.projection.taskOutcomesUnknown).toBe(2); expect(snapshot.completeness.verifiedTaskSuccess).toBeNull();
    const raw = await f.raw(); expect(raw.events.find(e => e.outcome === 'text_rendered')).toMatchObject({ clientExperienceVersion: 1 });
    await f.withdraw(); expect((await f.raw()).events).toHaveLength(0);
    expect(await f.observer.recordClient(123, text)).toMatchObject({ recorded: false });
  });
  it('correlates saved feedback with the canonical command receipt, isolates scope, and removes reports on withdrawal', async () => {
    const f = await fixture(); await f.grant();
    const receipt = await f.observer.authorizeCorrection(123, 'work'); expect(receipt).toBeTypeOf('string');
    const input = { version: 1 as const, eventId: 'save-command', space: 'work' as const, policyReceipt: receipt!, outcome: 'correction_client_saved' as const };
    expect(await f.observer.recordCorrection(123, input)).toMatchObject({ recorded: false });
    const before = await f.adaptive.read(123, 'work');
    const created = await f.adaptive.createMemory(123, { space: 'work', text: 'PRIVATE_NOTE_CANARY', expectedRevision: before.revision, eventId: randomUUID() });
    const note = created.memories[0];
    await f.adaptive.correctMemory(123, note.id, { space: 'work', text: 'PRIVATE_CORRECTION_CANARY', expectedRevision: note.revision, eventId: input.eventId }, { authorizeNow: () => true });
    expect(await f.observer.recordCorrection(124, input)).toMatchObject({ recorded: false });
    expect(await f.observer.recordCorrection(123, { ...input, space: 'personal' })).toMatchObject({ recorded: false });
    expect(await f.observer.recordCorrection(123, input)).toMatchObject({ recorded: true });
    expect(await f.observer.recordCorrection(123, input)).toMatchObject({ duplicate: true });
    const unconfirmed = { ...input, eventId: 'unknown-command', outcome: 'correction_client_unconfirmed' as const };
    expect(await f.observer.recordCorrection(123, unconfirmed)).toMatchObject({ recorded: true });
    const snapshot = await f.observer.snapshot(123, 'work');
    expect(snapshot.projection.clientExperience).toMatchObject({ correctionSaved: 1, correctionUnconfirmed: 1, correctionAcceptedReceipts: 1 });
    expect(snapshot.completeness.clientCorrectionReports).toBe(2); expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_');
    const raw = await f.raw(); expect(JSON.stringify(raw)).not.toContain(note.id); expect(JSON.stringify(raw)).not.toContain(input.eventId);
    const { AdaptiveLifecycleService } = await import('../lifecycle/service');
    const exported = await new AdaptiveLifecycleService(f.adaptive).exportAccount(123, 'work');
    expect(exported.observerCorrections).toHaveLength(2);
    expect(JSON.stringify(exported.observerCorrections)).not.toMatch(/PRIVATE_|save-command|account|policyReceipt/);
    await f.withdraw(); expect((await f.raw()).corrections).toBeUndefined();
    expect(await f.observer.recordCorrection(123, input)).toMatchObject({ recorded: false });
    await f.grant(); expect(await f.observer.recordCorrection(123, input)).toMatchObject({ recorded: false });
  });
  it('rejects arbitrary correction payloads and bounds all new records with the shared journal limit', async () => {
    const f = await fixture(); await f.grant();
    const policyReceipt = (await f.observer.authorizeCorrection(123, 'work'))!;
    const input = { version: 1 as const, eventId: 'unconfirmed', space: 'work' as const, policyReceipt, outcome: 'correction_client_unconfirmed' as const };
    expect(() => f.observer.recordCorrection(123, { ...input, text: 'PRIVATE_CANARY' } as never)).toThrow();
    for (let i = 0; i < OBSERVER_MAX_EVENTS; i++) await f.observer.recordCorrection(123, { ...input, eventId: `unknown-${i}` });
    await expect(f.observer.recordCorrection(123, input)).rejects.toMatchObject({ code: 'observer_capacity' });
    f.setNow(NOW + OBSERVER_RETENTION_MS + 1);
    expect((await f.observer.snapshot(123, 'work')).projection.clientExperience).toBeUndefined();
    expect((await f.raw()).corrections).toBeUndefined();
  });
});
