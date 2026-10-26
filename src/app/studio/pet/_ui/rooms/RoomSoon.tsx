'use client';

import { t } from '../strings';
import { ROOM_NAME, ROOM_VERBS, type RoomProps } from '.';
import './rooms.css';

/**
 * A room that is not built yet (Wave A): where the dock sits, the room's name and its three verbs, "Seed · Rain ·
 * Breathe". No numbers, no "coming soon" pressure; the character and the talk pill stay as they are.
 */
export function RoomSoon({ id }: RoomProps) {
  return (
    <div className="pet-soon" data-room={id}>
      <b>{t(ROOM_NAME[id])}</b>
      <span>{ROOM_VERBS[id].map((k) => t(k)).join(' · ')}</span>
    </div>
  );
}
