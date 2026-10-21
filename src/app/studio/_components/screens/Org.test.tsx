import { act } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../../_lib/client';
import { ConfirmProvider } from '../ui';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { OrgScreen } from './Org';

const state = vi.hoisted(() => ({
  members: vi.fn(), setRole: vi.fn(),
  nav: { locale: 'en' as 'en' | 'fa', me: { org: 'Fixture team', member: { telegramId: 1, name: 'Owner One', role: 'owner' } }, push: vi.fn(), toast: vi.fn() },
}));

vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, members: state.members, setRole: state.setRole } };
});
// The character renderer is another stream's work; these tests are about layout and behaviour.
vi.mock('../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Cloud')>();
  const Face = ({ label, stage }: { label?: string; stage?: number }) => <span role="img" aria-label={label} data-stage={stage} />;
  return { ...actual, Cloud: Face, AgentFace: Face };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
}));
vi.mock('../RelationshipObservations', () => ({ RelationshipObservations: () => null }));

const person = (telegramId: number, name: string, role: Member['role']): Member => ({ telegramId, name, role, joinedAt: '2026-01-01' });

beforeEach(() => { vi.clearAllMocks(); state.nav.locale = 'en'; });
afterEach(cleanup);

async function renderOrg() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<ConfirmProvider><OrgScreen /></ConfirmProvider>); });
  return view;
}

describe('Org', () => {
  it('speaks Persian on a Persian session: head, sections, approve and the role sheet', async () => {
    state.nav.locale = 'fa';
    state.members.mockResolvedValue({ people: [person(1, 'Owner One', 'owner'), person(3, 'Pat Pending', 'pending'), person(4, 'Mo Member', 'member')], agentAdmins: [] });
    await renderOrg();
    expect(screen.getByRole('heading', { level: 1, name: 'سازمان' })).toBeInTheDocument();
    expect(screen.getByText('در انتظار تأیید · ۱')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تأیید Pat Pending' })).toHaveTextContent('تأیید');
    expect(screen.getByText('عامل‌های مدیر · ۰')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'تغییر نقش Mo Member' }));
    expect(screen.getByText('نقش فعلی: عضو')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Owners|Members|Approve|Agent admins|Currently|Org\b/);
  });

  it('heads the tab "Org" straight in the stack (like Groups and You) and puts the rights note in a section footnote', async () => {
    state.members.mockResolvedValue({ people: [person(1, 'Owner One', 'owner'), person(4, 'Mo Member', 'member')], agentAdmins: [] });
    const { container } = await renderOrg();
    expect(screen.getByRole('heading', { level: 1, name: 'Org' })).toBeInTheDocument();
    expect(container.querySelector('.vx-stack > .vx-pagehead')).not.toBeNull();
    const foot = screen.getByText('You can make owners, superadmins and admins — humans or agents.');
    expect(foot).toHaveClass('vx-section-foot');
    expect(foot.closest('section')?.querySelector('.vx-section-head')).toHaveTextContent('Owners · 1');
    expect(screen.getAllByText('You can make owners, superadmins and admins — humans or agents.')).toHaveLength(1);
    expect(container.querySelector('.vx-row.l')).not.toBeNull();
  });

  it('approves from the list with a tonal button, never a volt one', async () => {
    state.members.mockResolvedValue({ people: [person(1, 'Owner One', 'owner'), person(2, 'Sam Pending', 'pending'), person(3, 'Pat Pending', 'pending')], agentAdmins: [] });
    state.setRole.mockResolvedValue({ member: person(2, 'Sam Pending', 'member') });
    const { container } = await renderOrg();
    const approve = screen.getByRole('button', { name: 'Approve Sam Pending' });
    expect(approve).toHaveClass('vx-btn-tonal', 'vx-btn-xs');
    expectOneVolt(container);
    expectNoRawControls(container);
    await act(async () => { fireEvent.click(approve); });
    expect(state.setRole).toHaveBeenCalledWith(2, 'member');
  });

  it('asks before removing access and does nothing on Keep', async () => {
    state.members.mockResolvedValue({ people: [person(1, 'Owner One', 'owner'), person(4, 'Mo Member', 'member')], agentAdmins: [] });
    state.setRole.mockResolvedValue({ member: person(4, 'Mo Member', 'pending') });
    await renderOrg();
    fireEvent.click(screen.getByRole('button', { name: "Change Mo Member's role" }));
    const sheet = within(screen.getByRole('dialog', { name: 'Change role' }));
    await act(async () => { fireEvent.click(sheet.getByRole('button', { name: 'Remove access' })); });
    const confirm = within(screen.getByRole('dialog', { name: 'Remove Mo Member’s access?' }));
    await act(async () => { fireEvent.click(confirm.getByRole('button', { name: 'Keep' })); });
    expect(state.setRole).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(sheet.getByRole('button', { name: 'Remove access' })); });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Mo Member’s access?' })).getByRole('button', { name: 'Remove access' })); });
    expect(state.setRole).toHaveBeenCalledWith(4, 'pending');
  });

  it('shows the error template with Try again when people fail to load', async () => {
    state.members.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ people: [person(1, 'Owner One', 'owner')], agentAdmins: [] });
    await renderOrg();
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t load people');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('Owner One')).toBeInTheDocument();
  });

  it('labels agent admins in sentence case', async () => {
    state.members.mockResolvedValue({ people: [person(1, 'Owner One', 'owner')], agentAdmins: [{
      id: 'x', stage: 3, persona: { name: 'Nova', role: 'Designer' }, look: { hue: 'sky', family: 'drift', features: { cheeks: false, lashes: false, brows: false } },
    }] });
    await renderOrg();
    expect(screen.getByText('AI admin')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Nova' })).toHaveAttribute('data-stage', '3');
    expect(screen.getByRole('button', { name: /Nova/ })).toHaveClass('l');
    fireEvent.click(screen.getByRole('button', { name: /Nova/ }));
    expect(state.nav.push).toHaveBeenCalledWith({ name: 'agent', id: 'x' });
  });
});
