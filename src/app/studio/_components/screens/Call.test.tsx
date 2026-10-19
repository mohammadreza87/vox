import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { CallScreen } from './Call';

const mocks = vi.hoisted(() => ({
  agent: vi.fn(), liveCall: vi.fn(), callEnd: vi.fn(), startSession: vi.fn(),
  endSession: vi.fn(), setMicMuted: vi.fn(), getInputVolume: vi.fn(), getUserMedia: vi.fn(),
  back: vi.fn(), push: vi.fn(), toast: vi.fn(),
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: mocks.agent, liveCall: mocks.liveCall, callEnd: mocks.callEnd },
    haptic: { tap: vi.fn(), error: vi.fn(), select: vi.fn(), soft: vi.fn(), heavy: vi.fn(), success: vi.fn() } };
});
vi.mock('@elevenlabs/client', () => ({ Conversation: { startSession: mocks.startSession } }));
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
    motion: { div: element('div'), button: element('button') } };
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
  stop() { this.state = 'inactive'; this.onstop?.(); }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.agent.mockResolvedValue({ agent: agent() });
  mocks.liveCall.mockResolvedValue({ live: true, signedUrl: 'https://synthetic.invalid/session', callToken: 'synthetic-call-token', voiceId: 'synthetic-voice', firstMessage: 'Hello.' });
  mocks.callEnd.mockResolvedValue({ ok: true });
  mocks.startSession.mockResolvedValue({ endSession: mocks.endSession, setMicMuted: mocks.setMicMuted, getInputVolume: mocks.getInputVolume });
  mocks.endSession.mockResolvedValue(undefined);
  mocks.getInputVolume.mockReturnValue(0);
  const track = { stop: vi.fn() };
  mocks.getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('Audio', class { play() { return Promise.resolve(); } pause() {} src = ''; onended: (() => void) | null = null; });
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
