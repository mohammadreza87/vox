import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  audioOf, GEMINI_TTS_DEFAULT_MODEL, GEMINI_TTS_DEFAULT_VOICE, GEMINI_TTS_NO_KEY, geminiError, geminiFromEnv, GeminiSpeechError,
  GeminiSpeechSynthesizer, pcmToWav, UnconfiguredGeminiSynthesizer, voiceName,
} from '../gemini';
import { createSpeechSynthesizer, SpeechUnavailableError } from '..';
import { ExportAuthorityError } from '../../../tireh/voice';

const PCM = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const ok = (data: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({
  steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'text', text: 'ignored' }, { type: 'audio', data, ...extra }] }],
}), { status: 200, headers: { 'content-type': 'application/json' } });
const fakeFetch = (respond: () => Response | Promise<Response>) => vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => respond());
const tts = (fetchFn: typeof fetch, o: Partial<ConstructorParameters<typeof GeminiSpeechSynthesizer>[0]> = {}) =>
  new GeminiSpeechSynthesizer({ apiKey: 'test-key', fetchFn, ...o });

afterEach(() => { vi.useRealTimers(); });

describe('Gemini TTS request', () => {
  it('posts the documented Interactions body with the voice, and the style as speech_metadata (never prepended to the text)', async () => {
    const fetchFn = fakeFetch(() => ok(PCM.toString('base64')));
    await tts(fetchFn as unknown as typeof fetch).speak('Hello there.', 'sulafat', { style: '  warm,\n playful  ' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'x-goog-api-key': 'test-key', 'Content-Type': 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init!.body as string)).toEqual({
      model: GEMINI_TTS_DEFAULT_MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'Hello there.', annotations: [{ type: 'speech_metadata', style: 'warm, playful' }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'Sulafat' }] },
    });
  });

  it('no style: no annotation; an empty or unknown voice uses the default; the model and default voice are configurable', async () => {
    const fetchFn = fakeFetch(() => ok(PCM.toString('base64')));
    await tts(fetchFn as unknown as typeof fetch).speak('Hi.', '');
    let body = JSON.parse(fetchFn.mock.calls[0][1]!.body as string);
    expect(body.input[0].content[0]).toEqual({ type: 'text', text: 'Hi.' });
    expect(body.generation_config.speech_config).toEqual([{ voice: GEMINI_TTS_DEFAULT_VOICE }]);
    await tts(fetchFn as unknown as typeof fetch, { model: 'gemini-3.8-flash-lite-tts', defaultVoice: 'kore' }).speak('Hi.', 'eleven-voice-id');
    body = JSON.parse(fetchFn.mock.calls[1][1]!.body as string);
    expect(body.model).toBe('gemini-3.8-flash-lite-tts');
    expect(body.generation_config.speech_config).toEqual([{ voice: 'Kore' }]);
    expect(voiceName('nope')).toBeNull();
  });
});

describe('Gemini TTS audio', () => {
  it('wraps headerless 24 kHz PCM in a correct RIFF/WAVE header', async () => {
    const out = await tts(fakeFetch(() => ok(PCM.toString('base64'))) as unknown as typeof fetch).speak('Hi.', 'Kore');
    expect(out.mimeType).toBe('audio/wav');
    const w = out.audio;
    expect(w.length).toBe(44 + PCM.length);
    expect(w.toString('ascii', 0, 4)).toBe('RIFF');
    expect(w.readUInt32LE(4)).toBe(w.length - 8);
    expect(w.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(w.readUInt32LE(16)).toBe(16);
    expect(w.readUInt16LE(20)).toBe(1); // PCM
    expect(w.readUInt16LE(22)).toBe(1); // mono
    expect(w.readUInt32LE(24)).toBe(24_000);
    expect(w.readUInt32LE(28)).toBe(48_000); // byte rate
    expect(w.readUInt16LE(32)).toBe(2); // block align
    expect(w.readUInt16LE(34)).toBe(16);
    expect(w.toString('ascii', 36, 40)).toBe('data');
    expect(w.readUInt32LE(40)).toBe(PCM.length);
    expect(w.subarray(44)).toEqual(PCM);
  });

  it('passes a WAV through unchanged, honours an L16 rate, and drops a dangling odd byte', async () => {
    const wav = pcmToWav(PCM);
    expect((await tts(fakeFetch(() => ok(wav.toString('base64'))) as unknown as typeof fetch).speak('Hi.', 'Kore')).audio).toEqual(wav);
    const l16 = await tts(fakeFetch(() => ok(Buffer.concat([PCM, Buffer.from([9])]).toString('base64'), { mime_type: 'audio/L16;rate=16000' })) as unknown as typeof fetch).speak('Hi.', 'Kore');
    expect(l16.audio.readUInt32LE(24)).toBe(16_000);
    expect(l16.audio.readUInt32LE(40)).toBe(PCM.length);
  });

  it('reads the generateContent shape too', () => {
    expect(audioOf({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAA=' } }] } }] }))
      .toEqual({ data: 'AAA=', mimeType: 'audio/L16;rate=24000' });
    expect(audioOf({ steps: [] })).toBeNull();
  });
});

describe('Gemini TTS errors', () => {
  it.each([
    [429, 'RESOURCE_EXHAUSTED', 'rate_limited'],
    [403, 'PERMISSION_DENIED', 'permission_denied'],
    [400, 'INVALID_ARGUMENT', 'provider_error'],
    [503, 'UNAVAILABLE', 'unavailable'],
    [500, 'INTERNAL', 'unavailable'],
  ])('%i %s → %s with a fixed message (the provider body never escapes)', async (status, s, code) => {
    const fetchFn = fakeFetch(() => new Response(JSON.stringify({ error: { code: status, status: s, message: 'secret test-key and the text' } }), { status }));
    const error = await tts(fetchFn as unknown as typeof fetch).speak('private words', 'Kore').catch((e: unknown) => e);
    expect(GeminiSpeechError.is(error)).toBe(true);
    expect(error).toMatchObject({ status, code });
    expect((error as Error).message).not.toMatch(/secret|private/);
  });

  it('a network failure is unavailable; a 200 without audio is a provider error', async () => {
    const down = await tts(vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch).speak('Hi.', 'Kore').catch((e: unknown) => e);
    expect(down).toMatchObject({ name: 'GeminiSpeechError', status: 503, code: 'unavailable' });
    const empty = await tts(fakeFetch(() => new Response(JSON.stringify({ steps: [] }))) as unknown as typeof fetch).speak('Hi.', 'Kore').catch((e: unknown) => e);
    expect(empty).toMatchObject({ code: 'provider_error' });
    expect(geminiError(418, null)).toMatchObject({ status: 418, code: 'provider_error' });
  });

  it('gives up after the 10 s deadline and aborts the request', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const fetchFn = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      seen = init!.signal!;
      seen.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = tts(fetchFn as unknown as typeof fetch).speak('Hi.', 'Kore').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(seen!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ name: 'GeminiSpeechError', status: 504, code: 'unavailable' });
    expect(seen!.aborted).toBe(true);
  });

  it("follows the caller's AbortSignal, and the export fence before the text leaves and before audio is released", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = tts(fetchFn as unknown as typeof fetch).speak('Hi.', 'Kore', { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    expect(await pending).toMatchObject({ code: 'unavailable', status: 503 });

    const never = fakeFetch(() => ok(PCM.toString('base64')));
    await expect(tts(never as unknown as typeof fetch).speak('Hi.', 'Kore', { authorizeNow: () => false })).rejects.toBeInstanceOf(ExportAuthorityError);
    expect(never).not.toHaveBeenCalled();

    let allowed = true;
    const flips = fakeFetch(() => { allowed = false; return ok(PCM.toString('base64')); });
    await expect(tts(flips as unknown as typeof fetch).speak('Hi.', 'Kore', { authorizeNow: () => allowed })).rejects.toBeInstanceOf(ExportAuthorityError);
  });
});

describe('Gemini TTS from the environment', () => {
  it('GEMINI_API_KEY, else GOOGLE_API_KEY; none: a synthesizer that cannot speak', async () => {
    const fetchFn = fakeFetch(() => ok(PCM.toString('base64')));
    const a = geminiFromEnv({ GEMINI_API_KEY: 'g-key', STUDIO_GEMINI_TTS_MODEL: 'm-x', STUDIO_GEMINI_TTS_VOICE: 'Puck' }, fetchFn as unknown as typeof fetch);
    expect(a).toMatchObject({ provider: 'gemini', canSynthesize: true, committedTtsExportFence: true, model: 'm-x', defaultVoice: 'Puck' });
    await a.speak('Hi.', '');
    expect((fetchFn.mock.calls[0][1]!.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(geminiFromEnv({ GOOGLE_API_KEY: 'google-key' })).toBeInstanceOf(GeminiSpeechSynthesizer);
    const none = geminiFromEnv({});
    expect(none).toBeInstanceOf(UnconfiguredGeminiSynthesizer);
    expect(none.canSynthesize).toBe(false);
    const error = await none.speak('Hi.', '').catch((e: unknown) => e);
    expect(SpeechUnavailableError.is(error)).toBe(true);
    expect((error as Error).message).toBe(GEMINI_TTS_NO_KEY);
    expect(createSpeechSynthesizer('gemini', { eleven: null, env: { GEMINI_API_KEY: 'k' } })).toBeInstanceOf(GeminiSpeechSynthesizer);
  });
});
