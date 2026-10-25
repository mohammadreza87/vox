/**
 * Main-lineage S08 cases (546f49e, acfc3a8, 8a7dc55) kept after the wave A S08
 * merge. sharing-v2.test.ts is wave A's file; these are main's cases that pass
 * against wave A's implementation and are not already covered there. Main's
 * cases that contradict wave A's implementation are listed by name in
 * docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md (S08).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { signInitData } from '../auth';
import { handleStudioRequest, type RouterOptions } from '../http';
import { groupId, personId, studioToOrgConfig } from '../org-bridge';
import type { StudioState } from '../types';
import type { NewMemory } from '../../tireh/memory/store';
import type { MemoryScope } from '../../tireh/types';
import { AdaptiveRepository, accountIdFor, digest } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { ManagedFileV2Storage } from '../../adaptive/persistence/indexed/managed-storage';
import { ProductPauseService } from '../../adaptive/product-pause/service';
import { SharedMemoryRepository } from '../../adaptive/shared/repository';
import { SharedMemoryService, type SharedAuthority } from '../../adaptive/shared/service';
import { hire, ID, makeStudio, memberOf, seedOrg, T0, type Harness } from './helpers';

// Adaptive file storage and full hire flows are slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));

const BOT_TOKEN = '555:voxx-test-token';
const opts: RouterOptions = { botToken: BOT_TOKEN, devUser: null };
const CHAT = -100777;
const CANARY = 'SHARING_V2_CANARY_4d1';

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
    source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: [`ml-ev-${++seq}`] },
    ...partial,
  };
}

const groupSource = () => ({ personId: personId(ID.alice), chatKind: 'group' as const, groupId: groupId(CHAT), at: T0, eventIds: [`ml-g-${++seq}`] });

async function groupSetup(memberIds = [ID.alice, ID.admin, ID.bob, ID.pending]) {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const { agent } = await hire(h, org.alice);
  await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'Team', memberIds, hasGuests: false, agentIds: [agent.id], addedAt: T0.toISOString() }); });
  const record = await h.memory.memories.add(mem(agent.id, { scope: { kind: 'group', groupId: groupId(CHAT) }, authorizedPersonIds: [personId(ID.admin), personId(ID.alice)], source: groupSource() }));
  return { h, org, agent, record };
}

describe('main lineage: org-bridge historyPolicy', () => {
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

describe('main lineage: HTTP with the flags off', () => {
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

describe('main lineage: inheritMemories with the flag off', () => {
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

// SharedMemoryService.readContext: setup copied from
// src/lib/adaptive/__tests__/shared-memory.test.ts and shared-pause-scope.test.ts.
const START = 1_800_000_000_000;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

async function sharedSetup(managed = false) {
  const root = await mkdtemp(join(tmpdir(), 'vox-sharing-v2-ml-')); roots.push(root);
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
  const create = async () => {
    const preview = await service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    const snapshot = await service.create(101, { space: 'work', eventId: 'create-001', expectedRevision: 0, previewToken: preview.previewToken, agentIds: ['aria'], text: 'SHARED_CANARY' });
    return snapshot.containers.at(-1)!;
  };
  return { service, adaptive, create, setGroup: (ids: number[], hasGuests = false) => { members = ids; guests = hasGuests; } };
}

const texts = (result: { memories: Array<{ text: string }> }) => result.memories.map((m) => m.text);

describe('main lineage: SharedMemoryService.readContext consent decoupling', () => {
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
