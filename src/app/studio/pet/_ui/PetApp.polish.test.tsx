import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineCue, PetApi, PetEngine, PetEngineOptions } from './contract';
import type { PetHost } from './host';
import { createMockApi } from './mock';
import { t } from './strings';

/* Visual QA 26 Oct (P-02, P-08, P-14, P-16, P-21, P-22): the open sequence, the lines the page chooses, its guards. */
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
/* the Wave B layer stands aside: the test holds the host the page lends it */
let host: PetHost | null = null;
vi.mock('./Extras', () => ({ default: ({ host: h }: { host: PetHost }) => { host = h; return null; } }));
const { PetApp } = await import('./PetApp');

function telegram() {
  const app = { initData: 'signed', initDataUnsafe: { user: { id: 1, first_name: 'Sara' } }, ready: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn(),
    setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), setBottomBarColor: vi.fn(), enableClosingConfirmation: vi.fn(), disableClosingConfirmation: vi.fn(), hideKeyboard: vi.fn() };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
  return app;
}
const engine = () => engines.at(-1)!.e;
const cue = (c: EngineCue) => act(() => { engines.at(-1)!.opts.onCue?.(c); });
const fast = (over: Partial<PetApi> = {}, o: Parameters<typeof createMockApi>[0] = {}): PetApi => ({ ...createMockApi({ latency: { care: 0, talk: 0 }, ...o }), ...over });
const bubble = (c: HTMLElement) => c.querySelector('.pet-bubble .pet-sr')?.textContent ?? '';
const ready = async (c: HTMLElement) => {
  await waitFor(() => expect(c.querySelector('[data-toy="cookie"]')).toBeTruthy());
  await waitFor(() => expect(host).not.toBeNull());
};

describe('PetApp, visual QA polish', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    engines.length = 0;
    host = null;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.history.replaceState({}, '', '/studio/pet/x?mock=1');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('the first bubble is the hello ("Hi Sara!" by the hour), and nothing proactive comes before it (P-16)', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    expect(engine().fire).toHaveBeenCalledWith({ type: 'hello', firstName: 'Sara' });
    // the opening seconds are the hello's: tips and asks wait (the host is busy)
    expect(host!.isBusy()).toBe(true);
    expect(bubble(container)).toBe('');
    cue({ type: 'say', line: 'hi' });
    expect(bubble(container)).toBe('Hi Sara! Happy midday.');
    expect(host!.isBusy()).toBe(true);
    // a first touch after the hello lets tips in
    fireEvent.pointerDown(document.body);
    expect(host!.isBusy()).toBe(false);
  });

  it('no tip in the opening seconds: without a touch the open lets go only 20 s after the hello', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    cue({ type: 'say', line: 'hi' });
    act(() => { vi.advanceTimersByTime(19_000); });
    expect(host!.isBusy()).toBe(true);
    act(() => { vi.advanceTimersByTime(1_100); });
    expect(host!.isBusy()).toBe(false);
  });

  it('the hello is said even when the engine\'s line never lands (a starved frame loop)', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    await waitFor(() => expect(bubble(container)).toBe('Hi Sara! Happy midday.'), { timeout: 2500 });
  });

  it('a blank line never draws a bubble (P-14); the same line on screen is not said twice', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    let ok = true;
    act(() => { ok = host!.say('   '); });
    expect(ok).toBe(false);
    expect(container.querySelector('.pet-bubble')).toBeNull();
    act(() => { ok = host!.say('Plant a seed?'); });
    expect(ok).toBe(true);
    act(() => { ok = host!.say('Plant a seed?'); });
    expect(ok).toBe(false);
  });

  it('a stage-up says what it learned (growth.stage.*), never "Hi!" or a bare "I learned something new!" (P-08)', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast({}, { stageUp: true })} />);
    await ready(container);
    cue({ type: 'say', line: 'learned' });
    // the mock agent has a lit moment: what it learned so far
    expect(bubble(container)).toBe(t('growth.stage.learned'));
    await waitFor(() => expect(engine().fire).toHaveBeenCalledWith(expect.objectContaining({ type: 'stageUp' })), { timeout: 4000 });
  });

  it('welcome back is the pet\'s own small news in the person\'s words, never the server\'s text (P-21)', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast({}, { welcome: true })} />);
    await ready(container);
    await waitFor(() => expect(engine().fire).toHaveBeenCalledWith(expect.objectContaining({ type: 'welcomeBack' })), { timeout: 4000 });
    const souvenir = (engine().fire.mock.calls.find((c) => (c[0] as { type: string }).type === 'welcomeBack')![0] as { souvenir: string }).souvenir;
    expect([1, 2, 3, 4, 5].map((n) => t(`say.welcomeBack.${n}` as never))).toContain(souvenir);
    expect(souvenir).not.toMatch(/Shiraz/);
  });

  it('tucking in during a Bop round ends it: the pips fade and go with the ball (P-02)', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    cue({ type: 'score', bops: 4, misses: 0 });
    expect(container.querySelector('.pet-score')).not.toHaveAttribute('data-out');
    fireEvent.click(container.querySelector('[data-toy="moon"]')!);
    expect(engine().toy).toHaveBeenCalledWith({ type: 'moonTap' });
    expect(container.querySelector('.pet-score')).toHaveAttribute('data-out');
    // the engine ends the round (its playOver): the pips leave with the fade, not after the round-end beat
    cue({ type: 'playOver', bops: 4, won: false, misses: 0 });
    await waitFor(() => expect(container.querySelector('.pet-score')).toBeNull(), { timeout: 600 });
  });

  it('a guest never sees the owner\'s "days together" chip (P-22)', async () => {
    telegram();
    const owner = render(<PetApp agentId="x" api={fast()} />);
    await ready(owner.container);
    await waitFor(() => expect(owner.container.querySelector('.pet-days')).toBeTruthy());
    owner.unmount();
    host = null;
    const guest = render(<PetApp agentId="x" api={fast({}, { role: 'guest' })} />);
    await ready(guest.container);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(guest.container.querySelector('.pet-days')).toBeNull();
  });

  it('a check-in replay keeps the bubble for its own line: the first room visit lights after it (P-08)', async () => {
    telegram();
    const api = fast({}, { ci: 'C5', garden: 'bloom' });
    const play = vi.fn(api.play!);
    const { container } = render(<PetApp agentId="x" api={{ ...api, play }} />);
    await ready(container);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => { host!.setRoom('garden'); });
    expect(play).not.toHaveBeenCalledWith('x', { op: 'roomVisited', room: 'garden' }, expect.anything());
    act(() => { vi.advanceTimersByTime(6500); });
    expect(play).toHaveBeenCalledWith('x', { op: 'roomVisited', room: 'garden' }, expect.anything());
  });

  it('each room has its own backdrop, and Telegram\'s bars take its edge colour (P-04)', async () => {
    const app = telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    const stage = () => container.querySelector('.pet-stage') as HTMLElement;
    const home = stage().style.backgroundImage, homeEdge = app.setHeaderColor.mock.calls.at(-1)![0];
    act(() => { host!.setRoom('bedroom'); });
    await waitFor(() => expect(stage().style.backgroundImage).not.toBe(home));
    expect(app.setHeaderColor.mock.calls.at(-1)![0]).not.toBe(homeEdge);
    // the old room's light fades out over the new one
    expect(container.querySelector('.pet-bd-out')).toBeTruthy();
  });
});
