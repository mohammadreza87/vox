/**
 * What VoxxBot and the agent bots do with each Telegram update. Shared by the
 * long-polling runner (bots.ts, one always-on server) and the webhook route
 * (serverless production), so both modes behave the same.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { beginObservation } from './observation';
import type { TelegramUpdate } from '../tireh/telegram/client';
import { canUseAgent, visibilityOf } from './permissions';
import type { Studio } from './service';

export const MANAGER_UPDATES = ['message', 'managed_bot'];
export const AGENT_UPDATES = ['message', 'callback_query', 'my_chat_member', 'chat_member'];

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
    ? `Hi ${member.name}. You're on the list for ${studio.deps.orgName}.\n\nShare your User ID with an admin to get access.`
    : `Hi ${member.name}. Spawn, call and manage your ${studio.deps.orgName} agents in Vox Studio.`;
  const who = msg.from;
  const account = [
    `Username: ${who.username ? `@${who.username}` : '—'}`,
    `First name: ${who.first_name || '—'}`,
    `Last name: ${who.last_name || '—'}`,
    `User ID: ${who.id}`,
  ].join('\n');
  await manager.sendMessage(msg.chat.id, `${text}\n\n${account}`, open ? { keyboard: open } : {});
}

/**
 * Who an agent talks to:
 *  - groups it was added to: everyone in them (outsiders as guests, who only
 *    ever see that group's memories);
 *  - direct messages: members who may use it (private: creator, allow-list,
 *    admins; org: every member); for public agents also anyone else, after the
 *    agent decides in character whether to answer, decline, ignore or block.
 */
export async function handleAgentUpdate(studio: Studio, agentId: string, update: TelegramUpdate, endpointId?: string): Promise<void> {
  const endpoint = endpointId ? { personaId: agentId, id: endpointId } : undefined;
  const initial = await studio.gateway(endpoint);
  const state = initial.state;
  let gateway = initial.gateway;
  const live = state.agents.find((a) => a.id === agentId);
  if (!live || live.status !== 'active') return;
  if (update.my_chat_member) {
    await studio.onBotChatMember(live, update.my_chat_member);
    return;
  }
  if (update.chat_member) {
    if (await studio.deps.memory.deduper.firstSeen(`audience:${agentId}:${update.update_id}`)) await studio.onGroupChatMember(update.chat_member);
    return;
  }
  const msg = update.message;
  if (!msg) {
    await gateway.handleUpdate(agentId, update);
    return;
  }
  if (!msg.from || msg.from.is_bot || (live.blocked ?? []).includes(msg.from.id)) return;

  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    if (!state.groups.some((g) => g.chatId === msg.chat.id && g.agentIds.includes(agentId))) return;
    for (const user of msg.new_chat_members ?? []) await studio.noteGroupMembership(msg.chat.id, user, 'member');
    if (msg.left_chat_member) await studio.noteGroupMembership(msg.chat.id, msg.left_chat_member, 'left');
    await studio.verifyGroupAudience(agentId, msg.chat.id);
    // Rebuild when the speaker is new to the group so they count in its audience right away.
    await studio.noteGroupSpeaker(msg.chat.id, msg.from);
    ({ gateway } = await studio.gateway(endpoint));
    await gateway.handleUpdate(agentId, update);
    return;
  }
  if (msg.chat.type !== 'private') return;

  const member = state.members.find((m) => m.telegramId === msg.from!.id);
  if (member && canUseAgent(member, live)) {
    const turnId = createHash('sha256').update(JSON.stringify([agentId, endpointId ?? '', update.update_id])).digest('hex');
    const observe = await beginObservation(studio, member.telegramId, agentId, 'work', 'telegram', turnId);
    try {
      const result = await gateway.handleUpdate(agentId, update);
      // Duplicate and command updates are not new conversation measurements.
      if (result === 'replied') await observe('responded');
      else if (result === 'ignored') await observe('unknown');
    } catch (error) { await observe('failed'); throw error; }
    return;
  }

  const token = studio.botToken(live);
  if (!token) return;
  const bot = studio.deps.botFor(token);
  const org = studio.deps.orgName;
  if (visibilityOf(live) !== 'public') {
    const creator = state.members.find((m) => m.telegramId === live.createdBy)?.name;
    const text = member && member.role !== 'pending'
      ? `Hi, I'm ${live.persona.name}. I'm private for now${creator ? `: ask ${creator}` : ': ask an admin'} if you'd like to work with me.`
      : `Hi, I'm ${live.persona.name}. I only talk with ${visibilityOf(live) === 'org' ? `the ${org} team` : `a few people at ${org}`} for now.`;
    await bot.sendMessage(msg.chat.id, text);
    return;
  }

  // Public agent, someone outside the team (or not yet approved).
  const standing = await studio.admitGuest(agentId, msg.from);
  if (standing === 'blocked' || standing === 'over-limit') return;
  if (standing === 'limit-reached') {
    await bot.sendMessage(msg.chat.id, `I've enjoyed talking, but I need a break. Let's pick this up tomorrow.`);
    return;
  }
  ({ gateway } = await studio.gateway(endpoint));
  const text = msg.text ?? msg.caption ?? '';
  if (text.startsWith('/') || (!text && msg.voice)) {
    // Commands (/start, /memories…) and voice notes go straight through; the gateway handles them.
    await gateway.handleUpdate(agentId, update);
    return;
  }
  const decision = await studio.decideOnStranger(live, text);
  if (decision.action === 'reply') {
    await gateway.handleUpdate(agentId, update);
  } else if (decision.action === 'decline') {
    await bot.sendMessage(msg.chat.id, decision.message!);
  } else if (decision.action === 'block') {
    await studio.blockByAgent(agentId, msg.from.id, text);
    await bot.sendMessage(msg.chat.id, decision.message!);
  }
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
