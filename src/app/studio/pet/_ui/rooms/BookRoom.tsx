'use client';

import type { RoomProps } from '.';
import { RoomSoon } from './RoomSoon';

/** Life Book: pages, keepsakes, visits (§4.7). Wave A: the placeholder; Wave B gives the room its verbs. */
export default function BookRoom(p: RoomProps) {
  return <RoomSoon {...p} />;
}
