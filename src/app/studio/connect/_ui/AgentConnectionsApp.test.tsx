import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  it('makes profile confirmation explicit and does not enable optional features or tool grants', async () => {
    m.api.read.mockRejectedValueOnce(new ApiError(403, 'profile_confirmation_required')).mockResolvedValue(dashboard()); m.api.confirm.mockResolvedValue({ confirmed: true });
    render(<AgentConnectionsApp agentId="alpha" />);
    const button = await screen.findByRole('button', { name: 'Confirm my account' }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /This is my Telegram account/ })); fireEvent.click(button);
    await screen.findByRole('heading', { name: 'Your connections' }); expect(m.api.confirm).toHaveBeenCalledExactlyOnceWith('personal'); expect(m.api.grant).not.toHaveBeenCalled();
  });
  it('requires a deliberate exact catalog acceptance after returning from MCP OAuth', async () => {
    let current = dashboard(); m.api.read.mockImplementation(async () => current);
    const pending = { id: 'mcp-alpha', agentId: 'alpha', providerId: 'remote_mcp', displayLabel: 'My server', revision: 1, lifecycle: 'pending', health: 'unknown', checkedAt: null, revocationEpoch: 0 };
    m.api.mcpEnroll.mockImplementation(async () => { current = { ...dashboard(), connections: [pending] } as ConnectionsDashboard; return current; });
    m.api.setup.mockResolvedValue({ flowId: 'synthetic-flow', kind: 'remote_mcp', status: 'pending', expiresAt: Date.now() + 60_000, authorizationUrl: 'https://auth.fixture.net/authorize' });
    m.api.mcpPreview.mockResolvedValue({ flowId: 'synthetic-flow', status: 'pending', expiresAt: Date.now() + 60_000,
      catalog: { resource: 'https://mcp.fixture.net/private/mcp', catalogDigest: 'a'.repeat(64), identityEvidence: 'unavailable', tools: [{ id: 'tool-a', title: 'Read own document', description: 'Untrusted description', inputSchema: { type: 'object' } }] } });
    m.api.mcpClaim.mockImplementation(async () => { current = { ...current, connections: [{ ...pending, lifecycle: 'connected', revision: 2 }] } as ConnectionsDashboard; return { flowId: 'synthetic-flow', status: 'connected' }; });
    render(<AgentConnectionsApp agentId="alpha" />); fireEvent.change(await screen.findByLabelText('Server URL'), { target: { value: 'https://mcp.fixture.net/private/mcp' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My server' } }); fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check connection' }));
    const review = await screen.findByRole('region', { name: 'Review MCP server' });
    expect(within(review).getByText('https://mcp.fixture.net/private/mcp')).toBeInTheDocument();
    const connect = within(review).getByRole('button', { name: 'Connect reviewed server' }); expect(connect).toBeDisabled(); expect(m.api.mcpClaim).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole('checkbox')); fireEvent.click(connect);
    await screen.findByRole('button', { name: 'Choose access' }); expect(m.api.mcpClaim).toHaveBeenCalledExactlyOnceWith('personal', 'synthetic-flow', 'a'.repeat(64)); expect(m.api.grant).not.toHaveBeenCalled();
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
  it('clears all account and access state when an independent resources request loses authority', async () => {
    m.api.read.mockResolvedValue(dashboard('RESOURCE_PRIVATE_CANARY'));
    m.api.resources.mockRejectedValue(new ApiError(403, 'agent_unavailable'));
    render(<AgentConnectionsApp agentId="alpha" />); fireEvent.click(await screen.findByRole('button', { name: 'Choose access' }));
    await screen.findByRole('alert'); expect(screen.queryByText('RESOURCE_PRIVATE_CANARY')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your connections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow selected access' })).not.toBeInTheDocument();
  });
  it('supports Persian RTL and native focusable controls without changing authority', async () => {
    m.bridge.initDataUnsafe.user.language_code = 'fa'; render(<AgentConnectionsApp agentId="alpha" />);
    await screen.findByRole('heading', { name: 'اتصال‌ها' }); expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    const language = screen.getByRole('combobox', { name: 'زبان' }); language.focus(); expect(language).toHaveFocus();
    expect(await screen.findByRole('button', { name: 'ادامه', exact: true })).toBeDisabled(); expect(m.api.grant).not.toHaveBeenCalled();
  });
});
