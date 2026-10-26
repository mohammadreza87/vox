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

/** Screen-reader words for the needs. Not in the copy keys file yet, so English only. */
export const NEED_LABEL: Record<NeedKey, string> = { tummy: 'Tummy', joy: 'Joy', energy: 'Energy' };

/** "First day together" / "{n} days together" (digits allowed here: it counts up, never down). */
export const daysTogetherText = (d: number) => (d <= 1 ? t('chip.firstDay') : t('chip.daysTogether', { n: d }));

/** The old flat names, read through `t` at use time (so they follow the page's language). */
export const COPY = {
  talkTo: (name: string) => t('talk.placeholder', { name }),
  get chatInTelegram() { return t('talk.chatInTelegram'); },
  /** no key in the copy keys file yet: English only */
  send: 'Send',
  get holdToTalk() { return t('talk.holdToTalk'); },
  get recording() { return t('talk.recording'); },
  get micBlocked() { return t('talk.micBlocked'); },
  get more() { return t('ui.more'); },
  get less() { return t('ui.less'); },
  get feed() { return t('toy.feed'); },
  get play() { return t('toy.ball'); },
  get rest() { return t('toy.moon'); },
  get feedHint() { return t('toy.feedHint'); },
  daysTogether: daysTogetherText,
  get privateTitle() { return t('quiet.private.title'); },
  get privateBody() { return t('quiet.private.body'); },
  get outsideTitle() { return t('quiet.outside.title'); },
  get outsideBody() { return t('quiet.outside.body'); },
  get restingTitle() { return t('quiet.resting.title'); },
  get restingBody() { return t('quiet.resting.body'); },
  get unavailableTitle() { return t('quiet.unavailable.title'); },
  get unavailableBody() { return t('quiet.unavailable.body'); },
  get offlineTitle() { return t('quiet.offline.title'); },
  get offlineBody() { return t('quiet.offline.body'); },
  get retry() { return t('ui.retry'); },
  get close() { return t('ui.close'); },
  get chatAccessTitle() { return t('quiet.chatAccess.title'); },
  get chatAccessBody() { return t('quiet.chatAccess.body'); },
  get talkFailed() { return t('talk.failed'); },
  get reopen() { return t('talk.reopen'); },
  /** the Persian line whatever the page language (needs the Persian catalogue loaded) */
  get reopenFa() { return t('talk.reopen', undefined, 'fa'); },
  get didntCatch() { return t('talk.didntCatch'); },
  score: (n: number) => `${n}`,
};
