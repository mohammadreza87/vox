import type { Studio } from './service';
import { canUseAgent } from './permissions';
import { ReminderDeliveryService, type ReminderTransport } from '../adaptive/runtime/reminders/service';
/** Telegram has no sendMessage idempotency key or receipt lookup for a timeout.
 * One guarded request only; HTTP/protocol uncertainty is recorded, never retried. */
export function telegramReminderTransport(options: { botToken: string; webAppUrl?: string; fetcher?: typeof fetch }): ReminderTransport {
  const fetcher = options.fetcher ?? fetch;
  return { send: async input => {
    if (!options.botToken || input.signal.aborted || !await input.authorize() || input.signal.aborted) return { state: 'cancelled' };
    const url = options.webAppUrl ? new URL(options.webAppUrl) : undefined;
    if (url) url.searchParams.set('notification', input.reference);
    const body = { chat_id: input.telegramId, text: input.text,
      ...(url ? { reply_markup: { inline_keyboard: [[{ text: 'Open Vox', web_app: { url: url.toString() } }]] } } : {}) };
    // No awaited work between final authorization and the single side effect.
    try {
      let immediate: ReturnType<typeof input.authorizeNow>;
      try { immediate = input.authorizeNow(); } catch { return { state: 'cancelled' }; }
      if (immediate !== 'allowed') return { state: immediate === 'busy' ? 'deferred' : 'cancelled' };
      const response = await fetcher(`https://api.telegram.org/bot${options.botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: input.signal,
      });
      const result: unknown = await response.json();
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false && (response.ok || response.status >= 400 && response.status < 500)) return { state: 'failed' };
      if (response.ok && result && typeof result === 'object' && 'ok' in result && result.ok === true && 'result' in result && result.result && typeof result.result === 'object' && 'message_id' in result.result &&
          'chat' in result.result && result.result.chat && typeof result.result.chat === 'object' && 'id' in result.result.chat && result.result.chat.id === input.telegramId &&
          Number.isSafeInteger(result.result.message_id) && Number(result.result.message_id) > 0) return { state: 'accepted', messageId: String(result.result.message_id) };
      return { state: 'unknown' };
    } catch { return { state: 'unknown' }; }
  } };
}
export function createStudioReminderDelivery(studio: Studio, options: { enabled: boolean; endpointId: string; botToken: string; webAppUrl?: string; fetcher?: typeof fetch; now?: () => number }): ReminderDeliveryService {
  if (!studio.deps.experience) throw new Error('experience_required');
  return new ReminderDeliveryService(studio.deps.experience, { enabled: options.enabled, endpointId: options.endpointId, now: options.now,
    recipientNow: (telegramId, agentId) => {
      const state = studio.deps.store.readCommittedForEffect?.();
      if (!state) return null;
      const member = state.members.find(m => m.telegramId === telegramId && m.role !== 'pending');
      const agent = state.agents.find(a => a.id === agentId && a.status === 'active');
      if (!member || !agent || !canUseAgent(member, agent) || (agent.blocked ?? []).includes(telegramId)) return null;
      return { telegramId, endpointId: options.endpointId, revision: JSON.stringify([member.telegramId, member.role, agent.id, agent.status, agent.visibility, agent.createdBy, agent.access, agent.blocked]) };
    },
    recipient: async (telegramId, agentId) => {
      const state = await studio.deps.store.read();
      const member = state.members.find(m => m.telegramId === telegramId && m.role !== 'pending');
      const agent = state.agents.find(a => a.id === agentId && a.status === 'active');
      if (!member || !agent || !canUseAgent(member, agent) || (agent.blocked ?? []).includes(telegramId)) return null;
      return { telegramId, endpointId: options.endpointId, revision: JSON.stringify([member.telegramId, member.role, agent.id, agent.status, agent.visibility, agent.createdBy, agent.access, agent.blocked]) };
    }, transport: telegramReminderTransport(options),
  });
}
