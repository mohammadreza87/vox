import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { startBots } from '../bots';
import { parseIds } from '../runtime';
import { draftJson, fakeTelegram, hire, ID, makeStudio, seedOrg, type Harness } from './helpers';
import { TelegramApiError } from '../../tireh/telegram/client';
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
// A whole agent turn runs the default adaptive service's real file I/O, which
// fake timers cannot advance: wait in real time (bounded) until it is done.
const realSetTimeout = globalThis.setTimeout;
async function flushUntil(done: () => boolean, budgetMs = 5_000) {
  for (let waited = 0; waited < budgetMs && !done(); waited += 5) {
    await flush();
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
}

describe('bot runner', () => {
  it('runs a bounded maintenance batch without overlap and aborts its remaining work on stop', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const runPage = vi.fn(async () => { await blocked; return { state: 'completed', scanned: 0 }; });
    h.studio.deps.maintenance = { runPage } as unknown as NonNullable<typeof h.studio.deps.maintenance>;
    stop = startBots(h.studio).stop;
    await flush();
    expect(runPage).toHaveBeenCalledTimes(1);
    const call = runPage.mock.calls[0] as unknown as [{ limit: number; signal: AbortSignal }];
    expect(call[0].limit).toBe(20); expect(call[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runPage).toHaveBeenCalledTimes(1);
    stop(); expect(call[0].signal.aborted).toBe(true);
    finish(); await flush(); await vi.advanceTimersByTimeAsync(60_000);
    expect(runPage).toHaveBeenCalledTimes(1);
  });

  it('retains the maintenance cadence after failure and logs only a fixed failure catalog', async () => {
    vi.useFakeTimers();
    const runPage = vi.fn().mockRejectedValueOnce(telegramCanaryError()).mockResolvedValue({ state: 'completed', scanned: 0 });
    h.studio.deps.maintenance = { runPage } as unknown as NonNullable<typeof h.studio.deps.maintenance>;
    stop = startBots(h.studio).stop;
    await flush();
    expect(h.logger.warn).toHaveBeenCalledWith({ type: 'adaptive_maintenance', outcome: 'failed', reason: 'sweep_failed' });
    await vi.advanceTimersByTimeAsync(60_000); expect(runPage).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain(telegramCanary.transcript);
  });

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
    expect(h.bots.get(token)!.getUpdates).toHaveBeenCalledWith(undefined, 25, ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member']);

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
    // Legacy (non-adaptive) path: no production runtime builds it; adaptive
    // runtimes ignore a group turn from an unknown reader (adaptive-integration.test.ts).
    h = makeStudio({ adaptive: false });
    org = await seedOrg(h);
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
    await flushUntil(() => h.chatLLM.replyPrompts.length > 0);
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
    await flushUntil(() => bot().getUpdates.mock.lastCall?.[0] === telegramCanary.update + 2);
    expect(bot().getUpdates).toHaveBeenLastCalledWith(telegramCanary.update + 2, 25, ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member']);
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

describe('redirected updates (bot integrity): detect and alert, never act', () => {
  const conflict = (text = "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first") => new TelegramApiError('getUpdates', text, 409);
  const integrityLogs = () => h.logger.warn.mock.calls.filter(([e]) => (e as { type?: string }).type === 'bot_integrity');
  const alerts = () => h.manager.sendMessage.mock.calls.filter(([, text]) => String(text).startsWith('Vox alert'));
  const audits = async () => (await h.store.read()).audit.filter((a) => a.action === 'agent.integrity');
  /** An agent bot whose fake exists before its poller starts, so its first getUpdates is already scripted. */
  async function agentBot() {
    const hired = await hire(h, org.alice, { name: 'Nova' });
    const bot = fakeTelegram();
    h.bots.set(hired.token, bot);
    return { ...hired, bot };
  }

  it('a foreign webhook: nothing for 60 s, then one log, one audit row and one DM per superadmin, without the URL or token', async () => {
    vi.useFakeTimers();
    const { agent, token, bot } = await agentBot();
    bot.getUpdates.mockRejectedValue(conflict());
    bot.getWebhookInfo.mockResolvedValue({ url: 'https://collector.invalid/SECRET_HOOK_PATH', pending_update_count: 3 });
    stop = startBots(h.studio).stop;
    await flush();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(bot.getWebhookInfo).not.toHaveBeenCalled();
    expect(integrityLogs()).toEqual([]);
    expect(alerts()).toEqual([]);
    // until a probe has seen the webhook, a conflict retries every 3 s like any failure: 0, 3, … 57
    expect(bot.getUpdates).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bot.getWebhookInfo).toHaveBeenCalledTimes(1);
    // the probe saw a webhook (getUpdates cannot win an update while one is set): now every 15 s
    expect(bot.getUpdates).toHaveBeenCalledTimes(21);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(bot.getUpdates).toHaveBeenCalledTimes(21);
    await vi.advanceTimersByTimeAsync(1);
    expect(bot.getUpdates).toHaveBeenCalledTimes(22);
    expect(integrityLogs()).toEqual([[{ type: 'bot_integrity', target: agent.id, reason: 'webhook_foreign', outcome: 'alerted' }]]);
    expect(await audits()).toEqual([expect.objectContaining({ actor: 'system', action: 'agent.integrity', target: agent.id, detail: 'webhook_foreign' })]);
    expect(alerts().map(([chat]) => chat)).toEqual([ID.superadmin]);
    const text = String(alerts()[0][1]);
    expect(text).toContain('Nova');
    expect(text).toContain('هشدار وکس');
    for (const secret of ['SECRET_HOOK_PATH', 'collector.invalid', token]) expect(JSON.stringify([h.logger.warn.mock.calls, h.manager.sendMessage.mock.calls])).not.toContain(secret);
    // never acts: no webhook set or removed beyond the loop's own start, and polling goes on
    expect(bot.setWebhook).not.toHaveBeenCalled();
    expect(bot.deleteWebhook).toHaveBeenCalledTimes(1);
    const polls = bot.getUpdates.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(bot.getUpdates.mock.calls.length).toBeGreaterThan(polls);
    // probed at most once a minute, alerted once per 6 h
    expect(bot.getWebhookInfo.mock.calls.length).toBeLessThanOrEqual(11);
    expect(alerts()).toHaveLength(1);
    expect(integrityLogs()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
    expect((await h.store.read()).agents.find((a) => a.id === agent.id)!.status).toBe('active');
  });

  it('a competing poller: repeated conflicts between successes still alert poll_conflict; a single 409 does not', async () => {
    vi.useFakeTimers();
    const { bot } = await agentBot();
    const terminated = conflict('Conflict: terminated by other getUpdates request; make sure that only one bot instance is running');
    bot.getUpdates.mockRejectedValueOnce(terminated).mockResolvedValueOnce([]).mockImplementation(() => new Promise(() => undefined));
    stop = startBots(h.studio).stop;
    await flush();
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(integrityLogs()).toEqual([]);
    expect(bot.getWebhookInfo).not.toHaveBeenCalled();
    stop(); stop = undefined;

    // now another poller keeps taking the updates: conflicts alternate with empty successes
    const again = await agentBot();
    let n = 0;
    again.bot.getUpdates.mockImplementation(async () => { if (n++ % 2 === 0) throw terminated; return []; });
    h.logger.warn.mockClear();
    stop = startBots(h.studio).stop;
    await flush();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(integrityLogs()).toContainEqual([{ type: 'bot_integrity', target: again.agent.id, reason: 'poll_conflict', outcome: 'alerted' }]);
    expect(again.bot.setWebhook).not.toHaveBeenCalled();
  });

  it('a competing poller never slows Vox down: every conflict retries in 3 s, before and after the alert', async () => {
    vi.useFakeTimers();
    const { agent, bot } = await agentBot();
    const terminated = conflict('Conflict: terminated by other getUpdates request; make sure that only one bot instance is running');
    bot.getUpdates.mockRejectedValue(terminated);
    stop = startBots(h.studio).stop;
    await flush();
    expect(bot.getUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(bot.getUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bot.getUpdates).toHaveBeenCalledTimes(2);
    // past the probe (no webhook) and the poll_conflict alert, still every 3 s
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bot.getWebhookInfo).toHaveBeenCalledTimes(1);
    expect(integrityLogs()).toEqual([[{ type: 'bot_integrity', target: agent.id, reason: 'poll_conflict', outcome: 'alerted' }]]);
    const polls = bot.getUpdates.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(bot.getUpdates).toHaveBeenCalledTimes(polls + 1);
  });

  it('a rejected token alerts token_rejected; the switch silences only the DMs', async () => {
    vi.useFakeTimers();
    h.studio.deps.integrityAlerts = () => false;
    const { agent, bot } = await agentBot();
    bot.getUpdates.mockRejectedValue(new TelegramApiError('getUpdates', 'Unauthorized', 401));
    bot.getWebhookInfo.mockRejectedValue(new TelegramApiError('getWebhookInfo', 'Unauthorized', 401));
    stop = startBots(h.studio).stop;
    await flush();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(integrityLogs()).toEqual([[{ type: 'bot_integrity', target: agent.id, reason: 'token_rejected', outcome: 'alerted' }]]);
    expect(await audits()).toHaveLength(1);
    expect(alerts()).toEqual([]);
  });

  it('the manager bot is watched the same way', async () => {
    vi.useFakeTimers();
    h.manager.getUpdates.mockRejectedValue(conflict());
    h.manager.getWebhookInfo.mockResolvedValue({ url: 'https://collector.invalid/x' });
    stop = startBots(h.studio).stop;
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(integrityLogs()).toEqual([[{ type: 'bot_integrity', target: 'manager', reason: 'webhook_foreign', outcome: 'alerted' }]]);
    expect(alerts().map(([chat]) => chat)).toEqual([ID.superadmin]);
    expect(String(alerts()[0][1])).toContain('@VoxxBot');
    expect(h.manager.deleteWebhook).toHaveBeenCalledTimes(1);
  });

  it('network failures probe after 60 s but alert nothing without a webhook or conflict', async () => {
    vi.useFakeTimers();
    h.manager.getUpdates.mockRejectedValue(telegramCanaryError());
    stop = startBots(h.studio).stop;
    await flush();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.manager.getWebhookInfo).toHaveBeenCalled();
    expect(integrityLogs()).toEqual([]);
    expectContentFreeTelegramLogs([...h.logger.warn.mock.calls, ...h.logger.error.mock.calls]);
  });
});
