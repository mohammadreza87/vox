import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dock } from './Dock';

const fill = (btn: HTMLElement) => Number(btn.querySelector('.pet-ring-fill')!.getAttribute('stroke-dashoffset'));
const C = 2 * Math.PI * 30;

describe('Dock', () => {
  it('draws each need as a ring around its toy, never as a number', () => {
    render(<Dock needs={{ tummy: 100, joy: 50, energy: 25 }} onToy={vi.fn()} />);
    const cookie = screen.getByRole('button', { name: 'Feed' });
    const ball = screen.getByRole('button', { name: 'Play ball' });
    const moon = screen.getByRole('button', { name: 'Put to bed' });
    expect(fill(cookie)).toBeCloseTo(0);
    expect(fill(ball)).toBeCloseTo(C * 0.5);
    expect(fill(moon)).toBeCloseTo(C * 0.75);
    expect(screen.getByRole('group', { name: 'Toys' }).textContent).not.toMatch(/\d/);
  });

  it('wiggles only the toys whose need is in "wants" (< 55)', () => {
    render(<Dock needs={{ tummy: 54, joy: 55, energy: 90 }} onToy={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Feed' })).toHaveAttribute('data-wants');
    expect(screen.getByRole('button', { name: 'Play ball' })).not.toHaveAttribute('data-wants');
    expect(screen.getByRole('button', { name: 'Put to bed' })).not.toHaveAttribute('data-wants');
  });

  it('draws empty tracks until the care state is known', () => {
    render(<Dock needs={null} onToy={vi.fn()} />);
    expect(fill(screen.getByRole('button', { name: 'Feed' }))).toBeCloseTo(C);
  });

  it('a tap on the cookie arcs it into the mouth; the ball starts Bop; the moon puts it to bed', () => {
    const onToy = vi.fn();
    render(<Dock needs={{ tummy: 60, joy: 60, energy: 60 }} onToy={onToy} />);
    const cookie = screen.getByRole('button', { name: 'Feed' });
    fireEvent.pointerDown(cookie, { pointerId: 1, clientX: 80, clientY: 700 });
    fireEvent.pointerUp(cookie, { pointerId: 1, clientX: 82, clientY: 701 });
    // the click the browser sends after that tap is not a second feed
    fireEvent.click(cookie);
    fireEvent.click(screen.getByRole('button', { name: 'Play ball' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put to bed' }));
    expect(onToy.mock.calls.map((c) => c[0])).toEqual([{ type: 'cookieTap' }, { type: 'ballTap' }, { type: 'moonTap' }]);
  });

  it('drags the cookie: lift after 10 px, follow the finger, drop where it is let go', () => {
    const onToy = vi.fn();
    render(<Dock needs={{ tummy: 60, joy: 60, energy: 60 }} onToy={onToy} />);
    const cookie = screen.getByRole('button', { name: 'Feed' });
    fireEvent.pointerDown(cookie, { pointerId: 3, clientX: 80, clientY: 700 });
    fireEvent.pointerMove(cookie, { pointerId: 3, clientX: 84, clientY: 696 });
    expect(onToy).not.toHaveBeenCalled();
    fireEvent.pointerMove(cookie, { pointerId: 3, clientX: 100, clientY: 600 });
    expect(cookie).toHaveAttribute('data-lifted');
    fireEvent.pointerMove(cookie, { pointerId: 3, clientX: 180, clientY: 380 });
    fireEvent.pointerUp(cookie, { pointerId: 3, clientX: 190, clientY: 360 });
    expect(onToy.mock.calls.map((c) => c[0])).toEqual([
      { type: 'cookieLift', at: { x: 100, y: 600 } },
      { type: 'cookieMove', at: { x: 100, y: 600 } },
      { type: 'cookieMove', at: { x: 180, y: 380 } },
      { type: 'cookieDrop', at: { x: 190, y: 360 } },
    ]);
    expect(cookie).not.toHaveAttribute('data-lifted');
  });

  it('a click no pointer made feeds (keyboard, screen readers, switch access)', () => {
    const onToy = vi.fn();
    render(<Dock needs={{ tummy: 60, joy: 60, energy: 60 }} onToy={onToy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Feed' }));
    expect(onToy.mock.calls).toEqual([[{ type: 'cookieTap' }]]);
  });

  it('a cancelled drag drops the cookie back at its slot, and the keyboard can feed too', () => {
    const onToy = vi.fn();
    render(<Dock needs={{ tummy: 60, joy: 60, energy: 60 }} onToy={onToy} />);
    const cookie = screen.getByRole('button', { name: 'Feed' });
    fireEvent.pointerDown(cookie, { pointerId: 4, clientX: 80, clientY: 700 });
    fireEvent.pointerMove(cookie, { pointerId: 4, clientX: 80, clientY: 640 });
    fireEvent.pointerCancel(cookie, { pointerId: 4 });
    expect(onToy).toHaveBeenLastCalledWith({ type: 'cookieDrop', at: { x: 80, y: 700 } });
    onToy.mockClear();
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    // Enter/Space on a button is a click with no pointer
    fireEvent.click(cookie);
    expect(onToy).toHaveBeenLastCalledWith({ type: 'cookieTap' });
    vi.restoreAllMocks();
  });
});
