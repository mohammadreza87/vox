import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetApi, PetEngine, PetEngineOptions } from './contract';
import { PetError } from './errors';
import { createMockApi } from './mock';

/* Wave C on the living page: a check-in's replay instead of the hello, pet_action after the reply, check-ins on a server without the route. */
const engines: { opts: PetEngineOptions; e: PetEngine & Record<string, ReturnType<typeof vi.fn>> }[] = [];
vi.mock('../_engine/loop', () => ({
  createPetEngine: (opts: PetEngineOptions) => {
    const fn = () => vi.fn();
    const e = {
      rig: {}, body: {}, dim: motionValue(0), glow: motionValue(0),
      setLook: fn(), setSize: fn(), setTier: fn(), setMood: fn(), setScene: fn(), setBond: fn(), pointer: vi.fn(() => false), accel: fn(), toy: fn(),
      talk: fn(), micLevel: fn(), speakText: fn(), speakAudio: fn(), stopSpeaking: fn(), fire: fn(), attach: vi.fn(() => () => {}),
      start: fn(), stop: fn(), dispose: fn(), setRoom: fn(), roomReact: fn(), onMotion: vi.fn(() => () => {}), setDetails: fn(), lightMoment: fn(),
    };
    engines.push({ opts, e: e as never });
    return e;
  },
}));
const { PetApp } = await import('./PetApp');

function telegram() {
  const app = { initData: 'signed', initDataUnsafe: { user: { id: 1, first_name: 'Sara' } }, ready: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn(),
    setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), setBottomBarColor: vi.fn(), enableClosingConfirmation: vi.fn(), disableClosingConfirmation: vi.fn(), hideKeyboard: vi.fn() };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
  return app;
}
const engine = () => engines.at(-1)!.e;
const fast = (over: Partial<PetApi> = {}, o: Parameters<typeof createMockApi>[0] = {}): PetApi => ({ ...createMockApi({ latency: { care: 0, talk: 0 }, ...o }), ...over });
const ready = async (c: HTMLElement) => { await waitFor(() => expect(c.querySelector('[data-toy="cookie"]')).toBeTruthy()); await waitFor(() => expect(engine().fire.mock.calls.some((x) => (x[0] as { type: string }).type === 'hello')).toBe(true)); };

const fired = (type: string) => engine().fire.mock.calls.filter((x) => (x[0] as { type: string }).type === type);
const say = async (text: string) => {
  const input = screen.getByRole('textbox', { name: 'Talk to Mochi' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
};

describe('PetApp, Wave C', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    engines.length = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.history.replaceState({}, '', '/studio/pet/x?mock=1');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('opened from a check-in (?ci=): the moment plays instead of the hello (a seen stage-up gets the stage celebration)', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast({}, { ci: 'C2' })} />);
    await waitFor(() => expect(container.querySelector('[data-toy="cookie"]')).toBeTruthy());
    await waitFor(() => expect(engine().fire).toHaveBeenCalledWith({ type: 'celebrate', why: 'stage' }));
    expect(fired('hello')).toHaveLength(0);
  });

  it('pet_action: "time for bed" tucks the pet in through the moon, only after the reply has been said', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await say('time for bed');
    await waitFor(() => expect(engine().speakText).toHaveBeenCalled());
    expect(engine().toy).not.toHaveBeenCalledWith({ type: 'moonTap' });
    // the text lip-sync's spoken cue closes the mouth: then the move follows
    act(() => { engines[0].opts.onCue?.({ type: 'spoken' }); });
    await waitFor(() => expect(engine().toy).toHaveBeenCalledWith({ type: 'moonTap' }), { timeout: 3000 });
  });

  it('the Closet\'s real look goes through the session\'s own look call; look_forbidden is a note, never the resting screen', async () => {
    telegram();
    const look = vi.fn(async () => { throw new PetError(403, 'look_forbidden', 'look_forbidden'); });
    const { container } = render(<PetApp agentId="x" api={fast({ look })} />);
    await ready(container);
    fireEvent.click(screen.getByRole('tab', { name: 'Closet' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Mochi’s look' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cap' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save for everyone' })); });
    await waitFor(() => expect(look).toHaveBeenCalledWith('x', { look: { accessory: 'cap' } }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.querySelector('[data-toy]') ?? container.querySelector('.pet-rail')).toBeTruthy();
    expect(container.querySelector('.pet-closet')).toBeTruthy();
  });

  it('a server without the checkins route: the pet keeps living (never the resting screen)', async () => {
    telegram();
    localStorage.setItem('vox.pet.tips.x', JSON.stringify({ days: 2, lastDay: '2026-10-20' }));
    const checkins = vi.fn(async () => { throw new PetError(403, 'checkins_unavailable', 'guest'); });
    const { container } = render(<PetApp agentId="x" api={fast({ checkins })} />);
    await ready(container);
    await waitFor(() => expect(checkins).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.querySelector('[data-toy="cookie"]')).toBeTruthy();
  });
});
