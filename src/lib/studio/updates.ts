import { ArchiveAdmissionRefusedError, ArchiveCommandDeliveryError } from './telegram-archive';
import { handleRequestedRoutineMessage, noteRequestedRoutineActivity } from './requested-routines';
/**
 * What VoxxBot and the agent bots do with each Telegram update. Shared by the
 * long-polling runner (bots.ts, one always-on server) and the webhook route
 * (serverless production), so both modes behave the same.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { beginObservation, observationCancelled } from './observation';
import type { InlineKeyboard, TelegramBotClient, TelegramCallbackQuery, TelegramMessage, TelegramUpdate, TelegramUser } from '../tireh/telegram/client';
import { canUseAgent, visibilityOf } from './permissions';
import type { ChoiceOutcome, Studio } from './service';
import type { Agent, JoinChoice } from './types';
import { logTelegramDiagnostic } from '../tireh/telegram/diagnostics';
import { cardCallback, parseCardCallback, parseNoteCallback, parseStartPayload, type CardAction } from '../circles/codec';
import { parsePostCallback, parsePostCommand } from '../circles/channels';
import { agentCard, choiceReceipt, circleCopy, groupCopy, localeOf } from '../circles/notice';
import { petPageUrl } from '../pet/links';
import { parseExplicitControl } from '../relationships/policy';
import { settingsV2 } from './flags';
import { BOT_SETTINGS_COMMANDS, commandNames } from './settings-commands';
import { MY_DATA_CODE, MY_DATA_PAGE } from './my-data-contract';
import { onCheckinCallback, parseCheckinCallback } from './pet-checkins/deliver';

export const MANAGER_UPDATES = ['message', 'managed_bot'];
/** Never channel_post or edited_channel_post: Vox reads nothing from channels (Circles S5 is post-only). */
export const AGENT_UPDATES = ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member'];
/** What the stranger decision sees for an untranscribed voice note; never audio or a transcript. */
export const STRANGER_VOICE_PLACEHOLDER = '(a voice message; it was not listened to)';

export async function handleManagerUpdate(studio: Studio, update: TelegramUpdate): Promise<void> {
  const manager = studio.deps.managerBot;
  if (!manager) return;
  if (update.managed_bot) {
    await studio.onManagedBot(update.managed_bot);
    return;
  }
  const msg = update.message;
  if (!msg?.from || msg.from.is_bot || msg.chat.type !== 'private') return;
  // "My data" (the pet's Settings, t.me/<VoxxBot>?start=mydata): one web_app button to the VoxxBot-signed page. Before
  // ensureMember, so someone who only uses public agents is never added to the pending list by asking for their data.
  if (msg.chat.id === msg.from.id && new RegExp(`^/start(?:@\\w+)?\\s+${MY_DATA_CODE}$`).test(msg.text?.trim() ?? '')) {
    const page = myDataPageUrl(studio.deps.webAppUrl);
    if (page) await manager.sendMessage(msg.chat.id, MY_DATA_PROMPT, { keyboard: { inline_keyboard: [[{ text: MY_DATA_BUTTON, web_app: { url: page } }]] } });
    return;
  }
  const member = await studio.ensureMember(msg.from);
  if (member.role !== 'pending' && msg.chat.id === msg.from.id && studio.deps.reminderEndpointId) {
    // A verified private manager DM establishes this bot's reachable recipient.
    // Mini App auth alone and messages from groups never establish a channel.
    await studio.deps.experience?.noteReminderRecipient(member.telegramId, studio.deps.reminderEndpointId)
      .catch(() => logTelegramDiagnostic(studio.deps.logger ?? console, 'update_failed'));
  }
  // Settings v2: the manager menu (once per process) and /settings, /start settings, /start s_<code>[_x]; anything else gets today's greeting.
  void studio.settingsBot.syncManagerMenu();
  if (await studio.settingsBot.managerCommand(member, msg)) return;
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

/** EN and FA in one message: the manager bot does not know the person's language before they open the page. */
const MY_DATA_PROMPT = 'Your Vox data: see it, copy it or erase it.\nداده‌های شما در وکس: ببینید، کپی کنید یا پاک کنید.';
const MY_DATA_BUTTON = 'My data · داده‌های من';
/** STUDIO_WEBAPP_URL is …/studio; the page sits beside it. Undefined when the Mini App URL is not configured. */
function myDataPageUrl(webAppUrl: string | undefined): string | undefined {
  if (!webAppUrl) return undefined;
  try {
    const url = new URL(webAppUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return undefined;
    url.pathname = MY_DATA_PAGE; url.search = ''; url.hash = '';
    return url.toString();
  } catch { return undefined; }
}

/**
 * Who an agent talks to:
 *  - groups it was added to: everyone in them; remembered group context is
 *    available only when its captured audience still authorizes all readers;
 *  - direct messages: members who may use it (private: creator, allow-list,
 *    admins; org: every member); for public agents also anyone else, after the
 *    agent decides in character whether to answer, decline, ignore or block.
 */
export async function handleAgentUpdate(studio: Studio, agentId: string, update: TelegramUpdate, endpointId?: string): Promise<void> {
  // Circles S5: a channel admin bot hears every subscriber join and leave; channels are no audience, so nothing is built, deduped or kept for them.
  if (update.chat_member?.chat.type === 'channel' && studio.circlesMode() === 'circles') return;
  const endpoint = endpointId ? { personaId: agentId, id: endpointId } : undefined;
  const initial = await studio.gateway(endpoint);
  const state = initial.state;
  let gateway = initial.gateway;
  const live = state.agents.find((a) => a.id === agentId);
  if (!live || live.status !== 'active') return;
  // Webhook deployments have no reconcile loop: traffic reaching the bot repairs a stale profile.
  studio.nudgeBotProfile(live);
  if (update.my_chat_member) {
    await studio.onBotChatMember(live, update.my_chat_member);
    return;
  }
  if (update.chat_member) {
    if (await studio.deps.memory.deduper.firstSeen(`audience:${agentId}:${update.update_id}`)) await studio.onGroupChatMember(update.chat_member);
    return;
  }
  // Pet check-in buttons (kw: Why this? · ks: Stop these · ka: Stop all, design §5.4), answered in the DM's own language.
  if (update.callback_query && parseCheckinCallback(update.callback_query.data)) {
    const token = studio.botToken(live);
    if (token && await studio.deps.memory.deduper.firstSeen(`${agentId}__${update.update_id}`)) await onCheckinCallback(studio, live, update.callback_query, studio.deps.botFor(token));
    return;
  }
  // Circles notes buttons (cs:/cn:/ce:, S3) only while Circles is 'circles'; otherwise they take the paths below as before.
  if (update.callback_query && studio.circlesMode() === 'circles' && parseNoteCallback(update.callback_query.data)) {
    const token = studio.botToken(live);
    if (token && await studio.deps.memory.deduper.firstSeen(`${agentId}__${update.update_id}`)) await studio.circleNotes.onCallback(live, update.callback_query, studio.deps.botFor(token));
    return;
  }
  // Circles channel previews (pp/ps/pe/px, S5) only while Circles is 'circles'; otherwise they take the paths below as before.
  if (update.callback_query && studio.circlesMode() === 'circles' && parsePostCallback(update.callback_query.data)) {
    const token = studio.botToken(live);
    if (token && await studio.deps.memory.deduper.firstSeen(`${agentId}__${update.update_id}`)) await studio.circleChannels.onCallback(live, update.callback_query, studio.deps.botFor(token));
    return;
  }
  // Circles card buttons (c*:) are decided here, before the gateway's share/keep callbacks: in a group
  // by the circle ledger (S2, STUDIO_CIRCLES=circles), in a DM by the agent card's receipts (S1).
  if (update.callback_query && studio.circlesMode() !== 'off' && parseCardCallback(update.callback_query.data)) {
    const token = studio.botToken(live), query = update.callback_query, type = query.message?.chat.type;
    if (token && await studio.deps.memory.deduper.firstSeen(`${agentId}__${update.update_id}`)) {
      if ((type === 'group' || type === 'supergroup') && studio.circlesMode() === 'circles') await studio.circleGroups.onCardTap(live, query, studio.deps.botFor(token));
      else await circleCallback(studio, live, query, studio.deps.botFor(token));
    }
    return;
  }
  const msg = update.message ?? update.edited_message;
  if (!msg) {
    await gateway.handleUpdate(agentId, update);
    return;
  }
  if (!msg.from || msg.from.is_bot || (live.blocked ?? []).includes(msg.from.id)) return;

  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    if (!state.groups.some((g) => g.chatId === msg.chat.id && g.agentIds.includes(agentId))) return;
    // Circles S5: a channel post Telegram mirrors into its comments group is the channel's, not a person's: nothing is kept of it.
    if (msg.is_automatic_forward && studio.circlesMode() === 'circles') return;
    for (const user of msg.new_chat_members ?? []) await studio.noteGroupMembership(msg.chat.id, user, 'member');
    if (msg.left_chat_member) await studio.noteGroupMembership(msg.chat.id, msg.left_chat_member, 'left');
    // Circles: one silent welcome per newcomer, from the agent that speaks for the circle.
    if (msg.new_chat_members?.length) await studio.circleGroups.welcome(live, msg.chat.id, msg.new_chat_members);
    await studio.verifyGroupAudience(agentId, msg.chat.id);
    // Circles: /leave in a circle chat withdraws before anything else sees it.
    if (await studio.circleGroups.groupCommand(live, msg)) return;
    // Settings v2: /settings and the other settings commands answer by a private message, never in the group. New
    // messages only: an edit (even into "/voice") never answers, admits a guest or spends speech; it goes on as an edit.
    if (!update.edited_message && await studio.settingsBot.groupCommand(live, msg, state)) return;
    // Rebuild when the speaker is new to the group so they count in its audience right away.
    await studio.noteGroupSpeaker(msg.chat.id, msg.from);
    ({ gateway } = await studio.gateway(endpoint));
    await gateway.handleUpdate(agentId, update);
    return;
  }
  if (msg.chat.type !== 'private') return;

  const member = state.members.find((m) => m.telegramId === msg.from!.id);
  // Settings v2 commands answer new messages only: an edit (even into "/settings") goes on to the archive's invalidation below.
  if (!update.edited_message) {
    // Settings v2: /ask or /connectors hands off to Vox (VoxxBot's Mini App), the only place connectors and app answers
    // live. This chat gets fixed copy and a URL button: no question, connector data or result enters it or its history.
    if (settingsV2() && CONNECTORS_COMMAND.test((msg.text ?? '').trim()) && (member && canUseAgent(member, live) || visibilityOf(live) === 'public')
      && await connectorsHandoff(studio, live, msg, update.update_id, !!member && canUseAgent(member, live))) return;
    // Settings v2: /settings, /memory, /activity, /voice and /start settings (members, and outsiders of a public agent).
    if (await studio.settingsBot.privateCommand(live, msg, update.update_id, state)) return;
  }
  if (member && canUseAgent(member, live)) {
    if (studio.deps.telegramArchive) {
      if (update.edited_message) {
        await studio.deps.telegramArchive.invalidateEditedMessage(agentId, msg);
        return;
      }
      try {
        if (await studio.deps.telegramArchive.command(agentId, msg)) return;
        await studio.deps.telegramArchive.capture(agentId, msg, update.update_id);
      } catch (error) {
        if (error instanceof ArchiveCommandDeliveryError) {
          logTelegramDiagnostic(studio.deps.logger ?? console, 'update_failed');
          return;
        }
        if (error instanceof ArchiveAdmissionRefusedError) {
          await botOf(studio, live)?.sendMessage(msg.chat.id, 'The archive is unavailable for this request. This message was not saved or processed. Use /archive status, /archive clear or /archive disable. You can resend your message after recovery.');
          return;
        }
        if (/^\/archive(?:@\S+)?(?:\s|$)/i.test(msg.text ?? '')) {
          await botOf(studio, live)?.sendMessage(msg.chat.id, 'The archive request is unavailable. Use /archive status to check the current state.');
          return;
        }
        throw error;
      }
    }
    // Circles: a member's /leave withdraws from the circles where they cover this agent; otherwise today's path.
    if (studio.circlesMode() === 'circles' && /^\/leave(@\S+)?$/i.test((msg.text ?? '').trim())) {
      const left = await studio.circleGroups.leaveAll(member.telegramId, agentId, `leave:dm:${agentId}:${update.update_id}`);
      if (left) {
        const keyboard = await studio.settingsBot.trailingKeyboard(agentId, 'leave', msg.from!);
        await botOf(studio, live)?.sendMessage(msg.chat.id, groupCopy(localeOf(msg.from!.language_code)).leftGroups(left), ...(keyboard ? [{ keyboard }] : []));
        return;
      }
    }
    // Circles S5: /post and replies to its Edit prompt, before anything else sees them.
    if (studio.circlesMode() === 'circles' && (parsePostCommand(msg.text) || msg.reply_to_message)) {
      const bot = botOf(studio, live), key = `channels:${agentId}:${update.update_id}`;
      if (bot && (await studio.circleChannels.command(live, member, msg, bot, key) || await studio.circleChannels.editReply(live, member, msg, bot, key))) return;
    }
    noteRequestedRoutineActivity(studio, agentId, msg);
    if (await handleRequestedRoutineMessage(studio, agentId, msg, endpointId)) return;
    const turnId = createHash('sha256').update(JSON.stringify([agentId, endpointId ?? '', update.update_id])).digest('hex');
    const observe = await beginObservation(studio, member.telegramId, agentId, 'work', 'telegram', turnId);
    try {
      const result = await observe.run(() => gateway.handleUpdate(agentId, update));
      // Duplicate and command updates are not new conversation measurements.
      if (result === 'replied') await observe('responded');
      else if (result === 'ignored') await observe('unknown');
    } catch (error) { await observe(observationCancelled(error) ? 'cancelled' : 'failed'); throw error; }
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
  if (studio.circlesMode() !== 'off') {
    await circleDirect(studio, live, msg, update, bot, endpoint);
    return;
  }
  const standing = await studio.admitGuest(agentId, msg.from);
  if (standing === 'blocked' || standing === 'over-limit') return;
  if (standing === 'limit-reached') {
    await bot.sendMessage(msg.chat.id, `I've enjoyed talking, but I need a break. Let's pick this up tomorrow.`);
    return;
  }
  ({ gateway } = await studio.gateway(endpoint));
  const text = msg.text ?? msg.caption ?? '';
  if (text.startsWith('/')) {
    // Commands (/start, /memories…) go straight through; the gateway handles them.
    await gateway.handleUpdate(agentId, update);
    return;
  }
  // A voice note is decided like text, on a fixed content-free placeholder. A
  // stranger's audio is never downloaded or transcribed: not before this
  // decision, and not after it either, because the gateway never transcribes
  // for an audience that includes a guest (PRIV-023).
  const decision = await studio.decideOnStranger(live, text || (msg.voice ? STRANGER_VOICE_PLACEHOLDER : ''));
  if (decision.action === 'reply') {
    await gateway.handleUpdate(agentId, update);
  } else if (decision.action === 'decline') {
    await bot.sendMessage(msg.chat.id, decision.message!);
  } else if (decision.action === 'block') {
    await studio.blockByAgent(agentId, msg.from.id, text);
    await bot.sendMessage(msg.chat.id, decision.message!);
  }
}

/** The bot side of the registry's 'agent.connectors' command and its alias, from the one command table (settings-commands.ts). */
export const CONNECTORS_COMMANDS: readonly string[] = commandNames(BOT_SETTINGS_COMMANDS.find((c) => c.settingId === 'agent.connectors')!);
const CONNECTORS_COMMAND = new RegExp(`^/(${CONNECTORS_COMMANDS.join('|')})(@\\S+)?$`, 'i');
/**
 * A quiet reply: fixed copy and, for a member, one URL button into Vox (settings-bot.ts connectorsReply); false
 * (today's path) when there is nothing to send. Never a web_app button to an agent-signed page.
 */
async function connectorsHandoff(studio: Studio, live: Agent, msg: TelegramMessage, updateId: number, member: boolean): Promise<boolean> {
  const reply = studio.settingsBot.connectorsReply(live, msg.from, member), token = studio.botToken(live);
  if (!reply || !token) return false;
  if (!await studio.deps.memory.deduper.firstSeen(`connectors:${live.id}:${updateId}`)) return true;
  await studio.deps.botFor(token).sendMessage(msg.chat.id, reply.text, { silent: true, keyboard: reply.keyboard })
    .catch(() => logTelegramDiagnostic(studio.deps.logger ?? console, 'update_failed'));
  return true;
}

const CHOICES: Partial<Record<CardAction, JoinChoice>> = { cj: 'joined', cr: 'reply_only', cd: 'declined' };
const REFUSED = { expired: 'expired', not_yours: 'notYours', used: 'used', early: 'early', unavailable: 'expired' } as const satisfies Record<Extract<ChoiceOutcome, { ok: false }>['reason'], string>;
/** Relationship and memory controls; a participant has no stored context for them to act on, and they must not create any. */
const CONTROL_COMMANDS = new Set(['/memories', '/forget', '/forgetall', '/pause', '/resume', '/stop']);
const PRESENT = new Set(['creator', 'administrator', 'member']);
/** Gateway commands a participant may run without the stranger decision: they read no stored context. */
const DIRECT_COMMANDS = new Set(['/whoami']);

/**
 * A public agent's DM from a non-member while Circles is on (GROUP_AGENTS_SPEC R2, §9 S1). Pressing
 * Start grants nothing: it shows the agent card. Until they choose, every message gets the card again,
 * with no model call and no stranger decision. Join and Only reply get core replies with no stored
 * context; Not me stops processing at once; /leave withdraws the choice before saying so, always: it
 * is never counted against or blocked by the guest limit.
 */
async function circleDirect(studio: Studio, live: Agent, msg: TelegramMessage, update: TelegramUpdate, bot: TelegramBotClient, endpoint?: { personaId: string; id: string }): Promise<void> {
  // A redelivered update answers once (the gateway's own key still guards what it is handed).
  if (!await studio.deps.memory.deduper.firstSeen(`circles:${live.id}:${update.update_id}`)) return;
  const from = msg.from!;
  const copy = circleCopy(localeOf(from.language_code));
  const text = msg.text ?? msg.caption ?? '';
  const [head = '', payload] = text.trim().split(/\s+/);
  const command = text.startsWith('/') ? head.split('@')[0].toLowerCase() : '';
  if (command === '/leave') {
    // Out of this agent's circles first (commit, then invalidation), then the choice, then the acknowledgement.
    const circles = await studio.circleGroups.leaveAll(from.id, live.id, `leave:dm:${live.id}:${update.update_id}`);
    const had = await studio.withdrawAgentChoice(live.id, from.id), group = groupCopy(localeOf(from.language_code));
    const said = had ? copy.left(live.persona.name) + (circles ? ` ${group.leftCircles(circles)}` : '') : circles ? group.leftGroups(circles) : copy.notChosen;
    if (!(live.blocked ?? []).includes(from.id)) {
      const keyboard = await studio.settingsBot.trailingKeyboard(live.id, 'leave', from);
      await bot.sendMessage(msg.chat.id, said, ...(keyboard ? [{ keyboard }] : []));
    }
    return;
  }
  const choice = (await studio.agentChoice(live.id, from.id))?.choice;
  if (choice === 'declined' && command !== '/start') return;
  const standing = await studio.admitGuest(live.id, from);
  if (standing === 'blocked' || standing === 'over-limit') return;
  if (standing === 'limit-reached') {
    await bot.sendMessage(msg.chat.id, copy.limit);
    return;
  }
  if (command === '/start') {
    const start = parseStartPayload(payload);
    const group = start?.kind === 'join' ? await joinLinkGroup(studio, live, bot, start.code, from.id) : undefined;
    if (start?.kind === 'join' && group === undefined) await bot.sendMessage(msg.chat.id, copy.notInGroup);
    else await sendAgentCard(studio, live, bot, msg.chat.id, from, choice, group, group === undefined ? undefined : start!.code);
    return;
  }
  if (!choice) {
    await sendAgentCard(studio, live, bot, msg.chat.id, from);
    return;
  }
  // Circles notes (S3): /notes, /forget <n> and "remember this" go to the gateway's notes path, never the stranger decision.
  if (studio.circleNotes.wants(live, text)) {
    const { gateway } = await studio.gateway(endpoint);
    await gateway.handleUpdate(live.id, update);
    return;
  }
  const control = command ? undefined : parseExplicitControl(text);
  if (CONTROL_COMMANDS.has(command) || control) {
    // Circles notes (S3): the notes they saved are what this agent keeps of them; "nothing kept" only while they hold none.
    const kind = command === '/memories' ? 'memories' : command === '/forgetall' || control === 'forget' ? 'forget' : 'other';
    if (await studio.circleNotes.outsiderControl(live, msg, kind)) return;
    const keyboard = await studio.settingsBot.trailingKeyboard(live.id, command || (control === 'forget' ? 'forgetall' : control ?? ''), from);
    await bot.sendMessage(msg.chat.id, copy.nothingKept, ...(keyboard ? [{ keyboard }] : []));
    return;
  }
  const { gateway } = await studio.gateway(endpoint);
  if (DIRECT_COMMANDS.has(command)) {
    await gateway.handleUpdate(live.id, update);
    return;
  }
  // They chose to talk; the agent still decides in character, so declines and blocks keep working.
  // Any other slash text is a message like the rest: it never skips this decision.
  const decision = await studio.decideOnStranger(live, text || (msg.voice ? STRANGER_VOICE_PLACEHOLDER : ''));
  if (decision.action === 'reply') await gateway.handleUpdate(live.id, update);
  else if (decision.action === 'decline') await bot.sendMessage(msg.chat.id, decision.message!);
  else if (decision.action === 'block') {
    await studio.blockByAgent(live.id, from.id, text);
    await bot.sendMessage(msg.chat.id, decision.message!);
  }
}

/**
 * The card is recorded (receipt) before it is sent, so its buttons answer only this person. From a group's j_ link
 * (membership checked) the pet button carries `?j=<joinCode>`, so the pet offers that group's choices (S4).
 */
async function sendAgentCard(studio: Studio, live: Agent, bot: TelegramBotClient, chatId: number, from: TelegramUser, current?: JoinChoice, group?: number, joinCode?: string): Promise<void> {
  const page = petPageUrl(studio.deps.webAppUrl, live.id), pet = page && joinCode ? `${page}?j=${joinCode}` : page;
  const card = agentCard(live.persona.name, localeOf(from.language_code), current, !!pet);
  const receipt = await studio.presentAgentCard(live.id, from.id, card, group);
  const keyboard: InlineKeyboard = { inline_keyboard: [
    [{ text: card.labels.join, callback_data: cardCallback('cj', receipt.id) }],
    [{ text: card.labels.reply, callback_data: cardCallback('cr', receipt.id) }, { text: card.labels.decline, callback_data: cardCallback('cd', receipt.id) }],
    ...(pet ? [[{ text: card.labels.open, web_app: { url: pet } }]] : []),
  ] };
  await bot.sendMessage(chatId, card.text, { keyboard });
}

/** A j_ code is unverified intent: it must name a group with this agent, and the person must be present there now. */
async function joinLinkGroup(studio: Studio, live: Agent, bot: TelegramBotClient, code: string, telegramId: number): Promise<number | undefined> {
  const group = (await studio.deps.store.read()).groups.find((g) => g.joinCode === code && g.agentIds.includes(live.id));
  if (!group) return undefined;
  try {
    const member = await bot.getChatMember(group.chatId, telegramId);
    return PRESENT.has(member.status) || (member.status === 'restricted' && member.is_member === true) ? group.chatId : undefined;
  } catch { return undefined; }
}

/** A tap on an agent card: recorded durably first, then the tapper's alert, then the card loses its choices. */
async function circleCallback(studio: Studio, live: Agent, query: TelegramCallbackQuery, bot: TelegramBotClient): Promise<void> {
  const card = parseCardCallback(query.data)!;
  const copy = circleCopy(localeOf(query.from.language_code));
  const choice = CHOICES[card.action];
  if ((live.blocked ?? []).includes(query.from.id)) { await bot.answerCallbackQuery(query.id); return; }
  if (!choice) { await bot.answerCallbackQuery(query.id, copy.soon); return; }
  if (query.message?.chat.type !== 'private') { await bot.answerCallbackQuery(query.id, copy.expired, true); return; }
  const outcome = await studio.recordAgentChoice(live.id, query.from.id, card.id, choice, query.id);
  if (!outcome.ok) { await bot.answerCallbackQuery(query.id, copy[REFUSED[outcome.reason]], true); return; }
  const locale = outcome.join.notice.locale, said = choiceReceipt(live.persona.name, choice, locale);
  await bot.answerCallbackQuery(query.id, said, true);
  const pet = choice === 'declined' ? null : petPageUrl(studio.deps.webAppUrl, live.id);
  await bot.editMessageText(query.message.chat.id, query.message.message_id, said,
    pet ? { inline_keyboard: [[{ text: circleCopy(locale).open(live.persona.name).slice(0, 64), web_app: { url: pet } }]] } : undefined).catch(() => undefined);
}

function botOf(studio: Studio, agent: Agent): TelegramBotClient | null {
  const token = studio.botToken(agent);
  return token ? studio.deps.botFor(token) : null;
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
    // Settings v2: the manager's /settings menu (nothing with the flag off).
    await studio.settingsBot.syncManagerMenu();
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
