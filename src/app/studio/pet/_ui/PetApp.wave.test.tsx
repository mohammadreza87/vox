import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetApi, PetEngine, PetEngineOptions, VoiceStreamEvent } from './contract';
import { createMockApi } from './mock';

/* Wave B on the living page: streamed voice turns, the mic gate, rooms with the host, the Bop pips. */
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
// the recorder is its own chunk (mic.ts): hold before it arrives would fall back to typing, so load it like TalkPill.test does
const { loadMic } = await import('./TalkPill');
await loadMic();

function telegram() {
  const app = { initData: 'signed', initDataUnsafe: { user: { id: 1, first_name: 'Sara' } }, ready: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn(),
    setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), setBottomBarColor: vi.fn(), enableClosingConfirmation: vi.fn(), disableClosingConfirmation: vi.fn(), hideKeyboard: vi.fn() };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
  return app;
}
const engine = () => engines.at(-1)!.e;
const fast = (over: Partial<PetApi> = {}, o: Parameters<typeof createMockApi>[0] = {}): PetApi => ({ ...createMockApi({ latency: { care: 0, talk: 0 }, ...o }), ...over });
const bubble = (c: HTMLElement) => c.querySelector('.pet-bubble .pet-sr')?.textContent ?? '';
const ready = async (c: HTMLElement) => { await waitFor(() => expect(c.querySelector('[data-toy="cookie"]')).toBeTruthy()); await waitFor(() => expect(engine().fire.mock.calls.some((x) => (x[0] as { type: string }).type === 'hello')).toBe(true)); };

class Recorder {
  static isTypeSupported = () => true;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = 'audio/webm';
  start() {}
  stop() { this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.(); }
}
async function hold(c: HTMLElement) {
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) }, configurable: true });
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const mic = screen.getByRole('button', { name: 'Hold to talk' });
  await act(async () => { fireEvent.pointerDown(mic); });
  now.mockReturnValue(2500);
  act(() => { fireEvent.pointerUp(mic); });
  now.mockRestore();
  void c;
}

describe('PetApp, Wave B', () => {
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

  it('a streamed voice turn: the reply shows on its event; with no sentence audio the text lip-sync says it; `handsFree` stays off for a hold', async () => {
    telegram();
    const talkVoice = vi.fn();
    const talkVoiceStream = vi.fn(async (_id: string, _b: Blob, on: (e: VoiceStreamEvent) => void, o?: { handsFree?: boolean }) => {
      on({ type: 'transcript', text: 'hi there' });
      on({ type: 'reply', text: 'STREAMED_REPLY' });
      on({ type: 'done', turnId: 't' });
      void o;
      return { transcript: 'hi there', reply: 'STREAMED_REPLY', turnId: 't' };
    });
    const { container } = render(<PetApp agentId="x" api={fast({ talkVoice, talkVoiceStream })} />);
    await ready(container);
    await hold(container);
    await waitFor(() => expect(bubble(container)).toBe('STREAMED_REPLY'));
    await waitFor(() => expect(engine().speakText).toHaveBeenCalledWith('STREAMED_REPLY', expect.any(Number)));
    expect(talkVoice).not.toHaveBeenCalled();
    expect(talkVoiceStream.mock.calls[0][3]).toMatchObject({ handsFree: false });
  });

  it('a server without the stream route (null) gets the plain call; an empty transcript is the gentle "try again"', async () => {
    telegram();
    const talkVoice = vi.fn(async () => ({ transcript: '', reply: '' }));
    const talkVoiceStream = vi.fn(async () => null);
    const { container } = render(<PetApp agentId="x" api={fast({ talkVoice, talkVoiceStream })} />);
    await ready(container);
    await hold(container);
    await waitFor(() => expect(talkVoice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bubble(container)).toContain('didn’t catch that'));
  });

  it('the first hold with an unanswered UX-02 record opens the mic sheet instead of the OS prompt', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast({}, { askMic: true })} />);
    await ready(container);
    const getUserMedia = vi.fn();
    vi.stubGlobal('MediaRecorder', Recorder);
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    await waitFor(() => expect(container.querySelector('.pet-root')).toBeTruthy());
    // the Wave B layer mounts after hello
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: 'Use your microphone for this conversation?' })).toBeInTheDocument();
  });

  it('a room visit posts roomVisited once; Play shows its verbs; Bop keeps score as pips, never a digit', async () => {
    telegram();
    const base = fast();
    const play = vi.fn(base.play!);
    const { container } = render(<PetApp agentId="x" api={{ ...base, play }} />);
    await ready(container);
    fireEvent.click(screen.getByRole('tab', { name: 'Play' }));
    await waitFor(() => expect(play).toHaveBeenCalledWith('x', { op: 'roomVisited', room: 'play' }, expect.anything()));
    expect(engine().setRoom).toHaveBeenCalledWith('play', {});
    expect(await screen.findByRole('button', { name: 'Starfall' })).toBeInTheDocument();
    act(() => { engines[0].opts.onCue?.({ type: 'score', bops: 4, misses: 0 }); });
    const pips = screen.getByRole('img', { name: 'Round progress' });
    expect(pips.querySelectorAll('i[data-on]')).toHaveLength(4);
    expect(pips.textContent).toBe('');
  });

  it('a typed "remember this" that the reply answered shows the confirm step (no server field for a saved note yet)', async () => {
    telegram();
    const { container } = render(<PetApp agentId="x" api={fast()} />);
    await ready(container);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const input = screen.getByRole('textbox', { name: 'Talk to Mochi' });
    fireEvent.change(input, { target: { value: 'remember this: we plan a release on Tuesdays' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('dialog', { name: 'Shall I keep this as “I learned how you plan a release”?' })).toBeInTheDocument();
  });
});
