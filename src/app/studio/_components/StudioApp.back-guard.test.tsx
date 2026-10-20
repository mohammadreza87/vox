import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioApp, useNav } from './StudioApp';
import { useBackGuard } from './screens/spawn/hooks';

const mocks = vi.hoisted(() => ({ me: vi.fn(), backs: new Set<() => void>(), show: vi.fn(), hide: vi.fn() }));
vi.mock('../_lib/client', () => ({ api: { me: mocks.me }, ApiError: class extends Error {}, haptic: { tap: vi.fn(), select: vi.fn() }, initTelegram: vi.fn(),
  tg: () => ({ BackButton: { show: mocks.show, hide: mocks.hide, onClick: (fn: () => void) => mocks.backs.add(fn), offClick: (fn: () => void) => mocks.backs.delete(fn) } }) }));
vi.mock('./Cloud', () => ({ Cloud: () => null }));
vi.mock('./UserInfo', () => ({ UserInfo: () => null }));
vi.mock('./screens/Home', () => ({ HomeScreen: function Home() {
  const nav = useNav();
  const [open, setOpen] = useState(false);
  return <><h1>Home probe</h1><button onClick={() => nav.push({ name: 'spawn' })}>New agent</button>
    <button onClick={() => setOpen(true)}>Open home sheet</button><ProbeSheet name="Home sheet" open={open} onClose={() => setOpen(false)} /></>;
} }));
// Stands in for the Brief step: a brief that must survive Back, two sheets, and a part that can unmount with its sheet open.
vi.mock('./screens/Spawn', () => ({ SpawnScreen: function Spawn() {
  const nav = useNav();
  const [brief, setBrief] = useState('');
  const [roles, setRoles] = useState(false);
  const [skills, setSkills] = useState(false);
  const [panel, setPanel] = useState(true);
  return <><h1>Spawn probe</h1><button onClick={nav.back}>Top back</button>
    <input aria-label="Brief" value={brief} onChange={(e) => setBrief(e.target.value)} />
    <button onClick={() => setRoles(true)}>Open roles</button><button onClick={() => setSkills(true)}>Open skills</button>
    <button onClick={() => setPanel(false)}>Remove panel</button>
    {panel && <ProbeSheet name="Roles" open={roles} onClose={() => setRoles(false)} />}
    <ProbeSheet name="Skills" open={skills} onClose={() => setSkills(false)} />
  </>;
} }));

function ProbeSheet({ name, open, onClose }: { name: string; open: boolean; onClose: () => void }) {
  useBackGuard(open, onClose);
  return open ? <div role="dialog" aria-label={name} /> : null;
}

const telegramBack = () => act(() => { for (const back of [...mocks.backs]) back(); });

async function openSpawn() {
  render(<StudioApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'New agent' }));
  await screen.findByRole('heading', { name: 'Spawn probe' });
}

beforeEach(() => { vi.clearAllMocks(); mocks.backs.clear(); mocks.me.mockResolvedValue({ member: { role: 'member', telegramId: 123 }, org: 'Synthetic' }); });
afterEach(cleanup);

it('Telegram Back closes an open sheet and keeps the brief, then pops normally once nothing is open', async () => {
  await openSpawn();
  fireEvent.change(screen.getByRole('textbox', { name: 'Brief' }), { target: { value: 'A calm product lead' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open roles' }));
  expect(screen.getByRole('dialog', { name: 'Roles' })).toBeInTheDocument();

  telegramBack();
  expect(screen.queryByRole('dialog', { name: 'Roles' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Spawn probe' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Brief' })).toHaveValue('A calm product lead');

  telegramBack();
  await screen.findByRole('heading', { name: 'Home probe' });
});

it('the in-app Back goes through the same guards, newest first', async () => {
  await openSpawn();
  fireEvent.click(screen.getByRole('button', { name: 'Open roles' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open skills' }));

  fireEvent.click(screen.getByRole('button', { name: 'Top back' }));
  expect(screen.queryByRole('dialog', { name: 'Skills' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Roles' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Top back' }));
  expect(screen.queryByRole('dialog', { name: 'Roles' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Spawn probe' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Top back' }));
  await screen.findByRole('heading', { name: 'Home probe' });
});

it('a guard unregisters when its sheet unmounts while open, so Back is never swallowed', async () => {
  await openSpawn();
  fireEvent.click(screen.getByRole('button', { name: 'Open roles' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove panel' }));
  expect(screen.queryByRole('dialog', { name: 'Roles' })).not.toBeInTheDocument();

  telegramBack();
  await screen.findByRole('heading', { name: 'Home probe' });
});

it('shows Telegram’s Back for a guard on a tab root and hides it again once the sheet closes', async () => {
  render(<StudioApp />);
  await screen.findByRole('heading', { name: 'Home probe' });
  expect(mocks.hide).toHaveBeenCalled();
  mocks.show.mockClear(); mocks.hide.mockClear();

  fireEvent.click(screen.getByRole('button', { name: 'Open home sheet' }));
  expect(mocks.show).toHaveBeenCalledTimes(1);
  telegramBack();
  expect(screen.queryByRole('dialog', { name: 'Home sheet' })).not.toBeInTheDocument();
  expect(mocks.hide).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'Home probe' })).toBeInTheDocument();
});
