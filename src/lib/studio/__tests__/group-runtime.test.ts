import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupAction } from '../../tireh/gateway';
import { groupId, personId } from '../org-bridge';
import { GroupWindow } from '../../tireh/conversation/group-window';
import { Studio } from '../service';
import { StudioStore } from '../store';
import type { Agent, StudioState } from '../types';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const CHAT = -9001;
const OTHER_CHAT = -9002;
const ACTIONS: GroupAction[] = ['observe', 'reply', 'proactive', 'remember'];
let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let first: Agent;
let second: Agent;

beforeEach(async () => {
  vi.stubEnv('STUDIO_GROUP_OBSERVATION', 'on');
  h = makeStudio();
  org = await seedOrg(h);
  first = (await hire(h, org.alice, { name: 'First' }, undefined, 'private')).agent;
  second = (await hire(h, org.alice, { name: 'Second' }, undefined, 'private')).agent;
  await h.store.update((state) => {
    for (const chatId of [CHAT, OTHER_CHAT]) state.groups.push({
      chatId, title: 'Synthetic group', memberIds: [ID.alice, ID.bob], hasGuests: false,
      agentIds: [first.id, second.id], addedBy: ID.alice, addedAt: h.clock.now.toISOString(),
    });
  });
});
afterEach(() => vi.unstubAllEnvs());

function advance(ms: number) { h.clock.now = new Date(h.clock.now.getTime() + ms); }
function restart() { return new Studio({ ...h.studio.deps, store: new StudioStore(h.dir) }); }

describe('Studio.groupAllowed', () => {
  it('permits a registered group participant even when the agent is private in direct messages', async () => {
    for (const action of ACTIONS) expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, action)).toBe(true);
  });

  it.each<[{ name: string; revoke: (state: StudioState) => void }]>([
    [{ name: 'unknown agent', revoke: (state) => { state.agents = state.agents.filter((a) => a.id !== first.id); } }],
    [{ name: 'unregistered group', revoke: (state) => { state.groups = state.groups.filter((g) => g.chatId !== CHAT); } }],
    [{ name: 'agent removed from group', revoke: (state) => { state.groups.find((g) => g.chatId === CHAT)!.agentIds = [second.id]; } }],
    [{ name: 'participant removed from group', revoke: (state) => { state.groups.find((g) => g.chatId === CHAT)!.memberIds = [ID.alice]; } }],
    [{ name: 'participant blocked', revoke: (state) => { state.agents.find((a) => a.id === first.id)!.blocked = [ID.bob]; } }],
    [{ name: 'agent fired', revoke: (state) => { state.agents.find((a) => a.id === first.id)!.status = 'fired'; } }],
  ])('rechecks all actions after $name', async ({ revoke }) => {
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'reply')).toBe(true);
    await h.store.update(revoke);
    for (const action of ACTIONS) expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, action)).toBe(false);
  });

  it('keeps direct replies and requested remembering available when passive observation is disabled', async () => {
    vi.stubEnv('STUDIO_GROUP_OBSERVATION', 'off');
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'observe')).toBe(false);
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'proactive')).toBe(false);
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'reply')).toBe(true);
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'remember')).toBe(true);
    expect(await h.studio.claimGroupReply(first.id, CHAT, 10)).toBe(false);
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 10)).toBe(true);
  });

  it('keeps reply mode and remembering as independent controls', async () => {
    await h.studio.setGroupBehavior(org.alice, first.id, { participation: 'mentions', remember: true });
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'proactive')).toBe(false);
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'observe')).toBe(true);
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'reply')).toBe(true);
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'remember')).toBe(true);
    await h.studio.setGroupBehavior(org.alice, first.id, { participation: 'active', remember: false });
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'proactive')).toBe(true);
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'remember')).toBe(false);
  });
});

describe('Studio.claimGroupReply', () => {
  it('shares a balanced cooldown across agents and never claims one message twice', async () => {
    expect(await h.studio.claimGroupReply(first.id, CHAT, 10)).toBe(true);
    expect(await h.studio.claimGroupReply(second.id, CHAT, 11)).toBe(false);
    advance(44_999);
    expect(await h.studio.claimGroupReply(second.id, CHAT, 11)).toBe(false);
    advance(1);
    expect(await h.studio.claimGroupReply(second.id, CHAT, 11)).toBe(true);
    advance(45_000);
    expect(await h.studio.claimGroupReply(first.id, CHAT, 11)).toBe(false);
    expect(await h.studio.claimGroupReply(first.id, CHAT, 10)).toBe(false);
    expect(await h.studio.claimGroupReply(first.id, OTHER_CHAT, 10)).toBe(true);
  });

  it('caps balanced replies at three in five minutes and resets exactly at the window boundary', async () => {
    expect(await h.studio.claimGroupReply(first.id, CHAT, 1)).toBe(true);
    advance(45_000);
    expect(await h.studio.claimGroupReply(second.id, CHAT, 2)).toBe(true);
    advance(45_000);
    expect(await h.studio.claimGroupReply(first.id, CHAT, 3)).toBe(true);
    advance(209_999);
    expect(await h.studio.claimGroupReply(second.id, CHAT, 4)).toBe(false);
    advance(1);
    expect(await h.studio.claimGroupReply(second.id, CHAT, 4)).toBe(true);
    expect((await h.store.read()).groups.find((g) => g.chatId === CHAT)?.proactive?.count).toBe(1);
  });

  it('allows active mode every 20 seconds up to six replies per five-minute window', async () => {
    await h.studio.setGroupBehavior(org.alice, first.id, { participation: 'active', remember: true });
    for (let messageId = 1; messageId <= 6; messageId++) {
      expect(await h.studio.claimGroupReply(first.id, CHAT, messageId)).toBe(true);
      if (messageId < 6) {
        advance(19_999);
        expect(await h.studio.claimGroupReply(first.id, CHAT, messageId + 1)).toBe(false);
        advance(1);
      }
    }
    advance(20_000);
    expect(await h.studio.claimGroupReply(first.id, CHAT, 7)).toBe(false);
    advance(180_000);
    expect(await h.studio.claimGroupReply(first.id, CHAT, 7)).toBe(true);
  });

  it('names why a claim was refused, for content-free diagnostics', async () => {
    expect(await h.studio.groupReplyClaim(first.id, CHAT, 10)).toBe(true);
    expect(await h.studio.groupReplyClaim(second.id, CHAT, 10)).toBe('duplicate');
    expect(await h.studio.groupReplyClaim(second.id, CHAT, 11)).toBe('cooldown');
    for (const messageId of [11, 12]) { advance(45_000); expect(await h.studio.groupReplyClaim(first.id, CHAT, messageId)).toBe(true); }
    advance(45_000);
    expect(await h.studio.groupReplyClaim(first.id, CHAT, 13)).toBe('window');
    await h.studio.setGroupBehavior(org.alice, first.id, { participation: 'mentions', remember: true });
    expect(await h.studio.groupReplyClaim(first.id, CHAT, 14)).toBe(false);
  });

  it('serializes competing claims from two agents into one group reply', async () => {
    const claimed = await Promise.all([
      h.studio.claimGroupReply(first.id, CHAT, 30), h.studio.claimGroupReply(second.id, CHAT, 30),
      h.studio.claimGroupReply(first.id, CHAT, 31), h.studio.claimGroupReply(second.id, CHAT, 31),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    const throttle = (await h.store.read()).groups.find((g) => g.chatId === CHAT)?.proactive;
    expect(throttle).toMatchObject({ count: 1, messageId: 30 });
  });

  it('persists cooldown, budget and message claims across a fresh Studio/store instance', async () => {
    await h.studio.claimGroupReply(first.id, CHAT, 10);
    advance(45_000);
    await h.studio.claimGroupReply(second.id, CHAT, 11);
    advance(45_000);
    await h.studio.claimGroupReply(first.id, CHAT, 12);
    const resumed = restart();
    expect(await resumed.claimGroupReply(second.id, CHAT, 13)).toBe(false);
    advance(45_000);
    expect(await resumed.claimGroupReply(second.id, CHAT, 13)).toBe(false);
    advance(165_000);
    expect(await resumed.claimGroupReply(second.id, CHAT, 12)).toBe(false);
    expect(await resumed.claimGroupReply(second.id, CHAT, 13)).toBe(true);
  });

  it('rechecks the current mode and registration before consuming a claim', async () => {
    await h.studio.setGroupBehavior(org.alice, first.id, { participation: 'mentions', remember: true });
    expect(await h.studio.claimGroupReply(first.id, CHAT, 10)).toBe(false);
    await h.studio.setGroupBehavior(org.alice, first.id, { participation: 'balanced', remember: true });
    await h.store.update((state) => { state.groups.find((g) => g.chatId === CHAT)!.agentIds = [second.id]; });
    expect(await h.studio.claimGroupReply(first.id, CHAT, 10)).toBe(false);
    await h.store.update((state) => { state.groups.find((g) => g.chatId === CHAT)!.agentIds.push(first.id); });
    expect(await h.studio.claimGroupReply(first.id, CHAT, 10)).toBe(true);
    await h.studio.fire(org.admin, first.id, { confirmName: 'First', reason: '', memoryPolicy: 'archive' });
    advance(45_000);
    expect(await h.studio.claimGroupReply(first.id, CHAT, 11)).toBe(false);
  });
});

describe('Studio.claimGroupMemory', () => {
  it('claims each source event once per agent and group, including concurrent requests', async () => {
    const claimed = await Promise.all(Array.from({ length: 4 }, () => h.studio.claimGroupMemory(first.id, CHAT, 20)));
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 19)).toBe(true);
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 19)).toBe(false);
    expect(await h.studio.claimGroupMemory(second.id, CHAT, 20)).toBe(true);
    expect(await h.studio.claimGroupMemory(first.id, OTHER_CHAT, 20)).toBe(true);
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 21)).toBe(true);
  });

  it('keeps failed extraction attempts claimed after a restart', async () => {
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 20)).toBe(true);
    // The process dies or the provider fails here, before any memory is saved.
    const resumed = restart();
    expect(await resumed.claimGroupMemory(first.id, CHAT, 20)).toBe(false);
    expect(await resumed.claimGroupMemory(first.id, CHAT, 19)).toBe(true);
    expect(await restart().claimGroupMemory(first.id, CHAT, 19)).toBe(false);
    expect(await resumed.claimGroupMemory(first.id, CHAT, 21)).toBe(true);
  });

  it('accepts out-of-order receipts once while retaining both across restarts', async () => {
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 102)).toBe(true);
    expect(await restart().claimGroupMemory(first.id, CHAT, 101)).toBe(true);
    const resumed = restart();
    expect(await resumed.claimGroupMemory(first.id, CHAT, 102)).toBe(false);
    expect(await resumed.claimGroupMemory(first.id, CHAT, 101)).toBe(false);
    expect(await resumed.claimGroupMemory(first.id, CHAT, 103)).toBe(true);
  });

  it('bounds receipts to a 256-ID range and permanently retires pruned or unseen older IDs', async () => {
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 400)).toBe(true);
    const older = Array.from({ length: 255 }, (_, index) => 399 - index);
    expect(await Promise.all(older.map((messageId) => h.studio.claimGroupMemory(first.id, CHAT, messageId))))
      .toEqual(older.map(() => true));
    let group = (await h.store.read()).groups.find((g) => g.chatId === CHAT)!;
    expect(group.memoryClaims?.[first.id]).toHaveLength(256);
    expect(group.memoryWatermarks?.[first.id]).toBe(144);
    expect(await restart().claimGroupMemory(first.id, CHAT, 144)).toBe(false);
    expect(await restart().claimGroupMemory(first.id, CHAT, 100)).toBe(false);

    expect(await h.studio.claimGroupMemory(first.id, CHAT, 1000)).toBe(true);
    group = (await h.store.read()).groups.find((g) => g.chatId === CHAT)!;
    expect(group.memoryClaims?.[first.id]).toEqual([1000]);
    expect(group.memoryWatermarks?.[first.id]).toBe(744);
    expect(await restart().claimGroupMemory(first.id, CHAT, 400)).toBe(false);
    expect(await restart().claimGroupMemory(first.id, CHAT, 744)).toBe(false);
    expect(await restart().claimGroupMemory(first.id, CHAT, 745)).toBe(true);
  });

  it('preserves a legacy max-watermark as the retired floor during migration', async () => {
    await h.store.update((state) => {
      state.groups.find((g) => g.chatId === CHAT)!.memoryWatermarks = { [first.id]: 100 };
    });
    const resumed = restart();
    expect(await resumed.claimGroupMemory(first.id, CHAT, 99)).toBe(false);
    expect(await resumed.claimGroupMemory(first.id, CHAT, 100)).toBe(false);
    expect(await resumed.claimGroupMemory(first.id, CHAT, 102)).toBe(true);
    expect(await resumed.claimGroupMemory(first.id, CHAT, 101)).toBe(true);
    const group = (await resumed.deps.store.read()).groups.find((g) => g.chatId === CHAT)!;
    expect(group.memoryWatermarks?.[first.id]).toBe(100);
    expect(group.memoryClaims?.[first.id]).toEqual([102, 101]);
    expect(await restart().claimGroupMemory(first.id, CHAT, 100)).toBe(false);
  });

  it('does not reopen a processed source after its memory and history have been deleted', async () => {
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 20)).toBe(true);
    const source = { personId: personId(ID.alice), chatKind: 'group' as const, groupId: groupId(CHAT), telegramMessageId: 20, at: h.clock.now };
    const memory = await h.memory.memories.add({
      personaId: first.id, content: 'Synthetic group meeting is Friday', type: 'fact', sensitivity: 'normal',
      scope: { kind: 'group', groupId: groupId(CHAT) }, source, aboutPersonIds: [], confidence: 1,
    });
    const chatKey = `group-${groupId(CHAT)}`;
    await h.memory.history.append(first.id, chatKey, { role: 'user', text: memory.content, personId: source.personId, telegramMessageId: 20, at: h.clock.now });
    await h.studio.forgetMemory(org.alice, first.id, memory.id);
    h.memory.history.chats.delete(`${first.id}:${chatKey}`);
    expect(await h.memory.memories.listActive(first.id)).toEqual([]);
    expect(await h.memory.history.recent(first.id, chatKey, 20)).toEqual([]);
    expect(await restart().claimGroupMemory(first.id, CHAT, 20)).toBe(false);
    // Pruning its individual receipt must not make the deleted source eligible again.
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 400)).toBe(true);
    expect(await restart().claimGroupMemory(first.id, CHAT, 20)).toBe(false);
  });

  it('rechecks remembering revocation without consuming another receipt', async () => {
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 20)).toBe(true);
    await h.studio.setGroupBehavior(org.alice, first.id, { participation: 'balanced', remember: false });
    expect(await h.studio.groupAllowed(first.id, CHAT, ID.bob, 'remember')).toBe(false);
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 21)).toBe(false);
    const group = (await h.store.read()).groups.find((g) => g.chatId === CHAT)!;
    expect(group.memoryWatermarks?.[first.id]).toBe(0);
    expect(group.memoryClaims?.[first.id]).toEqual([20]);
  });

  it('refuses extraction claims after group removal or firing', async () => {
    await h.store.update((state) => { state.groups.find((g) => g.chatId === CHAT)!.agentIds = [second.id]; });
    expect(await h.studio.claimGroupMemory(first.id, CHAT, 20)).toBe(false);
    await h.studio.fire(org.admin, second.id, { confirmName: 'Second', reason: '', memoryPolicy: 'archive' });
    expect(await h.studio.claimGroupMemory(second.id, CHAT, 20)).toBe(false);
  });
});

describe('the RAM group window held by Studio', () => {
  const windowOf = (studio: Studio) => (studio as unknown as { groupWindow: GroupWindow }).groupWindow;
  const keyFor = (agent: Agent, chatId = CHAT) => ({ personaId: agent.id, chatKey: `group-${groupId(chatId)}`, epoch: 'e' });
  const fill = (agent: Agent, chatId = CHAT) => windowOf(h.studio).record(keyFor(agent, chatId), { personId: 'p', text: 'said before', at: 0, messageId: 1 }, 0);
  const lines = (agent: Agent, chatId = CHAT) => windowOf(h.studio).before(keyFor(agent, chatId), 9, 0).length;

  it('empties a guest group’s window when its head count changes or cannot be read, with no join event', async () => {
    await h.store.update((s) => { s.groups.find((g) => g.chatId === CHAT)!.hasGuests = true; });
    const bot = h.bots.get(h.studio.botToken(first)!)!;
    bot.getChatMemberCount.mockResolvedValue(5);
    await h.studio.verifyGroupAudience(first.id, CHAT);
    fill(first);
    await h.studio.verifyGroupAudience(first.id, CHAT);
    expect(lines(first)).toBe(1);
    bot.getChatMemberCount.mockResolvedValue(6); // A silent newcomer.
    await h.studio.verifyGroupAudience(first.id, CHAT);
    expect(lines(first)).toBe(0);
    fill(first);
    bot.getChatMemberCount.mockRejectedValue(new Error('unavailable'));
    await h.studio.verifyGroupAudience(first.id, CHAT);
    expect(lines(first)).toBe(0);
  });

  it('purges eagerly on audience and membership changes, never only when the chat is next opened', async () => {
    for (const agent of [first, second]) for (const chat of [CHAT, OTHER_CHAT]) fill(agent, chat);
    await h.studio.noteGroupSpeaker(CHAT, { id: 777_001, first_name: 'Guest' });
    expect([lines(first), lines(second), lines(first, OTHER_CHAT)]).toEqual([0, 0, 1]);
    await h.studio.noteGroupMembership(OTHER_CHAT, { id: 777_002, is_bot: false, first_name: 'Guest' }, 'member');
    // Its history epoch moved too: every window of the group's agents goes.
    for (const chat of [CHAT, OTHER_CHAT]) expect([lines(first, chat), lines(second, chat)]).toEqual([0, 0]);
  });
});
