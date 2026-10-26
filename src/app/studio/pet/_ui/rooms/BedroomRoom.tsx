'use client';

import type { RoomProps } from '.';
import { RoomSoon } from './RoomSoon';

/** Bedroom: lamp, story, moon (§4.4). Wave A: the placeholder; Wave B gives the room its verbs. */
export default function BedroomRoom(p: RoomProps) {
  return <RoomSoon {...p} />;
}
