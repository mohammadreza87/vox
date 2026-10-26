'use client';

import type { RoomProps } from '.';
import { RoomSoon } from './RoomSoon';

/** Closet: the head, neck and hand slots (§4.3). Wave A: the placeholder; Wave B gives the room its verbs. */
export default function ClosetRoom(p: RoomProps) {
  return <RoomSoon {...p} />;
}
