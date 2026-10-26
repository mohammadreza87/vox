/**
 * Settings v2 Part 2, manager pages: "Connectors people use" (counts only) and "Change history" (scrubbed), both
 * 404 with the flag off and 403 for anyone who may use the agent but not manage it. Plus the setAccess audit row,
 * which is written whatever the flag.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { scrubHistory } from '../history';
import { emptyRecords, FileConnectionsStorage } from '../../connections/storage';
import { partitionIdFor } from '../../connections/repository';
import type { ConnectionsRecords } from '../../connections/contracts';
import { connectionUsageFor } from '../../connections/runtime';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const BOT_TOKEN = '555:fixture-manager-token';
let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let agentId: string;
const directories: string[] = [];

const publicHistorySchema = z.object({ history: z.array(z.object({
  at: z.string().datetime(), actor: z.enum(['you', 'creator', 'admin', 'member', 'agent', 'vox']),
  action: z.enum(['draft', 'hired', 'token', 'skills', 'voice', 'live-web', 'main-mini-app', 'group-behavior',
    'visibility', 'access', 'unblock', 'admin-grant', 'admin-revoke', 'fired', 'memory-inherit', 'channel-post']),
  detail: z.string().optional(),
}).strict()) }).strict();
function expectPublicHistory(value: unknown) {
  const { history } = publicHistorySchema.parse(value);
  for (const row of history) expect(new Date(row.at).toISOString()).toBe(row.at);
  // Identifiers can coincide with digits in a valid timestamp. Every other
  // field stays in the strict public projection and is checked for leaks.
  const projection = JSON.stringify(history.map(row => {
    const fields: Record<string, unknown> = { ...row }; delete fields.at; return fields;
  }));
  for (const leak of ['SECRET', '424242', String(ID.bob), String(ID.admin), String(ID.alice), String(ID.stranger),
    'Bob', 'another-agent', 'agent.block', 'agent_boundary']) expect(projection).not.toContain(leak);
}

beforeEach(async () => {
  vi.stubEnv('STUDIO_SETTINGS_V2', '1');
  h = makeStudio();
  org = await seedOrg(h);
  agentId = (await hire(h, org.alice, { name: 'Nova' })).agent.id; // org-visible: Bob may use it, not manage it
});
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function get(path: string, as: number) {
  const req = new Request(`http://localhost/api/studio/${path}`, { headers: { 'x-telegram-init-data': signInitData({ id: as, first_name: `U${as}` }, BOT_TOKEN) } });
  const res = await handleStudioRequest(h.studio, req, path.split('/'), { botToken: BOT_TOKEN, devUser: null });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

/** Extra synthetic members so an org agent's audience is large enough for counts to show at all. */
async function moreMembers(n: number) {
  const sa = await memberOfId(ID.superadmin);
  for (let i = 1; i <= n; i++) { await h.studio.ensureMember({ id: 600 + i, first_name: `Extra${i}` }); await h.studio.setRole(sa, 600 + i, 'member'); }
}
async function memberOfId(id: number) { return (await h.store.read()).members.find((m) => m.telegramId === id)!; }

/** A schema-valid synthetic live connection row for one person and provider on `agent`. */
function liveRow(person: number, providerId: string, agent: string) {
  const accountId = `telegram-account:${person}`, partitionId = partitionIdFor(accountId, 'personal');
  return { partitionId, row: { schemaVersion: 2, id: `conn-${person}-${providerId}`, partitionId, revision: 1, createdAt: 1, updatedAt: 1, retentionUntil: 9e12, ownerAccountId: accountId, ownerPersonId: `person-${person}`,
    scope: { tenantId: `tenant-${person}`, spaceId: `space-${person}`, spaceKind: 'personal', containerId: `container-${person}`, audiencePersonIds: [`person-${person}`], audienceRevision: `rev-${person}` },
    providerId, displayLabel: `PRIVATE_LABEL_${person}`, providerAccountId: null, adapterId: providerId, adapterVersion: '1', catalogDigest: 'd', endpointProfileId: 'p',
    providerScopes: [], lifecycle: 'connected', revocationEpoch: 0, health: 'healthy', checkedAt: null, agentId: agent,
    ...(providerId === 'remote_mcp' ? { mcp: { canonicalResourceUri: `https://private-${person}.fixture.net/mcp`, catalog: null } } : {}) } };
}
async function fileWorld(rows: Array<ReturnType<typeof liveRow>>) {
  const dir = await mkdtemp(join(tmpdir(), 'vox-usage-e2e-')); directories.push(dir);
  vi.stubEnv('STUDIO_DATA_DIR', dir); vi.stubEnv('STUDIO_STORAGE', 'file');
  vi.stubEnv('STUDIO_CONNECTIONS_BROKER_URL', ''); vi.stubEnv('STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', '');
  const storage = new FileConnectionsStorage(join(dir, 'connections'));
  const byPartition = new Map<string, unknown[]>();
  for (const { partitionId, row } of rows) byPartition.set(partitionId, [...byPartition.get(partitionId) ?? [], row]);
  for (const [partitionId, connections] of byPartition) await storage.transact(partitionId, () => ({ records: { ...emptyRecords(), connections } as unknown as ConnectionsRecords, result: undefined }));
  h.studio.deps.connectionUsage = (id, viewer) => connectionUsageFor(h.studio, id, viewer);
}
const LEAKS = ['telegram-account', 'person-', 'PRIVATE_LABEL', 'private-', 'fixture.net', 'createdAt', 'conn-', 'tenant-'];

describe('Connectors people use (counts only)', () => {
  it('managers get per-provider counts; a member who can use the agent gets 403; flag off is 404', async () => {
    await moreMembers(5); // Alice's org agent: 8 other people may use it
    const usage = vi.fn(async () => ({ providers: [{ id: 'gmail', name: 'Gmail', people: 4 }, { id: 'remote_mcp', name: 'Custom MCP servers', people: 1 }, { id: 'slack', name: 'Slack', people: 0 }, { id: 'notion', name: 'Notion', people: 8 }] }));
    h.studio.deps.connectionUsage = usage;
    // 1 (could be anyone) and 8 (everyone else) never show: only counts that single no one out.
    expect(await get(`agents/${agentId}/connector-usage`, ID.alice)).toEqual({ status: 200, json: { providers: [{ id: 'gmail', name: 'Gmail', people: 4 }] } });
    expect(usage).toHaveBeenCalledWith(agentId, ID.alice);
    expect((await get(`agents/${agentId}/connector-usage`, ID.admin)).status).toBe(200);
    expect((await get(`agents/${agentId}/connector-usage`, ID.bob)).status).toBe(403);
    expect((await get(`agents/missing/connector-usage`, ID.alice)).status).toBe(404);
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    expect((await get(`agents/${agentId}/connector-usage`, ID.alice)).status).toBe(404);
  });

  it('a failing counter says unavailable instead of failing the page', async () => {
    h.studio.deps.connectionUsage = vi.fn(async () => { throw new Error('storage down'); });
    expect(await get(`agents/${agentId}/connector-usage`, ID.alice)).toEqual({ status: 200, json: { providers: [], unavailable: true } });
  });

  it('one person: a private agent shared with just Bob shows nothing about Bob\'s connections', async () => {
    await h.studio.setVisibility(org.alice, agentId, 'private');
    await h.studio.setAccess(org.alice, agentId, [ID.bob]);
    await fileWorld([liveRow(ID.bob, 'gmail', agentId), liveRow(ID.bob, 'remote_mcp', agentId)]);
    const res = await get(`agents/${agentId}/connector-usage`, ID.alice);
    expect(res).toEqual({ status: 200, json: { providers: [], chosenAudience: true } });
    for (const leak of [...LEAKS, String(ID.bob)]) expect(JSON.stringify(res.json)).not.toContain(leak);
  });

  it('a hand-picked audience shows no counts: sybils on the list cannot single out the one real person', async () => {
    await moreMembers(3);
    const [sybil1, sybil2, filler] = [601, 602, 603];
    // The manager picks Bob plus accounts they control; two of those connect Gmail, and so does Bob.
    await h.studio.setVisibility(org.alice, agentId, 'private');
    await h.studio.setAccess(org.alice, agentId, [ID.bob, sybil1, sybil2, filler]);
    const counter = vi.fn((id: string, viewer: number) => connectionUsageFor(h.studio, id, viewer));
    await fileWorld([liveRow(sybil1, 'gmail', agentId), liveRow(sybil2, 'gmail', agentId), liveRow(ID.bob, 'gmail', agentId)]);
    h.studio.deps.connectionUsage = counter;
    expect(await get(`agents/${agentId}/connector-usage`, ID.alice)).toEqual({ status: 200, json: { providers: [], chosenAudience: true } });
    expect(counter).not.toHaveBeenCalled();
    // the source refuses on its own too, so no other caller can skip the rule
    expect(await connectionUsageFor(h.studio, agentId, ID.alice)).toEqual({ providers: [] });
  });

  it('end to end from file storage: the viewer is never counted, small counts and "everyone else" stay hidden, nothing identifies anyone', async () => {
    await moreMembers(5);
    const others = [ID.bob, 601, 602, 603];
    await fileWorld([
      ...others.map((p) => liveRow(p, 'remote_mcp', agentId)), // 4 of 8 others
      liveRow(ID.alice, 'remote_mcp', agentId), liveRow(ID.alice, 'github', agentId), // the viewer's own: never counted
      liveRow(601, 'github', agentId), liveRow(602, 'github', agentId), // 2: too few
    ]);
    const res = await get(`agents/${agentId}/connector-usage`, ID.alice);
    expect(res).toEqual({ status: 200, json: { providers: [{ id: 'remote_mcp', name: 'Custom MCP servers', people: 4 }] } });
    const json = JSON.stringify(res.json);
    for (const leak of [...LEAKS, ...others.map(String), String(ID.alice)]) expect(json).not.toContain(leak);
  });
});

describe('Change history', () => {
  it('managers read this agent\'s rows newest first, scrubbed to roles and a fixed vocabulary; members 403; flag off 404', async () => {
    await h.studio.setVisibility(org.alice, agentId, 'private');
    await h.studio.setAccess(org.admin, agentId, [ID.bob]);
    await h.studio.setLiveWeb(org.alice, agentId, false);
    await h.studio.setGroupBehavior(org.alice, agentId, { participation: 'active', remember: false });
    await h.store.audit({ actor: ID.admin, action: 'agent.unblock', target: agentId, detail: '424242' });
    await h.store.audit({ actor: 'system', action: 'memory.inherit', target: agentId, detail: 'copied 3, skipped SECRET' });
    await h.store.audit({ actor: ID.bob, action: 'agent.group-behavior', target: agentId, detail: '{"participation":"evil","SECRET":1}' });
    await h.store.audit({ actor: ID.admin, action: 'agent.fired', target: agentId, detail: 'archive: SECRET_REASON about Bob' });
    await h.store.audit({ actor: ID.admin, action: 'agent.something-new', target: agentId, detail: 'SECRET_NEW' });
    await h.store.audit({ actor: ID.admin, action: 'agent.visibility', target: 'another-agent', detail: 'public' });
    await h.store.audit({ actor: agentId, action: 'agent.block', target: String(ID.stranger), detail: 'agent_boundary' });

    // Reproduce the former false positive deterministically: a valid timestamp
    // may contain the synthetic stranger id without identifying that person.
    await h.store.update(state => {
      state.audit.forEach((row, index) => { row.at = new Date(Date.UTC(2026, 9, 26, 13, 0, index, 999)).toISOString(); });
    });

    const res = await get(`agents/${agentId}/history`, ID.alice);
    expect(res.status).toBe(200);
    const history = res.json.history as Array<{ at: string; actor: string; action: string; detail?: string }>;
    expect(history.slice(0, 7)).toEqual([
      expect.objectContaining({ actor: 'admin', action: 'fired', detail: 'archive' }),
      expect.objectContaining({ actor: 'member', action: 'group-behavior' }),
      expect.objectContaining({ actor: 'vox', action: 'memory-inherit' }),
      expect.objectContaining({ actor: 'admin', action: 'unblock' }),
      expect.objectContaining({ actor: 'you', action: 'group-behavior', detail: 'active:forget' }),
      expect.objectContaining({ actor: 'you', action: 'live-web', detail: 'off' }),
      expect.objectContaining({ actor: 'admin', action: 'access', detail: 'people:1' }),
    ]);
    expect(history.find(r => r.action === 'unblock')).not.toHaveProperty('detail');
    expect(history.filter(r => r.action === 'group-behavior')[0]).not.toHaveProperty('detail');
    expect(history.every(r => [...history].sort((a, b) => b.at.localeCompare(a.at)).indexOf(r) === history.indexOf(r))).toBe(true);
    expect(history.every((row, index) => index === 0 || history[index - 1].at > row.at)).toBe(true);
    expect(JSON.stringify(res.json)).toContain('.999Z');
    expectPublicHistory(res.json);

    expect((await get(`agents/${agentId}/history`, ID.admin)).json.history).toEqual(expect.arrayContaining([expect.objectContaining({ actor: 'creator', action: 'live-web' })]));
    expect((await get(`agents/${agentId}/history`, ID.bob)).status).toBe(403);
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    expect((await get(`agents/${agentId}/history`, ID.alice)).status).toBe(404);
  });

  it('privacy assertions reject identity leaks and additional fields while allowing validated timestamp digits', () => {
    const row = { at: '2026-10-26T13:00:00.999Z', actor: 'admin', action: 'unblock' };
    expectPublicHistory({ history: [row] });
    for (const leaked of [
      { ...row, actor: String(ID.stranger) }, { ...row, detail: String(ID.stranger) },
      { ...row, detail: 'SECRET about Bob' }, { ...row, telegramId: ID.stranger },
      { ...row, person: { id: ID.stranger } }, { ...row, at: '999' },
    ]) expect(() => expectPublicHistory({ history: [leaked] })).toThrow();
    expect(() => expectPublicHistory({ history: [row], accountId: String(ID.stranger) })).toThrow();
  });

  it('caps the answer and keeps only the newest rows', () => {
    const agent = { id: 'a1', createdBy: 1 } as Parameters<typeof scrubHistory>[1]['agent'];
    const rows = Array.from({ length: 300 }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), actor: 1, action: 'agent.live-web', target: 'a1', detail: i % 2 ? 'on' : 'off' }));
    expect(scrubHistory(rows, { viewerId: 1, agent, members: [] })).toHaveLength(50);
    const max = scrubHistory(rows, { viewerId: 1, agent, members: [], limit: 1000 });
    expect(max).toHaveLength(100);
    expect(max[0].at).toBe(rows[299].at);
  });

  it('setAccess writes a content-free audit row whatever the flag', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    await h.studio.setAccess(org.alice, agentId, [ID.bob, ID.admin]);
    await h.studio.setAccess(org.alice, agentId, 'everyone');
    const rows = (await h.store.read()).audit.filter(r => r.action === 'agent.access');
    expect(rows.map(r => ({ actor: r.actor, target: r.target, detail: r.detail }))).toEqual([
      { actor: ID.alice, target: agentId, detail: 'people:2' },
      { actor: ID.alice, target: agentId, detail: 'everyone' },
    ]);
  });
});
