import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioApp, useNav } from './StudioApp';

const mocks = vi.hoisted(() => ({ me: vi.fn(), splash: [] as string[] }));
vi.mock('../_lib/client', () => ({ api: { me: mocks.me }, ApiError: class extends Error {}, haptic: { tap: vi.fn(), select: vi.fn() }, initTelegram: vi.fn(), tg: () => null }));
vi.mock('./Cloud', () => ({ Cloud: (p: { expr?: string }) => { mocks.splash.push(p.expr ?? ''); return null; } }));
vi.mock('./UserInfo', () => ({ UserInfo: () => null }));
vi.mock('./screens/Home', () => ({ HomeScreen: function Home() {
  const nav = useNav();
  return <><h1>Home probe</h1><p data-testid="prefs">{`${nav.locale}:${nav.space}`}</p>
    <button onClick={() => nav.setLocale(nav.locale === 'fa' ? 'en' : 'fa')}>Flip language</button>
    <button onClick={() => nav.setSpace(nav.space === 'work' ? 'personal' : 'work')}>Flip space</button></>;
} }));

type Values = Record<string, string>;
const win = window as unknown as { Telegram?: unknown };
function telegram(values: Values | null, o: { cloud?: boolean } = {}) {
  let answer: ((v: Values) => void) | null = null;
  const getItems = vi.fn((_keys: string[], cb: (e: string | null, v: Values) => void) => { if (values) cb(null, values); else answer = (v) => cb(null, v); });
  const setItem = vi.fn((_k: string, _v: string, cb?: () => void) => cb?.());
  win.Telegram = { WebApp: { initData: 'signed', isVersionAtLeast: () => true, ...(o.cloud === false ? {} : { CloudStorage: { getItems, setItem } }) } };
  return { getItems, setItem, answer: (v: Values) => answer?.(v) };
}
const me = (settingsV2?: boolean) => ({ member: { role: 'member', telegramId: 1 }, org: 'Synthetic', ...(settingsV2 === undefined ? {} : { features: { settingsV2 } }) });

beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); window.localStorage.setItem('vx:locale', 'en'); window.localStorage.setItem('vx:space', 'work'); });
afterEach(() => { cleanup(); delete win.Telegram; });

it('Settings v2: the travelling language and space win before the app shows (no flicker), and refresh the local cache', async () => {
  const cloud = telegram(null);
  mocks.me.mockResolvedValue(me(true));
  render(<StudioApp />);
  await act(async () => {});
  // me is in, CloudStorage hasn't answered: still the splash, never the app in the old language.
  expect(screen.queryByRole('heading', { name: 'Home probe' })).toBeNull();
  await act(async () => { cloud.answer({ vx_locale: 'fa', vx_space: 'personal' }); });
  expect(await screen.findByTestId('prefs')).toHaveTextContent('fa:personal');
  expect(window.localStorage.getItem('vx:locale')).toBe('fa');
  expect(window.localStorage.getItem('vx:space')).toBe('personal');
});

it('Settings v2: changes go to both stores', async () => {
  const cloud = telegram({});
  mocks.me.mockResolvedValue(me(true));
  render(<StudioApp />);
  expect(await screen.findByTestId('prefs')).toHaveTextContent('en:work');
  fireEvent.click(screen.getByRole('button', { name: 'Flip language' }));
  fireEvent.click(screen.getByRole('button', { name: 'Flip space' }));
  expect(cloud.setItem).toHaveBeenCalledWith('vx_locale', 'fa', expect.any(Function));
  expect(cloud.setItem).toHaveBeenCalledWith('vx_space', 'personal', expect.any(Function));
  expect(window.localStorage.getItem('vx:locale')).toBe('fa');
});

it('Settings v2 without CloudStorage (web, old clients): localStorage alone, nothing throws', async () => {
  telegram(null, { cloud: false });
  window.localStorage.setItem('vx:space', 'personal');
  mocks.me.mockResolvedValue(me(true));
  render(<StudioApp />);
  expect(await screen.findByTestId('prefs')).toHaveTextContent('en:personal');
  fireEvent.click(screen.getByRole('button', { name: 'Flip language' }));
  expect(screen.getByTestId('prefs')).toHaveTextContent('fa:personal');
});

it('flag off (or an older me): CloudStorage is never read or written', async () => {
  for (const flag of [false, undefined]) {
    const cloud = telegram({ vx_locale: 'fa', vx_space: 'personal' });
    mocks.me.mockResolvedValue(me(flag));
    render(<StudioApp />);
    expect(await screen.findByTestId('prefs')).toHaveTextContent('en:work');
    fireEvent.click(screen.getByRole('button', { name: 'Flip language' }));
    expect(cloud.getItems).not.toHaveBeenCalled();
    expect(cloud.setItem).not.toHaveBeenCalled();
    cleanup(); window.localStorage.setItem('vx:locale', 'en');
  }
});

it('Settings v2: a choice made only on this device is copied up when the travelling copy has none', async () => {
  window.localStorage.setItem('vx:locale', 'fa');
  const cloud = telegram({});
  mocks.me.mockResolvedValue(me(true));
  render(<StudioApp />);
  expect(await screen.findByTestId('prefs')).toHaveTextContent('fa:work');
  expect(cloud.setItem).toHaveBeenCalledWith('vx_locale', 'fa', expect.any(Function));
  expect(cloud.setItem).toHaveBeenCalledWith('vx_space', 'work', expect.any(Function));
});

it('flag off: the app shows in the same render that me arrives (no extra splash frame, as before Settings v2)', async () => {
  for (const flag of [false, undefined]) {
    let resolve!: (v: unknown) => void;
    mocks.me.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<StudioApp />);
    await act(async () => {});
    mocks.splash.length = 0;
    await act(async () => { resolve(me(flag)); });
    expect(screen.getByRole('heading', { name: 'Home probe' })).toBeInTheDocument();
    // The loading splash (the thinking cloud) never rendered again once me was in.
    expect(mocks.splash).not.toContain('thinking');
    cleanup();
  }
});
