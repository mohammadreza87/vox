import { act, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AgentView } from '../../_lib/client';
import { SpawnScreen } from './Spawn';

const state = vi.hoisted(() => ({
  draft: vi.fn(),
  agent: vi.fn(),
  nav: {
    me: { org: 'Fixture team', member: { telegramId: 7777001, role: 'member' }, features: { avatars: false, voices: false, calls: false } },
    back: vi.fn(), reset: vi.fn(), push: vi.fn(), toast: vi.fn(), refreshMe: vi.fn(),
  },
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, draft: state.draft, agent: state.agent } };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));

// These regressions exercise API failures, retry state and polling, not animation timing.
vi.mock('framer-motion', async () => {
  const { createElement } = await import('react');
  const element = (tag: string) => function MotionElement({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
    const domProps = Object.fromEntries(Object.entries(props).filter(([key]) =>
      !['initial', 'animate', 'exit', 'transition', 'whileTap', 'layoutId', 'layout'].includes(key)));
    return createElement(tag, domProps, children);
  };
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: { div: element('div'), button: element('button'), span: element('span') },
  };
});

function agent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'draft',
    persona: {
      name: 'Nova', role: 'Designer', tagline: 'Finds the fun', backstory: 'A helpful teammate.',
      personality: 'Curious', communicationStyle: 'Clear', values: ['Craft'], expertise: ['Design'],
      wontDo: 'Legal advice', languages: ['English'], culture: '', presentation: 'neutral',
      age: '30s', accent: '', voiceBrief: 'A clear voice.', avatarHint: '',
    },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: false, formingDay: null, isAdmin: false, visibility: 'private', access: [],
    createdBy: 7777001, canEdit: true, canFire: false, canManageAccess: true,
    ...overrides,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('Spawn failure recovery', () => {
  it('keeps a failed draft error and the visitor’s brief available after the transient toast expires', async () => {
    const message = 'Vox Studio returned an unexpected page. Close and reopen the Mini App, then try again.';
    state.draft.mockRejectedValue(new ApiError(200, message));
    render(<SpawnScreen />);
    fireEvent.change(screen.getByPlaceholderText(/a calm product lead/i), { target: { value: 'An analytical teammate' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(state.nav.toast).toHaveBeenCalledWith(message, 'error');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByPlaceholderText(/a calm product lead/i)).toHaveValue('An analytical teammate');
    expect(screen.getByRole('button', { name: /draft with claude/i })).toBeEnabled();
  });

  it.each([
    ['an expired session', new ApiError(401, 'Open Vox Studio from Telegram.')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('shows %s during Telegram confirmation and still completes after polling recovers', async (_label, error) => {
    const waiting = agent({ status: 'awaiting_bot' });
    const active = agent({ status: 'active', bot: { username: 'fixture_nova_bot' } });
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockRejectedValueOnce(error).mockResolvedValueOnce({ agent: active });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    expect(screen.getByText('Waiting for Telegram…')).toBeVisible();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByText('Waiting for Telegram…')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(error.message);
    expect(screen.getByRole('button', { name: /open telegram again/i })).toBeEnabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(3);
  });

  it('moves from the actual Brief button to the editable Persona step after a successful draft', async () => {
    state.draft.mockResolvedValue({ agent: agent(), names: ['Nova', 'Alt'] });
    render(<SpawnScreen />);
    fireEvent.change(screen.getByPlaceholderText(/a calm product lead/i), { target: { value: 'A curious designer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Persian' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });

    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({ description: 'A curious designer', languages: ['Persian'] }), undefined);
    expect(screen.queryByRole('button', { name: /draft with claude/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nova' })).toBeVisible();
    expect(screen.getByRole('button', { name: /looks good.*next/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
