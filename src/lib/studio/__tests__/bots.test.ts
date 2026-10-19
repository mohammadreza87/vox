import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { startBots } from '../bots';
import { parseIds } from '../runtime';
import { draftJson, hire, ID, makeStudio, seedOrg, type Harness } from './helpers';
import { expectContentFreeTelegramLogs, telegramCanary, telegramCanaryError } from '@/test/telegram-diagnostics';

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
    expect(h.bots.get(token)!.getUpdates).toHaveBeenCalledWith(undefined, 25, ['message', 'callback_query', 'my_chat_member', 'chat_member']);

    await h.studio.fire(org.admin, agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' });
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.logger.info).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'lifecycle', reason: 'deactivated', outcome: 'offline' });
    expectContentFreeTelegramLogs(h.logger.info.mock.calls, [agent.id, agent.persona.name, agent.bot!.username]);
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

  it('agent bot: an outsider in a group it was added to gets a guest-safe answer', async () => {
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
    const s = await h.store.read();
    expect(s.groups[0].hasGuests).toBe(true);
    expect(s.guests?.map((g) => g.telegramId)).toEqual([ID.stranger]);
    // Groups are open to everyone in them; the outsider is answered as a guest
    // and the prompt keeps the org chart out.
    expect(h.chatLLM.replyPrompts).toHaveLength(1);
    expect(h.chatLLM.lastPrompt).toContain('not part of HOOR');
    expect(h.chatLLM.lastPrompt).not.toContain('## Organization');
  });

  it('keeps polling failures content-free and retries after exactly three seconds', async () => {
    vi.useFakeTimers();
    h.manager.getUpdates.mockRejectedValueOnce(telegramCanaryError());
    stop = startBots(h.studio).stop;
    await flush();
    expect(h.manager.getUpdates).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'poll', reason: 'operation_failed', outcome: 'retry_scheduled' });
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.manager.getUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.manager.getUpdates).toHaveBeenCalledTimes(2);
    expect(h.manager.getUpdates).toHaveBeenLastCalledWith(undefined, 25, ['message', 'managed_bot']);
    expectContentFreeTelegramLogs([...h.logger.warn.mock.calls, ...h.logger.error.mock.calls, ...h.logger.info.mock.calls]);
  });

  it('does not retry or log a pending poll rejection after stop', async () => {
    vi.useFakeTimers();
    let rejectPoll!: (error: Error) => void;
    h.manager.getUpdates.mockImplementationOnce(() => new Promise((_, reject) => { rejectPoll = reject; }));
    stop = startBots(h.studio).stop;
    await flush();
    stop();
    rejectPoll(telegramCanaryError());
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.manager.getUpdates).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('drops exceptions from actual manager handlers, continues the batch and advances its offset', async () => {
    vi.useFakeTimers();
    const message = { message_id: 1, from: { id: telegramCanary.account, is_bot: false, first_name: telegramCanary.persona }, chat: { id: telegramCanary.chat, type: 'private' as const }, date: 0, text: telegramCanary.transcript };
    h.manager.sendMessage.mockRejectedValueOnce(telegramCanaryError());
    h.manager.getUpdates.mockResolvedValueOnce([
      { update_id: telegramCanary.update, message },
      { update_id: telegramCanary.update + 1, message },
    ]);
    stop = startBots(h.studio).stop;
    await flush();
    expect(h.manager.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.manager.getUpdates).toHaveBeenLastCalledWith(telegramCanary.update + 2, 25, ['message', 'managed_bot']);
    expect(h.logger.error).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'update', reason: 'operation_failed', outcome: 'continue_polling' });
    expectContentFreeTelegramLogs([...h.logger.warn.mock.calls, ...h.logger.error.mock.calls, ...h.logger.info.mock.calls]);
  });

  it('drops errors from actual agent handlers and preserves duplicate/success behavior', async () => {
    vi.useFakeTimers();
    const { agent, bot } = await hire(h, org.alice, { name: telegramCanary.persona });
    const message = { message_id: 1, from: { id: ID.alice, is_bot: false, first_name: 'Alice' }, chat: { id: ID.alice, type: 'private' as const }, date: 0, text: telegramCanary.transcript };
    // History access throws through the real gateway; it has already claimed
    // the update, so the replay is a duplicate and the next update succeeds.
    vi.spyOn(h.memory.history, 'getEpoch').mockRejectedValueOnce(telegramCanaryError());
    const failed = { update_id: telegramCanary.update, message };
    bot().getUpdates.mockResolvedValueOnce([failed, failed, { update_id: telegramCanary.update + 1, message }]);
    h.logger.info.mockClear(); h.logger.warn.mockClear(); h.logger.error.mockClear();
    stop = startBots(h.studio).stop;
    await flush();
    expect(bot().getUpdates).toHaveBeenLastCalledWith(telegramCanary.update + 2, 25, ['message', 'callback_query', 'my_chat_member', 'chat_member']);
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expectContentFreeTelegramLogs([...h.logger.warn.mock.calls, ...h.logger.error.mock.calls, ...h.logger.info.mock.calls], [agent.id, agent.bot!.username]);
  });

  it('keeps menu, refresh, reconciliation and drain failures content-free and keeps their schedules', async () => {
    vi.useFakeTimers();
    h.studio.deps.webAppUrl = `https://example.invalid/${telegramCanary.credential}`;
    h.manager.setChatMenuButton.mockRejectedValueOnce(telegramCanaryError());
    const read = vi.spyOn(h.store, 'read').mockRejectedValueOnce(telegramCanaryError());
    const reconcile = vi.spyOn(h.studio, 'reconcileBotProfiles').mockRejectedValueOnce(telegramCanaryError()).mockResolvedValue(undefined);
    // The mode check is part of the real worker; no transport is constructed.
    h.studio.deps.relationships = { mode: 'live' } as NonNullable<typeof h.studio.deps.relationships>;
    const drain = vi.spyOn(h.studio, 'drainRelationships').mockRejectedValueOnce(telegramCanaryError());
    stop = startBots(h.studio).stop;
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(7999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(44000);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(h.logger.error).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'refresh', reason: 'operation_failed', outcome: 'retry_on_refresh' });
    for (const stage of ['menu', 'profile', 'relationship']) {
      expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage, reason: 'operation_failed' }));
    }
    expectContentFreeTelegramLogs([...h.logger.warn.mock.calls, ...h.logger.error.mock.calls, ...h.logger.info.mock.calls]);
  });
});

describe('runtime env parsing', () => {
  it('parses superadmin ids from comma/space separated env, dropping junk', () => {
    expect(parseIds('1, 2 3,,x,-4,5.5')).toEqual([1, 2, 3, 5]);
    expect(parseIds(undefined)).toEqual([]);
  });
});
