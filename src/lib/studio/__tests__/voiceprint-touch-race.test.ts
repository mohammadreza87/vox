/**
 * QA r3 (code quality, wave A on main): FirestoreVoiceprintStore.touch() is a
 * read-then-set outside a transaction. A consent withdrawal (the adaptive
 * invalidator's delete) that lands between its get() and set() is undone: the
 * set writes the whole row read earlier, template included, back into
 * vox_voiceprints. Pinned as a known gap with it.fails; the fix is a
 * transaction or a field update that fails when the document is gone.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { VoiceprintCipher } from '../identity/crypto';
import { FirestoreVoiceprintStore, voiceprintDocId } from '../identity/store';
import { TEMPLATE_CANARY, TEST_KEY } from './voiceprint-fixtures';

/** A fake whose next get() of `raceKey` is followed by a concurrent delete before the caller writes. */
function racingFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  let raceKey: string | undefined;
  const ref = (collection: string, id: string) => {
    const key = `${collection}/${id}`;
    return {
      get: vi.fn(async () => {
        const data = docs.get(key);
        // The withdrawal's delete commits right after this read.
        if (raceKey === key) { raceKey = undefined; docs.delete(key); }
        return { exists: !!data, data: () => (data ? { ...data } : undefined) };
      }),
      set: vi.fn(async (data: Record<string, unknown>) => { docs.set(key, { ...data }); }),
      update: vi.fn(async (data: Record<string, unknown>) => {
        const current = docs.get(key);
        if (!current) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
        docs.set(key, { ...current, ...data });
      }),
      delete: vi.fn(async () => { docs.delete(key); }),
    };
  };
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(name, id) }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({
      get: (r: { get(): Promise<unknown> }) => r.get(),
      set: (r: { set(d: unknown): Promise<void> }, d: unknown) => void r.set(d),
      update: (r: { update(d: unknown): Promise<void> }, d: unknown) => void r.update(d),
    }),
  };
  return { db: db as unknown as Firestore, docs, raceOn: (key: string) => { raceKey = key; } };
}

describe('FirestoreVoiceprintStore.touch and a concurrent withdrawal (QA r3)', () => {
  it.fails('a delete that lands during touch() is not undone: no template comes back', async () => {
    const { db, docs, raceOn } = racingFirestore();
    const store = new FirestoreVoiceprintStore(db);
    const cipher = new VoiceprintCipher(TEST_KEY);
    const base = { personId: 'tg-7', space: 'work' as const, provider: 'p', modelVersion: 'm', channel: 'telegram_voice_note' as const, consentEventId: 'e', createdAt: new Date('2026-10-20T00:00:00Z') };
    await store.put({ ...base, template: cipher.seal(new TextEncoder().encode(TEMPLATE_CANARY), base) });
    const key = `vox_voiceprints/${voiceprintDocId('tg-7', 'work')}`;
    expect(docs.has(key)).toBe(true);

    raceOn(key);
    await store.touch('tg-7', 'work', new Date('2026-10-21T00:00:00Z')).catch(() => undefined);

    // After the withdrawal the biometric template must stay deleted.
    expect(docs.has(key)).toBe(false);
  });
});
