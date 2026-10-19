/**
 * Runs every Telegram bot from one process with long polling:
 *  - @VoxxBot (the manager): /start, opens the Mini App, receives managed_bot
 *    updates when someone confirms a new agent bot
 *  - each active agent's bot: DMs, groups, voice notes (via PersonaGateway)
 *
 * The set of agent bots is refreshed every few seconds, so a newly hired agent
 * comes online without a restart and a fired one goes quiet.
 */

import type { TelegramBotClient, TelegramUpdate } from '../tireh/telegram/client';
import type { Studio } from './service';

const REFRESH_MS = 8000;

interface Loop { stop: () => void; token?: string }

function pollLoop(
  name: string,
  bot: TelegramBotClient,
  allowed: string[],
  handle: (u: TelegramUpdate) => Promise<void>,
  log: Pick<Console, 'info' | 'warn' | 'error'>
): Loop {
  let running = true;
  let offset: number | undefined;
  (async () => {
    await bot.deleteWebhook().catch(() => undefined);
    while (running) {
      try {
        const updates = await bot.getUpdates(offset, 25, allowed);
        for (const update of updates) {
          offset = update.update_id + 1;
          await handle(update).catch((e) => log.error(`[studio] ${name} update failed`, e));
        }
      } catch (error) {
        if (!running) break;
        log.warn(`[studio] polling ${name}: ${(error as Error).message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
  return { stop: () => { running = false; } };
}

export function startBots(studio: Studio): { stop: () => void } {
  const log = studio.deps.logger ?? console;
  const loops = new Map<string, Loop>();
  let stopped = false;

  const manager = studio.deps.managerBot;
  if (manager) {
    const webAppUrl = studio.deps.webAppUrl;
    if (webAppUrl) manager.setChatMenuButton('Open Studio', webAppUrl).catch((e) => log.warn('[studio] menu button', e));
    loops.set('manager', pollLoop('VoxxBot', manager, ['message', 'managed_bot'], async (update) => {
      if (update.managed_bot) {
        await studio.onManagedBot(update.managed_bot);
        return;
      }
      const msg = update.message;
      if (!msg?.from || msg.from.is_bot || msg.chat.type !== 'private') return;
      const member = await studio.ensureMember(msg.from);
      const open = webAppUrl ? { inline_keyboard: [[{ text: 'Open Vox Studio', web_app: { url: webAppUrl } }]] } : undefined;
      const text = member.role === 'pending'
        ? `Hi ${member.name}. You're on the list for ${studio.deps.orgName}; an admin will approve you shortly.`
        : `Hi ${member.name}. Spawn, call and manage your ${studio.deps.orgName} agents in Vox Studio.`;
      await manager.sendMessage(msg.chat.id, text, open ? { keyboard: open } : {});
    }, log));
  }

  const refresh = async () => {
    if (stopped) return;
    try {
      const state = await studio.deps.store.read();
      const active = state.agents.filter((a) => a.status === 'active' && a.tokenEnc);
      const activeIds = new Set(active.map((a) => a.id));
      for (const [id, loop] of loops) {
        if (id !== 'manager' && !activeIds.has(id)) { loop.stop(); loops.delete(id); log.info(`[studio] ${id} offline`); }
      }
      for (const agent of active) {
        const token = studio.botToken(agent);
        const current = loops.get(agent.id);
        // A refreshed token (repeat managed_bot update) replaces the old poller.
        if (current && current.token === token) continue;
        if (current) { current.stop(); loops.delete(agent.id); }
        if (!token) continue;
        const bot = studio.deps.botFor(token);
        loops.set(agent.id, { ...pollLoop(`@${agent.bot?.username}`, bot, ['message', 'callback_query', 'my_chat_member'], async (update) => {
          const { gateway, state: current } = await studio.gateway();
          const live = current.agents.find((a) => a.id === agent.id);
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
              await fresh.gateway.handleUpdate(agent.id, update);
              return;
            }
          }
          await gateway.handleUpdate(agent.id, update);
        }, log), token });
        log.info(`[studio] ${agent.persona.name} online as @${agent.bot?.username}`);
      }
    } catch (error) {
      log.error('[studio] bot refresh failed', error);
    }
  };

  void refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      for (const loop of loops.values()) loop.stop();
      loops.clear();
    },
  };
}
