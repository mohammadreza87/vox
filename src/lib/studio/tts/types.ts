/**
 * The speech-synthesis seam (design PET_CARE_GAME_DESIGN_2026_10_26 §8A.3): one interface every TTS provider adapts to,
 * selected by STUDIO_TTS_PROVIDER (`eleven` default, `gemini` once its adapter lands). Callers stay provider-blind:
 * the call path (service.ts callTurn) asks for audio and gets bytes plus their media type.
 */

import { brandError, namedError } from '../../error-contract';
import type { TtsProvider } from '../../tireh/pet-flags';

/** One implementation of the STUDIO_TTS_PROVIDER parser lives with the other pet flags; re-exported here for callers of the seam. */
export { parseTtsProvider, TTS_PROVIDERS, type TtsProvider } from '../../tireh/pet-flags';

export interface SpeechOptions {
  /** the synchronous export fence, checked right before audio is released (indexed storage) */
  authorizeNow?: () => boolean;
  signal?: AbortSignal;
  /** a natural-language style note (Gemini); ignored by providers without one */
  style?: string;
  /** the reply's language when the caller knows it; ignored by providers that detect it */
  lang?: 'en' | 'fa';
}

export interface SpeechResult {
  audio: Buffer;
  /** e.g. `audio/mpeg` (ElevenLabs), `audio/wav` or `audio/L16;rate=24000` (Gemini) */
  mimeType: string;
}

export interface SpeechSynthesizer {
  readonly provider: TtsProvider;
  /** false: this provider cannot speak on this server (no adapter or no key); callers fall back to text */
  readonly canSynthesize: boolean;
  /**
   * The provider honours `authorizeNow` before releasing audio, as ElevenLabs does today (service.ts): only then may it
   * speak a reply built from indexed saved context. Absent means it may not.
   */
  readonly committedTtsExportFence?: true;
  speak(text: string, voiceId: string, opts?: SpeechOptions): Promise<SpeechResult>;
}

/** A provider that is selected but cannot speak (e.g. Gemini before its adapter lands). Never a person's fault. */
export class SpeechUnavailableError extends Error {
  readonly code = 'unavailable' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SpeechUnavailableError';
    brandError(this, 'SpeechUnavailableError');
  }
  static is(error: unknown): error is SpeechUnavailableError {
    return namedError(error, 'SpeechUnavailableError');
  }
}
