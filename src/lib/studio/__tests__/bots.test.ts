import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { startBots } from '../bots';
import { parseIds } from '../runtime';
import { draftJson, hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let stop: (() => void) | undefined;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('bot runner', () => {
  it('VoxxBot: sets the menu button, greets people and hires on managed_bot updates', async () => {
    vi.useFakeTimers();
    h.studio.deps.webAppUrl = 'https://vox.example/studio';
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await h.studio.publish(org.alice, agent.id);

    const updates: TelegramUpdate[] = [
      { update_id: 1, message: { message_id: 1, from: { id: 6060, is_bot: false, first_name: 'Newbie' }, chat: { id: 6060, type: 'private' }, date: 0, text: '/start' } },
      { update_id: 2, managed_bot: { user: { id: ID.alice, is_bot: false, first_name: 'Alice' }, bot: { id: 4242, is_bot: true, first_name: 'Nova', username: 'hoor_nova_bot' } } },
    ];
    h.manager.getUpdates.mockResolvedValueOnce(updates);
    stop = startBots(h.studio).stop;
    await flush();

    expect(h.manager.setChatMenuButton).toHaveBeenCalledWith('Open Studio', 'https://vox.example/studio');
    expect(h.manager.getUpdates).toHaveBeenCalledWith(undefined, 25, ['message', 'managed_bot']);
    expect(h.manager.getUpdates).toHaveBeenLastCalledWith(3, 25, ['message', 'managed_bot']);
    const greeting = h.manager.sendMessage.mock.calls.find((c) => c[0] === 6060)!;
    expect(greeting[1]).toContain("You're on the list");
    expect(greeting[2]).toEqual({ keyboard: { inline_keyboard: [[{ text: 'Open Vox Studio', web_app: { url: 'https://vox.example/studio' } }]] } });
    expect((await h.store.read()).agents[0].status).toBe('active');
  });

  it('polls every active agent bot and drops fired ones on the next refresh', async () => {
    vi.useFakeTimers();
    const { agent, token } = await hire(h, org.alice);
    stop = startBots(h.studio).stop;
    await flush();
    expect(h.botFor).toHaveBeenCalledWith(token);
    expect(h.bots.get(token)!.getUpdates).toHaveBeenCalledWith(undefined, 25, ['message', 'callback_query', 'my_chat_member']);

    await h.studio.fire(org.admin, agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' });
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.logger.info).toHaveBeenCalledWith(`[studio] ${agent.id} offline`);
  });

  it('a refreshed token replaces the old poller', async () => {
    vi.useFakeTimers();
    const { botId, token } = await hire(h, org.alice);
    stop = startBots(h.studio).stop;
    await flush();
    h.manager.getManagedBotToken.mockResolvedValueOnce('token-new');
    await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: botId, is_bot: true, first_name: 'N', username: 'hoor_nova_bot' } });
    const before = h.botFor.mock.calls.filter((c) => c[0] === 'token-new').length;
    await vi.advanceTimersByTimeAsync(8000);
    const newBot = h.bots.get('token-new')!;
    expect(h.botFor.mock.calls.filter((c) => c[0] === 'token-new').length).toBeGreaterThan(before);
    expect(newBot.getUpdates).toHaveBeenCalled();
    expect(h.bots.get(token)!.getUpdates).toHaveBeenCalledTimes(1);
  });

  it('agent bot: a group message from an outsider marks the group as having guests', async () => {
    vi.useFakeTimers();
    const { agent, token } = await hire(h, org.alice);
    await h.store.update((s) => {
      s.groups.push({ chatId: -1001, title: 'G', memberIds: [ID.alice], hasGuests: false, agentIds: [agent.id], addedAt: '' });
    });
    h.botFor(token); // create the fake so we can script it before polling starts
    h.bots.get(token)!.getUpdates.mockResolvedValueOnce([
      { update_id: 10, message: { message_id: 1, from: { id: ID.stranger, is_bot: false, first_name: 'S' }, chat: { id: -1001, type: 'supergroup' }, date: 0, text: 'Nova hi' } },
    ]);
    stop = startBots(h.studio).stop;
    await flush();
    expect((await h.store.read()).groups[0].hasGuests).toBe(true);
    expect(h.chatLLM.replyPrompts).toHaveLength(0);
  });
});

describe('runtime env parsing', () => {
  it('parses superadmin ids from comma/space separated env, dropping junk', () => {
    expect(parseIds('1, 2 3,,x,-4,5.5')).toEqual([1, 2, 3, 5]);
    expect(parseIds(undefined)).toEqual([]);
  });
});
