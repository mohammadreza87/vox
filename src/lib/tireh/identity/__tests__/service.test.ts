import { describe, expect, it, vi } from 'vitest';
import { IdentityConfidenceService, type IdentityServiceOptions } from '../index';
import { DAY_MS, newProfile, observeProfile, PROFILE_RETENTION_MS, WEEK_MS, type StyleProfile } from '../profile';
import { styleVector } from '../style-features';
import { InMemoryStyleProfileStore, type StyleProfileStore } from '../store';
import { SESSION_IDLE_MS } from '../test';
import type { StyleFeatures } from '../types';
import type { VoiceNoteInput, VoiceNoteVerifier } from '../voice-band';
import { impostorFeatures, mulberry32, ownerFeatures } from './style-fixtures';

const T0 = Date.UTC(2026, 1, 2, 18, 0);
const PERSONA = 'persona-1';
const CANARY = 'S10L_IDENTITY_PRIVATE_TEXT_CANARY_7Q';

function hostileError() {
  const accessed = vi.fn(() => { throw new Error(CANARY); });
  const error = new Error('synthetic hostile error');
  for (const key of ['stack', 'message', 'name', 'cause', 'code', 'status', 'toJSON']) {
    Object.defineProperty(error, key, { configurable: true, get: accessed });
  }
  return { error, accessed };
}

function setup(options: Partial<IdentityServiceOptions> = {}) {
  const store = new InMemoryStyleProfileStore();
  const log = { warn: vi.fn() };
  const service = new IdentityConfidenceService({ store, log, ...options });
  return { store, log, service };
}

type Service = IdentityConfidenceService;
const observe = (service: Service, features: StyleFeatures, at: number, extra: { personId?: string; space?: 'work' | 'personal'; personaId?: string; allowed?: boolean } = {}) =>
  service.observeStyle({ personaId: extra.personaId ?? PERSONA, personId: extra.personId ?? 'alice', space: extra.space ?? 'work',
    features, at, personalizationAllowed: extra.allowed ?? true });
const enroll = (service: Service, at = T0, personId = 'alice', space: 'work' | 'personal' = 'work', allowed = true) =>
  service.enroll({ personId, space, kind: 'style_baseline', at, personalizationAllowed: allowed });

/** Feeds `count` owner messages in sessions of ten separated by an hour; returns the next free timestamp. */
async function baseline(service: Service, rng: () => number, count: number, start = T0 + 60_000, space: 'work' | 'personal' = 'work'): Promise<number> {
  let at = start;
  for (let i = 0; i < count; i++) {
    at = start + Math.floor(i / 10) * 3_600_000 + (i % 10) * 60_000;
    await observe(service, ownerFeatures(rng, at), at, { space });
  }
  return at + 3_600_000;
}

function trainedProfile(personId: string, falsePrompts: number, rng: () => number): StyleProfile {
  let p = newProfile(personId, 'work', 0, T0);
  for (let i = 0; i < 60; i++) p = observeProfile(p, styleVector(ownerFeatures(rng, T0)), T0 + i * 60_000);
  return { ...p, falsePrompts };
}

const voiceInput = (extra: Partial<VoiceNoteInput> = {}): VoiceNoteInput => ({
  personaId: PERSONA, personId: 'alice', space: 'work', chatKind: 'private', guestAudience: false,
  audio: new ArrayBuffer(16), mimeType: 'audio/ogg', durationSec: 6, channel: 'telegram_voice_note', ...extra,
});

describe('IdentityConfidenceService', () => {
  it('(a) stores nothing without an enrollment', async () => {
    const { store, service } = setup();
    const rng = mulberry32(1);
    expect(await observe(service, ownerFeatures(rng, T0), T0)).toEqual({ stored: false });
    expect(await store.get('alice', 'work')).toBeNull();
  });

  it('(b) enrolls only with the personalization decision, stamped with the consent epoch', async () => {
    const { store, service } = setup({ epochOf: () => 4 });
    expect(await enroll(service, T0, 'alice', 'work', false)).toEqual({ enrolled: false, reason: 'personalization_not_allowed' });
    expect(await store.get('alice', 'work')).toBeNull();
    expect(await enroll(service)).toEqual({ enrolled: true });
    expect(await store.get('alice', 'work')).toMatchObject({ purpose: 'optional.personalization', epoch: 4, messages: 0 });
    expect(await service.enroll({ personId: 'alice', space: 'work', kind: 'other' as 'style_baseline', at: T0, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
    expect(await service.enroll({ personId: '', space: 'work', kind: 'style_baseline', at: T0, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
    expect(await service.enroll({ personId: 'alice', space: 'work', kind: 'style_baseline', at: Number.NaN, personalizationAllowed: true }))
      .toEqual({ enrolled: false, reason: 'invalid_input' });
  });

  it('(c) deletes the profile when personalization is withdrawn', async () => {
    const { store, service } = setup();
    await enroll(service);
    await observe(service, ownerFeatures(mulberry32(2), T0), T0 + 1);
    expect(await store.get('alice', 'work')).not.toBeNull();
    expect(await observe(service, ownerFeatures(mulberry32(2), T0), T0 + 2, { allowed: false })).toEqual({ stored: false });
    expect(await store.get('alice', 'work')).toBeNull();
    expect(await observe(service, ownerFeatures(mulberry32(2), T0), T0 + 3)).toEqual({ stored: false });
    await enroll(service);
    expect(await enroll(service, T0, 'alice', 'work', false)).toMatchObject({ enrolled: false });
    expect(await store.get('alice', 'work')).toBeNull();
  });

  it('(d) deletes the profile on a consent-epoch bump and fails closed when the epoch is unavailable', async () => {
    let epoch: number | undefined = 1;
    const { store, service } = setup({ epochOf: () => epoch });
    await enroll(service);
    epoch = 2;
    expect(await observe(service, ownerFeatures(mulberry32(3), T0), T0 + 1)).toEqual({ stored: false });
    expect(await store.get('alice', 'work')).toBeNull();

    const failing = setup({ epochOf: () => { throw new Error(CANARY); } });
    await failing.store.put(newProfile('alice', 'work', 1, T0));
    expect(await observe(failing.service, ownerFeatures(mulberry32(3), T0), T0 + 1)).toEqual({ stored: false });
    expect((await failing.store.get('alice', 'work'))!.messages).toBe(0);
    expect(await enroll(failing.service)).toEqual({ enrolled: false, reason: 'epoch_unavailable' });
    const rejecting = setup({ epochOf: async () => { throw new Error(CANARY); } });
    expect(await enroll(rejecting.service)).toEqual({ enrolled: false, reason: 'epoch_unavailable' });
  });

  it('(e) gives no hint before 50 messages, then only from the fifth message of a session', async () => {
    const { service } = setup();
    const rng = mulberry32(4);
    await enroll(service);
    for (let i = 0; i < 50; i++) {
      const at = T0 + 60_000 + Math.floor(i / 10) * 3_600_000 + (i % 10) * 60_000;
      expect((await observe(service, ownerFeatures(rng, at), at)).hint).toBeUndefined();
    }
    const start = T0 + DAY_MS;
    const hints = [];
    for (let m = 0; m < 6; m++) hints.push((await observe(service, ownerFeatures(rng, start + m * 60_000), start + m * 60_000)).hint);
    expect(hints.slice(0, 4)).toEqual([undefined, undefined, undefined, undefined]);
    expect(hints[4]).toMatchObject({ source: 'style', messages: 5 });
    expect(hints[5]!.messages).toBeGreaterThanOrEqual(5);
    expect(Object.keys(hints[4]!).sort()).toEqual(['consistency', 'messages', 'source']);
  });

  it('(f) never trains the owner profile from a flagged session', async () => {
    const { store, service } = setup();
    const rng = mulberry32(5);
    await enroll(service);
    const start = await baseline(service, rng, 60);
    let flagged = false;
    let at = start;
    for (let m = 0; m < 8; m++) {
      at = start + m * 60_000;
      const result = await observe(service, impostorFeatures(rng, at), at);
      if (result.hint && result.hint.consistency !== 'consistent') flagged = true;
    }
    expect(flagged).toBe(true);
    const before = (await store.get('alice', 'work'))!;
    for (let m = 1; m <= 5; m++) await observe(service, impostorFeatures(rng, at + m * 60_000), at + m * 60_000);
    const after = (await store.get('alice', 'work'))!;
    expect(after.mean).toEqual(before.mean);
    expect(after.messages).toBe(before.messages);
  });

  it('(g) closes an idle session into the person\'s calibration scores', async () => {
    const { store, service } = setup();
    const rng = mulberry32(6);
    await enroll(service);
    const start = await baseline(service, rng, 50);
    for (let m = 0; m < 6; m++) await observe(service, ownerFeatures(rng, start + m * 60_000), start + m * 60_000);
    const before = (await store.get('alice', 'work'))!;
    const next = start + 5 * 60_000 + SESSION_IDLE_MS + 1;
    await observe(service, ownerFeatures(rng, next), next);
    const after = (await store.get('alice', 'work'))!;
    expect(after.selfScores.length).toBe(before.selfScores.length + 1);
    expect(after.sessions).toBe(before.sessions + 1);
  });

  it('(h) records prompt answers: confirmed self calibrates, another person pins the session', async () => {
    const { store, service } = setup();
    const rng = mulberry32(7);
    await enroll(service);
    const start = await baseline(service, rng, 50);
    for (let m = 0; m < 6; m++) await observe(service, ownerFeatures(rng, start + m * 60_000), start + m * 60_000);
    const before = (await store.get('alice', 'work'))!;
    await service.recordPromptOutcome({ personaId: PERSONA, personId: 'alice', space: 'work', outcome: 'confirmed_self', at: start + 6 * 60_000 });
    const confirmed = (await store.get('alice', 'work'))!;
    expect(confirmed.falsePrompts).toBe(before.falsePrompts + 1);
    expect(confirmed.selfScores.length).toBe(before.selfScores.length + 1);
    expect((await observe(service, ownerFeatures(rng, start + 7 * 60_000), start + 7 * 60_000)).hint).toBeUndefined();

    let at = start + 8 * 60_000;
    for (let m = 0; m < 5; m++, at += 60_000) await observe(service, ownerFeatures(rng, at), at);
    await service.recordPromptOutcome({ personaId: PERSONA, personId: 'alice', space: 'work', outcome: 'other_person', at });
    const pinned = (await store.get('alice', 'work'))!;
    const result = await observe(service, ownerFeatures(rng, at + 60_000), at + 60_000);
    expect(result.hint?.consistency).toBe('inconsistent');
    const after = (await store.get('alice', 'work'))!;
    expect(after.mean).toEqual(pinned.mean);
    expect(after.messages).toBe(pinned.messages);
    expect(after.falsePrompts).toBe(pinned.falsePrompts);
  });

  it('(i) disables the outlier by fairness and re-enables it on re-enrollment', async () => {
    const { store, service } = setup();
    const rng = mulberry32(8);
    for (const [id, prompts] of [['m1', 0], ['m2', 0], ['m3', 0], ['m4', 0], ['m5', 12]] as const) await store.put(trainedProfile(id, prompts, rng));
    expect(await service.applyFairness('work', T0 + 4 * WEEK_MS)).toBe(1);
    const outlier = (await store.get('m5', 'work'))!;
    expect(outlier).toMatchObject({ disabled: true });
    expect(['gini', 'budget']).toContain(outlier.disabledReason);
    expect((await store.get('m1', 'work'))!.disabled).toBe(false);
    const start = T0 + 5 * WEEK_MS;
    for (let m = 0; m < 8; m++) {
      const result = await observe(service, ownerFeatures(rng, start + m * 60_000), start + m * 60_000, { personId: 'm5' });
      expect(result.hint).toBeUndefined();
    }
    expect(await enroll(service, start + DAY_MS, 'm5')).toEqual({ enrolled: true });
    expect(await store.get('m5', 'work')).toMatchObject({ disabled: false, messages: 0 });
  });

  it('(j) verifies voice notes only in 1:1 chats without guests, through the injected verifier', async () => {
    const delegate = { verifyVoiceNote: vi.fn<VoiceNoteVerifier['verifyVoiceNote']>() };
    delegate.verifyVoiceNote.mockResolvedValue({ band: 'MATCH', netSpeechMs: 5000, modelVersion: 'fake-1' });
    const { service, log } = setup({ voice: delegate });
    expect(await service.verifyVoiceNote(voiceInput({ chatKind: 'group' }))).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
    expect(await service.verifyVoiceNote(voiceInput({ guestAudience: true }))).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
    expect(delegate.verifyVoiceNote).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    expect(await service.verifyVoiceNote(voiceInput(), controller.signal)).toEqual({ band: 'NO_OPINION', reason: 'timeout' });
    expect(delegate.verifyVoiceNote).not.toHaveBeenCalled();
    expect(await service.verifyVoiceNote(voiceInput())).toEqual({ band: 'MATCH', netSpeechMs: 5000, modelVersion: 'fake-1' });
    expect(delegate.verifyVoiceNote).toHaveBeenCalledTimes(1);

    expect(await setup().service.verifyVoiceNote(voiceInput())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });

    const { error, accessed } = hostileError();
    const throwing = setup({ voice: { verifyVoiceNote: vi.fn().mockRejectedValue(error) } });
    expect(await throwing.service.verifyVoiceNote(voiceInput())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
    expect(throwing.log.warn.mock.calls).toEqual([['identity_voice_unavailable']]);
    expect(accessed).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('(k) never throws or leaks when the store fails with hostile errors', async () => {
    const { error, accessed } = hostileError();
    const failing: StyleProfileStore = {
      get: vi.fn().mockRejectedValue(error), put: vi.fn().mockRejectedValue(error), delete: vi.fn().mockRejectedValue(error),
      deleteAllFor: vi.fn().mockRejectedValue(error), list: vi.fn().mockRejectedValue(error), sweep: vi.fn().mockRejectedValue(error),
    };
    const log = { warn: vi.fn() };
    const service = new IdentityConfidenceService({ store: failing, log });
    const features = ownerFeatures(mulberry32(9), T0);
    expect(await observe(service, features, T0)).toEqual({ stored: false });
    expect(await observe(service, features, T0, { allowed: false })).toEqual({ stored: false });
    expect(await enroll(service)).toEqual({ enrolled: false, reason: 'store_unavailable' });
    expect(await enroll(service, T0, 'alice', 'work', false)).toEqual({ enrolled: false, reason: 'personalization_not_allowed' });
    await expect(service.recordPromptOutcome({ personaId: PERSONA, personId: 'alice', space: 'work', outcome: 'confirmed_self', at: T0 })).resolves.toBeUndefined();
    expect(await service.applyFairness('work', T0)).toBe(0);
    expect(await service.sweep(T0)).toBe(0);
    await expect(service.forget('alice')).rejects.toThrow(/^identity_forget_failed$/);
    expect(log.warn.mock.calls.length).toBeGreaterThan(0);
    for (const call of log.warn.mock.calls) {
      expect(call).toHaveLength(1);
      expect(['identity_style_store_unavailable', 'identity_voice_unavailable']).toContain(call[0]);
    }
    expect(accessed).not.toHaveBeenCalled();
  });

  it('(l) keeps work and personal profiles of one person apart', async () => {
    const { store, service } = setup();
    const rng = mulberry32(10);
    await enroll(service, T0, 'alice', 'work');
    await enroll(service, T0, 'alice', 'personal');
    const personal = await store.get('alice', 'personal');
    await baseline(service, rng, 20, T0 + 60_000, 'work');
    expect(await store.get('alice', 'personal')).toEqual(personal);
    expect((await store.get('alice', 'work'))!.messages).toBe(20);
  });

  it('(m) forgets both spaces and sweeps profiles idle for 180 days', async () => {
    const { store, service } = setup();
    await enroll(service, T0, 'alice', 'work');
    await enroll(service, T0, 'alice', 'personal');
    await enroll(service, T0 + 100 * DAY_MS, 'bob', 'work');
    await service.forget('alice');
    expect(await store.get('alice', 'work')).toBeNull();
    expect(await store.get('alice', 'personal')).toBeNull();
    await enroll(service, T0, 'carol', 'work');
    await service.forget('carol', 'work');
    expect(await store.get('carol', 'work')).toBeNull();
    await enroll(service, T0, 'dave', 'personal');
    expect(await service.sweep(T0 + PROFILE_RETENTION_MS + 1)).toBe(1);
    expect(await store.get('dave', 'personal')).toBeNull();
    expect(await store.get('bob', 'work')).not.toBeNull();
  });

  it('rejects malformed features and timestamps without storing', async () => {
    const { store, service } = setup();
    await enroll(service);
    const features = ownerFeatures(mulberry32(11), T0);
    expect(await observe(service, { ...features, text: CANARY } as unknown as StyleFeatures, T0 + 1)).toEqual({ stored: false });
    expect(await observe(service, features, Number.NaN)).toEqual({ stored: false });
    expect(await observe(service, features, T0 + 1, { personaId: '' })).toEqual({ stored: false });
    expect((await store.get('alice', 'work'))!.messages).toBe(0);
  });

  it('assesses through the capped fusion', () => {
    const { service } = setup();
    expect(service.assess({ accountPersonId: 'alice', verifiedRecently: false, style: { source: 'style', consistency: 'uncertain', messages: 6 } }))
      .toEqual({ level: 'unverified', session: 'uncertain', logOdds: 1, capped: false });
  });
});
