import { describe, expect, it } from 'vitest';
import { TurnTrace, captureUsage, measureStage, observedUsage } from './trace';
import { projectObserverEvents } from './helpers';
import { observerEventSchema, emptyObserverDocument, serverObservationInputSchema } from './contracts';
import { stripObserverTelemetryForRollback } from './telemetry-rollback';
const event = (id: string, outcome: string, trust = 'server', extra = {}) => observerEventSchema.parse({ schemaVersion: 1, version: 'vox-observer-v1',
  id: id.repeat(64), fingerprint: 'f'.repeat(64), revision: 1, turnKey: 'e'.repeat(64), origin: 'human', purpose: 'optional.product_analytics', policyVersion: 'adaptive-privacy-v1',
  consentEpoch: 1, permissionRevision: 1, grantRevision: 1, bindingRevision: 1, accountId: 'account', personId: 'person', space: 'work', spaceId: 'space', agentId: 'agent', policyReceipt: 'd'.repeat(64),
  trust, channel: 'text', outcome, occurredAt: 1, receivedAt: 1, expiresAt: 10000, state: 'processed', attempts: 1, nextAttemptAt: 1, ...extra });
describe('bounded content-free turn telemetry', () => {
  it('keeps concurrent scopes isolated and never estimates missing tokens or billing', async () => {
    const first = new TurnTrace(true), second = new TurnTrace(true), off = new TurnTrace(false);
    await Promise.all([first.run(() => measureStage('generation', async () => { await Promise.resolve(); observedUsage('anthropic', 'claude', { inputTokens: 11, outputTokens: 0 }); })),
      second.run(() => measureStage('tts', async () => observedUsage('elevenlabs', 'eleven', {})))]);
    expect(first.snapshot()?.usage).toMatchObject([{ inputTokens: 11, outputTokens: 0, status: 'complete' }]);
    expect(second.snapshot()?.usage).toMatchObject([{ inputTokens: null, outputTokens: null, status: 'unavailable' }]);
    await off.run(async () => observedUsage('openai', 'gpt', { inputTokens: 99 })); expect(off.snapshot()).toBeUndefined();
    first.clear(); expect(first.snapshot()).toBeUndefined();
  });
  it('bounds spans/receipts and makes hostile usage accessors non-interfering', async () => {
    const trace = new TurnTrace(true);
    await trace.run(async () => { for (let i = 0; i < 30; i++) { await measureStage('generation', async () => true); observedUsage('anthropic', 'claude', { inputTokens: 1 }); } });
    expect(trace.snapshot()).toMatchObject({ truncated: true }); expect(trace.snapshot()?.stages).toHaveLength(16); expect(trace.snapshot()?.usage).toHaveLength(16);
    let touched = false;
    captureUsage('anthropic', 'claude', () => { touched = true; throw new Error('PRIVATE_ERROR_CANARY'); }); expect(touched).toBe(false);
    const fresh = new TurnTrace(true);
    await fresh.run(async () => captureUsage('anthropic', 'claude', () => { throw new Error('PRIVATE_ERROR_CANARY'); }));
    expect(JSON.stringify(fresh.snapshot())).not.toContain('PRIVATE_ERROR_CANARY'); expect(fresh.snapshot()?.usage[0].status).toBe('unavailable');
  });
  it('keeps reported success unverified and preparation out of response denominator; absent measurements stay null', () => {
    const trace = new TurnTrace(true); trace.stage('generation', 'failed', 15); trace.usage({ provider: 'anthropic', modelFamily: 'claude', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, status: 'unavailable' });
    const server = event('a', 'responded', 'server', { telemetry: trace.snapshot() });
    const report = event('b', 'task_succeeded', 'client_unverified');
    const prediction = event('c', 'responded', 'server', { turnKey: 'c'.repeat(64), operation: 'prediction', telemetry: trace.snapshot() });
    const p = projectObserverEvents([server, report, prediction], 'work');
    expect(p.responseTurns).toBe(1); expect(p.taskOutcomesUnknown).toBe(0);
    expect(p.telemetry).toMatchObject({ instrumentedTurns: 2, reportedTaskSucceeded: 1, inputTokens: null, outputTokens: null, billedCost: null, usageComplete: false });
    expect(projectObserverEvents([], 'work').telemetry?.stages.every(stage => stage.meanMs === null)).toBe(true);
    expect(() => serverObservationInputSchema.parse({ eventId: 'event', turnId: 'turn', agentId: 'agent', space: 'work', channel: 'text', kind: 'response', outcome: 'responded', policyReceipt: 'a'.repeat(64), telemetry: { ...trace.snapshot(), transcript: 'PRIVATE' } })).toThrow();
  });
  it('rolls back only new telemetry/outcome records and projections without touching source data', () => {
    const original = { accountId: 'telegram-account:123', memories: [{ text: 'AUTHORED_MEMORY' }], observer: { ...emptyObserverDocument(),
      events: [event('a', 'responded', 'server', { telemetry: { version: 1, stages: [], usage: [], truncated: false } }), event('b', 'task_failed', 'client_unverified')] } };
    const result = stripObserverTelemetryForRollback(original, original.accountId) as typeof original;
    expect(result.memories).toEqual(original.memories); expect(result.observer.events).toHaveLength(1);
    expect(result.observer.events[0]).not.toHaveProperty('telemetry'); expect(original.observer.events).toHaveLength(2);
  });
});

it('requires stopped producers and exact CAS for explicit-account rollback', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { createHash } = await import('node:crypto');
  const { pruneFileObserverTelemetry } = await import('./telemetry-rollback');
  const directory = await mkdtemp(join(tmpdir(), 'vox-telemetry-rollback-')), accountId = 'telegram-account:123';
  const filename = join(directory, createHash('sha256').update(accountId).digest('hex') + '.json');
  const original = { accountId, memories: [{ text: 'PRESERVED_AUTHORED' }], observer: { ...emptyObserverDocument(), events: [event('a', 'responded', 'server', { telemetry: { version: 1, stages: [], usage: [], truncated: false } })] } };
  await writeFile(filename, JSON.stringify(original));
  try {
    const before = await readFile(filename, 'utf8'); const preview = await pruneFileObserverTelemetry({ directory, accountId });
    expect(await readFile(filename, 'utf8')).toBe(before);
    await expect(pruneFileObserverTelemetry({ directory, accountId, apply: true, expectedContentSha256: preview.contentSha256 })).rejects.toThrow();
    await expect(pruneFileObserverTelemetry({ directory, accountId, apply: true, producersStopped: true, expectedContentSha256: '0'.repeat(64) })).rejects.toThrow('rollback_document_changed');
    await pruneFileObserverTelemetry({ directory, accountId, apply: true, producersStopped: true, expectedContentSha256: preview.contentSha256 });
    const cleaned = JSON.parse(await readFile(filename, 'utf8')); expect(cleaned.memories).toEqual(original.memories); expect(cleaned.observer.events[0]).not.toHaveProperty('telemetry');
    // Verify the actual prior strict schema, rather than copying its expectations.
    const { execFileSync } = await import('node:child_process'); const ts = await import('typescript'); const { createRequire } = await import('node:module');
    const oldSource = execFileSync('git', ['show', 'ee800d9:src/lib/adaptive/observation/contracts.ts'], { encoding: 'utf8' });
    const code = ts.transpileModule(oldSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const previous = { exports: {} as Record<string, { parse(value: unknown): unknown }> };
    new Function('require', 'module', 'exports', code)(createRequire(import.meta.url), previous, previous.exports);
    expect(() => previous.exports.observerDocumentSchema.parse(cleaned.observer)).not.toThrow();
    expect(() => previous.exports.observerDocumentSchema.parse(original.observer)).toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
