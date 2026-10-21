import { act, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../../_lib/client';
import { LookStep } from './LookStep';

const state = vi.hoisted(() => ({
  agent: vi.fn(), generateAvatars: vi.fn(), chooseAvatar: vi.fn(), setLook: vi.fn(),
  nav: { me: { features: { avatars: true } }, snack: vi.fn(), toast: vi.fn() },
}));

vi.mock('../../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: state.agent, generateAvatars: state.generateAvatars, chooseAvatar: state.chooseAvatar, setLook: state.setLook } };
});

vi.mock('../../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}));

function agent(overrides: Partial<AgentView> = {}, look: Partial<AgentView['look']> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'draft', stage: 4,
    persona: { name: 'Nova', role: 'Designer' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true }, ...look },
    locked: false, formingDay: null, canEdit: true, canEditLook: true, canManageAccess: true,
    ...overrides,
  } as AgentView;
}

function Step({ initial }: { initial: AgentView }) {
  const [a, setA] = useState(initial);
  return <LookStep agent={a} busy={null} run={async (_k, fn) => fn()} onUpdate={setA} onNext={vi.fn()} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [state.agent, state.generateAvatars, state.chooseAvatar, state.setLook, state.nav.snack, state.nav.toast]) fn.mockReset();
  state.nav.me.features.avatars = true;
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('LookStep photo', () => {
  it('draws two portraits for a draft, chooses the newest and lets the user undo', async () => {
    const base = agent();
    state.generateAvatars
      .mockResolvedValueOnce({ agent: agent({}, { avatarVariants: ['av-a.jpg'] }) })
      .mockResolvedValueOnce({ agent: agent({}, { avatarVariants: ['av-b.jpg', 'av-a.jpg'] }) });
    state.chooseAvatar.mockResolvedValueOnce({ agent: agent({}, { avatar: 'av-b.jpg', avatarVariants: ['av-b.jpg', 'av-a.jpg'] }) });
    render(<Step initial={base} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Photo' }));
    expect(screen.getByRole('radio', { name: 'Character · grows with Nova' })).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draw 2 portraits/i })); });
    expect(state.generateAvatars).toHaveBeenCalledTimes(2);
    expect(state.generateAvatars).toHaveBeenCalledWith(base.id, 1, { select: false });
    expect(state.chooseAvatar).toHaveBeenCalledTimes(1);
    expect(state.chooseAvatar).toHaveBeenCalledWith(base.id, 'av-b.jpg');
    expect(screen.getAllByRole('radio', { name: 'Portrait' })[0]).toHaveAttribute('aria-checked', 'true');
    expect(state.nav.snack).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }));
    expect(screen.getByRole('button', { name: 'Next · hire Nova' })).toBeEnabled();
  });

  it('hides Generate when the server has no image generation', () => {
    state.nav.me.features.avatars = false;
    render(<Step initial={agent()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Photo' }));
    expect(screen.queryByRole('button', { name: /portraits/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeEnabled();
  });

  it('keeps an active agent’s Telegram status fresh while the push is pending', async () => {
    const pending = agent({ status: 'active', bot: { username: 'nova_bot' }, profileSync: { status: 'pending', failed: [] } }, { avatar: 'av-1.jpg', avatarVariants: ['av-1.jpg'] });
    state.agent.mockResolvedValueOnce({ agent: { ...pending, profileSync: { status: 'synced', failed: [] } } });
    render(<Step initial={pending} />);
    expect(screen.getByText('Updating Telegram…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Updated in Telegram')).toBeInTheDocument();
    expect(screen.getByText('Telegram may take a minute to refresh the photo in open chats.')).toBeInTheDocument();
  });
});

describe('LookStep character', () => {
  it('opens on the character; a change saves without a Telegram push, and leaving the step sends what is waiting', async () => {
    state.setLook.mockImplementation(async (_id: string, look: AgentView['look']) => ({ agent: agent({}, look) }));
    const { unmount } = render(<Step initial={agent()} />);
    expect(screen.getByRole('tab', { name: 'Character' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Shape Nova’s character' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Species' })).getByRole('radio', { name: 'Bunny' }));
    expect(state.setLook).not.toHaveBeenCalled();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.setLook).toHaveBeenCalledWith('fixture-agent', expect.objectContaining({ species: 'bunny' }), { sync: false });
  });

  it('the CTA names where it goes: hire for a draft, Done in a live refine', () => {
    const { unmount } = render(<Step initial={agent()} />);
    expect(screen.getByRole('button', { name: 'Next · hire Nova' })).toHaveAttribute('type', 'button');
    unmount();
    render(<Step initial={agent({ status: 'active', bot: { username: 'nova_bot' }, profileSync: { status: 'synced', failed: [] } })} />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('the Telegram photo row opens the photo tab', () => {
    render(<Step initial={agent()} />);
    fireEvent.click(screen.getByRole('button', { name: /Telegram photo.*Character · grows with Nova/ }));
    expect(screen.getByRole('tab', { name: 'Photo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'Character · grows with Nova' })).toBeVisible();
  });
});
