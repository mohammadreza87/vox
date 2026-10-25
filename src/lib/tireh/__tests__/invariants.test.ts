/**
 * The 14 sharing invariants from docs/AGENT_INTELLIGENCE_SOLUTION.md section
 * 4.6 and the memory review (Step 8). Each test is self-contained: it builds
 * its own stores, stubs the flags it needs and restores the environment, so
 * the file passes both with no flags set and under
 * TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type RuntimePrivacy, type RuntimePrivacyState } from '../gateway';
import { decideScope, type MemoryCandidate } from '../memory/extraction';
import { selectMemories } from '../memory/retrieval';
import { ownerRevokePatch, ownerSharePatch, validateShareRecipients } from '../memory/sharing';
import {
  createInMemoryStores, InMemoryMemoryStore, InMemoryUpdateDeduper, StaleMemoryWriteError, type NewMemory,
} from '../memory/store';
import {
  audienceOf, canPersonSee, historyMessageForChat, isMemoryAllowedInChat, isVisibleToAudience, selectHistoryForChat,
} from '../memory/visibility';
import { OrgDirectory } from '../org/directory';
import { auditMemoryStore, InMemoryAuditStore, InMemorySupersededNoticeStore } from '../audit';
import { buildSystemPrompt } from '../conversation/prompt';
import type { ChatContext, ChatMessage, MemoryRecord, MemoryScope } from '../types';
import { callback, GAMEEND_CHAT, groupText, LEADS_CHAT, makeGateway, memory, privateText, TG, testOrg, testOrgConfig } from './fixtures';
import { groupId as studioGroupId, personId, studioToOrg } from '../../studio/org-bridge';
import { draftJson, hire, ID, makeStudio, memberOf, seedOrg, T0 } from '../../studio/__tests__/helpers';

afterEach(() => { vi.unstubAllEnvs(); });
// Studio hire flows are slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const extraction = (...memories: Array<Record<string, unknown>>) => ({ memories });

function newMemory(overrides: Partial<NewMemory> & { scope: MemoryScope }): NewMemory {
  return {
    personaId: 'aria', content: 'invariant fixture', type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19T10:00:00Z'), eventIds: [`ev-${Math.random().toString(36).slice(2)}`] },
    ...overrides,
  };
}

class TombstoneStore extends InMemoryMemoryStore {
  async tombstonesOf(personaId: string): Promise<string[]> { return [...(this.tombstones.get(personaId) ?? [])].sort(); }
  async addTombstones(personaId: string, eventIds: readonly string[]): Promise<void> {
    const set = this.tombstones.get(personaId) ?? new Set<string>();
    for (const id of eventIds) set.add(id);
    this.tombstones.set(personaId, set);
  }
}

describe('sharing invariants (section 4.6)', () => {
  it('(1) every memory reaching a reply prompt is authorized for every reader and allowed by its scope', async () => {
    const { gateway, llm, memories, org } = makeGateway();
    const planted: MemoryRecord[] = [];
    const plant = async (token: string, scope: MemoryScope, authorizedPersonIds: string[] | undefined, groupId?: string) => {
      const at = new Date('2026-10-18T10:00:00Z');
      planted.push(await memories.add(newMemory({ content: `Launch plan note ${token}`, scope, authorizedPersonIds,
        source: groupId ? { personId: 'reza', chatKind: 'group', groupId, at, eventIds: [`src-${token}`] }
          : { personId: 'reza', chatKind: 'private', at, eventIds: [`src-${token}`] } })));
    };
    await plant('TOKEN_PRIVATE_REZA', { kind: 'private', personId: 'reza' }, ['reza']);
    await plant('TOKEN_PEOPLE_REZA_PARASTOO', { kind: 'people', personIds: ['parastoo', 'reza'] }, ['parastoo', 'reza']);
    await plant('TOKEN_GROUP_GAMEEND', { kind: 'group', groupId: 'gameend-team' }, ['milad', 'parastoo', 'reza'], 'gameend-team');
    await plant('TOKEN_GROUP_PARTIAL', { kind: 'group', groupId: 'gameend-team' }, ['parastoo', 'reza'], 'gameend-team');
    await plant('TOKEN_LEGACY_ORG', { kind: 'org' }, undefined);
    // Not authorized for Reza: must never reach a prompt Reza can read.
    await plant('UNAUTHORIZED_CANARY', { kind: 'people', personIds: ['milad', 'parastoo'] }, ['milad', 'parastoo']);
    const turns = [
      ...(['reza', 'parastoo', 'milad', 'sina'] as const).map((id) => ({ audience: [id as string], update: privateText(TG[id], 'What is the launch plan?') })),
      { audience: ['reza', 'parastoo', 'milad'], update: groupText(GAMEEND_CHAT, TG.reza, 'Aria, what is the launch plan?') },
      { audience: ['reza', 'parastoo'], update: groupText(LEADS_CHAT, TG.parastoo, 'Aria, what is the launch plan?') },
    ];
    let seen = 0;
    for (const turn of turns) {
      const before = llm.replyPrompts.length;
      await gateway.handleUpdate('aria', turn.update);
      expect(llm.replyPrompts.length).toBe(before + 1);
      const prompt = llm.replyPrompts.at(-1)!;
      for (const m of planted) {
        if (!prompt.includes(m.content)) continue;
        seen++;
        for (const reader of turn.audience) {
          expect(m.authorizedPersonIds ?? [], `${m.content.split(' ').at(-1)} -> ${reader}`).toContain(reader);
          expect(canPersonSee(org, reader, m.scope)).toBe(true);
        }
      }
      if (turn.audience.includes('reza')) expect(prompt).not.toContain('UNAUTHORIZED_CANARY');
      expect(prompt).not.toContain('TOKEN_LEGACY_ORG');
    }
    expect(llm.replyPrompts[0]).toContain('TOKEN_PRIVATE_REZA');
    expect(seen).toBeGreaterThan(2);
  });

  it('(2) a private chat has exactly one reader and never sees another person\'s private memory', async () => {
    expect(audienceOf({ kind: 'private', chatKey: 'private-reza', personId: 'reza' })).toEqual(['reza']);
    const { gateway, llm, memories } = makeGateway();
    await memories.add(newMemory({ content: 'PARASTOO_PRIVATE_CANARY', scope: { kind: 'private', personId: 'parastoo' }, authorizedPersonIds: ['parastoo'],
      source: { personId: 'parastoo', chatKind: 'private', at: new Date('2026-10-18T10:00:00Z'), eventIds: ['p-1'] } }));
    await gateway.handleUpdate('aria', privateText(TG.reza, 'What does Parastoo PARASTOO_PRIVATE_CANARY think?'));
    expect(llm.lastPrompt).not.toContain('PARASTOO_PRIVATE_CANARY');
    await gateway.handleUpdate('aria', privateText(TG.parastoo, 'What do you remember?'));
    expect(llm.lastPrompt).toContain('PARASTOO_PRIVATE_CANARY');
  });

  it('(3) guests or unknown readers get no memories, no history replay and no organization block', async () => {
    const config = testOrgConfig();
    const guestOrg = new OrgDirectory({ ...config, groups: config.groups.map((g) => (g.id === 'leads' ? { ...g, hasGuests: true } : g)) });
    const leads = guestOrg.getGroup('leads')!;
    const chat: ChatContext = { kind: 'group', chatKey: 'group-leads', group: leads };
    const record = memory({ content: 'MEMORY_CANARY', scope: { kind: 'group', groupId: 'leads' } });
    expect(isMemoryAllowedInChat(guestOrg, record, chat)).toBe(false);
    expect(selectMemories(guestOrg, [record], chat, { query: 'what do we know' })).toEqual([]);
    expect(buildSystemPrompt({ org: guestOrg, persona: guestOrg.getPersona('aria')!, chat, speakerId: 'reza', memories: [] })).not.toContain('## Organization');
    const stamped = historyMessageForChat(chat, { role: 'user', personId: 'parastoo', text: 'HISTORY_CANARY', at: new Date() });
    expect(selectHistoryForChat(guestOrg, [stamped], chat)).toEqual([]);
    const unknown: ChatContext = { kind: 'group', chatKey: 'group-leads', group: { ...testOrg().getGroup('leads')!, memberIds: ['reza', 'parastoo', 'ghost'] } };
    expect(isMemoryAllowedInChat(testOrg(), memory({ content: 'x', scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: ['reza', 'parastoo', 'ghost'] }), unknown)).toBe(false);
    expect(selectHistoryForChat(testOrg(), [historyMessageForChat(unknown, { role: 'user', personId: 'reza', text: 'x', at: new Date() })], unknown)).toEqual([]);
    expect(selectMemories(testOrg(), [memory({ content: 'x', scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: ['reza', 'parastoo', 'ghost'] })], unknown, { query: 'x' })).toEqual([]);
    expect(buildSystemPrompt({ org: testOrg(), persona: testOrg().getPersona('aria')!, chat: unknown, speakerId: 'reza', memories: [] })).not.toContain('## Organization');

    const ctx = makeGateway();
    const gateway = new PersonaGateway({ ...ctx, org: guestOrg, voice: null, deduper: new InMemoryUpdateDeduper(), botFor: () => ctx.bot as never });
    await ctx.memories.add(newMemory({ content: 'MEMORY_CANARY', scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: ['parastoo', 'reza'],
      source: { personId: 'parastoo', chatKind: 'group', groupId: 'leads', at: new Date('2026-10-18T10:00:00Z'), eventIds: ['g-1'] } }));
    await ctx.history.append('aria', 'group-leads', stamped);
    await gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.reza, 'Aria, what do we know?'));
    const sent = JSON.stringify(ctx.llm.replyRequests);
    expect(ctx.llm.replyRequests.length).toBeGreaterThan(0);
    for (const hidden of ['MEMORY_CANARY', 'HISTORY_CANARY', '## Organization']) expect(sent).not.toContain(hidden);
  });

  it('(4) personal and confidential records stay one-to-one with the owner and are never shareable', () => {
    const org = testOrg();
    for (const sensitivity of ['personal', 'confidential'] as const) {
      const m = memory({ content: 'x', scope: { kind: 'private', personId: 'reza' }, sensitivity });
      expect(isVisibleToAudience(org, m, ['reza'])).toBe(true);
      expect(isVisibleToAudience(org, m, ['reza', 'parastoo'])).toBe(false);
      expect(isVisibleToAudience(org, m, ['parastoo'])).toBe(false);
      expect(isVisibleToAudience(org, { ...m, scope: { kind: 'people', personIds: ['reza', 'parastoo'] } }, ['reza'])).toBe(false);
      expect(() => ownerSharePatch(org, m, 'reza', ['parastoo'])).toThrow('Sensitive memories remain private.');
    }
  });

  it('(5) sharing needs the owner, valid recipients and the current share version', async () => {
    const org = new OrgDirectory({ ...testOrgConfig(), people: [...testOrgConfig().people, { id: 'gwen', name: 'Gwen', role: 'Guest', companyIds: [], projectIds: [], guest: true }] });
    const m = memory({ content: 'x', scope: { kind: 'private', personId: 'reza' } });
    expect(() => ownerSharePatch(org, m, 'parastoo', ['milad'])).toThrow();
    for (const recipients of [['gwen'], ['unknown'], ['milad']]) {
      expect(() => validateShareRecipients(org, recipients, { mayUseAgent: (id) => id !== 'milad' })).toThrow();
    }
    const store = new InMemoryMemoryStore();
    const stored = await store.add(newMemory({ scope: { kind: 'private', personId: 'reza' }, authorizedPersonIds: ['reza'] }));
    expect(await store.updateIfShareVersion(stored.id, 1, ownerSharePatch(org, stored, 'reza', ['parastoo']))).toBe(false);

    const { gateway, llm, memories, bot } = makeGateway();
    llm.nextExtraction = extraction({ content: 'Launch is Friday', type: 'decision', kind: 'work', projectId: 'gameend' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'Launch is Friday'));
    const offer = bot.sent.find((s) => s.text?.includes('Should I share'))!;
    const data = (offer.options as { keyboard: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).keyboard.inline_keyboard[0][0].callback_data;
    const record = [...memories.records.values()][0];
    await memories.updateIfShareVersion(record.id, 0, { authorizedPersonIds: ['reza'], shareVersion: 1 });
    await gateway.handleUpdate('aria', callback(TG.reza, data));
    expect(bot.sent.at(-1)?.text).toBe('That memory has since been changed or deleted.');
    expect((await memories.get(record.id))?.scope).toEqual({ kind: 'private', personId: 'reza' });
  });

  it('(6) group facts are never promoted to a project or the org', async () => {
    const org = testOrg();
    const chat: ChatContext = { kind: 'group', chatKey: 'group-gameend-team', group: org.getGroup('gameend-team')! };
    const candidate: MemoryCandidate = { content: 'Launch is Friday', type: 'decision', kind: 'work', confidential: false, about: [], confidence: 0.9, projectId: 'gameend' };
    const decision = decideScope(org, chat, 'reza', candidate);
    expect(decision.scope).toEqual({ kind: 'group', groupId: 'gameend-team' });
    expect(decision.offerScope).toBeUndefined();

    const { gateway, llm, offers, memories } = makeGateway();
    llm.nextExtraction = extraction({ content: 'GameEnd launch is Friday', type: 'decision', kind: 'work', projectId: 'gameend' });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, we decided: launch is Friday'));
    expect([...memories.records.values()].map((m) => m.scope)).toEqual([{ kind: 'group', groupId: 'gameend-team' }]);
    expect(offers.offers.size).toBe(0);
  });

  it('(7) membership growth never widens a snapshot except through the explicit, audited re-snapshot', async () => {
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    const { agent } = await hire(h, org.alice);
    const CHAT = -100888;
    const gid = studioGroupId(CHAT);
    await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'Team', memberIds: [ID.alice], hasGuests: false, agentIds: [agent.id], addedAt: T0.toISOString() }); });
    const alice = personId(ID.alice), bob = personId(ID.bob);
    const record = await h.memory.memories.add(newMemory({ personaId: agent.id, scope: { kind: 'group', groupId: gid }, authorizedPersonIds: [alice],
      source: { personId: alice, chatKind: 'group', groupId: gid, at: T0, eventIds: ['grp-1'] } }));
    await h.studio.noteGroupSpeaker(CHAT, { id: ID.bob, first_name: 'Bob' });
    await h.studio.noteGroupMembership(CHAT, { id: ID.bob, first_name: 'Bob', is_bot: false }, 'member');
    const user = { id: ID.bob, first_name: 'Bob', is_bot: false };
    await h.studio.onGroupChatMember({ chat: { id: CHAT, type: 'supergroup' }, from: user, date: 1, old_chat_member: { status: 'left', user }, new_chat_member: { status: 'member', user } });
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual([alice]);
    expect(isVisibleToAudience(studioToOrg(await h.store.read()), (await h.memory.memories.get(record.id))!, [alice, bob])).toBe(false);

    vi.stubEnv('TIREH_SHARING_V2', '1');
    const admin = org.admin;
    expect(await h.studio.resnapshotGroupMemory(admin, CHAT, ID.bob, false)).toEqual({ count: 1, applied: false });
    expect((await h.memory.memories.get(record.id))!.authorizedPersonIds).toEqual([alice]);
    expect(await h.studio.resnapshotGroupMemory(admin, CHAT, ID.bob, true)).toEqual({ count: 1, applied: true });
    const after = (await h.memory.memories.get(record.id))!;
    expect(after.authorizedPersonIds).toEqual([alice, bob].sort());
    expect(after.shareVersion).toBe((record.shareVersion ?? 0) + 1);
    expect((await h.store.read()).audit.filter((e) => e.action === 'memory.resnapshot')).toHaveLength(1);
  });

  it('(8) revoke narrows at once and clears persona history', async () => {
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    const { agent } = await hire(h, org.alice);
    const pair = [personId(ID.alice), personId(ID.bob)].sort();
    const record = await h.memory.memories.add(newMemory({ personaId: agent.id, content: 'REVOKE_CANARY', scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair,
      source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: ['rv-1'] } }));
    await h.memory.history.append(agent.id, `private-${personId(ID.bob)}`, { role: 'user', personId: personId(ID.bob), text: 'hello', at: T0 });
    expect((await h.studio.memoriesFor(org.bob, agent.id)).map((m) => m.id)).toEqual([record.id]);
    const directory = studioToOrg(await h.store.read());
    expect(isVisibleToAudience(directory, { ...record, ...ownerRevokePatch(record, personId(ID.alice)) }, [personId(ID.bob)])).toBe(false);
    const epoch = await h.memory.history.getEpoch(agent.id);
    await h.studio.revokeMemory(org.alice, agent.id, record.id);
    expect(await h.studio.memoriesFor(org.bob, agent.id)).toEqual([]);
    expect(await h.memory.history.getEpoch(agent.id)).toBe(epoch + 1);
    expect(await h.memory.history.recent(agent.id, `private-${personId(ID.bob)}`, 20)).toEqual([]);
  });

  it('(9) gateway forgetMemory removes the closure and leaves tombstones, so a replay cannot relearn', async () => {
    const { gateway, memories } = makeGateway();
    const source = { personId: 'reza', chatKind: 'private' as const, at: new Date('2026-10-18T10:00:00Z'), eventIds: ['tomb-1'] };
    const input = newMemory({ scope: { kind: 'private', personId: 'reza' }, authorizedPersonIds: ['reza'], source });
    const record = await memories.add(input);
    const correction = await memories.add(newMemory({ scope: { kind: 'private', personId: 'reza' }, authorizedPersonIds: ['reza'], supersedes: record.id,
      source: { ...source, eventIds: ['tomb-2'] } }));
    await gateway.forgetMemory('aria', correction.id);
    expect(await memories.get(record.id)).toBeNull();
    expect(await memories.get(correction.id)).toBeNull();
    expect([...(memories.tombstones.get('aria') ?? [])].sort()).toEqual(['tomb-1', 'tomb-2']);
    await expect(memories.add(input)).rejects.toBeInstanceOf(StaleMemoryWriteError);
  });

  it('(10) superseded records are never retrieved, and recipients get a notice only under TIREH_SHARING_V2', async () => {
    const org = testOrg();
    const chat: ChatContext = { kind: 'private', chatKey: 'private-parastoo', personId: 'parastoo' };
    const old = memory({ content: 'Launch is Friday', scope: { kind: 'people', personIds: ['parastoo', 'reza'] }, supersededBy: 'm-new' });
    expect(isVisibleToAudience(org, old, ['parastoo'])).toBe(false);
    expect(selectMemories(org, [old], chat, { query: 'launch' })).toEqual([]);

    const scenario = async () => {
      const h = makeStudio({ adaptive: false });
      const people = await seedOrg(h);
      const { agent } = await hire(h, people.alice);
      const notices = new InMemorySupersededNoticeStore();
      h.studio.deps.memoryNotices = notices;
      h.studio.deps.memory = { ...h.studio.deps.memory, memories: auditMemoryStore(h.memory.memories, new InMemoryAuditStore(), notices) };
      const pair = [personId(ID.alice), personId(ID.bob)].sort();
      const shared = await h.studio.deps.memory.memories.add(newMemory({ personaId: agent.id, scope: { kind: 'people', personIds: pair }, authorizedPersonIds: pair,
        source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: ['n-1'] } }));
      await h.studio.deps.memory.memories.add(newMemory({ personaId: agent.id, scope: { kind: 'private', personId: personId(ID.alice) }, authorizedPersonIds: [personId(ID.alice)],
        supersedes: shared.id, source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: ['n-2'] } }));
      return { notices: await h.studio.memoryNoticesFor(await memberOf(h, ID.bob), agent.id), shared, stored: notices.notices.length };
    };
    vi.stubEnv('TIREH_SHARING_V2', '');
    expect(await scenario()).toMatchObject({ notices: [], stored: 0 });
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const on = await scenario();
    expect(on.notices).toEqual([expect.objectContaining({ oldMemoryId: on.shared.id, from: 'Alice', replacementVisible: false })]);
  });

  it('(11) Work and Personal never cross', async () => {
    // setupPrivacy pattern from history-privacy.test.ts.
    const ctx = makeGateway();
    let state: RuntimePrivacyState = { revision: '1', memoryEnabled: true, historyEnabled: true };
    const privacy: RuntimePrivacy = { read: async () => state, validateAudience: async () => true };
    const gateway = new PersonaGateway({ ...ctx, voice: null, deduper: new InMemoryUpdateDeduper(), botFor: () => ctx.bot as never, runtimePrivacy: privacy, now: () => new Date('2026-10-19T10:00:00Z') });
    ctx.llm.nextExtraction = extraction({ content: 'WORK_CANARY', type: 'fact', kind: 'work', confidence: 0.9 });
    await gateway.converse('aria', 'reza', 'WORK_CANARY');
    expect((await ctx.memories.listActive('aria')).map((m) => m.content)).toEqual(['WORK_CANARY']);
    state = { ...state, revision: '2' };
    await gateway.converse('aria', 'reza', 'hello', { space: 'personal' });
    expect(JSON.stringify(ctx.llm.replyRequests.at(-1))).not.toContain('WORK_CANARY');
    expect(ctx.llm.replyPrompts.at(-1)).not.toContain('WORK_CANARY');
  });

  it('(12) a successor copies only normal group/people/project records and carries tombstones', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const scenario = async (store: InMemoryMemoryStore) => {
      const h = makeStudio({ adaptive: false });
      const org = await seedOrg(h);
      h.studio.deps.memory = { ...h.studio.deps.memory, memories: store };
      const { agent: old } = await hire(h, org.alice);
      const pair = [personId(ID.alice), personId(ID.bob)].sort();
      const add = (content: string, scope: MemoryScope, extra: Partial<NewMemory> = {}) => store.add(newMemory({ personaId: old.id, content, scope, authorizedPersonIds: pair,
        source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: [`src-${content}`] }, ...extra }));
      await add('PRIVATE', { kind: 'private', personId: personId(ID.alice) }, { authorizedPersonIds: [personId(ID.alice)] });
      await add('PERSONAL', { kind: 'people', personIds: pair }, { sensitivity: 'personal' });
      await add('PEOPLE', { kind: 'people', personIds: pair });
      await add('GROUP', { kind: 'group', groupId: 'chat-1' });
      await add('PROJECT', { kind: 'project', projectId: 'p1' });
      await add('CONFIDENTIAL', { kind: 'group', groupId: 'chat-1' }, { sensitivity: 'confidential' });
      await add('COMPANY', { kind: 'company', companyId: 'c1' });
      await add('ORG', { kind: 'org' });
      const gone = await add('GONE', { kind: 'group', groupId: 'chat-1' });
      await store.delete(gone.id);
      // Active, but its lineage was already tombstoned for the predecessor.
      await add('LINEAGE', { kind: 'group', groupId: 'chat-1' });
      if (store instanceof TombstoneStore) await store.addTombstones(old.id, ['src-LINEAGE']);
      await h.studio.fire(org.admin, old.id, { reason: 'reset', memoryPolicy: 'transfer', confirmName: 'Nova' });
      h.personaLLM.push(draftJson({ name: 'Nova Two' }));
      const { agent: next } = await hire(h, org.alice, { name: 'Nova Two' }, old.id);
      return { old, next, gone };
    };
    const carrier = new TombstoneStore();
    const { old, next, gone } = await scenario(carrier);
    expect((await carrier.listActive(next.id)).map((m) => m.content).sort()).toEqual(['GROUP', 'PEOPLE', 'PROJECT']);
    expect(await carrier.tombstonesOf(next.id)).toEqual(await carrier.tombstonesOf(old.id));
    await expect(carrier.add(newMemory({ personaId: next.id, scope: { kind: 'group', groupId: 'chat-1' }, source: gone.source }))).rejects.toBeInstanceOf(StaleMemoryWriteError);

    const plain = new InMemoryMemoryStore();
    // An older adapter lacking the optional S06 tombstone carrier.
    Object.defineProperties(plain, { tombstonesOf: { value: undefined }, addTombstones: { value: undefined } });
    const plainRun = await scenario(plain);
    expect(await plain.listActive(plainRun.next.id)).toEqual([]);
  });

  it('(13) history replays only with a matching privacy stamp and audience', async () => {
    const { memories, history } = createInMemoryStores();
    const record = await memories.add(newMemory({ scope: { kind: 'private', personId: 'reza' }, authorizedPersonIds: ['reza'] }));
    await memories.update(record.id, { confidence: 0.5 });
    expect(await memories.safetyRevision('aria')).toBe(1);
    const stale: ChatMessage = { role: 'user', personId: 'reza', text: 'STALE', at: new Date(), privacy: { policyKey: 'k', memoryRevision: 0, sourceEventIds: [], memoryIds: [] } };
    await history.append('aria', 'private-reza', stale);
    expect(await history.recent('aria', 'private-reza', 10)).toEqual([]);
    await history.append('aria', 'private-reza', { ...stale, text: 'CURRENT', privacy: { ...stale.privacy!, memoryRevision: 1 } });
    expect((await history.recent('aria', 'private-reza', 10)).map((m) => m.text)).toEqual(['CURRENT']);

    const org = testOrg();
    const chat: ChatContext = { kind: 'group', chatKey: 'group-leads', group: org.getGroup('leads')! };
    const legacy: ChatMessage = { role: 'user', personId: 'reza', text: 'LEGACY', at: new Date() };
    const otherAudience: ChatMessage = { ...legacy, text: 'OTHER', audiencePersonIds: ['reza'] };
    expect(selectHistoryForChat(org, [legacy, otherAudience], chat)).toEqual([]);
    const current = historyMessageForChat(chat, legacy);
    expect(selectHistoryForChat(org, [legacy, otherAudience, current], chat)).toEqual([current]);
  });

  it('(14) model output never widens scope or grants access', async () => {
    const { gateway, llm, memories, offers } = makeGateway();
    llm.nextExtraction = extraction({ content: 'Reza likes weekly demos', type: 'preference', kind: 'work', scope: { kind: 'org' },
      authorizedPersonIds: ['reza', 'parastoo', 'milad', 'sina'], sensitivity: 'normal' });
    await gateway.handleUpdate('aria', privateText(TG.reza, 'I like weekly demos'));
    const [stored] = await memories.listActive('aria');
    expect(stored.scope).toEqual({ kind: 'private', personId: 'reza' });
    expect(stored.authorizedPersonIds).toEqual(['reza']);
    expect([...offers.offers.values()].every((offer) => offer.status === 'pending')).toBe(true);

    llm.nextExtraction = extraction({ content: 'Milad approved the budget', type: 'decision', kind: 'work', saidBy: 'milad' });
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria, the budget is approved'));
    expect((await memories.listActive('aria')).map((m) => m.content)).toEqual(['Reza likes weekly demos']);
  });
});
