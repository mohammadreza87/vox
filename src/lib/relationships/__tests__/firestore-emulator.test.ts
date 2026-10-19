import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { FirestoreRelationshipStore, FirestoreObservationStore, RelationshipLoop, relationshipId, SafeRelationshipObserver } from '..';
import type { Assessment, RelationshipKey } from '..';

const host = process.env.FIRESTORE_EMULATOR_HOST;
/** Opt-in isolated integration: never connects to a live Firebase project. */
describe.skipIf(!host)('real Firestore emulator relationship contracts', () => {
  const projectId = 'demo-vox-relationships';
  const collection = `relationship_integration_${randomUUID().replace(/-/g, '')}`;
  const key: RelationshipKey = { personaId: 'synthetic-agent', chatKey: 'private-synthetic', audience: { kind: 'private', personId: 'synthetic-person' } };
  let app: App; let db: Firestore;
  beforeAll(() => {
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host ?? '')) throw new Error('Emulator tests require a loopback FIRESTORE_EMULATOR_HOST');
    app = initializeApp({ projectId }, `relationship-emulator-${randomUUID()}`); db = getFirestore(app);
  });
  afterAll(async () => {
    for (const suffix of ['', '_epochs', '_controls', '_observations']) await db.recursiveDelete(db.collection(`${collection}${suffix}`));
    await db.terminate(); await deleteApp(app);
  });
  it('commits conflicting updates atomically across independent instances', async () => {
    const a = new FirestoreRelationshipStore(db, collection); const b = new FirestoreRelationshipStore(db, collection);
    await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).update(key, (state) => { state.revision++; })));
    expect((await a.read(key)).revision).toBe(8);
    await expect(b.update(key, (state) => { state.revision = 100; throw new Error('abort'); })).rejects.toThrow('abort');
    expect((await a.read(key)).revision).toBe(8);
  }, 30_000);
  it('queries due times and prevents two topics sending concurrently', async () => {
    let now = new Date('2026-10-19T12:00:00Z');
    const storeA = new FirestoreRelationshipStore(db, collection, () => now); const storeB = new FirestoreRelationshipStore(db, collection, () => now);
    const target = { ...key, chatKey: 'concurrent-topics' };
    let topic = 0;
    const assessor = { assess: async ({ text }: { text: string }): Promise<Assessment> => ({ timeZone: 'UTC', followUp: { topic: `topic-${++topic}`, purpose: 'A grounded synthetic follow-up', timing: { kind: 'ongoing', evidenceQuote: text }, dueAt: '2026-10-19T13:00:00Z' } }) };
    const a = new RelationshipLoop({ store: storeA, mode: 'live', assessor, decisions: { choose: async () => 'send' }, now: () => now });
    const b = new RelationshipLoop({ store: storeB, mode: 'live', assessor, decisions: { choose: async () => 'send' }, now: () => now });
    for (const eventId of ['one', 'two']) await a.observeTurn({ ...target, eventId, speakerId: 'synthetic-person', source: 'telegram', text: 'Synthetic upcoming discussion' });
    now = new Date('2026-10-19T13:00:00Z');
    expect(await storeA.due(now, 10)).toContainEqual(target);
    let resolve!: (value: string) => void; let sends = 0;
    const delivery = { authorize: async () => true, loadContext: async () => 'Synthetic authorized context', compose: async () => 'How did it go?', send: async () => { sends++; return new Promise<string>((done) => { resolve = done; }); } };
    const first = a.drain(delivery); await new Promise<void>((done) => { const poll = setInterval(() => { if (resolve) { clearInterval(poll); done(); } }, 5); });
    const second = await b.drain(delivery); expect(second.claimed).toBe(0); resolve('synthetic-message'); await first;
    await b.drain({ ...delivery, send: async () => { sends++; return 'must-not-send'; } }); expect(sends).toBe(1);
  }, 30_000);
  it('shares persona invalidation epochs across independently constructed stores', async () => {
    const a = new FirestoreRelationshipStore(db, collection); const b = new FirestoreRelationshipStore(db, collection);
    await a.update(key, (state) => { state.disabled = true; state.preferences.push({ key: 'secret', value: 'synthetic private canary', sourceId: 'one', updatedAt: new Date().toISOString() }); });
    await b.bumpEpoch(key.personaId);
    const state = await a.read(key); expect(state.preferences).toEqual([]); expect(state.disabled).toBe(true);
  });
  it('makes data expiry effective before TTL deletion while preserving controls afterwards', async () => {
    let now = new Date('2026-10-19T12:00:00Z'); const store = new FirestoreRelationshipStore(db, collection, () => now);
    const target = { ...key, chatKey: 'ttl-controls' };
    await store.update(target, (state) => { state.disabled = true; state.timeZone = 'Europe/Tallinn'; state.preferences.push({ key: 'secret', value: 'synthetic expiry canary', sourceId: 'one', updatedAt: now.toISOString() }); });
    const ref = db.collection(collection).doc(relationshipId(target)); const saved = await ref.get(); expect(saved.get('expiresAt').toMillis()).toBe(now.getTime() + 90 * 86400_000);
    now = new Date(now.getTime() + 91 * 86400_000); expect((await store.read(target)).preferences).toEqual([]);
    await ref.delete(); const fresh = await store.read(target); expect(fresh.disabled).toBe(true); expect(fresh.timeZone).toBe('Europe/Tallinn'); expect(fresh.preferences).toEqual([]);
  });
  it('stores minimal observations with an expiry timestamp', async () => {
    const now = new Date(); const observations = new FirestoreObservationStore(db, `${collection}_observations`);
    await new SafeRelationshipObserver(observations, 'synthetic-secret-at-least-thirty-two-characters', () => now).emit(key, 'live', 'decision', 'stay_quiet');
    const events = await observations.recent(); expect(events).toHaveLength(1); expect(JSON.stringify(events)).not.toContain('synthetic-person');
    const doc = await db.collection(`${collection}_observations`).doc(events[0].id).get(); expect(doc.get('expiresAt').toMillis()).toBe(now.getTime() + 30 * 86400_000);
  });
});
