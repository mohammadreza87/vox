import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { correctionFixture, CORRECTION_NOW } from './memory-correction-fixtures';
const fixtures: Awaited<ReturnType<typeof correctionFixture>>[] = [];
const allowed = { authorizeNow: () => true };
async function setup(file = true) { const f = await correctionFixture(file); fixtures.push(f); return f; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
it('corrects the same own row without changing origin, scope, retention, creation or grants and retires all derived descendants atomically', async () => {
  const f = await setup();
  await f.service.setAgentAccess(123, 'agent', { space: 'work', allowed: true, expectedRevision: (await f.service.read(123, 'work')).revision, eventId: randomUUID() });
  await f.service.withAccountDocument(123, d => {
    d.memories[0].origin = 'user_reviewed_claim';
    const source = d.memories[0];
    for (let i = 0; i < 3; i++) d.memories.push({ ...source, id: `derived-${i}`, origin: undefined, sourceRefs: [{ id: i ? `derived-${i - 1}` : source.id, revision: 1 }], text: `DERIVED_OLD_${i}` });
  });
  const before = await f.service.withAccountDocument(123, d => structuredClone(d)), command = f.input();
  f.setNow(CORRECTION_NOW + 5);
  await f.service.correctMemory(123, f.note.id, command, allowed);
  const after = await f.service.withAccountDocument(123, d => structuredClone(d)), current = after.memories[0];
  expect(current).toEqual({ ...before.memories[0], text: command.text, revision: 2, revocationEpoch: 1, updatedAt: CORRECTION_NOW + 5 });
  expect(after.memories.slice(1).every(m => m.status === 'deleted' && m.text === undefined && m.revision === 2 && m.revocationEpoch === 1)).toBe(true);
  expect(after.outbox.filter(e => e.eventId.startsWith('correction-derived:')).map(e => e.memoryId)).toEqual(['derived-0','derived-1','derived-2']);
  expect(after.events.find(e => e.eventId === command.eventId)?.kind).toBe('memory_corrected'); expect(after.agentGrants).toEqual(before.agentGrants); expect(after.permissions).toEqual(before.permissions);
  const context = await f.service.readPrivateContext(123, 'work', 'agent'); expect(JSON.stringify(context)).not.toContain('DERIVED_OLD');
});
it('replaying a correction reports current state after a later correction or delete and cannot revert or resurrect content', async () => {
  const f = await setup(), first = f.input('First correction');
  await f.service.correctMemory(123, f.note.id, first, allowed);
  await f.service.correctMemory(123, f.note.id, f.input('Later correction', 2), allowed);
  expect((await f.service.correctMemory(123, f.note.id, first, allowed)).memories[0]).toMatchObject({ revision: 3, text: 'Later correction' });
  await expect(f.service.correctMemory(123, f.note.id, { ...first, text: 'conflicting command' }, allowed)).rejects.toMatchObject({ code: 'event_conflict' });
  await f.service.deleteMemory(123, f.note.id, { space: 'work', expectedRevision: 3, eventId: randomUUID() });
  expect((await f.service.correctMemory(123, f.note.id, first, allowed)).memories).toEqual([]);
  expect(await f.service.withAccountDocument(123, d => d.memories[0])).toMatchObject({ status: 'deleted', revision: 4 });
});
it.each(['stale','space','account','expired','unconfirmed','policy','derived','unchanged'] as const)('rejects %s correction without changing the original text', async kind => {
  const f = await setup(), command = f.input(); let id = 123, memoryId = f.note.id;
  if (kind === 'stale') command.expectedRevision = 2;
  if (kind === 'space') Object.assign(command, { space: 'personal' });
  if (kind === 'account') id = 124;
  if (kind === 'expired') await f.service.withAccountDocument(123, d => { d.memories[0].expiresAt = CORRECTION_NOW; });
  if (kind === 'unconfirmed') await f.service.withAccountDocument(123, d => { delete d.binding; });
  if (kind === 'policy') f.deny();
  if (kind === 'derived') { await f.service.withAccountDocument(123, d => { d.memories.push({ ...d.memories[0], id: 'summary', sourceRefs: [{ id: d.memories[0].id, revision: 1 }] }); }); memoryId = 'summary'; }
  if (kind === 'unchanged') command.text = f.note.text;
  await expect(f.service.correctMemory(id, memoryId, command, allowed)).rejects.toBeDefined();
  const stored = await f.service.withAccountDocument(123, d => d.memories.find(m => m.id === f.note.id)!);
  if (kind === 'expired') expect(stored.text).toBeUndefined(); else expect(stored.text).toBe(f.note.text);
});
it('serializes competing corrections and deletion with memory CAS so only one writer wins', async () => {
  const f = await setup(), results = await Promise.allSettled([
    f.service.correctMemory(123, f.note.id, f.input('Correction A'), allowed),
    f.service.correctMemory(123, f.note.id, f.input('Correction B'), allowed),
    f.service.deleteMemory(123, f.note.id, { space: 'work', expectedRevision: 1, eventId: randomUUID() }),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(await f.service.withAccountDocument(123, d => d.memories[0].revision)).toBe(2);
});
it.each(['profile','memory','policy','member','abort'] as const)('fences %s changes during actual FILE temporary fsync before rename', async kind => {
  const f = await setup(), controller = new AbortController(); let permitted = true;
  if (kind === 'memory') await f.service.withAccountDocument(123, d => { d.memories[0].expiresAt = CORRECTION_NOW + 1; });
  const open = fs.open.bind(fs); let armed = true;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (armed && String(args[0]).endsWith('.tmp')) { armed = false; const sync = handle.sync.bind(handle); vi.spyOn(handle,'sync').mockImplementationOnce(async () => {
      await sync(); if (kind === 'profile') f.setNow(CORRECTION_NOW + 12 * 3600_000); if (kind === 'memory') f.setNow(CORRECTION_NOW + 1);
      if (kind === 'policy') f.deny(); if (kind === 'member') permitted = false; if (kind === 'abort') controller.abort();
    }); }
    return handle;
  });
  await expect(f.service.correctMemory(123, f.note.id, f.input(), { authorizeNow: () => permitted, signal: controller.signal })).rejects.toMatchObject({ code: 'memory_correction_changed' });
  const stored = (f.storage.readCommittedForEffect!('telegram-account:123') as { status: 'ready'; document: { memories: Array<{ text: string }> } }).document;
  expect(stored.memories[0].text).toBe(f.note.text);
});
it('truthfully disables correction on unsupported storage while ordinary own create/delete stay usable', async () => {
  const f = await setup(false); expect((await f.service.read(123, 'work')).memoryCorrectionAvailable).toBe(false);
  await expect(f.service.correctMemory(123, f.note.id, f.input(), allowed)).rejects.toMatchObject({ code: 'memory_correction_unavailable' });
  await f.save('A separate explicit note'); await f.service.deleteMemory(123, f.note.id, { space:'work',expectedRevision:1,eventId:randomUUID() });
  expect((await f.service.read(123, 'work')).memories.map(m => m.text)).toEqual(['A separate explicit note']);
});
