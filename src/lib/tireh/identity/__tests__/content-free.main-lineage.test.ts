/**
 * Main-lineage content-free canary (S10L, earlier run 83848b7,
 * content-free.test.ts) ported onto the chosen wave A implementation
 * (aiq/identity-lib b34b7c0). Kept for its substring scan: no fragment of four
 * or more characters of any input word may appear in features, results,
 * stored bytes or logs. API renames: StyleIdentityService ->
 * IdentityConfidenceService, recalibrate -> applyFairness, forgetPerson ->
 * forget; wave A stores a profile only after enroll() and logs fixed string
 * codes. Uses wave A's identity fake Firestore.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { IdentityConfidenceService } from '../index';
import { styleProfileSchema } from '../profile';
import { createFileStyleProfileStore, FirestoreStyleProfileStore, InMemoryStyleProfileStore, type StyleProfileStore } from '../store';
import { extractStyleFeatures } from '../style-features';
import type { VoiceNoteInput } from '../voice-band';
import { fakeFirestore } from './fake-firestore';

const TEXT_CANARY_EN = 'IDENTITY_STYLE_PRIVATE_TEXT_S10L';
const TEXT_CANARY_FA = 'رازمحرمانهکاناری';
const T0 = Date.UTC(2026, 9, 1, 18, 0);
const KEY = { personaId: 'persona-c', personId: 'member-c', space: 'personal' as const };
const ALLOWED_STRING_KEYS = new Set(['personId', 'space', 'purpose']);

const MESSAGES = Array.from({ length: 60 }, (_, i) => `${TEXT_CANARY_EN} ${TEXT_CANARY_FA} ${i % 2 ? 'سلامممم :)' : 'Hello ۱۲۳)))'}`);
const INPUT_WORDS = [...new Set(MESSAGES.flatMap(m => m.split(/\s+/)).filter(w => w.length >= 4))];
const FORBIDDEN = [...new Set(INPUT_WORDS.flatMap(word => {
  const chars = [...word];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) for (let j = i + 4; j <= chars.length; j++) out.push(chars.slice(i, j).join(''));
  return out;
}))];

function assertContentFree(label: string, blob: string): void {
  expect(blob, label).not.toContain(TEXT_CANARY_EN);
  expect(blob, label).not.toContain(TEXT_CANARY_FA);
  expect(FORBIDDEN.filter(fragment => blob.includes(fragment)), label).toEqual([]);
}

function stringPaths(value: unknown, path: string[] = []): string[][] {
  if (typeof value === 'string') return [path];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => stringPaths(v, [...path, k]));
  return [];
}

function canaryError(): Error {
  return Object.assign(new Error(`${TEXT_CANARY_EN} ${TEXT_CANARY_FA}`), { providerBody: TEXT_CANARY_EN });
}

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

interface Harness { store: StyleProfileStore; rows: () => unknown[]; raw: () => string[] }
const harnesses: Array<[string, () => Harness]> = [
  ['in-memory', () => {
    const store = new InMemoryStyleProfileStore();
    return { store, rows: () => [], raw: () => [] };
  }],
  ['file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-style-canary-'));
    directories.push(dir);
    const path = join(dir, 'profiles.json');
    const store = createFileStyleProfileStore(path);
    const read = () => (existsSync(path) ? readFileSync(path, 'utf8') : '{"version":1,"profiles":{}}');
    return { store, rows: () => Object.values((JSON.parse(read()) as { profiles: Record<string, unknown> }).profiles), raw: () => [read()] };
  }],
  ['firestore', () => {
    const firestore = fakeFirestore();
    return {
      store: new FirestoreStyleProfileStore(firestore as unknown as Firestore),
      rows: () => [...firestore.data.values()],
      raw: () => [JSON.stringify([...firestore.data])],
    };
  }],
];

describe.each(harnesses)('main-lineage: content-free identity pipeline (%s store)', (_name, make) => {
  it('never stores, returns or logs message text', async () => {
    const { store, rows, raw } = make();
    const log = { warn: vi.fn() };
    const service = new IdentityConfidenceService({ store, log });
    const returned: unknown[] = [];

    returned.push(await service.enroll({ personId: KEY.personId, space: KEY.space, kind: 'style_baseline', at: T0, personalizationAllowed: true }));
    for (const [i, text] of MESSAGES.entries()) {
      const at = T0 + (i + 1) * 5 * 60_000;
      const features = extractStyleFeatures({ kind: 'text', text, edited: false, at, utcOffsetMinutes: 210 });
      returned.push(features, await service.observeStyle({ ...KEY, features, at, personalizationAllowed: true }));
    }
    const last = T0 + 61 * 5 * 60_000;
    returned.push(extractStyleFeatures({ kind: 'voice', text: TEXT_CANARY_EN, edited: false, durationSec: 7, at: last }));
    returned.push(await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at: last }));
    returned.push(await service.applyFairness(KEY.space, last));
    const stored = rows();
    if (_name !== 'in-memory') expect(stored.length).toBe(1);
    returned.push(await service.sweep(last + 8 * 86_400_000));

    // Failing collaborators whose errors carry the canaries.
    const fail = async () => { throw canaryError(); };
    const failing: StyleProfileStore = { get: fail, put: fail, delete: fail, deleteAllFor: fail, list: fail, sweep: fail };
    const broken = new IdentityConfidenceService({ store: failing, log, voice: { verifyVoiceNote: fail } });
    const features = extractStyleFeatures({ kind: 'text', text: MESSAGES[0], edited: false, at: last });
    returned.push(await broken.observeStyle({ ...KEY, features, at: last, personalizationAllowed: true }));
    returned.push(await broken.enroll({ personId: KEY.personId, space: KEY.space, kind: 'style_baseline', at: last, personalizationAllowed: false }));
    returned.push(await broken.recordPromptOutcome({ ...KEY, outcome: 'other_person', at: last }));
    returned.push(await broken.applyFairness(KEY.space, last));
    const error = await broken.forget(KEY.personId).then(() => null, (e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    returned.push({ message: error?.message, stack: error?.stack });
    const voiceInput: VoiceNoteInput = {
      personaId: KEY.personaId, personId: KEY.personId, space: KEY.space, chatKind: 'private', guestAudience: false,
      audio: new TextEncoder().encode(TEXT_CANARY_EN).buffer as ArrayBuffer, mimeType: 'audio/ogg', channel: 'telegram_voice_note',
    };
    returned.push(await broken.verifyVoiceNote(voiceInput));
    returned.push(await service.observeStyle({ ...KEY, features: { ...features, raw: TEXT_CANARY_EN } as never, at: last, personalizationAllowed: true }));

    assertContentFree('returned values', JSON.stringify(returned));
    for (const blob of raw()) assertContentFree('stored bytes', blob);
    for (const row of [...stored, ...rows()]) {
      assertContentFree('stored row', JSON.stringify(row));
      expect(styleProfileSchema.safeParse(row).success).toBe(true);
      for (const path of stringPaths(row)) expect(path.length === 1 && ALLOWED_STRING_KEYS.has(path[0]), path.join('.')).toBe(true);
    }

    const logs = log.warn.mock.calls;
    expect(logs.length).toBeGreaterThan(0);
    assertContentFree('logs', JSON.stringify(logs));
    for (const args of logs) {
      expect(args).toHaveLength(1);
      expect(typeof args[0]).toBe('string');
      const blob = JSON.stringify(args);
      for (const id of [KEY.personaId, KEY.personId]) expect(blob).not.toContain(id);
    }
  }, 60_000);
});
