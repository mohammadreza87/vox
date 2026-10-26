/**
 * Circles S3 (GROUP_AGENTS_SPEC R2 decisions 2-4, §9 S3): personal notes, group copies, quiet DM
 * delivery, recall and review. The ledger is circles/notes.ts; this module owns flags, consent checks,
 * Telegram calls and their order:
 *  - Save: an explicit "remember this" (the NoteSelector) becomes a proposal, recorded before it is
 *    shown; only the asker's tap confirms it (cs:/cn:, bound to them; a forwarded button is refused).
 *    A DM save writes one copy, then "📌 Saved". A group save re-checks the circle at the tap (fresh
 *    verify, complete and covering this agent), writes one copy into each joined recipient's own
 *    notes (shared noteId; all or none), and only then posts "📌 Saved for the N of you" (counts
 *    only) and sends each recipient a quiet DM from this agent's bot. A DM that fails is ignored: the
 *    copy is stored.
 *  - Use: an agent may use a person's copy only when the copy names it and the person currently
 *    chose Join for it (or is a Studio member who may use it). A DM uses the person's own copies; a
 *    group turn that is circle-complete for the agent uses a note only when every reader holds an
 *    active copy of it ("From <group>"). Context only: never memory, never extracted.
 *  - Review: /notes lists your own copies for this agent with [Erase] buttons (ce:, owner-bound);
 *    /forgetnote <n> (and an outsider's /forget <n>, or a member's right after /notes) erases one,
 *    counted against the list that was shown. In a group /notes is answered by a silent DM. Erasing
 *    removes only your own copy; leaving a circle erases nothing.
 * Every entry point reads STUDIO_CIRCLES per use (the kill switch): anything but 'circles' reads,
 * writes and sends nothing here, and the turn boundary is exactly as without notes.
 */

import { createHash } from 'crypto';
import type { ChatContext } from '../tireh/types';
import type { InlineKeyboard, TelegramBotClient, TelegramCallbackQuery, TelegramMessage, TelegramUser } from '../tireh/telegram/client';
import { activeReadScope } from '../tireh/privacy/read-scope';
import { noteCallback, parseNoteCallback, receiptOwner } from '../circles/codec';
import { activeAgents, activeJoin, CircleService, groupIdOf, joinedOf } from '../circles/service';
import { NOTE_MAX_CHARS, type CircleDocument, type CircleParticipant, type NoteCopy, type NoteExport, type NoteProposal, type PersonNotes, type PetNote } from '../circles/contracts';
import { claimed, usableCopies, type CircleNotes } from '../circles/notes';
import { noteSelectorFor, type NoteSelection } from '../circles/note-selector';
import { localeOf, notesCopy } from '../circles/notice';
import { canUseAgent, visibilityOf } from './permissions';
import { dimGrowthForNotes } from './pet-growth-store';
import type { Studio } from './service';
import type { Agent, StudioState } from './types';

/** /notes shows at most the newest this many, within LIST_BUDGET characters (Telegram's cap is 4096, and an edit is never truncated). */
const LIST_MAX = 20, LIST_BUDGET = 3800, LINE_MAX = 120, TITLE_MAX = 40;
/** RAM snapshots of the lists shown, per agent and person (oldest go first). */
const LISTED_MAX = 5000;
const tgOf = (personId: string) => { const m = /^tg-([1-9]\d*)$/.exec(personId); return m ? Number(m[1]) : undefined; };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clip = (text: string, n = 200) => text.length > n ? `${text.slice(0, n - 1)}…` : text;
const commandOf = (text: string) => {
  const trimmed = text.trim(), [head = '', arg] = trimmed.split(/\s+/), [name = '', target] = head.split('@');
  return { command: trimmed.startsWith('/') ? name.toLowerCase() : '', target, arg };
};
/** Bound to the bot it names: "/notes@OtherBot" is not this agent's command. */
const forOther = (agent: Agent, target?: string) => !!target && target.toLowerCase() !== agent.bot?.username.toLowerCase();
const NOTE_COMMANDS = new Set(['/notes', '/forget', '/forgetnote']);
/** The pet's notes panel shows at most this many copies. */
const PET_NOTES_MAX = 100;

/** What one agent may use in one chat: who reads, and each reader's notes. */
type Gathered = { kind: 'dm' | 'group'; readers: number[]; docs: Array<PersonNotes | null> };

export class StudioCircleNotes {
  /**
   * RAM only: the copyIds of the last list shown per agent and person; /forget <n> counts against it, so a
   * save landing since never shifts the number. /memories drops it (a member's /forget is theirs again).
   */
  private readonly listed = new Map<string, string[]>();

  constructor(private readonly studio: Studio, private readonly host: { now(): Date }) {}

  private get ledger() { return this.studio.deps.notesLedger; }
  private get log() { return this.studio.deps.logger ?? console; }

  /** STUDIO_CIRCLES=circles and a notes ledger wired; read per use. */
  on(): boolean { return !!this.ledger && this.studio.circlesMode() === 'circles'; }

  private botOf(agent: Agent): TelegramBotClient | null {
    const token = this.studio.botToken(agent);
    return token ? this.studio.deps.botFor(token) : null;
  }

  /** The configured NoteSelector's pick; a disabled or failing selector proposes nothing. */
  private pick(agent: Agent, text: string, chatKind: 'private' | 'group', message?: TelegramMessage): NoteSelection | null {
    try {
      const selector = noteSelectorFor(this.studio.deps.noteSelector?.() ?? 'explicit');
      return selector.select({ text, chatKind, names: [agent.persona.name, ...(agent.bot ? [`@${agent.bot.username}`] : [])], replied: message?.reply_to_message?.text ?? message?.reply_to_message?.caption });
    } catch { this.log.warn('[studio] note_selector_unavailable'); return null; }
  }

  /** An outsider's DM text the notes path owns while Circles is on: it skips the stranger decision. */
  wants(agent: Agent, text: string): boolean {
    if (!this.on()) return false;
    const { command, target } = commandOf(text);
    if (command) return NOTE_COMMANDS.has(command) && !forOther(agent, target);
    return !!this.pick(agent, text, 'private');
  }

  /* ---------- who may use a person's notes ---------- */

  /** Joined for this agent now (S1 choice), or a Studio member who may use it; never a blocked person or an inactive agent. */
  private async allows(state: StudioState, agentId: string, telegramId: number): Promise<boolean> {
    const agent = state.agents.find((a) => a.id === agentId && a.status === 'active');
    if (!agent || agent.blocked?.includes(telegramId)) return false;
    const member = state.members.find((m) => m.telegramId === telegramId);
    if (member && canUseAgent(member, agent)) return true;
    if (visibilityOf(agent) !== 'public') return false;
    return (await this.studio.agentChoice(agentId, telegramId))?.choice === 'joined';
  }

  /** Synchronous: members only (the choice store has no synchronous read); anyone else throws (the fence then fails closed). */
  private allowsNow(state: StudioState, agentId: string, telegramId: number): boolean {
    const agent = state.agents.find((a) => a.id === agentId && a.status === 'active');
    if (!agent || agent.blocked?.includes(telegramId)) return false;
    const member = state.members.find((m) => m.telegramId === telegramId);
    if (member && canUseAgent(member, agent)) return true;
    throw new Error('notes_authority_unavailable');
  }

  /* ---------- recall (RuntimePrivacy readNotes*) ---------- */

  /** The labelled notes `agentId` may use in this chat, with their revision; undefined = none. */
  async read(agentId: string, chat: ChatContext): Promise<{ revision: string; context: string[] } | undefined> {
    const at = this.host.now(), gathered = await this.gather(agentId, chat, at);
    return gathered && this.render(agentId, gathered, at);
  }

  async authority(agentId: string, chat: ChatContext): Promise<{ revision: string } | undefined> {
    const notes = await this.read(agentId, chat);
    return notes && { revision: notes.revision };
  }

  /** The same revision, synchronously (the indexed send fence); throws where a store cannot be read synchronously. */
  authorityNow(agentId: string, chat: ChatContext): { revision: string } | undefined {
    if (!this.on()) return undefined;
    const readState = this.studio.deps.store.readCommittedForEffect;
    if (!readState) throw new Error('notes_authority_unavailable');
    const state = readState.call(this.studio.deps.store), at = this.host.now();
    let gathered: Gathered | undefined;
    if (chat.kind === 'private') {
      const tg = tgOf(chat.personId);
      if (tg !== undefined && this.allowsNow(state, agentId, tg)) gathered = { kind: 'dm', readers: [tg], docs: [this.ledger!.readNow(tg)] };
    } else {
      const chatId = chat.group.telegramChatId, ledger = this.studio.deps.circleLedger;
      if (!ledger || !this.studio.circleGroups.on(chatId)) return undefined;
      const readers = this.readers(ledger.repository.readNow(groupIdOf(chatId)), state, chatId, agentId, at);
      if (readers && readers.every((r) => this.allowsNow(state, agentId, r))) gathered = { kind: 'group', readers, docs: readers.map((r) => this.ledger!.readNow(r)) };
    }
    const notes = gathered && this.render(agentId, gathered, at);
    return notes && { revision: notes.revision };
  }

  /** Circle-complete for this agent (the S2 audience; hasGuests untouched): the joined readers, sorted. */
  private readers(doc: CircleDocument | null, state: StudioState, chatId: number, agentId: string, at: Date): number[] | undefined {
    const group = state.groups.find((g) => g.chatId === chatId);
    const audience = CircleService.audience(doc, at, { agentIds: group?.agentIds ?? [] });
    if (!doc || !audience.complete || !audience.coveredBy(agentId)) return undefined;
    return joinedOf(doc, at).map((p) => p.telegramId).sort((a, b) => a - b);
  }

  private async gather(agentId: string, chat: ChatContext, at: Date): Promise<Gathered | undefined> {
    if (!this.on()) return undefined;
    // The notes, choice and circle stores sit outside the turn snapshot's probes: a turn that reads them rechecks in full.
    activeReadScope()?.markVolatile();
    const state = await this.studio.deps.store.read();
    if (chat.kind === 'private') {
      const tg = tgOf(chat.personId);
      if (tg === undefined || !await this.allows(state, agentId, tg)) return undefined;
      return { kind: 'dm', readers: [tg], docs: [await this.ledger!.read(tg)] };
    }
    const chatId = chat.group.telegramChatId, ledger = this.studio.deps.circleLedger;
    if (!ledger || !this.studio.circleGroups.on(chatId)) return undefined;
    const readers = this.readers(await ledger.get(chatId), state, chatId, agentId, at);
    if (!readers) return undefined;
    for (const r of readers) if (!await this.allows(state, agentId, r)) return undefined;
    return { kind: 'group', readers, docs: await Promise.all(readers.map((r) => this.ledger!.read(r))) };
  }

  /**
   * DM: the person's copies this agent may use ("Your notes" / "From <group>"). Group: group notes every
   * reader holds an active copy of, for this agent ("From <group>"): one reader's erasure drops it.
   */
  private render(agentId: string, { kind, readers, docs }: Gathered, at: Date): { revision: string; context: string[] } | undefined {
    let copies: NoteCopy[];
    if (kind === 'dm') copies = usableCopies(docs[0], agentId, at);
    else {
      const each = docs.map((d) => usableCopies(d, agentId, at).filter((c) => c.origin === 'group'));
      copies = (each[0] ?? []).filter((c) => each.every((mine) => mine.some((m) => m.noteId === c.noteId)));
    }
    if (!copies.length) return undefined;
    copies.sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.noteId.localeCompare(b.noteId));
    return {
      revision: hash(['circle-notes:v1', kind, agentId, readers, copies.map((c) => kind === 'dm' ? [c.copyId, c.noteId] : c.noteId)]),
      context: copies.map((c) => c.origin === 'group' ? `From ${c.groupTitle}: ${c.text}` : `Your notes: ${c.text}`),
    };
  }

  /* ---------- messages: /notes, /forget <n>, "remember this" ---------- */

  /** The gateway hook, next to its explicit controls; true = handled. Nothing while Circles is not 'circles'. */
  async intercept(agentId: string, chat: ChatContext, message: TelegramMessage, text: string, addressed: boolean): Promise<boolean> {
    if (!this.on() || !message.from || !text.trim()) return false;
    const state = await this.studio.deps.store.read();
    const agent = state.agents.find((a) => a.id === agentId && a.status === 'active');
    if (!agent) return false;
    const trimmed = text.trim(), from = message.from, { command, target, arg } = commandOf(trimmed);
    if (command && forOther(agent, target)) return false;
    // The memory list is shown: a member's /forget <n> means it again (the gateway answers /memories).
    if (command === '/memories') { this.listed.delete(`${agent.id}:${from.id}`); return false; }
    if (chat.kind === 'group') {
      const chatId = message.chat.id, ledger = this.studio.deps.circleLedger;
      if (!ledger || !this.studio.circleGroups.on(chatId)) return false;
      if (command === '/notes') {
        // Answered privately, never in the group; one agent answers (the one named, or the circle's speaker).
        const doc = await ledger.get(chatId).catch(() => null);
        if (target || (doc && this.studio.circleGroups.speaker(doc) === agent.id)) await this.list(agent, from, from.id, undefined, true);
        return true;
      }
      // Only a message aimed at this agent proposes (a mention, a reply to it, its name), however many agents
      // read the chat: people talking among themselves about remembering are not asking it to save anything.
      if (command || !addressed) return false;
      const pick = this.pick(agent, trimmed, 'group', message);
      if (!pick) return false;
      await this.proposeGroup(agent, state, message, pick.text);
      return true;
    }
    if (command === '/notes') {
      await this.list(agent, from, message.chat.id);
      return true;
    }
    if (command === '/forgetnote' || (command === '/forget' && this.forgetsNotes(state, agent, from.id))) {
      await this.forget(agent, from, message.chat.id, arg);
      return true;
    }
    if (command) return false;
    const pick = this.pick(agent, trimmed, 'private', message);
    if (!pick) return false;
    await this.proposeDm(agent, state, message, pick.text);
    return true;
  }

  /** An outsider's /forget is always about notes (they have nothing else); a member's only while /notes is the list last shown. */
  private forgetsNotes(state: StudioState, agent: Agent, telegramId: number): boolean {
    const member = state.members.find((m) => m.telegramId === telegramId);
    return !member || !canUseAgent(member, agent) || this.listed.has(`${agent.id}:${telegramId}`);
  }

  private remember(agentId: string, telegramId: number, copyIds: string[]): void {
    const key = `${agentId}:${telegramId}`;
    this.listed.delete(key);
    this.listed.set(key, copyIds);
    if (this.listed.size > LISTED_MAX) this.listed.delete(this.listed.keys().next().value!);
  }

  /** Recorded before it is shown; a notebook too full for one more proposal says so instead. */
  private async propose(owner: number, input: Parameters<CircleNotes['propose']>[1], at: Date): Promise<NoteProposal | null> {
    try { return await this.ledger!.propose(owner, input, at); }
    catch (error) { if ((error as Error).message === 'notes_capacity_reached') return null; throw error; }
  }

  private proposalKeyboard(proposal: NoteProposal): InlineKeyboard {
    const copy = notesCopy(proposal.locale);
    return { inline_keyboard: [[{ text: copy.save, callback_data: noteCallback('cs', proposal.id) }, { text: copy.no, callback_data: noteCallback('cn', proposal.id) }]] };
  }

  private async proposeDm(agent: Agent, state: StudioState, message: TelegramMessage, text: string): Promise<void> {
    const from = message.from!, copy = notesCopy(localeOf(from.language_code)), bot = this.botOf(agent);
    if (!bot) return;
    if (text.length > NOTE_MAX_CHARS) { await bot.sendMessage(message.chat.id, copy.tooLong); return; }
    if (!await this.allows(state, agent.id, from.id)) { await bot.sendMessage(message.chat.id, copy.notJoined(agent.persona.name)); return; }
    const proposal = await this.propose(from.id, { agentId: agent.id, origin: 'dm', chatId: message.chat.id, text, locale: localeOf(from.language_code) }, this.host.now());
    if (!proposal) { await bot.sendMessage(message.chat.id, copy.full); return; }
    await bot.sendMessage(message.chat.id, copy.propose(text), { keyboard: this.proposalKeyboard(proposal) });
  }

  /** A group proposal only where a save could succeed now: the circle is complete for this agent and the asker is in it. */
  private async proposeGroup(agent: Agent, state: StudioState, message: TelegramMessage, text: string): Promise<void> {
    const from = message.from!, locale = localeOf(from.language_code), copy = notesCopy(locale), bot = this.botOf(agent), chatId = message.chat.id;
    if (!bot) return;
    const say = (said: string) => bot.sendMessage(chatId, said, { replyTo: message.message_id, silent: true });
    if (text.length > NOTE_MAX_CHARS) { await say(copy.tooLong); return; }
    const at = this.host.now(), doc = await this.studio.deps.circleLedger!.get(chatId).catch(() => null);
    const readers = this.readers(doc, state, chatId, agent.id, at);
    if (!readers?.includes(from.id)) { await say(copy.notComplete); return; }
    const title = state.groups.find((g) => g.chatId === chatId)?.title || 'this group';
    const proposal = await this.propose(from.id, { agentId: agent.id, origin: 'group', chatId, groupTitle: title, text, locale }, at);
    if (!proposal) { await say(copy.full); return; }
    await bot.sendMessage(chatId, copy.propose(text), { replyTo: message.message_id, silent: true, keyboard: this.proposalKeyboard(proposal) });
  }

  /** The person's own active copies this agent may use, newest first. */
  private async own(agentId: string, telegramId: number): Promise<NoteCopy[]> {
    const at = this.host.now();
    return usableCopies(await this.ledger!.read(telegramId), agentId, at).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /** Numbered newest first, within LIST_BUDGET: a line that would not fit is left out with its button. */
  private async listView(agent: Agent, owner: number, locale: 'en' | 'fa'): Promise<{ text: string; keyboard?: InlineKeyboard; shown: string[] }> {
    const copy = notesCopy(locale), all = await this.own(agent.id, owner);
    if (!all.length) return { text: copy.none(agent.persona.name), shown: [] };
    const header = copy.header(agent.persona.name), lines: string[] = [], shown: NoteCopy[] = [];
    let used = header.length + copy.hint.length + copy.newest(LIST_MAX).length + 8;
    for (const c of all.slice(0, LIST_MAX)) {
      const line = `${shown.length + 1}. ${clip(c.text!, LINE_MAX)}${c.origin === 'group' ? copy.from(clip(c.groupTitle!, TITLE_MAX)) : ''}`;
      if (used + line.length + 1 > LIST_BUDGET) break;
      used += line.length + 1; lines.push(line); shown.push(c);
    }
    return {
      text: [header, ...lines, ...(all.length > shown.length ? [copy.newest(shown.length)] : []), '', copy.hint].join('\n'),
      keyboard: { inline_keyboard: shown.map((c, i) => [{ text: copy.erase(i + 1), callback_data: noteCallback('ce', c.copyId) }]) },
      shown: shown.map((c) => c.copyId),
    };
  }

  /** /notes: the list, privately (a DM; from a group, a silent one, and a DM that cannot be sent is dropped). What it numbers is what /forget <n> counts. */
  private async list(agent: Agent, from: TelegramUser, chatId: number, messageId?: number, silent = false): Promise<void> {
    const bot = this.botOf(agent);
    if (!bot) return;
    const view = await this.listView(agent, from.id, localeOf(from.language_code));
    this.remember(agent.id, from.id, view.shown);
    // Settings v2: "Open Memory settings" under the list (it is always a private chat), kept when an erase edits it.
    const trailing = await this.studio.settingsBot.trailingKeyboard(agent.id, 'notes', from);
    if (trailing) view.keyboard = { inline_keyboard: [...view.keyboard?.inline_keyboard ?? [], ...trailing.inline_keyboard] };
    if (messageId !== undefined) { await bot.editMessageText(chatId, messageId, view.text, view.keyboard).catch(() => undefined); return; }
    await bot.sendMessage(chatId, view.text, { ...(view.keyboard ? { keyboard: view.keyboard } : {}), ...(silent ? { silent: true } : {}) })
      .catch(() => this.log.warn('[studio] note_dm_failed'));
  }

  /** /forget <n>: the n-th line of the list last shown to this person, never a list recomputed since. */
  private async forget(agent: Agent, from: TelegramUser, chatId: number, arg?: string): Promise<void> {
    const copy = notesCopy(localeOf(from.language_code)), bot = this.botOf(agent);
    if (!bot) return;
    const target = this.listed.get(`${agent.id}:${from.id}`)?.[Number.parseInt(arg ?? '', 10) - 1];
    const keyboard = await this.studio.settingsBot.trailingKeyboard(agent.id, 'forget', from), extra = keyboard ? [{ keyboard }] : [];
    if (!target) { await bot.sendMessage(chatId, copy.pick, ...extra); return; }
    const erased = await this.ledger!.erase(from.id, target, this.host.now());
    if (erased) await dimGrowthForNotes(this.studio, [erased]);
    await bot.sendMessage(chatId, erased ? copy.erased(clip(erased.text!)) : copy.gone, ...extra);
  }

  /**
   * An outsider's relationship or memory control in their DM (circleDirect) while Circles is on: the notes
   * they saved are what this agent keeps of them, so "nothing kept" would be false. /memories lists them,
   * /forgetall or "forget everything" erases their own copies this agent may use, anything else points at
   * /notes. false: they hold none here (the old "nothing kept" stays true).
   */
  async outsiderControl(agent: Agent, message: TelegramMessage, control: 'memories' | 'forget' | 'other'): Promise<boolean> {
    if (!this.on() || !message.from) return false;
    const from = message.from, mine = await this.own(agent.id, from.id), bot = this.botOf(agent);
    if (!mine.length || !bot) return false;
    const copy = notesCopy(localeOf(from.language_code));
    if (control === 'memories') { await this.list(agent, from, message.chat.id); return true; }
    const keyboard = await this.studio.settingsBot.trailingKeyboard(agent.id, control === 'forget' ? 'forgetall' : 'notes', from);
    const extra = keyboard ? [{ keyboard }] : [];
    if (control === 'forget') {
      const erased = await this.ledger!.eraseMany(from.id, mine.map((c) => c.copyId), this.host.now());
      if (erased) await dimGrowthForNotes(this.studio, mine);
      this.listed.delete(`${agent.id}:${from.id}`);
      await bot.sendMessage(message.chat.id, copy.erasedAll(erased, agent.persona.name), ...extra);
      return true;
    }
    await bot.sendMessage(message.chat.id, copy.kept(agent.persona.name), ...extra);
    return true;
  }

  /* ---------- buttons: cs save · cn no · ce erase ---------- */

  /** A notes button. Bound to its owner (the id names them): anyone else, a forwarded button included, is refused. */
  async onCallback(agent: Agent, query: TelegramCallbackQuery, bot: TelegramBotClient): Promise<void> {
    const parsed = parseNoteCallback(query.data)!, from = query.from, copy = notesCopy(localeOf(from.language_code));
    const alert = (text: string) => bot.answerCallbackQuery(query.id, text, true);
    if ((agent.blocked ?? []).includes(from.id)) { await bot.answerCallbackQuery(query.id); return; }
    if (receiptOwner(parsed.id) !== from.id) { await alert(parsed.action === 'ce' ? copy.notYourNotes : copy.notYours); return; }
    if (!this.on()) { await alert(copy.unavailable); return; }
    const message = query.message, at = this.host.now();
    if (parsed.action === 'ce') {
      const erased = await this.ledger!.erase(from.id, parsed.id, at);
      if (erased) await dimGrowthForNotes(this.studio, [erased]);
      await bot.answerCallbackQuery(query.id, erased ? copy.erased(clip(erased.text!, 150)) : copy.gone).catch(() => undefined);
      if (message?.chat.type === 'private') await this.list(agent, from, message.chat.id, message.message_id);
      return;
    }
    const state = await this.ledger!.proposal(from.id, parsed.id, at);
    if (state.kind === 'saved') { await bot.answerCallbackQuery(query.id, copy.saved); return; }
    if (state.kind === 'expired' || !message || state.proposal.chatId !== message.chat.id || state.proposal.agentId !== agent.id) {
      await alert(copy.expired);
      if (state.kind === 'expired' && message) await bot.editMessageText(message.chat.id, message.message_id, copy.expired).catch(() => undefined);
      return;
    }
    const proposal = state.proposal, said = notesCopy(proposal.locale);
    // A save holds it right now (the other tap of a double tap): it answers for both.
    if (claimed(proposal, at)) { await bot.answerCallbackQuery(query.id, said.saving); return; }
    if (parsed.action === 'cn') {
      await this.ledger!.dismiss(from.id, proposal.id, at);
      await bot.answerCallbackQuery(query.id, said.dismissed);
      await bot.editMessageText(message.chat.id, message.message_id, said.dismissed).catch(() => undefined);
      return;
    }
    if (proposal.origin === 'dm') await this.saveDm(agent, query, bot, proposal, message.message_id, at);
    else await this.saveGroup(agent, query, bot, proposal, message.message_id, at);
  }

  private async saveDm(agent: Agent, query: TelegramCallbackQuery, bot: TelegramBotClient, proposal: NoteProposal, messageId: number, at: Date): Promise<void> {
    const owner = query.from.id, copy = notesCopy(proposal.locale);
    if (!await this.allows(await this.studio.deps.store.read(), agent.id, owner)) { await bot.answerCallbackQuery(query.id, copy.notJoined(agent.persona.name), true); return; }
    const saved = await this.ledger!.save(owner, { eventId: proposal.id, noteId: proposal.noteId, text: proposal.text, origin: 'dm', savedByAgentId: agent.id, agentIds: [agent.id],
      authorTelegramId: owner, at, consume: true });
    if (!saved.ok) { await bot.answerCallbackQuery(query.id, saved.reason === 'full' ? copy.full : copy.expired, true); return; }
    // Committed: only now the tapper is told (a toast that fails changes nothing), and the proposal turns into a silent (edited) "📌 Saved".
    await bot.answerCallbackQuery(query.id, copy.saved).catch(() => undefined);
    await bot.editMessageText(proposal.chatId, messageId, copy.saved).catch(() => undefined);
  }

  /**
   * Who a group save reaches now: the circle must be complete for this agent with the asker in it.
   * Recipients: joined participants with an open membership window covering this agent. agentIds: the
   * circle agents every recipient covered, so an agent one recipient never covered sees the note nowhere.
   */
  private async reach(agentId: string, chatId: number, owner: number, at: Date): Promise<{ recipients: CircleParticipant[]; agentIds: string[] } | undefined> {
    const state = await this.studio.deps.store.read(), doc = await this.studio.deps.circleLedger!.get(chatId).catch(() => null);
    const readers = this.readers(doc, state, chatId, agentId, at);
    const inChat = new Set(doc ? activeAgents(doc).filter((a) => state.groups.find((g) => g.chatId === chatId)?.agentIds.includes(a)) : []);
    const recipients = (doc?.participants ?? []).filter((p) => activeJoin(p, at) && p.windows.at(-1)?.leftAt === undefined && p.coveredAgentIds.includes(agentId));
    if (!doc || !readers?.includes(owner) || !recipients.some((p) => p.telegramId === owner)) return undefined;
    return { recipients, agentIds: [...inChat].filter((a) => recipients.every((p) => p.coveredAgentIds.includes(a))) };
  }

  /**
   * A group save, re-checked at the tap: one tap claims the proposal (a double tap writes and posts once),
   * a fresh verify, then reach(). One copy per recipient (shared noteId), all or none: any copy that fails
   * (the failed one too: it may have committed before the error) and every copy already written go again.
   * Once all committed the circle is read again: anyone who withdrew, left, or used forget me meanwhile
   * (their save is refused too), or any change in who it reaches, undoes it all. Only then the tapper,
   * the group (counts only, silent) and each recipient's quiet DM.
   */
  private async saveGroup(agent: Agent, query: TelegramCallbackQuery, bot: TelegramBotClient, proposal: NoteProposal, messageId: number, at: Date): Promise<void> {
    const owner = query.from.id, chatId = proposal.chatId, copy = notesCopy(proposal.locale), notes = this.ledger!;
    const alert = (text: string) => bot.answerCallbackQuery(query.id, text, true).catch(() => undefined);
    if (!this.studio.deps.circleLedger || !this.studio.circleGroups.on(chatId)) { await alert(copy.unavailable); return; }
    const claim = await notes.claim(owner, proposal.id, at);
    if (claim.kind !== 'won') {
      await bot.answerCallbackQuery(query.id, claim.kind === 'busy' ? copy.saving : claim.kind === 'saved' ? copy.saved : copy.expired, claim.kind === 'expired').catch(() => undefined);
      return;
    }
    const attempted: number[] = [];
    const undo = async () => {
      for (const who of attempted) {
        await notes.remove(who, proposal.noteId, proposal.id)
          .catch(() => notes.remove(who, proposal.noteId, proposal.id)).catch(() => this.log.warn('[studio] note_rollback_failed'));
      }
      await notes.release(owner, proposal.id).catch(() => this.log.warn('[studio] note_release_failed'));
    };
    let recipients: CircleParticipant[];
    try {
      await this.studio.verifyGroupAudience(agent.id, chatId).catch(() => this.log.warn('[studio] note_verify_failed'));
      const plan = await this.reach(agent.id, chatId, owner, at);
      if (!plan) { await undo(); await alert(copy.notComplete); return; }
      recipients = plan.recipients;
      let ownCopy: string | undefined;
      for (const p of recipients) {
        attempted.push(p.telegramId);
        const saved = await notes.save(p.telegramId, { eventId: proposal.id, noteId: proposal.noteId, text: proposal.text, origin: 'group', savedByAgentId: agent.id,
          agentIds: plan.agentIds, fromGroupId: groupIdOf(chatId), groupTitle: proposal.groupTitle, authorTelegramId: owner, at })
          .catch((): { ok: false } => ({ ok: false }));
        // Not everyone: nobody. A later tap can try again.
        if (!saved.ok) { await undo(); await alert(copy.notSaved); return; }
        if (p.telegramId === owner) ownCopy = saved.copyId;
      }
      const now = await this.reach(agent.id, chatId, owner, this.host.now());
      const same = !!now && now.recipients.length === recipients.length && recipients.every((p) => now.recipients.some((q) => q.telegramId === p.telegramId))
        && now.agentIds.length === plan.agentIds.length && plan.agentIds.every((a) => now.agentIds.includes(a));
      if (!same) { await undo(); await alert(now ? copy.notSaved : copy.notComplete); return; }
      await notes.consume(owner, proposal.id, ownCopy!, at).catch(() => this.log.warn('[studio] note_consume_failed'));
    } catch (error) { await undo(); throw error; }
    // Every copy committed: the tapper (a toast that fails changes nothing), the group (counts only, silent), then each recipient's quiet DM.
    await bot.answerCallbackQuery(query.id, copy.saved).catch(() => undefined);
    await bot.editMessageText(chatId, messageId, copy.pinned(proposal.text)).catch(() => undefined);
    await bot.sendMessage(chatId, copy.savedFor(recipients.length), { replyTo: messageId, silent: true }).catch(() => this.log.warn('[studio] note_confirm_failed'));
    for (const p of recipients) {
      // 403 / "can't initiate conversation": they never started this bot. Their copy is stored all the same.
      await bot.sendMessage(p.telegramId, copy.delivered(proposal.groupTitle!, proposal.text), { silent: true }).catch(() => this.log.warn('[studio] note_dm_failed'));
    }
  }

  /* ---------- the pet (S4) ---------- */

  /**
   * The person's own active copies this agent may use, newest first, split into "From this group" (copies of a
   * save in `groupId`) and the rest ("My notes": DM saves and other groups'). Only their own document is read;
   * nothing while Circles is not 'circles'. Authors are "you" or nobody: no other person's name or id leaves here.
   */
  async petNotes(agentId: string, telegramId: number, groupId?: string): Promise<{ mine: PetNote[]; group: PetNote[] } | undefined> {
    if (!this.on()) return undefined;
    const view = (c: NoteCopy): PetNote => ({ copyId: c.copyId, text: c.text!, savedAt: c.savedAt, ...(c.groupTitle ? { groupTitle: c.groupTitle } : {}), ...(c.authorTelegramId === telegramId ? { byMe: true as const } : {}) });
    const copies = (await this.own(agentId, telegramId)).slice(0, PET_NOTES_MAX);
    return { mine: copies.filter((c) => !groupId || c.fromGroupId !== groupId).map(view), group: groupId ? copies.filter((c) => c.fromGroupId === groupId).map(view) : [] };
  }

  /** Erase from the pet: only the requester's own copy (the id names its owner; anyone else's is never looked up), whatever the flag. */
  async eraseOwn(telegramId: number, copyId: string): Promise<boolean> {
    if (!this.ledger || receiptOwner(copyId) !== telegramId) return false;
    for (const key of [...this.listed.keys()]) if (key.endsWith(`:${telegramId}`)) this.listed.delete(key);
    const erased = await this.ledger.erase(telegramId, copyId, this.host.now());
    if (erased) await dimGrowthForNotes(this.studio, [erased]);
    return !!erased;
  }

  /* ---------- rights ---------- */

  /** Export: the requester's own active copies, whatever the flag. */
  async exportFor(telegramId: number): Promise<NoteExport[]> {
    return this.ledger ? this.ledger.exportFor(telegramId, this.host.now()) : [];
  }

  /**
   * Forget me: every copy of the requester's, whatever the flag; nobody else's copy changes. While Circles
   * is on a group save may be writing their copy right now: the erasure is marked, and that save is refused.
   */
  async eraseFor(telegramId: number): Promise<number> {
    for (const key of [...this.listed.keys()]) if (key.endsWith(`:${telegramId}`)) this.listed.delete(key);
    if (!this.ledger) return 0;
    // Read before erasing: the taught growth moments these copies lit dim with them (design §4.11, PRIV-033).
    const before = (await this.ledger.read(telegramId).catch(() => null))?.copies.filter((c) => c.status === 'active') ?? [];
    const erased = await this.ledger.eraseAll(telegramId, this.on() ? this.host.now() : undefined);
    await dimGrowthForNotes(this.studio, before);
    return erased;
  }
}
