/**
 * Net-speech guard for S11L voiceprints. Pure functions only.
 *
 * No audio is decoded here: the repo has no Opus decoder and package.json
 * belongs to S15, so net speech comes from the provider's diarization through
 * SpeechActivity (provider.ts). grossTooShort() is the free pre-gate that
 * runs on Telegram's declared duration before any upload or provider call.
 */
import { MIN_NET_SPEECH_MS } from '../../tireh/identity/voice-band';

export { MIN_NET_SPEECH_MS } from '../../tireh/identity/voice-band';

/** One enrollment clip needs at least 10 s of net speech (docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.9). */
export const ENROLL_MIN_NET_SPEECH_MS = 10_000;

/** True only when the declared duration is a finite number below the 3 s floor. */
export function grossTooShort(durationSec: number | undefined): boolean {
  return typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec * 1000 < MIN_NET_SPEECH_MS;
}

/** Sum of speech segments in milliseconds; overlaps are merged, negative or NaN values ignored. Segments are in seconds. */
export function netSpeechFromSegments(segments: readonly { start: number; end: number }[]): number {
  const valid = segments
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end >= 0 && s.end > s.start)
    .map(s => [s.start, s.end] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of valid) {
    if (current && start <= current[1]) current[1] = Math.max(current[1], end);
    else {
      if (current) total += current[1] - current[0];
      current = [start, end];
    }
  }
  if (current) total += current[1] - current[0];
  return Math.round(total * 1000);
}

export function meetsNetSpeech(ms: number, floor = MIN_NET_SPEECH_MS): boolean {
  return Number.isFinite(ms) && ms >= floor;
}
