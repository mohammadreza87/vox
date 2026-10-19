import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessageMemoryReview } from '../../../app/studio/_components/MessageMemoryReview';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AdaptiveRepository, accountIdFor, digest } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { MessageMemoryService } from './service';
import { AnthropicLLM, type LLMRequest } from '../../tireh/llm';
import { StudioStore } from '../../studio/store';
import { Studio } from '../../studio/service';
import { handleAdaptiveRequest } from '../persistence/http';
import { signInitData } from '../../studio/auth';
import { rollbackFileMessageMemory, stripMessageMemoryMetadata } from './rollback';
const dirs: string[] = [], SECRET = 'synthetic-message-memory-secret-at-least32', TOKEN = '123:synthetic-message-memory';
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (typeof window !== 'undefined') Reflect.deleteProperty(window, 'Telegram'); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'vox-message-')); dirs.push(dir); let now = Date.now();
  const storage = new FileAdaptiveStorage(join(dir, 'adaptive'));
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }], approvals: ['core_text', 'personalization'].map((capability, i) => ({ schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: now, updatedAt: now,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: now, reviewExpiresAt: now + 86400_000, owner: 'synthetic', approvalReference: 'synthetic' })) }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...options, now: () => now }), store = new StudioStore(join(dir, 'studio'));
  const member = { telegramId: 123, name: 'Synthetic', role: 'member' as const, joinedAt: '' };
  await store.update(s => { s.members.push(member); s.agents.push({ id: 'agent1', status: 'active', visibility: 'private', createdBy: 123, access: [], blocked: [] } as unknown as typeof s.agents[number]); });
  const claims = ['The user reports that Ali said the March 5 date is tentative; this is not confirmed.', 'The user asks not to publish the date yet.'];
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ claims }) }], stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 5 } }));
  const llm = new AnthropicLLM('synthetic-no-network', 'synthetic-model'); Object.assign(llm, { client: { messages: { create } } });
  const authority = () => { const state = store.readCommittedForEffect(); return state.agents[0].blocked?.includes(123) ? null : digest([state.members[0], state.agents[0]]); };
  const settings = { llm, secret: SECRET, now: () => now, agentAuthority: async () => authority(), agentAuthorityNow: () => authority() };
  const service = new MessageMemoryService(adaptive, settings);
  const studio = { deps: { adaptive, store, chatLLM: llm, secret: SECRET, now: () => new Date(now) }, ensureMember: async () => member } as unknown as Studio;
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  await adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed: true, expectedRevision: (await adaptive.read(123, 'work')).revision, eventId: randomUUID() });
  const input = { space: 'work' as const, agentId: 'agent1', locale: 'en' as const, text: '  RAW_SELECTED_CANARY: Ali said March 5 may be the date. Do not publish it yet.\n' };
  const accept = (p: Awaited<ReturnType<MessageMemoryService['preview']>>) => ({ space: input.space, agentId: input.agentId, claims: p.claims, sourceTextHash: p.sourceTextHash, receipt: p.receipt });
  const request = (route: string, body: unknown, headers: Record<string, string> = {}) => handleAdaptiveRequest(studio, adaptive,
    new Request(`https://vox.test/api/studio/adaptive/message-memory/${route}`, { method: 'POST', headers: { origin: 'https://vox.test', 'content-type': 'application/json',
      'x-telegram-init-data': signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN), ...headers }, body: JSON.stringify(body) }), ['message-memory', route], TOKEN);
  const file = async () => join(storage.directory, (await readdir(storage.directory)).find(name => name.endsWith('.json'))!);
  const block = () => { const file = join(store.dir, 'studio.json'), state = JSON.parse(readFileSync(file, 'utf8')); state.agents[0].blocked = [123]; writeFileSync(file, JSON.stringify(state)); };
  return { dir, storage, adaptive, store, service, studio, settings, llm, create, claims, input, accept, request, file, block, now: () => now, setNow: (value: number) => { now = value; } };
}
it('exports exact selected text only, keeps source/preview ephemeral, then atomically saves unverified claims with no optional grants', async () => {
  const f = await setup(); await f.adaptive.createMemory(123, { space: 'work', text: 'UNSELECTED_NOTE_CANARY', expectedRevision: (await f.adaptive.read(123, 'work')).revision, eventId: randomUUID() });
  const before = await readFile(await f.file(), 'utf8'), p = await f.service.preview(123, f.input);
  expect(p.sourceTextHash).toBe(digest(f.input.text)); expect(p.sourceTextHash).not.toBe(digest(f.input.text.trim())); expect(await readFile(await f.file(), 'utf8')).toBe(before);
  expect(f.create).toHaveBeenCalledOnce(); const sent = f.create.mock.calls[0] as unknown as [Record<string, unknown>];
  expect((f.create.mock.calls[0] as unknown as [unknown, unknown])[1]).toEqual({ maxRetries: 0, signal: expect.any(AbortSignal) });
  expect(sent[0].messages).toEqual([{ role: 'user', content: JSON.stringify({ selectedText: f.input.text }) }]); expect(JSON.stringify(sent)).not.toContain('UNSELECTED_NOTE_CANARY');
  const [a, b] = await Promise.all([f.service.accept(123, f.accept(p)), f.service.accept(123, f.accept(p))]); expect(a).toEqual(b); expect(a.memoryIds).toHaveLength(2);
  const saved = await f.adaptive.read(123, 'work'); expect(saved.memories.filter(m => m.origin).map(m => m.text)).toEqual(f.claims);
  expect(saved.purposes.every(p => p.state !== 'granted')).toBe(true);
  const raw = await readFile(await f.file(), 'utf8'); expect(raw).not.toContain('RAW_SELECTED_CANARY'); expect(raw).not.toContain(p.sourceTextHash); expect(raw).not.toContain(p.receipt);
});
it.each(['claims', 'whitespace', 'source_hash', 'receipt', 'space', 'agent', 'account'] as const)('rejects %s tampering without writing', async change => {
  const f = await setup(), p = await f.service.preview(123, f.input), value = f.accept(p);
  if (change === 'claims') value.claims = ['FORGED']; if (change === 'whitespace') value.claims = [value.claims[0] + ' ', ...value.claims.slice(1)];
  if (change === 'source_hash') value.sourceTextHash = digest('different'); if (change === 'receipt') value.receipt += 'x';
  if (change === 'space') Object.assign(value, { space: 'personal' }); if (change === 'agent') value.agentId = 'another';
  await expect(f.service.accept(change === 'account' ? 999 : 123, value)).rejects.toMatchObject({ code: 'message_memory_changed' });
  expect((await f.adaptive.read(123, 'work')).memories).toHaveLength(0);
});
it.each(['binding', 'grant', 'expiry', 'studio_block'] as const)('rejects %s changes after preview', async change => {
  const f = await setup(), p = await f.service.preview(123, f.input);
  if (change === 'binding') await f.adaptive.confirm(123, { confirm: true }); if (change === 'studio_block') f.block(); if (change === 'expiry') f.setNow(p.expiresAt);
  if (change === 'grant') await f.adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed: false, expectedRevision: (await f.adaptive.read(123, 'work')).revision, eventId: randomUUID() });
  await expect(f.service.accept(123, f.accept(p))).rejects.toThrow(); expect((await f.adaptive.read(123, 'work')).memories).toHaveLength(0);
});
it.each(['studio_block', 'expiry'] as const)('fences %s after temporary writes, before atomic commit', async change => {
  const f = await setup(), p = await f.service.preview(123, f.input), transaction = f.storage.transact.bind(f.storage);
  vi.spyOn(f.storage, 'transact').mockImplementation((id, mutate, beforeCommit) => transaction(id, current => {
    const result = mutate(current); if (result.result && typeof result.result === 'object' && 'memoryIds' in result.result) queueMicrotask(() => { if (change === 'studio_block') f.block(); else f.setNow(p.expiresAt); }); return result;
  }, beforeCommit));
  await expect(f.service.accept(123, f.accept(p))).rejects.toMatchObject({ code: 'message_memory_changed' });
  expect(JSON.parse(await readFile(await f.file(), 'utf8')).memories).toEqual([]); expect((await readdir(f.storage.directory)).some(n => /\.(tmp|lock)$/.test(n))).toBe(false);
});
it('suppresses provider output revoked during inference and checks preview deadline after final Studio I/O', async () => {
  const f = await setup(); f.create.mockImplementationOnce(async () => { f.block(); return { content: [{ type: 'text', text: JSON.stringify({ claims: ['MUST_NOT_DELIVER'] }) }], stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 5 } }; });
  await expect(f.service.preview(123, f.input)).rejects.toMatchObject({ code: 'message_memory_changed' });
  const g = await setup(), p = await g.service.preview(123, g.input), original = g.store.readCommittedForEffect.bind(g.store);
  vi.spyOn(g.store, 'readCommittedForEffect').mockImplementation(() => { const state = original(); g.setNow(p.expiresAt); return state; });
  expect(() => g.service.revalidateNow(123, g.accept(p))).toThrow();
});
it.each(['busy', 'malformed', 'grant'] as const)('installed SDK final fetch exports nothing for %s authority after SDK preparation awaits', async change => {
  const f = await setup(), file = await f.file(); let prior: string | undefined;
  vi.stubGlobal('window', undefined);
  const fetcher = vi.fn(async () => new Response('{}')), llm = new AnthropicLLM('synthetic-key', 'synthetic-model', fetcher);
  const service = new MessageMemoryService(f.adaptive, { ...f.settings, llm }); const original = llm.complete.bind(llm);
  vi.spyOn(llm, 'complete').mockImplementationOnce(async (request: LLMRequest) => {
    const guard = request.authorizeNow!; let calls = 0;
    try { return await original({ ...request, authorizeNow: () => {
      const result = guard(); if (++calls === 1) queueMicrotask(() => {
        if (change === 'busy') mkdirSync(file + '.lock'); else { prior = readFileSync(file, 'utf8'); if (change === 'malformed') writeFileSync(file, '{'); else { const d = JSON.parse(prior); d.agentGrants[0].allowed = false; d.agentGrants[0].revision++; writeFileSync(file, JSON.stringify(d)); } }
      }); return result;
    } }); } finally { if (change === 'busy') rmdirSync(file + '.lock'); else if (prior) writeFileSync(file, prior); }
  });
  await expect(service.preview(123, f.input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('deletion prevents replay, purges derived summaries and ordinary expiry removes accepted claims', async () => {
  const f = await setup(), p = await f.service.preview(123, f.input), saved = await f.service.accept(123, f.accept(p));
  await f.adaptive.withAccountDocument(123, d => { d.memories.push({ ...d.memories[0], id: 'summary', origin: undefined, text: 'DERIVED_CLAIM', sourceRefs: [{ id: saved.memoryIds[0], revision: 1 }] }); });
  await f.adaptive.deleteMemory(123, saved.memoryIds[0], { space: 'work', expectedRevision: 1, eventId: randomUUID() });
  await expect(f.service.accept(123, f.accept(p))).rejects.toThrow();
  expect(await f.adaptive.withAccountDocument(123, d => d.memories.find(m => m.id === 'summary')?.text)).toBeUndefined();
  f.setNow(f.now() + 90 * 86400_000); await new AdaptiveLifecycleService(f.adaptive).sweepAccount(123);
  expect(await f.adaptive.withAccountDocument(123, d => d.memories.every(m => m.text === undefined))).toBe(true);
});
it('real signed handler path validates auth/origin/strict input and returns labelled notes only after accept', async () => {
  const f = await setup(); expect((await f.request('preview', f.input, { 'x-telegram-init-data': '' })).status).toBe(401);
  expect((await f.request('preview', f.input, { origin: 'https://evil.test' })).status).toBe(403);
  for (const extra of [{ role: 'assistant' }, { image: 'bytes' }, { audio: 'bytes' }, { origin: 'verified' }]) expect((await f.request('preview', { ...f.input, ...extra })).status).toBe(400);
  const response = await f.request('preview', f.input); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const p = await response.json(); expect((await f.adaptive.read(123, 'work')).memories).toEqual([]);
  const saved = await f.request('accept', f.accept(p)); expect(saved.status).toBe(201); expect((await saved.json()).snapshot.memories.every((m: { origin: string }) => m.origin === 'user_reviewed_claim')).toBe(true);
});
it.each([['too_many', { claims: ['a', 'b', 'c', 'd'] }], ['long', { claims: ['x'.repeat(1001)] }], ['acl', { claims: ['a'], publish: true }], ['json', 'not-json']] as const)('rejects %s provider output, but empty output is an unsavable preview', async (_name, output) => {
  const f = await setup(); f.create.mockResolvedValueOnce({ content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }], stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 5 } });
  await expect(f.service.preview(123, f.input)).rejects.toMatchObject({ code: 'message_memory_unavailable' });
  f.create.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"claims":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 5 } });
  const p = await f.service.preview(123, f.input); expect(p.claims).toEqual([]); f.service.revalidateNow(123, f.accept(p), true);
  await expect(f.service.accept(123, f.accept(p))).rejects.toThrow();
});
it('scoped CAS rollback strips only origin and preserves accepted text, descendants, rights and replay events', async () => {
  const f = await setup(), p = await f.service.preview(123, f.input); const saved = await f.service.accept(123, f.accept(p));
  await f.adaptive.withAccountDocument(123, d => { d.memories.push({ ...d.memories[0], id: 'summary', origin: undefined, sourceRefs: [{ id: saved.memoryIds[0], revision: 1 }] }); });
  const before = JSON.parse(await readFile(await f.file(), 'utf8')), expected = structuredClone(before); expected.memories.forEach((m: { origin?: string }) => { delete m.origin; });
  expect(stripMessageMemoryMetadata(before, accountIdFor(123))).toEqual(expected);
  const options = { directory: f.storage.directory, accountId: accountIdFor(123) }, dry = await rollbackFileMessageMemory(options);
  expect(JSON.parse(await readFile(await f.file(), 'utf8'))).toEqual(before);
  await expect(rollbackFileMessageMemory({ ...options, apply: true, expectedContentSha256: dry.contentSha256 })).rejects.toThrow('rollback_stop');
  await expect(rollbackFileMessageMemory({ ...options, apply: true, producersStopped: true, expectedContentSha256: '0'.repeat(64) })).rejects.toThrow('rollback_document_changed');
  await rollbackFileMessageMemory({ ...options, apply: true, producersStopped: true, expectedContentSha256: dry.contentSha256 });
  expect(JSON.parse(await readFile(await f.file(), 'utf8'))).toEqual(expected); expect((await f.adaptive.read(123, 'work')).memories).toHaveLength(3);
  await expect(f.service.accept(123, f.accept(p))).rejects.toThrow();
});
it('real React→client→signed handler→FILE journey previews/discards/saves in Persian with no API mock', async () => {
  const f = await setup(), saved = vi.fn(), close = vi.fn();
  Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: { initData: signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN) } } });
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url, 'https://vox.test').pathname.split('/').slice(4), headers = new Headers(init.headers); headers.set('origin', 'https://vox.test');
    return handleAdaptiveRequest(f.studio, f.adaptive, new Request(new URL(url, 'https://vox.test'), { ...init, headers }), path, TOKEN);
  });
  vi.stubGlobal('fetch', fetcher);
  const props = { text: f.input.text, agentId: 'agent1', space: 'work' as const, locale: 'fa' as const, disabled: false, onClose: close, onSaved: saved };
  let view = render(createElement(MessageMemoryReview, props));
  expect(screen.getByLabelText('متن دقیق انتخاب‌شده').textContent).toBe(f.input.text); expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'کنارگذاشتن و بستن' })); expect(close).toHaveBeenCalledOnce(); view.unmount();
  view = render(createElement(MessageMemoryReview, props)); fireEvent.click(screen.getByRole('button', { name: 'پیش‌نمایش ادعاهای خصوصی' }));
  await screen.findByText(f.claims[0]); expect((await f.adaptive.read(123, 'work')).memories).toEqual([]); expect(f.create.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ system: expect.stringContaining('Write claims in Persian.') }));
  fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ ادعاهای بررسی‌شده' })); await waitFor(() => expect(saved).toHaveBeenCalledWith(2));
  expect((await f.adaptive.read(123, 'work')).memories.map(m => m.origin)).toEqual(['user_reviewed_claim', 'user_reviewed_claim']);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/studio/adaptive/message-memory/preview', '/api/studio/adaptive/message-memory/accept']); view.unmount();
});
it('aborted acceptance during temporary I/O commits no notes, and stalled/cancelled inference never saves late output', async () => {
  const f = await setup(), p = await f.service.preview(123, f.input), abort = new AbortController(), original = f.storage.transact.bind(f.storage);
  vi.spyOn(f.storage, 'transact').mockImplementation((id, mutate, beforeCommit) => original(id, current => {
    const result = mutate(current); if (result.result && typeof result.result === 'object' && 'memoryIds' in result.result) queueMicrotask(() => abort.abort()); return result;
  }, beforeCommit));
  await expect(f.service.accept(123, f.accept(p), abort.signal)).rejects.toMatchObject({ code: 'message_memory_changed' }); expect((await f.adaptive.read(123, 'work')).memories).toEqual([]);
  let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
  f.create.mockImplementationOnce(() => { started(); return new Promise(() => {}); });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const pending = f.service.preview(123, f.input).catch(error => error);
  await entered; await vi.advanceTimersByTimeAsync(10_001); expect(await pending).toMatchObject({ code: 'message_memory_changed' }); vi.useRealTimers();
});
it('labels accepted claims and their summary descendants in ordinary authorized retrieval without enabling optional consent', async () => {
  const f = await setup(), p = await f.service.preview(123, f.input), saved = await f.service.accept(123, f.accept(p));
  expect((await f.adaptive.readPrivateContext(123, 'work', 'agent1')).memories).toEqual([]);
  const initial = await f.adaptive.read(123, 'work'), presented = await f.adaptive.present(123, { space: 'work', purpose: 'optional.personalization', locale: 'en', expectedRevision: initial.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID() });
  await f.adaptive.changeConsent(123, { space: 'work', purpose: 'optional.personalization', state: 'granted', expectedRevision: presented.purposes.find(p => p.purpose === 'optional.personalization')!.revision, receipt: presented.receipt, eventId: randomUUID() });
  await f.adaptive.withAccountDocument(123, d => { d.memories.push({ ...d.memories[0], id: 'summary', origin: undefined, text: 'Summary remains uncertain.', sourceRefs: [{ id: saved.memoryIds[0], revision: 1 }] }); });
  const context = await f.adaptive.readPrivateContext(123, 'work', 'agent1'); expect(context.memories).toHaveLength(3); expect(context.memories.every(m => m.text.startsWith('User-reviewed claim (not independently verified):'))).toBe(true);
  expect((await f.adaptive.readPrivateContext(123, 'personal', 'agent1')).memories).toEqual([]);
});
it('fails closed for an unqualified provider or unsupported committed snapshot while ordinary notes remain usable', async () => {
  const f = await setup(), p = await f.service.preview(123, f.input);
  const unqualified = new MessageMemoryService(f.adaptive, { ...f.settings, llm: { complete: vi.fn() } });
  await expect(unqualified.preview(123, f.input)).rejects.toMatchObject({ code: 'message_memory_unavailable' });
  await expect(unqualified.accept(123, f.accept(p))).rejects.toThrow();
  vi.spyOn(f.adaptive, 'readCommittedForEffect').mockReturnValue({ status: 'unsupported' });
  await expect(f.service.preview(123, f.input)).rejects.toMatchObject({ code: 'message_memory_unavailable' });
  await f.adaptive.createMemory(123, { space: 'work', text: 'Ordinary note', expectedRevision: (await f.adaptive.read(123, 'work')).revision, eventId: randomUUID() });
  expect((await f.adaptive.read(123, 'work')).memories[0]).toMatchObject({ text: 'Ordinary note' });
});
it('enforces source bounds and atomically refuses a multi-claim save at capacity without partial notes', async () => {
  const f = await setup(); expect((await f.request('preview', { ...f.input, text: 'x'.repeat(4097) })).status).toBe(400);
  expect((await f.request('preview', { ...f.input, text: '   ' })).status).toBe(400); expect(f.create).not.toHaveBeenCalled();
  const p = await f.service.preview(123, f.input);
  await f.adaptive.withAccountDocument(123, d => { for (let i = 0; i < 299; i++) d.memories.push({ id: `existing-${i}`, revision: 1, space: 'work', text: 'Existing ordinary note.', status: 'active', createdAt: f.now(), updatedAt: f.now(), expiresAt: f.now() + 86400_000, revocationEpoch: 0 }); });
  const before = await readFile(await f.file(), 'utf8');
  await expect(f.service.accept(123, f.accept(p))).rejects.toMatchObject({ code: 'storage_capacity' }); expect(await readFile(await f.file(), 'utf8')).toBe(before);
});
it('does not validate a prepared receipt after canonical grant revoke/regrant or identity clear/reconfirm ABA', async () => {
  for (const transition of ['grant', 'identity']) {
    const f = await setup(), p = await f.service.preview(123, f.input);
    if (transition === 'grant') for (const allowed of [false, true]) await f.adaptive.setAgentAccess(123, 'agent1', { space: 'work', allowed, expectedRevision: (await f.adaptive.read(123, 'work')).revision, eventId: randomUUID() });
    else { await f.adaptive.withAccountDocument(123, d => { delete d.binding; }); await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true }); }
    await expect(f.service.accept(123, f.accept(p))).rejects.toMatchObject({ code: 'message_memory_changed' }); expect((await f.adaptive.read(123, 'work')).memories).toEqual([]);
  }
});
it('actual Studio block/unblock epochs reject an old signed message preview after access is restored', async () => {
  const f = await setup();
  await f.store.update(state => Object.assign(state.agents[0], { persona: { name: 'Synthetic', role: 'Assistant', tagline: 'Synthetic' }, look: { hue: 'sky', family: 'puff', features: { cheeks: false, lashes: false, brows: false } } }));
  const response = await f.request('preview', f.input); expect(response.status).toBe(200); const p = await response.json();
  const studio = new Studio(f.studio.deps), actor = (await f.store.read()).members[0];
  await studio.blockByAgent('agent1', 123); await studio.unblock(actor, 'agent1', 123);
  expect((await f.store.read()).agents[0].learningAuthorityRevision).toBe(2);
  const accepted = await f.request('accept', f.accept(p)); expect(accepted.status).toBe(409); expect(await accepted.json()).toEqual({ error: 'message_memory_changed' });
  expect((await f.adaptive.read(123, 'work')).memories).toEqual([]);
});
it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('refuses malformed Studio authority epoch %s before provider export', async value => {
  const f = await setup(); await f.store.update(state => { state.agents[0].learningAuthorityRevision = value as number; });
  expect((await f.request('preview', f.input)).status).toBe(409); expect(f.create).not.toHaveBeenCalled();
});
