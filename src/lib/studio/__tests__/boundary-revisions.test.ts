/**
 * CI invariant: every input of the turn boundary hash has a monotonic revision
 * writer that the revision recheck observes, and a private text turn performs
 * one snapshot load and at most one revision read per recheck point.
 */
import { createHash } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { SharedMemoryRepository } from '../../adaptive/shared/repository';
import { SharedMemoryService } from '../../adaptive/shared/service';
import { BOUNDARY_HASH_INPUTS, PersonaGateway } from '../../tireh/gateway';
import { InProcessRevisionSource, type RevisionProbe } from '../../tireh/privacy/revisions';
import type { OrgDirectory } from '../../tireh/org/directory';
import type { ChatContext, Persona } from '../../tireh/types';
import { privateText } from '../../tireh/__tests__/fixtures';
import { canUseAgent } from '../permissions';
import { groupId, personId } from '../org-bridge';
import { closeFileStudios, fileStudio } from './file-studio';
import { hire, ID, makeStudio, seedOrg } from './helpers';

afterEach(async () => { vi.restoreAllMocks(); await closeFileStudios(); });

type HashInput = typeof BOUNDARY_HASH_INPUTS[number];
type Internals = {
  deps: { org: OrgDirectory; memories: { invalidate(id: string): Promise<void> }; history: { clearPersona(id: string): Promise<void> } };
  boundary(persona: Persona, chat: ChatContext, speakerId: string, space?: 'work' | 'personal'): Promise<Boundary>;
  unchanged(persona: Persona, chat: ChatContext, speakerId: string, boundary: Boundary): Promise<boolean>;
};
type Boundary = { key: string; audienceValid: boolean; revisions?: { snapshot: { vector: { probes: RevisionProbe[]; complete: boolean } }; memory: RevisionProbe; epoch: RevisionProbe } };

/** A group of two confirmed people on the file profile, with shared memory. */
async function groupEnv() {
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const now = Date.now();
  const accounts = [ID.alice, ID.bob];
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(mkdtempSync(join(tmpdir(), 'vox-inputs-')))), adaptiveOptionsFromManifest(JSON.stringify({
    schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: ['core_text'],
    accounts: accounts.map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: [{ schemaVersion: 1, id: 'core', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC', capability: 'core_text', state: 'approved',
      configurationVersion: 'synthetic', effectiveAt: now - 1, reviewExpiresAt: now + 86_400_000, owner: 'synthetic', approvalReference: 'synthetic' }],
  })));
  for (const id of accounts) {
    const confirmed = await adaptive.confirm(id, { confirm: true, adultConfirmed: true });
    await adaptive.setAgentAccess(id, agent.id, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: `grant-${id}` });
  }
  h.studio.deps.adaptive = adaptive;
  const store = h.store;
  const shared = new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(mkdtempSync(join(tmpdir(), 'vox-inputs-shared-')))), adaptive, {
    member: async telegramId => {
      const state = await store.read(), member = state.members.find(m => m.telegramId === telegramId);
      return { active: !!member && member.role !== 'pending', agentIds: member ? state.agents.filter(a => a.status === 'active' && canUseAgent(member, a)).map(a => a.id) : [] };
    },
    agent: async id => ({ active: (await store.read()).agents.some(a => a.id === id && a.status === 'active') }),
    group: async id => {
      const state = await store.read(), group = state.groups.find(g => groupId(g.chatId) === id);
      if (!group) return null;
      const memberTelegramIds = [...group.memberIds].sort((a, b) => a - b);
      return { memberTelegramIds, hasGuests: group.hasGuests, revision: createHash('sha256').update(JSON.stringify([id, memberTelegramIds, group.audienceEpoch ?? 0])).digest('hex') };
    },
  });
  h.studio.deps.shared = shared;
  const chatId = -777;
  await store.update(s => s.groups.push({ chatId, title: 'Synthetic group', memberIds: [...accounts], hasGuests: false, agentIds: [agent.id], addedAt: h.clock.now.toISOString() }));
  const gateway = (await h.studio.gateway()).gateway as unknown as Internals;
  const org = gateway.deps.org, group = org.getGroupByChatId(chatId)!;
  const chat: ChatContext = { kind: 'group', chatKey: `group-${group.id}`, group };
  return { h, agent, adaptive, shared, gateway, org, chat, persona: org.getPersona(agent.id)!, speaker: personId(ID.alice) };
}

type Env = Awaited<ReturnType<typeof groupEnv>>;
type Coverage =
  | { kind: 'turn'; because: string }
  | { kind: 'derived'; from: HashInput[] }
  | { kind: 'revision'; writer: string; mutate(env: Env): Promise<void> }
  | { kind: 'replayed'; writer: string; mutate(env: Env): void };

/** One entry per boundary hash input. Adding a hash input without a writer fails here. */
const COVERAGE: Record<HashInput, Coverage> = {
  space: { kind: 'turn', because: 'the boundary request carries it; every recheck recomputes the same space' },
  speakerId: { kind: 'turn', because: 'fixed by the turn; every recheck recomputes for the same speaker' },
  chat: { kind: 'revision', writer: 'StudioStore.update: group roster, guests and audienceEpoch (Studio state revision)',
    mutate: env => env.h.store.update(s => { const g = s.groups.find(row => row.chatId === -777)!; g.audienceEpoch = (g.audienceEpoch ?? 0) + 1; }) },
  allowed: { kind: 'derived', from: ['chat', 'config', 'audienceValid', 'states'] },
  audienceValid: { kind: 'revision', writer: 'StudioStore.update: agent status, access and blocks (Studio state revision)',
    mutate: env => env.h.store.update(s => { s.agents.find(a => a.id === env.agent.id)!.status = 'fired'; }) },
  shared: { kind: 'revision', writer: 'SharedMemoryRepository commit: the shared document revision (storage commit counter)',
    mutate: env => env.shared.repository.transaction(d => { d.revision++; }) },
  states: { kind: 'revision', writer: 'AdaptiveRepository commit: each member account document (storage commit counter)',
    mutate: async env => { await env.adaptive.setAgentAccess(ID.bob, env.agent.id, { space: 'work', allowed: false, expectedRevision: (await env.adaptive.read(ID.bob, 'work')).revision, eventId: 'withdraw-bob' }); } },
  config: { kind: 'replayed', writer: 'the gateway OrgDirectory (built from Studio state per gateway); every replay re-hashes it',
    mutate: env => { env.org.getPerson(personId(ID.bob))!.name = 'Renamed in place'; } },
};

async function readAll(boundary: Boundary): Promise<{ probes: RevisionProbe[]; values: number[] }> {
  const turn = boundary.revisions!;
  const probes = [...turn.snapshot.vector.probes, turn.memory, turn.epoch];
  return { probes, values: await new InProcessRevisionSource().read(probes) };
}

describe('every boundary hash input has a monotonic revision writer', () => {
  it('covers exactly the inputs the gateway hashes', () => {
    expect(Object.keys(COVERAGE)).toEqual([...BOUNDARY_HASH_INPUTS]);
    for (const [input, coverage] of Object.entries(COVERAGE)) {
      if (coverage.kind === 'derived') for (const from of coverage.from) expect(COVERAGE[from].kind, `${input} derives from ${from}`).not.toBe('derived');
    }
  });

  it.each(BOUNDARY_HASH_INPUTS.filter(input => COVERAGE[input].kind === 'revision'))('%s: a write advances a probed revision and the recheck sees it', async input => {
    const env = await groupEnv();
    const boundary = await env.gateway.boundary(env.persona, env.chat, env.speaker);
    expect(boundary.revisions?.snapshot.vector.complete).toBe(true);
    const before = await readAll(boundary);
    expect(before.values).toEqual(before.probes.map(p => p.value));
    await (COVERAGE[input] as Extract<Coverage, { kind: 'revision' }>).mutate(env);
    const after = await readAll(boundary);
    after.values.forEach((value, index) => expect(value).toBeGreaterThanOrEqual(before.values[index]));
    expect(after.values.some((value, index) => value > before.values[index])).toBe(true);
    const fresh = await env.gateway.boundary(env.persona, env.chat, env.speaker);
    expect(fresh.key === boundary.key && fresh.audienceValid).toBe(false);
    expect(await env.gateway.unchanged(env.persona, env.chat, env.speaker, boundary)).toBe(false);
  });

  it('config: an in-process change is re-hashed by the replay without any revision moving', async () => {
    const env = await groupEnv();
    const boundary = await env.gateway.boundary(env.persona, env.chat, env.speaker);
    expect(await env.gateway.unchanged(env.persona, env.chat, env.speaker, boundary)).toBe(true);
    const before = await readAll(boundary);
    (COVERAGE.config as Extract<Coverage, { kind: 'replayed' }>).mutate(env);
    expect((await readAll(boundary)).values).toEqual(before.values);
    expect(await env.gateway.unchanged(env.persona, env.chat, env.speaker, boundary)).toBe(false);
  });

  it('the strictly compared memory revision and privacy epoch advance on their writers', async () => {
    const env = await groupEnv();
    const boundary = await env.gateway.boundary(env.persona, env.chat, env.speaker);
    const turn = boundary.revisions!;
    await env.gateway.deps.memories.invalidate(env.persona.id);
    expect(turn.memory.local!()).toBe(turn.memory.value + 1);
    expect(await env.gateway.unchanged(env.persona, env.chat, env.speaker, boundary)).toBe(false);
    await env.gateway.deps.history.clearPersona(env.persona.id);
    expect(turn.epoch.local!()).toBe(turn.epoch.value + 1);
  });
});

describe('recheck cost', () => {
  it('a private text turn loads one snapshot and reads revisions at most once per recheck point', async () => {
    const { h, agent } = await fileStudio();
    await h.studio.adaptiveContext(agent.id, personId(ID.alice), 'work'); // settle first-read normalisation
    const { gateway } = await h.studio.gateway();
    const proto = PersonaGateway.prototype as unknown as Record<string, () => unknown>;
    const snapshots = vi.spyOn(h.studio, 'loadTurnSnapshot');
    const boundaries = vi.spyOn(proto, 'boundary');
    const rechecks = vi.spyOn(proto, 'unchanged');
    const reads = vi.spyOn(InProcessRevisionSource.prototype, 'read');
    expect(await gateway.handleUpdate(agent.id, privateText(ID.alice, 'Synthetic counted turn'))).toBe('replied');
    // One snapshot load; every later boundary (after relationship observation,
    // before memory writes) and every recheck is one revision read plus a replay.
    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(rechecks.mock.calls.length).toBeGreaterThan(0);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(rechecks.mock.calls.length + boundaries.mock.calls.length - 1);
  });
});
