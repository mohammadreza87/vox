/**
 * S08 Studio surface, each with the flags unset (base behaviour) and set:
 *  (a) the group re-snapshot action and route;
 *  (b) group membership events never widen a snapshot;
 *  (c) org-bridge historyPolicy mapping;
 *  (d) inheritMemories (successor filter and tombstone carry);
 *  (e) supersede notices on GET memories;
 *  (f) SharedMemoryService.readContext consent decoupling;
 *  (g) content-free canaries;
 *  plus the runtime wiring of the decorators.
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
import { groupId, personId, studioToOrg, studioToOrgConfig } from '../org-bridge';
import type { StudioGroup, StudioState } from '../types';
import { auditMemoryStore, InMemoryAuditStore, InMemorySupersededNoticeStore, MAX_AUDIT_IDS } from '../../tireh/audit';
import { InMemoryMemoryStore, type NewMemory } from '../../tireh/memory/store';
import { historyMessageForChat, selectHistoryForChat } from '../../tireh/memory/visibility';
import type { ChatContext, Group, MemoryRecord, MemoryScope } from '../../tireh/types';
import type { TelegramChatMemberUpdated } from '../../tireh/telegram/client';
import { AdaptiveRepository, accountIdFor, digest } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
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
const OTHER_CHAT = -100999;
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

let seq = 0;
function mem(agentId: string, partial: Partial<NewMemory> & { scope: MemoryScope }): NewMemory {
  return {
    personaId: agentId, content: `${CANARY} fact`, topic: CANARY, type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: [`ev-${++seq}`] },
    ...partial,
  };
}

const groupSource = (chatId = CHAT) => ({ personId: personId(ID.alice), chatKind: 'group' as const, groupId: groupId(chatId), at: T0, eventIds: [`g-${++seq}`] });
const groupScope = (chatId = CHAT): MemoryScope => ({ kind: 'group', groupId: groupId(chatId) });
const AUTH = () => [personId(ID.admin), personId(ID.alice)];

async function groupSetup(memberIds = [ID.alice, ID.admin, ID.bob, ID.pending], extra: Partial<StudioGroup> = {}) {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const { agent } = await hire(h, org.alice);
  await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'Team', memberIds, hasGuests: false, agentIds: [agent.id], addedAt: T0.toISOString(), ...extra }); });
  const record = await h.memory.memories.add(mem(agent.id, { scope: groupScope(), authorizedPersonIds: AUTH(), source: groupSource() }));
  return { h, org, agent, record };
}

const auditEntries = async (h: Harness, action: string) => (await h.store.read()).audit.filter((e) => e.action === action);

// ---------------------------------------------------------------------------
describe('(a) group re-snapshot', () => {
  it('flag unset: the route is the base 404 and the method throws 404', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const { h, org, record } = await groupSetup();
    expect(await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }))).toEqual({ status: 404, json: { error: 'Not found' } });
    await expect(h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true)).rejects.toMatchObject({ status: 404 });
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual(AUTH());
    expect(await auditEntries(h, 'memory.resnapshot')).toEqual([]);
  });

  describe('TIREH_SHARING_V2=1', () => {
    beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); vi.stubEnv('TIREH_AUDIT_LOG', ''); });

    it('only admins; targets must be approved members of the group', async () => {
      const { h } = await groupSetup([ID.alice, ID.admin, ID.bob, ID.pending, ID.stranger]);
      const post = (as: number, body: unknown) => call(h, req('POST', `groups/${CHAT}/resnapshot`, as, body));
      expect((await post(ID.alice, { telegramId: ID.bob })).status).toBe(403);
      expect((await post(ID.bob, { telegramId: ID.bob, apply: true })).status).toBe(403);
      expect((await post(ID.admin, {})).status).toBe(400);
      expect((await post(ID.admin, { telegramId: String(ID.bob) })).status).toBe(400);
      expect((await post(ID.admin, { telegramId: -5 })).status).toBe(400);
      expect((await post(ID.admin, { telegramId: ID.pending })).status).toBe(400);
      // A guest: in the Telegram group, not an approved Studio member.
      expect((await post(ID.admin, { telegramId: ID.stranger })).status).toBe(400);
      // An approved member who is not in this group.
      expect((await post(ID.admin, { telegramId: ID.superadmin })).status).toBe(400);
      expect((await call(h, req('POST', `groups/-999/resnapshot`, ID.admin, { telegramId: ID.bob }))).status).toBe(404);
    });

    it('preview counts, apply widens exactly that member and nothing else, and old history stays unreplayed', async () => {
      const { h, org, agent, record } = await groupSetup();
      const { agent: privateAgent, bot } = await hire(h, org.alice, { name: 'Quiet' }, undefined, 'private');
      bot().getChatMemberCount.mockResolvedValue(4);
      await h.store.update((s) => { s.groups[0].agentIds.push(privateAgent.id); });
      const add = (partial: Partial<NewMemory> & { scope: MemoryScope }, persona = agent.id) => h.memory.memories.add(mem(persona, { source: groupSource(), ...partial }));
      const personal = await add({ scope: groupScope(), authorizedPersonIds: AUTH(), sensitivity: 'personal' });
      const confidential = await add({ scope: groupScope(), authorizedPersonIds: AUTH(), sensitivity: 'confidential' });
      const legacy = await add({ scope: groupScope() });
      const other = await add({ scope: groupScope(OTHER_CHAT), authorizedPersonIds: AUTH(), source: groupSource(OTHER_CHAT) });
      const old = await add({ scope: groupScope(), authorizedPersonIds: AUTH() });
      const correction = await add({ scope: groupScope(), authorizedPersonIds: AUTH(), supersedes: old.id, source: { ...groupSource(), eventIds: [`corr-${++seq}`] } });
      const unusable = await add({ scope: groupScope(), authorizedPersonIds: AUTH() }, privateAgent.id);
      const untouched = [personal, confidential, legacy, other, unusable];
      const snapshot = async (ids: string[]) => Promise.all(ids.map(async (id) => {
        const m = (await h.memory.memories.get(id))!;
        return { id, authorizedPersonIds: m.authorizedPersonIds, shareVersion: m.shareVersion };
      }));

      const gid = groupId(CHAT);
      const team: Group = { id: gid, name: 'Team', memberIds: AUTH(), telegramChatId: CHAT };
      const before: ChatContext = { kind: 'group', chatKey: `group-${gid}`, group: team };
      await h.memory.history.append(agent.id, `group-${gid}`, historyMessageForChat(before, { role: 'user', personId: personId(ID.alice), text: `${CANARY} earlier turn`, at: T0 }));

      const baseline = await snapshot([record.id, correction.id, old.id, ...untouched.map((m) => m.id)]);
      const preview = await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob }));
      expect(preview).toEqual({ status: 200, json: { count: 2, applied: false } });
      expect(await snapshot(baseline.map((b) => b.id))).toEqual(baseline);
      expect(await auditEntries(h, 'memory.resnapshot')).toEqual([]);

      const applied = await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }));
      expect(applied).toEqual({ status: 200, json: { count: 2, applied: true } });
      for (const id of [record.id, correction.id]) {
        const after = (await h.memory.memories.get(id))!;
        expect(after.authorizedPersonIds).toEqual([...AUTH(), personId(ID.bob)].sort());
        expect(after.shareVersion).toBe(1);
      }
      const unchanged = baseline.filter((b) => ![record.id, correction.id].includes(b.id));
      expect(await snapshot(unchanged.map((b) => b.id))).toEqual(unchanged);
      expect(await auditEntries(h, 'memory.resnapshot')).toEqual([expect.objectContaining({ actor: ID.admin, target: String(CHAT), detail: `${ID.bob}:2` })]);

      // Bob now sees the group memory, but the old group turns are not replayed to him.
      const bob = await memberOf(h, ID.bob);
      expect((await h.studio.memoriesFor(bob, agent.id)).map((m) => m.id).sort()).toEqual([record.id, correction.id].sort());
      const org2 = studioToOrg(await h.store.read());
      const now: ChatContext = { kind: 'group', chatKey: `group-${gid}`, group: { ...team, memberIds: [...AUTH(), personId(ID.bob)] } };
      const history = await h.memory.history.recent(agent.id, `group-${gid}`, 50);
      expect(history).toHaveLength(1);
      expect(selectHistoryForChat(org2, history, now)).toEqual([]);

      // Idempotent: nothing is left to widen.
      expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }))).json).toEqual({ count: 0, applied: true });
    });

    it('a member blocked on the agent is not widened', async () => {
      const { h, agent, record } = await groupSetup();
      await h.store.update((s) => { s.agents.find((a) => a.id === agent.id)!.blocked = [ID.bob]; });
      expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true }))).json).toEqual({ count: 0, applied: true });
      expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual(AUTH());
    });

    it('with TIREH_AUDIT_LOG=1 writes content-free previewed and resnapshot rows', async () => {
      vi.stubEnv('TIREH_AUDIT_LOG', '1');
      const { h, org, agent, record } = await groupSetup();
      const audit = new InMemoryAuditStore();
      h.studio.deps.audit = audit;
      await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, false);
      await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true);
      expect(audit.rows.map((r) => r.outcome)).toEqual(['previewed', 'applied']);
      for (const row of audit.rows) {
        expect(row).toMatchObject({ kind: 'resnapshot', personaId: agent.id, actorPersonId: personId(ID.admin), audiencePersonIds: [personId(ID.bob)], memoryIds: [record.id] });
      }
      expect(JSON.stringify(audit.rows)).not.toContain(CANARY);
    });

    it('with TIREH_AUDIT_LOG=1 splits an applied re-snapshot over more than MAX_AUDIT_IDS records into batches and loses no id', async () => {
      vi.stubEnv('TIREH_AUDIT_LOG', '1');
      const { h, org, agent, record } = await groupSetup();
      const ids = [record.id];
      for (let i = 0; i < 200; i++) ids.push((await h.memory.memories.add(mem(agent.id, { scope: groupScope(), authorizedPersonIds: AUTH(), source: groupSource() }))).id);
      const audit = new InMemoryAuditStore();
      h.studio.deps.audit = audit;
      expect(await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true)).toEqual({ count: 201, applied: true });
      const applied = audit.rows.filter((r) => r.outcome === 'applied');
      expect(applied).toHaveLength(2);
      expect(applied.every((r) => r.memoryIds.length <= MAX_AUDIT_IDS)).toBe(true);
      expect(applied.flatMap((r) => r.memoryIds).sort()).toEqual([...ids].sort());
    });
  });
});

// ---------------------------------------------------------------------------
describe('(b) group events never widen a snapshot', () => {
  for (const historyPolicy of [undefined, 'since_membership', 'all_authorized_history'] as const) {
    for (const flag of ['', '1']) {
      it(`historyPolicy=${historyPolicy ?? 'unset'} TIREH_SHARING_V2=${flag || 'unset'}`, async () => {
        vi.stubEnv('TIREH_SHARING_V2', flag);
        const { h, org, agent } = await groupSetup([ID.alice, ID.admin], historyPolicy ? { historyPolicy } : {});
        const snapshot = async () => (await h.memory.memories.listActive(agent.id)).map((m: MemoryRecord) => ({ id: m.id, authorizedPersonIds: m.authorizedPersonIds, shareVersion: m.shareVersion }));
        const before = await snapshot();
        await h.studio.noteGroupSpeaker(CHAT, { id: ID.bob, first_name: 'Bob' });
        await h.studio.noteGroupMembership(CHAT, { id: ID.superadmin, first_name: 'Reza', is_bot: false }, 'member');
        const user = { id: ID.stranger, first_name: 'S', is_bot: false };
        const event: TelegramChatMemberUpdated = { chat: { id: CHAT, type: 'supergroup' }, from: user, date: 1, old_chat_member: { status: 'left', user }, new_chat_member: { status: 'member', user } };
        await h.studio.onGroupChatMember(event);
        const { agent: second, bot } = await hire(h, org.alice, { name: 'Second' });
        bot().getChatMemberCount.mockResolvedValue(5);
        const botUser = { id: 1, is_bot: true, first_name: 'b' };
        await h.studio.onBotChatMember(second, { chat: { id: CHAT, type: 'supergroup', title: 'Team' }, from: { id: ID.alice, is_bot: false, first_name: 'A' }, date: 2,
          old_chat_member: { status: 'left', user: botUser }, new_chat_member: { status: 'member', user: botUser } });
        const group = (await h.store.read()).groups[0];
        expect(group.memberIds).toEqual(expect.arrayContaining([ID.bob, ID.superadmin, ID.stranger]));
        expect(group.agentIds).toContain(second.id);
        expect(await snapshot()).toStrictEqual(before);
      });
    }
  }
});

// ---------------------------------------------------------------------------
describe('(c) org-bridge historyPolicy', () => {
  it('without historyPolicy the group deep-equals the base shape; when set it is mapped', () => {
    const state = {
      members: [{ telegramId: 1, name: 'O', role: 'owner', joinedAt: T0.toISOString() }], agents: [], audit: [],
      groups: [
        { chatId: -1, title: 'a', memberIds: [1], hasGuests: false, agentIds: [], addedAt: T0.toISOString() },
        { chatId: -2, title: 'b', memberIds: [1], hasGuests: false, agentIds: [], addedAt: T0.toISOString(), historyPolicy: 'all_authorized_history' },
        { chatId: -3, title: 'c', memberIds: [1], hasGuests: false, agentIds: [], addedAt: T0.toISOString(), historyPolicy: 'since_membership' },
      ],
    } as unknown as StudioState;
    const [plain, open, explicit] = studioToOrgConfig(state).groups;
    expect('historyPolicy' in plain).toBe(false);
    expect(plain).toStrictEqual({ id: 'chat-1', name: 'a', telegramChatId: -1, agentIds: [], memberIds: ['tg-1'], hasGuests: false, audienceEpoch: 0 });
    expect(open.historyPolicy).toBe('all_authorized_history');
    expect(explicit.historyPolicy).toBe('since_membership');
  });
});

// ---------------------------------------------------------------------------
/** S06-shaped optional store methods (contract), implemented from `this.tombstones`. */
class TombstoneStore extends InMemoryMemoryStore {
  async tombstonesOf(personaId: string): Promise<string[]> { return [...(this.tombstones.get(personaId) ?? [])].sort(); }
  async addTombstones(personaId: string, eventIds: readonly string[]): Promise<void> {
    const set = this.tombstones.get(personaId) ?? new Set<string>();
    for (const id of eventIds) set.add(id);
    this.tombstones.set(personaId, set);
  }
}

/** A store without S06's optional tombstone methods: inheritance must fail closed. */
class NoTombstoneStore extends InMemoryMemoryStore {
  declare tombstonesOf: undefined;
  declare addTombstones: undefined;
  constructor() {
    super();
    Object.defineProperty(this, 'tombstonesOf', { value: undefined });
    Object.defineProperty(this, 'addTombstones', { value: undefined });
  }
}

async function successorScenario(store: InMemoryMemoryStore) {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  h.studio.deps.memory = { ...h.studio.deps.memory, memories: store };
  const { agent: old } = await hire(h, org.alice);
  const pair = [personId(ID.alice), personId(ID.bob)].sort();
  const add = (content: string, scope: MemoryScope, partial: Partial<NewMemory> = {}) => store.add(mem(old.id, { scope, authorizedPersonIds: pair, content, ...partial }));
  await add('PRIVATE_SECRET', { kind: 'private', personId: personId(ID.alice) }, { authorizedPersonIds: [personId(ID.alice)] });
  await add('PEOPLE_FACT', { kind: 'people', personIds: pair });
  await add('GROUP_FACT', { kind: 'group', groupId: 'chat-1' });
  await add('PROJECT_FACT', { kind: 'project', projectId: 'p1' });
  await add('COMPANY_FACT', { kind: 'company', companyId: 'c1' });
  await add('ORG_FACT', { kind: 'org' });
  await add('PERSONAL_FACT', { kind: 'people', personIds: pair }, { sensitivity: 'personal' });
  await add('CONFIDENTIAL_FACT', { kind: 'group', groupId: 'chat-1' }, { sensitivity: 'confidential' });
  const original = await add('OLD_VERSION', { kind: 'people', personIds: pair });
  await add('CORRECTED', { kind: 'people', personIds: pair }, { supersedes: original.id });
  const forgotten = await add('FORGOTTEN', { kind: 'group', groupId: 'chat-1' });
  await store.delete(forgotten.id);
  // An active record whose lineage the predecessor already tombstoned.
  const lineage = await add('TOMBSTONED_LINEAGE', { kind: 'group', groupId: 'chat-1' }, { source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: ['lineage-1'] } });
  if (typeof store.addTombstones === 'function') await store.addTombstones(old.id, ['lineage-1']);
  await h.studio.fire(org.admin, old.id, { reason: 'reset', memoryPolicy: 'transfer', confirmName: 'Nova' });
  h.personaLLM.push(draftJson({ name: 'Nova Two' }));
  const { agent: next } = await hire(h, org.alice, { name: 'Nova Two' }, old.id);
  return { h, old, next, forgotten, lineage };
}

describe('(d) inheritMemories', () => {
  it('flag unset: copies every active record, private ones included (the base gap)', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    const { agent: old } = await hire(h, org.alice);
    await h.memory.memories.add(mem(old.id, { scope: { kind: 'private', personId: personId(ID.alice) }, content: 'Alice prefers mornings' }));
    await h.memory.memories.add(mem(old.id, { scope: { kind: 'private', personId: personId(ID.alice) }, content: 'Alice is unwell', sensitivity: 'personal' }));
    await h.studio.fire(org.admin, old.id, { reason: 'reset', memoryPolicy: 'transfer', confirmName: 'Nova' });
    const { agent: next } = await hire(h, org.alice, { name: 'Next' }, old.id);
    const inherited = await h.memory.memories.listActive(next.id);
    expect(inherited.map((m) => m.content).sort()).toEqual(['Alice is unwell', 'Alice prefers mornings']);
    expect(inherited[0].scope).toEqual({ kind: 'private', personId: personId(ID.alice) });
  });

  describe('TIREH_SHARING_V2=1', () => {
    beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); });

    it('copies only normal group/people/project records, strips supersession and carries tombstones', async () => {
      const store = new TombstoneStore();
      const { h, old, next, forgotten } = await successorScenario(store);
      const inherited = await store.listActive(next.id);
      expect(inherited.map((m) => m.content).sort()).toEqual(['CORRECTED', 'GROUP_FACT', 'PEOPLE_FACT', 'PROJECT_FACT']);
      expect(inherited.every((m) => m.supersedes === undefined && m.supersededBy === undefined && m.personaId === next.id)).toBe(true);
      expect(inherited.every((m) => m.authorizedPersonIds?.length === 2 && m.source.eventIds?.length === 1)).toBe(true);
      const carried = await store.tombstonesOf(next.id);
      expect(carried).toEqual(await store.tombstonesOf(old.id));
      expect(carried).toContain('lineage-1');
      await expect(store.add(mem(next.id, { scope: { kind: 'group', groupId: 'chat-1' }, source: forgotten.source }))).rejects.toThrow();
      expect(JSON.stringify((await h.store.read()).audit)).not.toMatch(/FACT|SECRET|CORRECTED|CANARY/);
    });

    it('carries tombstones with the real InMemoryMemoryStore once S06 is merged', async () => {
      const store = new InMemoryMemoryStore();
      const { old, next } = await successorScenario(store);
      expect((await store.listActive(next.id)).map((m) => m.content).sort()).toEqual(['CORRECTED', 'GROUP_FACT', 'PEOPLE_FACT', 'PROJECT_FACT']);
      expect(await store.tombstonesOf(next.id)).toEqual(await store.tombstonesOf(old.id));
    });

    it('skips a tombstoned lineage whose StaleMemoryWriteError comes from another bundle copy (structural check)', async () => {
      // A route bundle carries its own copy of the class, so the rejection is matched by name, not instanceof.
      class ForeignStaleStore extends TombstoneStore {
        private owner?: string;
        override async add(memory: NewMemory, guard?: Parameters<InMemoryMemoryStore['add']>[1]): Promise<MemoryRecord> {
          this.owner ??= memory.personaId;
          if (memory.personaId !== this.owner && memory.content === 'GROUP_FACT') throw Object.assign(new Error('x'), { name: 'StaleMemoryWriteError' });
          return super.add(memory, guard);
        }
      }
      const store = new ForeignStaleStore();
      const { next } = await successorScenario(store);
      expect(next.status).toBe('active');
      expect((await store.listActive(next.id)).map((m) => m.content).sort()).toEqual(['CORRECTED', 'PEOPLE_FACT', 'PROJECT_FACT']);
    });

    it('inherits nothing when the store cannot carry tombstones (fail closed)', async () => {
      const store = new NoTombstoneStore();
      const { next } = await successorScenario(store);
      expect(await store.listActive(next.id)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
async function noticeSetup() {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const { agent } = await hire(h, org.alice);
  const notices = new InMemorySupersededNoticeStore();
  h.studio.deps.memoryNotices = notices;
  h.studio.deps.memory = { ...h.studio.deps.memory, memories: auditMemoryStore(h.memory.memories, new InMemoryAuditStore(), notices) };
  const pair = [personId(ID.alice), personId(ID.bob)].sort();
  const shared = await h.studio.deps.memory.memories.add(mem(agent.id, { scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair }));
  return { h, org, agent, notices, pair, shared };
}

describe('(e) supersede notices', () => {
  it('flag unset: GET memories is exactly {memories} and memoryNoticesFor is empty', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const { h, agent, org } = await groupSetup();
    const list = await call(h, req('GET', `agents/${agent.id}/memories`, ID.alice));
    expect(list.status).toBe(200);
    expect(Object.keys(list.json)).toEqual(['memories']);
    expect(await h.studio.memoryNoticesFor(org.alice, agent.id)).toEqual([]);
  });

  describe('TIREH_SHARING_V2=1', () => {
    beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); });

    it('a recipient sees a notice after the owner privately corrects a shared record; others do not', async () => {
      const { h, agent, shared } = await noticeSetup();
      expect(((await call(h, req('GET', `agents/${agent.id}/memories`, ID.bob))).json.memories as unknown[])).toHaveLength(1);
      const correction = await h.studio.deps.memory.memories.add(mem(agent.id, { scope: { kind: 'private', personId: personId(ID.alice) }, authorizedPersonIds: [personId(ID.alice)], supersedes: shared.id }));
      const res = await call(h, req('GET', `agents/${agent.id}/memories`, ID.bob));
      expect(res.json.memories).toEqual([]);
      expect(res.json.notices).toEqual([{ id: expect.any(String), oldMemoryId: shared.id, newMemoryId: correction.id, from: 'Alice', at: expect.any(String), replacementVisible: false }]);
      expect(JSON.stringify(res.json)).not.toContain(CANARY);
      expect((await call(h, req('GET', `agents/${agent.id}/memories`, ID.alice))).json.notices).toEqual([]);
      expect((await call(h, req('GET', `agents/${agent.id}/memories`, ID.superadmin))).json.notices).toEqual([]);
    });

    it('replacementVisible is true when the correction is still shared, and the notice disappears once forgotten', async () => {
      const { h, org, agent, pair, shared } = await noticeSetup();
      const correction = await h.studio.deps.memory.memories.add(mem(agent.id, { scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair, supersedes: shared.id }));
      const bob = await memberOf(h, ID.bob);
      expect(await h.studio.memoryNoticesFor(bob, agent.id)).toEqual([expect.objectContaining({ oldMemoryId: shared.id, newMemoryId: correction.id, replacementVisible: true })]);
      await h.studio.forgetMemory(org.alice, agent.id, shared.id);
      expect(await h.studio.memoryNoticesFor(bob, agent.id)).toEqual([]);
    });

    it('an agent the actor cannot use is not found', async () => {
      const { h, org } = await noticeSetup();
      const { agent: privateAgent } = await hire(h, org.alice, { name: 'Quiet' }, undefined, 'private');
      await expect(h.studio.memoryNoticesFor(await memberOf(h, ID.bob), privateAgent.id)).rejects.toMatchObject({ status: 404 });
    });
  });
});

// ---------------------------------------------------------------------------
// (f) SharedMemoryService.readContext: minimal setup copied from
// src/lib/adaptive/__tests__/shared-memory.test.ts.
const START = 1_800_000_000_000;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

async function sharedSetup(options: { pausedFor?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vox-sharing-v2-')); roots.push(root);
  const now = START;
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'sharing-v2-synthetic', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [101, 102, 103].map((id) => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization'].map((capability, index) => ({ schemaVersion: 1, id: `sharing-v2-approval-${index}`, revision: 1, createdAt: START, updatedAt: START,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'sharing-v2-synthetic', effectiveAt: START, reviewExpiresAt: START + 400 * 86400_000,
      owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  const real = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(root, 'private'))), { ...adaptiveOptionsFromManifest(manifest), now: () => now });
  for (const id of [101, 102, 103]) await real.confirm(id, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  // An AdaptiveService stub that reports the product pause (storedPersonalizationAllowed:false) for one person.
  const paused = options.pausedFor;
  const adaptive = paused === undefined ? real : new Proxy(real, {
    get(target, prop) {
      if (prop === 'readAuthority') {
        return async (id: number, space: 'work' | 'personal') => {
          const profile = await target.readAuthority(id, space);
          return id === paused ? { ...profile, storedPersonalizationAllowed: false } : profile;
        };
      }
      if (prop === 'readAuthorityNow') {
        return (id: number, space: 'work' | 'personal') => {
          const profile = target.readAuthorityNow(id, space);
          return id === paused ? { ...profile, storedPersonalizationAllowed: false } : profile;
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
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
  const create = async (options: { group?: boolean; space?: 'work' | 'personal'; text?: string } = {}) => {
    const space = options.space ?? 'work';
    const preview = await service.preview(101, { space, kind: options.group ? 'group' : 'selected', recipientTelegramIds: [102], ...(options.group ? { groupId: 'chat--100' } : {}) });
    const snapshot = await service.create(101, { space, eventId: `create-${++seq}`, expectedRevision: 0, previewToken: preview.previewToken, agentIds: ['aria'], text: options.text ?? 'SHARED_CANARY' });
    return snapshot.containers.at(-1)!;
  };
  return { service, create, setGroup: (ids: number[], hasGuests = false) => { members = ids; guests = hasGuests; } };
}

const texts = (result: { memories: Array<{ text: string }> }) => result.memories.map((m) => m.text);
const read = (ctx: Awaited<ReturnType<typeof sharedSetup>>, id: number, space: 'work' | 'personal' = 'work') => ctx.service.readContext(id, space, 'aria', { audienceTelegramIds: [id] });

describe('(f) SharedMemoryService.readContext consent decoupling', () => {
  it('flag unset: without personalize() a recipient and the author see nothing (base)', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const ctx = await sharedSetup();
    await ctx.create();
    expect(texts(await read(ctx, 102))).toEqual([]);
    expect(texts(await read(ctx, 101))).toEqual([]);
  });

  describe('TIREH_SHARING_V2=1', () => {
    beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); });

    it('author and recipient read after the agent grant with no personalization grant; a non-member gets nothing', async () => {
      const ctx = await sharedSetup();
      await ctx.create();
      const recipient = await read(ctx, 102);
      expect(texts(recipient)).toEqual(['SHARED_CANARY']);
      expect(texts(await read(ctx, 101))).toEqual(['SHARED_CANARY']);
      expect(texts(await read(ctx, 103))).toEqual([]);
      expect(await ctx.service.readContextAuthority(102, 'work', 'aria', { audienceTelegramIds: [102] })).toEqual({ revision: recipient.revision });
    });

    it('revoking the agent grant removes it and changes the revision', async () => {
      const ctx = await sharedSetup();
      const container = await ctx.create();
      const before = await read(ctx, 102);
      await ctx.service.setAgentAccess(101, container.id, 'aria', { space: 'work', expectedRevision: container.revision, eventId: 'agent-revoke', allowed: false });
      const after = await read(ctx, 102);
      expect(texts(after)).toEqual([]);
      expect(after.revision).not.toBe(before.revision);
    });

    it('a group container whose audience changed gives nothing, and guests or roster drift deny', async () => {
      const ctx = await sharedSetup();
      await ctx.create({ group: true });
      expect(texts(await read(ctx, 102))).toEqual(['SHARED_CANARY']);
      ctx.setGroup([101, 102], true);
      await expect(ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [101, 102], groupId: 'chat--100' })).rejects.toMatchObject({ code: 'audience_denied' });
      ctx.setGroup([101, 102, 103]);
      expect(texts(await read(ctx, 101))).toEqual([]);
      expect(texts(await read(ctx, 102))).toEqual([]);
    });

    it('Personal does not leak into Work', async () => {
      const ctx = await sharedSetup();
      await ctx.create({ space: 'personal', text: 'PERSONAL_SHARED_CANARY' });
      expect(texts(await read(ctx, 102, 'personal'))).toEqual(['PERSONAL_SHARED_CANARY']);
      expect(texts(await read(ctx, 102, 'work'))).toEqual([]);
      expect(texts(await read(ctx, 101, 'work'))).toEqual([]);
    });

    it('the product pause fence stays: storedPersonalizationAllowed:false gives nothing', async () => {
      const ctx = await sharedSetup({ pausedFor: 102 });
      await ctx.create();
      expect(texts(await read(ctx, 102))).toEqual([]);
      expect(texts(await read(ctx, 101))).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
describe('(g) content-free canaries', () => {
  it('no memory text in the resnapshot response, the notices response, StudioState.audit or vox_audit rows', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const { h, agent, shared } = await noticeSetup();
    const audit = new InMemoryAuditStore();
    h.studio.deps.audit = audit;
    h.studio.deps.memory = { ...h.studio.deps.memory, memories: auditMemoryStore(h.memory.memories, audit, h.studio.deps.memoryNotices) };
    await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'Team', memberIds: [ID.alice, ID.admin, ID.bob], hasGuests: false, agentIds: [agent.id], addedAt: T0.toISOString() }); });
    await h.studio.deps.memory.memories.add(mem(agent.id, { scope: groupScope(), authorizedPersonIds: AUTH(), source: groupSource() }));
    await h.studio.deps.memory.memories.add(mem(agent.id, { scope: { kind: 'private', personId: personId(ID.alice) }, authorizedPersonIds: [personId(ID.alice)], supersedes: shared.id }));
    const responses = [
      await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob })),
      await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, apply: true })),
      await call(h, req('GET', `agents/${agent.id}/memories`, ID.bob)),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((responses[2].json.notices as unknown[]).length).toBe(1);
    expect(audit.rows.length).toBeGreaterThan(3);
    // The memories list itself carries content by design; the notices key, the resnapshot bodies and every audit trail must not.
    const surfaces = [JSON.stringify(responses[0].json), JSON.stringify(responses[1].json), JSON.stringify(responses[2].json.notices),
      JSON.stringify((await h.store.read()).audit), JSON.stringify(audit.rows)];
    for (const text of surfaces) {
      expect(text).not.toContain(CANARY);
    }
  });
});

// ---------------------------------------------------------------------------
describe('runtime wiring', () => {
  const dirs: string[] = [];
  const globalState = globalThis as unknown as { __voxStudio?: unknown };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete globalState.__voxStudio;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const configure = (flags: NodeJS.ProcessEnv, existing?: string) => {
    const dir = existing ?? mkdtempSync(join(tmpdir(), 'vox-sharing-v2-runtime-'));
    if (!existing) dirs.push(dir);
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

  it('with both flags unset installs nothing and creates no audit or notice files', async () => {
    const dir = configure({ TIREH_SHARING_V2: '', TIREH_AUDIT_LOG: '' });
    const studio = await getStudio();
    expect(studio.deps.audit).toBeUndefined();
    expect(studio.deps.memoryNotices).toBeUndefined();
    expect(isProxy(studio.deps.memory.memories)).toBe(false);
    expect(isProxy(studio.deps.memory.offers)).toBe(false);
    await studio.deps.memory.memories.add(mem('agent-x', { scope: { kind: 'private', personId: 'tg-1' }, authorizedPersonIds: ['tg-1'] }));
    expect(existsSync(join(dir, 'vox-audit.jsonl'))).toBe(false);
    expect(existsSync(join(dir, 'supersede-notices.json'))).toBe(false);
    // Erasure-only: a rights erasure with nothing stored removes nothing and creates nothing.
    expect(await studio.forgetMemoryNotices(ID.alice)).toBe(0);
    expect(existsSync(join(dir, 'supersede-notices.json'))).toBe(false);
  });

  it('after a rollback (flag on, restart with both flags unset) notices still go with their memory and on a rights erasure, and vox_audit still ages out', async () => {
    const dir = configure({ TIREH_SHARING_V2: '1', TIREH_AUDIT_LOG: '1' });
    let studio = await getStudio();
    const owner = personId(ID.alice), recipient = personId(ID.bob);
    const scope: MemoryScope = { kind: 'people', personIds: [owner, recipient] };
    const kept = await studio.deps.memory.memories.add(mem('agent-x', { scope, authorizedPersonIds: [owner, recipient] }));
    const erased = await studio.deps.memory.memories.add(mem('agent-x', { scope, authorizedPersonIds: [owner, recipient] }));
    const at = new Date();
    await studio.deps.memoryNotices!.record({ personaId: 'agent-x', oldMemoryId: erased.id, newMemoryId: 'm-new-1', ownerPersonId: owner, recipientPersonIds: [recipient], at });
    await studio.deps.memoryNotices!.record({ personaId: 'agent-x', oldMemoryId: kept.id, newMemoryId: 'm-new-2', ownerPersonId: owner, recipientPersonIds: [recipient], at });
    const old = new Date(Date.now() - 400 * 86_400_000);
    await studio.deps.audit!.append({ kind: 'write', personaId: 'agent-x', memoryIds: ['m-old'], audiencePersonIds: [owner], outcome: 'applied', at: old });
    expect(readFileSync(join(dir, 'vox-audit.jsonl'), 'utf8')).toContain('m-old');

    delete globalState.__voxStudio;
    configure({ TIREH_SHARING_V2: '', TIREH_AUDIT_LOG: '' }, dir);
    studio = await getStudio();
    expect(studio.deps.memoryNotices).toBeUndefined();
    expect(studio.deps.audit).toBeUndefined();
    const notices = () => JSON.parse(readFileSync(join(dir, 'supersede-notices.json'), 'utf8')) as Array<{ oldMemoryId: string }>;
    expect(notices().map((n) => n.oldMemoryId).sort()).toEqual([erased.id, kept.id].sort());
    // A memory delete erases the notices naming it, with the flags off.
    await studio.deps.memory.memories.delete(erased.id);
    expect(notices().map((n) => n.oldMemoryId)).toEqual([kept.id]);
    // A rights erasure removes every notice naming the person.
    expect(await studio.forgetMemoryNotices(ID.alice)).toBe(1);
    expect(notices()).toEqual([]);
    // The 12-month vox_audit sweep runs without any append.
    await vi.waitFor(() => expect(readFileSync(join(dir, 'vox-audit.jsonl'), 'utf8')).not.toContain('m-old'));
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
