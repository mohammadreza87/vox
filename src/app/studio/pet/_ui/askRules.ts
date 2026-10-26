/**
 * The proactive asks (design §6.1, §6.2): which permission moment may show now. Pure. The record's `asks` carries the
 * re-ask rule (one decline: only after thirty days and a recurring trigger; two: never on its own; a yes: never again);
 * the page adds one ask a session, never in the first thirty seconds, never during a care animation, a talk turn, a
 * sheet or a game. Triggers are content-free: different days, the forming day, what happened this session.
 */

import type { AskId, PetPlayView } from '@/lib/pet/play';
import { gamesPlayed, type TipSignals } from './tips';

const DAY = 86_400_000;
export const ASK_RULES = {
  /** §6.1 rule 2 */
  quietMs: 30_000,
  /** no ask within this long of a care animation or a touch */
  careMs: 4000,
  reaskMs: 30 * DAY,
  maxDeclines: 2,
  /** "several different games on several days" (P9) */
  games: 2,
  gameDays: 3,
} as const;

/** §5.2: the moment types in the sheet's order; growing up, seasons and garden on once check-ins are on, hellos and care nudges off */
export { CHECKIN_MOMENT_TYPES as CHECKIN_TYPES, CHECKIN_TYPE_DEFAULTS as CHECKIN_DEFAULTS } from '@/lib/pet/checkins';

/** The record allows this ask now (the server's askEligible, on the view's shape). No record: never (nothing could be recorded). */
export function askOk(play: PetPlayView | undefined, id: AskId, now: number): boolean {
  if (!play) return false;
  const a = play.asks[id];
  if (!a) return true;
  if (a.accepted || a.declined >= ASK_RULES.maxDeclines) return false;
  return a.declined === 0 || now - a.lastAskedAt >= ASK_RULES.reaskMs;
}

/** P1's trigger (§6.2): the second different day, or (forming week) the day before a stage-up: forming days 1, 3, 5. */
export function p1Due(sig: TipSignals, formingDay: number | null | undefined): 'plain' | 'forming' | null {
  if (formingDay === 1 || formingDay === 3 || formingDay === 5) return 'forming';
  return sig.days >= 2 ? 'plain' : null;
}
/** P8: a session on the third different day. */
export const p8Due = (sig: TipSignals) => sig.days >= 3;
/** P9: several different games on several days. */
export const p9Due = (sig: TipSignals) => gamesPlayed(sig.games) >= ASK_RULES.games && sig.gameDays >= ASK_RULES.gameDays;

/** The paused note shows once per pause (§5.4): the pause's stamp, as stored on this device once shown. */
/** A fresh client id per tap (8-40 of [A-Za-z0-9_-]): a double tap is one decision on the server. */
export function eventId(): string {
  const a = new Uint8Array(12);
  try { crypto.getRandomValues(a); } catch { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export const PAUSED_KEY = (agentId: string) => `vox.pet.paused.${agentId}`;
export const pausedStamp = (p: { pausedAt?: number | string } | null | undefined) => (p?.pausedAt === undefined || p.pausedAt === null ? null : String(p.pausedAt));

/** A check-in's moment (§5.3) as the page replays it: the catalogue id or the moment's name. */
export type Replay = 'stage' | 'formed' | 'hello' | 'bloom' | 'move' | 'yalda' | 'suri' | 'nowruz' | 'sleepy' | 'guess';
const REPLAY: Record<string, Replay> = {
  C1: 'stage', C2: 'stage', C3: 'formed', C4: 'hello', C5: 'bloom', C6: 'move', C7: 'yalda', C8: 'suri', C9: 'nowruz', C10: 'sleepy', C11: 'guess',
  firstday: 'stage', stageup: 'stage', growingup: 'stage', formed: 'formed', hello: 'hello', hellos: 'hello', bloom: 'bloom', garden: 'bloom',
  newmove: 'move', bond: 'move', yalda: 'yalda', suri: 'suri', nowruz: 'nowruz', sleepy: 'sleepy', carenudge: 'sleepy', guess: 'guess',
};
export function replayOf(momentId: string | undefined): Replay {
  if (!momentId) return 'hello';
  const id = momentId.replace(/^ci\./, '').split('.')[0];
  return REPLAY[id] ?? REPLAY[id.replace(/[^a-z]/gi, '').toLowerCase()] ?? 'hello';
}
