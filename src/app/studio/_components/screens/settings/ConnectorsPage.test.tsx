import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionsDashboard } from '@/lib/connections/application';
import type { AgentView } from '../../../_lib/client';
import { ConfirmProvider } from '../../ui';
import { expectNoRawControls } from '../../ui.testing';
import { ConnectorsPage } from './ConnectorsPage';

const api = vi.hoisted(() => ({ read: vi.fn(), resources: vi.fn(), grant: vi.fn(), enroll: vi.fn(), setup: vi.fn(), claim: vi.fn(), cancelSetup: vi.fn(), review: vi.fn(),
  approve: vi.fn(), cancel: vi.fn(), execute: vi.fn(), revoke: vi.fn(), task: vi.fn(), mcpEnroll: vi.fn(), mcpPreview: vi.fn(), mcpClaim: vi.fn(), mcpCancel: vi.fn() }));
const nav = vi.hoisted(() => ({ current: null as unknown as Record<string, unknown> }));
vi.mock('../../../_lib/connections-client', () => ({ connectionsApi: api, openConnectionSignIn: vi.fn() }));
vi.mock('../../../_lib/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../../_lib/client')>(), tg: () => null }));
vi.mock('../../StudioApp', () => ({ useNav: () => nav.current }));

const HOUR = 3_600_000;
const agent = { id: 'nova', status: 'active', persona: { name: 'Nova' } } as AgentView;
const scope = { tenantId: 't', spaceId: 's', spaceKind: 'personal', containerId: 'c', audiencePersonIds: ['p'], audienceRevision: 'r' };
const provider = (id: string, name: string, state: object) => ({ id, name, description: '', setup: 'oauth', availability: 'setup_required', reason: '', tools: [{ id: `${id}.read`, name: 'Read', effect: 'read' }], state });
const grantRow = (o: Record<string, unknown> = {}) => ({ id: 'g1', revision: 2, connectionId: 'c-gmail', agentId: 'nova', toolIds: ['gmail.read'], resourceIds: ['r1'], destinationIds: ['vox:private'],
  effects: ['read'], createdAt: Date.now() - HOUR, expiresAt: Date.now() + 8 * HOUR, status: 'active', maxCalls: 100, maxBytes: 1000, ...o });

function dashboard(o: Partial<ConnectionsDashboard> = {}): ConnectionsDashboard {
  return { schemaVersion: 1, scope, enabled: true, maxGrantExpiryAt: Date.now() + 30 * 24 * HOUR, canRunTasks: true, agents: [{ id: 'nova', name: 'Nova' }], operations: [],
    connections: [
      { id: 'c-gmail', providerId: 'gmail', displayLabel: 'me@example.org', revision: 3, lifecycle: 'connected', health: 'healthy', checkedAt: 1, revocationEpoch: 0, agentId: 'nova' },
      { id: 'c-drive', providerId: 'google_drive', displayLabel: 'Drive', revision: 1, lifecycle: 'pending', health: 'unknown', checkedAt: null, revocationEpoch: 0, agentId: 'nova' },
    ],
    grants: [grantRow()],
    providers: [
      provider('gmail', 'Gmail', { status: 'connected', how: 'sign_in', needs: [], connectionId: 'c-gmail' }),
      provider('github', 'GitHub', { status: 'available', how: 'sign_in', needs: [] }),
      provider('google_drive', 'Google Drive', { status: 'pending', how: 'sign_in', needs: [], connectionId: 'c-drive' }),
      provider('notion', 'Notion', { status: 'needs_vox', how: 'vox_adds', needs: ['not_set_up_for_you'] }),
    ],
    mcp: { available: true, needs: [] },
    ...o } as unknown as ConnectionsDashboard;
}

function setNav(locale: 'en' | 'fa' = 'en') {
  nav.current = { locale, dir: locale === 'fa' ? 'rtl' : 'ltr', space: 'personal', setSpace: vi.fn(), snack: vi.fn(), toast: vi.fn(), push: vi.fn(), back: vi.fn(), tier: 'full', cache: new Map() };
}
const open = () => render(<ConfirmProvider><ConnectorsPage agent={agent} /></ConfirmProvider>);
const section = (name: string) => within(screen.getByRole('region', { name }));

beforeEach(() => { vi.resetAllMocks(); setNav(); api.read.mockResolvedValue(dashboard()); });
afterEach(cleanup);

describe('Connectors & plugins page', () => {
  it('shows every catalog provider in its true state for this agent, with live access time and the right next step', async () => {
    const view = open();
    await screen.findByText('Gmail');
    expect(api.read).toHaveBeenCalledWith('personal', 'nova');
    const connected = section('Connected');
    expect(connected.getByText('Read only · asks before each use')).toBeInTheDocument();
    expect(connected.getByText('On · 8h')).toBeInTheDocument();
    expect(connected.getByRole('button', { name: 'Ask Nova: Gmail' })).toBeInTheDocument();
    // Every row action names its app, so a screen reader's button list tells them apart.
    expect(connected.getByRole('button', { name: 'Details: Gmail' })).toBeInTheDocument();
    // The account label never shows on this page; the provider name does.
    expect(screen.queryByText('me@example.org')).toBeNull();
    const add = section('Add');
    expect(add.getByRole('button', { name: 'Connect: GitHub' })).toBeInTheDocument();
    expect(add.getByRole('button', { name: 'Finish: Google Drive' })).toBeInTheDocument();
    expect(add.getByText('Vox sets this up')).toBeInTheDocument();
    expect(add.getByText('Vox adds it for your account · Vox hasn’t set this up for your account and this agent yet.')).toBeInTheDocument();
    expect(section('Plugins (MCP servers)').getByRole('button', { name: 'Add MCP server' })).toBeInTheDocument();
    expect(screen.getByText(/send \/ask in its Telegram chat/)).toBeInTheDocument();
    expectNoRawControls(view.container);
  });

  it('says plainly when Vox turned custom MCP off, and offers no add row', async () => {
    api.read.mockResolvedValue(dashboard({ mcp: { available: false, needs: ['mcp_off', 'answers_off'] } } as never));
    open();
    await screen.findByText('Gmail');
    expect(screen.getByText('Custom MCP servers are turned off by Vox.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add MCP server' })).toBeNull();
  });

  it('Persian: headings and the missing-setup reason', async () => {
    setNav('fa');
    open();
    await screen.findByText('Gmail');
    expect(screen.getByRole('region', { name: 'متصل' })).toBeInTheDocument();
    expect(screen.getByText(/وکس هنوز این را برای حساب شما و این عامل راه‌اندازی نکرده است/)).toBeInTheDocument();
    expect(screen.getByText('روشن · ۸ ساعت')).toBeInTheDocument();
  });

  it('Connect enrolls this provider for this agent and opens the sign-in', async () => {
    api.enroll.mockResolvedValue({ connections: [...dashboard().connections, { id: 'c-gh', providerId: 'github', agentId: 'nova', lifecycle: 'pending' }] });
    api.setup.mockResolvedValue({ flowId: 'f1', status: 'pending', authorizationUrl: 'https://github.com/login/oauth/authorize?x=1', expiresAt: Date.now() + HOUR });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect: GitHub' }));
    await waitFor(() => expect(api.setup).toHaveBeenCalledWith('personal', 'c-gh'));
    expect(api.enroll).toHaveBeenCalledWith('personal', 'github', 'GitHub', 'nova');
    expect(api.grant).not.toHaveBeenCalled();
  });

  it('Renew stops the ended access, then allows the same tools and resources again for the same length', async () => {
    api.read.mockResolvedValue(dashboard({ grants: [grantRow({ createdAt: Date.now() - 10 * HOUR, expiresAt: Date.now() - 2 * HOUR })] } as never));
    api.revoke.mockResolvedValue({}); api.grant.mockResolvedValue({});
    open();
    expect(await screen.findByText('Access ended')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Renew: Gmail' }));
    await waitFor(() => expect(api.grant).toHaveBeenCalled());
    expect(api.revoke).toHaveBeenCalledWith('personal', 'c-gmail', 3, 'g1', 2);
    const input = api.grant.mock.calls[0][0];
    expect(input).toMatchObject({ space: 'personal', connectionId: 'c-gmail', expectedRevision: 3, agentId: 'nova', toolIds: ['gmail.read'], resourceIds: ['r1'], destinationIds: ['vox:private'], effects: ['read'] });
    expect(input.expiresAt - Date.now()).toBeGreaterThan(7.9 * HOUR);
    expect(api.revoke.mock.invocationCallOrder[0]).toBeLessThan(api.grant.mock.invocationCallOrder[0]);
  });

  it('a failed second step of Renew offers a real retry of the same access, and the warning goes once access is back', async () => {
    const expired = grantRow({ createdAt: Date.now() - 10 * HOUR, expiresAt: Date.now() - HOUR });
    api.read.mockResolvedValueOnce(dashboard({ grants: [expired] } as never));
    // After the revoke the old grant is no longer active (the server lists active grants only): no Renew button exists any more.
    api.read.mockResolvedValue(dashboard({ grants: [{ ...expired, status: 'revoked' }] } as never));
    api.revoke.mockResolvedValue({}); api.grant.mockRejectedValueOnce(new Error('conflict'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Renew: Gmail' }));
    expect(await screen.findByText('Gmail: the old access ended, but the new access wasn’t saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renew: Gmail' })).toBeNull();
    // Try again re-allows exactly what was there, for the same length, without rebuilding it in a sheet.
    api.grant.mockResolvedValueOnce({});
    api.read.mockResolvedValue(dashboard({ grants: [{ ...expired, status: 'revoked' }, grantRow({ id: 'g2' })] } as never));
    fireEvent.click(screen.getByRole('button', { name: 'Try again: Gmail' }));
    await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(2));
    expect(api.grant.mock.calls[1][0]).toMatchObject({ connectionId: 'c-gmail', expectedRevision: 3, agentId: 'nova', toolIds: ['gmail.read'], resourceIds: ['r1'], destinationIds: ['vox:private'], effects: ['read'] });
    expect(api.grant.mock.calls[1][0].expiresAt - Date.now()).toBeGreaterThan(7.9 * HOUR);
    await waitFor(() => expect(screen.queryByText('Gmail: the old access ended, but the new access wasn’t saved.')).toBeNull());
  });

  it('the Renew warning also goes when access comes back another way (Allow access)', async () => {
    const expired = grantRow({ expiresAt: Date.now() - HOUR });
    api.read.mockResolvedValueOnce(dashboard({ grants: [expired] } as never));
    api.read.mockResolvedValue(dashboard({ grants: [] } as never));
    api.revoke.mockResolvedValue({}); api.grant.mockRejectedValueOnce(new Error('conflict'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Renew: Gmail' }));
    expect(await screen.findByRole('button', { name: 'Allow access: Gmail' })).toBeInTheDocument();
    expect(screen.getByText('Gmail: the old access ended, but the new access wasn’t saved.')).toBeInTheDocument();
    // Access restored another way (e.g. the Allow access sheet), then a reload: the warning is gone.
    api.read.mockResolvedValue(dashboard({ grants: [grantRow({ id: 'g3' })] } as never));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: 'Ask Nova: Gmail' })).toBeInTheDocument();
    expect(screen.queryByText('Gmail: the old access ended, but the new access wasn’t saved.')).toBeNull();
  });

  it('a connected app Vox no longer has set up says what is missing and offers no Ask, Allow or Renew', async () => {
    api.read.mockResolvedValue(dashboard({
      providers: [provider('gmail', 'Gmail', { status: 'connected', how: 'sign_in', needs: ['not_set_up_for_you'], connectionId: 'c-gmail' })],
      connections: [...dashboard().connections, { id: 'c-mcp', providerId: 'remote_mcp', displayLabel: 'Team files', revision: 1, lifecycle: 'connected', health: 'healthy', checkedAt: 1, revocationEpoch: 0, agentId: 'nova',
        mcp: { canonicalResourceUri: 'https://mcp.fixture.net/mcp', catalog: null } }],
      grants: [grantRow(), grantRow({ id: 'g-mcp', connectionId: 'c-mcp' })],
      mcp: { available: false, needs: ['mcp_off'] } } as never));
    open();
    const connected = within(await screen.findByRole('region', { name: 'Connected' }));
    expect(await connected.findByText('Vox hasn’t set this up for your account and this agent yet.')).toBeInTheDocument();
    expect(connected.queryByRole('button', { name: 'Ask Nova: Gmail' })).toBeNull();
    expect(connected.getByRole('button', { name: 'Details: Gmail' })).toBeInTheDocument();
    const plugins = section('Plugins (MCP servers)');
    expect(plugins.queryByRole('button', { name: 'Ask Nova: Team files' })).toBeNull();
    expect(plugins.getAllByText('Custom MCP servers are turned off by Vox.').length).toBeGreaterThan(0);
  });

  it('an app only a Vox operator can connect is never offered as Connect or Finish', async () => {
    api.read.mockResolvedValue(dashboard({ providers: [
      provider('notion', 'Notion', { status: 'needs_vox', how: 'vox_adds', needs: ['vox_enrolls'] }),
      provider('google_drive', 'Google Drive', { status: 'pending', how: 'vox_adds', needs: ['vox_enrolls'], connectionId: 'c-drive' }),
    ] } as never));
    open();
    const add = within(await screen.findByRole('region', { name: 'Add' }));
    expect(await add.findAllByText('Vox adds it for your account · A Vox admin connects this for your account. It can’t be connected from here yet.')).toHaveLength(2);
    expect(add.getAllByText('Vox sets this up')).toHaveLength(2);
    expect(add.queryByRole('button', { name: 'Connect: Notion' })).toBeNull();
    expect(add.queryByRole('button', { name: 'Finish: Google Drive' })).toBeNull();
  });

  it('a server that cannot add MCP servers from the app says so instead of offering Add', async () => {
    api.read.mockResolvedValue(dashboard({ mcp: { available: false, needs: ['main_app_off'] } } as never));
    open();
    expect(await screen.findByText('This Vox server can’t add MCP servers from the app yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add MCP server' })).toBeNull();
  });

  it('adds a custom MCP server: URL and name, sign-in, review the server\'s own tools, then claim that exact catalog', async () => {
    api.mcpEnroll.mockResolvedValue({ connections: [...dashboard().connections, { id: 'c-mcp', providerId: 'remote_mcp', agentId: 'nova', lifecycle: 'pending' }] });
    api.setup.mockResolvedValue({ flowId: 'f-mcp', kind: 'remote_mcp', status: 'pending', authorizationUrl: 'https://auth.fixture.net/authorize', expiresAt: Date.now() + HOUR });
    api.mcpPreview.mockResolvedValue({ flowId: 'f-mcp', status: 'pending', expiresAt: Date.now() + HOUR,
      catalog: { resource: 'https://mcp.fixture.net/mcp', catalogDigest: 'd'.repeat(64), tools: [{ id: 'mcp.files.get', title: 'Read a file', description: 'From the server', inputSchema: { type: 'object' } }] } });
    api.mcpClaim.mockResolvedValue({ flowId: 'f-mcp', status: 'connected', expiresAt: Date.now() + HOUR });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Add MCP server' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add MCP server' });
    const continueButton = within(dialog).queryByRole('button', { name: 'Continue' }) ?? screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Server URL'), { target: { value: 'https://mcp.fixture.net/mcp' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Team files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.setup).toHaveBeenCalledWith('personal', 'c-mcp'));
    expect(api.mcpEnroll).toHaveBeenCalledWith('personal', 'nova', 'https://mcp.fixture.net/mcp', 'Team files');
    fireEvent.click(await screen.findByRole('button', { name: 'Check sign-in' }));
    expect(await screen.findByText('Read a file')).toBeInTheDocument();
    const connect = screen.getByRole('button', { name: 'Connect reviewed server' });
    expect(connect).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Connect this server to Nova/ }));
    fireEvent.click(connect);
    await waitFor(() => expect(api.mcpClaim).toHaveBeenCalledWith('personal', 'f-mcp', 'd'.repeat(64)));
    expect(api.grant).not.toHaveBeenCalled();
  });

  it('an unsafe server URL is refused with the server\'s reason', async () => {
    const { ApiError } = await import('../../../_lib/client');
    api.mcpEnroll.mockRejectedValue(new ApiError(400, 'mcp_url_unsupported'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Add MCP server' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add MCP server' });
    fireEvent.change(within(dialog).getByLabelText('Server URL'), { target: { value: 'https://10.0.0.1/mcp' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Use a public HTTPS MCP URL without a query or fragment.')).toBeInTheDocument();
  });
});
