import { act } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { HomeScreen } from './Home';

const state = vi.hoisted(() => ({
  agents: vi.fn(),
  nav: {
    locale: 'en' as 'en' | 'fa',
    me: { org: 'Fixture team', member: { telegramId: 7, name: 'reza', role: 'owner' }, features: {} },
    push: vi.fn(), reset: vi.fn(), back: vi.fn(), toast: vi.fn(), cache: new Map(),
  },
}));

vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agents: state.agents } };
});
// The character renderer is another stream's work; these tests are about layout and behaviour.
vi.mock('../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Cloud')>();
  type FaceProps = { label?: string; heroId?: string; stage?: number; moment?: { kind: string } | null; onMomentEnd?: () => void };
  const Face = ({ label, heroId, stage, moment, onMomentEnd }: FaceProps) => (
    <span role="img" aria-label={label} data-hero={heroId ? `face-${heroId}` : undefined} data-stage={stage} data-moment={moment?.kind} onClick={onMomentEnd} />
  );
  // Photo avatars still render through the real AgentFace (an <img>, no renderer involved).
  const PhotoOrFace = (p: Parameters<typeof actual.AgentFace>[0]) => ((p.look as { avatar?: string }).avatar ? actual.AgentFace(p) : <Face {...p} />);
  return { ...actual, Cloud: Face, AgentFace: PhotoOrFace };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
}));

function agent(id: string, over: Partial<AgentView> = {}): AgentView {
  return {
    id, status: 'active', stage: 2,
    persona: { name: `Agent ${id}`, role: 'Designer', tagline: '', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '', languages: ['English'], culture: '', presentation: 'neutral', age: '', accent: '', voiceBrief: '', avatarHint: '' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: false } },
    locked: false, formingDay: 3, isAdmin: false, visibility: 'org', access: 'org', createdBy: 7, canEdit: true, canFire: true, canManageAccess: true,
    ...over,
  } as AgentView;
}

beforeEach(() => { vi.clearAllMocks(); state.nav.cache.clear(); state.nav.locale = 'en'; try { window.localStorage.clear(); } catch { /* none */ } });
afterEach(cleanup);

async function renderHome() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<HomeScreen />); });
  return view;
}

describe('Home', () => {
  it('shows the error template with Try again instead of an endless skeleton', async () => {
    state.agents.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce({ agents: [agent('a')] });
    await renderHome();
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t load your agents');
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    expect(screen.queryByRole('status', { name: 'Loading agents' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByRole('button', { name: 'Agent a, Designer' })).toBeVisible();
  });

  it('has Search and a profile initial that opens You; the FAB is the only volt', async () => {
    state.agents.mockResolvedValue({ agents: [agent('a')] });
    const { container } = await renderHome();
    expect(screen.getByRole('button', { name: 'Search agents' })).toBeVisible();
    const you = screen.getByRole('button', { name: 'Open your profile' });
    expect(you).toHaveTextContent('R');
    fireEvent.click(you);
    expect(state.nav.reset).toHaveBeenCalledWith({ name: 'privacy' });
    expect(container.querySelector('.vx-fab')).toHaveTextContent('Spawn');
    expectOneVolt(container);
    expectNoRawControls(container);
  });

  it('counts each filter and hides empty ones', async () => {
    state.agents.mockResolvedValue({ agents: [
      agent('a'), agent('b', { locked: true, formingDay: null }), agent('c', { status: 'draft' }), agent('d', { createdBy: 99 }),
    ] });
    await renderHome();
    const filters = within(screen.getByRole('group', { name: 'Filter agents' }));
    expect(filters.getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(filters.getByRole('button', { name: 'Mine 3' })).toBeVisible();
    expect(filters.getByRole('button', { name: 'Forming 2' })).toBeVisible();
    expect(filters.getByRole('button', { name: 'Drafts 1' })).toBeVisible();
    expect(filters.queryByRole('button', { name: /Retired/ })).toBeNull();
    await act(async () => { fireEvent.click(filters.getByRole('button', { name: 'Drafts 1' })); });
    expect(screen.getByRole('button', { name: 'Agent c, Designer' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Agent a, Designer' })).toBeNull();
  });

  it('writes statuses in sentence case and keeps only LOCKED as a seal', async () => {
    state.agents.mockResolvedValue({ agents: [
      agent('a', { status: 'draft' }), agent('b', { status: 'awaiting_bot' }), agent('c', { locked: true }),
    ] });
    await renderHome();
    expect(screen.getByText('Draft')).toHaveClass('vx-pill', 'warn');
    expect(screen.getByText('Waiting for Telegram')).toHaveClass('vx-pill', 'warn');
    expect(screen.getByText('LOCKED')).toHaveClass('vx-pill', 'lock');
    expect(screen.queryByText('AWAITING BOT')).toBeNull();
  });

  it('searches by name or role', async () => {
    state.agents.mockResolvedValue({ agents: [agent('a'), agent('b', { persona: { ...agent('b').persona, role: 'Lawyer' } })] });
    await renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Search agents' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), { target: { value: 'law' } });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Agent b, Lawyer' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Agent a, Designer' })).toBeNull();
  });

  it('opens drafts in Spawn and agents on their page, seeding the agent cache', async () => {
    state.agents.mockResolvedValue({ agents: [agent('a'), agent('c', { status: 'draft' })] });
    await renderHome();
    expect(state.nav.cache.get('a')?.id).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: 'Agent a, Designer' }));
    expect(state.nav.push).toHaveBeenLastCalledWith({ name: 'agent', id: 'a' });
    fireEvent.click(screen.getByRole('button', { name: 'Agent c, Designer' }));
    expect(state.nav.push).toHaveBeenLastCalledWith({ name: 'spawn', draftId: 'c' });
  });

  it('a return to Home renders the last cards from the cache at once, so a hero-pop has a face to land on', async () => {
    state.agents.mockResolvedValue({ agents: [agent('a'), agent('b')] });
    const first = await renderHome();
    first.unmount(); // pushed the profile; back remounts Home
    state.nav.cache.set('a', agent('a', { persona: { ...agent('a').persona, name: 'Renamed' } }));
    state.agents.mockReturnValue(new Promise(() => {}));
    render(<HomeScreen />);
    expect(screen.queryByRole('status', { name: 'Loading agents' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Renamed' })).toHaveAttribute('data-hero', 'face-a'); // the cache's latest copy
    expect(screen.getByRole('img', { name: 'Agent b' })).toHaveAttribute('data-hero', 'face-b');
    expect(state.agents).toHaveBeenCalledTimes(2); // and still refreshes
  });

  it('gives each card face a hero id so opening the profile can fly it', async () => {
    state.agents.mockResolvedValue({ agents: [agent('a')] });
    await renderHome();
    expect(screen.getByRole('img', { name: 'Agent a' })).toHaveAttribute('data-hero', 'face-a');
  });

  it('the freshly spawned agent’s first card poofs in once per device', async () => {
    window.localStorage.setItem('vx:fresh-agent', 'b');
    state.agents.mockResolvedValue({ agents: [agent('a'), agent('b', { status: 'draft' })] });
    const { unmount } = await renderHome();
    const fresh = screen.getByRole('img', { name: 'Agent b' });
    expect(fresh).toHaveAttribute('data-moment', 'poof');
    expect(screen.getByRole('img', { name: 'Agent a' })).not.toHaveAttribute('data-moment');
    expect(window.localStorage.getItem('vx:fresh-agent')).toBeNull();
    fireEvent.click(fresh);   // the stand-in reports the moment's end
    expect(screen.getByRole('img', { name: 'Agent b' })).not.toHaveAttribute('data-moment');
    unmount();
    await renderHome();
    expect(screen.getByRole('img', { name: 'Agent b' })).not.toHaveAttribute('data-moment');
  });

  it('marks an agent that grew since this device last saw it with a volt dot', async () => {
    window.localStorage.setItem('vx:stage-seen:a', '1');
    state.agents.mockResolvedValue({ agents: [agent('a', { stage: 2 }), agent('b', { stage: 2 })] });
    await renderHome();
    expect(screen.getByRole('img', { name: 'Agent a grew' })).toHaveClass('vx-agent-card-dot');
    expect(screen.queryByRole('img', { name: 'Agent b grew' })).toBeNull();
    // the card (and the face that flies to the profile) keeps the seen stage: the profile reveals the growth
    expect(screen.getByRole('img', { name: 'Agent a' })).toHaveAttribute('data-stage', '1');
    expect(screen.getByRole('img', { name: 'Agent b' })).toHaveAttribute('data-stage', '2');
  });

  it('staggers the cards in on the first load only; a return from the cache renders them at rest', async () => {
    // real (not skipped) animations, so a card's first painted frame shows whether its entrance runs
    MotionGlobalConfig.skipAnimations = false;
    try {
      state.agents.mockResolvedValue({ agents: [agent('a'), agent('b'), agent('c')] });
      const first = await renderHome();
      // the grid's presence mounts with its first cards, so their `initial` must not be blocked
      expect(Number(screen.getByRole('button', { name: 'Agent c, Designer' }).style.opacity)).toBeLessThan(1);
      first.unmount();
      state.agents.mockReturnValue(new Promise(() => {}));
      render(<HomeScreen />);
      expect(screen.getByRole('button', { name: 'Agent c, Designer' }).style.opacity).toBe('1');
    } finally { MotionGlobalConfig.skipAnimations = true; }
  });

  it('speaks Persian on a Persian session: head, chips, FAB, pills and empty states', async () => {
    state.nav.locale = 'fa';
    state.agents.mockResolvedValue({ agents: [agent('a'), agent('b', { status: 'draft' }), agent('c', { locked: true })] });
    const { container } = await renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('عامل‌های شما');
    expect(container.querySelector('.vx-pagehead .vx-over')).toHaveTextContent('Fixture team · ۲ عامل · ۱ در حال شکل‌گیری');
    const filters = within(screen.getByRole('group', { name: 'فیلتر عامل‌ها' }));
    expect(filters.getByRole('button', { name: /^همه/ })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.vx-fab')).toHaveTextContent('ساختن');
    expect(screen.getByText('پیش‌نویس')).toHaveClass('vx-pill', 'warn');
    expect(screen.getByText('قفل')).toHaveClass('vx-pill', 'lock');
    expect(screen.getByText('در حال شکل‌گیری · روز ۳ از ۷')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'جستجوی عامل‌ها' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'باز کردن نمایهٔ شما' }));
    expect(state.nav.reset).toHaveBeenCalledWith({ name: 'privacy' });
    // no English left in the board copy
    expect(container.textContent).not.toMatch(/Your agents|Spawn|Forming|Draft|LOCKED|agents?\b/);
  });

  it('shows the Persian empty state', async () => {
    state.nav.locale = 'fa';
    state.agents.mockResolvedValue({ agents: [] });
    await renderHome();
    expect(screen.getByText('هنوز عاملی ندارید')).toBeInTheDocument();
  });

  it('folds the Spawn FAB to its icon while scrolling down and unfolds on the way up', async () => {
    state.agents.mockResolvedValue({ agents: [agent('a')] });
    const { container } = await renderHome();
    const scroller = container.querySelector<HTMLElement>('.vx-scroll')!;
    const fab = container.querySelector('.vx-fab')!;
    scroller.scrollTop = 200; fireEvent.scroll(scroller);
    expect(fab).toHaveClass('folded');
    expect(screen.getByRole('button', { name: 'Spawn' })).toBe(fab);
    scroller.scrollTop = 120; fireEvent.scroll(scroller);
    expect(fab).not.toHaveClass('folded');
  });

  it('long-press on a card opens its quick actions instead of the profile', async () => {
    vi.useFakeTimers();
    try {
      state.agents.mockResolvedValue({ agents: [agent('a', { bot: { username: 'a_bot' } })] });
      await renderHome();
      const card = screen.getByRole('button', { name: 'Agent a, Designer' });
      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
      await act(async () => { vi.advanceTimersByTime(500); });
      fireEvent.pointerUp(card);
      fireEvent.click(card);
      expect(state.nav.push).not.toHaveBeenCalled();
      const menu = within(screen.getByRole('dialog', { name: 'Agent a quick actions' }));
      fireEvent.click(menu.getByRole('button', { name: /^Add to groups/ }));
      expect(state.nav.push).toHaveBeenCalledWith({ name: 'add-groups', id: 'a' });
      // A plain tap still opens the profile
      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(card);
      fireEvent.click(card);
      expect(state.nav.push).toHaveBeenLastCalledWith({ name: 'agent', id: 'a' });
    } finally { vi.useRealTimers(); }
  });
});
