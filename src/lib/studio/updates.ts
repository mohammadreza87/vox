/**
 * What VoxxBot and the agent bots do with each Telegram update. Shared by the
 * long-polling runner (bots.ts, one always-on server) and the webhook route
 * (serverless production), so both modes behave the same.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { TelegramUpdate } from '../tireh/telegram/client';
import type { Studio } from './service';

export const MANAGER_UPDATES = ['message', 'managed_bot'];
export const AGENT_UPDATES = ['message', 'callback_query', 'my_chat_member'];

export async function handleManagerUpdate(studio: Studio, update: TelegramUpdate): Promise<void> {
  const manager = studio.deps.managerBot;
  if (!manager) return;
  if (update.managed_bot) {
    await studio.onManagedBot(update.managed_bot);
    return;
  }
  const msg = update.message;
  if (!msg?.from || msg.from.is_bot || msg.chat.type !== 'private') return;
  const member = await studio.ensureMember(msg.from);
  const webAppUrl = studio.deps.webAppUrl;
  const open = webAppUrl ? { inline_keyboard: [[{ text: 'Open Vox Studio', web_app: { url: webAppUrl } }]] } : undefined;
  const text = member.role === 'pending'
    ? `Hi ${member.name}. You're on the list for ${studio.deps.orgName}; an admin will approve you shortly.`
    : `Hi ${member.name}. Spawn, call and manage your ${studio.deps.orgName} agents in Vox Studio.`;
  await manager.sendMessage(msg.chat.id, text, open ? { keyboard: open } : {});
}

export async function handleAgentUpdate(studio: Studio, agentId: string, update: TelegramUpdate): Promise<void> {
  const { gateway, state } = await studio.gateway();
  const live = state.agents.find((a) => a.id === agentId);
  if (!live || live.status !== 'active') return;
  if (update.my_chat_member) {
    await studio.onBotChatMember(live, update.my_chat_member);
    return;
  }
  const msg = update.message;
  if (msg?.from && !msg.from.is_bot && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    const known = await studio.noteGroupSpeaker(msg.chat.id, msg.from.id);
    if (known) {
      // Rebuild so the speaker counts in the group's audience right away.
      const fresh = await studio.gateway();
      await fresh.gateway.handleUpdate(agentId, update);
      return;
    }
  }
  await gateway.handleUpdate(agentId, update);
}

/** Per-bot webhook secret, derived so nothing extra needs storing. */
export function webhookSecret(secret: string, key: string): string {
  return createHmac('sha256', secret).update(`webhook:${key}`).digest('hex');
}

export function isValidWebhookSecret(secret: string, key: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(webhookSecret(secret, key));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Point VoxxBot and every active agent bot at this deployment's webhook route. */
export async function registerWebhooks(studio: Studio, publicUrl: string): Promise<{ manager: boolean; agents: string[]; failed: string[] }> {
  const base = publicUrl.replace(/\/+$/, '');
  const result = { manager: false, agents: [] as string[], failed: [] as string[] };
  const manager = studio.deps.managerBot;
  if (manager) {
    await manager.setWebhook(`${base}/api/studio/telegram/manager`, webhookSecret(studio.deps.secret, 'manager'), MANAGER_UPDATES);
    if (studio.deps.webAppUrl) await manager.setChatMenuButton('Open Studio', studio.deps.webAppUrl).catch(() => undefined);
    result.manager = true;
  }
  const state = await studio.deps.store.read();
  for (const agent of state.agents.filter((a) => a.status === 'active' && a.tokenEnc)) {
    const token = studio.botToken(agent);
    if (!token) { result.failed.push(agent.id); continue; }
    try {
      await studio.deps.botFor(token).setWebhook(`${base}/api/studio/telegram/${agent.id}`, webhookSecret(studio.deps.secret, agent.id), AGENT_UPDATES);
      result.agents.push(agent.id);
    } catch {
      result.failed.push(agent.id);
    }
  }
  return result;
}
