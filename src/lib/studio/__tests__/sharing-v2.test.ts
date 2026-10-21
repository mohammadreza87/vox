/**
 * S08 Studio surface: org-bridge historyPolicy mapping, the group re-snapshot
 * route, supersede notices on GET memories, the successor filter, and the
 * SharedMemoryService readContext consent decoupling, each with the flags off
 * (base behaviour) and on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { types } from 'util';
import { signInitData } from '../auth';
import { getStudio } from '../runtime';
import { handleStudioRequest, type RouterOptions } from '../http';
import { groupId, personId, studioToOrgConfig } from '../org-bridge';
import type { StudioState } from '../types';
import { auditMemoryStore, InMemoryAuditStore, InMemorySupersededNoticeStore } from '../../tireh/audit';
import { InMemoryMemoryStore, type NewMemory } from '../../tireh/memory/store';
import type { MemoryRecord, MemoryScope } from '../../tireh/types';
import type { TelegramChatMemberUpdated } from '../../tireh/telegram/client';
import { AdaptiveRepository, accountIdFor, digest } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { ManagedFileV2Storage } from '../../adaptive/persistence/indexed/managed-storage';
import { ProductPauseService } from '../../adaptive/product-pause/service';
import { SharedMemoryRepository } from '../../adaptive/shared/repository';
import { SharedMemoryService, type SharedAuthority } from '../../adaptive/shared/service';
import { draftJson, hire, ID, makeStudio, memberOf, seedOrg, T0, type Harness } from './helpers';

// Adaptive file storage and full hire flows are slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));

const BOT_TOKEN = '555:voxx-test-token';
const opts: RouterOptions = { botToken: BOT_TOKEN, devUser: null };
const CHAT = -100777;
const CANARY = 'SHARING_V2_CANARY_4d1';
const isProxy = (value: unknown) => types.isProxy(value);

afterEach(() => { vi.unstubAllEnvs(); });

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

function mem(agentId: string, partial: Partial<NewMemory> & { scope: MemoryScope }): NewMemory {
  return {
    personaId: agentId, content: `${CANARY} fact`, topic: CANARY, type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: [`ev-${Math.random().toString(36).slice(2)}`] },
    ...partial,
  };
}

const groupSource = () => ({ personId: personId(ID.alice), chatKind: 'group' as const, groupId: groupId(CHAT), at: T0, eventIds: [`g-${Math.random().toString(36).slice(2)}`] });

async function groupSetup(memberIds = [ID.alice, ID.admin, ID.bob, ID.pending]) {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const { agent } = await hire(h, org.alice);
  await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'Team', memberIds, hasGuests: false, agentIds: [agent.id], addedAt: T0.toISOString() }); });
  const record = await h.memory.memories.add(mem(agent.id, { scope: { kind: 'group', groupId: groupId(CHAT) }, authorizedPersonIds: [personId(ID.admin), personId(ID.alice)], source: groupSource() }));
  return { h, org, agent, record };
}

describe('(a) org-bridge historyPolicy', () => {
  it('maps the field only when it is set to a known value', () => {
    const state = {
      members: [{ telegramId: 1, name: 'O', role: 'owner', joinedAt: T0.toISOString() }], agents: [], audit: [],
      groups: [
        { chatId: -1, title: 'a', memberIds: [1], hasGuests: false, agentIds: [], addedAt: T0.toISOString() },
        { chatId: -2, title: 'b', memberIds: [1], hasGuests: false, agentIds: [], addedAt: T0.toISOString(), historyPolicy: 'all_authorized_history' },
        { chatId: -3, title: 'c', memberIds: [1], hasGuests: false, agentIds: [], addedAt: T0.toISOString(), historyPolicy: 'everyone' },
      ],
    } as unknown as StudioState;
    const [plain, open, invalid] = studioToOrgConfig(state).groups;
    expect('historyPolicy' in plain).toBe(false);
    expect(Object.keys(plain)).toEqual(['id', 'name', 'telegramChatId', 'agentIds', 'memberIds', 'hasGuests', 'audienceEpoch']);
    expect(plain).toStrictEqual({ id: 'chat-1', name: 'a', telegramChatId: -1, agentIds: [], memberIds: ['tg-1'], hasGuests: false, audienceEpoch: 0 });
    expect(open.historyPolicy).toBe('all_authorized_history');
    expect('historyPolicy' in invalid).toBe(false);
  });
});

describe('(b) HTTP with the flags off', () => {
  beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', ''); vi.stubEnv('TIREH_AUDIT_LOG', ''); });

  it('resnapshot is the base 404 and GET memories has exactly the memories key', async () => {
    const { h, agent, record } = await groupSetup();
    const res = await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }));
    expect(res).toEqual({ status: 404, json: { error: 'Not found' } });
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual([personId(ID.admin), personId(ID.alice)]);
    const list = await call(h, req('GET', `agents/${agent.id}/memories`, ID.alice));
    expect(Object.keys(list.json)).toEqual(['memories']);
    await expect(h.studio.resnapshotGroupMemory(await memberOf(h, ID.admin), CHAT, ID.bob, true)).rejects.toMatchObject({ status: 404 });
    expect(await h.studio.memoryNoticesFor(await memberOf(h, ID.alice), agent.id)).toEqual([]);
  });
});

describe('(c) HTTP with TIREH_SHARING_V2=1', () => {
  beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); vi.stubEnv('TIREH_AUDIT_LOG', ''); });

  it('only admins re-snapshot, with validation, preview and apply', async () => {
    const { h, record } = await groupSetup();
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.alice, { telegramId: ID.bob }))).status).toBe(403);
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, {}))).status).toBe(400);
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: String(ID.bob) }))).status).toBe(400);
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: -5 }))).status).toBe(400);
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.pending }))).status).toBe(400);
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.superadmin }))).status).toBe(400);
    expect((await call(h, req('POST', `groups/-999/resnapshot`, ID.admin, { telegramId: ID.bob }))).status).toBe(404);

    const preview = await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob }));
    expect(preview).toEqual({ status: 200, json: { count: 1, applied: false } });
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual([personId(ID.admin), personId(ID.alice)]);

    const applied = await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }));
    expect(applied).toEqual({ status: 200, json: { count: 1, applied: true } });
    const after = (await h.memory.memories.get(record.id))!;
    expect(after.authorizedPersonIds).toEqual([personId(ID.admin), personId(ID.alice), personId(ID.bob)].sort());
    expect(after.shareVersion).toBe(1);
    const entries = (await h.store.read()).audit.filter((e) => e.action === 'memory.resnapshot');
    expect(entries).toEqual([expect.objectContaining({ actor: ID.admin, target: `group:${CHAT}`, detail: `member ${ID.bob}: 1 records` })]);
    expect(JSON.stringify(entries)).not.toContain(CANARY);
    // Idempotent: nothing left to widen.
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }))).json).toEqual({ count: 0, applied: true });
  });

  it('a recipient sees a content-free notice after the owner privately corrects a shared record', async () => {
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    const { agent } = await hire(h, org.alice);
    const notices = new InMemorySupersededNoticeStore();
    h.studio.deps.memoryNotices = notices;
    h.studio.deps.memory = { ...h.studio.deps.memory, memories: auditMemoryStore(h.memory.memories, new InMemoryAuditStore(), notices) };
    const pair = [personId(ID.alice), personId(ID.bob)].sort();
    const shared = await h.studio.deps.memory.memories.add(mem(agent.id, { scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair }));
    expect(((await call(h, req('GET', `agents/${agent.id}/memories`, ID.bob))).json.memories as unknown[])).toHaveLength(1);
    await h.studio.deps.memory.memories.add(mem(agent.id, { scope: { kind: 'private', personId: personId(ID.alice) }, authorizedPersonIds: [personId(ID.alice)], supersedes: shared.id }));
    const res = await call(h, req('GET', `agents/${agent.id}/memories`, ID.bob));
    expect(res.json.memories).toEqual([]);
    expect(res.json.notices).toEqual([{ id: expect.any(String), from: 'Alice', at: expect.any(String), stillShared: false }]);
    expect(JSON.stringify(res.json)).not.toContain(CANARY);
    expect((await call(h, req('GET', `agents/${agent.id}/memories`, ID.alice))).json.notices).toEqual([]);
  });
});

class TombstoneStore extends InMemoryMemoryStore {
  async tombstonesOf(personaId: string): Promise<string[]> { return [...(this.tombstones.get(personaId) ?? [])].sort(); }
  async addTombstones(personaId: string, eventIds: readonly string[]): Promise<void> {
    const set = this.tombstones.get(personaId) ?? new Set<string>();
    for (const id of eventIds) set.add(id);
    this.tombstones.set(personaId, set);
  }
}

async function successorScenario(store: InMemoryMemoryStore) {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  h.studio.deps.memory = { ...h.studio.deps.memory, memories: store };
  const { agent: old } = await hire(h, org.alice);
  const pair = [personId(ID.alice), personId(ID.bob)].sort();
  const add = (partial: Partial<NewMemory> & { scope: MemoryScope }) => store.add(mem(old.id, partial));
  await add({ scope: { kind: 'private', personId: personId(ID.alice) }, authorizedPersonIds: [personId(ID.alice)], content: 'PRIVATE_SECRET' });
  await add({ scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair, content: 'PEOPLE_FACT' });
  await add({ scope: { kind: 'group', groupId: 'chat-1' }, authorizedPersonIds: pair, content: 'GROUP_FACT' });
  await add({ scope: { kind: 'project', projectId: 'p1' }, authorizedPersonIds: pair, content: 'PROJECT_FACT' });
  await add({ scope: { kind: 'org' }, authorizedPersonIds: pair, content: 'ORG_FACT' });
  await add({ scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair, sensitivity: 'personal', content: 'PERSONAL_FACT' });
  const original = await add({ scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair, content: 'OLD_VERSION' });
  await add({ scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair, content: 'CORRECTED', supersedes: original.id });
  const forgotten = await add({ scope: { kind: 'group', groupId: 'chat-1' }, authorizedPersonIds: pair, content: 'FORGOTTEN' });
  await store.delete(forgotten.id);
  await h.studio.fire(org.admin, old.id, { reason: 'reset', memoryPolicy: 'transfer', confirmName: 'Nova' });
  h.personaLLM.push(draftJson({ name: 'Nova Two' }));
  const { agent: next } = await hire(h, org.alice, { name: 'Nova Two' }, old.id);
  return { h, old, next, forgotten };
}

describe('(d) inheritMemories with the flag off', () => {
  it('copies every record, private ones included, exactly as at the base', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    const { agent: old } = await hire(h, org.alice);
    await h.memory.memories.add(mem(old.id, { scope: { kind: 'private', personId: personId(ID.alice) }, content: 'Alice prefers mornings' }));
    await h.studio.fire(org.admin, old.id, { reason: 'reset', memoryPolicy: 'transfer', confirmName: 'Nova' });
    const { agent: next } = await hire(h, org.alice, { name: 'Next' }, old.id);
    const inherited = await h.memory.memories.listActive(next.id);
    expect(inherited.map((m) => m.content)).toEqual(['Alice prefers mornings']);
    expect(inherited[0].scope).toEqual({ kind: 'private', personId: personId(ID.alice) });
    expect((await h.store.read()).audit.some((e) => e.action === 'memory.inherit')).toBe(false);
  });
});

describe('(e) inheritMemories with TIREH_SHARING_V2=1', () => {
  beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); });

  it('copies only normal group/people/project records, strips supersession and carries tombstones', async () => {
    const store = new TombstoneStore();
    const { h, old, next, forgotten } = await successorScenario(store);
    const inherited = await store.listActive(next.id);
    expect(inherited.map((m) => m.content).sort()).toEqual(['CORRECTED', 'GROUP_FACT', 'PEOPLE_FACT', 'PROJECT_FACT']);
    expect(inherited.every((m) => m.supersedes === undefined && m.supersededBy === undefined && m.personaId === next.id)).toBe(true);
    expect(await store.tombstonesOf(next.id)).toEqual(await store.tombstonesOf(old.id));
    expect((await store.tombstonesOf(next.id)).length).toBeGreaterThan(0);
    await expect(store.add(mem(next.id, { scope: { kind: 'group', groupId: 'chat-1' }, source: forgotten.source }))).rejects.toThrow();
    const entries = (await h.store.read()).audit.filter((e) => e.action === 'memory.inherit');
    expect(entries).toEqual([expect.objectContaining({ actor: 'system', target: next.id, detail: 'copied 4, skipped 3' })]);
    expect(JSON.stringify(entries)).not.toMatch(/FACT|SECRET|CORRECTED|CANARY/);
  });

  it('copies nothing when the store cannot carry tombstones', async () => {
    const store = new InMemoryMemoryStore();
    const { h, next } = await successorScenario(store);
    expect(await store.listActive(next.id)).toEqual([]);
    expect((await h.store.read()).audit.filter((e) => e.action === 'memory.inherit').map((e) => e.detail)).toEqual(['skipped: tombstones unsupported']);
  });
});

describe('(f) re-snapshot vox_audit rows', () => {
  it('records previewed and applied rows with the admin as actor and no content', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const { h, org, agent, record } = await groupSetup();
    const audit = new InMemoryAuditStore();
    h.studio.deps.audit = audit;
    await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, false);
    await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true);
    expect(audit.rows.map((r) => r.outcome)).toEqual(['previewed', 'applied']);
    for (const row of audit.rows) {
      expect(row).toMatchObject({ kind: 'resnapshot', personaId: agent.id, actorPersonId: personId(ID.admin), audiencePersonIds: [personId(ID.bob)], memoryIds: [record.id], policyKey: 'group.resnapshot.v1' });
      expect(row.chatKeyHash).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(JSON.stringify(audit.rows)).not.toContain(CANARY);
  });
});

describe('(g) group events never widen a snapshot', () => {
  it('noteGroupSpeaker, noteGroupMembership and onGroupChatMember leave authorizedPersonIds unchanged', async () => {
    const { h, agent } = await groupSetup([ID.alice, ID.admin]);
    const snapshot = async () => (await h.memory.memories.listActive(agent.id)).map((m: MemoryRecord) => ({ id: m.id, authorizedPersonIds: m.authorizedPersonIds, shareVersion: m.shareVersion }));
    const before = await snapshot();
    await h.studio.noteGroupSpeaker(CHAT, { id: ID.bob, first_name: 'Bob' });
    await h.studio.noteGroupMembership(CHAT, { id: ID.superadmin, first_name: 'Reza', is_bot: false }, 'member');
    const user = { id: ID.stranger, first_name: 'S', is_bot: false };
    const event: TelegramChatMemberUpdated = { chat: { id: CHAT, type: 'supergroup' }, from: user, date: 1, old_chat_member: { status: 'left', user }, new_chat_member: { status: 'member', user } };
    await h.studio.onGroupChatMember(event);
    expect((await h.store.read()).groups[0].memberIds).toEqual(expect.arrayContaining([ID.bob, ID.superadmin, ID.stranger]));
    expect(await snapshot()).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// (h) SharedMemoryService.readContext: setup copied from
// src/lib/adaptive/__tests__/shared-memory.test.ts and shared-pause-scope.test.ts.
const START = 1_800_000_000_000;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

async function sharedSetup(managed = false) {
  const root = await mkdtemp(join(tmpdir(), 'vox-sharing-v2-')); roots.push(root);
  const now = START;
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'sharing-v2-synthetic', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [101, 102, 103].map((id) => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization'].map((capability, index) => ({ schemaVersion: 1, id: `sharing-v2-approval-${index}`, revision: 1, createdAt: START, updatedAt: START,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'sharing-v2-synthetic', effectiveAt: START, reviewExpiresAt: START + 400 * 86400_000,
      owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  const storage = managed
    ? new ManagedFileV2Storage(join(root, 'private'), { now: () => now, newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 2 as const } })
    : new FileAdaptiveStorage(join(root, 'private'));
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...adaptiveOptionsFromManifest(manifest), now: () => now });
  for (const id of [101, 102, 103]) await adaptive.confirm(id, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  let members = [101, 102], guests = false;
  const group = (id: string) => (id === 'chat--100' ? { memberTelegramIds: members, hasGuests: guests, revision: digest([members, guests]) } : null);
  const authority: SharedAuthority = {
    member: async () => ({ active: true, agentIds: ['aria'] }),
    group: async (id) => group(id),
    agent: async (id) => ({ active: id === 'aria' }),
    memberNow: () => ({ active: true, agentIds: ['aria'] }),
    groupNow: group,
    agentNow: (id) => ({ active: id === 'aria' }),
    readSnapshotNow: ({ telegramIds, agentId, groupIds }) => ({
      members: telegramIds.map((telegramId) => ({ telegramId, active: true, agentIds: ['aria'] })),
      agent: { active: agentId === 'aria' },
      groups: groupIds.map((groupId) => ({ groupId, value: group(groupId) })),
    }),
  };
  const service = new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(join(root, 'shared')), 'synthetic'), adaptive, authority, () => now);
  const create = async (groupKind = false) => {
    const preview = await service.preview(101, { space: 'work', kind: groupKind ? 'group' : 'selected', recipientTelegramIds: [102], ...(groupKind ? { groupId: 'chat--100' } : {}) });
    const snapshot = await service.create(101, { space: 'work', eventId: 'create-001', expectedRevision: 0, previewToken: preview.previewToken, agentIds: ['aria'], text: 'SHARED_CANARY' });
    return snapshot.containers.at(-1)!;
  };
  return { service, adaptive, create, setGroup: (ids: number[], hasGuests = false) => { members = ids; guests = hasGuests; } };
}

const texts = (result: { memories: Array<{ text: string }> }) => result.memories.map((m) => m.text);

describe('(h) SharedMemoryService.readContext consent decoupling', () => {
  it('flag off: a recipient without optional.personalization sees nothing', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const ctx = await sharedSetup();
    await ctx.create();
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] }))).toEqual([]);
  });

  it('flag on: membership and the agent read grant are enough, and every other fence stays', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const ctx = await sharedSetup();
    const container = await ctx.create();
    const own = await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] });
    expect(texts(own)).toEqual(['SHARED_CANARY']);
    expect(await ctx.service.readContextAuthority(102, 'work', 'aria', { audienceTelegramIds: [102] })).toEqual({ revision: own.revision });
    expect(texts(await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] }))).toEqual(['SHARED_CANARY']);
    // Not a member of the container.
    expect(texts(await ctx.service.readContext(103, 'work', 'aria', { audienceTelegramIds: [103] }))).toEqual([]);
    // A multi-person audience must match the current, guest-free roster.
    await expect(ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [101, 102], groupId: 'chat--100' })).resolves.toBeTruthy();
    ctx.setGroup([101, 102], true);
    await expect(ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [101, 102], groupId: 'chat--100' })).rejects.toMatchObject({ code: 'audience_denied' });
    ctx.setGroup([101, 102, 103]);
    await expect(ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [101, 102], groupId: 'chat--100' })).rejects.toMatchObject({ code: 'audience_denied' });
    ctx.setGroup([101, 102]);
    // Revoking the per-container agent grant removes it again.
    await ctx.service.setAgentAccess(101, container.id, 'aria', { space: 'work', expectedRevision: container.revision, eventId: 'agent-revoke', allowed: false });
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] }))).toEqual([]);
  });

  it('flag on: the product pause still withholds shared context', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const ctx = await sharedSetup(true);
    await ctx.create();
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] }))).toEqual(['SHARED_CANARY']);
    const pause = new ProductPauseService(ctx.adaptive);
    const state = await pause.read(102, 'work');
    await pause.command(102, { version: 1, space: 'work', action: 'pause', eventId: 'synthetic-pause-event-0001', expectedCommandSeq: state.commandSeq! });
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (i) runtime wiring (getStudio pattern from runtime.test.ts, file storage).
describe('(i) runtime wiring', () => {
  const dirs: string[] = [];
  const globalState = globalThis as unknown as { __voxStudio?: unknown };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete globalState.__voxStudio;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const configure = (flags: NodeJS.ProcessEnv) => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-sharing-v2-runtime-'));
    dirs.push(dir);
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production', STUDIO_SECRET: 'a-test-encryption-secret-with-32-characters', ANTHROPIC_API_KEY: 'test-anthropic-key',
      VOXX_BOT_TOKEN: '123456789:abcdefghijklmnopqrstuvwxyz0123456789', VOXX_BOT_USERNAME: 'VoxxBot', STUDIO_SUPERADMIN_IDS: '123, 456',
      STUDIO_WEBAPP_URL: 'https://studio.example.com/studio', STUDIO_DATA_DIR: dir, STUDIO_STORAGE: 'file', STUDIO_PUBLIC_URL: '', STUDIO_BOTS: '0',
      STUDIO_RELATIONSHIPS: 'off', STUDIO_RELATIONSHIP_AGENTS: '', STUDIO_RELATIONSHIP_PEOPLE: '', STUDIO_RELATIONSHIP_ROLES: '',
      STUDIO_RELATIONSHIP_WORKER_SECRET: '', STUDIO_MAINTENANCE: '', STUDIO_REMINDER_DELIVERY: '', STUDIO_EXPERIMENTS_ENABLED: '',
      STUDIO_IMPROVEMENT_TRUST_JSON: '', OPENAI_API_KEY: '', K_SERVICE: '', FUNCTION_TARGET: '', FUNCTION_NAME: '', VERCEL: '', ...flags,
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    return dir;
  };

  it('with both flags unset installs nothing and creates no audit files', async () => {
    const dir = configure({ TIREH_SHARING_V2: '', TIREH_AUDIT_LOG: '' });
    const studio = await getStudio();
    expect(studio.deps.audit).toBeUndefined();
    expect(studio.deps.memoryNotices).toBeUndefined();
    expect(isProxy(studio.deps.memory.memories)).toBe(false);
    expect(isProxy(studio.deps.memory.offers)).toBe(false);
    expect(existsSync(join(dir, 'vox-audit.jsonl'))).toBe(false);
    expect(existsSync(join(dir, 'supersede-notices.json'))).toBe(false);
  });

  it('with TIREH_AUDIT_LOG=1 decorates the stores and writes content-free rows to vox-audit.jsonl', async () => {
    const dir = configure({ TIREH_SHARING_V2: '', TIREH_AUDIT_LOG: '1' });
    const studio = await getStudio();
    expect(studio.deps.audit).toBeDefined();
    expect(studio.deps.memoryNotices).toBeDefined();
    expect(isProxy(studio.deps.memory.memories)).toBe(true);
    expect(isProxy(studio.deps.memory.offers)).toBe(true);
    await studio.deps.memory.memories.add(mem('agent-x', { scope: { kind: 'private', personId: 'tg-1' }, authorizedPersonIds: ['tg-1'] }));
    const file = readFileSync(join(dir, 'vox-audit.jsonl'), 'utf8');
    expect(file.trim().split('\n')).toHaveLength(1);
    expect(file).not.toContain(CANARY);
  });
});
