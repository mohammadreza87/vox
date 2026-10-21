/**
 * The one seam between the page and care.ts (brief §3.7: identical decay on client and server).
 * Optimistic care and the ?mock=1 fake both go through here, so a care.ts signature change is
 * reconciled in this file only.
 */

import { apply, decay, mood, open, talk, type Opened } from '@/lib/pet/care';
import type { Mood, PetAction, PetCare, PetGuard, Stage } from '@/lib/pet/types';

/** Decay up to `now` (server clock plus the time since it answered), in the care's own zone. */
export const decayTo = (care: PetCare, now: number): PetCare => decay(care, now, care.tz);

/** The action as the server will apply it, guards and caps included (never a block). */
export function applyLocal(care: PetCare, action: PetAction, now: number, n?: number): { care: PetCare; guard?: PetGuard } {
  return apply(decayTo(care, now), action, now, n);
}

export const moodOf = (care: PetCare): Mood => mood(care);

/* the ?mock=1 fake plays the server's part with the server's own functions */
export const openLocal = (care: PetCare, now: number, stage: Stage): Opened => open(decayTo(care, now), now, stage);
export const talkLocal = (care: PetCare, now: number): PetCare => talk(decayTo(care, now), now).care;
