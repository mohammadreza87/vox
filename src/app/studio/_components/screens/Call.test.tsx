import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { CallScreen } from './Call';

const mocks = vi.hoisted(() => ({
  agent: vi.fn(), liveCall: vi.fn(), callEnd: vi.fn(), callTurn: vi.fn(), event: vi.fn(), startSession: vi.fn(),
  endSession: vi.fn(), setMicMuted: vi.fn(), getInputVolume: vi.fn(), getUserMedia: vi.fn(),
  predict: vi.fn(), invalidate: vi.fn(), validate: vi.fn(),
  back: vi.fn(), push: vi.fn(), toast: vi.fn(),
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: mocks.agent, liveCall: mocks.liveCall, callEnd: mocks.callEnd, callTurn: mocks.callTurn },
    haptic: { tap: vi.fn(), error: vi.fn(), select: vi.fn(), soft: vi.fn(), heavy: vi.fn(), success: vi.fn() } };
});
vi.mock('../../_lib/learning-client', () => ({ learningApi: { event: mocks.event } }));
vi.mock('@elevenlabs/client', () => ({ Conversation: { startSession: mocks.startSession } }));
vi.mock('@/lib/adaptive/prediction/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/adaptive/prediction/client')>(),
  predictionHttpTransport: () => ({ send: mocks.predict, invalidate: mocks.invalidate, validate: mocks.validate }),
}));
vi.mock('../Cloud', () => ({ Cloud: () => null, PALETTE: { sky: { glow: '#fff' } }, stageFor: () => 4 }));
vi.mock('../StudioApp', () => ({
  useNav: () => ({ back: mocks.back, push: mocks.push, toast: mocks.toast }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));
vi.mock('../ui', () => ({ Icon: () => null, TopBar: () => null }));
vi.mock('framer-motion', async () => {
  const { createElement } = await import('react');
  const element = (tag: string) => function MotionElement({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
    const domProps = Object.fromEntries(Object.entries(props).filter(([key]) =>
      !['initial', 'animate', 'exit', 'transition', 'whileTap'].includes(key)));
    return createElement(tag, domProps, children);
  };
  return { AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: { div: element('div'), button: element('button'), p: element('p') } };
});

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

describe('Call screen conversation space', () => {
  it('sends Personal to the live-call API and locks the selector for the active session', async () => {
    render(<CallScreen id="synthetic-agent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Personal', exact: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Talk' })); });

    await waitFor(() => expect(mocks.liveCall).toHaveBeenCalledWith('synthetic-agent', 'personal'));
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
    expect(screen.getByRole('group', { name: 'Conversation space' }).querySelectorAll('button')[0]).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Conversation space' }).querySelectorAll('button')[1]).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    await waitFor(() => expect(mocks.callEnd).toHaveBeenCalledWith('synthetic-agent', 'personal'));
  });

  it('falls back to tap-to-talk when live calls are unavailable without starting a live provider session', async () => {
    mocks.liveCall.mockResolvedValue({ live: false });
    render(<CallScreen id="synthetic-agent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Personal', exact: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Talk' })); });

    await waitFor(() => expect(mocks.liveCall).toHaveBeenCalledWith('synthetic-agent', 'personal'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
});

async function tapToTalk() {
  fireEvent.click(await screen.findByRole('button', { name: 'Personal', exact: true }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Talk' })); });
  fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.callTurn).toHaveBeenCalled());
  await screen.findByText('Tap to interrupt');
  return FakeAudio.instances[0];
}

describe('Correlated browser playback evidence', () => {
  beforeEach(() => { mocks.liveCall.mockResolvedValue({ live: false }); });
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
  it.each(['Minimize', 'Privacy', 'native back'])('reports active playback once when navigation unmounts through %s', async route => {
    function Navigation() {
      const [visible, setVisible] = useState(true);
      mocks.back.mockImplementation(() => setVisible(false));
      mocks.push.mockImplementation(() => setVisible(false));
      return visible ? <CallScreen id="synthetic-agent" /> : <div>Destination</div>;
    }
    render(<Navigation />);
    const player = await tapToTalk();
    const playing = player.onplaying!; const ended = player.onended!; const failed = player.onerror!;
    act(() => playing());
    mocks.event.mockClear();
    act(() => {
      if (route === 'native back') mocks.back();
      else fireEvent.click(screen.getByRole('button', { name: route, exact: true }));
    });
    expect(screen.getByText('Destination')).toBeInTheDocument();
    act(() => { playing(); ended(); failed(); });
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'synthetic-agent', space: 'personal', turnId: 'synthetic-turn', outcome: 'interrupted' }));
    expect(player.pause).toHaveBeenCalled();
    expect(player.onplaying).toBeNull(); expect(player.onended).toBeNull(); expect(player.onerror).toBeNull();
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
  it('offers optional task feedback only for the successful correlated tap-to-talk turn', async () => {
    render(<CallScreen id="synthetic-agent" />);
    await tapToTalk();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes', exact: true })); });
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'synthetic-agent', space: 'personal',
      turnId: 'synthetic-turn', outcome: 'task_succeeded' }));
  });
});

describe('Optional live provisional preparation', () => {
  const debug = (message: string, eventId = 1) => ({ type: 'tentative_user_transcript',
    tentative_user_transcription_event: { user_transcript: message, event_id: eventId } });
  async function connect() {
    const view = render(<CallScreen id="synthetic-agent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk' }));
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
    return { ...view, callbacks: mocks.startSession.mock.calls[0][0] };
  }
  it('keeps preparation unavailable when server configuration is absent, even if tentative events arrive', async () => {
    const { callbacks } = await connect();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    act(() => callbacks.onDebug(debug('Private partial.')));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(mocks.predict).not.toHaveBeenCalled();
  });
  it('requires explicit opt-in, consumes actual tentative debug shape and final user messages cancel it', async () => {
    mocks.predict.mockImplementation(() => new Promise(() => {}));
    mocks.liveCall.mockResolvedValue({ live: true, signedUrl: 'https://synthetic.invalid/session', callToken: 'synthetic',
      voiceId: 'synthetic', firstMessage: '', partialPrediction: { available: true, configurationVersion: 'synthetic-v1' } });
    const { callbacks, unmount } = await connect();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    act(() => callbacks.onDebug(debug('Off default.')));
    expect(mocks.predict).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
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
  it('shows the separate Persian disclosure and keeps ordinary microphone permission independent', async () => {
    await connect();
    fireEvent.change(screen.getByLabelText('Language / زبان'), { target: { value: 'fa' } });
    expect(screen.getByRole('checkbox').closest('section')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('checkbox')).toBeDisabled(); expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('aborts preparation on actual interruption and mute callbacks and ignores callbacks after agent replacement', async () => {
    mocks.predict.mockImplementation(() => new Promise(() => {}));
    mocks.liveCall.mockResolvedValue({ live: true, signedUrl: 'https://synthetic.invalid/session', callToken: 'synthetic',
      voiceId: 'synthetic', firstMessage: '', partialPrediction: { available: true, configurationVersion: 'synthetic-v1' } });
    const { callbacks, rerender } = await connect();
    fireEvent.click(screen.getByRole('checkbox'));
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
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
