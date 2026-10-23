/**
 * Circles S2 in Telegram groups (GROUP_AGENTS_SPEC §9 S2, F1, F2, F5, F6 as amended by R2): the circle
 * card a host-added agent posts, in-group Join / Only reply / Not me, "N of M", include cards for later
 * agents, newcomer welcomes, the join nudge, /leave, and leaves seen by Telegram. The ledger itself is
 * circles/service.ts; this module owns flags, Telegram calls and their order:
 *  - Join: person index, then one circle commit, then the tapper's alert, then their agent choices,
 *    then a debounced silent card edit; "Everyone's in" once per 24 h when N reaches M.
 *  - Not me, Only reply, /leave: the circle commit, then the group audience epoch bump and window
 *    clear for every agent in the chat, and only then the acknowledgement (PRIV-013). A repeat that
 *    changes nothing commits and invalidates nothing.
 *  - Cards: posted after the ledger names them; a failed post is retried (claimed, once a minute); each
 *    edit is claimed in the ledger first (counts from the committed document, one per card per 10 s);
 *    a card deleted in the chat is never edited again. "On" needs every joined person verified present.
 *  - A withdrawal never depends on a healthy ledger elsewhere: /leave in a DM is best-effort per circle.
 * Every entry point reads STUDIO_CIRCLES and STUDIO_CIRCLE_CHATS per use (the kill switch); with either
 * off nothing here sends, writes or changes a group turn. Cards show counts, never names.
 */

import type { InlineKeyboard, TelegramBotClient, TelegramCallbackQuery, TelegramMessage, TelegramUser } from '../tireh/telegram/client';
import { logTelegramDiagnostic } from '../tireh/telegram/diagnostics';
import { cardCallback, circleJoinUrl, newCardId, newJoinCode, parseCardCallback } from '../circles/codec';
import { activeJoin, CircleService, joinedOf } from '../circles/service';
import { CIRCLE_MAX_JOINED, type CardShown, type CircleAudience, type CircleDecision, type CircleDocument, type CircleGroupView, type CircleParticipationExport, type CircleSurface } from '../circles/contracts';
import { agentList, GROUP_NOTICE, groupCard, groupCopy, includeCard, joinedAlert, localeOf, nameAlert, welcomeText, type CircleLocale } from '../circles/notice';
import type { Studio } from './service';
import type { Agent } from './types';

/** At most one silent card edit per card per 10 s. */
export const CARD_EDIT_MS = 10_000;
const PRESENT = new Set(['creator', 'administrator', 'member']);
const DECISIONS: Partial<Record<string, CircleDecision>> = { cj: 'joined', cr: 'reply_only', cd: 'declined' };
const OFF: CircleAudience = { complete: false, joined: 0, humans: null, coveredBy: () => false, revision: 'circle:off' };

/** decide(): committed (the caller acknowledges, then settle()), or why not. `error`: the ledger failed. */
export type Decided =
  | { ok: true; outcome: Extract<Awaited<ReturnType<CircleService['decide']>>, { ok: true }>; covered: Agent[] }
  | { ok: false; reason: 'stale' | 'early' | 'full' | 'limit' | 'not_member' | 'blocked' | 'unavailable' | 'error' };

export interface CircleHost {
  now(): Date;
  /** Bumps the group's audience epoch and clears every agent's RAM window there. */
  invalidate(chatId: number): Promise<void>;
}

export class StudioCircleGroups {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(private readonly studio: Studio, private readonly host: CircleHost) {}

  private get ledger() { return this.studio.deps.circleLedger; }
  private get log() { return this.studio.deps.logger ?? console; }

  /** STUDIO_CIRCLES=circles, the chat on STUDIO_CIRCLE_CHATS, and a ledger wired; read per use, a failing reader is off. */
  on(chatId: number): boolean {
    if (!this.ledger || this.studio.circlesMode() !== 'circles') return false;
    try { return this.studio.deps.circleChats?.().has(chatId) ?? false; } catch { return false; }
  }

  private async doc(chatId: number): Promise<CircleDocument | null> {
    if (!this.on(chatId)) return null;
    try { return await this.ledger!.get(chatId); } catch { this.log.warn('[studio] circle_read_failed'); return null; }
  }

  /** Active agents among `ids`, in that order. */
  async agents(ids: readonly string[]): Promise<Agent[]> {
    const state = await this.studio.deps.store.read();
    return ids.flatMap((id) => state.agents.filter((a) => a.id === id && a.status === 'active'));
  }

  private botOf(agent: Agent): TelegramBotClient | null {
    const token = this.studio.botToken(agent);
    return token ? this.studio.deps.botFor(token) : null;
  }

  /** The agent that speaks for the circle: the card's, or the first agent still in it. */
  speaker(doc: CircleDocument): string | undefined {
    const active = doc.agents.filter((a) => a.status === 'active').map((a) => a.agentId);
    return doc.card && active.includes(doc.card.agentId) ? doc.card.agentId : active[0];
  }

  /** S4 precedence (Studio.petLaunch): the agent's own Main Mini App, else the manager bot's, else the S2 DM hop. */
  private async joinUrl(chatId: number, agent: Agent): Promise<string | undefined> {
    const code = (await this.studio.deps.store.read()).groups.find((g) => g.chatId === chatId)?.joinCode;
    return code && agent.bot?.username ? circleJoinUrl(agent.bot.username, code, this.studio.petLaunch(agent)) : undefined;
  }

  private keyboard(cardId: string, labels: { join: string; reply: string; decline: string; details: string }, url?: string): InlineKeyboard {
    return { inline_keyboard: [
      [{ text: labels.join, callback_data: cardCallback('cj', cardId) }, { text: labels.reply, callback_data: cardCallback('cr', cardId) }, { text: labels.decline, callback_data: cardCallback('cd', cardId) }],
      ...(url ? [[{ text: labels.details, url }]] : []),
    ] };
  }

  /** Readers less the Vox agent bots in the chat; null when Telegram can't count (fail closed: safe mode). */
  private async humans(chatId: number, count?: number | null, bot?: TelegramBotClient | null): Promise<number | null> {
    const c = count !== undefined ? count : bot ? await bot.getChatMemberCount(chatId).catch(() => null) : null;
    if (c === null) return null;
    const group = (await this.studio.deps.store.read()).groups.find((g) => g.chatId === chatId);
    return Math.max(0, c - (group?.agentIds.length ?? 0));
  }

  /** In public supergroups anyone can press a button: only a present member counts. */
  async present(bot: TelegramBotClient, chatId: number, telegramId: number): Promise<boolean> {
    return (await this.membership(bot, chatId, telegramId)) === 'present';
  }

  /** present, gone (left, kicked, restricted non-member), or unknown (Telegram failed: neither). */
  private async membership(bot: TelegramBotClient, chatId: number, telegramId: number): Promise<'present' | 'gone' | 'unknown'> {
    return (await this.member(bot, chatId, telegramId)).state;
  }

  private async member(bot: TelegramBotClient, chatId: number, telegramId: number): Promise<{ state: 'present' | 'gone' | 'unknown'; firstName?: string }> {
    try {
      const member = await bot.getChatMember(chatId, telegramId);
      if (PRESENT.has(member.status) || (member.status === 'restricted' && member.is_member === true)) return { state: 'present', firstName: member.user.first_name };
      return { state: ['left', 'kicked', 'restricted'].includes(member.status) ? 'gone' : 'unknown' };
    } catch { return { state: 'unknown' }; }
  }

  /**
   * S4: the first names of joined people Telegram says are still here (the pet only, never the group). Anyone it
   * says is gone is marked left (as refresh() does) and never named; unknown is never named either.
   */
  async presentNames(bot: TelegramBotClient, chatId: number, telegramIds: readonly number[]): Promise<{ names: string[]; gone: number[] }> {
    const checked = await Promise.all(telegramIds.map((id) => this.member(bot, chatId, id).then((m) => [id, m] as const)));
    const gone = checked.filter(([, m]) => m.state === 'gone').map(([id]) => id);
    if (gone.length) await this.onLeft(chatId, gone);
    const names = checked.flatMap(([, m]) => m.state === 'present' && m.firstName?.trim() ? [m.firstName.trim().slice(0, 64)] : []);
    return { names, gone };
  }

  /* ---------- F1: opening, include cards, agent removal ---------- */

  /**
   * A host (memberMayAdd) added `agent` to an allowlisted group: open the circle with one silent card,
   * or, when a circle is already open, post this agent's own include card. Strangers never get here.
   */
  async onAgentAdded(agent: Agent, chatId: number, adder: TelegramUser, count: number | null): Promise<void> {
    if (!this.on(chatId) || !agent.bot) return;
    const bot = this.botOf(agent);
    if (!bot) return;
    const at = this.host.now(), locale = localeOf(adder.language_code), humans = await this.humans(chatId, count);
    const doc = await this.ledger!.get(chatId);
    if (doc?.status === 'active') {
      // Already in (a redelivered add): only a card whose post failed goes up again.
      if (doc.agents.some((a) => a.agentId === agent.id && a.status === 'active')) { await this.postMissing(chatId, doc, at); return; }
      const cardId = newCardId(), card = includeCard(agent.persona.name, locale, 0, humans);
      if (!await this.ledger!.addAgent(chatId, agent.id, at, { id: cardId, copyHash: card.copyHash, locale })) return;
      await this.postInclude(chatId, agent, bot, cardId, locale, { joined: 0, total: humans, on: false });
      return;
    }
    await this.studio.deps.store.update((s) => { const g = s.groups.find((x) => x.chatId === chatId); if (g && !g.joinCode) g.joinCode = newJoinCode(); });
    const url = await this.joinUrl(chatId, agent), cardId = newCardId(), shown: CardShown = { joined: 0, total: humans, on: false };
    const card = groupCard([agent.persona.name], locale, shown, !!url);
    const { opened } = await this.ledger!.open({ chatId, agentId: agent.id, openedBy: adder.id, at, card: { id: cardId, copyHash: card.copyHash, locale, noticeVersion: GROUP_NOTICE.version } });
    if (!opened) return;
    await this.ledger!.setReaders(chatId, humans, at);
    await this.postCircleCard(chatId, bot, cardId, [agent.persona.name], locale, shown, url);
  }

  /** Posts the circle card; on success the ledger learns where it lives. A failure leaves it for postMissing. */
  private async postCircleCard(chatId: number, bot: TelegramBotClient, cardId: string, names: string[], locale: CircleLocale, shown: CardShown, url?: string): Promise<void> {
    const card = groupCard(names, locale, shown, !!url);
    const sent = await bot.sendMessage(chatId, card.text, { silent: true, keyboard: this.keyboard(cardId, card.labels, url) })
      .catch(() => { logTelegramDiagnostic(this.log, 'update_failed'); return null; });
    if (sent) await this.ledger!.markCard(chatId, cardId, { messageId: sent.message_id, shown });
  }

  private async postInclude(chatId: number, owner: Agent, bot: TelegramBotClient, cardId: string, locale: CircleLocale, shown: CardShown): Promise<void> {
    const card = includeCard(owner.persona.name, locale, shown.joined, shown.total);
    const sent = await bot.sendMessage(chatId, card.text, { silent: true, keyboard: { inline_keyboard: [[{ text: card.label, callback_data: cardCallback('ci', cardId) }]] } })
      .catch(() => { logTelegramDiagnostic(this.log, 'update_failed'); return null; });
    if (sent) await this.ledger!.markCard(chatId, cardId, { messageId: sent.message_id, shown }, owner.id);
  }

  /** Any card the ledger names whose post never succeeded goes up again (claimed: once a minute, one poster). */
  private async postMissing(chatId: number, doc: CircleDocument, at: Date): Promise<void> {
    const card = doc.card;
    if (doc.status === 'active' && card && card.messageId === undefined && !card.gone) {
      const [owner] = await this.agents([card.agentId]), bot = owner ? this.botOf(owner) : null;
      if (owner && bot && await this.ledger!.claimPost(chatId, { cardId: card.id }, at)) {
        const names = (await this.agents(card.agentIds)).map((a) => a.persona.name), url = await this.joinUrl(chatId, owner);
        await this.postCircleCard(chatId, bot, card.id, names, card.locale, CircleService.cardShown(doc, at), url);
      }
    }
    for (const entry of doc.agents) {
      if (doc.status !== 'active' || entry.status !== 'active' || !entry.card || entry.card.messageId !== undefined || entry.card.gone) continue;
      const [owner] = await this.agents([entry.agentId]), bot = owner ? this.botOf(owner) : null;
      if (!owner || !bot || !await this.ledger!.claimPost(chatId, { cardId: entry.card.id, agentId: entry.agentId }, at)) continue;
      await this.postInclude(chatId, owner, bot, entry.card.id, entry.card.locale, CircleService.cardShown(doc, at, entry.agentId));
    }
  }

  /** The agent left the chat: its coverage goes everywhere in the circle, and the circle closes with its last agent. */
  async onAgentRemoved(agentId: string, chatId: number): Promise<void> {
    if (!this.on(chatId)) return;
    try { await this.ledger!.removeAgent(chatId, agentId, this.host.now()); } catch { this.log.warn('[studio] circle_agent_removal_failed'); }
  }

  /* ---------- F2: taps on the group card and include cards ---------- */

  /** A tap on a circle button inside the group: decide() checks and commits, the tapper's alert, then settle(). Every refusal is an alert only the tapper sees. */
  async onCardTap(agent: Agent, query: TelegramCallbackQuery, bot: TelegramBotClient): Promise<void> {
    const parsed = parseCardCallback(query.data)!, chatId = query.message!.chat.id, from = query.from;
    const copy = groupCopy(localeOf(from.language_code)), alert = (text: string) => bot.answerCallbackQuery(query.id, text, true);
    if (parsed.action === 'ci') return this.onIncludeTap(agent, query, bot, parsed.id);
    const choice = DECISIONS[parsed.action];
    if (!choice) { await bot.answerCallbackQuery(query.id, copy.unavailable); return; }
    const decided = await this.decide(agent, bot, chatId, from.id, choice, parsed.id, query.id, 'group_card');
    if (!decided.ok) {
      if (decided.reason === 'blocked') { await bot.answerCallbackQuery(query.id); return; }
      if (decided.reason === 'error') { await alert(copy.unavailable).catch(() => undefined); return; }
      await alert({ stale: copy.expired, early: copy.early, full: copy.full, limit: copy.limit, not_member: copy.notMember, unavailable: copy.unavailable }[decided.reason]);
      return;
    }
    const said = choice === 'joined' ? joinedAlert(decided.covered.map((a) => a.persona.name), localeOf(from.language_code))
      : copy.alert[choice]() + (decided.outcome.previous === 'joined' ? copy.keptSuffix : '');
    await alert(said);
    await this.settle(chatId, from.id, choice, decided, query.id, 'group_card');
  }

  /**
   * One decision on the circle card, from the group card or the pet (S4: surface mini_app), checked in order: the
   * card is current; the person is a present member; not blocked; Join keeps ≤12 joined; the flag and allowlist are
   * on; the event is new (inside the commit). Index first, then one circle commit; a withdrawal that changed
   * something is invalidated in every agent of the chat before this returns, so the caller acknowledges after it.
   */
  async decide(agent: Agent, bot: TelegramBotClient, chatId: number, telegramId: number, choice: CircleDecision, cardId: string, eventId: string, surface: CircleSurface): Promise<Decided> {
    const at = this.host.now(), ledger = this.ledger;
    const doc = ledger ? await ledger.get(chatId).catch(() => null) : null;
    if (!doc || doc.status !== 'active' || doc.card?.id !== cardId) return { ok: false, reason: 'stale' };
    if (!await this.present(bot, chatId, telegramId)) return { ok: false, reason: 'not_member' };
    if ((agent.blocked ?? []).includes(telegramId)) return { ok: false, reason: 'blocked' };
    const already = doc.participants.some((p) => p.telegramId === telegramId && activeJoin(p, at));
    if (choice === 'joined' && !already && joinedOf(doc, at).length >= CIRCLE_MAX_JOINED) return { ok: false, reason: 'full' };
    if (!this.on(chatId)) return { ok: false, reason: 'unavailable' };
    let outcome: Awaited<ReturnType<CircleService['decide']>>;
    try {
      // The index first: a crash after it leaves a superset, never a row nobody can find for erasure.
      await ledger!.index(telegramId, chatId);
      outcome = await ledger!.decide(chatId, { telegramId, choice, cardId, eventId, at, surface });
    } catch { this.log.warn('[studio] circle_decide_failed'); return { ok: false, reason: 'error' }; }
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    // Not me / Only reply that changed something: invalidated in every agent of the chat before the person is told.
    if (!outcome.replay && !outcome.unchanged && choice !== 'joined') await this.host.invalidate(chatId);
    return { ok: true, outcome, covered: await this.agents(outcome.participant.coveredAgentIds) };
  }

  /** After the acknowledgement: a Join sets the person's agent choices for what it covers; then the card (debounced) and "Everyone's in". */
  async settle(chatId: number, telegramId: number, choice: CircleDecision, decided: Extract<Decided, { ok: true }>, eventId: string, surface: CircleSurface): Promise<void> {
    const { outcome, covered } = decided;
    if (outcome.unchanged || outcome.replay) return;
    if (choice === 'joined') {
      const e = outcome.participant.evidence;
      await this.studio.recordCircleChoice(covered.map((a) => a.id), telegramId, { id: e.noticeId, version: e.noticeVersion, copyHash: e.copyHash, locale: e.locale, presentedAt: e.presentedAt }, eventId, e.decidedAt, surface)
        .catch(() => this.log.warn('[studio] circle_choice_failed'));
    }
    await this.refresh(chatId).catch(() => this.log.warn('[studio] circle_card_failed'));
    if (choice === 'joined') await this.celebrate(chatId).catch(() => this.log.warn('[studio] circle_card_failed'));
  }

  private async onIncludeTap(agent: Agent, query: TelegramCallbackQuery, bot: TelegramBotClient, cardId: string): Promise<void> {
    const chatId = query.message!.chat.id, from = query.from, locale = localeOf(from.language_code), copy = groupCopy(locale);
    const alert = (text: string) => bot.answerCallbackQuery(query.id, text, true), at = this.host.now(), ledger = this.ledger;
    const doc = ledger ? await ledger.get(chatId).catch(() => null) : null;
    const entry = doc?.agents.find((a) => a.status === 'active' && a.card?.id === cardId);
    if (!doc || doc.status !== 'active' || entry?.agentId !== agent.id) { await alert(copy.expired); return; }
    if (!await this.present(bot, chatId, from.id)) { await alert(copy.notMember); return; }
    if ((agent.blocked ?? []).includes(from.id)) { await bot.answerCallbackQuery(query.id); return; }
    if (!this.on(chatId)) { await alert(copy.unavailable); return; }
    let outcome: Awaited<ReturnType<CircleService['include']>>;
    try { outcome = await ledger!.include(chatId, { telegramId: from.id, agentId: agent.id, cardId, eventId: query.id, at }); }
    catch { this.log.warn('[studio] circle_include_failed'); await alert(copy.unavailable).catch(() => undefined); return; }
    if (!outcome.ok) { await alert({ stale: copy.expired, early: copy.early, not_joined: copy.joinFirst }[outcome.reason]); return; }
    await alert(nameAlert(copy.included, agent.persona.name));
    if (outcome.replay) return;
    const p = (await ledger!.get(chatId))?.participants.find((x) => x.telegramId === from.id);
    if (p) await this.studio.recordCircleChoice([agent.id], from.id, { id: p.evidence.noticeId, version: p.evidence.noticeVersion, copyHash: entry.card!.copyHash, locale: entry.card!.locale, presentedAt: entry.card!.revisionAt }, query.id, at.toISOString())
      .catch(() => this.log.warn('[studio] circle_choice_failed'));
    await this.refresh(chatId).catch(() => this.log.warn('[studio] circle_card_failed'));
  }

  /* ---------- withdrawal and leaving ---------- */

  /** /leave for one circle: durable commit, then invalidation; the caller acknowledges after. */
  async leave(chatId: number, telegramId: number, eventId: string): Promise<{ changed: boolean; wasJoined: boolean; sameEvent?: true }> {
    const result = await this.ledger!.withdraw(chatId, telegramId, eventId, this.host.now());
    if (result.changed) {
      await this.host.invalidate(chatId);
      await this.refresh(chatId).catch(() => this.log.warn('[studio] circle_card_failed'));
    }
    return result;
  }

  /**
   * /leave in an agent's DM: out of every circle where the person is joined and covers that agent.
   * A withdrawal never needs the flag on (it only stops use); with no ledger it is a no-op. Best-effort
   * per circle and never throws: one unreadable circle (or index) must not block the S1 withdrawal and
   * the acknowledgement that follow (PRIV-016).
   */
  async leaveAll(telegramId: number, agentId: string, eventId: string): Promise<number> {
    const ledger = this.ledger;
    if (!ledger) return 0;
    let ids: string[];
    try { ids = (await ledger.repository.readIndex(telegramId)).groupIds; } catch { this.log.warn('[studio] circle_leave_failed'); return 0; }
    let left = 0;
    for (const gid of ids) {
      try {
        const doc = await ledger.repository.read(gid);
        const p = doc?.participants.find((x) => x.telegramId === telegramId);
        if (!doc || !p || p.state !== 'joined' || !p.coveredAgentIds.includes(agentId)) continue;
        const result = await ledger.withdraw(doc.chatId, telegramId, eventId, this.host.now());
        if (!result.changed) continue;
        await this.host.invalidate(doc.chatId);
        left++;
        await this.refresh(doc.chatId).catch(() => this.log.warn('[studio] circle_card_failed'));
      } catch { this.log.warn('[studio] circle_leave_failed'); }
    }
    return left;
  }

  /**
   * /leave typed in a circle chat. Handled (true) only while Circles is on for the chat and a circle is
   * open there; otherwise the message takes today's path. Every circle agent that receives it withdraws
   * (idempotent); the first change is acknowledged, silently, as a reply.
   */
  async groupCommand(agent: Agent, msg: TelegramMessage): Promise<boolean> {
    const text = (msg.text ?? '').trim();
    if (!text.startsWith('/') || !msg.from) return false;
    const [command, target] = text.split(/\s+/)[0].split('@');
    if (command.toLowerCase() !== '/leave' || (target && target.toLowerCase() !== agent.bot?.username.toLowerCase())) return false;
    const doc = await this.doc(msg.chat.id);
    if (!doc || doc.status !== 'active' || !doc.agents.some((a) => a.agentId === agent.id && a.status === 'active')) return false;
    const result = await this.leave(msg.chat.id, msg.from.id, `leave:${msg.chat.id}:${msg.message_id}`);
    // Another agent in the chat already withdrew them for this very message, and said so.
    if (result.sameEvent) return true;
    const copy = groupCopy(localeOf(msg.from.language_code)), bot = this.botOf(agent);
    const speaks = !!target || this.speaker(doc) === agent.id;
    if (bot && (result.changed || speaks)) {
      await bot.sendMessage(msg.chat.id, result.changed ? copy.left : copy.notIn, { replyTo: msg.message_id, silent: true }).catch(() => logTelegramDiagnostic(this.log, 'update_failed'));
    }
    return true;
  }

  /**
   * Telegram says they left (service message, chat_member, or a per-turn verify): state left, window
   * closed. A verify also passes the head count, the humans it verified present and, after a full
   * roster check, how many it saw.
   */
  async onLeft(chatId: number, telegramIds: number[], facts: { count?: number | null; present?: readonly number[]; seen?: number } = {}): Promise<void> {
    if (!this.on(chatId)) return;
    try {
      if (telegramIds.length) await this.ledger!.onLeft(chatId, telegramIds, this.host.now());
      await this.refresh(chatId, facts);
    } catch { this.log.warn('[studio] circle_left_failed'); }
  }

  /* ---------- F6: newcomers and the nudge ---------- */

  /** One silent welcome per newcomer, with the card's buttons, from the agent that speaks for the circle. */
  async welcome(agent: Agent, chatId: number, users: TelegramUser[]): Promise<void> {
    const doc = await this.doc(chatId);
    if (!doc || doc.status !== 'active' || !doc.card || this.speaker(doc) !== agent.id) return;
    const bot = this.botOf(agent);
    if (!bot) return;
    const names = (await this.agents(doc.card.agentIds)).map((a) => a.persona.name), url = await this.joinUrl(chatId, agent);
    const labels = groupCard(names, doc.card.locale, { on: false, joined: 0, total: null }, !!url).labels;
    // One welcome per batch (a host adding fifteen people gets one message, not fifteen).
    const fresh: TelegramUser[] = [];
    for (const user of users) {
      if (user.is_bot) continue;
      try {
        await this.ledger!.index(user.id, chatId);
        if (await this.ledger!.claimWelcome(chatId, user.id)) fresh.push(user);
      } catch { this.log.warn('[studio] circle_welcome_failed'); }
    }
    if (fresh.length) {
      try {
        await bot.sendMessage(chatId, welcomeText(fresh.map((u) => u.first_name), agent.persona.name, names, doc.card.locale), { silent: true, keyboard: this.keyboard(doc.card.id, labels, url) });
      } catch {
        // Not sent (a 429, say): the claims go, so a later service message can welcome them.
        logTelegramDiagnostic(this.log, 'update_failed');
        await this.ledger!.releaseWelcome(chatId, fresh.map((u) => u.id)).catch(() => this.log.warn('[studio] circle_welcome_failed'));
      }
    }
    await this.refresh(chatId).catch(() => this.log.warn('[studio] circle_card_failed'));
  }

  /**
   * The [Tap to join 🐾] button on a reply to someone who never chose in this circle: at most once per
   * person per group per 24 h, on the reply itself (never a DM), naming nobody.
   */
  async nudge(agentId: string, chatId: number, from: TelegramUser): Promise<InlineKeyboard | undefined> {
    const doc = await this.doc(chatId);
    if (!doc || doc.status !== 'active' || !doc.card || !doc.agents.some((a) => a.agentId === agentId && a.status === 'active')) return undefined;
    const row = doc.participants.find((p) => p.telegramId === from.id);
    const last = doc.nudges[String(from.id)], at = this.host.now();
    if ((row && row.state !== 'left') || (last && at.getTime() - Date.parse(last) < 86_400_000)) return undefined;
    const [agent] = await this.agents([agentId]), url = agent ? await this.joinUrl(chatId, agent) : undefined;
    if (!url) return undefined;
    await this.ledger!.index(from.id, chatId);
    if (!await this.ledger!.claimNudge(chatId, from.id, at)) return undefined;
    return { inline_keyboard: [[{ text: groupCopy(localeOf(from.language_code)).nudge, url }]] };
  }

  /* ---------- F5: N of M ---------- */

  /**
   * Brings the card (and include cards) to the current counts. N: joined with an unexpired consent; M:
   * head count less Vox agent bots. "On" needs every joined person verified present: a verify passes
   * who it saw; otherwise, when the counts say complete, each joined person is checked (at most 12
   * getChatMember calls) and anyone gone is marked left. Each edit is claimed in the ledger (counts
   * from the committed document, at most one per card per 10 s; a loser schedules one trailing
   * refresh). A failed edit never blocks the other cards; a card deleted in the chat is left alone.
   */
  async refresh(chatId: number, opts: { count?: number | null; present?: readonly number[]; seen?: number; force?: boolean } = {}): Promise<void> {
    const first = await this.doc(chatId);
    if (!first || first.status !== 'active') return;
    const at = this.host.now(), speaker = (await this.agents([this.speaker(first) ?? ''])).at(0), speakerBot = speaker ? this.botOf(speaker) : null;
    const humans = await this.humans(chatId, opts.count, speakerBot);
    const joined = joinedOf(first, at).map((p) => p.telegramId);
    let present = opts.present ? joined.filter((id) => opts.present!.includes(id)) : undefined;
    if (!present && speakerBot && humans !== null && joined.length === humans && humans <= CIRCLE_MAX_JOINED) {
      const checked = await Promise.all(joined.map(async (id) => [id, await this.membership(speakerBot, chatId, id)] as const));
      const gone = checked.filter(([, m]) => m === 'gone').map(([id]) => id);
      if (gone.length) await this.ledger!.onLeft(chatId, gone, at);
      present = checked.filter(([, m]) => m === 'present').map(([id]) => id);
    }
    const doc = await this.ledger!.setReaders(chatId, humans, at, { ...(present ? { present } : {}), ...(opts.seen !== undefined ? { seen: opts.seen } : {}) });
    if (!doc || doc.status !== 'active') return;
    await this.postMissing(chatId, doc, at);
    if (doc.card) await this.editCard(chatId, doc, { cardId: doc.card.id }, at, opts.force);
    for (const entry of doc.agents) if (entry.status === 'active' && entry.card) await this.editCard(chatId, doc, { cardId: entry.card.id, agentId: entry.agentId }, at, opts.force);
  }

  /** One claimed card edit; its own failure is contained (logged; a deleted card is marked gone). */
  private async editCard(chatId: number, doc: CircleDocument, target: { cardId: string; agentId?: string }, at: Date, force?: boolean): Promise<void> {
    try {
      const ownerId = target.agentId ?? doc.card?.agentId;
      const [owner] = await this.agents([ownerId ?? '']), bot = owner ? this.botOf(owner) : null;
      if (!owner || !bot) return;
      const claim = await this.ledger!.claimEdit(chatId, target, at, CARD_EDIT_MS, force);
      if (claim.kind === 'wait') { this.schedule(chatId, claim.ms); return; }
      if (claim.kind !== 'edit') return;
      let text: string, keyboard: InlineKeyboard;
      if (target.agentId) {
        const entry = doc.agents.find((a) => a.agentId === target.agentId)!.card!;
        const card = includeCard(owner.persona.name, entry.locale, claim.shown.joined, claim.shown.total);
        text = card.text; keyboard = { inline_keyboard: [[{ text: card.label, callback_data: cardCallback('ci', target.cardId) }]] };
      } else {
        const names = (await this.agents(doc.card!.agentIds)).map((a) => a.persona.name), url = await this.joinUrl(chatId, owner);
        const card = groupCard(names, doc.card!.locale, claim.shown, !!url);
        text = card.text; keyboard = this.keyboard(target.cardId, card.labels, url);
      }
      try { await bot.editMessageText(chatId, claim.messageId, text, keyboard); }
      catch (error) {
        const why = String((error as { description?: string }).description ?? (error as Error).message ?? '');
        if (/message is not modified/i.test(why)) return;
        if (/message to edit not found|message_id_invalid|message can't be edited/i.test(why)) {
          // Deleted in the chat (normal housekeeping): never edited or reposted again.
          await this.ledger!.markCard(chatId, target.cardId, { gone: true, messageId: undefined }, target.agentId);
          return;
        }
        // Anything else: what the card shows is unknown, so a later refresh shows it again.
        await this.ledger!.markCard(chatId, target.cardId, { shown: claim.previous }, target.agentId);
        throw error;
      }
    } catch { this.log.warn('[studio] circle_card_failed'); }
  }

  /** One trailing refresh per chat, for when a debounced card may be edited. */
  private schedule(chatId: number, wait: number): void {
    if (this.timers.has(chatId)) return;
    const timer = setTimeout(() => { this.timers.delete(chatId); void this.refresh(chatId, { force: true }).catch(() => undefined); }, Math.max(0, wait));
    timer.unref?.();
    this.timers.set(chatId, timer);
  }

  /**
   * "Everyone's in 🎉", with a normal notification, at most once per 24 h, when N reaches M (and every
   * joined person was verified present). It names only agents every reader covers.
   */
  private async celebrate(chatId: number): Promise<void> {
    const doc = await this.doc(chatId), at = this.host.now();
    const audience = CircleService.audience(doc, at);
    if (!doc?.card || !audience.complete) return;
    const [speaker] = await this.agents([this.speaker(doc) ?? '']), bot = speaker ? this.botOf(speaker) : null;
    const covered = doc.agents.filter((a) => a.status === 'active' && audience.coveredBy(a.agentId)).map((a) => a.agentId);
    if (!bot || !covered.length || !await this.ledger!.claimCelebration(chatId, at)) return;
    const names = (await this.agents(covered)).map((a) => a.persona.name);
    await bot.sendMessage(chatId, groupCopy(doc.card.locale as CircleLocale).everyone(agentList(names, doc.card.locale)));
  }

  /* ---------- reads for later slices, listGroups, rights ---------- */

  /** Joined participants (unexpired), for the per-turn verify; none while Circles is off for the chat. */
  async joinedIds(chatId: number): Promise<number[]> {
    const doc = await this.doc(chatId);
    return doc ? joinedOf(doc, this.host.now()).map((p) => p.telegramId) : [];
  }

  /** {complete, joined, humans, coveredBy(agentId), revision}; never complete while Circles is off for the chat. */
  async audience(chatId: number, facts: { humans?: number | null; present?: readonly number[] } = {}): Promise<CircleAudience> {
    const doc = await this.doc(chatId);
    if (!doc) return OFF;
    const group = (await this.studio.deps.store.read()).groups.find((g) => g.chatId === chatId);
    return CircleService.audience(doc, this.host.now(), { ...facts, agentIds: group?.agentIds ?? [] });
  }

  async view(chatId: number): Promise<CircleGroupView | undefined> {
    const doc = await this.doc(chatId);
    return doc && doc.status === 'active' ? CircleService.view(doc, this.host.now()) : undefined;
  }

  /** The person's own participation only, whatever the flag. */
  async exportFor(telegramId: number): Promise<CircleParticipationExport[]> {
    return this.ledger ? this.ledger.exportFor(telegramId) : [];
  }

  /** Forget me, whatever the flag: their rows go; where they were joined, the audience is invalidated. */
  async eraseFor(telegramId: number): Promise<number> {
    if (!this.ledger) return 0;
    const { erased, joinedChats } = await this.ledger.eraseFor(telegramId);
    for (const chatId of joinedChats) await this.host.invalidate(chatId);
    return erased;
  }
}
