import { webcrypto } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../../studio/auth';
import type { Studio } from '../../studio/service';
import type { ReceiptInput } from '../../studio/receipts';
import { handleConnectionsRequest } from '../http';
import { RESOURCE, settingsV2Fixture } from './settings-v2-fixture';

/**
 * The Connections HTTP surface with Settings v2: the main app adds a custom MCP server end to end, and each
 * recorded change (server added, access allowed, access ended, server removed) leaves the person exactly one
 * quiet record, content-light, in their language. Flag off: no record and no extra read.
 */
const directories: string[] = [];
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('CryptoKey', webcrypto.CryptoKey); vi.stubEnv('STUDIO_SETTINGS_V2', '1'); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const MANAGER_TOKEN = '777:synthetic-manager';
const ORIGIN = 'https://vox.fixture.net';

async function setup() {
  const f = await settingsV2Fixture({ directories });
  const sentReceipts: ReceiptInput[] = [];
  const pending: Promise<unknown>[] = [];
  const studio = f.studio as Studio & { ensureMember: unknown; receipts: unknown };
  Object.assign(studio, {
    ensureMember: async (u: { id: number }) => f.state.members.find(m => m.telegramId === u.id),
    receipts: { track: (p: Promise<unknown>) => { pending.push(p.catch(() => undefined)); }, send: async (r: ReceiptInput) => { sentReceipts.push(r); return 'sent'; } },
  });
  (studio.deps as { webAppUrl?: string }).webAppUrl = `${ORIGIN}/studio`;
  const call = async (path: string, body?: Record<string, unknown>) => {
    const init = signInitData({ id: 123, first_name: 'Synthetic', language_code: 'fa' }, MANAGER_TOKEN);
    const req = new Request(`${ORIGIN}/api/studio/connections/${path}${body ? '' : '?space=personal&agentId=alpha'}`, { method: body ? 'POST' : 'GET',
      headers: { 'x-telegram-init-data': init, ...(body ? { origin: ORIGIN, 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify({ space: 'personal', ...body }) } : {}) });
    const res = await handleConnectionsRequest(studio, actor => f.appFor(actor), req, path ? path.split('/') : [], MANAGER_TOKEN);
    await Promise.all(pending.splice(0));
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };
  return { f, call, sentReceipts };
}

describe('main-app Connections over HTTP (Settings v2)', () => {
  it('adds a custom MCP server end to end and leaves one quiet record per change, host only, in Persian', async () => {
    const { f, call, sentReceipts } = await setup();
    const enrolled = await call('mcp/enroll', { agentId: 'alpha', endpointUrl: RESOURCE, displayLabel: 'My private server' });
    expect(enrolled.status).toBe(201);
    const connectionId = (enrolled.json.connections as Array<{ id: string }>)[0].id;
    const setupRes = await call('setup', { connectionId });
    expect(setupRes.json).toMatchObject({ kind: 'remote_mcp', status: 'pending' });
    await f.mcp.callback({ state: new URL(setupRes.json.authorizationUrl as string).searchParams.get('state'), code: 'SYNTHETIC_CODE', iss: 'https://auth.fixture.net/' });
    const preview = await call('mcp/setup/preview', { flowId: setupRes.json.flowId });
    expect(preview.status).toBe(200);
    expect(sentReceipts).toEqual([]);
    const claimed = await call('mcp/setup/claim', { flowId: setupRes.json.flowId, acceptedCatalogDigest: (preview.json.catalog as { catalogDigest: string }).catalogDigest });
    expect(claimed.json).toMatchObject({ status: 'connected' });
    expect(sentReceipts).toEqual([{ agentId: 'alpha', kind: 'mcp_added', host: 'mcp.fixture.net', telegramId: 123, locale: 'fa' }]);

    const dashboard = await call('');
    const connection = (dashboard.json.connections as Array<{ id: string; revision: number }>)[0];
    const resources = await call(`resources/${connectionId}`);
    const r = (resources.json.resources as Array<{ id: string; toolIds: string[]; destinationIds: string[] }>)[0];
    const granted = await call('grants', { agentId: 'alpha', connectionId, expectedRevision: connection.revision, toolIds: r.toolIds, resourceIds: [r.id],
      destinationIds: r.destinationIds, effects: ['privileged'], expiresAt: Date.now() + 8 * 3_600_000, maxCalls: 10, maxBytes: 128_000 });
    expect(granted.status).toBe(200);
    expect(sentReceipts.at(-1)).toEqual({ agentId: 'alpha', kind: 'access', host: 'mcp.fixture.net', hours: 8, telegramId: 123, locale: 'fa' });
    const grant = (granted.json.grants as Array<{ id: string; revision: number }>)[0];
    await call('revoke', { connectionId, expectedRevision: connection.revision, grantId: grant.id, expectedGrantRevision: grant.revision });
    expect(sentReceipts.at(-1)).toMatchObject({ kind: 'access_ended', host: 'mcp.fixture.net' });
    await call('revoke', { connectionId, expectedRevision: connection.revision });
    expect(sentReceipts.at(-1)).toMatchObject({ kind: 'mcp_removed', host: 'mcp.fixture.net' });
    expect(sentReceipts).toHaveLength(4);
    expect(JSON.stringify(sentReceipts)).not.toMatch(/My private server|personal\/mcp|telegram-account/);
  });

  it('flag off: the main app cannot add a server, and nothing is recorded', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    const { call, sentReceipts } = await setup();
    const enrolled = await call('mcp/enroll', { agentId: 'alpha', endpointUrl: RESOURCE, displayLabel: 'x' });
    expect(enrolled).toEqual({ status: 403, json: { error: 'mcp_open_agent_bot' } });
    const dashboard = await call('');
    expect(dashboard.status).toBe(200);
    expect(dashboard.json).not.toHaveProperty('mcp');
    expect((dashboard.json.providers as Array<Record<string, unknown>>).every(p => !('state' in p))).toBe(true);
    expect(sentReceipts).toEqual([]);
  });

  it('flag on: every catalog provider says what is missing for this person, without secrets', async () => {
    const { call } = await setup();
    const dashboard = await call('');
    const providers = dashboard.json.providers as Array<{ id: string; state: { status: string; how: string; needs: string[] } }>;
    expect(providers.length).toBeGreaterThan(10);
    expect(providers.find(p => p.id === 'gmail')!.state).toEqual({ status: 'needs_vox', how: 'sign_in', needs: ['not_set_up_for_you'] });
    expect(providers.find(p => p.id === 'notion')!.state).toMatchObject({ status: 'needs_vox', how: 'vox_adds' });
    expect(providers.find(p => p.id === 'browser')!.state).toMatchObject({ how: 'runner' });
    expect(dashboard.json.mcp).toEqual({ available: true, needs: [] });
    expect(JSON.stringify(dashboard.json)).not.toMatch(/STUDIO_|\.json|SYNTHETIC_CLIENT|clientSecret/);
  });

  it('a set-up operator-token or runner app is never offered as Connect: only a Vox operator can finish it', async () => {
    const { f } = await setup();
    const profile = (providerId: string, setupKind: 'oauth' | 'operator') => ({ accountId: 'telegram-account:123', space: 'personal' as const, agentId: 'alpha', providerId,
      providerSubject: 'synthetic-subject', providerTenantId: 'synthetic-tenant', endpointProfileId: 'synthetic-endpoint', setup: setupKind, qualified: true,
      evidenceReference: 'synthetic-only', dailyModelTokenCeiling: 0, dailyToolCallCeiling: 0, resources: [] });
    f.config.profiles.push(profile('github', 'oauth'), profile('notion', 'operator'), profile('browser', 'operator'));
    const app = await f.appFor({ accountId: 'telegram-account:123' });
    const providers = (await app.dashboard({ accountId: 'telegram-account:123' }, 'personal', 'alpha')).providers;
    expect(providers.find(p => p.id === 'github')!.state).toEqual({ status: 'available', how: 'sign_in', needs: [] });
    expect(providers.find(p => p.id === 'notion')!.state).toEqual({ status: 'needs_vox', how: 'vox_adds', needs: ['vox_enrolls'] });
    expect(providers.find(p => p.id === 'browser')!.state).toEqual({ status: 'needs_vox', how: 'runner', needs: ['vox_enrolls'] });
  });
});
