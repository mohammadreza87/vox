/**
 * Main-lineage store cases (S10L, earlier run 83848b7, stores.test.ts) ported
 * onto the chosen wave A implementation (aiq/identity-lib b34b7c0). API
 * renames: styleProfileDocId(key) -> profileDocId(personId, space) (40 hex
 * characters in wave A, 64 in main), update(key, fn) -> put(profile), rows are
 * keyed per person and space (no persona). Uses wave A's identity fake
 * Firestore. Cases that need main's API are listed in
 * docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { newProfile, observeProfile, profileDocId, type StyleProfile } from '../profile';
import { createFileStyleProfileStore, FirestoreStyleProfileStore, STYLE_PROFILES_COLLECTION } from '../store';
import { extractStyleFeatures, styleVector } from '../style-features';
import { fakeFirestore } from './fake-firestore';

const T0 = Date.UTC(2026, 9, 1, 18, 0);
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vox-style-'));
  directories.push(dir);
  return join(dir, 'nested', 'style-profiles.json');
}

function row(personId: string, space: 'work' | 'personal' = 'work', messages = 3, kind: 'text' | 'voice' = 'text'): StyleProfile {
  let p = newProfile(personId, space, 0, T0);
  for (let i = 0; i < messages; i++) {
    const at = T0 + i * 60_000;
    p = observeProfile(p, styleVector(extractStyleFeatures({ kind, text: 'سلام‌ها', edited: false, at, durationSec: 9 })), at);
  }
  return p;
}

describe('main-lineage: store specifics', () => {
  it('derives deterministic hex document ids that differ by space', () => {
    const work = profileDocId('alice', 'work');
    expect(work).toMatch(/^[0-9a-f]{40}$/);
    expect(profileDocId('alice', 'work')).toBe(work);
    expect(profileDocId('alice', 'personal')).not.toBe(work);
    expect(STYLE_PROFILES_COLLECTION).toBe('vox_style_profiles');
  });

  it('writes the file with mode 0600 and drops invalid rows on load', async () => {
    const path = tempFile();
    const store = createFileStyleProfileStore(path);
    await store.put(row('alice'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const state = JSON.parse(readFileSync(path, 'utf8')) as { version: number; profiles: Record<string, unknown> };
    expect(state.version).toBe(1);
    state.profiles[profileDocId('bob', 'work')] = { ...row('bob'), text: 'private' };
    writeFileSync(path, JSON.stringify(state));
    expect(await store.list('work')).toHaveLength(1);
    const after = JSON.parse(readFileSync(path, 'utf8')) as { profiles: Record<string, unknown> };
    expect(Object.keys(after.profiles)).toHaveLength(1);
    expect(readFileSync(path, 'utf8')).not.toContain('private');
  });

  it('stores plain numbers in Firestore and never undefined', async () => {
    const firestore = fakeFirestore();
    const store = new FirestoreStyleProfileStore(firestore as unknown as Firestore);
    await store.put(row('alice'));
    await store.put(row('alice', 'work', 4, 'voice'));
    await store.sweep(T0 - 1);
    const id = `${STYLE_PROFILES_COLLECTION}/${profileDocId('alice', 'work')}`;
    const doc = firestore.data.get(id);
    expect(typeof doc?.updatedAt).toBe('number');
    expect(typeof doc?.lastObservedAt).toBe('number');
    expect(Object.values(doc ?? {}).includes(undefined)).toBe(false);
    // An invalid stored document is treated as absent and deleted on read.
    firestore.data.set(id, { ...doc, text: 'private' });
    expect(await store.get('alice', 'work')).toBeNull();
    expect(firestore.data.has(id)).toBe(false);
  });
});
