import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgentUpdate, handleManagerUpdate } from '../updates';
import { draftJson, hire, ID, makeStudio, seedOrg, type Harness } from './helpers';
import { expectContentFreeTelegramLogs, telegramCanary, telegramCanaryError } from '@/test/telegram-diagnostics';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
beforeEach(async () => { h = makeStudio(); org = await seedOrg(h); });

function verify(forbidden: unknown[] = []) {
  expectContentFreeTelegramLogs([...h.logger.info.mock.calls, ...h.logger.warn.mock.calls, ...h.logger.error.mock.calls], forbidden);
}

describe('real Studio ingress callchain diagnostics', () => {
  it.each(['step', 'profile'] as const)('keeps managed-bot %s failures private and still activates and notifies its creator', async (failure) => {
    h.personaLLM.push(draftJson({ name: telegramCanary.persona }));
    const { agent } = await h.studio.draft(org.alice, {});
    await h.studio.publish(org.alice, agent.id);
    const update = { update_id: telegramCanary.update, managed_bot: {
      user: { id: ID.alice, is_bot: false, first_name: telegramCanary.persona },
      bot: { id: telegramCanary.account, is_bot: true, first_name: telegramCanary.persona, username: telegramCanary.username },
    } };
    h.manager.getManagedBotToken.mockResolvedValueOnce(telegramCanary.credential);
    const bot = h.botFor(telegramCanary.credential);
    if (failure === 'step') vi.mocked(bot.setMyName).mockRejectedValueOnce(telegramCanaryError());
    else vi.spyOn(h.studio, 'configureBotProfile').mockRejectedValueOnce(telegramCanaryError());
    await handleManagerUpdate(h.studio, update);
    const stored = (await h.store.read()).agents.find((a) => a.id === agent.id)!;
    expect(stored.status).toBe('active');
    expect(h.studio.botToken(stored)).toBe(telegramCanary.credential);
    expect(h.manager.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage: failure === 'step' ? 'profile_name' : 'profile_apply', reason: 'operation_failed' }));
    if (failure === 'step') {
      expect(bot.setMyCommands).toHaveBeenCalledTimes(1);
      expect(stored.profileSync).toMatchObject({ status: 'error', failed: ['name'], attempts: 1 });
      expect(Date.parse(stored.profileSync!.retryAt!) - h.clock.now.getTime()).toBe(60000);
    }
    verify([agent.id]);
  });

  it('keeps ignored unmatched and fired managed-bot identities out of diagnostics', async () => {
    const unmatched = { update_id: telegramCanary.update, managed_bot: {
      user: { id: telegramCanary.account, is_bot: false, first_name: telegramCanary.persona },
      bot: { id: telegramCanary.chat, is_bot: true, first_name: telegramCanary.persona, username: telegramCanary.username },
    } };
    await handleManagerUpdate(h.studio, unmatched);
    expect(h.manager.getManagedBotToken).not.toHaveBeenCalled();
    const { agent, botId } = await hire(h, org.alice);
    await h.store.update((state) => { state.agents.find((a) => a.id === agent.id)!.status = 'fired'; });
    h.manager.getManagedBotToken.mockClear(); h.manager.sendMessage.mockClear();
    await handleManagerUpdate(h.studio, { ...unmatched, managed_bot: { ...unmatched.managed_bot, bot: { ...unmatched.managed_bot.bot, id: botId } } });
    expect(h.manager.getManagedBotToken).not.toHaveBeenCalled();
    expect(h.manager.sendMessage).not.toHaveBeenCalled();
    expect(h.logger.warn.mock.calls.map(([event]) => event.reason)).toEqual(['no_waiting_agent', 'agent_inactive']);
    verify([agent.id]);
  });

  it('keeps public-agent decision errors private and preserves the fallback decline', async () => {
    const { agent, bot } = await hire(h, org.alice, { name: telegramCanary.persona, openness: 0 }, undefined, 'public');
    h.studio.deps.decider = { decide: vi.fn().mockRejectedValue(telegramCanaryError()) };
    vi.spyOn(h.chatLLM, 'complete').mockRejectedValueOnce(telegramCanaryError());
    await handleAgentUpdate(h.studio, agent.id, { update_id: telegramCanary.update, message: {
      message_id: 1, from: { id: telegramCanary.account, is_bot: false, first_name: telegramCanary.persona },
      chat: { id: telegramCanary.chat, type: 'private' }, date: 0, text: telegramCanary.transcript,
    } });
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
    expect(bot().sendMessage).toHaveBeenCalledWith(telegramCanary.chat, expect.stringContaining('Thanks for reaching out.'));
    expect(h.logger.warn.mock.calls.map(([event]) => event.stage)).toEqual(['stranger_decider', 'stranger_fallback']);
    verify([agent.id]);
  });

  it('keeps corrupt stored token diagnostics private and leaves the agent unavailable', async () => {
    const { agent } = await hire(h, org.alice);
    await h.store.update((state) => { state.agents.find((a) => a.id === agent.id)!.tokenEnc = telegramCanary.credential; });
    const { state } = await h.studio.gateway();
    expect(h.studio.botToken(state.agents[0])).toBeNull();
    expect(h.logger.error).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'bot_token', reason: 'decryption_failed', outcome: 'unavailable' });
    verify([agent.id]);
  });

  it('keeps primary STT adapter errors private during a real voice update and still replies using the fallback transcript', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { agent, bot } = await hire(h, org.alice, { name: telegramCanary.persona });
      h.openai.transcribe.mockRejectedValueOnce(telegramCanaryError());
      h.eleven.transcribe.mockResolvedValueOnce('Please reply in text.');
      await handleAgentUpdate(h.studio, agent.id, { update_id: telegramCanary.update, message: {
        message_id: 1, from: { id: ID.alice, is_bot: false, first_name: 'Alice' },
        chat: { id: ID.alice, type: 'private' }, date: 0,
        voice: { file_id: telegramCanary.credential, file_unique_id: 'synthetic-voice', duration: 1 },
      } });
      expect(h.eleven.transcribe).toHaveBeenCalledTimes(1);
      expect(bot().sendMessage).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'transcription', reason: 'primary_provider_failed', outcome: 'fallback_provider' });
      expectContentFreeTelegramLogs([...warn.mock.calls, ...h.logger.info.mock.calls, ...h.logger.warn.mock.calls, ...h.logger.error.mock.calls], [agent.id]);
    } finally { warn.mockRestore(); }
  });
});
