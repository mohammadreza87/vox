/**
 * Main-lineage service cases (S10L, earlier run 83848b7, service.test.ts)
 * ported onto the chosen wave A implementation (aiq/identity-lib b34b7c0).
 * API renames: StyleIdentityService -> IdentityConfidenceService,
 * forgetPerson(personId) -> forget(personId), store.get(key) ->
 * store.get(personId, space). Wave A creates a profile only on enroll() and
 * logs fixed string codes, so cases are adapted to that. Assertions that
 * contradict wave A, or need an API wave A does not have, are listed by case
 * name in docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { IdentityConfidenceService, type IdentityServiceOptions } from '../index';
import { InMemoryStyleProfileStore, type StyleProfileStore } from '../store';
import { extractStyleFeatures } from '../style-features';
import type { IdentityService, StyleFeatures } from '../types';
import type { VoiceNoteInput, VoiceNoteVerifier, VoiceVerification } from '../voice-band';

const T0 = Date.UTC(2026, 9, 1, 18, 0);
const KEY = { personaId: 'persona-1', personId: 'member-a', space: 'work' as const };
const MINUTE = 60_000;
const features = (at = T0): StyleFeatures => extractStyleFeatures({ kind: 'text', text: 'salam, chetori? :)', edited: false, at });

function setup(options: Partial<IdentityServiceOptions> = {}) {
  const store = new InMemoryStyleProfileStore();
  const log = { warn: vi.fn() };
  const service = new IdentityConfidenceService({ store, log, ...options });
  const observe = (f: StyleFeatures, at: number, key: { personaId: string; personId: string; space: 'work' | 'personal' } = KEY, personalizationAllowed = true) =>
    service.observeStyle({ ...key, features: f, at, personalizationAllowed });
  const enroll = (personalizationAllowed: boolean, at = T0, personId = KEY.personId, space: 'work' | 'personal' = KEY.space) =>
    service.enroll({ personId, space, kind: 'style_baseline', at, personalizationAllowed });
  return { store, log, service, observe, enroll };
}

describe('main-lineage: IdentityConfidenceService.observeStyle', () => {
  it('implements the IdentityService contract', () => {
    const service: IdentityService = new IdentityConfidenceService({ store: new InMemoryStyleProfileStore() });
    expect(typeof service.observeStyle).toBe('function');
  });

  it('stores nothing without personalization consent and deletes existing rows', async () => {
    const { store, observe, enroll } = setup();
    expect(await observe(features(), T0, KEY, false)).toEqual({ stored: false });
    expect(await store.get(KEY.personId, KEY.space)).toBeNull();
    expect(await enroll(true)).toEqual({ enrolled: true });
    expect((await observe(features(), T0 + MINUTE)).stored).toBe(true);
    expect(await store.get(KEY.personId, KEY.space)).not.toBeNull();
    expect(await observe(features(), T0 + 2 * MINUTE, KEY, false)).toEqual({ stored: false });
    expect(await store.get(KEY.personId, KEY.space)).toBeNull();
  });

  it('discards statistics on an epoch bump', async () => {
    let epoch = 0;
    const { observe, store, enroll } = setup({ epochOf: async () => epoch });
    await enroll(true);
    for (let i = 1; i <= 5; i++) await observe(features(), T0 + i * MINUTE);
    expect((await store.get(KEY.personId, KEY.space))?.messages).toBe(5);
    epoch = 1;
    expect(await observe(features(), T0 + 10 * MINUTE)).toEqual({ stored: false });
    expect(await store.get(KEY.personId, KEY.space)).toBeNull();
  });

  it('rejects invalid features without touching the store', async () => {
    const { observe, store, enroll } = setup();
    await enroll(true);
    const spies = [vi.spyOn(store, 'put'), vi.spyOn(store, 'get'), vi.spyOn(store, 'delete')];
    const bad = { ...features(), raw: 'secret' } as unknown as StyleFeatures;
    expect(await observe(bad, T0 + MINUTE)).toEqual({ stored: false });
    expect(await observe(features(), Number.NaN)).toEqual({ stored: false });
    expect(await observe(features(), T0 + MINUTE, { ...KEY, personId: '' })).toEqual({ stored: false });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('never rejects when the store throws', async () => {
    const down = async () => { throw new Error('down'); };
    const failing: StyleProfileStore = { get: down, put: down, delete: down, deleteAllFor: down, list: down, sweep: down };
    const log = { warn: vi.fn() };
    const service = new IdentityConfidenceService({ store: failing, log });
    await expect(service.observeStyle({ ...KEY, features: features(), at: T0, personalizationAllowed: true })).resolves.toEqual({ stored: false });
    await expect(service.observeStyle({ ...KEY, features: features(), at: T0, personalizationAllowed: false })).resolves.toEqual({ stored: false });
    await expect(service.enroll({ personId: 'member-a', space: 'work', kind: 'style_baseline', at: T0, personalizationAllowed: true }))
      .resolves.toEqual({ enrolled: false, reason: 'store_unavailable' });
    await expect(service.recordPromptOutcome({ ...KEY, outcome: 'other_person', at: T0 })).resolves.toBeUndefined();
    await expect(service.applyFairness('work', T0)).resolves.toBe(0);
    await expect(service.forget('member-a')).rejects.toThrow('identity_forget_failed');
    expect(log.warn.mock.calls.length).toBeGreaterThan(0);
    expect(log.warn.mock.calls.every(call => call.length === 1 && call[0] === 'identity_style_store_unavailable')).toBe(true);
  });

  it('forgets a person across both spaces, rows only for that person', async () => {
    const { observe, service, store, enroll } = setup();
    for (const [personId, space] of [['member-a', 'work'], ['member-a', 'personal'], ['member-b', 'work']] as const) {
      await enroll(true, T0, personId, space);
      await observe(features(), T0 + MINUTE, { ...KEY, personId, space });
    }
    await service.forget('member-a');
    expect(await store.get('member-a', 'work')).toBeNull();
    expect(await store.get('member-a', 'personal')).toBeNull();
    expect(await store.get('member-b', 'work')).not.toBeNull();
  });
});

describe('main-lineage: IdentityConfidenceService.enroll', () => {
  it('refuses and deletes rows without consent', async () => {
    const { enroll, store } = setup();
    await enroll(true);
    await enroll(true, T0, KEY.personId, 'personal');
    expect(await enroll(false)).toEqual({ enrolled: false, reason: 'personalization_not_allowed' });
    expect(await store.get(KEY.personId, 'work')).toBeNull();
    expect(await store.get(KEY.personId, 'personal')).not.toBeNull();
  });

  it('is idempotent and resets statistics', async () => {
    const { enroll, store, observe } = setup();
    await enroll(true);
    for (let i = 1; i <= 5; i++) await observe(features(), T0 + i * MINUTE);
    expect(await enroll(true, T0 + 10 * MINUTE)).toEqual({ enrolled: true });
    const once = (await store.get(KEY.personId, KEY.space))!;
    expect(await enroll(true, T0 + 10 * MINUTE)).toEqual({ enrolled: true });
    expect(await store.get(KEY.personId, KEY.space)).toEqual(once);
    expect(once.messages).toBe(0);
  });

  it('validates input', async () => {
    const { service } = setup();
    expect(await service.enroll({ personId: '', space: 'work', kind: 'style_baseline', at: 1, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
    expect(await service.enroll({ personId: 'a', space: 'work', kind: 'voice' as 'style_baseline', at: 1, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
    expect(await service.enroll({ personId: 'a', space: 'work', kind: 'style_baseline', at: Number.POSITIVE_INFINITY, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
  });
});

describe('main-lineage: IdentityConfidenceService.verifyVoiceNote', () => {
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

  it('maps verifier failures and a pre-aborted signal, and never rejects', async () => {
    const throwing: VoiceNoteVerifier = { verifyVoiceNote: async () => { throw new Error('provider down'); } };
    const sync: VoiceNoteVerifier = { verifyVoiceNote: () => { throw new Error('sync'); } };
    const a = setup({ voice: throwing });
    expect(await a.service.verifyVoiceNote(input())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
    expect(a.log.warn.mock.calls).toEqual([['identity_voice_unavailable']]);
    expect(await setup({ voice: sync }).service.verifyVoiceNote(input())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });

    const pre = new AbortController(); pre.abort();
    const verify = vi.fn(async () => MATCH);
    const b = setup({ voice: { verifyVoiceNote: verify } });
    expect(await b.service.verifyVoiceNote(input(), pre.signal)).toEqual({ band: 'NO_OPINION', reason: 'timeout' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('passes a verifier result through unchanged', async () => {
    const { service } = setup({ voice: { verifyVoiceNote: async () => MATCH } });
    expect(await service.verifyVoiceNote(input(), new AbortController().signal)).toBe(MATCH);
  });
});

describe('main-lineage: prompt outcomes', () => {
  it('records nothing without a row', async () => {
    const { service, store } = setup();
    await service.recordPromptOutcome({ ...KEY, outcome: 'confirmed_self', at: T0 });
    expect(await store.get(KEY.personId, KEY.space)).toBeNull();
  });
});
