import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DAY_MS, emptyProfile, styleProfileSchema, type StyleProfile, type StyleProfileKey } from '../profile';
import { StyleIdentityService } from '../service';
import { createFileStyleProfileStore, FirestoreStyleProfileStore, InMemoryStyleProfileStore, type StyleProfileStore } from '../store';
import { extractStyleFeatures } from '../style-features';
import type { IdentityLogEvent } from '../types';
import type { VoiceNoteInput } from '../voice-band';
import { fakeFirestore } from './fake-firestore';

// Same pattern as src/lib/studio/__tests__/diagnostic-security.test.ts.
const TEXT_CANARY_EN = 'IDENTITY_STYLE_PRIVATE_TEXT_S10L';
const TEXT_CANARY_FA = 'رازمحرمانهکاناری';
const T0 = Date.UTC(2026, 9, 1, 18, 0);
const KEY: StyleProfileKey = { personaId: 'persona-c', personId: 'member-c', space: 'personal' };
const ALLOWED_STRING_KEYS = new Set(['personaId', 'personId', 'space', 'purpose']);

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
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

interface Harness { store: StyleProfileStore; rows: () => unknown[]; raw: () => string[] }
const harnesses: Array<[string, () => Promise<Harness>]> = [
  ['in-memory', async () => {
    const store = new InMemoryStyleProfileStore();
    return { store, rows: () => [...store.rows.values()], raw: () => [JSON.stringify([...store.rows])] };
  }],
  ['file', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'vox-style-canary-'));
    directories.push(dir);
    const path = join(dir, 'profiles.json');
    const store = createFileStyleProfileStore(path);
    const read = () => (existsSync(path) ? readFileSync(path, 'utf8') : '{"profiles":[]}');
    return { store, rows: () => (JSON.parse(read()) as { profiles: unknown[] }).profiles, raw: () => [read()] };
  }],
  ['firestore', async () => {
    const firestore = fakeFirestore();
    return {
      store: new FirestoreStyleProfileStore(firestore.db),
      rows: () => [...firestore.data.values()],
      raw: () => [JSON.stringify([...firestore.data]), JSON.stringify(firestore.writes)],
    };
  }],
];

describe.each(harnesses)('content-free identity pipeline (%s store)', (_name, make) => {
  it('never stores, returns or logs message text', async () => {
    const { store, rows, raw } = await make();
    const logs: unknown[][] = [];
    const log = { warn: (...args: unknown[]) => { logs.push(args); } };
    const service = new StyleIdentityService({ store, log: log as { warn(event: IdentityLogEvent): void } });
    const returned: unknown[] = [];

    for (const [i, text] of MESSAGES.entries()) {
      const at = T0 + i * 5 * 60_000;
      const features = extractStyleFeatures({ modality: 'text', text, at, previousAt: at - 30_000, timeZone: 'Asia/Tehran' });
      returned.push(features, await service.observeStyle({ ...KEY, features, at, personalizationAllowed: true }));
    }
    const last = T0 + 60 * 5 * 60_000;
    returned.push(extractStyleFeatures({ modality: 'voice', text: TEXT_CANARY_EN, voiceDurationSec: 7, at: last }));
    returned.push(await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at: last, personalizationAllowed: true }));
    returned.push(await service.recalibrate(KEY.personaId, last));
    returned.push(await service.enroll({ personId: KEY.personId, space: KEY.space, kind: 'style_baseline', at: last, personalizationAllowed: true }));
    const stored = rows();
    expect(stored.length).toBe(1);
    returned.push(await store.sweep(last + 8 * DAY_MS));

    // Failing collaborators whose errors carry the canaries.
    const failing: StyleProfileStore = {
      get: async () => { throw canaryError(); }, update: async () => { throw canaryError(); }, delete: async () => { throw canaryError(); },
      deletePerson: async () => { throw canaryError(); }, deletePersona: async () => { throw canaryError(); },
      listPersona: async () => { throw canaryError(); }, listPerson: async () => { throw canaryError(); }, sweep: async () => { throw canaryError(); },
    };
    const broken = new StyleIdentityService({
      store: failing, log: log as { warn(event: IdentityLogEvent): void },
      voice: { verifyVoiceNote: async () => { throw canaryError(); } },
    });
    const features = extractStyleFeatures({ modality: 'text', text: MESSAGES[0], at: last });
    returned.push(await broken.observeStyle({ ...KEY, features, at: last, personalizationAllowed: true }));
    returned.push(await broken.enroll({ personId: KEY.personId, space: KEY.space, kind: 'style_baseline', at: last, personalizationAllowed: false }));
    returned.push(await broken.recordPromptOutcome({ ...KEY, outcome: 'someone_else', at: last, personalizationAllowed: true }));
    for (const operation of [() => broken.recalibrate(KEY.personaId, last), () => broken.forgetPerson(KEY.personId), () => broken.purgePersona(KEY.personaId)]) {
      const error = await operation().then(() => null, (e: unknown) => e as Error);
      expect(error).toBeInstanceOf(Error);
      returned.push({ message: error?.message, stack: error?.stack });
    }
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

    expect(logs.length).toBeGreaterThan(0);
    assertContentFree('logs', JSON.stringify(logs));
    for (const args of logs) {
      expect(args).toHaveLength(1);
      expect(Object.keys(args[0] as object).sort()).toEqual(['code', 'type']);
      const blob = JSON.stringify(args);
      for (const id of [KEY.personaId, KEY.personId]) expect(blob).not.toContain(id);
    }
  }, 60_000);

  it('rejects rows carrying text before anything is written', async () => {
    const { store, raw } = await make();
    const before = raw();
    const leaky = { ...emptyProfile(KEY, 0, T0), text: TEXT_CANARY_EN } as StyleProfile;
    await expect(store.update(KEY, () => leaky)).rejects.toThrow();
    expect(await store.get(KEY)).toBeNull();
    for (const blob of raw()) assertContentFree('after rejected write', blob);
    expect(raw()).toEqual(before);
  });
});

describe('file store load filter', () => {
  it('drops a row with an extra key on load', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'vox-style-canary-'));
    directories.push(dir);
    const path = join(dir, 'profiles.json');
    writeFileSync(path, JSON.stringify({ version: 1, profiles: [{ ...emptyProfile(KEY, 0, T0), text: TEXT_CANARY_FA }] }));
    const store = createFileStyleProfileStore(path);
    expect(await store.get(KEY)).toBeNull();
    assertContentFree('file after load', readFileSync(path, 'utf8'));
  });
});
