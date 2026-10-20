import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CALIBRATION_RETENTION_MS, DAY_MS, emptyProfile, foldFeatures, STYLE_PROFILE_TTL_MS, type StyleProfile, type StyleProfileKey,
} from '../profile';
import {
  createFileStyleProfileStore, FirestoreStyleProfileStore, InMemoryStyleProfileStore, STYLE_PROFILES_COLLECTION,
  styleProfileDocId, type StyleProfileStore,
} from '../store';
import { fakeFirestore, type FakeFirestore } from './fake-firestore';
import { FIXTURE_T0, makeFeatures } from './style-fixtures';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'vox-style-'));
  directories.push(dir);
  return join(dir, 'nested', 'style-profiles.json');
}

interface Harness { store: StyleProfileStore; path?: string; firestore?: FakeFirestore }
const factories: Array<[string, () => Promise<Harness>]> = [
  ['in-memory', async () => ({ store: new InMemoryStyleProfileStore() })],
  ['file', async () => { const path = await tempFile(); return { store: createFileStyleProfileStore(path), path }; }],
  ['firestore', async () => { const firestore = fakeFirestore(); return { store: new FirestoreStyleProfileStore(firestore.db), firestore }; }],
];

const T0 = FIXTURE_T0;
const key = (personaId: string, personId: string, space: 'work' | 'personal' = 'work'): StyleProfileKey => ({ personaId, personId, space });
function row(k: StyleProfileKey, messages = 3, at = T0): StyleProfile {
  let p = emptyProfile(k, 0, at);
  for (let i = 0; i < messages; i++) p = foldFeatures(p, makeFeatures({ text: { zwnjRate: 0.3 } }), at + i);
  return p;
}
const put = (store: StyleProfileStore, p: StyleProfile) => store.update(p, () => p);

describe.each(factories)('%s style profile store', (_name, make) => {
  it('gets, creates, updates and deletes through update', async () => {
    const { store } = await make();
    const k = key('persona-1', 'member-a');
    expect(await store.get(k)).toBeNull();
    const created = await put(store, row(k));
    expect(created?.messages).toBe(3);
    expect(await store.get(k)).toEqual(created);
    const updated = await store.update(k, current => current && foldFeatures(current, makeFeatures(), current.lastAt + 1));
    expect(updated?.messages).toBe(4);
    expect((await store.get(k))?.messages).toBe(4);
    expect(await store.update(k, current => current)).toEqual(updated);
    expect(await store.update(k, () => null)).toBeNull();
    expect(await store.get(k)).toBeNull();
    expect(await store.delete(k)).toBe(false);
    await put(store, row(k));
    expect(await store.delete(k)).toBe(true);
  });

  it('rejects a key mismatch and invalid rows without writing', async () => {
    const { store } = await make();
    const k = key('persona-1', 'member-a');
    await expect(store.update(k, () => row(key('persona-1', 'member-b')))).rejects.toThrow('style_profile_key_mismatch');
    await expect(store.update(k, () => ({ ...row(k), text: 'private' }) as StyleProfile)).rejects.toThrow('style_profile_invalid');
    await expect(store.update(k, () => ({ ...row(k), messages: Number.NaN }))).rejects.toThrow('style_profile_invalid');
    expect(await store.get(k)).toBeNull();
  });

  it('deletes by person across personas and spaces, and by persona', async () => {
    const { store } = await make();
    const rows = [key('p1', 'alice'), key('p1', 'alice', 'personal'), key('p2', 'alice'), key('p1', 'bob'), key('p2', 'bob', 'personal')];
    for (const k of rows) await put(store, row(k));
    expect(await store.deletePerson('alice')).toBe(3);
    expect((await store.listPersona('p1')).map(r => r.personId)).toEqual(['bob']);
    expect(await store.listPerson('bob', 'personal')).toHaveLength(1);
    expect(await store.listPerson('bob', 'work')).toHaveLength(1);
    expect(await store.listPerson('alice', 'work')).toEqual([]);
    expect(await store.deletePersona('p2')).toBe(1);
    expect(await store.listPersona('p2')).toEqual([]);
    expect(await store.listPersona('p1')).toHaveLength(1);
  });

  it('sweeps expired statistics and deletes rows past retention', async () => {
    const { store } = await make();
    const fresh = row(key('p1', 'fresh'), 3, T0);
    const stale = row(key('p1', 'stale'), 3, T0 - 10 * DAY_MS);
    const ancient = row(key('p1', 'ancient'), 3, T0 - 100 * DAY_MS);
    for (const p of [fresh, stale, ancient]) await put(store, p);
    expect(stale.expiresAt).toBe(stale.lastAt + STYLE_PROFILE_TTL_MS);
    expect(await store.sweep(T0 + DAY_MS)).toEqual({ reset: 1, deleted: 1 });
    const reset = await store.get(stale);
    expect(reset?.messages).toBe(0);
    expect(reset?.calibration).toEqual(stale.calibration);
    expect(await store.get(ancient)).toBeNull();
    expect((await store.get(fresh))?.messages).toBe(3);
    expect(await store.sweep(T0 + DAY_MS)).toEqual({ reset: 0, deleted: 0 });
    expect(await store.sweep(stale.lastAt + CALIBRATION_RETENTION_MS)).toEqual({ reset: 1, deleted: 1 });
    expect(await store.get(stale)).toBeNull();
  });

  it('applies concurrent updates', async () => {
    const { store } = await make();
    const k = key('p1', 'alice');
    await put(store, row(k, 0));
    await Promise.all(Array.from({ length: 4 }, (_, i) =>
      store.update(k, current => current && foldFeatures(current, makeFeatures(), current.lastAt + i))));
    expect((await store.get(k))?.messages).toBe(4);
  });
});

describe('store specifics', () => {
  it('derives deterministic 64-hex document ids that differ by space', () => {
    const work = styleProfileDocId(key('p1', 'alice'));
    expect(work).toMatch(/^[0-9a-f]{64}$/);
    expect(styleProfileDocId(key('p1', 'alice'))).toBe(work);
    expect(styleProfileDocId(key('p1', 'alice', 'personal'))).not.toBe(work);
    expect(styleProfileDocId(key('p1alice', ''))).not.toBe(styleProfileDocId(key('p1', 'alice')));
    expect(STYLE_PROFILES_COLLECTION).toBe('vox_style_profiles');
  });

  it('writes the file with mode 0600 and drops invalid rows on load', async () => {
    const path = await tempFile();
    const store = createFileStyleProfileStore(path);
    const k = key('p1', 'alice');
    await put(store, row(k));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const state = JSON.parse(readFileSync(path, 'utf8')) as { version: number; profiles: unknown[] };
    expect(state.version).toBe(1);
    state.profiles.push({ ...row(key('p1', 'bob')), text: 'private' });
    writeFileSync(path, JSON.stringify(state));
    expect(await store.listPersona('p1')).toHaveLength(1);
    const after = JSON.parse(readFileSync(path, 'utf8')) as { profiles: unknown[] };
    expect(after.profiles).toHaveLength(1);
    expect(readFileSync(path, 'utf8')).not.toContain('private');
  });

  it('stores plain numbers in Firestore and never undefined', async () => {
    const firestore = fakeFirestore();
    const store = new FirestoreStyleProfileStore(firestore.db);
    const k = key('p1', 'alice');
    await put(store, row(k));
    await store.update(k, current => current && foldFeatures(current, makeFeatures({ modality: 'voice' }), current.lastAt + 1));
    await store.sweep(T0 + 30 * DAY_MS);
    expect(firestore.writes.length).toBeGreaterThan(0);
    const doc = firestore.data.get(`${STYLE_PROFILES_COLLECTION}/${styleProfileDocId(k)}`);
    expect(typeof doc?.lastAt).toBe('number');
    expect(typeof doc?.expiresAt).toBe('number');
    // An invalid stored document is treated as absent and deleted on read.
    firestore.data.set(`${STYLE_PROFILES_COLLECTION}/${styleProfileDocId(k)}`, { ...doc, text: 'private' });
    expect(await store.get(k)).toBeNull();
    expect(firestore.data.has(`${STYLE_PROFILES_COLLECTION}/${styleProfileDocId(k)}`)).toBe(false);
  });
});
