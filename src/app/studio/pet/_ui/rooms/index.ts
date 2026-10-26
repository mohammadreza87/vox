/**
 * Rooms are verbs (design §4): one character and one engine across every room; a room swaps the dock's three verbs.
 * Home is today's care surface (the Dock, loaded with the page). Every other room is its own lazily loaded component:
 * Wave A ships a small placeholder for each (the room's name and its three verbs), Wave B fills them in.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { ROOM_ORDER, type Room } from '../../_engine/types';
import type { PetHost } from '../host';
import { loadStrings, type PetStringKey } from '../strings';

/** Room order, left to right in English and right to left in Persian (design §4): the engine's, so they cannot drift. */
export const ROOM_IDS: readonly Room[] = ROOM_ORDER;
export type RoomId = Room;
export type AwayRoom = Exclude<RoomId, 'home'>;

export const ROOM_NAME: Record<RoomId, PetStringKey> = {
  home: 'room.home', play: 'room.play', garden: 'room.garden', closet: 'room.closet', bedroom: 'room.bedroom', book: 'room.book',
};

/** Each room's three dock verbs (design §4 table), the one-line purpose its placeholder shows. Home's are the Dock's toys. */
export const ROOM_VERBS: Record<RoomId, readonly [PetStringKey, PetStringKey, PetStringKey]> = {
  home: ['toy.feed', 'toy.ball', 'toy.moon'],
  play: ['toy.play.bop', 'toy.play.starfall', 'toy.play.hum'],
  garden: ['toy.garden.seed', 'toy.garden.rain', 'toy.garden.breathe'],
  closet: ['toy.closet.head', 'toy.closet.neck', 'toy.closet.hand'],
  bedroom: ['toy.bed.lamp', 'toy.bed.story', 'toy.bed.moon'],
  book: ['toy.book.pages', 'toy.book.keepsakes', 'toy.book.visits'],
};

/** What every room component receives: the page's host (engine, view, care, actions) and the few values it re-renders on. */
export interface RoomProps {
  id: AwayRoom;
  host?: PetHost;
  /** the pet is asleep (Bedroom: the moon wakes, the lamp follows) */
  asleep?: boolean;
  /** the view as last adopted (a play answer, a refresh): the room re-renders on it and reads host.view() */
  view?: unknown;
}

/** A room's chunk, painted once the catalogue has loaded too (its verbs are not in CORE); offline, CORE's room names stand. */
const room = <M,>(chunk: Promise<M>): Promise<M> => Promise.all([chunk, loadStrings().catch(() => {})]).then(([m]) => m);

/** One chunk per room: the Home page never carries them. */
export const ROOM_VIEW: Record<AwayRoom, LazyExoticComponent<ComponentType<RoomProps>>> = {
  play: lazy(() => room(import('./PlayRoom'))),
  garden: lazy(() => room(import('./GardenRoom'))),
  closet: lazy(() => room(import('./ClosetRoom'))),
  bedroom: lazy(() => room(import('./BedroomRoom'))),
  book: lazy(() => room(import('./BookRoom'))),
};

export const isRoom = (s: unknown): s is RoomId => typeof s === 'string' && (ROOM_IDS as readonly string[]).includes(s);

/** The neighbour room, never wrapping: `by` +1 is the next room in reading order. */
export function stepRoom(room: RoomId, by: 1 | -1): RoomId {
  const i = ROOM_IDS.indexOf(room) + by;
  return ROOM_IDS[Math.max(0, Math.min(ROOM_IDS.length - 1, i))];
}

/**
 * A sideways move (a flick on the background, a swipe on the rail) as a room step: the finger pulls the
 * next room in from the reading end, so a leftward move is "next" in English and "previous" in Persian.
 */
export const stepToward = (room: RoomId, toward: 'left' | 'right', rtl: boolean): RoomId =>
  stepRoom(room, (toward === 'left') !== rtl ? 1 : -1);
