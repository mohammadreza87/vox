/**
 * What the living page lends its lazy Wave B chunks (rooms, tips, sheets, hands-free, the growth watcher): live getters
 * and a few actions, never React state. Types only, so the route carries none of it. PetApp builds one per session.
 */

import type { PetAction, PetCare } from '@/lib/pet/types';
import type { MotionCue } from '../_engine/types';
import type { PetApi, PetEngine, PetViewB, PlayRequest, PlayResponse, TalkAction, TalkState, ToyEvent, ToyKind } from './contract';
import type { RoomId } from './rooms';
import type { CharacterBox } from './scene';
import type { PetLang } from './strings';

/** Content-free things the page saw (the tip signals, design §7.3), and the moments the chunks react to. */
export type HostSignal =
  | { type: 'toy'; e: ToyEvent }
  /** the character took a pointer (poke, stroke, drag) */
  | { type: 'body' }
  | { type: 'care'; action: PetAction }
  | { type: 'typed' }
  | { type: 'held' }
  | { type: 'room'; room: RoomId }
  /** a fresh view or play record was adopted */
  | { type: 'view' }
  /** a talk reply landed; `saved`: the server said an explicit "remember this" save happened */
  | { type: 'reply'; saved: boolean; said: string; moment?: string; action?: TalkAction }
  /** a moment worth sharing happened on screen (P7): a stage-up, a bloom, a festival */
  | { type: 'moment'; kind: 'stage' | 'bloom' | 'season'; id?: string }
  /** a game round ended after `ms` */
  | { type: 'round'; ms: number; zen: boolean; game?: 'bop' | 'starfall' | 'guess' | 'hum' }
  | { type: 'motion'; cue: MotionCue }
  /** the mic was pressed before the UX-02 sheet was answered, or the hands-free switch was tapped */
  | { type: 'micAsk' }
  | { type: 'handsFree' }
  /** a long-press on the pet's bubble (a tip's reason line, §3.6) */
  | { type: 'bubbleHold' };

export interface PetHost {
  readonly agentId: string;
  readonly lang: PetLang;
  readonly api: PetApi;
  view(): PetViewB | null;
  care(): PetCare | null;
  engine(): PetEngine | null;
  talk(): TalkState;
  room(): RoomId;
  setRoom(r: RoomId): void;
  box(): CharacterBox;
  root(): HTMLElement | null;
  toy(kind: ToyKind): HTMLElement | null;
  /** the page's one AudioContext (made on the first touch) */
  audio(): AudioContext | null;
  /** a pet line in the bubble (the person's conversation is never replaced: false when it could not show) */
  say(text: string): boolean;
  bubbleShown(): boolean;
  /** a finished care action, through the same optimistic sync as the dock */
  act(action: PetAction): void;
  /** a toy verb, through the same rules as the dock (full, tired) */
  toyEvent(e: ToyEvent): void;
  /** POST play and adopt the answer's record; null when the server has no play route or it failed */
  play(req: PlayRequest): Promise<PlayResponse | null>;
  /** adopt a new growth block (confirm, a refresh) */
  adoptGrowth(g: NonNullable<PetViewB['growth']>): void;
  focusTalk(): void;
  /** send a talk turn as the person's own words (Guess's chips); resolves false when it failed. Optional: Wave C glue. */
  send?(text: string): Promise<boolean>;
  /** adopt part of the view (a look the creator saved, §4.3). Optional: Wave C glue. */
  patch?(part: Partial<PetViewB>): void;
  /** a sheet or game owns the moment: no tip, no ask meanwhile (§6.1, §7.1) */
  busy(key: string, on: boolean): void;
  isBusy(): boolean;
  /** the last time anything happened on the page (touch, cue, talk), performance.now() */
  lastActive(): number;
  readonly openedAt: number;
  on(fn: (s: HostSignal) => void): () => void;
  /** tell the other chunks (a round ended) */
  emit(s: HostSignal): void;
  /** hands-free and the mic sheet tell the pill what to show */
  setVoice(v: Partial<VoiceUi>): void;
  /** a recording to send as a voice turn (hands-free utterances) */
  sendVoice(audio: Blob, handsFree: boolean): void;
  /** stop the pet's voice now (barge-in): the playing sentence and the queue */
  hush(): void;
  /** the mic sheet's answer for this session (the pill's next hold records) */
  micOk(on: boolean): void;
}

/** What the pill shows for voice beyond hold-to-talk (TalkPill props). */
export interface VoiceUi {
  /** the hands-free switch is offered (the device can, and it was not declined this session) */
  handsFree: boolean;
  /** hands-free is on */
  open: boolean;
  /** hands-free hears speech right now */
  hearing: boolean;
  /** a one-off line under the pill (auto-off, unavailable) */
  note?: string;
}
