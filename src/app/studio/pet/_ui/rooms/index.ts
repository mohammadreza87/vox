/**
 * Rooms are verbs (design §4): one character and one engine across every room; a room swaps the dock's three verbs.
 * Home is today's care surface (the Dock, loaded with the page). Every other room is its own lazily loaded component:
 * Wave A ships a small placeholder for each (the room's name and its three verbs), Wave B fills them in.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PetStringKey } from '../strings';

/** Room order, left to right in English and right to left in Persian (design §4). */
export const ROOM_IDS = ['home', 'play', 'garden', 'closet', 'bedroom', 'book'] as const;
export type RoomId = (typeof ROOM_IDS)[number];
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

/** What every room component receives. Wave B widens it (engine, view, care) as rooms gain verbs. */
export interface RoomProps { id: AwayRoom }

/** One chunk per room: the Home page never carries them. */
export const ROOM_VIEW: Record<AwayRoom, LazyExoticComponent<ComponentType<RoomProps>>> = {
  play: lazy(() => import('./PlayRoom')),
  garden: lazy(() => import('./GardenRoom')),
  closet: lazy(() => import('./ClosetRoom')),
  bedroom: lazy(() => import('./BedroomRoom')),
  book: lazy(() => import('./BookRoom')),
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
