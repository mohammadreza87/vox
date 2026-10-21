import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMediaQueries } from '@/test/browser';
import { StudioApp, useNav } from '../StudioApp';

const mocks = vi.hoisted(() => ({
  me: vi.fn(), backs: new Set<() => void>(), settings: new Set<() => void>(), language: 'en' as string,
  settingsShow: vi.fn(), settingsHide: vi.fn(), undo: vi.fn(),
}));
vi.mock('../../_lib/client', () => ({
  api: { me: mocks.me }, ApiError: class extends Error {}, initTelegram: vi.fn(),
  haptic: { tap: vi.fn(), select: vi.fn(), error: vi.fn(), light: vi.fn() },
  tg: () => ({
    initDataUnsafe: { user: { language_code: mocks.language } },
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: (fn: () => void) => mocks.backs.add(fn), offClick: (fn: () => void) => mocks.backs.delete(fn) },
    SettingsButton: { show: mocks.settingsShow, hide: mocks.settingsHide, onClick: (fn: () => void) => mocks.settings.add(fn), offClick: (fn: () => void) => mocks.settings.delete(fn) },
  }),
}));
vi.mock('../Cloud', () => ({ Cloud: () => null }));
vi.mock('../UserInfo', () => ({ UserInfo: () => null }));
vi.mock('../screens/Home', () => ({ HomeScreen: function Home() {
  const nav = useNav();
  return (
    <div className="vx-scroll" data-testid="home-scroll">
      <h1>Home probe</h1>
      <button onClick={() => nav.push({ name: 'agent', id: 'a' })}>Open agent</button>
      <span data-hero="face-h" />
      <button onClick={() => { nav.cache.set('h', { id: 'h' } as never); nav.push({ name: 'agent', id: 'h' }); }}>Fly agent</button>
      <button onClick={() => { nav.push({ name: 'agent', id: 'a' }); nav.push({ name: 'agent', id: 'b' }); }}>Double open</button>
      <button onClick={() => nav.snack({ message: 'Portrait removed', action: { label: 'Undo', run: mocks.undo } })}>Snack action</button>
      <button onClick={() => nav.toast('Could not load', 'error')}>Snack error</button>
      <button onClick={() => nav.snack({ message: 'Saved', tone: 'success', ms: 40 })}>Snack quick</button>
      <button onClick={() => nav.setLocale(nav.locale === 'fa' ? 'en' : 'fa')}>Toggle language</button>
    </div>
  );
} }));
vi.mock('../screens/Agent', () => ({ AgentScreen: function Agent({ id }: { id: string }) {
  const nav = useNav();
  return <><h1>Agent {id}</h1><button onClick={nav.back}>Agent back</button><button onClick={() => nav.push({ name: 'fire', id })}>Fire</button></>;
} }));
vi.mock('../screens/Fire', () => ({ FireScreen: () => <h1>Fire probe</h1> }));
vi.mock('../screens/Privacy', () => ({ PrivacyScreen: () => <h1>You probe</h1> }));
vi.mock('../screens/Groups', () => ({ GroupsScreen: () => <h1>Groups probe</h1> }));

// jsdom has no layout: back scrollTop with a store so restoration can be observed.
const scrollTops = new WeakMap<Element, number>();
beforeEach(() => {
  vi.clearAllMocks(); mocks.backs.clear(); mocks.settings.clear(); mocks.language = 'en';
  mocks.me.mockResolvedValue({ member: { role: 'member', telegramId: 1 }, org: 'Synthetic' });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true,
    get(this: Element) { return scrollTops.get(this) ?? 0; }, set(this: Element, v: number) { scrollTops.set(this, v); } });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
afterEach(cleanup);

// document.querySelector is stubbed by the global test setup; query from body.
const shell = () => document.body.querySelector('.vx') as HTMLElement;
const settled = () => waitFor(() => expect(document.body.querySelector('.vx-stage[data-busy]')).toBeNull());
const tabBar = () => screen.queryByRole('navigation', { name: 'Main' });

describe('StudioApp navigation shell', () => {
  it('overlays the tab bar on tab roots only, and keeps pushes and pops in order', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open agent' }));
    await screen.findByRole('heading', { name: 'Agent a' });
    await waitFor(() => expect(tabBar()).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Agent back' }));
    await screen.findByRole('heading', { name: 'Home probe' });
    expect(tabBar()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-current', 'page');
  });

  it('drops a second push while the first is still arriving (double tap)', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Double open' }));
    await screen.findByRole('heading', { name: 'Agent a' });
    expect(screen.queryByRole('heading', { name: 'Agent b' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Agent back' }));
    await screen.findByRole('heading', { name: 'Home probe' });
  });

  it('keeps input locked while a hero face flies (its instant enter does not settle the push)', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fly agent' }));
    await screen.findByRole('heading', { name: 'Agent h' });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(document.body.querySelector('.vx-stage[data-busy]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Agent h' }).closest('.vx-screen')).toHaveAttribute('data-arrive', 'hero');
    await settled(); // released by LOCK_MS.hero
    // jsdom runs no CSS animations: the arrival still ends (and focuses the screen) on its nominal clock
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Agent h' }).closest('.vx-screen')).not.toHaveAttribute('data-arrive'), { timeout: 1500 });
  });

  it('defers a back that arrives mid-transition until the screen lands', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open agent' }));
    act(() => { for (const back of mocks.backs) back(); });   // Telegram BackButton during the push
    await screen.findByRole('heading', { name: 'Home probe' });
  });

  it('makes the leaving screen inert and hidden from assistive tech', async () => {
    render(<StudioApp />);
    const home = (await screen.findByRole('heading', { name: 'Home probe' })).closest('.vx-screen')!;
    fireEvent.click(screen.getByRole('button', { name: 'Open agent' }));
    if (home.isConnected) { expect(home).toHaveAttribute('inert'); expect(home).toHaveAttribute('aria-hidden', 'true'); }
    await waitFor(() => expect(home.isConnected).toBe(false));
  });

  it('marks pushed pages and covers for their edge shadows', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open agent' }));
    expect((await screen.findByRole('heading', { name: 'Agent a' })).closest('.vx-screen')).toHaveAttribute('data-layer', 'page');
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));
    expect((await screen.findByRole('heading', { name: 'Fire probe' })).closest('.vx-screen')).toHaveAttribute('data-layer', 'cover');
  });

  it('restores the scroll position when popping back', async () => {
    render(<StudioApp />);
    const scroller = await screen.findByTestId('home-scroll');
    scroller.scrollTop = 420;
    fireEvent.click(screen.getByRole('button', { name: 'Open agent' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Agent back' }));
    await waitFor(() => expect(screen.getByTestId('home-scroll')).not.toBe(scroller));
    await waitFor(() => expect(screen.getByTestId('home-scroll').scrollTop).toBe(420));
  });

  it('scrolls the current tab home when it is selected again', async () => {
    render(<StudioApp />);
    const scroller = await screen.findByTestId('home-scroll');
    scroller.scrollTop = 300;
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(scroller.scrollTop).toBe(0);
  });

  it('opens You from Telegram’s Settings button', async () => {
    render(<StudioApp />);
    await screen.findByRole('heading', { name: 'Home probe' });
    expect(mocks.settingsShow).toHaveBeenCalled();
    act(() => { for (const open of mocks.settings) open(); });
    await screen.findByRole('heading', { name: 'You probe' });
    expect(screen.getByRole('button', { name: 'You' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('StudioApp snackbar', () => {
  it('runs the action once and dismisses', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Snack action' }));
    expect(screen.getByRole('status')).toHaveTextContent('Portrait removed');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(mocks.undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Portrait removed')).toBeNull());
  });

  it('keeps errors until dismissed, as an alert', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Snack error' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('auto-dismisses info after its duration, and a new snack replaces the old', async () => {
    render(<StudioApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Snack action' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snack quick' }));
    await waitFor(() => expect(screen.queryByText('Portrait removed')).toBeNull());
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull(), { timeout: 2000 });
  });
});

describe('StudioApp locale and motion tier', () => {
  it('takes direction and language from Telegram, and persists a change', async () => {
    mocks.language = 'fa';
    render(<StudioApp />);
    await screen.findByRole('heading', { name: 'Home probe' });
    expect(shell()).toHaveAttribute('dir', 'rtl');
    expect(shell()).toHaveAttribute('lang', 'fa');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle language' }));
    expect(shell()).toHaveAttribute('dir', 'ltr');
    expect(window.localStorage.getItem('vx:locale')).toBe('en');
  });

  it('marks the reduced tier when the OS asks for less motion', async () => {
    setMediaQueries({ '(prefers-reduced-motion: reduce)': true });
    render(<StudioApp />);
    await screen.findByRole('heading', { name: 'Home probe' });
    expect(shell()).toHaveAttribute('data-motion', 'reduced');
    setMediaQueries({});
  });
});
