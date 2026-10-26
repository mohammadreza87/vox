/** A recording PetHost for the Wave B chunks' tests (rooms, Extras): every action is a vi.fn, getters read `state`. */

import { vi } from 'vitest';
import type { PetCare } from '@/lib/pet/types';
import type { PetPlayView } from '@/lib/pet/play';
import type { PetApi, PetEngine, PetViewB, TalkState } from './contract';
import type { HostSignal, PetHost } from './host';
import type { RoomId } from './rooms';

export const emptyPlay = (o: Partial<PetPlayView> = {}): PetPlayView => ({
  items: [], wearing: {}, garden: null, book: [], games: {}, tips: {}, asks: {}, seasons: {}, litMine: [], tipsToday: 0, ...o,
});

export const care = (o: Partial<PetCare> = {}): PetCare => ({
  v: 1, agentId: 'a', userId: 1, tummy: 70, joy: 70, energy: 70, bond: 10, asleep: false, lastUpdatedAt: 0, lastSeenAt: 0, firstMetAt: 0,
  tz: 'UTC', quietStart: 22, quietEnd: 8, lastSeenStage: 3, caps: { hourStart: 0, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: 0 }, ...o,
});

export const fakeEngine = () => ({
  roomReact: vi.fn(), fire: vi.fn(), setGaze: vi.fn(), lightMoment: vi.fn(), setDetails: vi.fn(), setListening: vi.fn(), talk: vi.fn(),
  onMotion: vi.fn(() => () => {}),
}) as unknown as PetEngine & Record<string, ReturnType<typeof vi.fn>>;

export interface FakeHost extends PetHost {
  state: { view: PetViewB | null; care: PetCare | null; talk: TalkState; room: RoomId; bubble: boolean; busy: Set<string> };
  signals: HostSignal[];
  fire(s: HostSignal): void;
  said: string[];
  engineFake: ReturnType<typeof fakeEngine>;
}

export function fakeHost(view: Partial<PetViewB> = {}, o: { api?: Partial<PetApi>; lang?: 'en' | 'fa'; root?: HTMLElement | null } = {}): FakeHost {
  const listeners = new Set<(s: HostSignal) => void>();
  const engine = fakeEngine();
  const c = view.care ?? care();
  const state: FakeHost['state'] = {
    view: { agentId: 'a', name: 'Mochi', look: {} as never, stage: 3, formingDay: null, botUsername: 'b', voice: true, listen: true, role: 'owner',
      care: c, now: 0, play: emptyPlay(), ...view } as PetViewB,
    care: c, talk: 'idle', room: 'home', bubble: false, busy: new Set(),
  };
  const said: string[] = [];
  const signals: HostSignal[] = [];
  const h: FakeHost = {
    agentId: 'a', lang: o.lang ?? 'en', openedAt: -1e9,
    api: { get: vi.fn(), care: vi.fn(), talk: vi.fn(), talkVoice: vi.fn(), ...o.api } as PetApi,
    state, said, signals, engineFake: engine,
    view: () => state.view, care: () => state.care, engine: () => engine, talk: () => state.talk,
    room: () => state.room, setRoom: vi.fn((r: RoomId) => { state.room = r; }),
    box: () => ({ x: 95, y: 200, size: 200 }), root: () => o.root ?? document.body, toy: vi.fn(() => null), audio: vi.fn(() => null),
    say: vi.fn((s: string) => { said.push(s); return true; }), bubbleShown: () => state.bubble,
    act: vi.fn(), toyEvent: vi.fn(),
    play: vi.fn(async () => ({ play: state.view!.play!, now: 0 })),
    adoptGrowth: vi.fn((g) => { state.view = { ...state.view!, growth: g }; h.fire({ type: 'view' }); }),
    focusTalk: vi.fn(), busy: vi.fn((k: string, on: boolean) => { if (on) state.busy.add(k); else state.busy.delete(k); }), isBusy: () => state.busy.size > 0,
    lastActive: () => -1e9,
    on: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    emit: vi.fn((s: HostSignal) => { signals.push(s); }),
    fire: (s) => { for (const f of listeners) f(s); },
    setVoice: vi.fn(), sendVoice: vi.fn(), hush: vi.fn(), micOk: vi.fn(),
  };
  return h;
}
