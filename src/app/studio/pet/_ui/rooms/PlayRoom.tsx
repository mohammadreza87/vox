'use client';

import type { RoomProps } from '.';
import { RoomSoon } from './RoomSoon';

/** Play: Bop, Starfall, Hum (§4.2). Wave A: the placeholder; Wave B gives the room its verbs. */
export default function PlayRoom(p: RoomProps) {
  return <RoomSoon {...p} />;
}
