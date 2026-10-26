/**
 * Picks the server's SpeechSynthesizer from STUDIO_TTS_PROVIDER (design §8A.3). `eleven` (default) adapts the existing
 * ElevenLabs client; `gemini` is a stub that cannot synthesize until the Gemini adapter lands (Wave B), so the pet
 * answers in text and the call path never pays for speech it cannot make.
 */

import type { ElevenLabsStudio } from '../media';
import { ElevenSpeechSynthesizer } from './eleven';
import { SpeechUnavailableError, type SpeechResult, type SpeechSynthesizer, type TtsProvider } from './types';

export { ElevenSpeechSynthesizer } from './eleven';
export { splitSentences } from './sentences';
export * from './types';

export const GEMINI_TTS_PENDING = 'Gemini speech (STUDIO_TTS_PROVIDER=gemini) is not available yet: its adapter has not landed. Unset STUDIO_TTS_PROVIDER or set it to eleven.';

/** Gemini before its adapter: selected, honest about it, and never able to speak. */
export class PendingGeminiSynthesizer implements SpeechSynthesizer {
  readonly provider = 'gemini' as const;
  readonly canSynthesize = false;
  async speak(): Promise<SpeechResult> {
    throw new SpeechUnavailableError(GEMINI_TTS_PENDING);
  }
}

/** The synthesizer for this server, or null when the chosen provider has no credentials (no speech at all, as today). */
export function createSpeechSynthesizer(provider: TtsProvider, o: { eleven: ElevenLabsStudio | null }): SpeechSynthesizer | null {
  if (provider === 'gemini') return new PendingGeminiSynthesizer();
  return o.eleven ? new ElevenSpeechSynthesizer(o.eleven) : null;
}
