import { afterEach, expect, it, vi } from 'vitest';
import { correctionFixture, CORRECTION_NOW } from './memory-correction-fixtures';
const fixtures: Awaited<ReturnType<typeof correctionFixture>>[] = [];
async function setup() { const f = await correctionFixture(); fixtures.push(f); return f; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
it('requires real signed authentication, same origin, current membership, and strict correction-only input', async () => {
  const f = await setup();
  expect((await f.request(f.note.id, f.input(), { headers: { 'x-telegram-init-data': '' } })).status).toBe(401);
  expect((await f.request(f.note.id, f.input(), { headers: { origin: 'https://hostile.synthetic' } })).status).toBe(403);
  for (const extra of [{ origin: 'user_reviewed_claim' }, { expiresAt: CORRECTION_NOW + 99 }, { sourceRefs: [] }, { agentId: 'other' }, { personId: 'other' }]) {
    expect((await f.request(f.note.id, { ...f.input(), ...extra })).status).toBe(400);
  }
  expect((await f.request(f.note.id, { ...f.input(), space: 'personal' })).status).toBe(404);
  expect((await f.request(f.note.id, f.input(), { id: 124 })).status).toBe(404);
  await f.store.update(s => { s.members[0].role = 'pending'; });
  expect((await f.request(f.note.id, f.input())).status).toBe(403);
  expect((await f.service.read(123, 'work')).memories[0].text).toBe(f.note.text);
});
it('returns the current authoritative row, rejects stale saves, and matching command replay cannot revert a later correction', async () => {
  const f = await setup(), first = f.input('اصلاح صریح یادداشت');
  const result = await f.request(f.note.id, first); expect(result.status).toBe(200);
  expect((await result.json()).memories[0]).toMatchObject({ id: f.note.id, text: first.text, revision: 2, expiresAt: f.note.expiresAt });
  expect((await f.request(f.note.id, f.input('STALE'))).status).toBe(409);
  expect((await f.request(f.note.id, f.input('Current revision', 2))).status).toBe(200);
  expect((await (await f.request(f.note.id, first)).json()).memories[0]).toMatchObject({ text: 'Current revision', revision: 3 });
});
it.each(['member','binding','abort'] as const)('suppresses the response when %s changes after the committed correction but before projection', async change => {
  const f = await setup(), controller = new AbortController(), read = f.service.read.bind(f.service); let armed = true;
  vi.spyOn(f.service, 'read').mockImplementation(async (...args) => {
    const result = await read(...args);
    if (armed) { armed = false;
      if (change === 'member') await f.store.update(s => { s.members[0].role = 'pending'; });
      if (change === 'binding') await f.service.withAccountDocument(123, d => { delete d.binding; });
      if (change === 'abort') controller.abort();
    }
    return result;
  });
  const response = await f.request(f.note.id, f.input('CORRECTED_MUST_NOT_PROJECT'), { signal: controller.signal });
  expect(response.status).toBe(409); expect(await response.text()).not.toContain('CORRECTED_MUST_NOT_PROJECT');
});
it('samples final deadlines after actual synchronous Studio I/O and denies an expired profile projection', async () => {
  const f = await setup(), read = f.store.readCommittedForEffect.bind(f.store); let reads = 0;
  // entry, transactional entry, pre-rename, then final HTTP projection
  vi.spyOn(f.store, 'readCommittedForEffect').mockImplementation(() => { const state = read(); if (++reads === 4) f.setNow(CORRECTION_NOW + 12 * 3600_000); return state; });
  const response = await f.request(f.note.id, f.input()); expect(reads).toBeGreaterThanOrEqual(4);
  expect(response.status).toBe(409); expect(await response.text()).not.toContain('Corrected own note');
});
