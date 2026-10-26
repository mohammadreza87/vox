import { describe, expect, it, vi } from 'vitest';
import { createSpeechSynthesizer, ElevenSpeechSynthesizer, GEMINI_TTS_NO_KEY, parseTtsProvider, UnconfiguredGeminiSynthesizer, SpeechUnavailableError } from '..';
import type { ElevenLabsStudio } from '../../media';

const fakeEleven = (fence = true) => ({ committedTtsExportFence: fence, speak: vi.fn(async () => Buffer.from('mp3-bytes')) });

describe('the SpeechSynthesizer seam (design §8A.3)', () => {
  it('reads STUDIO_TTS_PROVIDER with eleven as the default for unset or unknown values', () => {
    expect(parseTtsProvider(undefined)).toBe('eleven');
    expect(parseTtsProvider('')).toBe('eleven');
    expect(parseTtsProvider(' Gemini ')).toBe('gemini');
    expect(parseTtsProvider('openai')).toBe('eleven');
  });

  it('ElevenLabs: the same calls as before the seam, MP3, and its export fence', async () => {
    const eleven = fakeEleven();
    const tts = new ElevenSpeechSynthesizer(eleven);
    expect(tts).toMatchObject({ provider: 'eleven', canSynthesize: true, committedTtsExportFence: true });
    expect(await tts.speak('Hello there.', 'voice-1')).toEqual({ audio: Buffer.from('mp3-bytes'), mimeType: 'audio/mpeg' });
    expect(eleven.speak).toHaveBeenLastCalledWith('Hello there.', 'voice-1');
    const authorizeNow = () => true;
    const signal = new AbortController().signal;
    await tts.speak('Hi.', 'voice-1', { authorizeNow, signal, style: 'warm', lang: 'fa' });
    expect(eleven.speak).toHaveBeenLastCalledWith('Hi.', 'voice-1', { authorizeNow, signal });
    expect(new ElevenSpeechSynthesizer(fakeEleven(false)).committedTtsExportFence).toBeUndefined();
  });

  it('Gemini without a key cannot synthesize and says why', async () => {
    const tts = createSpeechSynthesizer('gemini', { eleven: fakeEleven() as unknown as ElevenLabsStudio, env: {} })!;
    expect(tts).toBeInstanceOf(UnconfiguredGeminiSynthesizer);
    expect(tts.canSynthesize).toBe(false);
    expect(tts.committedTtsExportFence).toBeUndefined();
    const error = await tts.speak('Hello.', 'voice-1').catch((e: unknown) => e);
    expect(SpeechUnavailableError.is(error)).toBe(true);
    expect((error as SpeechUnavailableError).code).toBe('unavailable');
    expect((error as Error).message).toBe(GEMINI_TTS_NO_KEY);
  });

  it('eleven without credentials is no synthesizer at all', () => {
    expect(createSpeechSynthesizer('eleven', { eleven: null })).toBeNull();
    expect(createSpeechSynthesizer('eleven', { eleven: fakeEleven() as unknown as ElevenLabsStudio })).toBeInstanceOf(ElevenSpeechSynthesizer);
  });
});
