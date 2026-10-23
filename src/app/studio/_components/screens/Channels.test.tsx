import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, ChannelsView } from '../../_lib/client';
import { expectNoRawControls } from '../ui.testing';
import { ChannelsScreen } from './Channels';

const state = vi.hoisted(() => ({
  agent: vi.fn(), channels: vi.fn(), channelDraft: vi.fn(), channelPost: vi.fn(), channelCancel: vi.fn(), open: vi.fn(),
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
    api: { ...actual.api, agent: state.agent, channels: state.channels, channelDraft: state.channelDraft, channelPost: state.channelPost, channelCancel: state.channelCancel },
    openTelegram: state.open,
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
const info: ChannelsView = {
  channels: [{ chatId: -100, title: 'Aria News', comments: 'offer', posting: 'ok' }], public: true, full: false,
  link: 'https://t.me/aria_bot?startchannel&admin=post_messages+edit_messages', groupLink: 'https://t.me/aria_bot?startgroup=hoor',
};

beforeEach(() => {
  vi.clearAllMocks(); state.nav.cache.clear(); state.nav.locale = 'en';
  state.agent.mockResolvedValue({ agent: aria });
  state.channels.mockResolvedValue(info);
  state.channelDraft.mockResolvedValue({ draft: { id: 'abcdefghijkl', text: 'Aria can dance now', silent: false, channels: [{ chatId: -100, title: 'Aria News' }] } });
  state.channelPost.mockResolvedValue({ posted: true, title: 'Aria News' });
  state.channelCancel.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

async function renderScreen() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<ChannelsScreen id="aria" />); });
  return view;
}

describe('Agent > Channels (Circles S5)', () => {
  it('lists channels, offers the comments group and Add to a channel', async () => {
    const { container } = await renderScreen();
    expect(screen.getByRole('heading', { name: 'Channels' })).toBeVisible();
    expect(screen.getByText('Aria News')).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Add Aria to the comments group too/ })); });
    expect(state.open).toHaveBeenCalledWith(info.groupLink);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Add to a channel…/ })); });
    expect(state.open).toHaveBeenCalledWith(info.link);
    expectNoRawControls(container);
  });

  it('nothing is posted before Post: brief, preview, edit, notify off, then Post', async () => {
    await renderScreen();
    await act(async () => { fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tell them Aria dances' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Write post' })); });
    expect(state.channelDraft).toHaveBeenCalledWith('aria', 'Tell them Aria dances');
    expect(screen.getByText('Aria can dance now')).toBeVisible();
    expect(state.channelPost).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit' })); });
    await act(async () => { fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Aria dances tonight' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: /Notify subscribers/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Post' })); });
    expect(state.channelPost).toHaveBeenCalledWith('aria', { id: 'abcdefghijkl', chatId: -100, text: 'Aria dances tonight', silent: true });
    expect(state.nav.toast).toHaveBeenCalledWith('Posted to Aria News');
  });

  const drafted = async () => {
    await renderScreen();
    await act(async () => { fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tell them' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Write post' })); });
  };
  const failure = (status: number, message: string) => Object.assign(new Error(message), { status });

  it('Telegram refused the post (502): the preview stays and Post works again', async () => {
    await drafted();
    state.channelPost.mockRejectedValueOnce(failure(502, "Telegram didn't take the post."));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Post' })); });
    expect(state.nav.toast).toHaveBeenCalledWith("Telegram didn't take the post.", 'error');
    expect(screen.getByText('Aria can dance now')).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Post' })); });
    expect(state.channelPost).toHaveBeenCalledTimes(2);
    expect(state.nav.toast).toHaveBeenLastCalledWith('Posted to Aria News');
  });

  for (const status of [409, 504]) {
    it(`a preview that can't post any more (${status}): no dead Post button, and the text is kept as the brief`, async () => {
      await drafted();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit' })); });
      await act(async () => { fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My edited words' } }); });
      state.channelPost.mockRejectedValueOnce(failure(status, 'This preview has expired. Write it again.'));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Post' })); });
      expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
      expect(screen.getByRole('textbox')).toHaveValue('My edited words');
      expect(screen.getByRole('button', { name: 'Write post' })).toBeEnabled();
      expect(state.channels).toHaveBeenCalledTimes(2);
    });
  }

  it('a channel without posting rights says so; at the cap, Add to a channel is replaced by why', async () => {
    state.channels.mockResolvedValue({ channels: [{ chatId: -100, title: 'Aria News', comments: 'none', posting: 'needs_rights' }], public: true, full: true });
    await renderScreen();
    expect(screen.getByText('Can’t post yet: in the channel’s admin settings, turn on Post messages for Aria')).toBeVisible();
    expect(screen.getByText('Aria is in 1 channels, the most it can post to. Remove it from one to add another.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Add to a channel…/ })).toBeNull();
  });

  it('Cancel drops the draft without posting', async () => {
    await renderScreen();
    await act(async () => { fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Write post' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(state.channelCancel).toHaveBeenCalledWith('aria', 'abcdefghijkl');
    expect(state.channelPost).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Write post' })).toBeVisible();
  });

  it('a non-public agent shows why it cannot post; Persian copy', async () => {
    state.nav.locale = 'fa';
    state.channels.mockResolvedValue({ channels: [{ chatId: -100, title: 'Aria News', comments: 'none', posting: 'ok' }], public: false, full: false });
    await renderScreen();
    expect(screen.getByText('Aria فقط وقتی عمومی است در کانال‌ها پست می‌گذارد.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'نوشتن پست' })).toBeNull();
  });
});
