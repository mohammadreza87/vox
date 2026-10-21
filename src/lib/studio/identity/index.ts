/**
 * Public API of the S11L voiceprint library and its environment wiring.
 * With STUDIO_VOICE_RECOGNITION and VOICEPRINT_KEY both unset nothing is
 * wired and the runtime behaves exactly as before.
 */
import { tirehFlags } from '../../tireh/flags';
import { AesGcmVoiceprintCipher, voiceprintCipherFromEnv } from './crypto';
import { PyannoteVoiceprintProvider } from './pyannote';
import { parseVoiceThresholds, type VoiceThresholdConfig } from './voice';

export { AesGcmVoiceprintCipher, voiceprintCipherFromEnv, type VoiceprintCipher } from './crypto';
export { InMemoryVoiceprintStore, FileVoiceprintStore, FirestoreVoiceprintStore, type VoiceprintRow, type EchoTemplateRow, type VoiceprintStore } from './store';
export { opusNetSpeech, MIN_ENROLL_NET_SPEECH_MS, MAX_ENROLL_GROSS_MS, SPEECH_MIN_BYTES_PER_20MS, MIN_NET_SPEECH_MS,
  type NetSpeechEstimate, type NetSpeechEstimator } from './net-speech';
export { PyannoteVoiceprintProvider, PYANNOTE_MODEL_VERSION } from './pyannote';
export {
  VoiceprintService, VoiceprintError, parseVoiceThresholds, bandFor, echoVoicesFromStudio, chainVoiceInvalidators,
  ECHO_CALIBRATION_TEXT, VOICE_VERIFY_TIMEOUT_MS, ENROLL_TIMEOUT_MS, MAX_ENROLL_AUDIO_BYTES, MAX_VERIFY_AUDIO_BYTES,
  type VoiceprintProvider, type VoiceBandThresholds, type VoiceThresholdConfig, type VoiceprintStatus, type VoiceprintUnavailableReason,
  type VoiceprintErrorCode, type VoiceprintServiceDeps, type EchoVoiceSource,
} from './voice';

export interface VoiceprintEnvConfig {
  enabled: boolean;
  cipher: AesGcmVoiceprintCipher;
  provider?: PyannoteVoiceprintProvider;
  thresholds: VoiceThresholdConfig | null;
}

/**
 * Null when the flag is off and VOICEPRINT_KEY is unset (the exact-base path).
 * A key with the flag off wires status/delete-only mode (no provider, no
 * thresholds) so existing templates stay deletable.
 */
export function voiceprintConfigFromEnv(env: NodeJS.ProcessEnv, o: { storage: 'file' | 'firestore'; production: boolean }): VoiceprintEnvConfig | null {
  const enabled = tirehFlags(env).voiceRecognition;
  const keySet = !!env.VOICEPRINT_KEY?.trim();
  if (!enabled && !keySet) return null;
  if (enabled && !keySet) throw new Error('VOICEPRINT_KEY (base64, 32 bytes) is required with STUDIO_VOICE_RECOGNITION=1');
  if (enabled && o.storage === 'firestore' && o.production) {
    throw new Error('Voiceprints on Firebase require Cloud KMS envelope encryption (docs/implementation/VOICE_PROVIDER_INTEGRATION.md)');
  }
  const cipher = voiceprintCipherFromEnv(env);
  if (!cipher) throw new Error('VOICEPRINT_KEY (base64, 32 bytes) is required with STUDIO_VOICE_RECOGNITION=1');
  if (!enabled) return { enabled: false, cipher, thresholds: null };
  const apiKey = env.PYANNOTE_API_KEY?.trim();
  const baseUrl = env.PYANNOTE_BASE_URL?.trim();
  return {
    enabled: true, cipher,
    ...(apiKey ? { provider: new PyannoteVoiceprintProvider({ apiKey, ...(baseUrl ? { baseUrl } : {}) }) } : {}),
    thresholds: parseVoiceThresholds(env.VOICE_MATCH_THRESHOLDS_JSON),
  };
}
