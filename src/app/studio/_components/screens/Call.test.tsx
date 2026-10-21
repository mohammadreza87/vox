import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { setMediaQueries } from '@/test/browser';
import { CallScreen } from './Call';

const mocks = vi.hoisted(() => ({
  agent: vi.fn(), liveCall: vi.fn(), callEnd: vi.fn(), callTurn: vi.fn(), event: vi.fn(), startSession: vi.fn(),
  endSession: vi.fn(), setMicMuted: vi.fn(), getInputVolume: vi.fn(), getUserMedia: vi.fn(),
  predict: vi.fn(), invalidate: vi.fn(), validate: vi.fn(),
  back: vi.fn(), push: vi.fn(), toast: vi.fn(), cloudRenders: vi.fn(),
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: mocks.agent, liveCall: mocks.liveCall, callEnd: mocks.callEnd, callTurn: mocks.callTurn },
    haptic: { tap: vi.fn(), light: vi.fn(), medium: vi.fn(), rigid: vi.fn(), error: vi.fn(), select: vi.fn(), soft: vi.fn(), heavy: vi.fn(), success: vi.fn(), warn: vi.fn() } };
});
vi.mock('../../_lib/learning-client', () => ({ learningApi: { event: mocks.event } }));
vi.mock('@elevenlabs/client', () => ({ Conversation: { startSession: mocks.startSession } }));
vi.mock('@/lib/adaptive/prediction/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/adaptive/prediction/client')>(),
  predictionHttpTransport: () => ({ send: mocks.predict, invalidate: mocks.invalidate, validate: mocks.validate }),
}));
vi.mock('../Cloud', () => ({
  Cloud: (p: unknown) => { mocks.cloudRenders(p); return null; },
  PALETTE: { sky: { base: '#8CC8FF', light: '#CFE6FF', shadow: '#5294DC', glow: '#6BB8FF', name: 'Sky' } },
  stageFor: () => 4,
}));
// App-level space and language (D17): tests set them here; setSpace records the switch.
const navState = vi.hoisted(() => ({ space: 'work' as 'work' | 'personal', locale: 'en' as 'en' | 'fa' }));
vi.mock('../StudioApp', () => ({
  useNav: () => ({ back: mocks.back, push: mocks.push, toast: mocks.toast, space: navState.space, locale: navState.locale,
    setSpace: (s: 'work' | 'personal') => { navState.space = s; }, cache: new Map() }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));

function agent(): AgentView {
  return {
    id: 'synthetic-agent', status: 'active',
    persona: { name: 'Nova', role: 'Designer', tagline: '', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '', languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '', voiceBrief: '', avatarHint: '' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: true, formingDay: null, isAdmin: false, visibility: 'private', liveWeb: false,
    groupBehavior: { participation: 'balanced', remember: true }, access: [], createdBy: 1,
    canEdit: false, canFire: false, canManageAccess: false,
  };
}

class FakeMediaRecorder {
  static isTypeSupported() { return false; }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['a'.repeat(2500)]) }); this.onstop?.(); }
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  constructor() { FakeAudio.instances.push(this); }
}

beforeEach(() => {
  vi.resetAllMocks();
  navState.space = 'work'; navState.locale = 'en';
  FakeAudio.instances = [];
  mocks.event.mockResolvedValue({ status: 'recorded' });
  mocks.callTurn.mockResolvedValue({ transcript: 'Hello', reply: 'Hi', audio: 'synthetic', turnId: 'synthetic-turn' });
  mocks.agent.mockResolvedValue({ agent: agent() });
  mocks.liveCall.mockResolvedValue({ live: true, signedUrl: 'https://synthetic.invalid/session', callToken: 'synthetic-call-token', voiceId: 'synthetic-voice', firstMessage: 'Hello.' });
  mocks.callEnd.mockResolvedValue({ ok: true });
  mocks.startSession.mockResolvedValue({ endSession: mocks.endSession, setMicMuted: mocks.setMicMuted, getInputVolume: mocks.getInputVolume });
  mocks.endSession.mockResolvedValue(undefined);
  mocks.predict.mockResolvedValue({ status: 'unknown', reason: 'disabled', elapsedMs: 0 });
  mocks.invalidate.mockResolvedValue({ cancelled: true }); mocks.validate.mockResolvedValue({ valid: true });
  mocks.getInputVolume.mockReturnValue(0);
  const track = { stop: vi.fn() };
  mocks.getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const openOptions = (name = 'Call options') => fireEvent.click(screen.getByRole('button', { name }));
const closeSheet = () => fireEvent.keyDown(document, { key: 'Escape' });

describe('Call screen conversation space', () => {
  it('switches to Personal in the options sheet, sends it to the live-call API and locks the switch for the session', async () => {
    render(<CallScreen id="synthetic-agent" />);
    await screen.findByRole('button', { name: 'Talk' });
    openOptions();
    fireEvent.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(navState.space).toBe('personal');
    closeSheet();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Talk' })); });

    await waitFor(() => expect(mocks.liveCall).toHaveBeenCalledWith('synthetic-agent', 'personal'));
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
    openOptions();
    expect(screen.getByRole('tab', { name: 'Work' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Personal' })).toBeDisabled();
    closeSheet();

    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    await waitFor(() => expect(mocks.callEnd).toHaveBeenCalledWith('synthetic-agent', 'personal'));
  });

  it('falls back to tap-to-talk when live calls are unavailable without starting a live provider session', async () => {
    mocks.liveCall.mockResolvedValue({ live: false });
    navState.space = 'personal';
    render(<CallScreen id="synthetic-agent" />);
    const talk = await screen.findByRole('button', { name: 'Talk' });
    await act(async () => { fireEvent.click(talk); });

    await waitFor(() => expect(mocks.liveCall).toHaveBeenCalledWith('synthetic-agent', 'personal'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
});

describe('Call screen layout (board 1-1-call)', () => {
  it('has no space chips, Privacy chip or raw select; space lives in the header subtitle', async () => {
    const { container } = render(<CallScreen id="synthetic-agent" />);
    await screen.findByRole('button', { name: 'Talk' });
    expect(container.querySelector('select')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Privacy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Personal' })).not.toBeInTheDocument();
    expect(screen.getByText(/Designer · Work/)).toBeInTheDocument();
  });

  it('starts the timer on connect, then shows the board controls: Mute, Captions, End', async () => {
    render(<CallScreen id="synthetic-agent" />);
    await screen.findByRole('button', { name: 'Talk' });
    expect(screen.getByText(/Designer · Work/).textContent).not.toMatch(/\d:\d\d/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Talk' })); });
    await screen.findByRole('button', { name: 'Mute' });
    expect(screen.getByText(/Designer · Work/).textContent).toMatch(/0:00/);
    expect(screen.getByRole('button', { name: 'Captions' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Talk' })).not.toBeInTheDocument();
    expect(screen.getByText('Listening')).toBeInTheDocument();
  });

  it('shows the last turn in a caption card that the Captions control hides', async () => {
    const { container } = render(<CallScreen id="synthetic-agent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk' }));
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
    const callbacks = mocks.startSession.mock.calls[0][0];
    act(() => callbacks.onMessage({ role: 'agent', message: 'Parastoo said Feb 20.' }));
    expect(container.querySelector('.vx-caption-who')?.textContent).toBe('Nova');
    expect(screen.getByText('Parastoo said Feb 20.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Captions' }));
    await waitFor(() => expect(screen.queryByText('Parastoo said Feb 20.')).not.toBeInTheDocument());
  });

  it('asks for the microphone inline (no toast) and retries from the banner', async () => {
    mocks.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    render(<CallScreen id="synthetic-agent" />);
    const talk = await screen.findByRole('button', { name: 'Talk' });
    await act(async () => { fireEvent.click(talk); });
    expect(await screen.findByText(/Vox needs the microphone/)).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    await screen.findByRole('button', { name: 'Mute' });
    expect(screen.queryByText(/Vox needs the microphone/)).not.toBeInTheDocument();
  });
});

async function tapToTalk() {
  const talk = await screen.findByRole('button', { name: 'Talk' });
  await act(async () => { fireEvent.click(talk); });
  fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.callTurn).toHaveBeenCalled());
  await screen.findByText('Tap to interrupt');
  return FakeAudio.instances[0];
}

describe('Correlated browser playback evidence', () => {
  beforeEach(() => { mocks.liveCall.mockResolvedValue({ live: false }); navState.space = 'personal'; });
  it('reports actual playing and ending once each using the exact turn and space', async () => {
    render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk();
    expect(mocks.event).not.toHaveBeenCalled();
    const ended = player.onended!;
    act(() => { player.onplaying?.(); player.onplaying?.(); });
    act(() => { ended(); ended(); });
    expect(mocks.event).toHaveBeenCalledTimes(2);
    expect(mocks.event).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentId: 'synthetic-agent', turnId: 'synthetic-turn', space: 'personal', outcome: 'playback_started', eventId: expect.any(String) }));
    expect(mocks.event.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
    expect(mocks.event.mock.calls[0][0].durationMs).toBeLessThanOrEqual(86_400_000);
    expect(mocks.event).toHaveBeenNthCalledWith(2, expect.objectContaining({ outcome: 'playback_completed' }));
    expect(mocks.event.mock.calls[0][0].eventId).not.toBe(mocks.event.mock.calls[1][0].eventId);
  });
  it('reports explicit interruption and ignores the old ended callback', async () => {
    render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk(); const ended = player.onended!;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Talk' })); });
    act(() => ended());
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'interrupted' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
  it('handles actual audio errors without letting failed reporting affect playback state', async () => {
    mocks.event.mockRejectedValue(new Error('reporting offline'));
    render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk();
    await act(async () => { player.onerror?.(); });
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'playback_failed' }));
    expect(screen.getByText('Tap to talk')).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('does not fabricate evidence without a server-accepted correlation', async () => {
    mocks.callTurn.mockResolvedValue({ transcript: 'Hello', reply: 'Hi', audio: 'synthetic' });
    render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk();
    act(() => { player.onplaying?.(); player.onended?.(); });
    expect(mocks.event).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Reported task outcome')).not.toBeInTheDocument();
    expect(screen.getByText('Tap to talk')).toBeInTheDocument();
  });
  it('clears correlation on unmount and ignores a late audio callback', async () => {
    const { unmount } = render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk(); const playing = player.onplaying!; const ended = player.onended!;
    unmount(); act(() => { playing(); ended(); });
    expect(mocks.event).not.toHaveBeenCalled();
    expect(player.onplaying).toBeNull(); expect(player.onended).toBeNull();
  });
  it('reports active playback once when native back unmounts the call', async () => {
    function Navigation() {
      const [visible, setVisible] = useState(true);
      mocks.back.mockImplementation(() => setVisible(false));
      return visible ? <CallScreen id="synthetic-agent" /> : <div>Destination</div>;
    }
    render(<Navigation />);
    const player = await tapToTalk();
    const playing = player.onplaying!; const ended = player.onended!; const failed = player.onerror!;
    act(() => playing());
    mocks.event.mockClear();
    act(() => mocks.back());
    expect(screen.getByText('Destination')).toBeInTheDocument();
    act(() => { playing(); ended(); failed(); });
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'synthetic-agent', space: 'personal', turnId: 'synthetic-turn', outcome: 'interrupted' }));
    expect(player.pause).toHaveBeenCalled();
    expect(player.onplaying).toBeNull(); expect(player.onended).toBeNull(); expect(player.onerror).toBeNull();
  });
  it.each(['End call', 'Close call'])('%s reports active playback once, stops the call and asks how it went before leaving', async (control) => {
    render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk();
    const playing = player.onplaying!; const ended = player.onended!;
    act(() => playing());
    mocks.event.mockClear();
    fireEvent.click(screen.getByRole('button', { name: control }));
    act(() => { playing(); ended(); });
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'interrupted', turnId: 'synthetic-turn' }));
    expect(player.onplaying).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Call ended' })).toBeInTheDocument();
    expect(mocks.back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });
  it('uses the old captured agent and space when replacing an actively playing screen', async () => {
    const { rerender } = render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk();
    act(() => player.onplaying?.());
    mocks.event.mockClear();
    await act(async () => { rerender(<CallScreen id="new-agent" />); });
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'synthetic-agent', space: 'personal', turnId: 'synthetic-turn', outcome: 'interrupted' }));
  });
  it.each(['completed', 'interrupted', 'uncorrelated'])('does not report another interruption on unmount after %s playback', async state => {
    if (state === 'uncorrelated') mocks.callTurn.mockResolvedValue({ transcript: 'Hello', reply: 'Hi', audio: 'synthetic' });
    const { unmount } = render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk();
    act(() => player.onplaying?.());
    if (state === 'completed') act(() => player.onended?.());
    if (state === 'interrupted') await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Talk' })); });
    mocks.event.mockClear();
    unmount();
    expect(mocks.event).not.toHaveBeenCalled();
  });
  it('discards an old agent response after the screen changes agent', async () => {
    let finish!: (value: object) => void;
    mocks.callTurn.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<CallScreen id="synthetic-agent" />);
    const talk = await screen.findByRole('button', { name: 'Talk' });
    await act(async () => { fireEvent.click(talk); });
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.callTurn).toHaveBeenCalled());
    rerender(<CallScreen id="new-agent" />);
    await act(async () => finish({ transcript: 'OLD_AGENT_CANARY', reply: 'old', audio: 'old', turnId: 'old-turn' }));
    expect(screen.queryByText('OLD_AGENT_CANARY')).not.toBeInTheDocument();
    expect(mocks.event).not.toHaveBeenCalled();
    expect(FakeAudio.instances[0].src).toBe('');
  });
  it('offers optional task feedback in the end-of-call summary for the correlated tap-to-talk turn', async () => {
    render(<CallScreen id="synthetic-agent" />);
    await tapToTalk();
    expect(screen.queryByRole('button', { name: 'Yes', exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    await screen.findByRole('dialog', { name: 'Call ended' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes', exact: true })); });
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'synthetic-agent', space: 'personal',
      turnId: 'synthetic-turn', outcome: 'task_succeeded' }));
  });
});

describe('Optional live provisional preparation', () => {
  const debug = (message: string, eventId = 1) => ({ type: 'tentative_user_transcript',
    tentative_user_transcription_event: { user_transcript: message, event_id: eventId } });
  /** Labels default to English; a Persian session passes its own. */
  async function connect(labels = { talk: 'Talk', mute: 'Mute', options: 'Call options' }) {
    const view = render(<CallScreen id="synthetic-agent" />);
    fireEvent.click(await screen.findByRole('button', { name: labels.talk }));
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
    await screen.findByRole('button', { name: labels.mute });
    openOptions(labels.options);
    return { ...view, callbacks: mocks.startSession.mock.calls[0][0] };
  }
  it('keeps preparation unavailable when server configuration is absent, even if tentative events arrive', async () => {
    const { callbacks } = await connect();
    expect(screen.getByRole('switch')).toBeDisabled();
    act(() => callbacks.onDebug(debug('Private partial.')));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(mocks.predict).not.toHaveBeenCalled();
  });
  it('requires explicit opt-in, consumes actual tentative debug shape and final user messages cancel it', async () => {
    mocks.predict.mockImplementation(() => new Promise(() => {}));
    mocks.liveCall.mockResolvedValue({ live: true, signedUrl: 'https://synthetic.invalid/session', callToken: 'synthetic',
      voiceId: 'synthetic', firstMessage: '', partialPrediction: { available: true, configurationVersion: 'synthetic-v1' } });
    const { callbacks, unmount } = await connect();
    expect(screen.getByRole('switch')).not.toBeChecked();
    act(() => callbacks.onDebug(debug('Off default.')));
    expect(mocks.predict).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch'));
    act(() => callbacks.onDebug(debug('Prepare this clause.')));
    await waitFor(() => expect(mocks.predict).toHaveBeenCalledTimes(1));
    const signal = mocks.predict.mock.calls[0][1] as AbortSignal;
    act(() => callbacks.onMessage({ role: 'user', message: 'Final corrected message.' }));
    expect(signal.aborted).toBe(true); expect(mocks.invalidate).toHaveBeenCalled();
    expect(screen.getByText('Final corrected message.')).toBeInTheDocument();
    expect(screen.queryByText('Prepare this clause.')).not.toBeInTheDocument();
    act(() => callbacks.onDebug(debug('Late same event.')));
    unmount(); act(() => callbacks.onDebug(debug('Unmounted event.', 2)));
    expect(mocks.predict).toHaveBeenCalledTimes(1);
  });
  it('shows the separate Persian disclosure in the app language and keeps ordinary microphone permission independent', async () => {
    navState.locale = 'fa';
    await connect({ talk: 'صحبت', mute: 'بی‌صدا کردن', options: 'گزینه‌های تماس' });
    expect(screen.getByRole('switch').closest('section')).toHaveAttribute('dir', 'rtl');
    // the call body speaks the app language too, never English next to the Persian panel
    expect(screen.getByText('برای تغییر فضا، تماس را پایان دهید.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'پایان تماس' })).toBeInTheDocument();
    expect(screen.queryByText(/Listening|End the call|Call options/)).toBeNull();
    expect(screen.getByRole('switch')).toBeDisabled(); expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('aborts preparation on actual interruption and mute callbacks and ignores callbacks after agent replacement', async () => {
    mocks.predict.mockImplementation(() => new Promise(() => {}));
    mocks.liveCall.mockResolvedValue({ live: true, signedUrl: 'https://synthetic.invalid/session', callToken: 'synthetic',
      voiceId: 'synthetic', firstMessage: '', partialPrediction: { available: true, configurationVersion: 'synthetic-v1' } });
    const { callbacks, rerender } = await connect();
    fireEvent.click(screen.getByRole('switch'));
    act(() => callbacks.onDebug(debug('First provisional turn.', 1)));
    await waitFor(() => expect(mocks.predict).toHaveBeenCalledTimes(1));
    act(() => callbacks.onInterruption({ event_id: 1 }));
    expect(mocks.predict.mock.calls[0][1].aborted).toBe(true);
    act(() => callbacks.onDebug(debug('Second provisional turn.', 2)));
    await waitFor(() => expect(mocks.predict).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Mute', exact: true }));
    expect(mocks.predict.mock.calls[1][1].aborted).toBe(true);
    act(() => { callbacks.onModeChange({ mode: 'speaking' }); callbacks.onModeChange({ mode: 'listening' }); });
    act(() => callbacks.onDebug(debug('Muted speech.', 3)));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(mocks.predict).toHaveBeenCalledTimes(2);
    await act(async () => { rerender(<CallScreen id="other-agent" />); });
    act(() => callbacks.onDebug(debug('Old session speech.', 4)));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(mocks.predict).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('switch')).not.toBeChecked(); expect(screen.getByRole('switch')).toBeDisabled();
  });
});

describe('Call performance', () => {
  it('drives the mic level through motion values: 60 frames of audio never re-render the screen', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    let volume = 0;
    mocks.getInputVolume.mockImplementation(() => (volume = (volume + 0.07) % 0.5));
    render(<CallScreen id="synthetic-agent" />);
    const talk = await screen.findByRole('button', { name: 'Talk' });
    await act(async () => { fireEvent.click(talk); });
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Mute' });

    const before = mocks.cloudRenders.mock.calls.length;
    const reads = mocks.getInputVolume.mock.calls.length;
    act(() => { for (let i = 0; i < 60; i++) frames.shift()?.(i * 16.7); });
    expect(mocks.getInputVolume.mock.calls.length - reads).toBe(60);
    expect(mocks.cloudRenders.mock.calls.length).toBe(before);
  });

  it('rests the meter loop once nothing is metered and the level has decayed, and wakes it for the next turn', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    mocks.liveCall.mockResolvedValue({ live: false });
    render(<CallScreen id="synthetic-agent" />);
    const player = await tapToTalk();
    act(() => { for (let i = 0; i < 30; i++) frames.shift()?.(i * 16.7); });
    expect(frames).toHaveLength(1); // speaking: one frame always pending
    act(() => { player.onended?.(); });
    act(() => { for (let i = 0; i < 400 && frames.length; i++) frames.shift()?.(i * 16.7); });
    expect(frames).toHaveLength(0); // ready, level decayed: no frame scheduled
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Talk' })); });
    await screen.findByRole('button', { name: 'Send' });
    expect(frames).toHaveLength(1); // the stream is reused, so the phase change restarts the loop
  });

  it('hangs up only through End (or the close control) and renders no animated box-shadow or blur filter', async () => {
    const { container } = render(<CallScreen id="synthetic-agent" />);
    await screen.findByRole('button', { name: 'Talk' });
    expect(container.innerHTML).not.toMatch(/box-shadow|blur\(/);
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    expect(mocks.back).not.toHaveBeenCalled(); // the face nods "bye" first
    await waitFor(() => expect(mocks.back).toHaveBeenCalledTimes(1));
  });
});

type FaceProps = { moment?: { kind: string } | null; onMomentEnd?: (k: string) => void };
const face = () => mocks.cloudRenders.mock.calls.at(-1)?.[0] as FaceProps;

describe('call face moments (motion §3.3)', () => {
  it('perks at once when the call opens without a flight', async () => {
    render(<CallScreen id="synthetic-agent" />);
    await screen.findByRole('button', { name: 'Talk' });
    expect(face().moment?.kind).toBe('perk');
  });

  it('waits for the hero flight to land before the perk', async () => {
    render(<div className="vx-screen" data-arrive="hero"><CallScreen id="synthetic-agent" /></div>);
    await screen.findByRole('button', { name: 'Talk' });
    expect(face().moment ?? null).toBeNull();
    await waitFor(() => expect(face().moment?.kind).toBe('perk'), { timeout: 1000 });
  });

  it('hang-up nods "bye", then pops once, whichever ends first', async () => {
    render(<CallScreen id="synthetic-agent" />);
    await screen.findByRole('button', { name: 'Talk' });
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    expect(face().moment?.kind).toBe('nod');
    expect(mocks.back).not.toHaveBeenCalled();
    act(() => { face().onMomentEnd?.('nod'); });
    expect(mocks.back).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });

  it('reduced motion hangs up at once, with no nod', async () => {
    setMediaQueries({ '(prefers-reduced-motion: reduce)': true });
    render(<CallScreen id="synthetic-agent" />);
    await screen.findByRole('button', { name: 'Talk' });
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    expect(mocks.back).toHaveBeenCalledTimes(1);
    expect(face().moment?.kind).not.toBe('nod');
  });
});
