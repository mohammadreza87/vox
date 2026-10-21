/**
 * Every reaction event kind → its pure reaction (brief §3.4): `(event, ctx) → Beat[]`, no DOM, no timers, no
 * Math.random. The loop prepares and plays the beats.
 */

import type { EventOf, ReactionCtx, ReactionEvent, ReactionKind, ReactionTable } from '../types';
import { celebrate } from './celebrate';
import { feed, refuse, tooFull } from './feed';
import { hello, stageUp, welcomeBack } from './hello';
import { ambient, bored, fidgetLong, fidgetSmall, sad, signature, wants } from './mood';
import { ballNear, bop, miss, playEnd, playStart } from './play';
import { doze, dream, sleep, sleepPoke, wake, yawn } from './sleep';
import { ack, listen, nod, onset, speakEnd, speakStart, think, typingPause, viseme, wave } from './talk';
import { dragStart, drag, droopy, fling, land, longPress, overpoke, pet, poke, shake, tickle, wallHit } from './touch';

export const REACTIONS: ReactionTable = {
  hello, welcomeBack, stageUp,
  fidgetSmall, fidgetLong, ambient, signature, bored, wants, droopy, sad, doze,
  poke, pet, tickle, overpoke, longPress, dragStart, drag, fling, wallHit, land, shake,
  feed, tooFull,
  playStart, ballNear, bop, miss, playEnd,
  yawn, sleep, dream, sleepPoke, wake,
  listen, typingPause, ack, think, speakStart, viseme, onset, speakEnd, nod, wave,
  celebrate, refuse,
};

/** Run the reaction for an event (the table is typed per kind; this narrows it back). */
export function react<K extends ReactionKind>(e: EventOf<K>, ctx: ReactionCtx) {
  return (REACTIONS[e.type as K] as (e: ReactionEvent, ctx: ReactionCtx) => ReturnType<ReactionTable[K]>)(e, ctx);
}
