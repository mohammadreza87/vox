import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, GroupItem } from '../../_lib/client';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { AddToGroupsScreen } from './AddToGroups';

const state = vi.hoisted(() => ({
  agent: vi.fn(), groups: vi.fn(), groupLink: vi.fn(), channels: vi.fn(), open: vi.fn(),
  events: new Map<string, () => void>(),
  nav: {
    locale: 'en' as 'en' | 'fa',
    me: { org: 'HOOR', member: { telegramId: 1, name: 'Reza', role: 'owner' } },
    push: vi.fn(), back: vi.fn(), toast: vi.fn(), snack: vi.fn(), cache: new Map<string, AgentView>(),
  },
}));

vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return {
    ...actual,
    api: { ...actual.api, agent: state.agent, groups: state.groups, groupLink: state.groupLink, channels: state.channels },
    openTelegram: state.open,
    tg: () => ({ onEvent: (e: string, cb: () => void) => state.events.set(e, cb), offEvent: (e: string) => state.events.delete(e) }),
  };
});
vi.mock('../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Cloud')>();
  const Face = ({ label, expr }: { label?: string; expr?: string }) => <span role="img" aria-label={label} data-expr={expr} />;
  return { ...actual, Cloud: Face, AgentFace: Face };
});
vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
}));

const look = { hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: false, brows: false } } as const;
const aria = { id: 'aria', status: 'active', stage: 3, persona: { name: 'Aria' }, look, bot: { username: 'aria_bot' } } as unknown as AgentView;
const me = { id: 'aria', name: 'Aria', look };
const group = (chatId: number, title: string, agents: GroupItem['agents'] = [], hasGuests = false): GroupItem => ({ chatId, title, hasGuests, memberCount: 4, agents });

beforeEach(() => {
  vi.clearAllMocks(); state.events.clear(); state.nav.cache.clear(); state.nav.locale = 'en';
  state.agent.mockResolvedValue({ agent: aria });
  state.groupLink.mockResolvedValue({ link: 'https://t.me/aria_bot?startgroup=hoor' });
  // Circles off: the channels route answers 404 and nothing about channels shows.
  state.channels.mockRejectedValue(new Error('Not found'));
});
afterEach(cleanup);

async function renderScreen() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<AddToGroupsScreen id="aria" />); });
  return view;
}

describe('Add to groups', () => {
  it('speaks Persian on a Persian session: head, rows, guest warning and the dock note', async () => {
    state.nav.locale = 'fa';
    state.groups.mockResolvedValue({ groups: [group(1, 'GameEnd Team', [me]), group(2, 'Design Sync'), group(3, 'Ludaxis × Partners', [], true)] });
    const { container } = await renderScreen();
    expect(screen.getByRole('heading', { name: 'افزودن به گروه‌ها' })).toBeVisible();
    expect(screen.getByText('اضافه شد')).toHaveClass('vx-pill');
    expect(screen.getByRole('button', { name: 'افزودن Aria به Design Sync' })).toHaveTextContent('افزودن');
    expect(screen.getByText(/افرادی بیرون از HOOR/)).toBeInTheDocument();
    expect(screen.getByText('تلگرام برای هر گروه یک بار تأیید می‌خواهد.')).toBeVisible();
    expect(container.textContent).not.toMatch(/Add to groups|Added|Telegram|members?\b|guests/);
  });

  it('lists groups with Added / Add, warns about guests, and keeps zero volts until something is added', async () => {
    state.groups.mockResolvedValue({ groups: [group(1, 'GameEnd Team', [me]), group(2, 'Design Sync'), group(3, 'Ludaxis × Partners', [], true)] });
    const { container } = await renderScreen();
    expect(screen.getByRole('heading', { name: 'Add to groups' })).toBeVisible();
    expect(screen.getByText('Added')).toHaveClass('vx-pill');
    expect(screen.getByRole('button', { name: 'Add Aria to Design Sync' })).toHaveClass('vx-btn-xs');
    expect(screen.getByText(/there are people outside HOOR/)).toBeInTheDocument();
    expect(screen.getByText('Telegram asks you to confirm each group once.')).toBeVisible();
    expect(container.querySelectorAll('.vx-btn-primary')).toHaveLength(0);
    expectOneVolt(container);
    expectNoRawControls(container);
  });

  it('opens Telegram’s picker for an Add, and on return pops the check and hops the cloud', async () => {
    state.groups.mockResolvedValueOnce({ groups: [group(2, 'Design Sync')] })
      .mockResolvedValueOnce({ groups: [group(2, 'Design Sync', [me])] });
    await renderScreen();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add Aria to Design Sync' })); });
    expect(state.open).toHaveBeenCalledWith('https://t.me/aria_bot?startgroup=hoor');
    expect(screen.getByText('In Telegram…')).toBeInTheDocument();

    await act(async () => { state.events.get('activated')?.(); });
    expect(state.groups).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Aria' })).toHaveAttribute('data-expr', 'happy');
    expect(screen.getByRole('button', { name: 'Done · added to 1 group' })).toHaveClass('vx-btn-primary');
    expect(state.nav.snack).not.toHaveBeenCalled();
  });

  it('says so when Telegram came back without a new group', async () => {
    state.groups.mockResolvedValue({ groups: [group(2, 'Design Sync')] });
    await renderScreen();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Another group/ })); });
    expect(screen.getByText('Waiting for Telegram…')).toBeInTheDocument();
    await act(async () => { state.events.get('activated')?.(); });
    expect(state.nav.snack).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/^Not added yet/) }));
    expect(screen.getByRole('button', { name: 'Add Aria to Design Sync' })).toBeEnabled();
  });

  it('with no known groups offers Telegram’s picker as the one action', async () => {
    state.groups.mockResolvedValue({ groups: [] });
    await renderScreen();
    expect(screen.getByRole('button', { name: /^Choose a group in Telegram/ })).toBeVisible();
  });

  it('explains that an agent not yet in Telegram can’t be added', async () => {
    state.agent.mockResolvedValue({ agent: { ...aria, status: 'draft', bot: undefined } });
    state.groups.mockResolvedValue({ groups: [] });
    await renderScreen();
    expect(screen.getByText('Aria isn’t in Telegram yet')).toBeVisible();
    expect(screen.queryByText('Telegram asks you to confirm each group once.')).toBeNull();
  });

  it('Circles S5: Add to a channel sits next to Add to group for managers, and Post to channels opens the channel screen', async () => {
    state.groups.mockResolvedValue({ groups: [group(2, 'Design Sync')] });
    state.channels.mockResolvedValue({ channels: [{ chatId: -100, title: 'Aria News', comments: 'none' }], public: true, link: 'https://t.me/aria_bot?startchannel&admin=post_messages+edit_messages' });
    const { container } = await renderScreen();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Add to a channel…/ })); });
    expect(state.open).toHaveBeenCalledWith('https://t.me/aria_bot?startchannel&admin=post_messages+edit_messages');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Post to channels/ })); });
    expect(state.nav.push).toHaveBeenCalledWith({ name: 'channels', id: 'aria' });
    expectNoRawControls(container);
  });

  it('Circles S5: without the manager link (or with Circles off) no channel row shows', async () => {
    state.groups.mockResolvedValue({ groups: [group(2, 'Design Sync')] });
    state.channels.mockResolvedValue({ channels: [], public: true });
    await renderScreen();
    expect(screen.queryByRole('button', { name: /channel/i })).toBeNull();
    state.channels.mockRejectedValue(new Error('Not found'));
    cleanup();
    await renderScreen();
    expect(screen.queryByRole('button', { name: /channel/i })).toBeNull();
  });
});
