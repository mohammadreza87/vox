import { webcrypto } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOURCE, SYNTHETIC_TOKEN, settingsV2Fixture } from './settings-v2-fixture';

const directories: string[] = [];
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('CryptoKey', webcrypto.CryptoKey); vi.stubEnv('STUDIO_SETTINGS_V2', '1'); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const enroll = (agentId: string, endpointUrl = RESOURCE) => ({ space: 'personal', agentId, endpointUrl, displayLabel: 'Synthetic server' });

describe('custom MCP from the Vox main app (Settings v2)', () => {
  it('flag off: a manager-signed actor is still sent to the agent bot, at every step', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    const f = await settingsV2Fixture({ directories }), app = await f.appFor(f.manager);
    await expect(app.enrollMcp!(f.manager, enroll('alpha'))).rejects.toMatchObject({ code: 'mcp_open_agent_bot' });
    await expect(app.previewMcpSetup!(f.manager, 'personal', 'flow-1')).rejects.toMatchObject({ code: 'mcp_open_agent_bot' });
    await expect(app.claimMcpSetup!(f.manager, 'personal', 'flow-1', 'a'.repeat(64))).rejects.toMatchObject({ code: 'mcp_open_agent_bot' });
    // A pending server made on the agent page can't be resumed from the main app either.
    const bot = await f.botActor('alpha'), botApp = await f.appFor(bot);
    const pending = (await botApp.enrollMcp!(bot, enroll('alpha'))).connections[0];
    await expect(app.beginSetup(f.manager, 'personal', pending.id)).rejects.toMatchObject({ code: 'mcp_open_agent_bot' });
  });

  it('flag on: enroll, sign in, review and claim the exact catalog for an agent the person can use', async () => {
    const f = await settingsV2Fixture({ directories });
    const done = await f.connect(f.manager, 'alpha');
    expect(done.claimed.status).toBe('connected');
    expect(done.connection).toMatchObject({ agentId: 'alpha', providerId: 'remote_mcp', lifecycle: 'connected' });
    expect(done.connection.mcp?.catalog?.tools).toHaveLength(1);
    const dashboard = await done.app.dashboard(f.manager, 'personal', 'alpha');
    expect(dashboard.grants).toEqual([]); // connecting grants nothing
    expect(dashboard.mcp).toEqual({ available: true, needs: [] });
    expect(JSON.stringify(dashboard)).not.toContain(SYNTHETIC_TOKEN);
    // A changed catalog digest is refused (claim binds to what was reviewed).
    const other = await f.connect(f.manager, 'beta');
    expect(other.connection.lifecycle).toBe('connected');
  });

  it('a wrong digest never activates', async () => {
    const f = await settingsV2Fixture({ directories }), app = await f.appFor(f.manager);
    const connection = (await app.enrollMcp!(f.manager, enroll('alpha'))).connections[0];
    const setup = await app.beginSetup(f.manager, 'personal', connection.id);
    await f.mcp.callback({ state: new URL(setup.authorizationUrl!).searchParams.get('state'), code: 'SYNTHETIC_CODE', iss: 'https://auth.fixture.net/' });
    await app.previewMcpSetup!(f.manager, 'personal', setup.flowId);
    await expect(app.claimMcpSetup!(f.manager, 'personal', setup.flowId, 'b'.repeat(64))).rejects.toBeTruthy();
    expect((await app.service.list(f.manager, { space: 'personal' })).connections[0].lifecycle).toBe('pending');
  });

  it('enforces canUseAgent: a private agent the person may not use, or one that blocked them, is refused', async () => {
    const f = await settingsV2Fixture({ directories }), app = await f.appFor(f.manager);
    await expect(app.enrollMcp!(f.manager, enroll('secret'))).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
    await expect(app.enrollMcp!(f.manager, enroll('blocked'))).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
    await expect(app.enrollMcp!(f.manager, enroll('missing'))).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
  });

  it('a pending member is refused before anything is written', async () => {
    const f = await settingsV2Fixture({ directories, role: 'pending' }), app = await f.appFor(f.manager);
    await expect(app.enrollMcp!(f.manager, enroll('alpha'))).rejects.toMatchObject({ code: 'approval_required', status: 403 });
  });

  it('the operator gate: custom MCP off (or no broker MCP ports) is refused and said plainly on the dashboard', async () => {
    const f = await settingsV2Fixture({ directories, mcpEnabled: false }), app = await f.appFor(f.manager);
    await expect(app.enrollMcp!(f.manager, enroll('alpha'))).rejects.toMatchObject({ code: 'mcp_setup_unavailable', status: 503 });
    const dashboard = await app.dashboard(f.manager, 'personal', 'alpha');
    expect(dashboard.mcp).toEqual({ available: false, needs: ['mcp_off'] });
  });

  it('requires the committed-state fence (file storage) for the main-app path; bot-signed actors are unaffected by it', async () => {
    const f = await settingsV2Fixture({ directories, committed: false }), app = await f.appFor(f.manager);
    await expect(app.enrollMcp!(f.manager, enroll('alpha'))).rejects.toMatchObject({ code: 'connection_authority_transport_unavailable', status: 503 });
  });

  it('without the fence (e.g. Firestore) the dashboard says plainly that servers are added from the bot, instead of offering Add', async () => {
    const f = await settingsV2Fixture({ directories, committed: false }), app = await f.appFor(f.manager);
    expect((await app.dashboard(f.manager, 'personal', 'alpha')).mcp).toEqual({ available: false, needs: ['main_app_off'] });
  });

  it('an adaptive store with no committed identity read also keeps the main-app path closed, and says so', async () => {
    const f = await settingsV2Fixture({ directories }), app = await f.appFor(f.manager);
    const adaptive = (f.studio.deps as unknown as { adaptive: { repository: { readCommittedForEffect: (...a: unknown[]) => unknown } } }).adaptive;
    vi.spyOn(adaptive.repository, 'readCommittedForEffect').mockReturnValue({ status: 'unsupported' });
    expect((await app.dashboard(f.manager, 'personal', 'alpha')).mcp).toEqual({ available: false, needs: ['main_app_off'] });
    await expect(app.enrollMcp!(f.manager, enroll('alpha'))).rejects.toMatchObject({ code: 'connection_authority_transport_unavailable', status: 503 });
  });

  it('the final fence holds for the main-app actor as for a bot: no effect while an identity write holds the account', async () => {
    const f = await settingsV2Fixture({ directories }), app = await f.appFor(f.manager);
    const pending = (await app.enrollMcp!(f.manager, enroll('alpha'))).connections[0];
    const setup = await app.beginSetup(f.manager, 'personal', pending.id);
    await f.mcp.callback({ state: new URL(setup.authorizationUrl!).searchParams.get('state'), code: 'SYNTHETIC_CODE', iss: 'https://auth.fixture.net/' });
    const preview = await app.previewMcpSetup!(f.manager, 'personal', setup.flowId);
    // An identity change for the same account holds the adaptive lock while the claim is in flight.
    const adaptive = (f.studio.deps as unknown as { adaptive: { repository: { readCommittedForEffect: (...a: unknown[]) => unknown } } }).adaptive;
    const busy = vi.spyOn(adaptive.repository, 'readCommittedForEffect').mockReturnValue({ status: 'busy' });
    await expect(app.claimMcpSetup!(f.manager, 'personal', setup.flowId, preview.catalog.catalogDigest)).rejects.toBeTruthy();
    busy.mockRestore();
    expect((await app.service.list(f.manager, { space: 'personal' })).connections[0].lifecycle).toBe('pending');
  });

  it.each(['http://mcp.fixture.net/personal/mcp', 'https://10.0.0.1/mcp', 'https://user:pw@mcp.fixture.net/mcp', 'https://mcp.fixture.net/mcp#x', 'https://mcp.fixture.net/mcp?x=1', 'https://localhost/mcp'])(
    'rejects an unsafe server URL %s with the same validation as the agent page', async (url) => {
      const f = await settingsV2Fixture({ directories }), app = await f.appFor(f.manager);
      await expect(app.enrollMcp!(f.manager, enroll('alpha', url))).rejects.toMatchObject({ code: 'mcp_url_unsupported' });
    });

  it('a flow started on the agent bot page cannot be claimed from the main app', async () => {
    const f = await settingsV2Fixture({ directories });
    const bot = await f.botActor('alpha'), botApp = await f.appFor(bot), app = await f.appFor(f.manager);
    const connection = (await botApp.enrollMcp!(bot, enroll('alpha'))).connections[0];
    const setup = await botApp.beginSetup(bot, 'personal', connection.id);
    await f.mcp.callback({ state: new URL(setup.authorizationUrl!).searchParams.get('state'), code: 'SYNTHETIC_CODE', iss: 'https://auth.fixture.net/' });
    const preview = await botApp.previewMcpSetup!(bot, 'personal', setup.flowId);
    await expect(app.previewMcpSetup!(f.manager, 'personal', setup.flowId)).rejects.toMatchObject({ code: 'mcp_binding_changed' });
    await expect(app.claimMcpSetup!(f.manager, 'personal', setup.flowId, preview.catalog.catalogDigest)).rejects.toMatchObject({ code: 'mcp_binding_changed' });
    expect((await botApp.service.list(bot, { space: 'personal' })).connections[0].lifecycle).toBe('pending');
  });

  it('resume from the main app works only for an agent the person can use', async () => {
    const f = await settingsV2Fixture({ directories }), app = await f.appFor(f.manager);
    const pending = (await app.enrollMcp!(f.manager, enroll('alpha'))).connections[0];
    const setup = await app.beginSetup(f.manager, 'personal', pending.id);
    expect(setup).toMatchObject({ kind: 'remote_mcp', status: 'pending' });
    f.state.agents.find(a => a.id === 'alpha')!.blocked = [123];
    await expect(app.beginSetup(f.manager, 'personal', pending.id)).rejects.toBeTruthy();
  });
});
