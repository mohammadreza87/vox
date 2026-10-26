import { describe, expect, it, vi } from 'vitest';
import type { Studio } from '../../studio/service';
import type { StudioState } from '../../studio/types';
import { signInitData } from '../../studio/auth';
import { agentInit, TEST_INITDATA_KEY_HEX } from '../../studio/__tests__/initdata-keys';
import { generateKeyPairSync } from 'crypto';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { authenticateAgentConnections } from '../bot-principal';
import { createStudioConnectionAuthority } from '../authority';
import { handleAgentConnectionsRequest } from '../http';
import { createStudioConnectionsApplication } from '../studio-application';
import { connectionsConfigurationSchema } from '../config';
import { InMemoryConnectionsStorage } from '../storage';
import type { ConnectionActor } from '../contracts';

const publicOrigin = 'https://vox.example.invalid';
const tokens = { alpha: '111:SYNTHETIC_ALPHA', beta: '222:SYNTHETIC_BETA', rotated: '111:SYNTHETIC_ROTATED' };
async function fixture(confirmed = true) {
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()));
  if (confirmed) await adaptive.confirm(123, { confirm: true });
  const state = { members: [], agents: ['alpha', 'beta'].map((id, i) => ({ id, status: 'active', visibility: 'public', createdBy: 999,
    tokenEnc: id, bot: { id: 100 + i, username: `synthetic_${id}_bot` }, access: [], persona: { name: id } })), groups: [], audit: [] } as unknown as StudioState;
  const ensureMember = vi.fn();
  const botToken = vi.fn((agent: { tokenEnc?: string }) => tokens[agent.tokenEnc as keyof typeof tokens] ?? null);
  const studio = { ensureMember, botToken, deps: { adaptive, initDataKey: TEST_INITDATA_KEY_HEX, webAppUrl: `${publicOrigin}/studio`, store: { read: async () => structuredClone(state), readCommittedForEffect: () => structuredClone(state) },
    chatLLM: { identity: { provider: 'anthropic', model: 'fixture' } } } } as unknown as Studio;
  const config = connectionsConfigurationSchema.parse({ schemaVersion: 1, enabled: true, profiles: ['alpha', 'beta'].map(agentId => ({
    accountId: 'telegram-account:123', space: 'personal', agentId, providerId: 'github', providerSubject: `subject-${agentId}`,
    providerTenantId: `tenant-${agentId}`, endpointProfileId: 'github-api', setup: 'operator', qualified: true, evidenceReference: 'synthetic-only',
    resources: [{ id: `github:repo:synthetic/${agentId}`, label: `PRIVATE_${agentId}`, toolIds: ['github.repository.get'] }] })) });
  const storage = new InMemoryConnectionsStorage();
  const broker = { begin: vi.fn(), claim: vi.fn(), cancel: vi.fn(), execute: vi.fn(), revoke: vi.fn() };
  const factory = vi.fn((actor: ConnectionActor, space: 'personal' | 'work') => createStudioConnectionsApplication(studio, actor, space, {
    storage, configuration: async () => structuredClone(config), broker,
  }));
  const botIds: Record<string, number> = { alpha: 100, beta: 101 };
  const request = (agentId = 'alpha', action = '', body?: unknown, token: string = tokens.alpha) => new Request(
    `http://127.0.0.1:3000/api/agents/${agentId}/connections/${action}?space=personal`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'x-telegram-init-data': agentInit({ id: 123, first_name: 'Synthetic' }, token, undefined, {}, botIds[agentId] ?? 100),
        origin: publicOrigin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const send = (agentId = 'alpha', path: string[] = [], body?: unknown, token: string = tokens.alpha) =>
    handleAgentConnectionsRequest(studio, factory, request(agentId, path.join('/'), body, token), agentId, path);
  return { state, studio, factory, ensureMember, botToken, adaptive, storage, broker, request, send };
}

describe('agent-bot principal and own-account Connections surface', () => {
  it('admits a confirmed public-bot person without creating or requiring company membership', async () => {
    const f = await fixture();
    const res = await f.send(); expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agent: { id: 'alpha', name: 'alpha' }, manageInVox: true });
    expect(f.state.members).toEqual([]); expect(f.ensureMember).not.toHaveBeenCalled();
    expect(f.botToken).toHaveBeenCalledTimes(1); expect(f.botToken.mock.calls[0][0]).toMatchObject({ id: 'alpha' });
  });
  it('rejects a different bot signature and never searches other bot tokens or uses a manager fallback', async () => {
    const f = await fixture();
    expect((await f.send('beta')).status).toBe(401);
    expect(f.botToken).toHaveBeenCalledTimes(1); expect(f.botToken.mock.calls[0][0]).toMatchObject({ id: 'beta' });
    expect((await f.send('alpha', [], undefined, '999:SYNTHETIC_MANAGER')).status).toBe(401);
    expect(f.ensureMember).not.toHaveBeenCalled();
  });
  it.each(['private', 'org'])('does not turn a nonmember into a permitted %s agent user', async visibility => {
    const f = await fixture(); f.state.agents[0].visibility = visibility as 'private' | 'org';
    expect((await f.send()).status).toBe(403); expect(f.ensureMember).not.toHaveBeenCalled();
  });
  it('never confirms an identity on the agent-bot surface (its token holder could harvest the initData): 404, no binding', async () => {
    const f = await fixture(false);
    const confirmSpy = vi.spyOn(f.adaptive, 'confirm');
    // the GET is a content-free handoff: it does not even say whether a profile is confirmed
    expect(await (await f.send()).json()).toEqual({ agent: { id: 'alpha', name: 'alpha' }, manageInVox: true });
    const confirm = await f.send('alpha', ['profile', 'confirm'], { confirm: true });
    expect(confirm.status).toBe(404); expect(await confirm.json()).toEqual({ error: 'not_found' });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(f.factory).not.toHaveBeenCalled(); expect(f.ensureMember).not.toHaveBeenCalled();
    const document = await f.adaptive.repository.transaction('telegram-account:123', Date.now(), d => d);
    expect(document.binding).toBeUndefined();
  });
  it.each([
    ['profile/confirm', { confirm: true }], ['enroll', { space: 'personal', providerId: 'github', displayLabel: 'X' }], ['grants', { space: 'personal' }],
    ['revoke', { space: 'personal' }], ['tasks', { space: 'personal' }], ['setup', { space: 'personal' }], ['setup/claim', { space: 'personal' }],
    ['setup/cancel', { space: 'personal' }], ['mcp/enroll', { space: 'personal' }], ['mcp/setup/preview', { space: 'personal' }],
    ['mcp/setup/claim', { space: 'personal' }], ['mcp/setup/cancel', { space: 'personal' }], ['actions/approve', { space: 'personal' }],
    ['actions/cancel', { space: 'personal' }], ['actions/execute', { space: 'personal' }], ['resources/select', { space: 'personal' }],
    ['workflows/create', { space: 'personal' }], ['resources/connection-1', undefined], ['review/op-1', undefined], ['workflows', undefined],
  ])('closes %s on the bot surface even with a valid Telegram signature, before building the app', async (action, body) => {
    const f = await fixture();
    const confirmSpy = vi.spyOn(f.adaptive, 'confirm');
    const res = await f.send('alpha', action.split('/'), body);
    expect(res.status).toBe(404);
    expect(f.factory).not.toHaveBeenCalled(); expect(f.botToken).not.toHaveBeenCalled(); expect(confirmSpy).not.toHaveBeenCalled();
    expect(f.broker.begin).not.toHaveBeenCalled(); expect(f.broker.execute).not.toHaveBeenCalled(); expect(f.broker.revoke).not.toHaveBeenCalled();
  });
  it("keeps the read-only dashboard, which needs Telegram's signature: forged or missing is 401", async () => {
    const f = await fixture();
    expect((await f.send()).status).toBe(200);
    const send = (init: string) => handleAgentConnectionsRequest(f.studio, f.factory, new Request('http://127.0.0.1:3000/api/agents/alpha/connections?space=personal',
      { headers: { 'x-telegram-init-data': init } }), 'alpha', []);
    const who = { id: 123, first_name: 'Synthetic' };
    expect((await send(signInitData(who, tokens.alpha))).status).toBe(401);
    expect((await send(signInitData(who, tokens.alpha, undefined, {}, { botId: 100, privateKey: generateKeyPairSync('ed25519').privateKey }))).status).toBe(401);
    expect((await send(agentInit(who, tokens.alpha, undefined, {}, 101))).status).toBe(401);
    // the emergency shadow switch never relaxes connections
    (f.studio.deps as { initDataSignature?: () => 'shadow' }).initDataSignature = () => 'shadow';
    expect((await send(signInitData(who, tokens.alpha))).status).toBe(401);
  });
  it('ignores forged principal headers and rejects supplied cross-agent binding before enrollment', async () => {
    const f = await fixture();
    const req = f.request(); req.headers.set('x-vox-bot-agent', 'beta');
    expect((await authenticateAgentConnections(f.studio, req, 'alpha')).actor).toMatchObject({ botAgentId: 'alpha' });
    // enrollment is closed on the bot surface altogether (agent-signed trust hotfix)
    expect((await f.send('alpha', ['enroll'], { space: 'personal', providerId: 'github', displayLabel: 'Synthetic', agentId: 'beta' })).status).toBe(404);
    expect((await f.send('alpha', ['enroll'], { space: 'personal', providerId: 'github', displayLabel: 'Synthetic' })).status).toBe(404);
    expect(f.broker.begin).not.toHaveBeenCalled();
  });
  it('filters lists and fences every stored connection ID to the verified bot, even for the same owner', async () => {
    const f = await fixture();
    const alphaActor = (await authenticateAgentConnections(f.studio, f.request(), 'alpha')).actor;
    const betaActor = (await authenticateAgentConnections(f.studio, f.request('beta', '', undefined, tokens.beta), 'beta')).actor;
    const alpha = await f.factory(alphaActor, 'personal'), beta = await f.factory(betaActor, 'personal');
    const a = (await alpha.enroll!(alphaActor, { space: 'personal', providerId: 'github', displayLabel: 'ALPHA_ONLY', agentId: 'alpha' })).connections[0];
    const b = (await beta.enroll!(betaActor, { space: 'personal', providerId: 'github', displayLabel: 'BETA_PRIVATE_CANARY', agentId: 'beta' })).connections[0];
    expect((await alpha.service.list(alphaActor, { space: 'personal' })).connections.map(c => c.id)).toEqual([a.id]);
    // decision 8: the agent-signed GET discloses none of the person's connections, not even this bot's own
    f.factory.mockClear();
    const list = JSON.stringify(await (await f.send()).json());
    for (const leak of ['BETA_PRIVATE_CANARY', 'ALPHA_ONLY', 'github', a.id, 'connections', 'grants', 'operations']) expect(list).not.toContain(leak);
    expect(f.factory).not.toHaveBeenCalled();
    for (const action of ['setup', 'revoke']) {
      const res = await f.send('alpha', [action], { space: 'personal', connectionId: b.id, ...(action === 'revoke' ? { expectedRevision: b.revision } : {}) });
      expect(res.status).toBe(404);
    }
    expect((await f.send('alpha', ['resources', b.id])).status).toBe(404);
    expect(f.broker.begin).not.toHaveBeenCalled(); expect(f.broker.revoke).not.toHaveBeenCalled();
    await expect(alpha.service.completeEnrollment(alphaActor, { space: 'personal', connectionId: b.id, expectedRevision: b.revision,
      issuer: 'https://github.com', providerSubject: 'synthetic', providerTenantId: 'synthetic', providerScopes: [], displayLabel: 'Synthetic' })).rejects.toMatchObject({ code: 'connection_unavailable' });
  });
  it('rechecks current block, fired state, token rotation and person expiry at authority boundaries', async () => {
    const f = await fixture(); const principal = (await authenticateAgentConnections(f.studio, f.request(), 'alpha')).actor;
    const resolve = createStudioConnectionAuthority(f.studio);
    expect((await resolve(principal, 'personal')).currentAgentIds).toEqual(['alpha']);
    f.state.agents[0].blocked = [123]; await expect(resolve(principal, 'personal')).rejects.toMatchObject({ code: 'agent_unavailable' });
    f.state.agents[0].blocked = []; f.state.agents[0].tokenEnc = 'rotated';
    await expect(resolve(principal, 'personal')).rejects.toMatchObject({ code: 'agent_unavailable' });
    expect((await f.send()).status).toBe(401);
    f.state.agents[0].tokenEnc = 'alpha'; f.state.agents[0].status = 'fired';
    await expect(resolve(principal, 'personal')).rejects.toMatchObject({ code: 'agent_unavailable' });
    f.state.agents[0].status = 'active';
    await f.adaptive.repository.transaction('telegram-account:123', Date.now(), d => { d.binding!.expiresAt = Date.now() - 1; });
    await expect(resolve(principal, 'personal')).rejects.toMatchObject({ code: 'profile_confirmation_required' });
  });
});
