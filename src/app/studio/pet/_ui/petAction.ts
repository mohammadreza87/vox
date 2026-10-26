/**
 * pet_action (design §8.4): a talk turn's classified request ("time for bed", "let's play in the garden") acted on
 * by the page, only at confidence ≥ PET_ACTION_MIN, only once the spoken reply has ended, never while a sheet or a
 * game owns the moment, and only as a reversible UI move through the existing paths: the dock's toy verbs (so care
 * goes through the toy's own animation and its confirmation cue), a room switch, or Guess starting in Play.
 */

import type { PetActionKind, TalkAction } from './contract';
import type { PetHost } from './host';
import type { AwayRoom } from './rooms';
import { roomIntent } from './rooms/intent';

/** The skills router's apply-without-asking bar (src/lib/studio/skills/route.ts), as §8.4 sets it. */
export const PET_ACTION_MIN = 0.75;
/** how long the page waits for the reply to finish saying itself; a newer turn or a later reply drops the action */
const SAY_WAIT_MS = 60_000;
const POLL_MS = 200;
/** a beat after the mouth closes, so the move reads as the answer to the words */
const AFTER_MS = 500;

const OPEN: Partial<Record<PetActionKind, AwayRoom>> = { open_play: 'play', open_garden: 'garden', open_closet: 'closet', open_bedroom: 'bedroom', open_life_book: 'book' };

/** The action to take for a reply, or null (none, unknown, under the bar, malformed). */
export function actionOf(a: TalkAction | undefined): PetActionKind | null {
  if (!a || typeof a.confidence !== 'number' || !(a.confidence >= PET_ACTION_MIN)) return null;
  return a.kind === 'none' || !(a.kind in OPEN || a.kind === 'feed' || a.kind === 'play_ball' || a.kind === 'sleep' || a.kind === 'start_guess') ? null : a.kind;
}

/** Do it now (the caller checked the moment): care verbs through the toys, rooms through the rail. */
export function perform(host: PetHost, kind: PetActionKind, later: (ms: number, fn: () => void) => void): void {
  const room = OPEN[kind];
  if (room) { host.setRoom(room); return; }
  if (kind === 'start_guess') { roomIntent.guess = 'start'; if (host.room() === 'play') host.emit({ type: 'room', room: 'play' }); else host.setRoom('play'); return; }
  if (kind === 'sleep' && host.care()?.asleep) return;
  // the toys live on Home (the moon in the Bedroom too): go there first, then the verb once the room has arrived
  const here = host.room();
  const at = kind === 'sleep' ? here === 'home' || here === 'bedroom' : kind === 'play_ball' ? here === 'home' || here === 'play' : here === 'home';
  const go = () => host.toyEvent(kind === 'feed' ? { type: 'cookieTap' } : kind === 'sleep' ? { type: 'moonTap' } : { type: 'ballTap' });
  if (at) { go(); return; }
  host.setRoom('home');
  later(700, go);
}

/**
 * Watch the host's replies: an action waits for the reply to be said (talk back to idle), then plays unless a sheet or
 * a game is open by then (dropped, never queued), or a newer reply came. Returns the unsubscribe.
 */
export function watchPetActions(host: PetHost, later: (ms: number, fn: () => void) => void): () => void {
  let turn = 0;
  return host.on((s) => {
    if (s.type !== 'reply') return;
    const mine = ++turn;
    const kind = actionOf(s.action);
    if (!kind) return;
    const until = performance.now() + SAY_WAIT_MS;
    const check = () => {
      if (mine !== turn) return;
      if (host.talk() !== 'idle') { if (performance.now() < until) later(POLL_MS, check); return; }
      later(AFTER_MS, () => { if (mine === turn && host.talk() === 'idle' && !host.isBusy()) perform(host, kind, later); });
    };
    later(POLL_MS, check);
  });
}
