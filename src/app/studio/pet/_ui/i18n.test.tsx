import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Dock, needPhrase } from './Dock';
import { RoomRail } from './rooms/RoomRail';
import { LANG_KEY, loadStrings } from './strings';
import { TalkPill } from './TalkPill';

/** Wave B: the English-only UI words moved to the catalogue (ui.send, ui.toys, ui.rooms, need.*). */
beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
afterEach(() => localStorage.clear());

describe('leftover UI copy in the catalogue, both languages', () => {
  it('English: Send, Toys, Rooms and the needs ("Tummy, wants some")', () => {
    render(<Dock needs={{ tummy: 30, joy: 90, energy: 90 }} onToy={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Toys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feed' })).toHaveAttribute('aria-description', 'Tummy, wants some');
    expect(screen.getByRole('button', { name: 'Play ball' })).toHaveAttribute('aria-description', 'Joy');
    render(<RoomRail room="home" onRoom={vi.fn()} rtl={false} />);
    expect(screen.getByRole('tablist', { name: 'Rooms' })).toBeInTheDocument();
  });

  it('Persian: «فرستادن», «اسباب‌بازی‌ها», «اتاق‌ها», and the wants phrase as one template («کمی {need} می‌خواهد»)', () => {
    localStorage.setItem(LANG_KEY, 'fa');
    render(<TalkPill name="Mochi" onListen={vi.fn()} onIdle={vi.fn()} onSend={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'سلام' } });
    expect(screen.getByRole('button', { name: 'فرستادن' })).toBeInTheDocument();
    render(<Dock needs={{ tummy: 30, joy: 90, energy: 90 }} onToy={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'اسباب‌بازی‌ها' })).toBeInTheDocument();
    render(<RoomRail room="home" onRoom={vi.fn()} rtl />);
    expect(screen.getByRole('tablist', { name: 'اتاق‌ها' })).toBeInTheDocument();
    const p = needPhrase('tummy', true);
    expect(p).toMatch(/^کمی .*غذا.* می‌خواهد$/);
    expect(p).not.toMatch(/[0-9۰-۹]/);
  });
});

describe('TalkPill, Wave B: the mic gate and hands-free', () => {
  it('a hold the UX-02 sheet has not answered never asks the OS for the mic', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    vi.stubGlobal('MediaRecorder', class { static isTypeSupported = () => true; });
    const micGate = vi.fn(() => false);
    const onListen = vi.fn();
    render(<TalkPill name="Mochi" onListen={onListen} onIdle={vi.fn()} onSend={vi.fn()} onVoice={vi.fn()} micGate={micGate} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
    expect(micGate).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onListen).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('the hands-free switch shows only when offered; open, the pill says it is listening and a hold does nothing', () => {
    const onHandsFree = vi.fn();
    const base = { name: 'Mochi', onListen: vi.fn(), onIdle: vi.fn(), onSend: vi.fn(), onVoice: vi.fn(), onHandsFree };
    const { rerender, container } = render(<TalkPill {...base} />);
    expect(screen.queryByRole('button', { name: 'Hands-free' })).toBeNull();
    rerender(<TalkPill {...base} voice={{ handsFree: true, open: false, hearing: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hands-free' }));
    expect(onHandsFree).toHaveBeenCalledTimes(1);
    rerender(<TalkPill {...base} voice={{ handsFree: true, open: true, hearing: true }} />);
    expect(screen.getByRole('button', { name: 'Hands-free' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status').textContent).toBe('Listening');
    expect(container.querySelector('.pet-pill')).toHaveAttribute('data-handsfree');
    expect(container.querySelector('.pet-pill')).toHaveAttribute('data-hearing');
    rerender(<TalkPill {...base} voice={{ handsFree: true, open: false, hearing: false, note: 'Hands-free is off. Tap to turn it on.' }} />);
    expect(screen.getByRole('status').textContent).toBe('Hands-free is off. Tap to turn it on.');
  });
});
