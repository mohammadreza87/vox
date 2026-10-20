import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeCommittedText } from './committed-text';
import { stripClientExperienceForRollback, pruneFileClientExperience } from './client-experience-rollback';
import { observerDocumentSchema, observerEventSchema } from './contracts';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const callbacks = new Map<number, FrameRequestCallback>(); let seq = 0;
function frame() { const pending = [...callbacks.values()]; callbacks.clear(); for (const fn of pending) fn(performance.now()); }
afterEach(() => { document.body.replaceChildren(); callbacks.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function rendered() {
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { const id = ++seq; callbacks.set(id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const el = document.createElement('span'); el.textContent = 'PRIVATE_REPLY_CANARY'; document.body.append(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 1, left: 1, bottom: 20, right: 100, width: 99, height: 19 } as DOMRect);
  return el;
}
describe('actual committed text timing boundary', () => {
  it('requires committed visible text after two frames, emits once, and receives no text', () => {
    const el = rendered(), report = vi.fn(); const stop = observeCommittedText(el, report, () => true);
    expect(report).not.toHaveBeenCalled(); frame(); expect(report).not.toHaveBeenCalled(); frame(); expect(report).toHaveBeenCalledExactlyOnceWith();
    window.dispatchEvent(new Event('scroll')); frame(); frame(); expect(report).toHaveBeenCalledOnce(); stop();
  });
  it.each(['hidden', 'detached', 'empty', 'offscreen', 'scope', 'cleanup', 'background'] as const)('does not report %s output', mode => {
    const el = rendered(), report = vi.fn(); let active = true;
    if (mode === 'hidden') el.hidden = true;
    if (mode === 'detached') el.remove();
    if (mode === 'empty') el.textContent = ' ';
    if (mode === 'offscreen') vi.mocked(el.getBoundingClientRect).mockReturnValue({ top: -200, bottom: -100, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    if (mode === 'background') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const stop = observeCommittedText(el, report, () => active);
    frame(); if (mode === 'scope') active = false; if (mode === 'cleanup') stop(); frame(); expect(report).not.toHaveBeenCalled(); stop();
  });
  it('waits for hidden content to become visible and ignores exception-bearing observer adapters', () => {
    const el = rendered(), report = vi.fn(); el.hidden = true;
    vi.stubGlobal('IntersectionObserver', class { constructor() { throw new Error('PRIVATE_ADAPTER_CANARY'); } });
    const stop = observeCommittedText(el, report, () => true); frame(); frame(); expect(report).not.toHaveBeenCalled();
    el.hidden = false; document.dispatchEvent(new Event('visibilitychange')); frame(); frame(); expect(report).toHaveBeenCalledOnce(); stop();
  });
});

it('CAS rollback preserves current memory/deletion/consent state and is accepted by the exact previous parser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vox-client-experience-rollback-')), accountId = 'telegram-account:123';
  const server = observerEventSchema.parse({ schemaVersion: 1, version: 'vox-observer-v1', id: 'a'.repeat(64), fingerprint: 'b'.repeat(64), revision: 1, turnKey: 'c'.repeat(64), origin: 'human', purpose: 'optional.product_analytics', policyVersion: 'adaptive-privacy-v1', consentEpoch: 1, permissionRevision: 1, grantRevision: 1, bindingRevision: 1, accountId, personId: 'person', space: 'work', spaceId: 'space', agentId: 'agent', policyReceipt: 'd'.repeat(64), trust: 'server', channel: 'text', outcome: 'responded', occurredAt: 1, receivedAt: 1, expiresAt: 1000, state: 'processed', attempts: 1, nextAttemptAt: 1 });
  const rendered = { ...server, id: 'e'.repeat(64), trust: 'client_unverified', outcome: 'text_rendered', clientExperienceVersion: 1 };
  const correction = { version: 1, id: 'f'.repeat(64), fingerprint: 'a'.repeat(64), space: 'work', policyReceipt: 'd'.repeat(64), trust: 'client_unverified', outcome: 'correction_client_unconfirmed', mutationEvidence: 'unavailable', occurredAt: 1, expiresAt: 1000 };
  const original = { accountId, memories: [{ text: 'CURRENT_CORRECTION' }, { status: 'deleted', revocationEpoch: 9 }], permissions: [{ state: 'withdrawn' }], observer: { schemaVersion: 1, events: [server, rendered], corrections: [correction], projections: [] } };
  const filename = join(directory, createHash('sha256').update(accountId).digest('hex') + '.json'); await writeFile(filename, JSON.stringify(original));
  try {
    expect(() => observerDocumentSchema.parse(original.observer)).not.toThrow();
    const preview = await pruneFileClientExperience({ directory, accountId });
    expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual(original);
    await expect(pruneFileClientExperience({ directory, accountId, apply: true, expectedContentSha256: preview.contentSha256 })).rejects.toThrow('rollback_stop_producers_and_digest_required');
    await expect(pruneFileClientExperience({ directory, accountId, apply: true, producersStopped: true, expectedContentSha256: '0'.repeat(64) })).rejects.toThrow('rollback_document_changed');
    await pruneFileClientExperience({ directory, accountId, apply: true, producersStopped: true, expectedContentSha256: preview.contentSha256 });
    const cleaned = JSON.parse(await readFile(filename, 'utf8'));
    expect(cleaned.memories).toEqual(original.memories); expect(cleaned.permissions).toEqual(original.permissions); expect(cleaned.observer.events).toEqual([server]); expect(cleaned.observer).not.toHaveProperty('corrections');
    const oldSource = await readFile(join(process.cwd(), 'src/lib/adaptive/observation/__fixtures__/observer-contracts-before-client-experience.ts.txt'), 'utf8');
    expect(createHash('sha256').update(oldSource).digest('hex')).toBe('6f473fa9e371e80472f81469e34fec047dc446fc793dfda15b1e5d76a5719d9b');
    const ts = await import('typescript'), { createRequire } = await import('node:module'), telemetry = await import('./telemetry');
    const code = ts.transpileModule(oldSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const previous = { exports: {} as Record<string, { parse(value: unknown): unknown }> }, require = createRequire(import.meta.url);
    new Function('require', 'module', 'exports', code)((name: string) => name === './telemetry' ? telemetry : require(name), previous, previous.exports);
    expect(() => previous.exports.observerDocumentSchema.parse(original.observer)).toThrow();
    expect(() => previous.exports.observerDocumentSchema.parse(cleaned.observer)).not.toThrow();
    expect(() => stripClientExperienceForRollback(original, 'telegram-account:456')).toThrow('rollback_scope_mismatch');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
