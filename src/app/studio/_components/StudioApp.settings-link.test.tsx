import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioApp, useNav } from './StudioApp';

/**
 * Settings v2 Telegram links: `?settings=` (the manager bot's web_app button) and start_param (`startapp`) open the
 * right settings page once me is in; agent codes are resolved by the server; anything else is ignored; navigation
 * made before the answer wins; a notification link wins; flag off: never read.
 */
const mocks = vi.hoisted(() => ({ me: vi.fn(), settingsLink: vi.fn(), agent: vi.fn(), startParam: undefined as string | undefined }));
vi.mock('../_lib/client', () => ({
  api: { me: mocks.me, settingsLink: mocks.settingsLink, agent: mocks.agent }, ApiError: class extends Error {}, haptic: { tap: vi.fn(), select: vi.fn() }, initTelegram: vi.fn(),
  tg: () => (mocks.startParam === undefined ? null : { initDataUnsafe: { start_param: mocks.startParam } }),
}));
vi.mock('./Cloud', () => ({ Cloud: () => null }));
vi.mock('./UserInfo', () => ({ UserInfo: () => null }));
vi.mock('./screens/Home', () => ({ HomeScreen: function Home() {
  const nav = useNav();
  return <><h1>Home probe</h1><button onClick={() => nav.push({ name: 'org' })}>Go to org</button></>;
} }));
vi.mock('./screens/Org', () => ({ OrgScreen: () => <h1>Org probe</h1> }));
vi.mock('./screens/Privacy', () => ({ PrivacyScreen: () => <h1>You probe</h1> }));
vi.mock('./screens/Memories', () => ({ MemoriesScreen: (p: { id: string }) => <h1>{`Memories probe ${p.id}`}</h1> }));
vi.mock('./screens/settings/SettingsRouter', () => ({ SettingsRouter: (p: { page: string; params?: Record<string, string> }) =>
  <h1>{`Settings probe ${p.page} ${JSON.stringify(p.params ?? {})}`}</h1> }));

/** The agent as the app sees it: a manager may see voice and skills; anyone who can open it sees their own sections. */
const agentView = (manages: boolean) => ({ id: 'ag1', status: 'active', persona: { name: 'Nova' }, canManageAccess: manages, canManageSettings: manages });
const me = (settingsV2: boolean, role = 'member') => ({ member: { role, telegramId: 1 }, org: 'Synthetic', features: { settingsV2 } });
const open = (search: string) => window.history.replaceState(null, '', `/studio${search}`);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agent.mockResolvedValue({ agent: agentView(true) });
  mocks.startParam = undefined;
  window.localStorage.clear();
  window.localStorage.setItem('vx:locale', 'en');
  open('');
});
afterEach(() => { cleanup(); });

it('start_param s_<code>_m opens Agents › settings › Memories, resolved by the server', async () => {
  mocks.startParam = 's_AbCd-_12_m';
  mocks.me.mockResolvedValue(me(true));
  mocks.settingsLink.mockResolvedValue({ target: { agentId: 'ag1', section: 'memory' } });
  render(<StudioApp />);
  expect(await screen.findByRole('heading', { name: 'Memories probe ag1' })).toBeInTheDocument();
  expect(mocks.settingsLink).toHaveBeenCalledWith('s_AbCd-_12_m');
});

it('?settings=s_<code>_v from the manager bot opens the Voice page and is stripped from the URL', async () => {
  open('?settings=s_AbCd-_12_v&x=1');
  mocks.me.mockResolvedValue(me(true));
  mocks.settingsLink.mockResolvedValue({ target: { agentId: 'ag1', section: 'voice' } });
  render(<StudioApp />);
  expect(await screen.findByRole('heading', { name: `Settings probe agent ${JSON.stringify({ agentId: 'ag1', section: 'voice' })}` })).toBeInTheDocument();
  expect(window.location.search).toBe('?x=1');
});

it('a section this viewer cannot see (voice, skills for a non-manager), or an agent that does not load, stops at the agent hub once', async () => {
  const hub = `Settings probe agent ${JSON.stringify({ agentId: 'ag1' })}`;
  for (const [section, answer] of [
    ['voice', () => mocks.agent.mockResolvedValueOnce({ agent: agentView(false) })],
    ['skills', () => mocks.agent.mockResolvedValueOnce({ agent: agentView(false) })],
    ['voice', () => mocks.agent.mockRejectedValueOnce(new Error('offline'))],
  ] as const) {
    answer();
    mocks.startParam = `s_AbCd-_12_${section[0] === 'v' ? 'v' : 'k'}`;
    mocks.me.mockResolvedValue(me(true));
    mocks.settingsLink.mockResolvedValueOnce({ target: { agentId: 'ag1', section } });
    render(<StudioApp />);
    expect(await screen.findByRole('heading', { name: hub })).toBeInTheDocument();
    await flush();
    expect(screen.queryByRole('heading', { name: new RegExp(`"section":"${section}"`) })).toBeNull();
    cleanup();
  }
});

it('?settings=account (and start_param settings) open You without asking the server', async () => {
  for (const setup of [() => open('?settings=account'), () => { mocks.startParam = 'settings'; }]) {
    setup();
    mocks.me.mockResolvedValue(me(true));
    render(<StudioApp />);
    expect(await screen.findByRole('heading', { name: 'You probe' })).toBeInTheDocument();
    cleanup(); open(''); mocks.startParam = undefined;
  }
  expect(mocks.settingsLink).not.toHaveBeenCalled();
});

it('an unknown or forbidden code (null target) and a failed lookup land on the hub', async () => {
  for (const answer of [() => mocks.settingsLink.mockResolvedValueOnce({ target: null }), () => mocks.settingsLink.mockRejectedValueOnce(new Error('offline'))]) {
    answer();
    mocks.startParam = 's_ZZZZZZZZ';
    mocks.me.mockResolvedValue(me(true));
    render(<StudioApp />);
    expect(await screen.findByRole('heading', { name: 'You probe' })).toBeInTheDocument();
    cleanup();
  }
});

it('p_…, welcome and junk are ignored', async () => {
  for (const value of ['p_AbCdEf12_abcdefghijklmnopqrstuv', 'welcome', 's_bad!']) {
    mocks.startParam = value;
    mocks.me.mockResolvedValue(me(true));
    render(<StudioApp />);
    expect(await screen.findByRole('heading', { name: 'Home probe' })).toBeInTheDocument();
    await flush();
    expect(screen.queryByRole('heading', { name: 'You probe' })).toBeNull();
    cleanup();
  }
  expect(mocks.settingsLink).not.toHaveBeenCalled();
});

it('navigation made before the server answers wins', async () => {
  let resolve!: (v: unknown) => void;
  mocks.settingsLink.mockReturnValue(new Promise((r) => { resolve = r; }));
  mocks.startParam = 's_AbCd-_12_m';
  mocks.me.mockResolvedValue(me(true));
  render(<StudioApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Go to org' }));
  await act(async () => { resolve({ target: { agentId: 'ag1', section: 'memory' } }); });
  await flush();
  expect(screen.getByRole('heading', { name: 'Org probe' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Memories probe ag1' })).toBeNull();
});

it('a ?notification= link wins over a settings link', async () => {
  open('?notification=n1');
  mocks.startParam = 'settings';
  mocks.me.mockResolvedValue(me(true));
  render(<StudioApp />);
  expect(await screen.findByRole('heading', { name: `Settings probe reminders ${JSON.stringify({ notificationId: 'n1' })}` })).toBeInTheDocument();
  await flush();
  expect(screen.queryByRole('heading', { name: 'You probe' })).toBeNull();
});

it('flag off, or a pending person: s_ and settings are ignored and the server is never asked', async () => {
  for (const who of [me(false), me(true, 'pending')]) {
    open('?settings=account');
    mocks.startParam = 's_AbCd-_12_m';
    mocks.me.mockResolvedValue(who);
    render(<StudioApp />);
    await flush(); await flush();
    expect(screen.queryByRole('heading', { name: 'You probe' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Memories probe/ })).toBeNull();
    cleanup();
  }
  expect(mocks.settingsLink).not.toHaveBeenCalled();
});
