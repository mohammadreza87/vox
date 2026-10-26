import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../_lib/client';
import type { ConnectionsDashboard } from '@/lib/connections/application';
const m = vi.hoisted(() => ({ api: { read: vi.fn(), confirm: vi.fn(), enroll: vi.fn(), mcpEnroll: vi.fn(), resources: vi.fn(), setup: vi.fn(), claim: vi.fn(), cancelSetup: vi.fn(), mcpPreview: vi.fn(), mcpClaim: vi.fn(), mcpCancel: vi.fn(), grant: vi.fn(), revoke: vi.fn(), task: vi.fn(), review: vi.fn(), approve: vi.fn(), execute: vi.fn() },
  bridge: { initData: 'SYNTHETIC_SIGNED_ALPHA', initDataUnsafe: { user: { language_code: 'en' } }, isActive: true, ready: vi.fn(), expand: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn() }, factory: vi.fn() }));
vi.mock('../../_lib/agent-connections-client', () => ({ createAgentConnectionsApi: m.factory }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(), tg: () => m.bridge, initTelegram: vi.fn() }));
vi.mock('../../_lib/connections-client', () => ({ openConnectionSignIn: vi.fn() }));
import { AgentConnectionsApp } from './AgentConnectionsApp';
const dashboard = (label?: string): ConnectionsDashboard => ({ schemaVersion: 1, enabled: true, canRunTasks: false, mcpAvailable: true, maxGrantExpiryAt: Date.now() + 3_600_000,
  scope: { tenantId: 'synthetic', spaceId: 'personal', spaceKind: 'personal', containerId: 'private', audiencePersonIds: ['synthetic'], audienceRevision: 'one' },
  agents: [{ id: 'alpha', name: 'Synthetic Alpha' }], providers: [], grants: [], operations: [], connections: label ? [{ id: 'connection-alpha', agentId: 'alpha', providerId: 'github', displayLabel: label,
    revision: 2, lifecycle: 'connected', health: 'healthy', checkedAt: null, revocationEpoch: 0 }] : [] });
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.clearAllMocks(); m.factory.mockReturnValue(m.api); m.api.read.mockResolvedValue(dashboard()); m.bridge.initData = 'SYNTHETIC_SIGNED_ALPHA'; m.bridge.isActive = true; m.bridge.initDataUnsafe.user.language_code = 'en';
  frames = []; vi.stubGlobal('requestAnimationFrame', vi.fn((fn: FrameRequestCallback) => { frames.push(fn); return frames.length; })); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('window', window); Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: m.bridge } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('public agent Connections page', () => {
  it('hydrates server English markup with a Persian Telegram session without a React recovery', async () => {
    const html = renderToString(<AgentConnectionsApp agentId="alpha" />);
    const container = document.createElement('div'); container.innerHTML = html; document.body.append(container);
    m.bridge.initDataUnsafe.user.language_code = 'fa';
    const recoveries: unknown[] = []; let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => { root = hydrateRoot(container, <AgentConnectionsApp agentId="alpha" />, { onRecoverableError: error => recoveries.push(error) }); });
      await within(container).findByRole('heading', { name: 'اتصال‌ها' });
      expect(recoveries).toEqual([]); expect(within(container).getByRole('main')).toHaveAttribute('dir', 'rtl');
    } finally { await act(async () => root?.unmount()); container.remove(); }
  });
  it('is read-only: lists the person’s connections with no confirm, connect, access, task or disconnect control', async () => {
    m.api.read.mockResolvedValue({ ...dashboard('Own account'), providers: [{ id: 'github', name: 'GitHub', description: 'Code', availability: 'ready', tools: [] }] } as unknown as ConnectionsDashboard);
    render(<AgentConnectionsApp agentId="alpha" />);
    await screen.findByText('Own account');
    expect(screen.getByText('Manage connections in Vox. This page only shows them.')).toBeInTheDocument();
    for (const name of ['Choose access', 'Connect', 'Disconnect this account', 'Confirm my account', 'Continue', 'Finish setup', 'Allow selected access', 'Start task'])
      expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    for (const call of [m.api.confirm, m.api.enroll, m.api.mcpEnroll, m.api.setup, m.api.grant, m.api.revoke, m.api.task, m.api.resources, m.api.review, m.api.approve, m.api.execute])
      expect(call).not.toHaveBeenCalled();
  });
  it('without a confirmed profile it points to Vox instead of offering confirmation', async () => {
    m.api.read.mockRejectedValue(new ApiError(403, 'profile_confirmation_required'));
    render(<AgentConnectionsApp agentId="alpha" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Manage connections in Vox. This page only shows them.');
    expect(screen.queryByRole('button', { name: 'Confirm my account' })).not.toBeInTheDocument();
    expect(m.api.confirm).not.toHaveBeenCalled();
  });
  it('cannot restore a late Personal account response after switching to Work', async () => {
    let release!: (value: ConnectionsDashboard) => void;
    m.api.read.mockImplementation((space: string) => space === 'personal' ? new Promise(resolve => { release = resolve; }) : Promise.resolve(dashboard('WORK_ACCOUNT')));
    render(<AgentConnectionsApp agentId="alpha" />); fireEvent.change(screen.getByRole('combobox', { name: 'Space' }), { target: { value: 'work' } });
    await screen.findByText('WORK_ACCOUNT'); await act(async () => release(dashboard('PERSONAL_PRIVATE_CANARY')));
    expect(screen.queryByText('PERSONAL_PRIVATE_CANARY')).not.toBeInTheDocument(); expect(screen.getByText('WORK_ACCOUNT')).toBeInTheDocument();
    const third = m.factory.mock.calls[0][2] as () => AbortSignal; expect(third().aborted).toBe(true);
  });
  it('removes private DOM synchronously on Telegram deactivation and refetches on return', async () => {
    m.api.read.mockResolvedValue(dashboard('PRIVATE_ACCOUNT_CANARY')); render(<AgentConnectionsApp agentId="alpha" />); await screen.findByText('PRIVATE_ACCOUNT_CANARY');
    const off = m.bridge.onEvent.mock.calls.find(([event]) => event === 'deactivated')?.[1] as () => void;
    act(() => off()); expect(screen.queryByText('PRIVATE_ACCOUNT_CANARY')).not.toBeInTheDocument();
    const on = m.bridge.onEvent.mock.calls.find(([event]) => event === 'activated')?.[1] as () => void;
    act(() => on()); await screen.findByText('PRIVATE_ACCOUNT_CANARY'); expect(m.api.read).toHaveBeenCalledTimes(2);
  });
  it('drops the old signed account and an old bot view before a new request can reveal data', async () => {
    m.api.read.mockResolvedValueOnce(dashboard('OLD_PRIVATE_CANARY')).mockImplementation(() => new Promise(() => {}));
    const view = render(<AgentConnectionsApp agentId="alpha" />); await screen.findByText('OLD_PRIVATE_CANARY');
    m.bridge.initData = 'SYNTHETIC_OTHER_PERSON'; act(() => frames.at(-1)!(0)); expect(screen.queryByText('OLD_PRIVATE_CANARY')).not.toBeInTheDocument();
    view.rerender(<AgentConnectionsApp agentId="beta" />); expect(screen.queryByText('OLD_PRIVATE_CANARY')).not.toBeInTheDocument(); expect(m.factory).toHaveBeenLastCalledWith('beta', 'SYNTHETIC_OTHER_PERSON', expect.any(Function));
  });
  it('clears the account view when the dashboard loses authority', async () => {
    m.api.read.mockResolvedValueOnce(dashboard('RESOURCE_PRIVATE_CANARY')).mockRejectedValue(new ApiError(403, 'agent_unavailable'));
    render(<AgentConnectionsApp agentId="alpha" />); await screen.findByText('RESOURCE_PRIVATE_CANARY');
    fireEvent.change(screen.getByRole('combobox', { name: 'Space' }), { target: { value: 'work' } });
    await screen.findByRole('alert'); expect(screen.queryByText('RESOURCE_PRIVATE_CANARY')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your connections' })).not.toBeInTheDocument();
  });
  it('supports Persian RTL and native focusable controls without changing authority', async () => {
    m.bridge.initDataUnsafe.user.language_code = 'fa'; render(<AgentConnectionsApp agentId="alpha" />);
    await screen.findByRole('heading', { name: 'اتصال‌ها' }); expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    const language = screen.getByRole('combobox', { name: 'زبان' }); language.focus(); expect(language).toHaveFocus();
    expect(await screen.findByText('اتصال‌ها را در وکس مدیریت کنید. این صفحه فقط آن‌ها را نشان می‌دهد.')).toBeInTheDocument(); expect(m.api.grant).not.toHaveBeenCalled();
  });
});
