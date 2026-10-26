/**
 * ElevenLabs behind the SpeechSynthesizer seam (design §8A.3). A thin adapter over ElevenLabsStudio.speak with no
 * behaviour change: the same request (model from ELEVENLABS_TTS_MODEL, MP3 44.1 kHz), the same export authority
 * (passed only when the caller gives one, exactly as service.ts called it before), and the same fence flag.
 */

import type { ElevenLabsStudio } from '../media';
import type { SpeechOptions, SpeechResult, SpeechSynthesizer } from './types';

export class ElevenSpeechSynthesizer implements SpeechSynthesizer {
  readonly provider = 'eleven' as const;
  readonly canSynthesize = true;

  constructor(private readonly eleven: Pick<ElevenLabsStudio, 'speak'> & { readonly committedTtsExportFence?: boolean }) {}

  get committedTtsExportFence(): true | undefined {
    return this.eleven.committedTtsExportFence === true ? true : undefined;
  }

  async speak(text: string, voiceId: string, opts: SpeechOptions = {}): Promise<SpeechResult> {
    const { authorizeNow, signal } = opts;
    const audio = authorizeNow || signal
      ? await this.eleven.speak(text, voiceId, { ...(authorizeNow ? { authorizeNow } : {}), ...(signal ? { signal } : {}) })
      : await this.eleven.speak(text, voiceId);
    return { audio, mimeType: 'audio/mpeg' };
  }
}
