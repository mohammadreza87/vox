/**
 * QA r3 (code quality, wave A on main): FirestoreVoiceprintStore.touch() was a
 * read-then-set outside a transaction. A consent withdrawal (the adaptive
 * invalidator's delete) that landed between its get() and set() was undone: the
 * set wrote the whole row read earlier, template included, back into
 * vox_voiceprints. Fixed in fixer r3: touch() is a field update that cannot
 * create the document (NOT_FOUND is a no-op), and verifyVoiceNote is tracked
 * like enroll, so invalidate() aborts an in-flight verification.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { VoiceprintCipher } from '../identity/crypto';
import { FirestoreVoiceprintStore, voiceprintDocId } from '../identity/store';
import { setupVoiceprints, TEMPLATE_CANARY, TEST_KEY } from './voiceprint-fixtures';

/** A fake where the withdrawal's delete of `raceKey` commits right after the caller's next read, or before its next write. */
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
      set: vi.fn(async (data: Record<string, unknown>) => {
        if (raceKey === key) { raceKey = undefined; docs.delete(key); }
        docs.set(key, { ...data });
      }),
      update: vi.fn(async (data: Record<string, unknown>) => {
        if (raceKey === key) { raceKey = undefined; docs.delete(key); }
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
  it('a delete that lands during touch() is not undone: no template comes back', async () => {
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

  it('touch() still records the confirmation on a present row, template untouched', async () => {
    const { db, docs } = racingFirestore();
    const store = new FirestoreVoiceprintStore(db);
    const cipher = new VoiceprintCipher(TEST_KEY);
    const base = { personId: 'tg-8', space: 'work' as const, provider: 'p', modelVersion: 'm', channel: 'telegram_voice_note' as const, consentEventId: 'e', createdAt: new Date('2026-10-20T00:00:00Z') };
    const template = cipher.seal(new TextEncoder().encode(TEMPLATE_CANARY), base);
    await store.put({ ...base, template });
    await store.touch('tg-8', 'work', new Date('2026-10-21T00:00:00Z'));
    const row = docs.get(`vox_voiceprints/${voiceprintDocId('tg-8', 'work')}`)!;
    expect(row.lastConfirmedAt).toEqual(new Date('2026-10-21T00:00:00Z'));
    expect(row.template).toEqual(template);
  });
});

describe('verifyVoiceNote and invalidate() (QA r3)', () => {
  it('an invalidation while the provider compares aborts the verification: no match, no touch', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    const touch = vi.spyOn(s.store, 'touch');
    let seen: AbortSignal | undefined;
    s.provider.identify.mockImplementationOnce(async (_audio, _candidates, signal) => {
      seen = signal;
      // A profile change: the invalidator runs while consent itself is unchanged.
      await s.service.invalidate(s.telegramId);
      return { candidateId: 'owner', score: 0.99 };
    });
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
    expect(seen?.aborted).toBe(true);
    expect(touch).not.toHaveBeenCalled();
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });
});
