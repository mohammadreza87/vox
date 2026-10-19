import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { ReviewedMemoryService } from './service';
import { digest } from '../persistence/repository';
import { AnthropicLLM } from '../../tireh/llm';
import { StudioStore } from '../../studio/store';
import type { Studio } from '../../studio/service';
import { handleAdaptiveRequest } from '../persistence/http';
import { signInitData } from '../../studio/auth';
import { removeReviewedMemoryForRollback, pruneFileReviewedMemory } from './rollback';
import { validMemoryLineage } from './provenance';

const dirs: string[] = [], SECRET = 'synthetic-summary-secret-at-least-32-characters', TOKEN = '123:synthetic-reviewed-memory';
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'vox-reviewed-')); dirs.push(dir); let now = Date.now();
  const storage = new FileAdaptiveStorage(join(dir, 'adaptive'));
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: ['core_text', 'personalization'].map((capability, i) => ({ schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: now, updatedAt: now,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: now, reviewExpiresAt: now + 86_400_000,
      owner: 'synthetic', approvalReference: 'synthetic' })) }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...options, now: () => now });
  const store = new StudioStore(join(dir, 'studio'));
  const member = { telegramId: 123, name: 'Synthetic', role: 'member' as const, joinedAt: '' };
  await store.update(state => { state.members.push(member); state.agents.push({ id: 'agent1', status: 'active', visibility: 'private', createdBy: 123, access: [], blocked: [] } as unknown as typeof state.agents[number]); });
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'REVIEWED_DRAFT: Launch remains March 5; the date is tentative.' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 8 } }));
  const llm = new AnthropicLLM('synthetic-no-network', 'claude-synthetic'); Object.assign(llm, { client: { messages: { create } } });
  const studio = { deps: { adaptive, store, chatLLM: llm, secret: SECRET, now: () => new Date(now) }, ensureMember: async () => member } as unknown as Studio;
  const authority = () => { const state = store.readCommittedForEffect(); return state.agents[0].blocked?.includes(123) ? null : digest([state.members[0], state.agents[0]]); };
  const service = new ReviewedMemoryService(adaptive, { llm, secret: SECRET, now: () => now, agentAuthority: async () => authority(), agentAuthorityNow: () => authority() });
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  await adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed: true, expectedRevision: (await adaptive.read(123, 'work')).revision, eventId: randomUUID() });
  async function save(text: string, space: 'work' | 'personal' = 'work') {
    return adaptive.createMemory(123, { space, text, expectedRevision: (await adaptive.read(123, space)).revision, eventId: randomUUID() });
  }
  await save('Launch is March 5.'); await save('The launch date remains tentative; do not call it confirmed.'); await save('UNSELECTED_PRIVATE_CANARY');
  const snapshot = await adaptive.read(123, 'work'), sourceRefs = snapshot.memories.slice(0, 2).map(row => ({ id: row.id, revision: row.revision }));
  const input = { space: 'work' as const, agentId: 'agent1', locale: 'en' as const, sourceRefs };
  const accept = (preview: Awaited<ReturnType<ReviewedMemoryService['preview']>>) => ({ space: input.space, agentId: input.agentId, text: preview.text, receipt: preview.receipt });
  const request = (route: string, body: unknown, extra: Record<string, string> = {}) => handleAdaptiveRequest(studio, adaptive,
    new Request(`https://vox.test/api/studio/adaptive/reviewed/${route}`, { method: 'POST', headers: { origin: 'https://vox.test', 'content-type': 'application/json',
      'x-telegram-init-data': signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN), ...extra }, body: JSON.stringify(body) }), ['reviewed', route], TOKEN);
  const removeSource = async () => { await adaptive.deleteMemory(123, sourceRefs[0].id, { space: 'work', expectedRevision: sourceRefs[0].revision, eventId: randomUUID() }); };
  const file = async () => join(storage.directory, (await readdir(storage.directory)).find(name => name.endsWith('.json'))!);
  return { dir, adaptive, service, input, accept, create, llm, store, studio, request, sourceRefs, save, removeSource, storage, file, now: () => now, setNow: (value: number) => { now = value; } };
}

it('uses the real production LLM adapter with selected notes only, ephemeral preview and explicit idempotent acceptance', async () => {
  const f = await setup(); const before = await f.adaptive.withAccountDocument(123, d => JSON.stringify(d));
  const preview = await f.service.preview(123, f.input);
  expect(f.create).toHaveBeenCalledOnce(); const sent = JSON.stringify(f.create.mock.calls);
  expect(sent).toContain('Launch is March 5.'); expect(sent).not.toContain('UNSELECTED_PRIVATE_CANARY'); expect(sent).not.toContain('authorize');
  expect(await f.adaptive.withAccountDocument(123, d => JSON.stringify(d))).toBe(before);
  const [a, b] = await Promise.all([f.service.accept(123, f.accept(preview)), f.service.accept(123, f.accept(preview))]); expect(a).toEqual(b);
  const notes = (await f.adaptive.read(123, 'work')).memories;
  expect(notes).toHaveLength(4); expect(notes.find(row => row.id === a.memoryId)?.sourceRefs).toEqual(expect.arrayContaining(f.sourceRefs));
  const saved = await f.adaptive.withAccountDocument(123, d => d.memories.find(row => row.id === a.memoryId)!);
  expect(saved.expiresAt).toBe(Math.min(...notes.filter(row => f.sourceRefs.some(ref => ref.id === row.id)).map(row => row.expiresAt)));
  expect(await f.adaptive.withAccountDocument(123, d => d.permissions.every(p => p.state !== 'granted'))).toBe(true);
});

it.each(['binding', 'grant', 'source_revision', 'source_deletion', 'receipt_expiry', 'studio_block'] as const)('rejects a preview after %s changes without saving derived text', async change => {
  const f = await setup(), preview = await f.service.preview(123, f.input);
  if (change === 'binding') await f.adaptive.confirm(123, { confirm: true });
  if (change === 'grant') await f.adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed: false, expectedRevision: (await f.adaptive.read(123, 'work')).revision, eventId: randomUUID() });
  if (change === 'source_revision') await f.adaptive.withAccountDocument(123, d => { d.memories[0].revision++; });
  if (change === 'source_deletion') await f.removeSource();
  if (change === 'receipt_expiry') f.setNow(f.now() + 120_001);
  if (change === 'studio_block') await f.store.update(state => { state.agents[0].blocked = [123]; });
  await expect(f.service.accept(123, f.accept(preview))).rejects.toMatchObject({ code: 'reviewed_memory_changed' });
  expect(await f.adaptive.withAccountDocument(123, d => d.memories.some(row => row.sourceRefs))).toBe(false);
});

it('denies forged content, foreign account/space, duplicate sources and injected ACL fields', async () => {
  const f = await setup(), preview = await f.service.preview(123, f.input);
  for (const value of [{ ...f.accept(preview), text: 'FORGED' }, { ...f.accept(preview), space: 'personal' as const }, { ...f.accept(preview), receipt: preview.receipt + 'x' }]) await expect(f.service.accept(123, value)).rejects.toMatchObject({ code: 'reviewed_memory_changed' });
  await expect(f.service.accept(999, f.accept(preview))).rejects.toMatchObject({ code: 'reviewed_memory_changed' });
  expect((await f.request('preview', { ...f.input, sourceRefs: [f.sourceRefs[0], f.sourceRefs[0]] })).status).toBe(400);
  expect((await f.request('preview', { ...f.input, audience: ['another-person'] })).status).toBe(400);
  expect(f.create).toHaveBeenCalledOnce();
});

it('suppresses descendants on source deletion and keeps originals when deleting a summary', async () => {
  const f = await setup(), preview = await f.service.preview(123, f.input), saved = await f.service.accept(123, f.accept(preview));
  await f.adaptive.deleteMemory(123, saved.memoryId, { space: 'work', expectedRevision: 1, eventId: randomUUID() });
  expect((await f.adaptive.read(123, 'work')).memories).toHaveLength(3);
  const second = await f.service.accept(123, f.accept(await f.service.preview(123, f.input)));
  await f.removeSource();
  const d = await f.adaptive.withAccountDocument(123, d => d);
  expect(d.memories.find(row => row.id === second.memoryId)).toMatchObject({ status: 'deleted' });
  expect(d.memories.find(row => row.id === second.memoryId)?.text).toBeUndefined();
  expect(d.memories.find(row => row.id === f.sourceRefs[1].id)?.status).toBe('active');
  expect((await f.adaptive.read(123, 'work')).memories.some(row => row.id === second.memoryId)).toBe(false);
});

it('expires with its earliest source and lifecycle sweeping purges derived bytes', async () => {
  const f = await setup(); await f.adaptive.withAccountDocument(123, d => { d.memories[0].expiresAt = f.now() + 60_000; });
  const preview = await f.service.preview(123, f.input), saved = await f.service.accept(123, f.accept(preview));
  expect(preview.expiresAt).toBe(f.now() + 60_000); f.setNow(f.now() + 60_000);
  await new AdaptiveLifecycleService(f.adaptive).sweepAccount(123);
  expect(await f.adaptive.withAccountDocument(123, d => d.memories.find(row => row.id === saved.memoryId)?.text)).toBeUndefined();
  expect(await readFile(await f.file(), 'utf8')).not.toContain('REVIEWED_DRAFT');
});

it('fails closed on cycles and cross-space provenance even when invalid rows are planted in storage', async () => {
  const f = await setup(); await f.save('PERSONAL_SOURCE', 'personal');
  await f.adaptive.withAccountDocument(123, d => {
    const a = d.memories[0], b = d.memories[1]; a.sourceRefs = [{ id: b.id, revision: 1 }]; b.sourceRefs = [{ id: a.id, revision: 1 }];
    expect(validMemoryLineage(d, a, f.now())).toBe(false);
    const personal = d.memories.find(row => row.space === 'personal')!;
    d.memories[2].sourceRefs = [{ id: personal.id, revision: personal.revision }];
  });
  expect((await f.adaptive.read(123, 'work')).memories).toEqual([]);
  expect((await f.adaptive.read(123, 'personal')).memories.map(row => row.text)).toEqual(['PERSONAL_SOURCE']);
});

it.each(['busy', 'malformed', 'source_deleted'] as const)('the synchronous real-provider fence exports nothing for %s state after awaited authorization', async change => {
  const f = await setup(), real = f.llm.complete.bind(f.llm), file = await f.file(); let previous: string | undefined;
  vi.spyOn(f.llm, 'complete').mockImplementationOnce(async request => {
    expect(await request.authorize!()).toBe(true);
    if (change === 'busy') mkdirSync(file + '.lock');
    else { previous = readFileSync(file, 'utf8'); if (change === 'malformed') writeFileSync(file, '{');
      else { const d = JSON.parse(previous); d.memories[0].status = 'deleted'; delete d.memories[0].text; d.memories[0].revision++; writeFileSync(file, JSON.stringify(d)); } }
    try { return await real({ ...request, authorize: async () => true }); }
    finally { if (change === 'busy') rmdirSync(file + '.lock'); else writeFileSync(file, previous!); }
  });
  await expect(f.service.preview(123, f.input)).rejects.toBeDefined(); expect(f.create).not.toHaveBeenCalled();
});

it('withholds provider output after revocation and rejects a source deletion just before the acceptance transaction', async () => {
  const f = await setup(); f.create.mockImplementationOnce(async () => { await f.removeSource(); return { content: [{ type: 'text', text: 'MUST_NOT_DELIVER' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 8 } }; });
  await expect(f.service.preview(123, f.input)).rejects.toMatchObject({ code: 'reviewed_memory_changed' });
  const g = await setup(), preview = await g.service.preview(123, g.input), transaction = g.adaptive.withAccountDocument.bind(g.adaptive); let calls = 0;
  vi.spyOn(g.adaptive, 'withAccountDocument').mockImplementation(async (id, fn) => { if (++calls === 2) await g.removeSource(); return transaction(id, fn); });
  await expect(g.service.accept(123, g.accept(preview))).rejects.toMatchObject({ code: 'reviewed_memory_changed' });
  expect(await transaction(123, d => d.memories.some(row => row.sourceRefs))).toBe(false);
});

it('actual signed HTTP preview/save path requires auth and same origin, and never publishes shared data', async () => {
  const f = await setup(); expect((await f.request('preview', f.input, { 'x-telegram-init-data': '' })).status).toBe(401);
  expect((await f.request('preview', f.input, { origin: 'https://other.test' })).status).toBe(403);
  const response = await f.request('preview', f.input); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const preview = await response.json(); const saved = await f.request('accept', f.accept(preview)); expect(saved.status).toBe(201);
  expect((await saved.json()).snapshot.memories).toHaveLength(4);
  expect((await f.request('accept', { ...f.accept(preview), publish: true })).status).toBe(400);
  expect((await readdir(f.storage.directory)).filter(file => file.endsWith('.json'))).toHaveLength(1);
});

it('scoped rollback dry-run/CAS removes only derived rows and preserves originals, rights and acceptance tombstones', async () => {
  const f = await setup(), preview = await f.service.preview(123, f.input); await f.service.accept(123, f.accept(preview));
  const before = JSON.parse(await readFile(await f.file(), 'utf8')), accountId = accountIdFor(123), cleaned = removeReviewedMemoryForRollback(before, accountId) as typeof before;
  expect(cleaned.memories).toHaveLength(3); expect(cleaned.permissions).toEqual(before.permissions); expect(cleaned.events).toEqual(before.events);
  const dry = await pruneFileReviewedMemory({ directory: f.storage.directory, accountId }); expect(dry.changed).toBe(true);
  expect(JSON.parse(await readFile(await f.file(), 'utf8'))).toEqual(before);
  await expect(pruneFileReviewedMemory({ directory: f.storage.directory, accountId, apply: true, expectedContentSha256: dry.contentSha256 })).rejects.toThrow('rollback_stop');
  await f.adaptive.withAccountDocument(123, d => { d.revision++; });
  await expect(pruneFileReviewedMemory({ directory: f.storage.directory, accountId, apply: true, producersStopped: true, expectedContentSha256: dry.contentSha256 })).rejects.toThrow('rollback_document_changed');
  const fresh = await pruneFileReviewedMemory({ directory: f.storage.directory, accountId });
  await pruneFileReviewedMemory({ directory: f.storage.directory, accountId, apply: true, producersStopped: true, expectedContentSha256: fresh.contentSha256 });
  expect((await f.adaptive.read(123, 'work')).memories).toHaveLength(3);
  await expect(f.service.accept(123, f.accept(preview))).rejects.toMatchObject({ code: 'reviewed_memory_changed' });
});

it.each(['studio_block', 'receipt_expiry'] as const)('rechecks %s after asynchronous temp writes before atomic save', async change => {
  const f = await setup(), preview = await f.service.preview(123, f.input);
  const original = f.storage.transact.bind(f.storage);
  vi.spyOn(f.storage, 'transact').mockImplementation((account, mutate, beforeCommit) => original(account, current => {
    const result = mutate(current);
    if (result.result && typeof result.result === 'object' && 'memoryId' in result.result) queueMicrotask(() => {
      if (change === 'receipt_expiry') f.setNow(preview.expiresAt);
      else { const file = join(f.store.dir, 'studio.json'), state = JSON.parse(readFileSync(file, 'utf8')); state.agents[0].blocked = [123]; writeFileSync(file, JSON.stringify(state)); }
    });
    return result;
  }, beforeCommit));
  await expect(f.service.accept(123, f.accept(preview))).rejects.toMatchObject({ code: 'reviewed_memory_changed' });
  expect(JSON.parse(await readFile(await f.file(), 'utf8')).memories.some((row: { sourceRefs?: unknown }) => row.sourceRefs)).toBe(false);
  expect((await readdir(f.storage.directory)).every(name => !name.endsWith('.tmp') && !name.endsWith('.lock'))).toBe(true);
});
it('evaluates the fresh clock after synchronous Studio and canonical file reads', async () => {
  const f = await setup(); const original = f.store.readCommittedForEffect.bind(f.store);
  vi.spyOn(f.store, 'readCommittedForEffect').mockImplementation(() => { const state = original(); f.setNow(f.now() + 13 * 60 * 60 * 1000); return state; });
  await expect(f.service.preview(123, f.input)).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
});
it('keeps ordinary notes usable when summary transport or committed snapshot support is unavailable', async () => {
  const f = await setup();
  const unsupported = new ReviewedMemoryService(f.adaptive, { llm: { complete: vi.fn() }, secret: SECRET, agentAuthority: async () => 'ok', agentAuthorityNow: () => 'ok' });
  await expect(unsupported.preview(123, f.input)).rejects.toMatchObject({ code: 'reviewed_memory_unavailable' });
  vi.spyOn(f.storage, 'readCommittedForEffect').mockReturnValue({ status: 'busy' });
  await expect(f.service.preview(123, f.input)).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
  expect((await f.adaptive.read(123, 'work')).memories).toHaveLength(3);
});

it('returns all authorized source candidates for relevance-aware packing and invalidates descendants on source edits', async () => {
  const f = await setup(), preview = await f.service.preview(123, f.input), saved = await f.service.accept(123, f.accept(preview));
  const current = await f.adaptive.read(123, 'work');
  const presented = await f.adaptive.present(123, { space: 'work', purpose: 'optional.personalization', locale: 'en', expectedRevision: current.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID() });
  await f.adaptive.changeConsent(123, { space: 'work', purpose: 'optional.personalization', state: 'granted', expectedRevision: presented.purposes.find(p => p.purpose === 'optional.personalization')!.revision, receipt: presented.receipt, eventId: randomUUID() });
  const context = await f.adaptive.readPrivateContext(123, 'work', 'agent1');
  expect(context.memories).toHaveLength(4); expect(context.memories.find(m => m.id === saved.memoryId)?.sourceIds).toEqual(expect.arrayContaining(f.sourceRefs.map(r => r.id)));
  await f.adaptive.withAccountDocument(123, d => { d.memories[0].revision++; d.memories[0].text = 'Launch date changed to March 6.'; });
  const changed = await f.adaptive.readPrivateContext(123, 'work', 'agent1');
  expect(changed.revision).not.toBe(context.revision); expect(changed.memories).toHaveLength(3);
  expect(await f.adaptive.withAccountDocument(123, d => d.memories.find(m => m.id === saved.memoryId)?.text)).toBeUndefined();
});
it('rechecks the short preview deadline after the final synchronous authority I/O', async () => {
  const f = await setup(), preview = await f.service.preview(123, f.input), original = f.store.readCommittedForEffect.bind(f.store);
  vi.spyOn(f.store, 'readCommittedForEffect').mockImplementation(() => { const state = original(); f.setNow(preview.expiresAt); return state; });
  expect(() => f.service.revalidateNow(123, f.accept(preview))).toThrow();
});
it('preserves legacy note bytes until explicit summary save and restores the old strict memory shape on rollback', async () => {
  const f = await setup(), before = JSON.parse(await readFile(await f.file(), 'utf8'));
  const keys = ['createdAt', 'expiresAt', 'id', 'revision', 'revocationEpoch', 'space', 'status', 'text', 'updatedAt'].sort();
  // Exact strict memory-row shape at base 64d93ee. No feature field is emitted
  // for ordinary notes; downgrade removes whole derived rows, never sources.
  expect(before.memories.every((m: object) => JSON.stringify(Object.keys(m).sort()) === JSON.stringify(keys))).toBe(true);
  const preview = await f.service.preview(123, f.input); await f.service.accept(123, f.accept(preview));
  const after = JSON.parse(await readFile(await f.file(), 'utf8'));
  const cleaned = removeReviewedMemoryForRollback(after, accountIdFor(123)) as typeof after;
  expect(cleaned.memories).toEqual(before.memories); expect(cleaned.agentGrants).toEqual(after.agentGrants);
  expect(cleaned.memories.every((m: object) => JSON.stringify(Object.keys(m).sort()) === JSON.stringify(keys))).toBe(true);
});
it('bounds selected input bytes and denies mixed-space source selection before provider export', async () => {
  const f = await setup(); await f.save('PRIVATE_PERSONAL', 'personal');
  const personal = (await f.adaptive.read(123, 'personal')).memories[0];
  await expect(f.service.preview(123, { ...f.input, sourceRefs: [f.sourceRefs[0], { id: personal.id, revision: personal.revision }] })).rejects.toThrow();
  const sourceRefs = []; for (let i = 0; i < 4; i++) { await f.save('ی'.repeat(2000)); sourceRefs.push((await f.adaptive.read(123, 'work')).memories.at(-1)!); }
  await expect(f.service.preview(123, { ...f.input, sourceRefs: sourceRefs.map(({ id, revision }) => ({ id, revision })) })).rejects.toMatchObject({ code: 'reviewed_memory_input_too_large' });
  expect(f.create).not.toHaveBeenCalled();
});
it('bounds a stalled preview and signals cancellation without saving or delivering late text', async () => {
  const f = await setup(); let entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  f.create.mockImplementationOnce(() => { entered(); return new Promise(() => {}); });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const pending = f.service.preview(123, f.input).catch(error => error);
  await reached; await vi.advanceTimersByTimeAsync(10_001);
  expect(await pending).toMatchObject({ code: 'reviewed_memory_changed' });
  vi.useRealTimers(); expect((await f.adaptive.read(123, 'work')).memories).toHaveLength(3);
});
