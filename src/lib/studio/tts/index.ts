/**
 * Picks the server's SpeechSynthesizer from STUDIO_TTS_PROVIDER (design §8A.3). `eleven` (default) adapts the existing
 * ElevenLabs client; `gemini` is the Gemini TTS adapter (gemini.ts), or a synthesizer that cannot speak when no
 * GEMINI_API_KEY / GOOGLE_API_KEY is set, so the pet answers in text and never pays for speech it cannot make.
 */

import type { ElevenLabsStudio } from '../media';
import { ElevenSpeechSynthesizer } from './eleven';
import { geminiFromEnv } from './gemini';
import type { SpeechSynthesizer, TtsProvider } from './types';

export { ElevenSpeechSynthesizer } from './eleven';
export {
  GEMINI_PREBUILT_VOICES, GEMINI_TTS_DEFAULT_MODEL, GEMINI_TTS_DEFAULT_VOICE, GEMINI_TTS_NO_KEY, GeminiSpeechError, GeminiSpeechSynthesizer,
  UnconfiguredGeminiSynthesizer, geminiFromEnv, pcmToWav,
} from './gemini';
export { splitSentences } from './sentences';
export * from './types';

/** The synthesizer for this server, or null when ElevenLabs is chosen without credentials (no speech at all, as before). */
export function createSpeechSynthesizer(provider: TtsProvider, o: { eleven: ElevenLabsStudio | null; env?: NodeJS.ProcessEnv; fetchFn?: typeof fetch }): SpeechSynthesizer | null {
  if (provider === 'gemini') return geminiFromEnv(o.env ?? process.env, o.fetchFn);
  return o.eleven ? new ElevenSpeechSynthesizer(o.eleven) : null;
}
