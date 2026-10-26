'use client';

import { memo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../strings';
import { ROOM_IDS, ROOM_NAME, stepRoom, stepToward, type RoomId } from '.';

/** The panel the rail controls (the dock zone's room). */
export const ROOM_PANEL_ID = 'pet-room';
export const roomTabId = (id: RoomId) => `pet-room-tab-${id}`;
/** No key in the copy keys file for the rail's own name yet: English only. */
const RAIL_LABEL = 'Rooms';
/** a swipe along the rail: this far sideways, more sideways than up or down */
const RAIL_SWIPE_PX = 36;

const ICON: Record<RoomId, string> = {
  home: 'M4 11.5 12 5l8 6.5V20H4zM10 20v-5h4v5',
  play: 'M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.4l-5.1 2.9 1.1-5.8-4.3-4 5.8-.7z',
  garden: 'M12 20v-8m0 0c0-3.6-2.6-6-6.5-6 0 3.6 2.6 6 6.5 6zm0-1c0-3 2.2-5 5.5-5 0 3-2.2 5-5.5 5z',
  closet: 'M10 6.5a2 2 0 1 1 2 2v1.8L20 16H4l8-5.7',
  bedroom: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
  book: 'M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5zm0 14A1.5 1.5 0 0 0 6.5 21H19',
};

interface RoomRailProps {
  room: RoomId;
  onRoom: (id: RoomId) => void;
  rtl: boolean;
  /** Wide: the rail stands at the side (↑/↓ also move) */
  vertical?: boolean;
}

/**
 * The room rail (design §4, §9.2): one chip per room, Home first, mirrored in Persian. A tab list: tap a chip, or with
 * the keyboard ←/→ (in visual order), Home and End; a sideways swipe along the rail moves one room. What shows per
 * layout class is pet.css's: the current name only (Peek), icons (Short), icons and the current label (Regular), every
 * label (Tall), a side rail (Wide). Labels stay in the accessibility tree at every size. No digits anywhere.
 */
export const RoomRail = memo(function RoomRail({ room, onRoom, rtl, vertical }: RoomRailProps) {
  const tabs = useRef<Partial<Record<RoomId, HTMLButtonElement | null>>>({});
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  /** when a swipe last ended: the click the browser sends after it is not a tap on that chip */
  const suppressClick = useRef(-Infinity);

  const go = (id: RoomId, focus: boolean) => {
    if (id !== room) onRoom(id);
    if (focus) tabs.current[id]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === 'ArrowRight' ? stepRoom(room, rtl ? -1 : 1)
      : e.key === 'ArrowLeft' ? stepRoom(room, rtl ? 1 : -1)
      : vertical && e.key === 'ArrowDown' ? stepRoom(room, 1)
      : vertical && e.key === 'ArrowUp' ? stepRoom(room, -1)
      : e.key === 'Home' ? ROOM_IDS[0]
      : e.key === 'End' ? ROOM_IDS[ROOM_IDS.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    go(next, true);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => { swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) < RAIL_SWIPE_PX || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    // a swipe is not also a tap on the chip it ended on
    e.preventDefault();
    suppressClick.current = performance.now();
    go(stepToward(room, dx < 0 ? 'left' : 'right', rtl), false);
  };

  return (
    <div className="pet-rail" role="tablist" aria-label={RAIL_LABEL} aria-orientation={vertical ? 'vertical' : 'horizontal'}
      onKeyDown={onKey} onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipe.current = null; }}>
      {ROOM_IDS.map((id) => {
        const on = id === room;
        return (
          <button key={id} ref={(el) => { tabs.current[id] = el; }} type="button" role="tab" id={roomTabId(id)} className="pet-room" data-room={id}
            aria-selected={on} aria-controls={ROOM_PANEL_ID} tabIndex={on ? 0 : -1}
            onClick={() => { if (performance.now() - suppressClick.current > 400) go(id, false); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[id]} /></svg>
            <span className="pet-room-label">{t(ROOM_NAME[id])}</span>
          </button>
        );
      })}
    </div>
  );
});
