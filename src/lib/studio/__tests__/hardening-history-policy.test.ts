/**
 * S08 hardening (F019, F115): the group historyPolicy is enforced by the admin
 * re-snapshot and has an admin-only, audited setter behind TIREH_SHARING_V2.
 *
 * - 'since_membership' refuses the re-snapshot (409) with a content-free
 *   refused audit row, before any memory read or write and with no vox_audit row;
 * - 'all_authorized_history' applies as before;
 * - an absent value keeps today's behaviour (applies) until product decision (j);
 * - setGroupHistoryPolicy: 404 with the flag unset, admin only, two values only,
 *   audited; and the HTTP route round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest, type RouterOptions } from '../http';
import { groupId, personId } from '../org-bridge';
import type { StudioGroup } from '../types';
import { InMemoryAuditStore } from '../../tireh/audit';
import type { NewMemory } from '../../tireh/memory/store';
import { hire, ID, makeStudio, seedOrg, T0, type Harness } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));

const BOT_TOKEN = '555:voxx-test-token';
const opts: RouterOptions = { botToken: BOT_TOKEN, devUser: null };
const CHAT = -100778;
const CANARY = 'HISTORY_POLICY_CANARY_9c2';
const AUTH = () => [personId(ID.admin), personId(ID.alice)].sort();

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function req(method: string, path: string, as: number, body?: unknown) {
  const headers: Record<string, string> = { 'x-telegram-init-data': signInitData({ id: as, first_name: `U${as}` }, BOT_TOKEN) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`http://localhost/api/studio/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function call(h: Harness, r: Request) {
  const path = new URL(r.url).pathname.replace('/api/studio/', '').split('/').filter(Boolean);
  const res = await handleStudioRequest(h.studio, r, path, opts);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

let seq = 0;
function groupMemory(agentId: string): NewMemory {
  return {
    personaId: agentId, content: `${CANARY} fact`, topic: CANARY, type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    scope: { kind: 'group', groupId: groupId(CHAT) }, authorizedPersonIds: AUTH(),
    source: { personId: personId(ID.alice), chatKind: 'group', groupId: groupId(CHAT), at: T0, eventIds: [`hp-${++seq}`] },
  };
}

async function setup(extra: Partial<StudioGroup> = {}) {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const { agent } = await hire(h, org.alice);
  await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'Team', memberIds: [ID.alice, ID.admin, ID.bob], hasGuests: false, agentIds: [agent.id], addedAt: T0.toISOString(), ...extra }); });
  const record = await h.memory.memories.add(groupMemory(agent.id));
  return { h, org, agent, record };
}

const auditEntries = async (h: Harness, action: string) => (await h.store.read()).audit.filter((e) => e.action === action);
const policyOf = async (h: Harness) => (await h.store.read()).groups.find((g) => g.chatId === CHAT)!.historyPolicy;

describe('re-snapshot honours the group historyPolicy (TIREH_SHARING_V2=1)', () => {
  beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); vi.stubEnv('TIREH_AUDIT_LOG', '1'); });

  it("since_membership refuses with 409 and a refused audit row, before any memory read, write or vox_audit row", async () => {
    const { h, org, record } = await setup({ historyPolicy: 'since_membership' });
    const audit = new InMemoryAuditStore();
    h.studio.deps.audit = audit;
    const update = vi.spyOn(h.memory.memories, 'updateIfShareVersion');
    const list = vi.spyOn(h.memory.memories, 'listActive');
    const get = vi.spyOn(h.memory.memories, 'get');
    for (const apply of [false, true]) {
      await expect(h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, apply)).rejects.toMatchObject({
        status: 409, message: 'This group shows members only memories from after they joined. An admin can change that in the group settings.' });
    }
    expect(update).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(audit.rows).toEqual([]);
    expect(await auditEntries(h, 'memory.resnapshot')).toEqual([
      expect.objectContaining({ actor: ID.admin, target: String(CHAT), detail: `${ID.bob}:refused` }),
      expect.objectContaining({ actor: ID.admin, target: String(CHAT), detail: `${ID.bob}:refused` }),
    ]);
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual(AUTH());
    expect(JSON.stringify((await h.store.read()).audit)).not.toContain(CANARY);
  });

  it('the refusal comes after the admin check: a member gets 403 and no audit row', async () => {
    const { h, org } = await setup({ historyPolicy: 'since_membership' });
    await expect(h.studio.resnapshotGroupMemory(org.alice, CHAT, ID.bob, true)).rejects.toMatchObject({ status: 403 });
    expect(await auditEntries(h, 'memory.resnapshot')).toEqual([]);
  });

  it('all_authorized_history applies', async () => {
    const { h, org, record } = await setup({ historyPolicy: 'all_authorized_history' });
    expect(await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true)).toEqual({ count: 1, applied: true });
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual([...AUTH(), personId(ID.bob)].sort());
    expect(await auditEntries(h, 'memory.resnapshot')).toEqual([expect.objectContaining({ detail: `${ID.bob}:1` })]);
  });

  it('an absent historyPolicy keeps today\'s behaviour and applies (pending decision (j))', async () => {
    const { h, org, record } = await setup();
    expect(await policyOf(h)).toBeUndefined();
    expect(await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true)).toEqual({ count: 1, applied: true });
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toContain(personId(ID.bob));
  });
});

describe('setGroupHistoryPolicy', () => {
  it('flag unset: 404 from the method and the route, and nothing changes', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const { h, org } = await setup();
    await expect(h.studio.setGroupHistoryPolicy(org.admin, CHAT, 'all_authorized_history')).rejects.toMatchObject({ status: 404 });
    expect(await call(h, req('POST', `groups/${CHAT}/history-policy`, ID.admin, { policy: 'all_authorized_history' }))).toEqual({ status: 404, json: { error: 'Not found' } });
    expect(await policyOf(h)).toBeUndefined();
    expect(await auditEntries(h, 'group.history_policy')).toEqual([]);
  });

  describe('TIREH_SHARING_V2=1', () => {
    beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); });

    it('is admin only', async () => {
      const { h, org } = await setup();
      for (const actor of [org.alice, org.bob, org.pending]) {
        await expect(h.studio.setGroupHistoryPolicy(actor, CHAT, 'all_authorized_history')).rejects.toMatchObject({ status: 403 });
      }
      expect(await policyOf(h)).toBeUndefined();
      expect(await auditEntries(h, 'group.history_policy')).toEqual([]);
    });

    it('validates the policy and the group', async () => {
      const { h, org } = await setup();
      for (const policy of [undefined, null, '', 'everything', 'SINCE_MEMBERSHIP', 1, ['since_membership'], { policy: 'since_membership' }]) {
        await expect(h.studio.setGroupHistoryPolicy(org.admin, CHAT, policy)).rejects.toMatchObject({ status: 400 });
      }
      await expect(h.studio.setGroupHistoryPolicy(org.admin, -1, 'since_membership')).rejects.toMatchObject({ status: 404 });
      await expect(h.studio.setGroupHistoryPolicy(org.admin, Number.NaN, 'since_membership')).rejects.toMatchObject({ status: 404 });
      expect(await policyOf(h)).toBeUndefined();
      expect(await auditEntries(h, 'group.history_policy')).toEqual([]);
    });

    it('a channel is not a group', async () => {
      const { h, org } = await setup({ kind: 'channel' });
      await expect(h.studio.setGroupHistoryPolicy(org.admin, CHAT, 'all_authorized_history')).rejects.toMatchObject({ status: 404 });
    });

    it('sets the value, audits it, and the re-snapshot follows it', async () => {
      const { h, org, record } = await setup();
      expect(await h.studio.setGroupHistoryPolicy(org.admin, CHAT, 'since_membership')).toEqual({ chatId: CHAT, historyPolicy: 'since_membership' });
      expect(await policyOf(h)).toBe('since_membership');
      await expect(h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true)).rejects.toMatchObject({ status: 409 });
      expect(await h.studio.setGroupHistoryPolicy(org.superadmin, CHAT, 'all_authorized_history')).toEqual({ chatId: CHAT, historyPolicy: 'all_authorized_history' });
      expect(await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true)).toEqual({ count: 1, applied: true });
      expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toContain(personId(ID.bob));
      expect(await auditEntries(h, 'group.history_policy')).toEqual([
        expect.objectContaining({ actor: ID.admin, target: String(CHAT), detail: 'since_membership' }),
        expect.objectContaining({ actor: ID.superadmin, target: String(CHAT), detail: 'all_authorized_history' }),
      ]);
    });

    it('HTTP round trip: POST groups/:chatId/history-policy, then the resnapshot route follows it', async () => {
      const { h } = await setup();
      const post = (as: number, body: unknown) => call(h, req('POST', `groups/${CHAT}/history-policy`, as, body));
      expect((await post(ID.alice, { policy: 'all_authorized_history' })).status).toBe(403);
      expect((await post(ID.admin, { policy: 'nope' })).status).toBe(400);
      expect((await post(ID.admin, {})).status).toBe(400);
      expect((await call(h, req('POST', 'groups/-5/history-policy', ID.admin, { policy: 'since_membership' }))).status).toBe(404);
      expect(await post(ID.admin, { policy: 'since_membership' })).toEqual({ status: 200, json: { chatId: CHAT, historyPolicy: 'since_membership' } });
      const refused = await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }));
      expect(refused.status).toBe(409);
      expect(await post(ID.admin, { policy: 'all_authorized_history' })).toEqual({ status: 200, json: { chatId: CHAT, historyPolicy: 'all_authorized_history' } });
      expect(await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }))).toEqual({ status: 200, json: { count: 1, applied: true } });
    });
  });
});
