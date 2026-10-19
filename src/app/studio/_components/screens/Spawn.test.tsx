import { act, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AgentView } from '../../_lib/client';
import { SpawnScreen } from './Spawn';
import { AgentScreen } from './Agent';

const state = vi.hoisted(() => ({
  draft: vi.fn(),
  agent: vi.fn(),
  updatePersona: vi.fn(),
  syncProfile: vi.fn(),
  nav: {
    me: { org: 'Fixture team', member: { telegramId: 7777001, role: 'member' }, features: { avatars: false, voices: false, calls: false } },
    back: vi.fn(), reset: vi.fn(), push: vi.fn(), toast: vi.fn(), refreshMe: vi.fn(),
  },
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, draft: state.draft, agent: state.agent, updatePersona: state.updatePersona, syncProfile: state.syncProfile } };
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
    motion: { div: element('div'), button: element('button'), span: element('span'), path: element('path') },
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

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
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
    const active = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'synced', failed: [] } });
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

describe('Persona edits before advancing', () => {
  it.each([
    ['Name', 'Nova', 'Neda', 'name'],
    ['Personality', 'Curious', 'Warm and curious', 'personality'],
  ])('saves an edited %s and waits for confirmation before Next', async (label, original, value, field) => {
    const current = agent();
    state.agent.mockResolvedValue({ agent: current });
    let finish!: (value: { agent: AgentView }) => void;
    state.updatePersona.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: `${label}${original} Edit` }));
    fireEvent.change(screen.getByDisplayValue(original), { target: { value } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });

    expect(state.updatePersona).toHaveBeenCalledExactlyOnceWith(current.id, { [field]: value });
    expect(screen.getByDisplayValue(value)).toBeVisible();
    expect(screen.queryByRole('heading', { name: /shape .* cloud/i })).not.toBeInTheDocument();
    const saved = agent({ persona: { ...current.persona, [field]: value } });
    await act(async () => { finish({ agent: saved }); });
    expect(screen.getByRole('heading', { name: `Shape ${saved.persona.name}’s cloud` })).toBeVisible();
  });

  it('preserves an invalid edit and its error, then advances after a successful retry', async () => {
    const current = agent();
    const saved = agent({ persona: { ...current.persona, name: 'Neda' } });
    state.agent.mockResolvedValue({ agent: current });
    state.updatePersona.mockRejectedValueOnce(new ApiError(400, 'Name must be 40 characters or fewer.')).mockResolvedValueOnce({ agent: saved });
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: 'NameNova Edit' }));
    fireEvent.change(screen.getByDisplayValue('Nova'), { target: { value: 'N'.repeat(41) } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });

    expect(screen.getByRole('alert')).toHaveTextContent('Name must be 40 characters or fewer.');
    expect(screen.getByDisplayValue('N'.repeat(41))).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save & next' })).toBeEnabled();
    fireEvent.change(screen.getByDisplayValue('N'.repeat(41)), { target: { value: 'Neda' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });
    expect(screen.getByRole('heading', { name: 'Shape Neda’s cloud' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not advance or submit a blank edited name', async () => {
    const current = agent();
    state.agent.mockResolvedValue({ agent: current });
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: 'NameNova Edit' }));
    const input = screen.getByDisplayValue('Nova');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save & next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save & next' }));
    expect(state.updatePersona).not.toHaveBeenCalled();
    expect(input).toHaveValue('   ');
  });
});

describe('Telegram profile completion', () => {
  it.each([undefined, { status: 'pending' as const, failed: [] }])('keeps checking an active bot with profile state %j until it is synced', async profileSync => {
    const waiting = agent({ status: 'awaiting_bot' });
    const active = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync,
      look: { ...waiting.look, avatar: 'fixture-avatar.jpg' } });
    const ready = { ...active, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValueOnce({ agent: active }).mockResolvedValueOnce({ agent: ready });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    expect(screen.getByText(/the name is filled in where supported/i)).toHaveTextContent('Vox then applies the chosen name and photo');

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('status')).toHaveTextContent('Finishing Telegram profile…');
    expect(screen.queryByRole('heading', { name: 'Nova is hired' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Nova' })).toHaveAttribute('src', expect.stringContaining('fixture-avatar.jpg'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(3);
  });

  it('shows profile failures without blocking the bot and keeps failed retries available', async () => {
    const waiting = agent({ status: 'awaiting_bot' });
    const failed = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'error', failed: ['photo'] } });
    const ready = { ...failed, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValue({ agent: failed });
    state.syncProfile.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ agent: ready, failed: [] });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Bot created. Telegram profile still needs photo.');
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Failed to fetch'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry Telegram profile' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(state.syncProfile).toHaveBeenCalledWith(failed.id);
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the failure but no repair control to a viewer without edit or management access', async () => {
    const waiting = agent({ status: 'awaiting_bot' });
    const failed = agent({ status: 'active', canEdit: false, canManageAccess: false, profileSync: { status: 'error', failed: ['name'] } });
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValue({ agent: failed });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Telegram profile still needs name.');
    expect(screen.queryByRole('button', { name: 'Retry Telegram profile' })).not.toBeInTheDocument();
    expect(state.syncProfile).not.toHaveBeenCalled();
  });

  it('offers repair on an older agent page and only removes the warning after confirmed sync', async () => {
    const failed = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'error', failed: ['photo'] } });
    const ready = { ...failed, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValue({ agent: failed });
    let finish!: (value: { agent: AgentView; failed: string[] }) => void;
    state.syncProfile.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<AgentScreen id={failed.id} />); });
    expect(screen.getByRole('alert')).toHaveTextContent('Telegram profile still needs photo.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(state.nav.toast).not.toHaveBeenCalled();
    await act(async () => { finish({ agent: ready, failed: [] }); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Telegram profile' })).not.toBeInTheDocument();
    expect(state.nav.toast).toHaveBeenCalledWith('Telegram profile updated');
  });

  it('clears an older agent’s pending profile after background repair without repeating polling requests', async () => {
    const pending = agent({ status: 'active', profileSync: { status: 'pending', failed: [] } });
    const ready = { ...pending, profileSync: { status: 'synced' as const, failed: [] } };
    let finish!: (value: { agent: AgentView }) => void;
    state.agent.mockResolvedValueOnce({ agent: pending }).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<AgentScreen id={pending.id} />); });
    expect(screen.getByRole('status')).toHaveTextContent('Finishing Telegram profile…');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ agent: ready }); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    expect(state.nav.toast).not.toHaveBeenCalled();
  });
});
