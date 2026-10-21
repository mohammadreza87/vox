import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type RelationshipView } from '../_lib/client';
import { RelationshipPanel } from './RelationshipPanel';

vi.mock('../_lib/product-pause-client', () => ({ useProductPause: () => pauseState }));
const pauseState = vi.hoisted(() => ({ phase: 'ready', session: 'relationship-session', coveredBlocked: false, status: null as { productPaused: boolean; useEpoch: number; accountId: string } | null }));
vi.mock('../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../_lib/client')>();
  return { ...actual, tg: () => ({ initData: pauseState.session }), api: { ...actual.api, relationship: vi.fn(), updateRelationship: vi.fn() } };
});
vi.mock('./StudioApp', () => ({ errorMessage: (e: unknown) => e instanceof Error ? e.message : 'Something went wrong' }));

const make = (space: 'work' | 'personal', more: Partial<RelationshipView> = {}): RelationshipView => ({
  available: true, mode: 'live', disabled: false, timeZone: 'Europe/Tallinn', quietHours: { start: 22, end: 8 },
  preferences: [{ key: 'brevity', value: space === 'work' ? 'Work brevity' : 'Personal detail' }], openSituations: 1, pending: 0, unanswered: 0,
  space, externalEnabled: false, externalAvailable: true, inbox: [{ id: `${space}-item`, text: `${space} private check-in`, createdAt: 1, expiresAt: 99, status: 'unread' }], sources: [], ...more,
});
beforeEach(() => {
  pauseState.coveredBlocked = false; pauseState.status = null; pauseState.phase = 'ready'; pauseState.session = 'relationship-session';
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
    fireEvent.click(screen.getByRole('tab', { name: 'Off' }));
    await waitFor(() => expect(api.updateRelationship).toHaveBeenCalledWith('nova', expect.objectContaining({ action: 'stop', space: 'work' }), 'work'));
  });

  it('starts external alerts off and sends explicit scope when enabled', async () => {
    render(<RelationshipPanel agentId="nova" name="Nova" space="personal" identityConfirmed />);
    const alerts = await screen.findByRole('switch', { name: /^Generic Telegram alerts/ });
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
    expect(screen.getByRole('tab', { name: 'خاموش' })).toBeEnabled();
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
  expect(screen.getByRole('tab', { name: 'Off' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Forget relationship context' })).toBeEnabled();
  expect(screen.getByRole('switch', { name: /^Generic Telegram alerts/ })).toBeDisabled();
  pauseState.coveredBlocked = false; pauseState.status = { productPaused: false, useEpoch: 2, accountId: 'account' };
  view.rerender(<RelationshipPanel agentId="nova" name="Nova" space="work" identityConfirmed />);
  expect(screen.queryByText('work private check-in')).toBeNull();
});

const relationshipElement = (space: 'work' | 'personal' = 'work') => <RelationshipPanel agentId="nova" name="Nova" space={space} identityConfirmed />;
function relationshipPause(epoch: number, paused: boolean, accountId = 'account-a', phase = 'ready') {
  pauseState.status = { productPaused: paused, useEpoch: epoch, accountId }; pauseState.coveredBlocked = paused || phase !== 'ready'; pauseState.phase = phase;
}
it('strips only derived rows from a pre-pause read settled after resume and admits a genuine fresh refresh', async () => {
  relationshipPause(0, false); let finish!: (value: { relationship: RelationshipView }) => void;
  vi.mocked(api.relationship).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(relationshipElement()); await waitFor(() => expect(api.relationship).toHaveBeenCalledTimes(1));
  relationshipPause(1, true); view.rerender(relationshipElement()); relationshipPause(2, false); view.rerender(relationshipElement());
  await act(async () => finish({ relationship: make('work', { preferences: [{ key: 'brevity', value: 'OWN_PRIMARY_KEEP' }], sources: [{ id: 'source-own', createdAt: 1 }] as RelationshipView['sources'], inbox: [{ ...make('work').inbox[0], text: 'OLD_DERIVED_READ' }] }) }));
  expect(screen.queryByText('OLD_DERIVED_READ')).toBeNull(); expect(screen.getByText('OWN_PRIMARY_KEEP')).toBeVisible(); expect(screen.getByRole('button', { name: 'Remove source' })).toBeEnabled(); expect(screen.getByRole('tab', { name: 'Off' })).toBeEnabled();
  expect(api.relationship).toHaveBeenCalledTimes(1);
  vi.mocked(api.relationship).mockResolvedValueOnce({ relationship: make('work', { inbox: [{ ...make('work').inbox[0], text: 'FRESH_AFTER_RESUME' }] }) });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh relationship settings' })); await screen.findByText('FRESH_AFTER_RESUME'); expect(api.relationship).toHaveBeenCalledTimes(2); expect(screen.queryByText('OLD_DERIVED_READ')).toBeNull();
});
it('retains a late primary mutation result without restoring the mutation’s old derived inbox after resume', async () => {
  relationshipPause(0, false); let finish!: (value: { relationship: RelationshipView }) => void;
  vi.mocked(api.updateRelationship).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(relationshipElement()); await screen.findByText('work private check-in'); fireEvent.click(screen.getByRole('tab', { name: 'Off' }));
  await waitFor(() => expect(api.updateRelationship).toHaveBeenCalledTimes(1));
  relationshipPause(1, true); view.rerender(relationshipElement()); relationshipPause(2, false); view.rerender(relationshipElement());
  await act(async () => finish({ relationship: make('work', { disabled: true, preferences: [{ key: 'brevity', value: 'MUTATED_PRIMARY_KEEP' }], sources: [{ id: 'source-own', createdAt: 1 }] as RelationshipView['sources'], inbox: [{ ...make('work').inbox[0], text: 'OLD_DERIVED_MUTATION' }] }) }));
  expect(screen.queryByText('OLD_DERIVED_MUTATION')).toBeNull(); expect(screen.getByText('MUTATED_PRIMARY_KEEP')).toBeVisible(); expect(screen.getByText('Follow-ups are stopped.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Remove source' })).toBeEnabled();
});
it.each(['pending', 'unknown'])('does not revive a read across a %s boundary even when the epoch is unchanged', async phase => {
  relationshipPause(0, false); let finish!: (value: { relationship: RelationshipView }) => void;
  vi.mocked(api.relationship).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(relationshipElement());
  await waitFor(() => expect(api.relationship).toHaveBeenCalledTimes(1)); relationshipPause(0, false, 'account-a', phase); view.rerender(relationshipElement()); relationshipPause(0, false); view.rerender(relationshipElement());
  await act(async () => finish({ relationship: make('work', { inbox: [{ ...make('work').inbox[0], text: 'SAME_EPOCH_OLD' }] }) }));
  expect(screen.queryByText('SAME_EPOCH_OLD')).toBeNull(); expect(screen.getByText('Work brevity')).toBeVisible();
});
it.each(['account', 'space'])('rejects an entire old primary/derived mutation after a %s switch', async change => {
  relationshipPause(0, false); let finish!: (value: { relationship: RelationshipView }) => void;
  vi.mocked(api.updateRelationship).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(relationshipElement());
  await screen.findByText('Work brevity'); fireEvent.click(screen.getByRole('tab', { name: 'Off' })); await waitFor(() => expect(api.updateRelationship).toHaveBeenCalledTimes(1));
  vi.mocked(api.relationship).mockResolvedValueOnce({ relationship: make(change === 'space' ? 'personal' : 'work', { preferences: [{ key: 'brevity', value: 'NEW_SCOPE_PRIMARY' }], inbox: [] }) });
  if (change === 'account') relationshipPause(0, false, 'account-b'); view.rerender(relationshipElement(change === 'space' ? 'personal' : 'work')); await screen.findByText('NEW_SCOPE_PRIMARY');
  await act(async () => finish({ relationship: make('work', { preferences: [{ key: 'brevity', value: 'OLD_SCOPE_PRIVATE' }] }) })); expect(screen.queryByText('OLD_SCOPE_PRIVATE')).toBeNull(); expect(screen.getByText('NEW_SCOPE_PRIMARY')).toBeVisible(); expect(screen.queryByText('work private check-in')).toBeNull();
});
it('performs exactly one fresh read at initial unknown admission and never stamps the old payload as fresh', async () => {
  pauseState.coveredBlocked = true; pauseState.phase = 'initial'; let finish!: (value: { relationship: RelationshipView }) => void;
  vi.mocked(api.relationship).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ relationship: make('work', { inbox: [{ ...make('work').inbox[0], text: 'QUALIFIED_FIRST_INBOX' }] }) });
  const view = render(relationshipElement()); await waitFor(() => expect(api.relationship).toHaveBeenCalledTimes(1)); relationshipPause(0, false); view.rerender(relationshipElement()); await screen.findByText('QUALIFIED_FIRST_INBOX');
  await act(async () => finish({ relationship: make('work', { preferences: [{ key: 'brevity', value: 'UNVERIFIED_OLD_PRIMARY' }], inbox: [{ ...make('work').inbox[0], text: 'UNVERIFIED_OLD_INBOX' }] }) }));
  expect(screen.queryByText('UNVERIFIED_OLD_INBOX')).toBeNull(); expect(screen.getByText('QUALIFIED_FIRST_INBOX')).toBeVisible(); expect(api.relationship).toHaveBeenCalledTimes(2);
  view.rerender(relationshipElement()); expect(api.relationship).toHaveBeenCalledTimes(2);
});

it('reacquires check-ins after a loading status refresh without admitting the old inbox', async () => {
  relationshipPause(0, false);
  const view = render(relationshipElement());
  await screen.findByText('work private check-in');
  let finish!: (value: { relationship: RelationshipView }) => void;
  vi.mocked(api.relationship).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  relationshipPause(0, false, 'account-a', 'loading'); view.rerender(relationshipElement());
  expect(screen.queryByText('work private check-in')).toBeNull();
  relationshipPause(0, false); view.rerender(relationshipElement());
  await waitFor(() => expect(api.relationship).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('work private check-in')).toBeNull();
  await act(async () => finish({ relationship: make('work', { inbox: [{ ...make('work').inbox[0], text: 'FRESH_VERIFIED_CHECKIN' }] }) }));
  expect(screen.getByText('FRESH_VERIFIED_CHECKIN')).toBeVisible();
  view.rerender(relationshipElement()); expect(api.relationship).toHaveBeenCalledTimes(2);
});
