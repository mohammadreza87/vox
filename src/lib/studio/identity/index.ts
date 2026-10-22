/**
 * Public API of the S11L voiceprint library and its runtime factory. With
 * VOICEPRINT_KEY unset nothing is constructed and the runtime behaves exactly
 * as the base. See docs/implementation/VOICE_PROVIDER_INTEGRATION.md.
 */
import { join } from 'node:path';
import type { AdaptiveService } from '../../adaptive/persistence/service';
import { defaultVoiceId, type ElevenLabsStudio } from '../media';
import type { StudioState } from '../types';
import { voiceprintEnv } from './config';
import { parseVoiceprintKey, VoiceprintCipher } from './crypto';
import { PyannoteVoiceprintProvider } from './pyannote';
import { PersonaVoiceEchoSource } from './self-echo';
import { FileVoiceprintStore, FirestoreVoiceprintStore, type VoiceprintStore } from './store';
import { VoiceprintService } from './voice';

export { VoiceprintProviderError, type SpeechActivity, type VoiceprintProvider, type VoiceprintProviderErrorCode } from './provider';
export { PyannoteVoiceprintProvider, PYANNOTE_DEFAULT_BASE_URL } from './pyannote';
export { MIN_NET_SPEECH_MS, ENROLL_MIN_NET_SPEECH_MS, grossTooShort, netSpeechFromSegments, meetsNetSpeech } from './net-speech';
export { parseVoiceprintKey, VoiceprintCipher, type VoiceprintAad } from './crypto';
export {
  VOICE_THRESHOLDS_ENV, parseVoiceThresholds, resolveThresholds, bandFor, pilotManifest, voiceprintEnv,
  type BandThresholds, type VoiceThresholdConfig, type VoiceprintEnv,
} from './config';
export {
  InMemoryVoiceprintStore, FileVoiceprintStore, FirestoreVoiceprintStore, voiceprintDocId,
  type VoiceprintRow, type VoiceprintStore, type VoiceSpace, type VoiceChannel,
} from './store';
export { SELF_ECHO_PHRASES, PersonaVoiceEchoSource, type SelfEchoSource } from './self-echo';
export {
  VoiceprintService, VoiceprintError, biometricGrant, MAX_VOICEPRINT_AUDIO_BYTES, MAX_TEMPLATE_AGE_MS,
  DEFAULT_VERIFY_DEADLINE_MS, DEFAULT_ENROLL_DEADLINE_MS,
  type VoiceprintErrorCode, type VoiceprintStatus, type VoiceprintServiceOptions,
} from './voice';

/**
 * Null when VOICEPRINT_KEY is unset (base behaviour). Throws at startup for a
 * malformed key or one that reuses STUDIO_SECRET. The provider, speech
 * activity and self-echo source exist only with PYANNOTE_API_KEY and outside
 * the internal-pilot manifest; status and delete work without them.
 */
export async function createStudioVoiceprints(input: {
  env: NodeJS.ProcessEnv;
  storage: 'file' | 'firestore';
  dataDir: string;
  orgKey: string;
  adaptive: AdaptiveService;
  readState: () => Promise<StudioState>;
  eleven: ElevenLabsStudio | null;
  logger?: Pick<Console, 'warn'>;
}): Promise<VoiceprintService | null> {
  const { env } = input;
  const key = parseVoiceprintKey(env.VOICEPRINT_KEY, env.STUDIO_SECRET);
  if (!key) return null;
  const config = voiceprintEnv(env);
  if (config.thresholdsInvalid) input.logger?.warn('voiceprint_thresholds_invalid');
  const store: VoiceprintStore = input.storage === 'firestore'
    ? new FirestoreVoiceprintStore(await (await import('@/lib/firebase-admin')).getAdminDb())
    : new FileVoiceprintStore(join(input.dataDir, 'voiceprints-v1.json'));
  const provider = config.apiKey && !config.pilot
    ? new PyannoteVoiceprintProvider({ apiKey: config.apiKey, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) })
    : undefined;
  const eleven = input.eleven;
  const selfEcho = provider ? new PersonaVoiceEchoSource({
    voiceIds: async () => eleven
      ? [...new Set((await input.readState()).agents.map(a => a.voice?.voiceId ?? defaultVoiceId(a.persona.presentation)))]
      : [],
    synthesize: async (text, voiceId) => {
      if (!eleven) throw new Error('voiceprint_echo_unavailable');
      return new Uint8Array(await eleven.speak(text, voiceId));
    },
    provider,
  }) : undefined;
  const cipher = new VoiceprintCipher(key);
  key.fill(0);
  return new VoiceprintService({
    adaptive: input.adaptive, store, cipher, thresholds: config.thresholds, orgKey: input.orgKey, pilot: config.pilot,
    ...(provider && selfEcho ? { provider, speech: provider.speechActivity(), selfEcho } : {}),
    eligiblePerson: async telegramId => {
      const matches = (await input.readState()).members.filter(m => m.telegramId === telegramId);
      return matches.length === 1 && matches[0].role !== 'pending';
    },
    ...(input.logger ? { logger: input.logger } : {}),
  });
}
