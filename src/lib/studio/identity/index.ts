/**
 * Public API of the S11L voiceprint library and its runtime factory. With
 * VOICEPRINT_KEY unset nothing is constructed and the runtime behaves exactly
 * as the base. See docs/implementation/VOICE_PROVIDER_INTEGRATION.md.
 */
import { join } from 'node:path';
import type { AdaptiveService } from '../../adaptive/persistence/service';
import { defaultVoiceId, type ElevenLabsStudio } from '../media';
import type { StudioState } from '../types';
import { tirehFlags } from '../../tireh/flags';
import { voiceprintEnv } from './config';
import { parseVoiceprintKey, VoiceprintCipher } from './crypto';
import { PyannoteVoiceprintProvider } from './pyannote';
import { PersonaVoiceEchoSource } from './self-echo';
import { FileVoiceprintStore, FirestoreVoiceprintStore, type VoiceprintStore } from './store';
import { VoiceprintService, type VoiceprintServiceOptions } from './voice';

export { VoiceprintProviderError, type SpeechActivity, type VoiceprintProvider, type VoiceprintProviderErrorCode } from './provider';
export { PyannoteVoiceprintProvider, PYANNOTE_DEFAULT_BASE_URL } from './pyannote';
export { MIN_NET_SPEECH_MS, ENROLL_MIN_NET_SPEECH_MS, grossTooShort, netSpeechFromSegments, meetsNetSpeech } from './net-speech';
export { parseVoiceprintKey, VoiceprintCipher, type VoiceprintAad } from './crypto';
export {
  VOICE_THRESHOLDS_ENV, parseVoiceThresholds, resolveThresholds, bandFor, pilotManifest, voiceprintEnv,
  type BandThresholds, type VoiceThresholdConfig, type VoiceprintEnv,
} from './config';
export {
  InMemoryVoiceprintStore, FileVoiceprintStore, FirestoreVoiceprintStore, voiceprintDocId, VOICEPRINT_KEY_PAGE,
  type VoiceprintRow, type VoiceprintKey, type VoiceprintStore, type VoiceSpace, type VoiceChannel,
} from './store';
export { SELF_ECHO_PHRASES, PersonaVoiceEchoSource, type SelfEchoSource } from './self-echo';
export {
  VoiceprintService, VoiceprintError, biometricGrant, MAX_VOICEPRINT_AUDIO_BYTES, MAX_TEMPLATE_AGE_MS,
  DEFAULT_VERIFY_DEADLINE_MS, DEFAULT_ENROLL_DEADLINE_MS, VERIFY_TOO_LARGE_REASON, VOICEPRINT_SWEEP_EVERY_MS,
  chainVoiceInvalidators, startVoiceprintSweep,
  type VoiceprintErrorCode, type VoiceprintStatus, type VoiceprintServiceOptions,
} from './voice';

/**
 * Telegram ids that eligiblePerson accepts: listed exactly once, with a role of at least member (not pending).
 * A duplicated id is ambiguous and stays ineligible, as in eligiblePerson.
 */
export function eligibleMembers(members: readonly Pick<StudioState['members'][number], 'telegramId' | 'role'>[]): ReadonlySet<number> {
  const counts = new Map<number, number>();
  for (const m of members) counts.set(m.telegramId, (counts.get(m.telegramId) ?? 0) + 1);
  return new Set(members.filter(m => counts.get(m.telegramId) === 1 && m.role !== 'pending').map(m => m.telegramId));
}

/**
 * Null when VOICEPRINT_KEY is unset (base behaviour). Throws at startup for a
 * malformed key or one that reuses STUDIO_SECRET. The provider, speech
 * activity and self-echo source exist only with PYANNOTE_API_KEY and outside
 * the internal-pilot manifest; status and delete work without them.
 * Refuses at startup with the flag on, Firestore storage and a production
 * runtime: an environment key stored beside the ciphertext is not acceptable
 * there until Cloud KMS envelope encryption exists.
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
  /** runtime.ts passes config.production; with Firestore storage and the flag on, startup refuses. */
  production?: boolean;
  /** Override for the flag reader; runtime.ts passes a constant-off reader when the local voice engine is selected. */
  flags?: VoiceprintServiceOptions['flags'];
}): Promise<VoiceprintService | null> {
  const { env } = input;
  const key = parseVoiceprintKey(env.VOICEPRINT_KEY, env.STUDIO_SECRET);
  if (!key) return null;
  // The flag as the service will read it (input.flags, else the process env) or as the given env says (main's voiceprintConfigFromEnv).
  const flagOn = input.flags ? input.flags().voiceRecognition : tirehFlags().voiceRecognition || tirehFlags(env).voiceRecognition;
  if (input.storage === 'firestore' && input.production && flagOn) {
    key.fill(0);
    throw new Error('Voiceprints on Firebase require Cloud KMS envelope encryption (docs/implementation/VOICE_PROVIDER_INTEGRATION.md)');
  }
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
    // The sweep's membership: one state read for every row, with the same rule as eligiblePerson.
    eligiblePeople: async () => eligibleMembers((await input.readState()).members),
    ...(input.logger ? { logger: input.logger } : {}),
    ...(input.flags ? { flags: input.flags } : {}),
  });
}
