/**
 * S08 hardening (F033): the admin re-snapshot preview can show what becomes
 * visible as ids and per-agent counts, never content. The detail is opt-in
 * ({ detail: true } / body `detail: true`) so the existing count-only preview
 * body stays exactly as before; count is always present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest, type RouterOptions } from '../http';
import { groupId, personId } from '../org-bridge';
import { InMemoryAuditStore, MAX_AUDIT_IDS } from '../../tireh/audit';
import type { NewMemory } from '../../tireh/memory/store';
import type { MemoryScope } from '../../tireh/types';
import { hire, ID, makeStudio, seedOrg, T0, type Harness } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));

const BOT_TOKEN = '555:voxx-test-token';
const opts: RouterOptions = { botToken: BOT_TOKEN, devUser: null };
const CHAT = -100779;
const CANARY = 'RESNAPSHOT_PREVIEW_CANARY_5e8';
const AUTH = () => [personId(ID.admin), personId(ID.alice)].sort();
const CONTENT_KEYS = ['content', 'topic', 'type', 'sensitivity', 'scope', 'source', 'aboutPersonIds', 'authorizedPersonIds'];

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
function mem(agentId: string, partial: Partial<NewMemory> = {}): NewMemory {
  const scope: MemoryScope = { kind: 'group', groupId: groupId(CHAT) };
  return {
    personaId: agentId, content: `${CANARY} fact`, topic: CANARY, type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    scope, authorizedPersonIds: AUTH(),
    source: { personId: personId(ID.alice), chatKind: 'group', groupId: groupId(CHAT), at: T0, eventIds: [`pv-${++seq}`] },
    ...partial,
  };
}

async function setup() {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const { agent: first } = await hire(h, org.alice, { name: 'Nova' });
  const { agent: second } = await hire(h, org.alice, { name: 'Lumen' });
  await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'Team', memberIds: [ID.alice, ID.admin, ID.bob], hasGuests: false, agentIds: [first.id, second.id], addedAt: T0.toISOString() }); });
  const targets = [
    await h.memory.memories.add(mem(first.id)),
    await h.memory.memories.add(mem(first.id)),
    await h.memory.memories.add(mem(second.id)),
  ];
  // Not targets: a personal-sensitivity record, and a record of another group.
  await h.memory.memories.add(mem(first.id, { sensitivity: 'personal' }));
  await h.memory.memories.add(mem(second.id, { scope: { kind: 'group', groupId: groupId(-100555) }, source: { personId: personId(ID.alice), chatKind: 'group', groupId: groupId(-100555), at: T0, eventIds: [`pv-${++seq}`] } }));
  return { h, org, first, second, targets };
}

describe('re-snapshot preview detail (TIREH_SHARING_V2=1)', () => {
  beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); vi.stubEnv('TIREH_AUDIT_LOG', ''); });

  it('returns byAgent and memoryIds matching the targets, with no content fields, and changes nothing', async () => {
    const { h, org, first, second, targets } = await setup();
    const preview = await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, false, { detail: true });
    expect(preview.count).toBe(3);
    expect(preview.applied).toBe(false);
    expect(preview.byAgent).toEqual({ [first.id]: 2, [second.id]: 1 });
    expect([...preview.memoryIds!].sort()).toEqual(targets.map((t) => t.id).sort());
    expect(Object.keys(preview).sort()).toEqual(['applied', 'byAgent', 'count', 'memoryIds']);
    expect(preview.memoryIds!.every((id) => typeof id === 'string')).toBe(true);
    const body = JSON.stringify(preview);
    expect(body).not.toContain(CANARY);
    for (const key of CONTENT_KEYS) expect(body).not.toContain(`"${key}"`);
    for (const t of targets) expect((await h.memory.memories.get(t.id))!.authorizedPersonIds).toEqual(AUTH());
  });

  it('without detail the preview body is exactly { count, applied } (unchanged)', async () => {
    const { h, org } = await setup();
    expect(await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, false)).toEqual({ count: 3, applied: false });
  });

  it('apply never carries the detail', async () => {
    const { h, org } = await setup();
    expect(await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, true, { detail: true })).toEqual({ count: 3, applied: true });
  });

  it('HTTP: detail:true returns ids and counts; only admins reach it', async () => {
    const { h, first, second, targets } = await setup();
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.alice, { telegramId: ID.bob, detail: true }))).status).toBe(403);
    const res = await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob, detail: true }));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ count: 3, applied: false, byAgent: { [first.id]: 2, [second.id]: 1 }, memoryIds: expect.any(Array) });
    expect([...(res.json.memoryIds as string[])].sort()).toEqual(targets.map((t) => t.id).sort());
    expect(JSON.stringify(res.json)).not.toContain(CANARY);
    expect((await call(h, req('POST', `groups/${CHAT}/resnapshot`, ID.admin, { telegramId: ID.bob }))).json).toEqual({ count: 3, applied: false });
  });

  it('with TIREH_AUDIT_LOG=1 the previewed vox_audit rows still batch at MAX_AUDIT_IDS', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const { h, org, first, targets } = await setup();
    const ids = targets.filter((t) => t.personaId === first.id).map((t) => t.id);
    for (let i = 0; i < MAX_AUDIT_IDS; i++) ids.push((await h.memory.memories.add(mem(first.id))).id);
    const audit = new InMemoryAuditStore();
    h.studio.deps.audit = audit;
    const preview = await h.studio.resnapshotGroupMemory(org.admin, CHAT, ID.bob, false, { detail: true });
    expect(preview.byAgent![first.id]).toBe(ids.length);
    const rows = audit.rows.filter((r) => r.outcome === 'previewed' && r.personaId === first.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.memoryIds.length <= MAX_AUDIT_IDS)).toBe(true);
    expect(rows.flatMap((r) => r.memoryIds).sort()).toEqual([...ids].sort());
  });
});
