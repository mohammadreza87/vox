import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { circleCode, clearLegacyPetSnapshots, bootTelegram, holdClosing, readStored, readyAfterPaint, startAccelerometer, syncSafeAreas, type PetTelegram } from './telegram';

/** A WebApp double that records every call in order. */
function fakeApp(over: Partial<PetTelegram> = {}) {
  const calls: string[] = [];
  const handlers = new Map<string, Set<(p?: unknown) => void>>();
  const rec = (name: string) => vi.fn(() => { calls.push(name); });
  const app: PetTelegram = {
    initData: 'query_id=1',
    ready: rec('ready'), expand: rec('expand'), requestFullscreen: rec('requestFullscreen'),
    disableVerticalSwipes: rec('disableVerticalSwipes'), lockOrientation: rec('lockOrientation'),
    setHeaderColor: vi.fn((c: string) => { calls.push(`header:${c}`); }), setBackgroundColor: vi.fn((c: string) => { calls.push(`background:${c}`); }),
    setBottomBarColor: vi.fn((c: string) => { calls.push(`bottomBar:${c}`); }),
    enableClosingConfirmation: rec('enableClosing'), disableClosingConfirmation: rec('disableClosing'),
    onEvent: vi.fn((e: string, cb: (p?: unknown) => void) => { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e)!.add(cb); }),
    offEvent: vi.fn((e: string, cb: (p?: unknown) => void) => { handlers.get(e)?.delete(cb); }),
    ...over,
  };
  const emit = (e: string, p?: unknown) => { for (const cb of handlers.get(e) ?? []) cb(p); };
  return { app, calls, emit, handlers };
}

describe('pet Telegram boot (§3.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });
  afterEach(() => { vi.useRealTimers(); delete (window as { Telegram?: unknown }).Telegram; });

  it('boots in the documented order and leaves ready() for after the first character paint', () => {
    const { app, calls } = fakeApp();
    (window as unknown as { Telegram: { WebApp: PetTelegram } }).Telegram = { WebApp: app };
    bootTelegram('#123456');
    expect(calls).toEqual([
      'expand', 'requestFullscreen', 'disableVerticalSwipes', 'lockOrientation',
      'header:#123456', 'background:#123456', 'bottomBar:#123456',
    ]);
    expect(app.ready).not.toHaveBeenCalled();

    // the page paints the character, then: rAF → task → ready()
    const painted = vi.fn(() => calls.push('paint→hello'));
    readyAfterPaint(app, painted);
    expect(app.ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(calls.slice(-2)).toEqual(['ready', 'paint→hello']);
  });

  it('ignores an unsupported fullscreen (desktop/web) and old clients that throw', () => {
    const { app, calls } = fakeApp({
      requestFullscreen: vi.fn(() => { throw new Error('WebAppMethodUnsupported'); }),
      lockOrientation: undefined,
      setBottomBarColor: vi.fn(() => { throw new Error('WebAppMethodUnsupported'); }),
    });
    expect(() => bootTelegram('#0E1013', app)).not.toThrow();
    expect(calls).toEqual(['expand', 'disableVerticalSwipes', 'header:#0E1013', 'background:#0E1013']);
  });

  it('locks the orientation only while portrait', () => {
    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    const { app } = fakeApp();
    bootTelegram('#000000', app);
    expect(app.lockOrientation).not.toHaveBeenCalled();
  });

  it('a cancelled ready (unmounted before paint) never fires', () => {
    const { app } = fakeApp();
    const cancel = readyAfterPaint(app);
    cancel();
    vi.advanceTimersByTime(100);
    expect(app.ready).not.toHaveBeenCalled();
  });

  it('writes the safe areas as CSS vars and follows Telegram changes', () => {
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    const { app, emit } = fakeApp({ safeAreaInset: insets, contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 }, viewportStableHeight: 800 });
    const stop = syncSafeAreas(app);
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--pet-safe-top')).toBe('93px');
    expect(s.getPropertyValue('--pet-safe-bottom')).toBe('34px');
    expect(s.getPropertyValue('--pet-vh')).toBe('800px');
    insets.bottom = 20;
    emit('safeAreaChanged');
    expect(s.getPropertyValue('--pet-safe-bottom')).toBe('20px');
    stop();
  });

  it('holds the closing confirmation only while something holds it', () => {
    const { app, calls } = fakeApp();
    const a = holdClosing(app), b = holdClosing(app);
    a();
    a();
    expect(calls).toEqual(['enableClosing']);
    b();
    expect(calls).toEqual(['enableClosing', 'disableClosing']);
  });

  it('turns the shake sensor off on accelerometerFailed', () => {
    const acc = { start: vi.fn(), stop: vi.fn(), x: 1, y: 2, z: 3 };
    const { app, emit } = fakeApp({ Accelerometer: acc });
    const onSample = vi.fn();
    startAccelerometer(onSample, 50, app);
    expect(acc.start).toHaveBeenCalledWith({ refresh_rate: 50 }, expect.any(Function));
    emit('accelerometerChanged');
    expect(onSample).toHaveBeenCalledWith({ x: 1, y: 2, z: 3 });
    emit('accelerometerFailed', { error: 'UNSUPPORTED' });
    expect(acc.stop).toHaveBeenCalledTimes(1);
    emit('accelerometerChanged');
    expect(onSample).toHaveBeenCalledTimes(1);
  });

  it('reads the snapshot from localStorage first, then DeviceStorage', async () => {
    vi.useRealTimers();
    const getItem = vi.fn((_k: string, cb: (e: string | null, v?: string | null) => void) => cb(null, 'from-device'));
    const { app } = fakeApp({ DeviceStorage: { getItem, setItem: vi.fn() } });
    await expect(readStored('k1', 50, app)).resolves.toBe('from-device');
    localStorage.setItem('k2', 'from-local');
    await expect(readStored('k2', 50, app)).resolves.toBe('from-local');
    expect(getItem).toHaveBeenCalledTimes(1);
  });
});


describe('legacy private pet snapshot migration', () => {
  afterEach(() => localStorage.clear());
  it('clears every known legacy key without reading stored private values', () => {
    localStorage.setItem('vox-pet:previous', 'PRIVATE_PREVIOUS');
    localStorage.setItem('unrelated-setting', 'keep');
    const getItem = vi.fn(); const removeItem = vi.fn(); const setItem = vi.fn();
    const { app } = fakeApp({ DeviceStorage: { getItem, removeItem, setItem } });
    clearLegacyPetSnapshots('current', app);
    expect(localStorage.getItem('vox-pet:previous')).toBeNull();
    expect(localStorage.getItem('vox-pet:current')).toBeNull();
    expect(localStorage.getItem('unrelated-setting')).toBe('keep');
    expect(removeItem.mock.calls).toEqual([['vox-pet:current'], ['vox-pet:previous']]);
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });
  it('overwrites known DeviceStorage keys with empty values on clients without removeItem', () => {
    const getItem = vi.fn(); const setItem = vi.fn();
    const { app } = fakeApp({ DeviceStorage: { getItem, setItem } });
    clearLegacyPetSnapshots('current', app);
    expect(setItem).toHaveBeenCalledWith('vox-pet:current', '');
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe('circleCode (Circles S4)', () => {
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; window.history.replaceState({}, '', '/'); });
  const withStart = (start_param?: string) => { (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: 'x', initDataUnsafe: { start_param } } }; };

  it('prefers a p_ launch code from start_param, else the DM button ?j=, and ignores everything else', () => {
    withStart('p_AbCdEf12_abcdefghijklmnopqrstuv');
    window.history.replaceState({}, '', '/studio/pet/x?j=zzzzzzzzzzzzzzzzzzzz');
    expect(circleCode()).toBe('p_AbCdEf12_abcdefghijklmnopqrstuv');
    withStart('feed');
    expect(circleCode()).toBe('zzzzzzzzzzzzzzzzzzzz');
    window.history.replaceState({}, '', '/studio/pet/x?j=short');
    expect(circleCode()).toBeNull();
    withStart(undefined);
    window.history.replaceState({}, '', '/studio/pet/x');
    expect(circleCode()).toBeNull();
  });
});
