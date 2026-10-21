import { act } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { AgentDisc, GroupsScreen, groupHue } from './Groups';

const state = vi.hoisted(() => ({
  groups: vi.fn(),
  nav: { locale: 'en' as 'en' | 'fa', me: { org: 'Fixture team', member: { telegramId: 1, name: 'Owner', role: 'owner' } }, push: vi.fn(), toast: vi.fn() },
}));

vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, groups: state.groups } };
});
// The character renderer is another stream's work; these tests are about layout and behaviour.
vi.mock('../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Cloud')>();
  // keeps Cloud's disc frame (the agent stack's discs are Cloud variant="disc")
  const Face = ({ label, variant, stage }: { label?: string; variant?: 'free' | 'disc'; stage?: number }) => {
    const face = <span role="img" aria-label={label} data-stage={stage} />;
    return variant === 'disc' ? <span className="vx-avatar disc">{face}</span> : face;
  };
  return { ...actual, Cloud: Face, AgentFace: Face };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
}));

const look = { hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: false, brows: false } } as const;
const GROUPS = [
  { chatId: 11, title: 'Design crit', hasGuests: true, memberCount: 6, agents: [{ id: 'a', name: 'Aria', look }, { id: 'b', name: 'Bo', look }] },
  { chatId: 12, title: 'Leads', hasGuests: false, memberCount: 4, agents: [] },
];

beforeEach(() => { vi.clearAllMocks(); state.nav.locale = 'en'; });
afterEach(cleanup);

async function renderGroups() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<GroupsScreen />); });
  return view;
}

describe('Groups', () => {
  it('speaks Persian on a Persian session: head, rows, footnote and the group sheet', async () => {
    state.nav.locale = 'fa';
    state.groups.mockResolvedValue({ groups: GROUPS });
    const { container } = await renderGroups();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('گروه‌ها');
    expect(container.querySelector('.vx-pagehead')).toHaveTextContent('تلگرام · ۲ گروه');
    expect(screen.getByText('۶ عضو · ۲ عامل · مهمان')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Design crit/ }));
    expect(screen.getByText('عامل‌های این گروه')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Groups|members?\b|agents?\b|Telegram/);
  });

  it('draws each agent disc at its server growth stage, not a full-grown default (PLAN D7)', () => {
    render(<AgentDisc agent={{ id: 'a', name: 'Aria', look, stage: 2 }} size={24} />);
    expect(screen.getByRole('img', { name: 'Aria' })).toHaveAttribute('data-stage', '2');
  });

  it('shows the error template with Try again, then the list', async () => {
    state.groups.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ groups: GROUPS });
    const view = await renderGroups();
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t load your groups');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('Design crit')).toBeInTheDocument();
    expectOneVolt(view.container);
    expectNoRawControls(view.container);
  });

  it('lays groups out as 68px rows: hue tile, members and agents, guests in warn, agent stack', async () => {
    state.groups.mockResolvedValue({ groups: GROUPS });
    const { container } = await renderGroups();
    const row = screen.getByRole('button', { name: 'Design crit, 6 members · 2 agents · guests' });
    expect(row).toHaveClass('vx-row', 'l');
    expect(row.querySelector('.vx-tile.hue')).toHaveTextContent('D');
    expect(within(row).getByText('6 members · 2 agents · guests')).toHaveClass('vx-row-sub', 'warn');
    expect(row.querySelectorAll('.vx-avatars > .vx-avatar.disc')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Leads, 4 members · 0 agents' }).querySelector('.vx-avatars')).toBeNull();
    expect(container.querySelectorAll('.vx-card')).toHaveLength(0);
  });

  it('opens a group’s agents in a sheet; an agent row opens its profile', async () => {
    state.groups.mockResolvedValue({ groups: GROUPS });
    await renderGroups();
    fireEvent.click(screen.getByRole('button', { name: /^Design crit/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Design crit' }));
    expect(sheet.getByText(/People outside Fixture team are here/)).toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: /^Aria/ }));
    expect(state.nav.push).toHaveBeenCalledWith({ name: 'agent', id: 'a' });
  });

  it('picks a stable living hue per chat', () => {
    expect(groupHue(11)).toBe(groupHue(11));
    expect(new Set(Array.from({ length: 50 }, (_, i) => groupHue(i)))).not.toContain('ash');
  });

  it('shows a skeleton while loading', async () => {
    state.groups.mockReturnValue(new Promise(() => {}));
    await act(async () => { render(<GroupsScreen />); });
    expect(screen.getByRole('status', { name: 'Loading groups' })).toHaveAttribute('aria-busy', 'true');
  });
});
