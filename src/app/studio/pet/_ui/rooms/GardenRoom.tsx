'use client';

import type { RoomProps } from '.';
import { RoomSoon } from './RoomSoon';

/** Garden: seed, rain, breathe (§4.5). Wave A: the placeholder; Wave B gives the room its verbs. */
export default function GardenRoom(p: RoomProps) {
  return <RoomSoon {...p} />;
}
