import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyScreen } from './Privacy';
import type { AdaptiveSnapshot } from '../../_lib/adaptive-client';

const mocks = vi.hoisted(() => ({ read: vi.fn(), confirm: vi.fn(), present: vi.fn(), consent: vi.fn(), save: vi.fn(), remove: vi.fn(), agent: vi.fn(), agents: vi.fn() }));
vi.mock('../../_lib/adaptive-client', () => ({ adaptiveApi: mocks }));
vi.mock('../../_lib/client', () => ({ api: { agents: mocks.agents } }));
const snapshot = (extra: Partial<AdaptiveSnapshot> = {}): AdaptiveSnapshot => ({
  schemaVersion: 1, revision: 2, space: 'work', scope: 'private_account_profile',
  identity: { accountId: 'synthetic-account', personId: 'synthetic-person', confirmed: true, verification: 'account_confirmation', adultDeclared: true },
  purposes: [{ purpose: 'optional.personalization', state: 'not_asked', revision: 1, available: true,
    notice: { id: 'synthetic-notice', version: 'synthetic-v1', title: 'Personalization terms', body: 'Synthetic exact notice.', copyHash: 'synthetic-hash', locale: 'en' } }],
  memories: [], agents: [], explicitMemoryAvailable: true, ...extra,
});
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(snapshot()); mocks.agents.mockResolvedValue({ agents: [] }); });
afterEach(cleanup);

describe('Privacy and memory controls', () => {
  it('does not grant anything on load or on a space switch and clears previous-space text immediately', async () => {
    mocks.read.mockResolvedValueOnce(snapshot({ memories: [{ id: 'private-note', text: 'WORK_ONLY_SECRET', revision: 1, createdAt: 1, expiresAt: 2_000_000_000_000 }] }));
    render(<PrivacyScreen />);
    await screen.findByText('WORK_ONLY_SECRET');
    mocks.read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Personal', exact: true }));
    await waitFor(() => expect(screen.queryByText('WORK_ONLY_SECRET')).not.toBeInTheDocument());
    expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('presents server receipt copy before grant and offers an equal keep-off action', async () => {
    const presented = snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'presented', revision: 2 }] });
    mocks.present.mockResolvedValue({ ...presented, receipt: 'receipt-from-server', notice: presented.purposes[0].notice });
    mocks.consent.mockResolvedValue(snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'declined', revision: 3 }] }));
    render(<PrivacyScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review choice' }));
    await screen.findByText('Synthetic exact notice.');
    expect(mocks.consent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep off' }));
    await waitFor(() => expect(mocks.consent).toHaveBeenCalledWith('work', 'optional.personalization', 2, 'declined', 'receipt-from-server'));
  });
  it('never claims failed deletion succeeded and retains the visible authoritative note', async () => {
    mocks.read.mockResolvedValue(snapshot({ memories: [{ id: 'm', text: 'A synthetic note', revision: 4, createdAt: 1, expiresAt: 2_000_000_000_000 }] }));
    mocks.remove.mockRejectedValue(new Error('conflict'));
    render(<PrivacyScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    await screen.findByRole('alert');
    expect(screen.getByText('A synthetic note')).toBeInTheDocument();
    expect(screen.queryByText('The saved memory was deleted.')).not.toBeInTheDocument();
  });
  it('renders Persian RTL with the same server purposes and no automatic consent', async () => {
    const { container } = render(<PrivacyScreen />);
    await screen.findByRole('button', { name: 'Review choice' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'fa' } });
    await screen.findByRole('button', { name: 'بررسی انتخاب' });
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(mocks.read).toHaveBeenLastCalledWith('work', 'fa');
    expect(mocks.consent).not.toHaveBeenCalled();
  });
});
