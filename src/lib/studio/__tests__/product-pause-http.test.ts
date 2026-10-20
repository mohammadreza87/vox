import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { SqliteAdaptiveStorage } from '../../adaptive/persistence/indexed/sqlite-storage';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { handleProductPauseRequest } from '../product-pause-http';
import { signInitData } from '../auth';
import { ID, makeStudio, seedOrg, type Harness } from './helpers';

const token = '123:synthetic-pause-token';
let h: Harness, storage: SqliteAdaptiveStorage, adaptive: AdaptiveService;
beforeEach(async () => {
  h = makeStudio({ eleven: false }); await seedOrg(h);
  // This suite exercises control HTTP admission. Provider boundary execution is
  // separately qualified with the actual configured adapters in runtime tests.
  h.studio.deps.chatLLM = { complete: h.chatLLM.complete.bind(h.chatLLM), committedExportFence: true };
  const now = Date.now();
  storage = new SqliteAdaptiveStorage(join(h.dir, 'adaptive.sqlite'), { now: () => now, newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 2 } });
  adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...adaptiveOptionsFromManifest(JSON.stringify({
    schemaVersion: 1, configurationVersion: 'synthetic-pause-http', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [ID.alice, ID.bob, ID.pending].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization'].map(capability => ({ schemaVersion: 1, id: `synthetic-${capability}`, revision: 1,
      createdAt: now - 1000, updatedAt: now - 1000, jurisdiction: 'SYNTHETIC', capability, state: 'approved',
      configurationVersion: 'synthetic-pause-http', effectiveAt: now - 1000, reviewExpiresAt: now + 86400000,
      owner: 'synthetic', approvalReference: 'synthetic' })),
  })), now: () => now });
  h.studio.deps.adaptive = adaptive;
});
afterEach(() => { vi.restoreAllMocks(); storage?.close(); if (h) rmSync(h.dir, { recursive: true, force: true }); });
const command = (char: string, seq: number, action: 'pause' | 'resume', space = 'work') => ({ version: 1, eventId: char.repeat(22), expectedCommandSeq: seq, action, space });
function request(method: 'GET' | 'POST', options: { as?: number | null; query?: string; input?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { origin: 'https://vox.test', 'content-type': 'application/json', ...options.headers };
  if (options.as !== null) headers['x-telegram-init-data'] = signInitData({ id: options.as ?? ID.alice, first_name: 'Synthetic' }, token);
  return new Request(`https://vox.test/api/studio/product-pause${options.query ?? ''}`, {
    method, headers, ...(method === 'POST' ? { body: options.raw ?? JSON.stringify(options.input) } : {}),
  });
}
async function call(req: Request) {
  const response = await handleProductPauseRequest(h.studio, req, token);
  return { response, status: response.status, data: await response.json() };
}

it('signed account stop/status work before profile and for pending membership without creating a status-read account', async () => {
  const stateBefore = await h.store.read();
  const status = await call(request('GET', { as: ID.pending, query: '?space=work' }));
  expect(status.status).toBe(200);
  expect(status.response.headers.get('cache-control')).toBe('no-store');
  expect(status.data).toMatchObject({ accountId: accountIdFor(ID.pending), available: true, productPaused: false, commandSeq: 0, canPause: true, canResume: false, resumeReason: 'approval_required' });
  expect(storage.readCommittedForEffect(accountIdFor(ID.pending))).toEqual({ status: 'ready', document: null });
  expect(await h.store.read()).toEqual(stateBefore);
  expect((await call(request('POST', { as: ID.pending, input: command('p', 0, 'pause') }))).data.status).toMatchObject({ productPaused: true, commandSeq: 1 });
  expect((await call(request('GET', { as: ID.pending, query: '?space=personal' }))).data).toMatchObject({ productPaused: false, commandSeq: 0 });
  expect((await call(request('GET', { as: ID.bob, query: '?space=work' }))).data).toMatchObject({ productPaused: false, commandSeq: 0 });
  expect((await call(request('POST', { as: ID.pending, input: command('r', 1, 'resume') }))).status).toBe(403);
});

it('resume needs fresh profile but does not grant or require an optional consent', async () => {
  expect((await call(request('POST', { input: command('a', 0, 'pause') }))).status).toBe(200);
  expect((await call(request('POST', { input: command('b', 1, 'resume') }))).data).toEqual({ error: 'profile_confirmation_required' });
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  const before = adaptive.readCommittedForEffect(ID.alice, d => d.permissions);
  const result = await call(request('POST', { input: command('b', 1, 'resume') }));
  expect(result.status).toBe(200); expect(result.data.status).toMatchObject({ productPaused: false, commandSeq: 2, useEpoch: 2 });
  expect(adaptive.readCommittedForEffect(ID.alice, d => d.permissions)).toEqual(before);
  expect((await call(request('GET', { query: '?space=work' }))).data.latest).toEqual(result.data.receipt);
});

it('old original command retry cannot overwrite a later opposite command', async () => {
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  const original = command('a', 0, 'pause');
  await call(request('POST', { input: original }));
  await call(request('POST', { input: command('b', 1, 'resume') }));
  expect((await call(request('POST', { input: original }))).status).toBe(409);
  expect((await call(request('GET', { query: '?space=work' }))).data).toMatchObject({ productPaused: false, commandSeq: 2, latest: { eventId: 'b'.repeat(22) } });
});

it('current Studio role is rechecked at the resume commit boundary', async () => {
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  await call(request('POST', { input: command('a', 0, 'pause') }));
  const original = h.store.readCommittedForEffect.bind(h.store); let reads = 0;
  vi.spyOn(h.store, 'readCommittedForEffect').mockImplementation(() => {
    const state = original();
    if (++reads >= 2) state.members = state.members.map(row => row.telegramId === ID.alice ? { ...row, role: 'pending' } : row);
    return state;
  });
  const response = await call(request('POST', { input: command('b', 1, 'resume') }));
  expect(response.status).toBe(403); expect(response.data.error).toBe('approval_required');
  expect(adaptive.readCommittedForEffect(ID.alice, d => d.productPause?.scopes[0])).toMatchObject({ status: 'ready', value: { productPaused: true, commandSeq: 1 } });
});

it('rejects forged account selection, bad auth/origin/JSON and oversized input before a pause write', async () => {
  expect((await call(request('GET', { as: null }))).status).toBe(401);
  expect((await call(request('GET', { query: '?space=work&accountId=someone' }))).status).toBe(400);
  expect((await call(request('GET', { query: '?space=work&space=personal' }))).status).toBe(400);
  expect((await call(request('POST', { input: { ...command('a', 0, 'pause'), accountId: accountIdFor(ID.bob) } }))).status).toBe(400);
  expect((await call(request('POST', { input: command('a', 0, 'pause'), headers: { origin: 'https://other.test' } }))).status).toBe(403);
  expect((await call(request('POST', { raw: '{broken' }))).status).toBe(400);
  expect((await call(request('POST', { raw: JSON.stringify({ padding: 'x'.repeat(3000) }) }))).status).toBe(413);
  expect(storage.readCommittedForEffect(accountIdFor(ID.alice))).toEqual({ status: 'ready', document: null });
});

it('unprepared FILE status is unavailable and read does not create default pause data', async () => {
  const legacy = new FileAdaptiveStorage(join(h.dir, 'legacy-adaptive'));
  h.studio.deps.adaptive = new AdaptiveService(new AdaptiveRepository(legacy));
  const result = await call(request('GET', { query: '?space=work' }));
  expect(result.status).toBe(200); expect(result.data).toMatchObject({ available: false, productPaused: null, useEpoch: null, canPause: false });
  expect(legacy.readCommittedForEffect(accountIdFor(ID.alice))).toEqual({ status: 'ready', document: null });
  expect((await call(request('POST', { input: command('a', 0, 'pause') }))).status).toBe(409);
  expect(legacy.readCommittedForEffect(accountIdFor(ID.alice))).toEqual({ status: 'ready', document: null });
});

it('does not advertise a prepared control through an unsupported provider transport', async () => {
  h.studio.deps.chatLLM = h.chatLLM;
  const result = await call(request('GET', { query: '?space=work' }));
  expect(result.status).toBe(200); expect(result.data).toMatchObject({ available: false, canPause: false, canResume: false, reason: 'unsupported_transport' });
  expect((await call(request('POST', { input: command('a', 0, 'pause') }))).data).toEqual({ error: 'unsupported_transport' });
  expect(storage.readCommittedForEffect(accountIdFor(ID.alice))).toEqual({ status: 'ready', document: null });
});
