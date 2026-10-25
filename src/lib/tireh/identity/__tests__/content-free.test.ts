import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { IdentityConfidenceService } from '../index';
import { extractStyleFeatures, nextBurstIndex, STYLE_FEATURE_KEYS } from '../style-features';
import { createFileStyleProfileStore, FirestoreStyleProfileStore, InMemoryStyleProfileStore, type StyleProfileStore } from '../store';
import type { IdentityAssessment, StyleHint } from '../types';
import { fakeFirestore } from './fake-firestore';
import { mulberry32 } from './style-fixtures';

// Same pattern as src/lib/studio/__tests__/diagnostic-security.test.ts, with this step's own canaries.
const TEXT_CANARY = 'S10L_IDENTITY_PRIVATE_TEXT_CANARY_7Q';
const PERSIAN_CANARY = 'رازِ_خصوصی_کاناری';
const PERSON = 'S10L_PERSON_ID_CANARY_3K';
const FORBIDDEN_KEYS = /"(text|content|message|transcript|words|ngrams)"\s*:/;
const T0 = Date.UTC(2026, 4, 4, 17, 0);
const JSON_TOKENS = new Set(['text', 'voice', 'true', 'false', 'null']);

function canaryError() {
  return Object.assign(new Error(`${TEXT_CANARY} ${PERSIAN_CANARY}`, { cause: { token: TEXT_CANARY } }),
    { code: 'identity_private_secret', providerBody: PERSIAN_CANARY });
}
function hostileError() {
  const accessed = vi.fn(() => { throw canaryError(); });
  const error = new Error('synthetic hostile error');
  for (const key of ['stack', 'message', 'name', 'cause', 'code', 'status', 'toJSON']) {
    Object.defineProperty(error, key, { configurable: true, get: accessed });
  }
  return { error, accessed };
}

const LATIN = 'bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ';
const PERSIAN = 'ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
const EXTRAS = ['🙂', '👨‍👩‍👧', '🇮🇷', '؟', '?', '!!', '،', '‌', '۳', '7', ':)', 'xD', ' ', '\n', 'é'];

function randomText(rng: () => number): { text: string; words: string[] } {
  const words: string[] = [];
  const parts: string[] = [];
  const count = 1 + Math.floor(rng() * 30);
  for (let i = 0; i < count; i++) {
    const r = rng();
    if (r < 0.1) { parts.push(rng() < 0.5 ? TEXT_CANARY : PERSIAN_CANARY); continue; }
    if (r < 0.25) { parts.push(EXTRAS[Math.floor(rng() * EXTRAS.length)]); continue; }
    const alphabet = r < 0.6 ? LATIN : PERSIAN;
    const length = 2 + Math.floor(rng() * 9);
    let word = '';
    for (let j = 0; j < length; j++) word += alphabet[Math.floor(rng() * alphabet.length)];
    words.push(word);
    parts.push(word);
  }
  return { text: parts.join(' '), words };
}

function hasCanary(value: string): boolean {
  return value.includes(TEXT_CANARY) || value.includes(PERSIAN_CANARY);
}

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
const directories: string[] = [];
beforeEach(() => { consoleSpies = consoleMethods.map(method => vi.spyOn(console, method).mockImplementation(() => undefined)); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('content-free identity library', () => {
  it('(a) extracts only content-free values, whatever the text', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 200; i++) {
      const { text, words } = randomText(rng);
      const input = `${i % 2 === 0 ? TEXT_CANARY : PERSIAN_CANARY} ${text} ${PERSIAN_CANARY}`;
      const features = extractStyleFeatures({ kind: rng() < 0.1 ? 'voice' : 'text', text: input, edited: rng() < 0.2, at: T0 + i * 60_000,
        utcOffsetMinutes: 210, burstIndex: nextBurstIndex({ at: T0, burstIndex: 1 }, T0 + 1000), durationSec: 12 });
      const json = JSON.stringify(features);
      expect(hasCanary(json)).toBe(false);
      for (const word of words.filter(w => w.length >= 4)) {
        if (!json.includes(word)) continue;
        expect(STYLE_FEATURE_KEYS.some(key => key.includes(word)) || JSON_TOKENS.has(word), word).toBe(true);
      }
      expect(Object.keys(features)).toEqual([...STYLE_FEATURE_KEYS]);
      for (const [key, value] of Object.entries(features)) {
        if (key === 'version') { expect(value).toBe(1); continue; }
        if (key === 'kind') { expect(['text', 'voice']).toContain(value); continue; }
        expect(value === null || typeof value === 'number' || typeof value === 'boolean', key).toBe(true);
      }
    }
  });

  it('(b, c, d) keeps stores, logs and results free of content across the whole lifecycle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-style-'));
    directories.push(dir);
    const path = join(dir, 'style-profiles.json');
    const db = fakeFirestore();
    const stores: { name: string; store: StyleProfileStore }[] = [
      { name: 'memory', store: new InMemoryStyleProfileStore() },
      { name: 'file', store: createFileStyleProfileStore(path) },
      { name: 'firestore', store: new FirestoreStyleProfileStore(db as unknown as Firestore) },
    ];
    const returned: (StyleHint | IdentityAssessment | unknown)[] = [];
    const log = { warn: vi.fn() };
    for (const { store } of stores) {
      const service = new IdentityConfidenceService({ store, log, epochOf: () => 1 });
      const rng = mulberry32(99);
      returned.push(await service.enroll({ personId: PERSON, space: 'personal', kind: 'style_baseline', at: T0, personalizationAllowed: true }));
      let previous: { at: number; burstIndex: number } | undefined;
      for (let i = 0; i < 120; i++) {
        const at = T0 + Math.floor(i / 8) * 3_600_000 + (i % 8) * 45_000;
        const burstIndex = nextBurstIndex(previous, at);
        previous = { at, burstIndex };
        const { text } = randomText(rng);
        const features = extractStyleFeatures({ kind: i % 9 === 0 ? 'voice' : 'text', text: `${TEXT_CANARY} ${text} ${PERSIAN_CANARY}`,
          edited: i % 11 === 0, at, utcOffsetMinutes: 210, burstIndex, durationSec: 20 });
        const result = await service.observeStyle({ personaId: 'persona-content', personId: PERSON, space: 'personal', features, at, personalizationAllowed: true });
        returned.push(result);
        if (result.hint) returned.push(service.assess({ accountPersonId: PERSON, verifiedRecently: false, style: result.hint }));
      }
      await service.recordPromptOutcome({ personaId: 'persona-content', personId: PERSON, space: 'personal', outcome: 'confirmed_self', at: T0 + 20 * 3_600_000 });
      await service.applyFairness('personal', T0 + 30 * 86_400_000);
      await service.sweep(T0 + 30 * 86_400_000);
    }

    expect(existsSync(path)).toBe(true);
    const fileBytes = readFileSync(path, 'utf8');
    const firestoreBytes = JSON.stringify([...db.data.entries()]);
    for (const persisted of [fileBytes, firestoreBytes]) {
      expect(hasCanary(persisted)).toBe(false);
      expect(persisted).not.toMatch(FORBIDDEN_KEYS);
      expect(persisted).not.toContain('persona-content');
    }
    expect(firestoreBytes).toContain('vox_style_profiles/');
    expect([...db.data.keys()].join()).not.toContain(PERSON);

    // Store failures whose errors carry the canary behind hostile getters.
    const { error, accessed } = hostileError();
    const failing: StyleProfileStore = {
      get: vi.fn().mockRejectedValue(error), put: vi.fn().mockRejectedValue(error), delete: vi.fn().mockRejectedValue(error),
      deleteAllFor: vi.fn().mockRejectedValue(error), list: vi.fn().mockRejectedValue(error), sweep: vi.fn().mockRejectedValue(error),
    };
    const broken = new IdentityConfidenceService({ store: failing, log, voice: { verifyVoiceNote: vi.fn().mockRejectedValue(error) } });
    const features = extractStyleFeatures({ kind: 'text', text: TEXT_CANARY, edited: false, at: T0 });
    returned.push(await broken.observeStyle({ personaId: 'p', personId: PERSON, space: 'work', features, at: T0, personalizationAllowed: true }));
    returned.push(await broken.observeStyle({ personaId: 'p', personId: PERSON, space: 'work', features, at: T0, personalizationAllowed: false }));
    returned.push(await broken.enroll({ personId: PERSON, space: 'work', kind: 'style_baseline', at: T0, personalizationAllowed: true }));
    returned.push(await broken.verifyVoiceNote({ personaId: 'p', personId: PERSON, space: 'work', chatKind: 'private', guestAudience: false,
      audio: new TextEncoder().encode(TEXT_CANARY).buffer as ArrayBuffer, mimeType: 'audio/ogg', channel: 'telegram_voice_note' }));
    await broken.recordPromptOutcome({ personaId: 'p', personId: PERSON, space: 'work', outcome: 'confirmed_self', at: T0 });
    await broken.applyFairness('work', T0);
    await broken.sweep(T0);
    await expect(broken.forget(PERSON)).rejects.toThrow(/^identity_forget_failed$/);

    expect(accessed).toHaveBeenCalledTimes(0);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(log.warn.mock.calls.length).toBeGreaterThan(0);
    for (const call of log.warn.mock.calls) {
      expect(call).toHaveLength(1);
      expect(['identity_style_store_unavailable', 'identity_voice_unavailable']).toContain(call[0]);
      expect(hasCanary(JSON.stringify(call))).toBe(false);
    }
    const results = JSON.stringify(returned);
    expect(hasCanary(results)).toBe(false);
    expect(results).not.toContain(PERSON);
    expect(returned.some(r => typeof r === 'object' && r !== null && 'hint' in r)).toBe(true);
  }, 60_000); // the file store does ~240 atomic writes; slow under the sandboxed temp dir
});
