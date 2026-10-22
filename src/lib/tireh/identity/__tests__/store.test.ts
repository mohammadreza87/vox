import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { DAY_MS, newProfile, observeProfile, profileDocId, type StyleProfile } from '../profile';
import { STYLE_VECTOR_DIM } from '../style-features';
import {
  createFileStyleProfileStore, FirestoreStyleProfileStore, InMemoryStyleProfileStore, STYLE_PROFILES_COLLECTION,
  type StyleProfileStore,
} from '../store';
import { fakeFirestore, type FakeFirestore } from './fake-firestore';

const T0 = Date.UTC(2026, 3, 1);
const CANARY = 'S10L_IDENTITY_PRIVATE_TEXT_CANARY_7Q';
const PROFILE_KEYS = ['version', 'personId', 'space', 'purpose', 'epoch', 'createdAt', 'updatedAt', 'lastObservedAt',
  'rebaselinedAt', 'messages', 'sinceBaseline', 'sessions', 'mean', 'variance', 'weight', 'selfScores', 'falsePrompts',
  'disabled', 'disabledReason'];
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

interface Harness { name: string; store: StyleProfileStore; path?: string; db?: FakeFirestore }

function harnesses(): Harness[] {
  const dir = mkdtempSync(join(tmpdir(), 'vox-style-'));
  directories.push(dir);
  const path = join(dir, 'nested', 'style-profiles.json');
  const db = fakeFirestore();
  return [
    { name: 'memory', store: new InMemoryStyleProfileStore() },
    { name: 'file', store: createFileStyleProfileStore(path), path },
    { name: 'firestore', store: new FirestoreStyleProfileStore(db as unknown as Firestore), db },
  ];
}

function trained(personId: string, space: 'work' | 'personal', at = T0): StyleProfile {
  let p = newProfile(personId, space, 1, at);
  for (let i = 0; i < 3; i++) p = observeProfile(p, Array.from({ length: STYLE_VECTOR_DIM }, () => 0.3), at + i * 60_000);
  return p;
}

function persistedRows(h: Harness): Record<string, unknown>[] {
  if (h.path) return existsSync(h.path) ? Object.values(JSON.parse(readFileSync(h.path, 'utf8')).profiles as Record<string, Record<string, unknown>>) : [];
  if (h.db) return [...h.db.data.values()];
  return [];
}

describe.each(['memory', 'file', 'firestore'])('%s style profile store', (kind) => {
  const make = (): Harness => harnesses().find(h => h.name === kind)!;

  it('(a) gets, puts, deletes, lists and sweeps', async () => {
    const h = make();
    const { store } = h;
    expect(await store.get('alice', 'work')).toBeNull();
    const aliceWork = trained('alice', 'work');
    await store.put(aliceWork);
    await store.put(trained('alice', 'personal'));
    await store.put(trained('bob', 'work', T0 + 200 * DAY_MS));
    expect(await store.get('alice', 'work')).toEqual(aliceWork);
    expect(await store.get('alice', 'personal')).not.toBeNull();
    expect((await store.list('work')).map(p => p.personId).sort()).toEqual(['alice', 'bob']);
    expect((await store.list('personal')).map(p => p.personId)).toEqual(['alice']);

    await store.delete('alice', 'personal');
    expect(await store.get('alice', 'personal')).toBeNull();
    expect(await store.get('alice', 'work')).not.toBeNull();
    await store.delete('nobody', 'work');

    await store.put(trained('alice', 'personal'));
    expect(await store.deleteAllFor('alice')).toBe(2);
    expect(await store.get('alice', 'work')).toBeNull();
    expect(await store.get('alice', 'personal')).toBeNull();
    expect(await store.deleteAllFor('alice')).toBe(0);

    await store.put(trained('carol', 'personal'));
    expect(await store.sweep(T0 + 100 * DAY_MS)).toBe(1);
    expect(await store.get('carol', 'personal')).toBeNull();
    expect(await store.get('bob', 'work')).not.toBeNull();
  });

  it('returns copies that callers cannot use to mutate the store', async () => {
    const { store } = make();
    await store.put(trained('alice', 'work'));
    const first = await store.get('alice', 'work');
    (first!.mean as number[])[0] = 0.99;
    expect((await store.get('alice', 'work'))!.mean[0]).not.toBe(0.99);
  });

  it('(b) rejects anything outside the strict profile shape and writes nothing', async () => {
    const h = make();
    const base = trained('alice', 'work');
    const invalid: unknown[] = [
      { ...base, text: CANARY },
      { ...base, mean: base.mean.slice(1) },
      { ...base, falsePrompts: Number.NaN },
      { ...base, purpose: 'core.conversation' },
      { ...base, personId: '' },
      { ...base, selfScores: Array.from({ length: 65 }, () => 1) },
    ];
    for (const row of invalid) {
      await expect(h.store.put(row as StyleProfile)).rejects.toThrow(/^style_profile_invalid$/);
    }
    expect(await h.store.get('alice', 'work')).toBeNull();
    expect(persistedRows(h)).toEqual([]);
    expect(JSON.stringify(persistedRows(h))).not.toContain(CANARY);
  });

  it('(e) persists only profile keys under optional.personalization', async () => {
    const h = make();
    await h.store.put(trained('alice', 'work'));
    await h.store.put({ ...trained('bob', 'personal'), disabled: true, disabledReason: 'gini', rebaselinedAt: T0 });
    const rows = persistedRows(h);
    if (h.name !== 'memory') expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const key of Object.keys(row)) expect(PROFILE_KEYS).toContain(key);
      expect(row.purpose).toBe('optional.personalization');
    }
  });
});

describe('file style profile store', () => {
  const file = (): Harness => harnesses().find(h => h.name === 'file')!;

  it('(c) writes 0600 under the OS temp dir and leaves no temp file', async () => {
    const h = file();
    expect(h.path!.startsWith(tmpdir())).toBe(true);
    await h.store.put(trained('alice', 'work'));
    expect(statSync(h.path!).mode & 0o777).toBe(0o600);
    expect(existsSync(`${h.path}.tmp`)).toBe(false);
  });

  it('(c) returns null for a missing file and drops a corrupt row on read', async () => {
    const h = file();
    expect(await h.store.get('alice', 'work')).toBeNull();
    await h.store.put(trained('bob', 'work'));
    const state = JSON.parse(readFileSync(h.path!, 'utf8'));
    state.profiles[profileDocId('alice', 'work')] = { ...trained('alice', 'work'), text: CANARY };
    writeFileSync(h.path!, JSON.stringify(state));
    expect(await h.store.get('alice', 'work')).toBeNull();
    const after = readFileSync(h.path!, 'utf8');
    expect(after).not.toContain(CANARY);
    expect(await h.store.get('bob', 'work')).not.toBeNull();
  });

  it('ignores a row stored under another key and an unreadable file', async () => {
    const h = file();
    await h.store.put(trained('bob', 'work'));
    const state = JSON.parse(readFileSync(h.path!, 'utf8'));
    state.profiles[profileDocId('alice', 'work')] = trained('bob', 'work');
    writeFileSync(h.path!, JSON.stringify(state));
    expect(await h.store.get('alice', 'work')).toBeNull();
    expect((await h.store.list('work')).map(p => p.personId)).toEqual(['bob']);
    writeFileSync(h.path!, '{ not json');
    expect(await h.store.get('bob', 'work')).toBeNull();
    expect(await h.store.list('work')).toEqual([]);
  });

  it('serialises concurrent writes', async () => {
    const h = file();
    await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(id => h.store.put(trained(id, 'work'))));
    expect((await h.store.list('work')).map(p => p.personId).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('Firestore style profile store', () => {
  it('(d) writes vox_style_profiles/{profileDocId} without undefined fields', async () => {
    const db = fakeFirestore();
    const store = new FirestoreStyleProfileStore(db as unknown as Firestore);
    await store.put(trained('alice', 'work'));
    expect(STYLE_PROFILES_COLLECTION).toBe('vox_style_profiles');
    expect([...db.data.keys()]).toEqual([`vox_style_profiles/${profileDocId('alice', 'work')}`]);
    const row = db.data.get(`vox_style_profiles/${profileDocId('alice', 'work')}`)!;
    expect('rebaselinedAt' in row).toBe(false);
    expect(row.personId).toBe('alice');
  });

  it('drops a corrupt document on read', async () => {
    const db = fakeFirestore();
    const store = new FirestoreStyleProfileStore(db as unknown as Firestore);
    const id = `vox_style_profiles/${profileDocId('alice', 'work')}`;
    db.data.set(id, { ...trained('alice', 'work'), text: CANARY });
    expect(await store.get('alice', 'work')).toBeNull();
    expect(db.data.has(id)).toBe(false);
    db.data.set(id, { ...trained('alice', 'work'), transcript: CANARY });
    expect(await store.list('work')).toEqual([]);
    expect(db.data.has(id)).toBe(false);
  });
});
