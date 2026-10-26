import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EN } from '../strings/en';
import { FA } from '../strings/fa';
import { ROOM_IDS, ROOM_NAME, ROOM_VERBS, stepRoom, stepToward, type RoomId } from '.';
import { RoomRail } from './RoomRail';

function Rail({ rtl = false, vertical = false, start = 'home' as RoomId, onRoom = vi.fn() }) {
  const [room, setRoom] = useState<RoomId>(start);
  return <RoomRail room={room} rtl={rtl} vertical={vertical} onRoom={(r) => { onRoom(r); setRoom(r); }} />;
}
const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!.textContent;

describe('RoomRail', () => {
  it('is a tab list of six rooms, Home first and selected, with one tab in the tab order', () => {
    render(<Rail />);
    expect(screen.getByRole('tablist', { name: 'Rooms' })).toHaveAttribute('aria-orientation', 'horizontal');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Play', 'Garden', 'Closet', 'Bedroom', 'Life Book']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    expect(tabs.every((t) => t.getAttribute('aria-controls') === 'pet-room')).toBe(true);
    expect(screen.getByRole('tablist').textContent).not.toMatch(/\d/);
  });

  it('a tap selects; ← → move in visual order, Home and End jump, and focus follows', () => {
    render(<Rail />);
    fireEvent.click(screen.getByRole('tab', { name: 'Closet' }));
    expect(selected()).toBe('Closet');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Closet' }), { key: 'ArrowRight' });
    expect(selected()).toBe('Bedroom');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Bedroom' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(selected()).toBe('Closet');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(selected()).toBe('Life Book');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(selected()).toBe('Life Book');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(selected()).toBe('Home');
    expect(screen.getByRole('tab', { name: 'Home' }).tabIndex).toBe(0);
  });

  it('in Persian (rtl) the rail is mirrored: → goes toward Home, ← away from it', () => {
    render(<Rail rtl start="garden" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Garden' }), { key: 'ArrowRight' });
    expect(selected()).toBe('Play');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(selected()).toBe('Closet');
  });

  it('Wide: a vertical rail also moves with ↑ ↓', () => {
    render(<Rail vertical />);
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Home' }), { key: 'ArrowDown' });
    expect(selected()).toBe('Play');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(selected()).toBe('Home');
  });

  it('a swipe along the rail moves one room (mirrored in rtl) and is not also a tap on the chip under the finger', () => {
    const onRoom = vi.fn();
    const { rerender } = render(<Rail onRoom={onRoom} />);
    const rail = screen.getByRole('tablist');
    fireEvent.pointerDown(rail, { pointerId: 1, clientX: 200, clientY: 10 });
    fireEvent.pointerUp(rail, { pointerId: 1, clientX: 120, clientY: 14 });
    fireEvent.click(screen.getByRole('tab', { name: 'Closet' }));
    expect(onRoom.mock.calls).toEqual([['play']]);
    // too short, or mostly vertical: nothing
    fireEvent.pointerDown(rail, { pointerId: 2, clientX: 200, clientY: 10 });
    fireEvent.pointerUp(rail, { pointerId: 2, clientX: 180, clientY: 10 });
    expect(onRoom).toHaveBeenCalledTimes(1);
    // rtl: the finger moving right brings the next room in
    rerender(<Rail rtl onRoom={onRoom} />);
    fireEvent.pointerDown(rail, { pointerId: 3, clientX: 100, clientY: 10 });
    fireEvent.pointerUp(rail, { pointerId: 3, clientX: 180, clientY: 12 });
    expect(onRoom).toHaveBeenLastCalledWith('garden');
  });

  it('stepping never wraps; a leftward move is "next" in English and "previous" in Persian', () => {
    expect(stepRoom('home', -1)).toBe('home');
    expect(stepRoom('book', 1)).toBe('book');
    expect(stepToward('home', 'left', false)).toBe('play');
    expect(stepToward('home', 'right', true)).toBe('play');
    expect(stepToward('play', 'left', true)).toBe('home');
  });

  it('every room name and verb is in the catalogue in both languages, with no digits', () => {
    for (const id of ROOM_IDS) {
      for (const k of [ROOM_NAME[id], ...ROOM_VERBS[id]]) {
        expect(EN[k], k).toBeTruthy();
        expect(FA[k], k).toBeTruthy();
        expect(`${EN[k]}${FA[k]}`, k).not.toMatch(/[0-9۰-۹]/);
      }
    }
  });
});
