import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { FirestoreChatHistoryStore, FirestoreMemoryStore } from '../../tireh/memory/firestore-store';
import type { NewMemory } from '../../tireh/memory/store';

const host = process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!host)('real Firestore emulator memory/privacy contracts', () => {
  const personaId = `memory_emulator_${randomUUID().replace(/-/g, '')}`;
  const memoryIds = new Set<string>();
  let app: App; let db: Firestore;
  const base = (): NewMemory => ({ personaId, content: 'Synthetic launch date', type: 'fact', scope: { kind: 'private', personId: 'synthetic-owner' }, authorizedPersonIds: ['synthetic-owner'], shareVersion: 0, sensitivity: 'normal', source: { personId: 'synthetic-owner', chatKind: 'private', at: new Date('2026-10-19T12:00:00Z') }, aboutPersonIds: ['synthetic-owner'], confidence: 0.9 });
  beforeAll(() => {
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host ?? '')) throw new Error('Memory emulator tests require a loopback endpoint');
    app = initializeApp({ projectId: 'demo-vox-relationships' }, `memory-emulator-${randomUUID()}`); db = getFirestore(app);
  });
  afterAll(async () => {
    for (const id of memoryIds) await db.collection('tireh_memories').doc(id).delete();
    const parents = await db.collection('tireh_chats').listDocuments();
    for (const parent of parents) if (parent.id.startsWith(`${personaId}__`)) await db.recursiveDelete(parent);
    await db.collection('tireh_privacy_epochs').doc(personaId).delete(); await db.terminate(); await deleteApp(app);
  });
  it('shares history epochs with memory adds and rejects stale append/extraction across instances', async () => {
    const first = new FirestoreChatHistoryStore(db); const second = new FirestoreChatHistoryStore(db); const memories = new FirestoreMemoryStore(db);
    const epoch = await first.getEpoch(personaId);
    await first.append(personaId, 'private-owner', { role: 'user', personId: 'synthetic-owner', text: 'Before deletion', at: new Date(), audiencePersonIds: ['synthetic-owner'] }, epoch);
    const saved = await memories.addIfEpoch(base(), epoch); expect(saved).not.toBeNull(); memoryIds.add(saved!.id);
    await second.clearPersona(personaId);
    expect(await first.getEpoch(personaId)).toBe(epoch + 1);
    await first.append(personaId, 'private-owner', { role: 'assistant', text: 'Stale reply must not return', at: new Date() }, epoch);
    expect(await memories.addIfEpoch({ ...base(), content: 'Stale extraction must not return' }, epoch)).toBeNull();
    expect(await first.recent(personaId, 'private-owner', 20)).toEqual([]);
    const fresh = await memories.addIfEpoch({ ...base(), content: 'Fresh explicitly stated fact' }, epoch + 1); expect(fresh).not.toBeNull(); memoryIds.add(fresh!.id);
  });
  it('physically purges legacy messages beneath a missing parent document', async () => {
    const parent = db.collection('tireh_chats').doc(`${personaId}__legacy-missing-parent`);
    const message = parent.collection('messages').doc('legacy-message');
    await message.set({ role: 'user', personId: 'synthetic-owner', text: 'Synthetic legacy private canary', at: new Date() });
    expect((await parent.get()).exists).toBe(false); expect((await message.get()).exists).toBe(true);
    await new FirestoreChatHistoryStore(db).clearPersona(personaId);
    expect((await message.get()).exists).toBe(false);
  });
  it('rejects concurrent stale sharing grants and preserves exact audience snapshots', async () => {
    const a = new FirestoreMemoryStore(db); const b = new FirestoreMemoryStore(db);
    const saved = await a.add(base()); memoryIds.add(saved.id);
    const outcomes = await Promise.all([
      a.updateIfShareVersion(saved.id, 0, { scope: { kind: 'people', personIds: ['synthetic-owner', 'synthetic-a'] }, authorizedPersonIds: ['synthetic-owner', 'synthetic-a'], shareVersion: 1 }),
      b.updateIfShareVersion(saved.id, 0, { scope: { kind: 'people', personIds: ['synthetic-owner', 'synthetic-b'] }, authorizedPersonIds: ['synthetic-owner', 'synthetic-b'], shareVersion: 1 }),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const after = await a.get(saved.id); expect(after!.authorizedPersonIds).toEqual(after!.scope.kind === 'people' ? after!.scope.personIds : []); expect(after!.shareVersion).toBe(1);
    expect(await b.updateIfShareVersion(saved.id, 1, { scope: { kind: 'private', personId: 'synthetic-owner' }, authorizedPersonIds: ['synthetic-owner'], shareVersion: 2 })).toBe(true);
    expect(await a.updateIfShareVersion(saved.id, 0, { scope: { kind: 'people', personIds: ['synthetic-owner', 'synthetic-a'] }, authorizedPersonIds: ['synthetic-owner', 'synthetic-a'], shareVersion: 1 })).toBe(false);
    expect((await b.get(saved.id))!.authorizedPersonIds).toEqual(['synthetic-owner']);
  }, 30_000);
  it('round-trips legacy absent snapshots without silently widening or manufacturing an audience', async () => {
    const store = new FirestoreMemoryStore(db); const memory = base(); delete memory.authorizedPersonIds; delete memory.shareVersion;
    const saved = await store.add({ ...memory, scope: { kind: 'group', groupId: 'synthetic-group' } }); memoryIds.add(saved.id);
    const restored = await store.get(saved.id); expect(restored!.authorizedPersonIds).toBeUndefined(); expect(restored!.shareVersion).toBeUndefined(); expect(restored!.source.at).toBeInstanceOf(Date);
    const history = new FirestoreChatHistoryStore(db); const epoch = await history.getEpoch(personaId);
    await history.append(personaId, 'group-snapshot', { role: 'user', personId: 'synthetic-owner', text: 'Synthetic group fact', at: new Date(), audiencePersonIds: ['synthetic-owner', 'synthetic-a'] }, epoch);
    const recent = await history.recent(personaId, 'group-snapshot', 10); expect(recent[0].audiencePersonIds).toEqual(['synthetic-owner', 'synthetic-a']); expect(recent[0].at).toBeInstanceOf(Date);
  });
});
