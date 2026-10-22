/**
 * Provider seams for S11L voiceprints. Types plus one content-free error
 * class: no I/O and no logging. Named VoiceprintProvider so it never clashes
 * with src/lib/adaptive/voice-identity/provider.ts.
 */

export interface VoiceprintProvider {
  /** Stable provider id stored on every row ('pyannoteai'). */
  readonly id: string;
  /** Template compatibility key; a row with another modelVersion is never compared. */
  readonly modelVersion: string;
  /** Builds an opaque template from one consented enrollment sample. The sample is never persisted by Vox. */
  voiceprint(audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Uint8Array>;
  /**
   * Scores QUERY AUDIO against candidate templates. `query` is the audio bytes
   * exactly as received (the provider sniffs the container), not a template:
   * pyannoteAI matches audio against voiceprints on its server and has no
   * template-to-template endpoint. Candidate ids are opaque labels supplied by
   * VoiceprintService ('owner', 'echo-<n>'); person ids never leave Vox.
   * `score` is normalised to [0, 1]; `candidateId` is the best-scoring label.
   */
  identify(query: Uint8Array, candidates: readonly { id: string; template: Uint8Array }[], signal: AbortSignal): Promise<{ candidateId?: string; score: number }>;
}

/** Net speech and speaker count from the provider's diarization (no local audio decoding). */
export interface SpeechActivity {
  measure(audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<{ netSpeechMs: number; speakers: number }>;
}

export type VoiceprintProviderErrorCode = 'mixed_speakers' | 'bad_response' | 'http' | 'job_failed' | 'aborted';

/** The message is the code only and never contains a response body. */
export class VoiceprintProviderError extends Error {
  override readonly name = 'VoiceprintProviderError';
  constructor(readonly code: VoiceprintProviderErrorCode) { super(code); }
}
