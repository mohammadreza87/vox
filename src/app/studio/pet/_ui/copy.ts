/**
 * Every word the pet page shows. Short, warm and never guilt-tripping (brief §1.6): no "I'm hungry",
 * no "I missed you", no numbers next to needs.
 */

import type { NeedKey } from '@/lib/pet/types';
import type { SayKey, SayLine } from '../_engine/types';

const SAY: Record<SayKey, string> = {
  hi: 'Hi!',
  achoo: 'Achoo!',
  hmph: 'Hmph.',
  okayOkay: 'Okay, okay!',
  yum: 'Yum!',
  soFull: 'So full…',
  napFirst: 'Nap first?',
  fiveMore: 'Five more minutes…',
  learned: 'I learned something new!',
  aww: 'Aww.',
};

/** Bubble text for an engine `say` cue ("Hi Sara!" when we know the first name). */
export function sayText(line: SayLine, name?: string): string {
  if (typeof line !== 'string') return line.text;
  if (line === 'hi' && name) return `Hi ${name}!`;
  return SAY[line];
}

export const NEED_LABEL: Record<NeedKey, string> = { tummy: 'Tummy', joy: 'Joy', energy: 'Energy' };

export const COPY = {
  talkTo: (name: string) => `Talk to ${name}`,
  chatInTelegram: 'Chat in Telegram',
  connectAccount: 'Connect an account',
  connectAccountFor: (name: string) => `Connect an account for ${name}`,
  send: 'Send',
  holdToTalk: 'Hold to talk',
  recording: 'Listening… release to send',
  micBlocked: 'Mic is off, so type instead',
  more: 'more',
  less: 'less',
  feed: 'Feed',
  play: 'Play ball',
  rest: 'Put to bed',
  feedHint: 'Drag the cookie to the mouth, or tap it',
  daysTogether: (d: number) => (d <= 1 ? 'First day together' : `${d} days together`),
  privateTitle: 'This one’s private',
  privateBody: 'Only the people this agent works with can visit.',
  outsideTitle: 'Open me in Telegram',
  outsideBody: 'Tap the menu button in the bot’s chat.',
  restingTitle: 'Resting',
  restingBody: 'This one is not around right now.',
  unavailableTitle: 'Can’t open this pet',
  unavailableBody: 'Try again in a moment, or reopen it from the bot’s chat.',
  offlineTitle: 'Can’t reach the cloud',
  offlineBody: 'Check the connection and try again.',
  retry: 'Try again',
  close: 'Close Mini App',
  chatAccessTitle: 'Chat access is off',
  chatAccessBody: 'Open Vox Studio, go to You, choose Work, then Agent access and allow this agent. Then reopen this Mini App.',
  talkFailed: 'Hmm, I lost my words. Try again?',
  didntCatch: 'I didn’t catch that. Try again?',
  forgetAsk: (name: string) => `Forget care for all your pets, including ${name}? Needs and Bond start over for every pet; your chats stay.`,
  score: (n: number) => `${n}`,
} as const;
