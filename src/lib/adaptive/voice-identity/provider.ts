/** A reviewed adapter is injected by the server. No production adapter is selected
 * by this module; neither Decisions, transcription nor TTS is speaker matching. */
export interface VoiceIdentityProvider {
  readonly id: string;
  readonly version: string;
  readonly location: 'on_device' | 'server' | 'cloud';
  /** Approved stateless processing: no provider-owned enrollment artifact/audio archive. */
  readonly retention: 'request_only';
  /** Must not generate identity embeddings. Unknown, mixed, recorded, replay and
   * synthetic/uncertain or over-duration captures abstain before extract() is ever invoked.
   * Qualification of this guarantee is an external release gate. */
  inspect(input: { audio: Uint8Array; mimeType: string; challenge: string; maxDurationMs: number; signal: AbortSignal }): Promise<'eligible_single_live' | 'unknown'>;
  extract(input: { audio: Uint8Array; mimeType: string; signal: AbortSignal }): Promise<Uint8Array>;
  /** Exactly the permitted references supplied by the caller; no external search. */
  compare(input: { query: Uint8Array; candidates: readonly { id: string; template: Uint8Array }[]; signal: AbortSignal }): Promise<{ candidateId?: string }>;
  /** Purge any provider working copies. Failure leaves a visible retryable state. */
  purge(input: { template: Uint8Array; signal: AbortSignal }): Promise<void>;
}
export interface VoiceProviderApproval {
  providerId: string; providerVersion: string; location: VoiceIdentityProvider['location'];
  /** Signed/reviewed release reference supplied by deployment authority, not UI. */
  approvalReference: string; noticeVersion: string; expiresAt: number;
  templateTtlMs: number; consentTtlMs: number;
  disclosure: { en: string; fa: string };
}
