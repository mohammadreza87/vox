/**
 * The production shape (connections not configured: no STUDIO_CONNECTIONS_CONFIG_FILE). Before the agent-signed trust
 * hotfix, POST …/profile/confirm on this surface reached adaptive.confirm and minted a 12 h identity binding for any
 * Telegram id an agent's token holder named, even though the response itself was a 403 (verified on 7371086).
 */
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAgentConnectionsRequest } from '../http';
import { getConnectionsApplication } from '../runtime';
import { agentInit } from '../../studio/__tests__/initdata-keys';
import { hire, ID, makeStudio, seedOrg } from '../../studio/__tests__/helpers';

afterEach(() => vi.unstubAllEnvs());

describe('agent-bot connect surface with connections unconfigured (production today)', () => {
  it('profile/confirm is 404 and mints no identity binding, even with a valid Telegram signature', async () => {
    const h = makeStudio();
    vi.stubEnv('STUDIO_DATA_DIR', join(h.dir, 'data'));
    vi.stubEnv('STUDIO_CONNECTIONS_CONFIG_FILE', '');
    h.studio.deps.webAppUrl = 'https://vox.example/studio';
    const org = await seedOrg(h);
    const a = await hire(h, org.alice, { name: 'Mochi' }, undefined, 'public');
    const confirm = vi.spyOn(h.adaptive!, 'confirm');
    const factory = vi.fn((actor, space) => getConnectionsApplication(h.studio, actor, space));
    const init = agentInit({ id: ID.stranger, first_name: 'S' }, a.token);
    const res = await handleAgentConnectionsRequest(h.studio, factory, new Request(`https://vox.example/api/agents/${a.agent.id}/connections/profile/confirm?space=personal`, {
      method: 'POST', headers: { origin: 'https://vox.example', 'content-type': 'application/json', 'x-telegram-init-data': init }, body: JSON.stringify({ confirm: true }) }),
    a.agent.id, ['profile', 'confirm']);
    expect(res.status).toBe(404);
    expect(confirm).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    // the read-only dashboard still answers (here: no confirmed profile, so nothing to show)
    const dash = await handleAgentConnectionsRequest(h.studio, factory, new Request(`https://vox.example/api/agents/${a.agent.id}/connections?space=personal`,
      { headers: { 'x-telegram-init-data': init } }), a.agent.id, []);
    expect(dash.status).toBe(403);
    expect(await dash.json()).toEqual({ error: 'profile_confirmation_required' });
  });
});
