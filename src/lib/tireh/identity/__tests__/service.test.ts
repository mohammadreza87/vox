import { describe, expect, it, vi } from 'vitest';
import { DAY_MS, MIN_PROFILE_MESSAGES, type StyleProfileKey } from '../profile';
import { StyleIdentityService } from '../service';
import { InMemoryStyleProfileStore, type StyleProfileStore } from '../store';
import { DEFAULT_THRESHOLD, FALSE_PROMPT_MUTE_MS, THRESHOLD_STEP } from '../test';
import type { IdentityLog, IdentityLogEvent, IdentityService } from '../types';
import type { VoiceNoteInput, VoiceNoteVerifier, VoiceVerification } from '../voice-band';
import { makeFeatures, personA, personB, type TimedFeatures } from './style-fixtures';

const KEY: StyleProfileKey = { personaId: 'persona-1', personId: 'member-a', space: 'work' };
const MINUTE = 60_000;

function logSpy() {
  const events: IdentityLogEvent[] = [];
  const log: IdentityLog = { warn: event => { events.push(event); } };
  return { events, log };
}

function setup(options: Partial<ConstructorParameters<typeof StyleIdentityService>[0]> = {}) {
  const store = new InMemoryStyleProfileStore();
  const { events, log } = logSpy();
  const service = new StyleIdentityService({ store, log, ...options });
  const observe = (features: TimedFeatures['features'], at: number, key: StyleProfileKey = KEY, personalizationAllowed = true) =>
    service.observeStyle({ ...key, features, at, personalizationAllowed });
  const train = async (stream: readonly TimedFeatures[], key: StyleProfileKey = KEY) => {
    for (const m of stream) await observe(m.features, m.at, key);
  };
  return { store, service, events, observe, train };
}

/** Re-times a stream as one session starting at `start`, one message per minute. */
const session = (stream: readonly TimedFeatures[], start: number): TimedFeatures[] => stream.map((m, i) => ({ features: m.features, at: start + i * MINUTE }));

describe('StyleIdentityService.observeStyle', () => {
  it('implements the IdentityService contract', () => {
    const service: IdentityService = new StyleIdentityService({ store: new InMemoryStyleProfileStore() });
    expect(typeof service.observeStyle).toBe('function');
  });

  it('stores nothing without personalization consent and deletes existing rows', async () => {
    const { store, observe, service } = setup();
    const [first] = personA(1, 1);
    expect(await observe(first.features, first.at, KEY, false)).toEqual({ stored: false });
    expect(await store.get(KEY)).toBeNull();
    expect((await observe(first.features, first.at)).stored).toBe(true);
    expect(await store.get(KEY)).not.toBeNull();
    expect(service.activeSessions).toBe(1);
    expect(await observe(first.features, first.at + MINUTE, KEY, false)).toEqual({ stored: false });
    expect(await store.get(KEY)).toBeNull();
    expect(service.activeSessions).toBe(0);
  });

  it('gives no hint before 50 messages and a session-count hint after', async () => {
    const { observe } = setup();
    const stream = personA(2, 60);
    for (const [i, m] of stream.entries()) {
      const result = await observe(m.features, m.at);
      if (i < MIN_PROFILE_MESSAGES - 1) expect(result.hint).toBeUndefined();
      else expect(result.hint).toEqual({ source: 'style', consistency: 'consistent', messages: 1 });
    }
    const later = session(personA(3, 3), stream[59].at + DAY_MS);
    const hints = [];
    for (const m of later) hints.push((await observe(m.features, m.at)).hint?.messages);
    expect(hints).toEqual([1, 2, 3]);
  });

  it('discards statistics on an epoch bump', async () => {
    let epoch = 0;
    const { observe, store, train } = setup({ epochOf: async () => epoch });
    const stream = personA(4, 60);
    await train(stream);
    expect((await store.get(KEY))?.messages).toBeGreaterThanOrEqual(MIN_PROFILE_MESSAGES);
    epoch = 1;
    await observe(stream[0].features, stream[59].at + MINUTE);
    const row = await store.get(KEY);
    expect(row?.epoch).toBe(1);
    expect(row?.messages).toBe(1);
  });

  it('resets statistics after 7 days of absence and keeps the calibration', async () => {
    const { observe, store, train, service } = setup();
    const stream = personA(5, 60);
    await train(stream);
    await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at: stream[59].at, personalizationAllowed: true });
    const before = (await store.get(KEY))!;
    await observe(stream[0].features, before.lastAt + 8 * DAY_MS);
    const after = (await store.get(KEY))!;
    expect(after.messages).toBe(1);
    expect(after.calibration.threshold).toBe(before.calibration.threshold);
    expect(after.calibration.falsePrompts).toBe(1);
  });

  it('never learns from a session that ends uncertain', async () => {
    const { observe, store, train } = setup();
    const stream = personA(6, 60);
    await train(stream);
    const impostor = session(personB(7, 10), stream[59].at + DAY_MS);
    const decisions: (string | undefined)[] = [];
    decisions.push((await observe(impostor[0].features, impostor[0].at)).hint?.consistency);
    const before = (await store.get(KEY))!.messages;
    for (const m of impostor.slice(1)) decisions.push((await observe(m.features, m.at)).hint?.consistency);
    expect(decisions.slice(0, 4).every(d => d === 'consistent')).toBe(true);
    expect(decisions.slice(4).every(d => d === 'uncertain')).toBe(true);
    const next = personA(8, 1)[0];
    await observe(next.features, impostor[9].at + 2 * 3600_000);
    expect((await store.get(KEY))!.messages).toBe(before);
  });

  it('folds consistent sessions with a 5-message lag', async () => {
    const { observe, store, train } = setup();
    const stream = personA(9, 60);
    await train(stream);
    const own = session(personA(10, 7), stream[59].at + DAY_MS);
    await observe(own[0].features, own[0].at);
    const m0 = (await store.get(KEY))!.messages;
    const stored: boolean[] = [];
    for (const m of own.slice(1)) stored.push((await observe(m.features, m.at)).stored);
    expect((await store.get(KEY))!.messages).toBe(m0 + 2);
    expect(stored.filter(Boolean)).toHaveLength(2);
    const next = personA(11, 1)[0];
    await observe(next.features, own[6].at + 2 * 3600_000);
    expect((await store.get(KEY))!.messages).toBe(m0 + 7);
  });

  it('rejects invalid features without touching the store', async () => {
    const { observe, store, events } = setup();
    const spies = [vi.spyOn(store, 'update'), vi.spyOn(store, 'get'), vi.spyOn(store, 'delete')];
    const bad = { ...makeFeatures(), raw: 'secret' } as unknown as TimedFeatures['features'];
    expect(await observe(bad, 1000)).toEqual({ stored: false });
    expect(await observe(makeFeatures(), Number.NaN)).toEqual({ stored: false });
    expect(await observe(makeFeatures(), 1000, { ...KEY, personId: '' })).toEqual({ stored: false });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'identity', code: 'invalid_input' }, { type: 'identity', code: 'invalid_input' }, { type: 'identity', code: 'invalid_input' }]);
  });

  it('never rejects when the store throws', async () => {
    const failing: StyleProfileStore = {
      get: async () => { throw new Error('down'); }, update: async () => { throw new Error('down'); },
      delete: async () => { throw new Error('down'); }, deletePerson: async () => { throw new Error('down'); },
      deletePersona: async () => { throw new Error('down'); }, listPersona: async () => { throw new Error('down'); },
      listPerson: async () => { throw new Error('down'); }, sweep: async () => { throw new Error('down'); },
    };
    const { events, log } = logSpy();
    const service = new StyleIdentityService({ store: failing, log });
    await expect(service.observeStyle({ ...KEY, features: makeFeatures(), at: 1, personalizationAllowed: true })).resolves.toEqual({ stored: false });
    await expect(service.observeStyle({ ...KEY, features: makeFeatures(), at: 1, personalizationAllowed: false })).resolves.toEqual({ stored: false });
    await expect(service.enroll({ personId: 'member-a', space: 'work', kind: 'style_baseline', at: 1, personalizationAllowed: true }))
      .resolves.toEqual({ enrolled: false, reason: 'store_unavailable' });
    await expect(service.recordPromptOutcome({ ...KEY, outcome: 'someone_else', at: 1, personalizationAllowed: true })).resolves.toEqual({ recorded: false });
    await expect(service.recalibrate('persona-1', 1)).rejects.toThrow('style_profile_store_unavailable');
    await expect(service.forgetPerson('member-a')).rejects.toThrow('style_profile_store_unavailable');
    expect(events.every(e => e.code === 'store_error')).toBe(true);
    expect(events.length).toBe(6);
  });

  it('bounds the in-process session map', async () => {
    const { observe, service } = setup({ maxSessions: 5 });
    for (let i = 0; i < 15; i++) await observe(makeFeatures(), 1000 + i, { ...KEY, personId: `member-${i}` });
    expect(service.activeSessions).toBeLessThanOrEqual(5);
  });

  it('forgets a person and purges a persona, rows and sessions', async () => {
    const { observe, service, store } = setup();
    const keys: StyleProfileKey[] = [KEY, { ...KEY, space: 'personal' }, { ...KEY, personaId: 'persona-2' }, { ...KEY, personId: 'member-b' }];
    for (const k of keys) await observe(makeFeatures(), 1000, k);
    expect(service.activeSessions).toBe(4);
    expect(await service.forgetPerson('member-a')).toBe(3);
    expect(service.activeSessions).toBe(1);
    expect(await store.get(KEY)).toBeNull();
    expect(await store.get(keys[3])).not.toBeNull();
    expect(await service.purgePersona('persona-1')).toBe(1);
    expect(service.activeSessions).toBe(0);
    expect(await store.listPersona('persona-1')).toEqual([]);
  });
});

describe('StyleIdentityService.enroll', () => {
  const enroll = (service: StyleIdentityService, personalizationAllowed: boolean, at = 5_000) =>
    service.enroll({ personId: 'member-a', space: 'work', kind: 'style_baseline', at, personalizationAllowed });

  it('refuses and deletes rows without consent', async () => {
    const { service, observe, store } = setup();
    await observe(makeFeatures(), 1000);
    await observe(makeFeatures(), 1000, { ...KEY, space: 'personal' });
    expect(await enroll(service, false)).toEqual({ enrolled: false, reason: 'personalization_not_allowed' });
    expect(await store.get(KEY)).toBeNull();
    expect(await store.get({ ...KEY, space: 'personal' })).not.toBeNull();
  });

  it('is idempotent and resets statistics while keeping the calibration', async () => {
    const { service, store, train } = setup();
    const stream = personA(12, 60);
    await train(stream);
    await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at: stream[59].at, personalizationAllowed: true });
    const before = (await store.get(KEY))!;
    expect(await enroll(service, true, stream[59].at + 1)).toEqual({ enrolled: true });
    const once = (await store.get(KEY))!;
    expect(await enroll(service, true, stream[59].at + 1)).toEqual({ enrolled: true });
    expect(await store.get(KEY)).toEqual(once);
    expect(once.messages).toBe(0);
    expect(once.calibration).toEqual(before.calibration);
    expect(await enroll(service, true)).toEqual({ enrolled: true });
  });

  it('creates nothing when no row exists and validates input', async () => {
    const { service, store } = setup();
    expect(await enroll(service, true)).toEqual({ enrolled: true });
    expect(await store.listPerson('member-a', 'work')).toEqual([]);
    expect(await service.enroll({ personId: '', space: 'work', kind: 'style_baseline', at: 1, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
    expect(await service.enroll({ personId: 'a', space: 'work', kind: 'voice' as 'style_baseline', at: 1, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
    expect(await service.enroll({ personId: 'a', space: 'work', kind: 'style_baseline', at: Number.POSITIVE_INFINITY, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
  });
});

describe('StyleIdentityService.verifyVoiceNote', () => {
  const input = (overrides: Partial<VoiceNoteInput> = {}): VoiceNoteInput => ({
    personaId: 'persona-1', personId: 'member-a', space: 'work', chatKind: 'private', guestAudience: false,
    audio: new ArrayBuffer(8), mimeType: 'audio/ogg', durationSec: 6, channel: 'telegram_voice_note', ...overrides,
  });
  const MATCH: VoiceVerification = { band: 'MATCH', netSpeechMs: 5_000, modelVersion: 'fake-1' };

  it('never calls the verifier for groups or guest audiences', async () => {
    const verify = vi.fn(async () => MATCH);
    const { service } = setup({ voice: { verifyVoiceNote: verify } });
    expect(await service.verifyVoiceNote(input({ chatKind: 'group' }))).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
    expect(await service.verifyVoiceNote(input({ guestAudience: true }))).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns disabled without a verifier', async () => {
    const { service } = setup();
    expect(await service.verifyVoiceNote(input())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
  });

  it('maps verifier failures and aborts, and never rejects', async () => {
    const throwing: VoiceNoteVerifier = { verifyVoiceNote: async () => { throw new Error('provider down'); } };
    const sync: VoiceNoteVerifier = { verifyVoiceNote: () => { throw new Error('sync'); } };
    const hanging: VoiceNoteVerifier = { verifyVoiceNote: () => new Promise<VoiceVerification>(() => undefined) };
    const a = setup({ voice: throwing });
    expect(await a.service.verifyVoiceNote(input())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
    expect(a.events).toEqual([{ type: 'identity', code: 'verifier_error' }]);
    expect(await setup({ voice: sync }).service.verifyVoiceNote(input())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });

    const pre = new AbortController(); pre.abort();
    const verify = vi.fn(async () => MATCH);
    const b = setup({ voice: { verifyVoiceNote: verify } });
    expect(await b.service.verifyVoiceNote(input(), pre.signal)).toEqual({ band: 'NO_OPINION', reason: 'timeout' });
    expect(verify).not.toHaveBeenCalled();
    expect(b.events).toEqual([{ type: 'identity', code: 'verifier_timeout' }]);

    const during = new AbortController();
    const c = setup({ voice: hanging });
    const pending = c.service.verifyVoiceNote(input(), during.signal);
    during.abort();
    expect(await pending).toEqual({ band: 'NO_OPINION', reason: 'timeout' });
    expect(await c.service.verifyVoiceNote(null as unknown as VoiceNoteInput)).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
  });

  it('passes a verifier result through unchanged', async () => {
    const { service } = setup({ voice: { verifyVoiceNote: async () => MATCH } });
    expect(await service.verifyVoiceNote(input(), new AbortController().signal)).toBe(MATCH);
  });
});

describe('prompt outcomes and recalibration', () => {
  it('raises the threshold and mutes hints for 7 days on a false prompt', async () => {
    const { service, store, train, observe } = setup();
    const stream = personA(13, 60);
    await train(stream);
    const at = stream[59].at + MINUTE;
    expect(await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at, personalizationAllowed: true })).toEqual({ recorded: true });
    const row = (await store.get(KEY))!;
    expect(row.calibration.threshold).toBe(DEFAULT_THRESHOLD + THRESHOLD_STEP);
    expect(row.calibration.mutedUntil).toBe(at + FALSE_PROMPT_MUTE_MS);
    const own = personA(14, 2);
    expect((await observe(own[0].features, at + 3 * DAY_MS)).hint).toBeUndefined();
    expect((await observe(own[1].features, at + FALSE_PROMPT_MUTE_MS)).hint).toBeDefined();
  });

  it('keeps the threshold on a true prompt and keeps the session uncertain', async () => {
    const { service, store, train, observe } = setup();
    const stream = personA(15, 60);
    await train(stream);
    const impostor = session(personB(16, 6), stream[59].at + DAY_MS);
    let last;
    for (const m of impostor) last = await observe(m.features, m.at);
    expect(last?.hint?.consistency).toBe('uncertain');
    expect(await service.recordPromptOutcome({ ...KEY, outcome: 'someone_else', at: impostor[5].at, personalizationAllowed: true })).toEqual({ recorded: true });
    const row = (await store.get(KEY))!;
    expect(row.calibration.threshold).toBe(DEFAULT_THRESHOLD);
    expect(row.calibration.truePrompts).toBe(1);
    const own = personA(17, 1)[0];
    expect((await observe(own.features, impostor[5].at + MINUTE)).hint?.consistency).toBe('uncertain');
  });

  it('records nothing without consent or without a row', async () => {
    const { service, store } = setup();
    expect(await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at: 1, personalizationAllowed: true })).toEqual({ recorded: false });
    expect(await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at: 1, personalizationAllowed: false })).toEqual({ recorded: false });
    expect(await store.get(KEY)).toBeNull();
  });

  it('recalibrates with counts only and persists disabled', async () => {
    const { service, store, observe } = setup();
    const members = ['m-out', 'm1', 'm2', 'm3', 'm4', 'm5'];
    for (const personId of members) {
      const k = { ...KEY, personId };
      await observe(makeFeatures(), 1000, k);
      await store.update(k, current => current && {
        ...current,
        calibration: { ...current.calibration, sessions: personId === 'm-out' ? 20 : 50, falsePrompts: personId === 'm-out' ? 10 : 1 },
      });
    }
    const result = await service.recalibrate('persona-1', 2000);
    expect(Object.keys(result).sort()).toEqual(['disabled', 'gini']);
    expect(result.disabled).toBe(1);
    expect(result.gini).toBeGreaterThanOrEqual(0.4);
    expect((await store.get({ ...KEY, personId: 'm-out' }))!.calibration.disabled).toBe(true);
    expect((await store.get({ ...KEY, personId: 'm1' }))!.calibration.disabled).toBe(false);
  });
});

describe('assess', () => {
  it('delegates to the fusion with the configured weights', () => {
    const { service } = setup();
    expect(service.assess({ accountPersonId: 'member-a', verifiedRecently: false })).toEqual({ level: 'account', session: 'consistent', logOdds: 4, capped: false });
    expect(() => new StyleIdentityService({ store: new InMemoryStyleProfileStore(), weights: { priorAccount: 4, priorVerified: 5, voiceMatch: 1, voiceUncertain: -2, voiceNoMatch: -4.5, styleUncertain: -3.5 } }))
      .toThrow(RangeError);
  });
});
