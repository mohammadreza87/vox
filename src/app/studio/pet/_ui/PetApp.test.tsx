import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineCue, PetApi, PetEngine, PetEngineOptions, PetSnapshot } from './contract';
import { SNAPSHOT_KEY } from './contract';
import { createMockApi } from './mock';
import { PetError } from './errors';

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
    // These interaction cases require a waking pet, independently of the machine's wall clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    engines.length = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.history.replaceState({}, '', '/studio/pet/x?mock=1');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

  it('never paints a prior account snapshot before the fresh authenticated GET', async () => {
    const { app } = telegram();
    const fresh = await createMockApi({ latency: { care: 0, talk: 0 } }).get('x');
    const snap: PetSnapshot = { v: 1, view: { ...fresh, name: 'PREVIOUS_ACCOUNT_PRIVATE_PET', care: { ...fresh.care, userId: 300 } }, savedAt: Date.now() };
    localStorage.setItem(SNAPSHOT_KEY('x'), JSON.stringify(snap));
    app.initData = 'signed-current-400'; app.initDataUnsafe.user.id = 400;
    const getStored = vi.fn();
    const setStored = vi.fn();
    Object.assign(app, { DeviceStorage: { getItem: getStored, setItem: setStored } });
    let resolve!: (v: typeof fresh) => void;
    const get = vi.fn(() => new Promise<typeof fresh>((r) => { resolve = r; }));
    const { container } = render(<PetApp agentId="x" api={{ ...createMockApi(), get }} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(container.textContent).not.toContain('PREVIOUS_ACCOUNT_PRIVATE_PET');
    expect(engines).toHaveLength(0);
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeNull();
    expect(getStored).not.toHaveBeenCalled();
    expect(setStored).toHaveBeenCalledWith(SNAPSHOT_KEY('x'), '');
    await act(async () => { resolve({ ...fresh, care: { ...fresh.care, userId: 400 } }); });
    expect(await screen.findByRole('textbox', { name: 'Talk to Mochi' })).toBeInTheDocument();
    expect(engines).toHaveLength(1);
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeNull();
    expect(setStored.mock.calls.every(([, value]) => value === '')).toBe(true);
  });

  it('StrictMode reattachment discards its aborted initial GET and accepts only the fresh response', async () => {
    telegram();
    const fresh = await createMockApi().get('x');
    const answers: Array<(v: typeof fresh) => void> = [];
    const signals: AbortSignal[] = [];
    const get = vi.fn((_id: string, o?: Parameters<PetApi['get']>[1]) => {
      signals.push(o!.signal!);
      return new Promise<typeof fresh>((r) => answers.push(r));
    });
    const { container } = render(<StrictMode><PetApp agentId="x" api={{ ...createMockApi(), get }} /></StrictMode>);
    expect(get).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    await act(async () => answers[0]({ ...fresh, name: 'ABORTED_PRIVATE_VIEW' }));
    expect(container.textContent).not.toContain('ABORTED_PRIVATE_VIEW');
    expect(screen.queryByRole('textbox')).toBeNull();
    await act(async () => answers[1](fresh));
    expect(await screen.findByRole('textbox', { name: 'Talk to Mochi' })).toBeInTheDocument();
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
    // These interaction cases require a waking pet, independently of the machine's wall clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    engines.length = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.history.replaceState({}, '', '/studio/pet/x');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

  it('keeps a fast conversation reply when delayed hello or ambient speech cues arrive', async () => {
    telegram();
    const base = fast();
    const api = fast({ talk: async (id, req, o) => ({ ...(await base.talk(id, req, o)), reply: 'PRIORITY_CONVERSATION_REPLY' }) });
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    const input = screen.getByRole('textbox', { name: 'Talk to Mochi' });
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(bubble(container)).toContain('PRIORITY_CONVERSATION_REPLY'));
    act(() => { engines.at(-1)!.opts.onCue?.({ type: 'say', line: 'hi' }); engines.at(-1)!.opts.onCue?.({ type: 'say', line: 'yum' }); });
    expect(bubble(container)).toContain('PRIORITY_CONVERSATION_REPLY');
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

  it('an unavailable fresh GET never opens even an old valid snapshot', async () => {
    telegram();
    const old = await createMockApi({ latency: { care: 0, talk: 0 } }).get('x');
    const snap: PetSnapshot = { v: 1, view: { ...old, name: 'PRIVATE_OFFLINE_CACHE' }, savedAt: Date.now() };
    localStorage.setItem(SNAPSHOT_KEY('x'), JSON.stringify(snap));
    const { container } = render(<PetApp agentId="x" api={fast({ get: async () => { throw new Error('offline'); } })} />);
    await screen.findByRole('button', { name: /try again/i });
    expect(engines).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(container.textContent).not.toContain('PRIVATE_OFFLINE_CACHE');
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeNull();
  });

  it('drops delayed previous-account GET and pending care when the signed session changes', async () => {
    const { app } = telegram();
    const fresh = await fast().get('x');
    let oldGet!: (v: typeof fresh) => void;
    let newGet!: (v: typeof fresh) => void;
    const signals: AbortSignal[] = [];
    const get = vi.fn((_id: string, o?: Parameters<PetApi['get']>[1]) => {
      signals.push(o!.signal!);
      return new Promise<typeof fresh>((r) => { if (signals.length === 1) oldGet = r; else newGet = r; });
    });
    const care = vi.fn(fast().care);
    const { container } = render(<PetApp agentId="x" api={fast({ get, care })} />);
    app.initData = 'signed-other-account'; app.initDataUnsafe.user.id = 2;
    fireEvent.pointerDown(document.body);
    expect(get).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    await act(async () => { oldGet({ ...fresh, name: 'PRIVATE_OLD_ACCOUNT' }); });
    expect(container.textContent).not.toContain('PRIVATE_OLD_ACCOUNT');
    expect(engines).toHaveLength(0);
    await act(async () => { newGet({ ...fresh, name: 'Current', care: { ...fresh.care, userId: 2 } }); });
    expect(await screen.findByRole('textbox', { name: 'Talk to Current' })).toBeInTheDocument();
    act(() => { engines.at(-1)!.opts.onCue?.({ type: 'care', action: 'pet' }); });
    app.initData = 'signed-third-account'; app.initDataUnsafe.user.id = 3;
    fireEvent.pointerDown(document.body);
    await new Promise((r) => setTimeout(r, 2100));
    expect(care).not.toHaveBeenCalled();
    expect(container.querySelector('.pet-body')).toBeNull();
  });

  it('a delayed talk reply cannot return private content after foreground revalidation', async () => {
    telegram();
    let resolve!: (r: Awaited<ReturnType<PetApi['talk']>>) => void;
    let signal: AbortSignal | undefined;
    const talk = vi.fn((_id, _req, o) => { signal = o?.signal; return new Promise<Awaited<ReturnType<PetApi['talk']>>>((r) => { resolve = r; }); });
    const api = fast({ talk });
    const get = vi.spyOn(api, 'get');
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    const old = engine();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hello' } }); fireEvent.submit(input.closest('form')!);
    expect(talk).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(signal?.aborted).toBe(true);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.queryByRole('textbox')).toBeNull();
    await ready(container);
    await act(async () => { resolve({ reply: 'PRIVATE_DELAYED_REPLY', turnId: 'old' }); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('PRIVATE_DELAYED_REPLY');
    expect(old.speakText).not.toHaveBeenCalled();
    expect(engine().speakText).not.toHaveBeenCalled();
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeNull();
  });

  it.each([401, 403])('clears private state and queued care after a %s care denial', async (status) => {
    telegram();
    const care = vi.fn(async () => { throw new PetError(status, status === 401 ? 'authentication_required' : 'pet_private', 'denied'); });
    const { container } = render(<PetApp agentId="x" api={fast({ care })} />);
    await ready(container);
    const old = engine();
    act(() => { engines.at(-1)!.opts.onCue?.({ type: 'care', action: 'pet' }); });
    act(() => { engines.at(-1)!.opts.onCue?.({ type: 'care', action: 'feed' }); });
    await waitFor(() => expect(container.querySelector('.pet-stage')).toBeNull());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(old.dispose).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 2100));
    expect(care).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeNull();
  });

  it('an uncertain forget remains paused, discards late replies, and retries deletion without GET or care replay', async () => {
    const { app } = telegram();
    let onSettings!: () => void;
    Object.assign(app, {
      SettingsButton: { show: vi.fn(), hide: vi.fn(), onClick: (cb: () => void) => { onSettings = cb; }, offClick: vi.fn() },
      showConfirm: (_message: string, cb: (ok: boolean) => void) => cb(true), close: vi.fn(),
    });
    let reply!: (r: Awaited<ReturnType<PetApi['talk']>>) => void;
    const talk = vi.fn(() => new Promise<Awaited<ReturnType<PetApi['talk']>>>((r) => { reply = r; }));
    const forget = vi.fn().mockRejectedValueOnce(new Error('ack lost')).mockResolvedValueOnce({ erased: 1 });
    const care = vi.fn(fast().care);
    const api = fast({ talk, forget, care }); const get = vi.spyOn(api, 'get');
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    act(() => { engines.at(-1)!.opts.onCue?.({ type: 'care', action: 'pet' }); });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hello' } }); fireEvent.submit(input.closest('form')!);
    act(() => onSettings());
    const retry = await screen.findByRole('button', { name: 'Retry forgetting' });
    expect(screen.getByRole('status')).toHaveTextContent('could not confirm');
    expect(container.querySelector('.pet-body')).toBeNull();
    await act(async () => { reply({ reply: 'ERASED_PRIVATE_REPLY', turnId: 'erased' }); });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); act(() => document.dispatchEvent(new Event('visibilitychange')));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); act(() => document.dispatchEvent(new Event('visibilitychange')));
    await new Promise((r) => setTimeout(r, 2100));
    expect(container.textContent).not.toContain('ERASED_PRIVATE_REPLY');
    expect(get).toHaveBeenCalledTimes(1); expect(care).not.toHaveBeenCalled(); expect(app.close).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() => expect(app.close).toHaveBeenCalledTimes(1));
    expect(forget).toHaveBeenNthCalledWith(1, 'x'); expect(forget).toHaveBeenNthCalledWith(2, 'x');
    expect(get).toHaveBeenCalledTimes(1); expect(care).not.toHaveBeenCalled();
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

  it('reply audio stops on hide; foreground verifies fresh state and a new turn can speak', async () => {
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
    await ready(container);
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
    // Hide discards private audio and the old engine. Foreground gets a fresh verified view.
    const oldEngine = engine();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(sources[0].stop).toHaveBeenCalled();
    expect(sources[0].onended).toBeNull();
    expect(oldEngine.dispose).toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.queryByRole('textbox')).toBeNull();
    await ready(container);
    expect(engine()).not.toBe(oldEngine);
    expect(made[0].resume).not.toHaveBeenCalled();
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
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeNull();
    act(() => { onSettings!(); });
    await waitFor(() => expect(app.close).toHaveBeenCalled());
    expect(app.showConfirm.mock.calls[0][0]).toBe('Forget care for all your pets, including Mochi? Needs and Bond start over for every pet; your chats stay.');
    expect(forget).toHaveBeenCalledWith('x');
    expect(localStorage.getItem(SNAPSHOT_KEY('x'))).toBeFalsy();
  });

  it('discards the private DOM on hide and revalidates before showing it again', async () => {
    telegram();
    const api = fast();
    const get = vi.spyOn(api, 'get');
    const { container } = render(<PetApp agentId="x" api={api} />);
    await ready(container);
    const old = engine();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(container.querySelector('.pet-body')).toBeNull();
    expect(old.dispose).toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.queryByRole('textbox')).toBeNull();
    await ready(container);
    expect(get).toHaveBeenCalledTimes(2);
    expect(engine()).not.toBe(old);
  });
});
