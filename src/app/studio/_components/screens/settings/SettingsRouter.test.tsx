import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsRouter } from './SettingsRouter';
import { INBOX_CHANGED, useInboxBadge } from './useInboxBadge';

const mocks = vi.hoisted(() => ({ read: vi.fn(), role: 'member' }));
vi.mock('../../../_lib/experience-client', () => ({ experienceApi: { read: mocks.read } }));
vi.mock('../../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../../_lib/client')>(), tg: () => ({ initData: 'session' }) }));
vi.mock('../../StudioApp', () => ({ useNav: () => ({ locale: 'en', dir: 'ltr', space: 'personal', setSpace: vi.fn(), back: vi.fn(), push: vi.fn(), snack: vi.fn(), tier: 'full', cache: new Map(), me: { member: { role: mocks.role } } }) }));
vi.mock('../../LearningPanel', () => ({ LearningPanel: (p: { space: string; showOperations?: boolean }) => <div data-testid="learning" data-space={p.space} data-ops={String(!!p.showOperations)} /> }));
vi.mock('../../RightsOperationsPanel', () => ({ RightsOperationsPanel: () => <div data-testid="rights-ops" /> }));
vi.mock('../../GuestRightsOperationsPanel', () => ({ GuestRightsOperationsPanel: () => <div data-testid="guest-ops" /> }));
vi.mock('../../VoiceRecognitionPanel', () => ({ VoiceRecognitionPanel: (p: { space: string }) => <div data-testid="voice" data-space={p.space} /> }));
vi.mock('../Connections', () => ({ ConnectionsScreen: (p: { agentId?: string }) => <div data-testid="connections" data-agent={p.agentId ?? ''} /> }));
vi.mock('./ConnectionDetail', () => ({ ConnectionDetailPage: (p: { connectionId: string }) => <div data-testid="connection" data-id={p.connectionId} /> }));
vi.mock('./ExperiencePages', () => ({
  PreferencesPage: () => <div data-testid="preferences" />, InboxPage: () => <div data-testid="inbox" />,
  RemindersPage: (p: { notificationId?: string }) => <div data-testid="reminders" data-notification={p.notificationId ?? ''} />,
}));

beforeEach(() => { mocks.read.mockReset(); mocks.role = 'member'; });
afterEach(cleanup);

describe('SettingsRouter', () => {
  it('routes Preferences, Inbox and Reminders to their own pages, with the reminder deep link', () => {
    const view = render(<SettingsRouter page="preferences" />);
    expect(screen.getByTestId('preferences')).toBeInTheDocument();
    view.rerender(<SettingsRouter page="inbox" />); expect(screen.getByTestId('inbox')).toBeInTheDocument();
    view.rerender(<SettingsRouter page="reminders" params={{ notificationId: 'n1' }} />);
    expect(screen.getByTestId('reminders')).toHaveAttribute('data-notification', 'n1');
  });
  it('opens a connection’s detail page by id, and the list otherwise', () => {
    const view = render(<SettingsRouter page="connection" params={{ connectionId: 'c1' }} />);
    expect(screen.getByTestId('connection')).toHaveAttribute('data-id', 'c1');
    view.rerender(<SettingsRouter page="agent-access" params={{ agentId: 'a1' }} />);
    expect(screen.getByTestId('connections')).toHaveAttribute('data-agent', 'a1');
  });
  it('keeps Diagnostics and Requests for owners, with a pinned top bar and the app space', () => {
    const view = render(<SettingsRouter page="diagnostics" />);
    expect(screen.getByText('For admins only')).toBeInTheDocument();
    expect(screen.queryByTestId('learning')).toBeNull();
    mocks.role = 'owner'; view.rerender(<SettingsRouter page="diagnostics" />);
    expect(screen.getByTestId('learning')).toHaveAttribute('data-space', 'personal');
    expect(screen.getByTestId('learning')).toHaveAttribute('data-ops', 'true');
    expect(screen.getByRole('tab', { name: 'Personal', selected: true })).toBeInTheDocument();
    view.rerender(<SettingsRouter page="requests" />);
    expect(screen.getByTestId('rights-ops')).toBeInTheDocument(); expect(screen.getByTestId('guest-ops')).toBeInTheDocument();
    expect(view.container.querySelector('.vx-topbar')).toHaveTextContent('Privacy requests');
  });
});

describe('useInboxBadge', () => {
  const item = (id: string, kind: string, status: string) => ({ id, kind, status });
  it('counts unread derived notices only, and catches up when the Inbox changes one', async () => {
    mocks.read.mockResolvedValueOnce({ inbox: [item('a', 'reply_failed', 'unread'), item('b', 'reply_failed', 'read'), item('c', 'requested_reminder', 'unread'), item('d', 'reply_failed', 'dismissed')] })
      .mockResolvedValueOnce({ inbox: [] });
    const { result } = renderHook(() => useInboxBadge('work', false));
    await waitFor(() => expect(result.current).toBe(1));
    await act(async () => { window.dispatchEvent(new Event(INBOX_CHANGED)); });
    await waitFor(() => expect(result.current).toBe(0));
    expect(mocks.read).toHaveBeenCalledWith('work');
  });
  it('reads and counts nothing while pause covers derived notices', async () => {
    const { result } = renderHook(() => useInboxBadge('work', true));
    await act(async () => {});
    expect(result.current).toBe(0); expect(mocks.read).not.toHaveBeenCalled();
  });
});
