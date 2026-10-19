import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElevenLabsSpeechError, ElevenLabsStudio, StudioVoiceService, voiceAgentBody } from '../media';

const XI = 'https://api.elevenlabs.io';
const models = [
  { model_id: 'eleven_v4', name: 'Eleven v4', can_do_text_to_speech: true, languages: [{ language_id: 'fa', name: 'Persian' }, { language_id: 'en', name: 'English' }] },
  { model_id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo', can_do_text_to_speech: true, languages: [{ language_id: 'fa', name: 'Persian' }] },
  { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', can_do_text_to_speech: true, languages: [{ language_id: 'en', name: 'English' }] },
  { model_id: 'scribe_v1', name: 'Scribe', can_do_text_to_speech: false },
  { model_id: 'eleven_ttv_v3', name: 'Voice Design', can_do_text_to_speech: false },
];
const defaultVoice = { voice_id: 'provider-default', name: 'Provider default', labels: { gender: 'female', accent: 'american', language: 'en' }, preview_url: 'https://example.test/default.mp3' };

function catalogue(tier: unknown = 'free') {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/models') return Response.json(models);
    if (url.pathname === '/v1/user/subscription') return Response.json({ tier });
    if (url.pathname === '/v2/voices') return Response.json({ voices: [defaultVoice], has_more: false });
    throw new Error('Unexpected request');
  });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('ElevenLabs voice choices', () => {
  it('reads provider models, subscription and defaults without creating or adding voices', async () => {
    const fetchFn = catalogue();
    const xi = new ElevenLabsStudio('synthetic-secret', fetchFn, 'eleven_v4');
    const result = await xi.getVoiceOptions();
    expect(result).toMatchObject({ tier: 'free', libraryAllowed: false, ttsModel: 'eleven_v4' });
    expect(result.models).toEqual([
      { id: 'eleven_v4', name: 'Eleven v4', languages: [{ code: 'fa', name: 'Persian' }, { code: 'en', name: 'English' }], persian: true, kind: 'quality' },
      { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo', languages: [{ code: 'fa', name: 'Persian' }], persian: true, kind: 'realtime' },
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2', languages: [{ code: 'en', name: 'English' }], persian: false, kind: 'legacy' },
    ]);
    expect(result.defaultVoices).toEqual([{ voiceId: 'provider-default', name: 'Provider default', gender: 'female', accent: 'american', language: 'en', previewUrl: 'https://example.test/default.mp3' }]);
    expect(fetchFn.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      `${XI}/v1/models`, `${XI}/v1/user/subscription`, `${XI}/v2/voices?voice_type=default&page_size=100`,
    ]));
    for (const [, init] of fetchFn.mock.calls) {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });

  it('coalesces concurrent requests and caches isolated copies for sixty seconds', async () => {
    vi.useFakeTimers();
    const fetchFn = catalogue('creator');
    const xi = new ElevenLabsStudio('k', fetchFn);
    const [first, concurrent] = await Promise.all([xi.getVoiceOptions(), xi.getVoiceOptions()]);
    expect(first.libraryAllowed).toBe(true);
    expect(concurrent).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    first.defaultVoices.length = 0;
    concurrent.models[0].languages.length = 0;
    const cached = await xi.getVoiceOptions();
    expect(cached.defaultVoices).toHaveLength(1);
    expect(cached.models[0].languages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(59_999);
    await xi.getVoiceOptions();
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await xi.getVoiceOptions();
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it.each([undefined, '', 'unrecognized-plan'])('does not infer paid access from an unknown tier %s', async (tier) => {
    const fetchFn = catalogue(tier === undefined ? null : tier);
    const result = await new ElevenLabsStudio('k', fetchFn).getVoiceOptions();
    expect(result.libraryAllowed).toBe(false);
  });

  it('fails closed on a subscription refusal while retaining verified default choices', async () => {
    const fetchFn = catalogue();
    const original = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation((input, init) => String(input).endsWith('/user/subscription')
      ? Promise.resolve(Response.json({ detail: { message: 'private billing details' } }, { status: 403 }))
      : original(input, init));
    const result = await new ElevenLabsStudio('k', fetchFn).getVoiceOptions();
    expect(result).toMatchObject({ tier: 'unknown', libraryAllowed: false });
    expect(result.defaultVoices[0].voiceId).toBe('provider-default');
    expect(JSON.stringify(result)).not.toContain('private billing');
  });

  it('follows default catalogue cursors, preserving the default-only filter', async () => {
    const fetchFn = catalogue();
    const original = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation((input, init) => {
      const url = new URL(String(input));
      if (url.pathname !== '/v2/voices') return original(input, init);
      expect(url.searchParams.get('voice_type')).toBe('default');
      return Promise.resolve(Response.json(url.searchParams.has('next_page_token')
        ? { voices: [{ voice_id: 'second', name: 'Second' }], has_more: false }
        : { voices: [defaultVoice], has_more: true, next_page_token: 'next/page' }));
    });
    expect((await new ElevenLabsStudio('k', fetchFn).getVoiceOptions()).defaultVoices.map((v) => v.voiceId)).toEqual(['provider-default', 'second']);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('rejects malformed catalogue responses and can retry after a failed load', async () => {
    const fetchFn = catalogue();
    const original = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation((input, init) => String(input).endsWith('/models')
      ? Promise.resolve(Response.json({ unexpected: 'payload' })) : original(input, init));
    const xi = new ElevenLabsStudio('k', fetchFn);
    await expect(xi.getVoiceOptions()).rejects.toMatchObject({ code: 'provider_error', status: 502 });
    fetchFn.mockImplementation(original);
    expect((await xi.getVoiceOptions()).defaultVoices).toHaveLength(1);
  });

  it('stops after ten default-voice pages when the provider keeps returning new cursors', async () => {
    const fetchFn = catalogue();
    const original = fetchFn.getMockImplementation()!;
    let pages = 0;
    fetchFn.mockImplementation((input, init) => new URL(String(input)).pathname === '/v2/voices'
      ? Promise.resolve(Response.json({ voices: [defaultVoice], has_more: true, next_page_token: `page-${++pages}` }))
      : original(input, init));
    await expect(new ElevenLabsStudio('k', fetchFn).getVoiceOptions()).rejects.toMatchObject({ code: 'provider_error', status: 502 });
    expect(pages).toBe(10);
    expect(fetchFn).toHaveBeenCalledTimes(12);
  });

  it('maps language assessments, access and price metadata without claiming native verification', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ voices: [{
      voice_id: 'fa-library', public_owner_id: 'owner', name: 'Persian candidate', language: 'fa', category: 'professional',
      description: 'Native Persian', rate: 1.5, free_users_allowed: false,
      verified_languages: [{ language: 'fa', model_id: 'eleven_v4', accent: 'standard', locale: 'fa-IR', preview_url: 'https://example.test/fa.mp3' }],
    }] }));
    const result = await new ElevenLabsStudio('k', fetchFn).searchLibrary({ language: 'fa', category: 'professional' });
    const search = new URL(String(fetchFn.mock.calls[0][0]));
    expect(search.searchParams.get('language')).toBe('fa');
    expect(search.searchParams.get('category')).toBe('professional');
    expect(result[0]).toMatchObject({ language: 'fa', category: 'professional', description: 'Native Persian', rate: 1.5, freeUsersAllowed: false,
      verifiedLanguages: [{ language: 'fa', modelId: 'eleven_v4', accent: 'standard', locale: 'fa-IR', previewUrl: 'https://example.test/fa.mp3' }] });
  });
});

describe('sanitized ElevenLabs speech failures', () => {
  it('recognizes errors across module boundaries while rebuilding only a fixed public message', () => {
    class OtherBundleError extends Error {
      readonly name = 'ElevenLabsSpeechError';
      readonly status = 402;
      readonly code = 'payment_required';
    }
    const foreign = new OtherBundleError('secret token and private provider details');
    expect(foreign).not.toBeInstanceOf(ElevenLabsSpeechError);
    expect(ElevenLabsSpeechError.is(foreign)).toBe(true);
    if (!ElevenLabsSpeechError.is(foreign)) throw new Error('Expected structural provider error');
    const safe = new ElevenLabsSpeechError(foreign.status, foreign.code);
    expect(safe.message).toContain('paid ElevenLabs subscription');
    expect(safe.message).not.toMatch(/secret|private provider/);
  });

  it.each([
    null, new Error('ordinary'), { name: 'ElevenLabsSpeechError', status: 200, code: 'payment_required' },
    { name: 'ElevenLabsSpeechError', status: 600, code: 'payment_required' },
    { name: 'ElevenLabsSpeechError', status: NaN, code: 'payment_required' },
    { name: 'ElevenLabsSpeechError', status: Infinity, code: 'payment_required' },
    { name: 'ElevenLabsSpeechError', status: 402.5, code: 'payment_required' },
    { name: 'ElevenLabsSpeechError', status: '402', code: 'payment_required' },
    { name: 'ElevenLabsSpeechError', status: 402, code: 'constructor' },
    { name: 'ElevenLabsSpeechError', status: 402, code: 'provider-secret' },
  ])('rejects malformed structural provider errors: %s', (value) => {
    expect(ElevenLabsSpeechError.is(value)).toBe(false);
  });

  it.each([
    [402, 'payment_required', 'payment_required'],
    [401, 'quota_exceeded', 'quota_exceeded'],
    [401, 'missing_permissions', 'permission_denied'],
    [403, 'unknown', 'permission_denied'],
    [429, 'too_many_concurrent_requests', 'rate_limited'],
    [503, 'unknown', 'unavailable'],
    [400, 'unknown', 'provider_error'],
  ])('classifies HTTP %s / %s and never exposes provider detail', async (status, providerCode, code) => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ detail: { status: providerCode, message: 'sk-private request https://provider.test/token-secret' } }, { status }));
    const error = await new ElevenLabsStudio('key-secret', fetchFn).speak('Synthetic', 'voice').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ElevenLabsSpeechError);
    expect(error).toMatchObject({ status, code });
    expect(String(error)).not.toMatch(/sk-private|key-secret|token-secret|provider\.test/);
    expect(error).not.toHaveProperty('cause');
  });

  it('sanitizes network and response-read failures', async () => {
    const network = new ElevenLabsStudio('k', vi.fn<typeof fetch>(async () => { throw new Error('private URL and credentials'); }));
    await expect(network.speak('Synthetic', 'v')).rejects.toMatchObject({ code: 'unavailable', status: 503 });
    const bodyFailure = { ok: true, headers: new Headers({ 'content-type': 'audio/mpeg' }), arrayBuffer: async () => { throw new Error('secret'); } } as unknown as Response;
    await expect(new ElevenLabsStudio('k', vi.fn<typeof fetch>(async () => bodyFailure)).speak('Synthetic', 'v')).rejects.toMatchObject({ code: 'unavailable', status: 503 });
  });

  it.each([
    new Response('{"detail":"not audio"}', { headers: { 'content-type': 'application/json' } }),
    new Response(null, { headers: { 'content-type': 'audio/mpeg' } }),
    new Response('audio without type'),
  ])('rejects HTTP 200 responses without a nonempty audio payload', async (response) => {
    await expect(new ElevenLabsStudio('k', vi.fn<typeof fetch>(async () => response)).speak('Synthetic', 'v')).rejects.toMatchObject({ code: 'provider_error', status: 502 });
  });

  it('uses v4 for voice messages while keeping the live-call model unchanged', async () => {
    vi.stubEnv('ELEVENLABS_TTS_MODEL', undefined);
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('MP3', { headers: { 'content-type': 'audio/mpeg' } }));
    expect((await new ElevenLabsStudio('k', fetchFn).speak('سلام, synthetic hello.', 'v')).toString()).toBe('MP3');
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body)).model_id).toBe('eleven_v4');
    expect(voiceAgentBody({ name: 'Synthetic', llmUrl: 'u', llmSecretId: 's', maxCallSeconds: 1 }).conversation_config.tts.model_id).toBe('eleven_flash_v2_5');
    expect(new StudioVoiceService(null, null).canSynthesize).toBe(false);
    expect(new StudioVoiceService(null, new ElevenLabsStudio('k', fetchFn)).canSynthesize).toBe(true);
  });
});
