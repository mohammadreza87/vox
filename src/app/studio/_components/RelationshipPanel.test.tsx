import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type RelationshipView } from '../_lib/client';
import { RelationshipPanel } from './RelationshipPanel';

vi.mock('../_lib/product-pause-client', () => ({ useProductPause: () => pauseState }));
const pauseState = vi.hoisted(() => ({ coveredBlocked: false, status: null as { productPaused: boolean; useEpoch: number; accountId: string } | null }));
vi.mock('../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../_lib/client')>();
  return { ...actual, api: { ...actual.api, relationship: vi.fn(), updateRelationship: vi.fn() } };
});
vi.mock('./StudioApp', () => ({ errorMessage: (e: unknown) => e instanceof Error ? e.message : 'Something went wrong' }));

const make = (space: 'work' | 'personal', more: Partial<RelationshipView> = {}): RelationshipView => ({
  available: true, mode: 'live', disabled: false, timeZone: 'Europe/Tallinn', quietHours: { start: 22, end: 8 },
  preferences: [{ key: 'brevity', value: space === 'work' ? 'Work brevity' : 'Personal detail' }], openSituations: 1, pending: 0, unanswered: 0,
  space, externalEnabled: false, externalAvailable: true, inbox: [{ id: `${space}-item`, text: `${space} private check-in`, createdAt: 1, expiresAt: 99, status: 'unread' }], sources: [], ...more,
});
beforeEach(() => {
  pauseState.coveredBlocked = false; pauseState.status = null;
  vi.mocked(api.relationship).mockImplementation(async (_id, space = 'work') => ({ relationship: make(space) }));
  vi.mocked(api.updateRelationship).mockImplementation(async (_id, input) => ({ relationship: make(input.space ?? 'work', { externalEnabled: input.action === 'external' ? !!input.enabled : false }) }));
});
afterEach(() => vi.clearAllMocks());

describe('RelationshipPanel', () => {
  it('requests and renders isolated relationship state for each space', async () => {
    const { rerender } = render(<RelationshipPanel agentId="nova" name="Nova" space="work" identityConfirmed />);
    expect(await screen.findByText('Work brevity')).toBeVisible();
    expect(screen.getByText('work private check-in')).toBeVisible();
    rerender(<RelationshipPanel agentId="nova" name="Nova" space="personal" identityConfirmed />);
    expect(screen.queryByText('Work brevity')).not.toBeInTheDocument();
    expect(await screen.findByText('Personal detail')).toBeVisible();
    expect(api.relationship).toHaveBeenLastCalledWith('nova', 'personal');
  });

  it('ignores a late response from the previous scope', async () => {
    let resolveWork!: (value: { relationship: RelationshipView }) => void;
    vi.mocked(api.relationship).mockImplementation((_id, space = 'work') => space === 'work' ? new Promise(resolve => { resolveWork = resolve; }) : Promise.resolve({ relationship: make('personal') }));
    const { rerender } = render(<RelationshipPanel agentId="nova" name="Nova" space="work" identityConfirmed />);
    rerender(<RelationshipPanel agentId="nova" name="Nova" space="personal" identityConfirmed />);
    expect(await screen.findByText('Personal detail')).toBeVisible();
    await act(async () => resolveWork({ relationship: make('work') }));
    expect(screen.getByText('Personal detail')).toBeVisible();
    expect(screen.queryByText('Work brevity')).not.toBeInTheDocument();
  });

  it('keeps stop available when the relationship loop is disabled', async () => {
    vi.mocked(api.relationship).mockResolvedValueOnce({ relationship: make('work', { available: false, mode: 'off' }) });
    render(<RelationshipPanel agentId="nova" name="Nova" space="work" identityConfirmed />);
    expect(await screen.findByText(/Follow-ups are unavailable/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop follow-ups' }));
    await waitFor(() => expect(api.updateRelationship).toHaveBeenCalledWith('nova', expect.objectContaining({ action: 'stop', space: 'work' }), 'work'));
  });

  it('starts external alerts off and sends explicit scope when enabled', async () => {
    render(<RelationshipPanel agentId="nova" name="Nova" space="personal" identityConfirmed />);
    const alerts = await screen.findByRole('checkbox', { name: 'Generic Telegram alerts' });
    expect(alerts).not.toBeChecked();
    fireEvent.click(alerts);
    await waitFor(() => expect(api.updateRelationship).toHaveBeenCalledWith('nova', { action: 'external', enabled: true, space: 'personal' }, 'personal'));
    expect(screen.getByText(/never include conversation content/i)).toBeVisible();
  });

  it('renders RTL Persian labels and keeps private inbox hidden before identity confirmation', async () => {
    const { container } = render(<RelationshipPanel agentId="nova" name="نووا" space="personal" locale="fa" />);
    expect(await screen.findByText('بررسی‌های خصوصی تا زمان تأیید هویت پنهان هستند.')).toBeVisible();
    expect(screen.queryByText('personal private check-in')).not.toBeInTheDocument();
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'توقف پیگیری' })).toBeEnabled();
  });
});

it('removes cached derived check-ins across pause/resume boundaries while retaining own source management', async () => {
  vi.mocked(api.relationship).mockResolvedValue({ relationship: make('work', { sources: [{ id: 'source-own', createdAt: 1 }] as RelationshipView['sources'] }) });
  const view = render(<RelationshipPanel agentId="nova" name="Nova" space="work" identityConfirmed />);
  await screen.findByText('work private check-in');
  pauseState.coveredBlocked = true; pauseState.status = { productPaused: true, useEpoch: 1, accountId: 'account' };
  view.rerender(<RelationshipPanel agentId="nova" name="Nova" space="work" identityConfirmed />);
  expect(screen.queryByText('work private check-in')).toBeNull();
  expect(screen.getByRole('button', { name: 'Remove source' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Stop follow-ups' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Forget relationship context' })).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'Generic Telegram alerts' })).toBeDisabled();
  pauseState.coveredBlocked = false; pauseState.status = { productPaused: false, useEpoch: 2, accountId: 'account' };
  view.rerender(<RelationshipPanel agentId="nova" name="Nova" space="work" identityConfirmed />);
  expect(screen.queryByText('work private check-in')).toBeNull();
});
