/**
 * Identity confidence types (S10L, docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.9).
 * Identity confidence is never recognition: every signal here can only LOWER
 * what the agent reveals. Nothing in this module reaches the authenticated
 * identity, an access request or the policy engine. Types only, plus one rank
 * constant.
 */
import type { IdentityHint } from '../../adaptive/types';
import type { VoiceNoteInput, VoiceVerification } from './voice-band';

export type IdentityLevel = 'verified' | 'account' | 'unverified';
export type SessionConsistency = 'consistent' | 'uncertain' | 'inconsistent';
export interface StyleHint { readonly source: 'style'; readonly consistency: SessionConsistency; readonly messages: number } // style alone: consistent -> uncertain only
export interface IdentitySignals { readonly accountPersonId: string; readonly verifiedRecently: boolean; readonly voice?: { readonly hint: IdentityHint /* source 'voice_match' */; readonly verification: VoiceVerification }; readonly style?: StyleHint }
export interface IdentityAssessment { readonly level: IdentityLevel; readonly session: SessionConsistency; readonly logOdds: number; readonly capped: boolean }
export interface IdentityService {
  verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification>;
  observeStyle(input: { personaId: string; personId: string; space: 'work'|'personal'; features: StyleFeatures; at: number; personalizationAllowed: boolean }): Promise<{ stored: boolean; hint?: StyleHint }>;
  enroll(input: { personId: string; space: 'work'|'personal'; kind: 'style_baseline'; at: number; personalizationAllowed: boolean }): Promise<{ enrolled: boolean; reason?: string }>;
  assess(signals: IdentitySignals): IdentityAssessment; // hints only lower: level <= (verifiedRecently ? 'verified' : 'account')
}

export type IdentitySpace = 'work' | 'personal';

/** Ordering used to prove "hints only lower": unverified 0, account 1, verified 2. */
export const IDENTITY_LEVEL_RANK: Readonly<Record<IdentityLevel, number>> = Object.freeze({ unverified: 0, account: 1, verified: 2 });

/** Content-free features of ONE message. Never text, tokens, n-grams or hashes of text. */
export interface StyleFeatures {
  readonly version: 1;
  readonly kind: 'text' | 'voice';
  readonly lengthBucket: number;               // 0..6 grapheme bands; 0 for voice
  readonly wordBucket: number;                 // 0..6 word bands; 0 for voice
  readonly persianScriptRatio: number | null;  // Arabic-script letters / letters, step 0.05
  readonly latinScriptRatio: number | null;
  readonly finglishRatio: number | null;       // Finglish-like Latin words / Latin words
  readonly zwnjPerWord: number | null;         // U+200C per Arabic-script word, clamped 0..1
  readonly persianDigitShare: number | null;   // Persian/Arabic-Indic digits / digits
  readonly arabicVariantShare: number | null;  // (ي ك) / (ي ك ی ک)
  readonly latinUpperShare: number | null;
  readonly punctuationPer100: number | null;   // integer 0..50
  readonly persianQuestionShare: number | null;// ؟ / (؟ + ?)
  readonly repeatedPunctuation: boolean;
  readonly endsWithPunctuation: boolean;
  readonly emojiCount: number;                 // 0..5 graphemes
  readonly emoticonCount: number;              // 0..5
  readonly burstIndex: number;                 // 1..10 (message splitting)
  readonly edited: boolean;
  readonly hourBucket: number;                 // 0..7 (3-hour buckets, local by utcOffsetMinutes)
  readonly voiceDurationBucket: number | null; // 0..4, voice only
}
