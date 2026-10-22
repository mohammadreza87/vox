import { describe, expect, it, vi } from 'vitest';
import { bandFor, parseVoiceThresholds, resolveThresholds, type VoiceThresholdConfig } from '../identity/config';
import { grossTooShort, meetsNetSpeech, netSpeechFromSegments } from '../identity/net-speech';
import { PersonaVoiceEchoSource, SELF_ECHO_PHRASES } from '../identity/self-echo';
import { MAX_TEMPLATE_AGE_MS } from '../identity/voice';
import { AUDIO_CANARY, FakeVoiceprintProvider, setupVoiceprints, TEMPLATE_CANARY } from './voiceprint-fixtures';

const T = { match: 0.8, noMatch: 0.4, selfEcho: 0.7 };

describe('band mapping and thresholds', () => {
  it.each([[0.85, 'MATCH'], [0.8, 'MATCH'], [0.79, 'UNCERTAIN'], [0.41, 'UNCERTAIN'], [0.4, 'UNCERTAIN'], [0.39, 'NO_MATCH'], [Number.NaN, 'NO_MATCH']])(
    'score %s maps to %s', (score, band) => { expect(bandFor(score, T)).toBe(band); });

  it('resolves per-org and per-channel overrides and re-validates the merge', () => {
    const cfg: VoiceThresholdConfig = {
      default: { match: 0.8, noMatch: 0.4, selfEcho: 0.7, channels: { mini_app: { match: 0.9 } } },
      orgs: { HOOR: { match: 0.75, noMatch: 0.3, selfEcho: 0.6, channels: { telegram_voice_note: { noMatch: 0.35 } } }, Broken: { match: 0.8, noMatch: 0.4, selfEcho: 0.7, channels: { mini_app: { noMatch: 0.9 } } } },
    };
    expect(resolveThresholds(cfg, 'HOOR', 'telegram_voice_note')).toEqual({ match: 0.75, noMatch: 0.35, selfEcho: 0.6 });
    expect(resolveThresholds(cfg, 'HOOR', 'mini_app')).toEqual({ match: 0.75, noMatch: 0.3, selfEcho: 0.6 });
    expect(resolveThresholds(cfg, 'Other', 'mini_app')).toEqual({ match: 0.9, noMatch: 0.4, selfEcho: 0.7 });
    expect(resolveThresholds(cfg, 'Other', 'telegram_voice_note')).toEqual({ match: 0.8, noMatch: 0.4, selfEcho: 0.7 });
    expect(resolveThresholds(cfg, 'Broken', 'mini_app')).toBeNull();
    expect(resolveThresholds({ orgs: { HOOR: T } }, 'Other', 'mini_app')).toBeNull();
    expect(resolveThresholds(null, 'HOOR', 'mini_app')).toBeNull();
    expect(resolveThresholds(cfg, 'constructor', 'mini_app')).toEqual({ match: 0.9, noMatch: 0.4, selfEcho: 0.7 });
  });

  it('parses only valid JSON that matches the strict schema and never throws', () => {
    expect(parseVoiceThresholds(JSON.stringify({ default: T }))).toEqual({ default: T });
    for (const raw of [undefined, '', '   ', '{', '[]', JSON.stringify({ default: { match: 0.4, noMatch: 0.8, selfEcho: 0.7 } }),
      JSON.stringify({ default: { ...T, selfEcho: 0 } }), JSON.stringify({ default: { ...T, match: 1.2 } }), JSON.stringify({ default: T, extra: 1 }),
      JSON.stringify({ default: { ...T, channels: { email: {} } } })]) {
      expect(parseVoiceThresholds(raw)).toBeNull();
    }
  });

  it('an invalid or schema-failing configuration makes verify return disabled', async () => {
    const s = await setupVoiceprints({ thresholds: parseVoiceThresholds('{"default":{"match":2}}') });
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
    expect(s.provider.identify).not.toHaveBeenCalled();
  });

  it('verify returns the band for the owner score with the per-org thresholds', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.identify.mockClear();
    s.provider.scores.set('owner', 0.6);
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'UNCERTAIN', netSpeechMs: 12_000, modelVersion: 'fake-vp:1' });
    s.provider.scores.set('owner', 0.1);
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_MATCH', netSpeechMs: 12_000, modelVersion: 'fake-vp:1' });
    const ownerCalls = s.provider.identifyCalls.filter(c => c.labels.includes('owner'));
    expect(ownerCalls.every(c => c.labels.length === 1 && c.templates[0] === TEMPLATE_CANARY)).toBe(true);
  });
});

describe('net-speech guard', () => {
  it('pure helpers', () => {
    expect(grossTooShort(2.9)).toBe(true);
    expect(grossTooShort(3)).toBe(false);
    expect(grossTooShort(undefined)).toBe(false);
    expect(grossTooShort(Number.NaN)).toBe(false);
    expect(netSpeechFromSegments([{ start: 0, end: 2 }, { start: 1, end: 3 }, { start: 5, end: 6.5 }])).toBe(4500);
    expect(netSpeechFromSegments([{ start: -1, end: 2 }, { start: Number.NaN, end: 4 }, { start: 3, end: 2 }])).toBe(0);
    expect(meetsNetSpeech(2999)).toBe(false);
    expect(meetsNetSpeech(3000)).toBe(true);
    expect(meetsNetSpeech(9999, 10_000)).toBe(false);
  });

  it('durationSec 2.9 is too_short with no provider, speech or store contact', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.identify.mockClear(); s.speech.measure.mockClear();
    const get = vi.spyOn(s.store, 'get');
    expect(await s.service.verifyVoiceNote(s.voiceNote({ durationSec: 2.9 }))).toEqual({ band: 'NO_OPINION', reason: 'too_short' });
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('measured 2999 ms is too_short with netSpeechMs; 3000 ms gives a band', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.speech.result = { netSpeechMs: 2999, speakers: 1 };
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'too_short', netSpeechMs: 2999 });
    s.speech.result = { netSpeechMs: 3000, speakers: 1 };
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'MATCH', netSpeechMs: 3000, modelVersion: 'fake-vp:1' });
  });
});

describe('self-echo guard', () => {
  it('an echo score at selfEcho gives self_echo even when the owner score is a MATCH', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.scores.set('owner', 0.95);
    s.provider.scores.set('echo-0', 0.7);
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'self_echo', netSpeechMs: 12_000 });
  });

  it('an echo source that is not ready gives provider_error', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.selfEcho.list = null;
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
  });

  it('echo ids are opaque, batched at 50, and no label contains a person id', async () => {
    const s = await setupVoiceprints();
    s.selfEcho.list = Array.from({ length: 51 }, (_, n) => ({ id: `echo-${n}`, template: new TextEncoder().encode(`ECHO_${n}`) }));
    await s.enroll();
    await s.service.verifyVoiceNote(s.voiceNote());
    const echoCalls = s.provider.identifyCalls.filter(c => c.labels.every(l => l.startsWith('echo-')));
    expect(echoCalls.map(c => c.labels.length)).toEqual([50, 1, 50, 1]);
    expect(s.provider.labelsContainPersonIds()).toBe(false);
    expect(s.provider.identifyCalls.flatMap(c => c.labels).every(l => l === 'owner' || /^echo-\d+$/.test(l))).toBe(true);
  });
});

describe('PersonaVoiceEchoSource', () => {
  it('fails closed until every voice is cached, warms single-flight and keeps failed voices uncached', async () => {
    const provider = new FakeVoiceprintProvider();
    let voices = ['voice-a', 'voice-b'];
    const synthesize = vi.fn(async (text: string, voiceId: string) => {
      if (voiceId === 'voice-bad') throw new Error('tts down');
      return new TextEncoder().encode(`${voiceId}:${text.length}`);
    });
    const source = new PersonaVoiceEchoSource({ voiceIds: async () => voices, synthesize, provider });
    const signal = new AbortController().signal;
    expect(await source.templates(signal)).toBeNull();
    await source.warm();
    await source.warm();
    expect(synthesize).toHaveBeenCalledTimes(2 * SELF_ECHO_PHRASES.length);
    expect(synthesize.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining([...SELF_ECHO_PHRASES]));
    const list = await source.templates(signal);
    expect(list?.map(e => e.id)).toEqual(['echo-0', 'echo-1', 'echo-2', 'echo-3']);
    voices = ['voice-a', 'voice-bad'];
    expect(await source.templates(signal)).toBeNull();
    await source.warm();
    expect(await source.templates(signal)).toBeNull();
    voices = [];
    expect(await source.templates(signal)).toEqual([]);
    provider.modelVersion = 'fake-vp:2';
    voices = ['voice-a'];
    expect(await source.templates(signal)).toBeNull();
  });
});

describe('verification failure paths', () => {
  it('a throwing provider gives provider_error and verifyVoiceNote never rejects', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.mode = 'throw';
    await expect(s.service.verifyVoiceNote(s.voiceNote())).resolves.toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
    expect(s.logger.warn).toHaveBeenCalledWith('voiceprint_provider_error');
    const broken = await setupVoiceprints({ service: { eligiblePerson: async () => { throw new Error('state unavailable'); } } });
    await expect(broken.service.verifyVoiceNote(broken.voiceNote())).resolves.toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
  });

  it('a deadline exceeded gives timeout', async () => {
    const s = await setupVoiceprints({ service: { verifyDeadlineMs: 20 } });
    await s.enroll();
    s.provider.mode = 'hang';
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'timeout' });
    const aborted = new AbortController();
    aborted.abort();
    s.provider.mode = 'ok';
    expect(await s.service.verifyVoiceNote(s.voiceNote(), aborted.signal)).toEqual({ band: 'NO_OPINION', reason: 'timeout' });
  });

  it('a missing agent grant gives consent_missing; no row gives not_enrolled', async () => {
    const s = await setupVoiceprints({ agent: false });
    await s.enroll();
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
    expect(s.provider.identifyCalls.some(c => c.labels.includes('owner'))).toBe(false);
    const t = await setupVoiceprints();
    expect(await t.service.verifyVoiceNote(t.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
    expect(await t.service.verifyVoiceNote(t.voiceNote({ personId: 'reza' }))).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
  });

  it('an old model version or a template older than 365 days is not_enrolled', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.modelVersion = 'fake-vp:2';
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
    s.provider.modelVersion = 'fake-vp:1';
    const row = (await s.store.get(s.personId, 'work'))!;
    await s.store.put({ ...row, createdAt: new Date(s.now() - MAX_TEMPLATE_AGE_MS - 1) });
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
  });

  it('a template sealed under another key is provider_error', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    const row = (await s.store.get(s.personId, 'work'))!;
    const parts = row.template.split('.');
    await s.store.put({ ...row, template: [parts[0], '0000000000000000', ...parts.slice(2)].join('.') });
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
  });

  it('MATCH updates only lastConfirmedAt', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    const before = (await s.store.get(s.personId, 'work'))!;
    s.setNow(s.now() + 60_000);
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toMatchObject({ band: 'MATCH' });
    const after = (await s.store.get(s.personId, 'work'))!;
    expect(after).toEqual({ ...before, lastConfirmedAt: new Date(s.now()) });
    s.provider.scores.set('owner', 0.5);
    s.setNow(s.now() + 60_000);
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toMatchObject({ band: 'UNCERTAIN' });
    expect((await s.store.get(s.personId, 'work'))!.lastConfirmedAt).toEqual(after.lastConfirmedAt);
  });

  it('input.audio is byte-identical before and after verify', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    const note = s.voiceNote();
    const copy = new Uint8Array(note.audio.slice(0));
    await s.service.verifyVoiceNote(note);
    expect(new Uint8Array(note.audio)).toEqual(copy);
    expect(Array.from(new Uint8Array(note.audio))).toEqual(Array.from(AUDIO_CANARY));
  });

  it('the flag off returns disabled without touching audio, store or provider', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '');
    s.provider.identify.mockClear();
    const get = vi.spyOn(s.store, 'get');
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
    expect(get).not.toHaveBeenCalled();
    expect(s.provider.identify).not.toHaveBeenCalled();
  });

  it('the internal-pilot manifest returns disabled', async () => {
    const s = await setupVoiceprints({ pilot: true });
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
  });
});
