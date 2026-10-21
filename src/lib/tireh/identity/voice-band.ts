/**
 * Content-free voice verification shapes shared by the identity library
 * (src/lib/tireh/identity, S10L) and voiceprint verification
 * (src/lib/studio/identity/voice.ts, S11L). A band is evidence that can only
 * lower an identity level; it never grants access, identity or sharing.
 * Created byte-identically by S10L and S11L.
 */

export type VoiceBand = 'MATCH' | 'UNCERTAIN' | 'NO_MATCH';

export type VoiceNoOpinionReason =
  | 'disabled' | 'not_enrolled' | 'consent_missing' | 'guest_or_group'
  | 'too_short' | 'self_echo' | 'provider_error' | 'timeout';

export type VoiceVerification =
  | { readonly band: VoiceBand; readonly netSpeechMs: number; readonly modelVersion: string }
  | { readonly band: 'NO_OPINION'; readonly reason: VoiceNoOpinionReason; readonly netSpeechMs?: number };

export interface VoiceNoteInput {
  readonly personaId: string;
  /** The authenticated account's person: the only candidate (verification, never identification). */
  readonly personId: string;
  readonly space: 'work' | 'personal';
  readonly chatKind: 'private' | 'group';
  /** True when a guest or unknown reader can hear the chat; verification then never runs. */
  readonly guestAudience: boolean;
  readonly audio: ArrayBuffer;
  readonly mimeType: string;
  readonly durationSec?: number;
  readonly channel: 'telegram_voice_note' | 'mini_app';
}

export interface VoiceNoteVerifier {
  /** Never throws and never persists audio; returns NO_OPINION for groups, guests and unenrolled people. */
  verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification>;
}

/** Minimum net speech before any opinion (docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.9). */
export const MIN_NET_SPEECH_MS = 3_000;
