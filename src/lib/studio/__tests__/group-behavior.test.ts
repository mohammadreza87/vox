import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { Studio } from '../service';
import { StudioStore } from '../store';
import type { GroupBehavior } from '../types';
import { draftJson, ID, makeStudio, seedOrg, type Harness } from './helpers';

const BOT_TOKEN = '555:fixture-group-settings-token';
let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let agentId: string;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
  h.personaLLM.push(draftJson());
  agentId = (await h.studio.draft(org.alice, {})).agent.id;
});

afterEach(() => { rmSync(h.dir, { recursive: true, force: true }); });

async function api(input: unknown, userId: number | null = ID.alice) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (userId !== null) headers['x-telegram-init-data'] = signInitData({ id: userId, first_name: 'Fixture visitor' }, BOT_TOKEN);
  const request = new Request(`https://fixture.invalid/api/studio/agents/${agentId}/group-behavior`, {
    method: 'PUT', headers, body: JSON.stringify(input),
  });
  const response = await handleStudioRequest(h.studio, request, ['agents', agentId, 'group-behavior'], { botToken: BOT_TOKEN, devUser: null });
  return { status: response.status, body: await response.json() };
}

describe('group behavior service', () => {
  it('presents balanced replies and remembering on for existing agents without rewriting them', async () => {
    const before = await h.store.read();
    expect(before.agents[0].groupBehavior).toBeUndefined();

    expect((await h.studio.getAgent(org.alice, agentId)).groupBehavior).toEqual({ participation: 'balanced', remember: true });
    expect((await h.studio.listAgents(org.admin))[0].groupBehavior).toEqual({ participation: 'balanced', remember: true });
    expect(await h.store.read()).toEqual(before);
  });

  it.each(['mentions', 'balanced', 'active'] as const)('persists %s with remembering off and a scoped audit record', async participation => {
    const behavior: GroupBehavior = { participation, remember: false };
    const before = await h.store.read();
    const started = Date.now();
    const view = await h.studio.setGroupBehavior(org.alice, agentId, behavior);
    const finished = Date.now();

    expect(view.groupBehavior).toEqual(behavior);
    const reloaded = new StudioStore(h.dir);
    const state = await reloaded.read();
    expect(state.agents[0]).toEqual({ ...before.agents[0], groupBehavior: behavior });
    expect(state.members).toEqual(before.members);
    expect(state.groups).toEqual(before.groups);
    expect(state.audit.slice(0, -1)).toEqual(before.audit);
    expect(state.audit.at(-1)).toMatchObject({
      actor: ID.alice, action: 'agent.group-behavior', target: agentId, detail: JSON.stringify(behavior),
    });
    const auditTime = Date.parse(state.audit.at(-1)!.at);
    expect(auditTime).toBeGreaterThanOrEqual(started);
    expect(auditTime).toBeLessThanOrEqual(finished);
    const restarted = new Studio({ ...h.studio.deps, store: reloaded });
    expect((await restarted.getAgent(org.alice, agentId)).groupBehavior).toEqual(behavior);
  });

  it.each(['alice', 'admin', 'superadmin'] as const)('allows %s to manage this agent’s group settings', async role => {
    const actor = org[role];
    const behavior: GroupBehavior = { participation: 'active', remember: true };
    expect((await h.studio.setGroupBehavior(actor, agentId, behavior)).groupBehavior).toEqual(behavior);
    expect((await h.store.read()).audit.at(-1)?.actor).toBe(actor.telegramId);
  });

  it('rejects an unrelated member without changing the agent or adding an audit event', async () => {
    const before = await h.store.read();
    await expect(h.studio.setGroupBehavior(org.bob, agentId, { participation: 'active', remember: true })).rejects.toMatchObject({ status: 403 });
    expect(await h.store.read()).toEqual(before);
  });

  it('returns not found for an unknown agent without writing an audit event', async () => {
    const before = await h.store.read();
    await expect(h.studio.setGroupBehavior(org.alice, 'missing-agent', { participation: 'active', remember: true })).rejects.toMatchObject({ status: 404 });
    expect(await h.store.read()).toEqual(before);
  });

  it.each([
    { label: 'null', input: null },
    { label: 'an empty object', input: {} },
    { label: 'an array', input: [] },
    { label: 'an unknown mode', input: { participation: 'always', remember: true } },
    { label: 'a mode with different casing', input: { participation: 'Active', remember: true } },
    { label: 'a numeric mode', input: { participation: 1, remember: true } },
    { label: 'a string boolean', input: { participation: 'balanced', remember: 'false' } },
    { label: 'a numeric boolean', input: { participation: 'balanced', remember: 0 } },
    { label: 'a missing boolean', input: { participation: 'balanced' } },
  ])('rejects $label without coercion or state changes', async ({ input }) => {
    const before = await h.store.read();
    await expect(h.studio.setGroupBehavior(org.alice, agentId, input)).rejects.toMatchObject({ status: 400 });
    expect(await h.store.read()).toEqual(before);
  });
});

describe('group behavior API', () => {
  it('accepts the exact client payload and returns the persisted settings', async () => {
    const behavior: GroupBehavior = { participation: 'mentions', remember: false };
    const result = await api(behavior);

    expect(result.status).toBe(200);
    expect(result.body.agent.groupBehavior).toEqual(behavior);
    expect((await new StudioStore(h.dir).read()).agents[0].groupBehavior).toEqual(behavior);
    expect((await h.store.read()).audit.at(-1)).toMatchObject({ action: 'agent.group-behavior', actor: ID.alice, target: agentId });
  });

  it.each([
    { label: 'an unsigned visitor', userId: null, status: 401 },
    { label: 'a pending member', userId: ID.pending, status: 403 },
    { label: 'an unrelated member', userId: ID.bob, status: 403 },
  ])('denies $label before changing group settings', async ({ userId, status }) => {
    const before = await h.store.read();
    const result = await api({ participation: 'active', remember: true }, userId);

    expect(result.status).toBe(status);
    const after = await h.store.read();
    expect(after.agents).toEqual(before.agents);
    expect(after.audit).toEqual(before.audit);
  });

  it.each([
    { participation: 'all', remember: true },
    { participation: 'active', remember: 'false' },
    { participation: 'mentions', remember: null },
    { participation: 'balanced' },
  ])('rejects invalid enum/boolean JSON at the HTTP boundary: %j', async input => {
    const before = await h.store.read();
    const result = await api(input);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/mentions, balanced or active/);
    const after = await h.store.read();
    expect(after.agents).toEqual(before.agents);
    expect(after.audit).toEqual(before.audit);
  });
});
