/**
 * The pet page's words, kept as the old names over the strings module (./strings, keyed by the copy keys file).
 * New code calls `t(key)` directly. Short, warm and never guilt-tripping (brief §1.6): no "I'm hungry", no
 * "I missed you", no numbers next to needs.
 */

import type { NeedKey } from '@/lib/pet/types';
import type { SayKey, SayLine } from '../_engine/types';
import { cleanFirst, t, type PetStringKey } from './strings';

const SAY: Record<SayKey, PetStringKey> = {
  hi: 'say.hi',
  achoo: 'say.achoo',
  hmph: 'say.hmph',
  okayOkay: 'say.okayOkay',
  yum: 'say.yum',
  soFull: 'say.soFull',
  napFirst: 'say.napFirst',
  fiveMore: 'say.fiveMore',
  learned: 'say.learned',
  aww: 'say.aww',
};

/** Bubble text for an engine `say` cue ("Hi Sara!" when we know a usable first name). */
export function sayText(line: SayLine, name?: string): string {
  if (typeof line !== 'string') return line.text;
  const first = line === 'hi' ? cleanFirst(name) : undefined;
  return first ? t('say.hiName', { first }) : t(SAY[line]);
}

/** "First day together" / "{n} days together" (digits allowed here: it counts up, never down). */
export const daysTogetherText = (d: number) => (d <= 1 ? t('chip.firstDay') : t('chip.daysTogether', { n: d }));

/** The needs' names (the lab's sliders), read through `t` at use time. */
export const NEED_LABEL: Record<NeedKey, string> = {
  get tummy() { return t('need.tummy'); },
  get joy() { return t('need.joy'); },
  get energy() { return t('need.energy'); },
};
