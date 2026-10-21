import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineCue, PetApi, PetEngine, PetEngineOptions, PetSnapshot } from './contract';
import { SNAPSHOT_KEY } from './contract';
import { createMockApi } from './mock';

/* The engine is written against the same contract in parallel: a recording double stands in for it. */
const engines: { opts: PetEngineOptions; e: PetEngine & Record<string, ReturnType<typeof vi.fn>> }[] = [];
vi.mock('../_engine/loop', () => ({
  createPetEngine: (opts: PetEngineOptions) => {
    const fn = () => vi.fn();
    const e = {
      rig: {}, body: {}, dim: motionValue(0), glow: motionValue(0),
      setLook: fn(), setSize: fn(), setTier: fn(), setMood: fn(), setScene: fn(), setBond: fn(), pointer: vi.fn(() => false), accel: fn(), toy: fn(),
      talk: fn(), micLevel: fn(), speakText: fn(), speakAudio: fn(), stopSpeaking: fn(), fire: fn(), attach: vi.fn(() => () => {}),
      start: fn(), stop: fn(), dispose: fn(),
    };
    engines.push({ opts, e: e as never });
    return e;
  },
}));

const { PetApp } = await import('./PetApp');

function telegram() {
  const calls: string[] = [];
  const rec = (n: string) => vi.fn(() => { calls.push(n); });
  const app = {
    initData: 'signed', initDataUnsafe: { user: { id: 1, first_name: 'Sara' } },
    expand: rec('expand'), requestFullscreen: rec('requestFullscreen'), disableVerticalSwipes: rec('disableVerticalSwipes'),
    lockOrientation: rec('lockOrientation'), setHeaderColor: rec('header'), setBackgroundColor: rec('background'), setBottomBarColor: rec('bottomBar'),
    ready: rec('ready'), hideKeyboard: rec('hideKeyboard'), enableClosingConfirmation: rec('enableClosing'), disableClosingConfirmation: rec('disableClosing'),
    onEvent: vi.fn(), offEvent: vi.fn(),
  };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
  return { app, calls };
}

const engine = () => engines.at(-1)!.e;
const fired = () => engine().fire.mock.calls.map((c) => (c[0] as { type: string }).type);

describe('PetApp open sequence', () => {
  beforeEach(() => {
    engines.length = 0;
    window.history.replaceState({}, '', '/studio/pet/x?mock=1');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); });

  it('boots Telegram, paints the character, then ready(), then hello', async () => {
    const { app, calls } = telegram();
    let charOnReady = false;
    app.ready.mockImplementation(() => { calls.push('ready'); charOnReady = !!container.querySelector('.pet-body svg'); });
    const { container } = render(<PetApp agentId="x" />);
    expect(calls.slice(0, 7)).toEqual(['expand', 'requestFullscreen', 'disableVerticalSwipes', 'lockOrientation', 'header', 'background', 'bottomBar']);
    expect(app.ready).not.toHaveBeenCalled();
    await waitFor(() => expect(app.ready).toHaveBeenCalledTimes(1));
    expect(charOnReady).toBe(true);
    await waitFor(() => expect(fired()).toContain('hello'));
    expect(engine().fire).toHaveBeenCalledWith({ type: 'hello', firstName: 'Sara' });
    expect(engine().start).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Talk to Mochi' })).toBeInTheDocument();
  });

  it('paints from the snapshot before the server answers', async () => {
    const { app } = telegram();
    const snapView = await (async () => {
      vi.useFakeTimers();
      const p = createMockApi({ look: 2 }).get('x');
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      return p;
    })();
    const snap: PetSnapshot = { v: 1, view: { ...snapView, name: 'Cached' }, savedAt: Date.now() };
    localStorage.setItem(SNAPSHOT_KEY('x'), JSON.stringify(snap));
    render(<PetApp agentId="x" />);
    // the cached name is on screen at once; the GET (120 ms in the fake) has not answered yet
    expect(screen.getByRole('textbox', { name: 'Talk to Cached' })).toBeInTheDocument();
    await waitFor(() => expect(app.ready).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Talk to Mochi' })).toBeInTheDocument());
    expect(engines).toHaveLength(1);
  });

  it('posts a finished care action and keeps the rings in step', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" />);
    await waitFor(() => expect(engines).toHaveLength(1));
    await waitFor(() => expect(container.querySelector('[data-toy="cookie"]')).toBeTruthy());
    const ring = () => Number(container.querySelector('[data-toy="cookie"] .pet-ring-fill')!.getAttribute('stroke-dashoffset'));
    const before = ring();
    act(() => { engines[0].opts.onCue?.({ type: 'care', action: 'feed' } satisfies EngineCue); });
    expect(ring()).toBeLessThan(before);
    expect(engine().setMood).toHaveBeenCalled();
  });

  it('talk: listening on focus, thinking on send (the engine nods once), then the reply speaks', async () => {
    const { calls } = telegram();
    render(<PetApp agentId="x" />);
    const input = await screen.findByRole('textbox', { name: 'Talk to Mochi' });
    fireEvent.focus(input);
    expect(engine().talk).toHaveBeenLastCalledWith('listening', 'text');
    // the engine plays the perk and the acknowledge nod itself: the page never fires them a second time
    expect(fired()).not.toContain('listen');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(input.closest('form')!);
    expect(fired()).not.toContain('ack');
    expect(engine().talk).toHaveBeenLastCalledWith('thinking');
    expect(calls).toContain('enableClosing');
    expect(calls).toContain('hideKeyboard');
    await waitFor(() => expect(engine().speakText).toHaveBeenCalled(), { timeout: 3000 });
    expect(engine().talk).toHaveBeenLastCalledWith('speaking');
    expect(calls).toContain('disableClosing');
    act(() => { engines[0].opts.onCue?.({ type: 'spoken' }); });
    expect(engine().talk).toHaveBeenLastCalledWith('idle');
  });

  it('shows "This one\'s private" with the character asleep for a stranger', async () => {
    window.history.replaceState({}, '', '/studio/pet/x?mock=1&role=private');
    const { app } = telegram();
    render(<PetApp agentId="x" />);
    expect(await screen.findByRole('heading', { name: 'This one’s private' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Mochi, sleeping' })).toBeInTheDocument();
    await waitFor(() => expect(app.ready).toHaveBeenCalled());
    expect(engines).toHaveLength(0);
  });

  it('a guest gets the page with "Chat in Telegram" instead of the pill', async () => {
    window.history.replaceState({}, '', '/studio/pet/x?mock=1&role=guest');
    telegram();
    render(<PetApp agentId="x" />);
    expect(await screen.findByRole('button', { name: 'Chat in Telegram' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a full tummy turns a cookie tap into the "so full" reaction', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" />);
    await waitFor(() => expect(container.querySelector('[data-toy="cookie"]')).toBeTruthy());
    act(() => { engines[0].opts.onCue?.({ type: 'care', action: 'feed' }); });
    act(() => { engines[0].opts.onCue?.({ type: 'care', action: 'feed' }); });
    const cookie = container.querySelector<HTMLElement>('[data-toy="cookie"]')!;
    fireEvent.pointerDown(cookie, { pointerId: 1, clientX: 50, clientY: 700 });
    fireEvent.pointerUp(cookie, { pointerId: 1, clientX: 50, clientY: 700 });
    expect(fired()).toContain('tooFull');
    expect(engine().toy).not.toHaveBeenCalledWith({ type: 'cookieTap' });
  });
});

describe('PetApp: talk outcomes, sleep, the cache and the page', () => {
  beforeEach(() => {
    engines.length = 0;
    window.history.replaceState({}, '', '/studio/pet/x');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); });

  const fast = (over: Partial<PetApi> = {}, care: Parameters<typeof createMockApi>[0] = {}): PetApi => ({ ...createMockApi({ latency: { care: 0, talk: 0 }, ...care }), ...over });
  const bubble = (c: HTMLElement) => c.querySelector('.pet-bubble')?.textContent ?? '';
  const ready = async (c: HTMLElement) => { await waitFor(() => expect(c.querySelector('[data-toy="cookie"]')).toBeTruthy()); await waitFor(() => expect(fired()).toContain('hello')); };

  it('a Bond milestone reached by talking celebrates once the reply has been said', async () => {
    telegram();
    const base = fast();
    const api = fast({ talk: async (id, req, o) => ({ ...(await base.talk(id, req, o)), bondMilestone: 0 }) });
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    const input = screen.getByRole('textbox', { name: 'Talk to Mochi' });
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(engine().speakText).toHaveBeenCalled());
    expect(fired()).not.toContain('celebrate');
    act(() => { engines[0].opts.onCue?.({ type: 'spoken' }); });
    await waitFor(() => expect(engine().fire).toHaveBeenCalledWith({ type: 'celebrate', why: 'bond' }));
  });

  it('a voice turn that heard nothing says so gently, never an empty bubble', async () => {
    telegram();
    class Recorder {
      static isTypeSupported = () => true;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      mimeType = 'audio/webm';
      start() {}
      stop() { this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.(); }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) }, configurable: true });
    const api = fast({ talkVoice: async () => ({ transcript: '', reply: '' }) });
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const mic = screen.getByRole('button', { name: 'Hold to talk' });
    await act(async () => { fireEvent.pointerDown(mic); });
    now.mockReturnValue(2500);
    act(() => { fireEvent.pointerUp(mic); });
    now.mockRestore();
    await waitFor(() => expect(bubble(container)).toContain('didn’t catch that'));
    expect(engine().speakText).not.toHaveBeenCalled();
    expect(engine().talk).toHaveBeenLastCalledWith('idle');
    vi.unstubAllGlobals();
  });

  it('a failed talk puts the words back in the pill', async () => {
    telegram();
    const api = fast({ talk: async () => { throw Object.assign(new Error('offline'), { code: 'network', status: 0 }); } });
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    const input = screen.getByRole('textbox', { name: 'Talk to Mochi' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'are you there?' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(bubble(container)).toContain('lost my words'));
    await waitFor(() => expect(input.value).toBe('are you there?'));
    expect(engine().talk).toHaveBeenLastCalledWith('idle');
  });

  it('no mic when the server cannot hear', async () => {
    telegram();
    const base = fast();
    const api = fast({ get: async (id, o) => ({ ...(await base.get(id, o)), listen: false }) });
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });

  it('a cached snapshot from days ago paints a pet ready to celebrate, not the floors', async () => {
    telegram();
    const day = 86_400_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 10, 12));
    const old = await createMockApi({ latency: { care: 0, talk: 0 }, care: { tummy: 50, joy: 50, energy: 50 } }).get('x');
    vi.setSystemTime(Date.UTC(2026, 9, 14, 12));
    const snap: PetSnapshot = { v: 1, view: { ...old, care: { ...old.care, tz: 'UTC' } }, savedAt: Date.now() - 4 * day };
    localStorage.setItem(SNAPSHOT_KEY('x'), JSON.stringify(snap));
    const { container } = render(<PetApp agentId="x" api={fast({ get: () => new Promise(() => {}) })} />);
    vi.useRealTimers();
    await waitFor(() => expect(engines).toHaveLength(1));
    // the engine is born content (welcome floors applied locally), never droopy
    expect(engines[0].opts.mood.level).not.toBe('droopy');
    const ring = (k: string) => Number(container.querySelector(`[data-toy="${k}"] .pet-ring-fill`)!.getAttribute('stroke-dashoffset'));
    const C = 2 * Math.PI * 30;
    for (const k of ['cookie', 'ball', 'moon']) expect(ring(k)).toBeLessThanOrEqual(C * 0.4 + 1e-6);
  });

  it('celebrations wait for a sleeping pet to wake', async () => {
    telegram();
    const base = fast();
    const api = fast({ get: async (id, o) => { const v = await base.get(id, o); return { ...v, care: { ...v.care, asleep: true, sleptAt: v.now }, bondMilestone: 0 }; } });
    const { container } = render(<PetApp agentId="x" api={api} />);
    await waitFor(() => expect(container.querySelector('[data-toy="cookie"]')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 1300));
    expect(fired()).not.toContain('celebrate');
    act(() => { engines[0].opts.onCue?.({ type: 'care', action: 'wake' }); });
    await waitFor(() => expect(fired()).toContain('celebrate'), { timeout: 3000 });
  });

  it('passes the care rule for "too tired" with a ball tap', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast({}, { care: { energy: 27 } })} />);
    await ready(container);
    fireEvent.click(screen.getByRole('button', { name: 'Play ball' }));
    expect(engine().toy).toHaveBeenLastCalledWith({ type: 'ballTap', tired: false });
  });

  it('reply audio: a new turn stops the old reply; hiding suspends and showing resumes it (never a stuck mouth)', async () => {
    telegram();
    const sources: Array<{ stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
    const made: FakeContext[] = [];
    class FakeContext {
      static made = 0;
      state: AudioContextState = 'running';
      destination = {};
      constructor() { FakeContext.made++; made.push(this); }
      resume = vi.fn(async () => { this.state = 'running'; });
      suspend = vi.fn(async () => { this.state = 'suspended'; });
      decodeAudioData = vi.fn(async () => ({}));
      createAnalyser = () => ({ fftSize: 0, connect: vi.fn() });
      createBufferSource = () => { const src = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }; sources.push(src); return src; };
    }
    vi.stubGlobal('AudioContext', FakeContext);
    const base = fast();
    const api = fast({ talk: async (id, req, o) => ({ ...(await base.talk(id, req, o)) }), talkVoice: async () => ({ transcript: 'hi', reply: 'Hello!', audio: btoa('mp3') }) });
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    // hidden before any touch: no AudioContext is made outside a gesture
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(FakeContext.made).toBe(0);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    // a touch makes the one context; a voice reply plays through it
    fireEvent.pointerDown(document.body);
    class Recorder {
      static isTypeSupported = () => true;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      mimeType = 'audio/webm';
      start() {}
      stop() { this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.(); }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) }, configurable: true });
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const mic = screen.getByRole('button', { name: 'Hold to talk' });
    await act(async () => { fireEvent.pointerDown(mic); });
    now.mockReturnValue(2500);
    act(() => { fireEvent.pointerUp(mic); });
    now.mockRestore();
    await waitFor(() => expect(engine().speakAudio).toHaveBeenCalled());
    const ctx = () => FakeContext.made;
    expect(ctx()).toBe(1);
    // hide mid-reply: suspended; back: resumed, the reply carries on (the engine keeps its lip-sync)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(made[0].suspend).toHaveBeenCalledTimes(1);
    expect(engine().stopSpeaking).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(made[0].resume).toHaveBeenCalled();
    // a new message while it speaks: the old reply stops, and its end can no longer close the new reply's mouth
    const input = screen.getByRole('textbox', { name: 'Talk to Mochi' });
    fireEvent.change(input, { target: { value: 'and you?' } });
    fireEvent.submit(input.closest('form')!);
    expect(sources[0].stop).toHaveBeenCalled();
    expect(sources[0].onended).toBeNull();
    await waitFor(() => expect(engine().speakText).toHaveBeenCalled());
    expect(engine().talk).toHaveBeenLastCalledWith('speaking');
    vi.unstubAllGlobals();
  });

  it('re-measures on every Telegram event that moves the safe areas, after the CSS vars are written', async () => {
    const { app } = telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    for (const ev of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged', 'viewportChanged']) {
      const handlers = app.onEvent.mock.calls.filter((c) => c[0] === ev);
      // the vars writer first, then the measure
      expect(handlers.length, ev).toBeGreaterThanOrEqual(2);
    }
  });

  it('Settings → forget my pet: confirms, erases on the server, forgets the cache and closes', async () => {
    const { app } = telegram();
    let onSettings: (() => void) | undefined;
    Object.assign(app, {
      SettingsButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn((cb: () => void) => { onSettings = cb; }), offClick: vi.fn() },
      showConfirm: vi.fn((_m: string, cb: (ok: boolean) => void) => cb(true)),
      close: vi.fn(),
    });
    const forget = vi.fn(async () => ({ erased: 1 }));
    const { container } = render(<PetApp agentId="x" api={fast({ forget })} />);
    await ready(container);
    expect(app.SettingsButton.show).toHaveBeenCalled();
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeTruthy();
    act(() => { onSettings!(); });
    await waitFor(() => expect(app.close).toHaveBeenCalled());
    expect(app.showConfirm.mock.calls[0][0]).toMatch(/^Forget Mochi’s care for you\?/);
    expect(forget).toHaveBeenCalledWith('x');
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeFalsy();
  });

  it('mirrors the page going away onto the root, so CSS loops pause too', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    const root = container.querySelector('.pet-root')!;
    expect(root.hasAttribute('data-paused')).toBe(false);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(root.hasAttribute('data-paused')).toBe(true);
    expect(engine().stop).toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(root.hasAttribute('data-paused')).toBe(false);
  });
});
