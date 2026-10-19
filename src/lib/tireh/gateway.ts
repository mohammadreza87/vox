/**
 * PersonaGateway — handles Telegram updates for every persona bot.
 *
 *   update → who is speaking? (Telegram id → TIREH person; strangers refused)
 *          → where? (private chat, or a registered group; others refused)
 *          → should the persona answer? (groups: only when addressed)
 *          → voice note? transcribe
 *          → load memories this audience may see → reply → speak if needed
 *          → extract new memories → scope them → offer to share private work facts
 */

import { streamText, type LLM, type WebSource } from './llm';
import { readTriage, TRIAGE_TIMEOUT_MS, triageInput, triageQuestions, VOICE_REQUEST, type Decider, type Triage } from './triage';
import type { OrgDirectory } from './org/directory';
import type { ChatContext, ChatMessage, MemoryRecord, MemoryScope, Persona } from './types';
import type { ChatHistoryStore, MemoryStore, ShareOfferStore, UpdateDeduper } from './memory/store';
import type { VoiceService } from './voice';
import type { TelegramBotClient, TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from './telegram/client';
import { buildSystemPrompt } from './conversation/prompt';
import { selectMemories } from './memory/retrieval';
import { decideScope, extractCandidates, firstNewIndex } from './memory/extraction';
import { canPersonSee, describeScope, isVisibleToAudience } from './memory/visibility';
import { groupAddressing } from './group-addressing';

export type GroupAction = 'observe' | 'reply' | 'proactive' | 'remember';

export interface GatewayDeps {
  org: OrgDirectory;
  llm: LLM;
  /** Fast model for live voice calls and quick replies (default: llm) */
  fastLlm?: LLM;
  /** Fast pre-reply triage (see triage.ts); without it every reply takes the full path */
  decider?: Decider;
  memories: MemoryStore;
  offers: ShareOfferStore;
  history: ChatHistoryStore;
  deduper: UpdateDeduper;
  voice: VoiceService | null;
  /** Telegram client for a persona's bot */
  botFor(personaId: string): TelegramBotClient;
  /** Recheck live membership/settings before provider calls and side effects. */
  groupAllowed?(personaId: string, chatId: number, telegramId: number, action: GroupAction): Promise<boolean>;
  claimGroupReply?(personaId: string, chatId: number, messageId: number): Promise<boolean>;
  claimGroupMemory?(personaId: string, chatId: number, messageId: number): Promise<boolean>;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export type HandleResult =
  | 'replied'
  | 'ignored'
  | 'duplicate'
  | 'unknown-persona'
  | 'stranger'
  | 'unregistered-group'
  | 'command'
  | 'callback';

const HISTORY_LIMIT = 20;
const EXTRACTION_WINDOW = 6;
const NO_MEMORY = /(?:do not|don't|don’t)\s+(?:remember|save|store)|forget (?:this|that)|ذخیره نکن|به خاطر نسپار|یادت نماند|فراموش کن/iu;

export class PersonaGateway {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: GatewayDeps) {
    this.log = deps.logger ?? console;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async handleUpdate(personaId: string, update: TelegramUpdate): Promise<HandleResult> {
    const persona = this.deps.org.getPersona(personaId);
    if (!persona) return 'unknown-persona';

    if (!(await this.deps.deduper.firstSeen(`${personaId}__${update.update_id}`))) return 'duplicate';

    if (update.callback_query) return this.handleCallback(persona, update.callback_query);
    if (update.message) return this.handleMessage(persona, update.message);
    return 'ignored';
  }

  // ============================================
  // MESSAGES
  // ============================================

  private async handleMessage(persona: Persona, message: TelegramMessage): Promise<HandleResult> {
    const { org } = this.deps;
    const bot = this.deps.botFor(persona.id);
    if (!message.from || message.from.is_bot) return 'ignored';

    const speaker = org.getPersonByTelegramId(message.from.id);
    if (!speaker) {
      if (message.chat.type === 'private') {
        await bot.sendMessage(
          message.chat.id,
          `Hi, I'm ${persona.name}. I only work with members of ${org.organizationName}, so I can't chat here.\n\nIf you're on the team, ask an admin to add your Telegram ID: ${message.from.id}`
        );
      }
      this.log.warn(`[tireh] ${persona.id}: message from unregistered Telegram user ${message.from.id}`);
      return 'stranger';
    }

    const chat = this.resolveChat(message, speaker.id);
    if (chat === 'unregistered') {
      if (this.isAddressed(persona, message)) {
        await bot.sendMessage(
          message.chat.id,
          `This group isn't registered with ${org.organizationName}, so I can't take part here.\n\nTo register it, an admin adds this chat ID to the config: ${message.chat.id}`
        );
      }
      this.log.warn(`[tireh] ${persona.id}: unregistered group ${message.chat.id}`);
      return 'unregistered-group';
    }
    if (chat === 'not-member') {
      // The group's member list in config is the audience used for memory
      // visibility. Someone outside it means the config is out of date, so
      // the persona stays out of the conversation until it is fixed.
      this.log.warn(`[tireh] ${persona.id}: ${speaker.id} is not a registered member of group ${message.chat.id}`);
      return 'ignored';
    }
    if (!chat) return 'ignored';
    if (chat.kind === 'group' && chat.group.agentIds && !chat.group.agentIds.includes(persona.id)) return 'ignored';
    if (!(await this.groupAllowed(persona, chat, speaker.id, 'reply'))) return 'ignored';

    const rawText = message.text ?? message.caption ?? '';
    if (rawText.startsWith('/')) {
      const handled = await this.handleCommand(persona, chat, speaker.id, message, rawText);
      if (handled) return 'command';
    }

    const targeting = groupAddressing(persona, message);
    const addressed = chat.kind === 'private' || targeting.direct;
    if (!addressed && (persona.groupObservation === false || !(await this.groupAllowed(persona, chat, speaker.id, 'observe')))) return 'ignored';

    // Group voice notes are transcribed only when the persona is addressed,
    // to avoid paying for every voice message in the group.
    let text = rawText;
    const isVoice = Boolean(message.voice);
    if (isVoice && addressed) {
      text = await this.transcribe(bot, message, persona, chat, speaker.id);
      if (!text) {
        if (!(await this.groupAllowed(persona, chat, speaker.id, 'reply'))) return 'ignored';
        const sorry = this.deps.voice
          ? "Sorry, I couldn't make out that voice message."
          : "I can't listen to voice messages yet. Could you type it?";
        await bot.sendMessage(message.chat.id, sorry, { replyTo: message.message_id });
        return 'replied';
      }
    }
    if (!text.trim()) return 'ignored';

    const userMessage: ChatMessage = {
      role: 'user', personId: speaker.id, text, at: this.now(), telegramMessageId: message.message_id,
      ...(chat.kind === 'group' ? { groupPolicyVersion: 1 as const } : {}),
    };
    if (!(await this.groupAllowed(persona, chat, speaker.id, addressed ? 'reply' : 'observe'))) return 'ignored';
    await this.deps.history.append(persona.id, chat.chatKey, userMessage);

    const askAddressed = !addressed && chat.kind === 'group' && !isVoice && !targeting.otherTarget
      && persona.groupParticipation !== 'mentions';
    const triage = this.triage(persona, chat, askAddressed, userMessage, addressed ? 'reply' : 'observe');
    const settled = await triage;
    let shouldReply = addressed;
    if (askAddressed && (settled?.addressed || settled?.proactive)
      && await this.groupAllowed(persona, chat, speaker.id, 'proactive')) {
      // Unsolicited replies require a shared throttle; standalone runtimes without
      // one can still answer direct messages but cannot interrupt the group.
      shouldReply = await this.deps.claimGroupReply?.(persona.id, message.chat.id, message.message_id) ?? false;
    }
    if (shouldReply && await this.groupAllowed(persona, chat, speaker.id, addressed ? 'reply' : 'proactive')) {
      await bot.sendChatAction(message.chat.id, isVoice ? 'record_voice' : 'typing').catch(() => undefined);
      let generated: { text: string; sources: WebSource[] };
      try {
        generated = await this.composeReply(persona, chat, speaker.id, text, triage, message.message_id, addressed ? 'reply' : 'proactive');
      } catch {
        this.log.error(`[tireh] ${persona.id}: reply generation failed`);
        return 'ignored';
      }
      const { text: reply, sources } = generated;
      if (!reply) return 'ignored';
      if (!(await this.groupAllowed(persona, chat, speaker.id, addressed ? 'reply' : 'proactive'))) return 'ignored';
      const voiceWanted = isVoice || (settled ? settled.wantsVoice : VOICE_REQUEST.test(text));
      if (!(await this.sendReply(persona, chat, message, reply, voiceWanted, sources, addressed ? 'reply' : 'proactive'))) return 'ignored';
      await this.deps.history.append(persona.id, chat.chatKey, {
        role: 'assistant', text: reply, at: this.now(), telegramMessageId: message.message_id,
        ...(chat.kind === 'group' ? { groupPolicyVersion: 1 as const } : {}),
      });
    } else {
      shouldReply = false;
    }

    // A useful group fact can be remembered without interrupting. A failed
    // classifier never causes passive extraction, and opt-outs are not saved.
    const remember = chat.kind === 'group'
      ? persona.groupRemember !== false && !NO_MEMORY.test(text) && (settled?.memorable === true || (addressed && settled === null))
      : settled?.memorable !== false;
    if (remember) {
      try {
        if (chat.kind !== 'group' || (await this.groupAllowed(persona, chat, speaker.id, 'remember')
          && (addressed || await this.groupAllowed(persona, chat, speaker.id, 'observe'))
          && (this.deps.claimGroupMemory ? await this.deps.claimGroupMemory(persona.id, message.chat.id, message.message_id) : addressed))) {
          await this.formMemories(persona, chat, speaker.id, message.message_id, chat.kind === 'group' ? userMessage : undefined, !addressed);
        }
      } catch {
        this.log.error(`[tireh] ${persona.id}: memory extraction failed`);
      }
    }
    return shouldReply ? 'replied' : 'ignored';
  }

  private async groupAllowed(persona: Persona, chat: ChatContext, speakerId: string, action: GroupAction): Promise<boolean> {
    if (chat.kind !== 'group') return true;
    if (chat.group.agentIds && !chat.group.agentIds.includes(persona.id)) return false;
    const telegramId = this.deps.org.getPerson(speakerId)?.telegramUserId;
    return this.deps.groupAllowed ? !!telegramId && this.deps.groupAllowed(persona.id, chat.group.telegramChatId, telegramId, action) : true;
  }

  private async recentHistory(persona: Persona, chat: ChatContext, limit: number, messageId?: number): Promise<ChatMessage[]> {
    const recent = await this.deps.history.recent(persona.id, chat.chatKey, limit);
    return chat.kind === 'private' ? recent : recent.filter((m) => m.groupPolicyVersion === 1
      && (messageId === undefined || (m.telegramMessageId !== undefined && m.telegramMessageId <= messageId)));
  }

  /**
   * One private exchange outside Telegram (e.g. a voice call in the Mini App):
   * same memory, same privacy rules, same persona.
   */
  async converse(personaId: string, speakerId: string, text: string): Promise<string> {
    const persona = this.deps.org.getPersona(personaId);
    if (!persona) throw new Error(`Unknown persona ${personaId}`);
    if (!this.deps.org.getPerson(speakerId)) throw new Error('Unknown speaker');
    const chat: ChatContext = { kind: 'private', chatKey: `private-${speakerId}`, personId: speakerId };
    await this.deps.history.append(persona.id, chat.chatKey, { role: 'user', personId: speakerId, text, at: this.now() });
    const reply = await this.generateReply(persona, chat, speakerId, text);
    await this.deps.history.append(persona.id, chat.chatKey, { role: 'assistant', text: reply, at: this.now() });
    try {
      await this.formMemories(persona, chat, speakerId);
    } catch {
      this.log.error(`[tireh] ${persona.id}: memory extraction failed`);
    }
    return reply;
  }

  /**
   * One turn of a live voice call, streamed as it is generated. `turns` is the
   * call so far as the voice platform heard it (interrupted replies are cut
   * short there); memories and the persona come from here, so the same
   * privacy rules apply as in Telegram. The turn is kept in the person's
   * private history; memories form when the call ends (see `reflect`).
   */
  async *liveTurn(personaId: string, speakerId: string, turns: Array<{ role: 'user' | 'assistant'; content: string }>): AsyncIterable<string> {
    const { org } = this.deps;
    const persona = org.getPersona(personaId);
    if (!persona) throw new Error(`Unknown persona ${personaId}`);
    if (!org.getPerson(speakerId)) throw new Error('Unknown speaker');
    const chat: ChatContext = { kind: 'private', chatKey: `private-${speakerId}`, personId: speakerId };
    const said = [...turns].reverse().find((t) => t.role === 'user')?.content.trim() ?? '';
    const recent = await this.deps.history.recent(persona.id, chat.chatKey, 1);
    // The platform can ask twice for the same turn (e.g. after a barge-in).
    if (said && !(recent[0]?.role === 'user' && recent[0].text === said)) {
      await this.deps.history.append(persona.id, chat.chatKey, { role: 'user', personId: speakerId, text: said, at: this.now() });
    }
    const all = await this.deps.memories.listActive(persona.id);
    const memories = selectMemories(org, all, chat, { query: said, now: this.now() });
    const system = `${buildSystemPrompt({ org, persona: { ...persona, webSearch: false }, chat, speakerId, memories, now: this.now() })}

## Live voice call
You are on a live voice call. Answer in one to three short spoken sentences, like a phone conversation. No lists, links, emoji or stage directions. If you were cut off, don't repeat yourself; follow what the person says next.`;
    let reply = '';
    for await (const part of streamText(this.deps.fastLlm ?? this.deps.llm, { system, messages: turns.slice(-20), maxTokens: 300 })) {
      reply += part;
      yield part;
    }
    if (reply.trim()) await this.deps.history.append(persona.id, chat.chatKey, { role: 'assistant', text: reply.trim(), at: this.now() });
  }

  /** Forms memories from a finished private conversation (e.g. a voice call). */
  async reflect(personaId: string, speakerId: string): Promise<void> {
    const persona = this.deps.org.getPersona(personaId);
    if (!persona || !this.deps.org.getPerson(speakerId)) return;
    try {
      await this.formMemories(persona, { kind: 'private', chatKey: `private-${speakerId}`, personId: speakerId }, speakerId);
    } catch {
      this.log.error(`[tireh] ${persona.id}: memory extraction failed`);
    }
  }

  private resolveChat(
    message: TelegramMessage,
    speakerId: string
  ): ChatContext | 'unregistered' | 'not-member' | null {
    if (message.chat.type === 'private') {
      return { kind: 'private', chatKey: `private-${speakerId}`, personId: speakerId };
    }
    if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
      const group = this.deps.org.getGroupByChatId(message.chat.id);
      if (!group) return 'unregistered';
      if (!group.memberIds.includes(speakerId)) return 'not-member';
      return { kind: 'group', chatKey: `group-${group.id}`, group };
    }
    return null;
  }

  private isAddressed(persona: Persona, message: TelegramMessage): boolean {
    return groupAddressing(persona, message).direct;
  }

  private async transcribe(bot: TelegramBotClient, message: TelegramMessage, persona: Persona, chat: ChatContext, speakerId: string): Promise<string> {
    if (!this.deps.voice || !message.voice) return '';
    try {
      const audio = await bot.downloadFile(message.voice.file_id);
      if (!(await this.groupAllowed(persona, chat, speakerId, 'reply'))) return '';
      return await this.deps.voice.transcribe(audio, message.voice.mime_type ?? 'audio/ogg');
    } catch {
      this.log.error('[tireh] transcription failed');
      return '';
    }
  }

  async generateReply(persona: Persona, chat: ChatContext, speakerId: string, text: string): Promise<string> {
    return (await this.composeReply(persona, chat, speakerId, text)).text;
  }

  /**
   * Triage of the latest message (already in history); null when there is no
   * decider, or it fails or is slow. Never throws.
   */
  private async triage(persona: Persona, chat: ChatContext, askAddressed: boolean, source: ChatMessage, action: GroupAction): Promise<Triage | null> {
    const { decider, org } = this.deps;
    if (!decider) return null;
    try {
      const prior = await this.recentHistory(persona, chat, 6, source.telegramMessageId);
      const recent = chat.kind === 'group' ? [...prior.filter((m) => m.telegramMessageId! < source.telegramMessageId!), source].slice(-6) : prior;
      const lines = recent.map((m) => ({ who: m.role === 'assistant' ? persona.name : org.getPerson(m.personId ?? '')?.name ?? 'Someone', text: m.text }));
      if (!(await this.groupAllowed(persona, chat, source.personId!, action))) return null;
      const answers = await decider.decide(triageInput(persona, lines), triageQuestions(persona, askAddressed), TRIAGE_TIMEOUT_MS);
      return readTriage(answers, askAddressed, persona.groupParticipation ?? 'mentions');
    } catch {
      this.log.warn(`[tireh] ${persona.id}: triage unavailable`);
      return null;
    }
  }

  /** The reply plus the web pages it cites, when the persona searched. */
  private async composeReply(persona: Persona, chat: ChatContext, speakerId: string, text: string, triaged?: Promise<Triage | null>, messageId?: number, action: GroupAction = 'reply'): Promise<{ text: string; sources: WebSource[] }> {
    const { org } = this.deps;
    const [all, triage] = await Promise.all([this.deps.memories.listActive(persona.id), triaged ?? null]);
    // Search only when triage says the answer needs live facts (or there is no triage).
    const search = !!persona.webSearch && (triage ? triage.needsWeb : true);
    // Small talk goes to the fast model; anything needing care, or a search, to the main one.
    const quick = triage?.effort === 'quick' && !search && !!this.deps.fastLlm;
    const memories = selectMemories(org, all, chat, { query: text, now: this.now() });
    const system = buildSystemPrompt({ org, persona: { ...persona, webSearch: search }, chat, speakerId, memories, now: this.now(), canSpeak: !!this.deps.voice && persona.replyWithVoice !== 'never' })
      + (action === 'proactive' ? '\n\nYou are joining a group conversation selectively. Make one brief, natural contribution in character. Do not repeat recent replies or demand attention; one to three sentences is enough.' : '');

    const prior = await this.recentHistory(persona, chat, HISTORY_LIMIT, messageId);
    // Later concurrent updates may occupy the bounded history window. Always
    // anchor generation to the event being handled, never another user's turn.
    const recent = chat.kind === 'group' && messageId !== undefined
      ? [...prior.filter((m) => m.telegramMessageId! < messageId), { role: 'user' as const, personId: speakerId, text, at: this.now() }].slice(-HISTORY_LIMIT)
      : prior;
    const messages = recent.map((m) => ({
      role: m.role,
      content:
        m.role === 'user' && chat.kind === 'group'
          ? `${org.getPerson(m.personId ?? '')?.name ?? 'Someone'}: ${m.text}`
          : m.text,
    }));

    const request = { system, messages, maxTokens: quick ? 400 : 700 };
    const llm = quick ? this.deps.fastLlm! : this.deps.llm;
    // Strangers get fewer searches: each one costs money.
    const maxSearches = org.getPerson(speakerId)?.guest ? 1 : 3;
    if (!(await this.groupAllowed(persona, chat, speakerId, action))) return { text: '', sources: [] };
    const { text: reply, sources } = search && llm.completeWithWeb
      ? await llm.completeWithWeb({ ...request, maxSearches })
      : { text: await llm.complete(request), sources: [] };
    return { text: reply || "Sorry, I lost my train of thought. Could you say that again?", sources: reply ? sources : [] };
  }

  private async sendReply(
    persona: Persona,
    chat: ChatContext,
    message: TelegramMessage,
    reply: string,
    voiceWanted: boolean,
    sources: WebSource[] = [],
    action: GroupAction = 'reply'
  ): Promise<boolean> {
    const bot = this.deps.botFor(persona.id);
    const replyTo = chat.kind === 'group' ? message.message_id : undefined;
    const speak =
      this.deps.voice &&
      (persona.replyWithVoice === 'always' || (persona.replyWithVoice === 'mirror' && voiceWanted));

    if (!(await this.groupAllowed(persona, chat, this.deps.org.getPersonByTelegramId(message.from!.id)!.id, action))) return false;
    if (speak) {
      try {
        const { audio, mimeType, filename } = await this.deps.voice!.synthesize(reply, persona.voice.elevenLabsVoiceId);
        if (!(await this.groupAllowed(persona, chat, this.deps.org.getPersonByTelegramId(message.from!.id)!.id, action))) return false;
        await bot.sendVoice(message.chat.id, audio, { mimeType, filename, replyTo });
        // The transcript goes as its own message: captions are capped at 1024 chars.
        if (!(await this.groupAllowed(persona, chat, this.deps.org.getPersonByTelegramId(message.from!.id)!.id, action))) return false;
        await bot.sendMessage(message.chat.id, withSources(reply, sources), { replyTo });
        return true;
      } catch {
        this.log.error(`[tireh] ${persona.id}: voice reply failed, sending text`);
      }
    }
    if (!(await this.groupAllowed(persona, chat, this.deps.org.getPersonByTelegramId(message.from!.id)!.id, action))) return false;
    await bot.sendMessage(message.chat.id, withSources(reply, sources), { replyTo });
    return true;
  }

  // ============================================
  // MEMORY FORMATION
  // ============================================

  private async formMemories(persona: Persona, chat: ChatContext, speakerId: string, messageId?: number, sourceMessage?: ChatMessage, passive = false) {
    const { org, llm, memories } = this.deps;
    if (chat.kind === 'group' && !sourceMessage) return;
    const transcript = sourceMessage ? [sourceMessage] : await this.deps.history.recent(persona.id, chat.chatKey, EXTRACTION_WINDOW);
    let existing = await memories.listActive(persona.id);
    // Only memories this audience may see are shown to the extractor.
    const known = selectMemories(org, existing, chat, {
      query: transcript.map((m) => m.text).join(' '),
      limit: 30,
      now: this.now(),
    });
    if (!(await this.groupAllowed(persona, chat, speakerId, 'remember')) || (passive && !(await this.groupAllowed(persona, chat, speakerId, 'observe')))) return;
    const candidates = await extractCandidates(llm, org, persona, chat, speakerId, transcript, known);
    if (candidates.length === 0) return;

    const at = sourceMessage?.at ?? this.now();
    const newStart = firstNewIndex(transcript);
    const newSpeakers = new Set(
      transcript.slice(newStart).flatMap((m) => (m.role === 'user' && m.personId ? [m.personId] : []))
    );

    for (const candidate of candidates) {
      if (chat.kind === 'group') existing = await memories.listActive(persona.id);
      if (chat.kind === 'group' && (candidate.kind === 'personal' || candidate.confidential
        || candidate.about.some((id) => !chat.group.memberIds.includes(id))
        || (candidate.saidBy && candidate.saidBy !== speakerId))) continue;
      if (!(await this.groupAllowed(persona, chat, speakerId, 'remember')) || (passive && !(await this.groupAllowed(persona, chat, speakerId, 'observe')))) return;
      // Credit whoever actually said it, if they spoke in the new messages.
      const sourceId = candidate.saidBy && newSpeakers.has(candidate.saidBy) ? candidate.saidBy : speakerId;
      const decision = decideScope(org, chat, sourceId, candidate);
      const topic = candidate.topic?.toLowerCase().trim() || undefined;

      // The same person updating the same topic in the same scope replaces
      // their older memory. Different people disagreeing are kept side by
      // side so the persona can surface the conflict.
      const replaced = topic
        ? existing.find(
            (m) =>
              m.topic === topic &&
              m.source.personId === sourceId &&
              JSON.stringify(m.scope) === JSON.stringify(decision.scope)
          )
        : undefined;
      if (chat.kind === 'group' && messageId !== undefined && (replaced?.source.telegramMessageId ?? 0) > messageId) continue;
      if (replaced && replaced.content.trim().toLowerCase() === candidate.content.trim().toLowerCase()) continue;
      const duplicate = existing.some(
        (m) =>
          m.content.trim().toLowerCase() === candidate.content.trim().toLowerCase() &&
          JSON.stringify(m.scope) === JSON.stringify(decision.scope)
      );
      if (duplicate) continue;

      const record = await memories.add({
        personaId: persona.id,
        content: candidate.content,
        type: decision.type,
        scope: decision.scope,
        sensitivity: decision.sensitivity,
        source: {
          personId: sourceId,
          chatKind: chat.kind,
          groupId: chat.kind === 'group' ? chat.group.id : undefined,
          telegramMessageId: messageId,
          at,
        },
        aboutPersonIds: candidate.about,
        topic,
        supersedes: replaced?.id,
        confidence: candidate.confidence,
      });
      if (replaced) await memories.update(replaced.id, { supersededBy: record.id });

      if (decision.offerScope) await this.offerShare(persona, chat, sourceId, record, decision.offerScope);
      existing.push(record);
    }
  }

  private async offerShare(
    persona: Persona,
    chat: ChatContext,
    ownerId: string,
    memory: MemoryRecord,
    proposedScope: MemoryScope
  ) {
    if (chat.kind !== 'private') return;
    const offer = await this.deps.offers.create({
      personaId: persona.id,
      memoryId: memory.id,
      ownerPersonId: ownerId,
      proposedScope,
    });
    const owner = this.deps.org.getPerson(ownerId);
    if (!owner?.telegramUserId) return;
    await this.deps.botFor(persona.id).sendMessage(
      owner.telegramUserId,
      `I noted: "${memory.content}"\nShould I share this with the ${describeScope(this.deps.org, proposedScope)}? Until you say yes, it stays between us.`,
      {
        keyboard: {
          inline_keyboard: [
            [
              { text: `Share with ${describeScope(this.deps.org, proposedScope)}`, callback_data: `share:${offer.id}` },
              { text: 'Keep private', callback_data: `keep:${offer.id}` },
            ],
          ],
        },
      }
    );
  }

  // ============================================
  // CALLBACKS (share approvals)
  // ============================================

  private async handleCallback(persona: Persona, query: TelegramCallbackQuery): Promise<HandleResult> {
    const bot = this.deps.botFor(persona.id);
    const [action, offerId] = (query.data ?? '').split(':');
    const offer = offerId ? await this.deps.offers.get(offerId) : null;
    const person = this.deps.org.getPersonByTelegramId(query.from.id);

    if (!offer || offer.personaId !== persona.id || (action !== 'share' && action !== 'keep')) {
      await bot.answerCallbackQuery(query.id, 'This request has expired.');
      return 'callback';
    }
    if (!person || person.id !== offer.ownerPersonId) {
      await bot.answerCallbackQuery(query.id, 'Only the person who told me can decide this.');
      return 'callback';
    }
    if (offer.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, 'Already decided.');
      return 'callback';
    }

    const memory = await this.deps.memories.get(offer.memoryId);
    if (!memory || memory.supersededBy) {
      await this.deps.offers.setStatus(offer.id, 'declined');
      await bot.answerCallbackQuery(query.id, 'That memory has since been changed or deleted.');
      return 'callback';
    }
    const scopeName = describeScope(this.deps.org, offer.proposedScope);
    if (action === 'share' && canPersonSee(this.deps.org, person.id, offer.proposedScope)) {
      await this.deps.memories.update(memory.id, { scope: offer.proposedScope });
      await this.deps.offers.setStatus(offer.id, 'approved');
      await bot.answerCallbackQuery(query.id, `Shared with ${scopeName}.`);
      if (query.message) {
        await bot.editMessageText(query.message.chat.id, query.message.message_id, `Shared with ${scopeName}: "${memory.content}"`);
      }
    } else {
      await this.deps.offers.setStatus(offer.id, 'declined');
      await bot.answerCallbackQuery(query.id, 'Kept private.');
      if (query.message) {
        await bot.editMessageText(query.message.chat.id, query.message.message_id, `Kept between us: "${memory.content}"`);
      }
    }
    return 'callback';
  }

  // ============================================
  // COMMANDS
  // ============================================

  private async handleCommand(
    persona: Persona,
    chat: ChatContext,
    speakerId: string,
    message: TelegramMessage,
    text: string
  ): Promise<boolean> {
    const bot = this.deps.botFor(persona.id);
    const [rawCommand, ...args] = text.trim().split(/\s+/);
    const [commandName, target] = rawCommand.split('@');
    if (target && target.toLowerCase() !== persona.telegramUsername?.toLowerCase()) return false;
    const command = commandName.toLowerCase();
    const { org } = this.deps;

    switch (command) {
      case '/start':
        await bot.sendMessage(
          message.chat.id,
          `Hi ${org.getPerson(speakerId)?.name}, I'm ${persona.name}, ${persona.role} at ${org.organizationName}. Talk to me by text or voice.\n\n/memories — what I remember that you can see\n/forget <number> — delete something you told me\n/whoami — how I know you`
        );
        return true;

      case '/whoami':
        await bot.sendMessage(message.chat.id, chat.kind === 'group' ? `${org.getPerson(speakerId)?.name} — Telegram ID: ${message.from!.id}` : org.describePerson(speakerId));
        return true;

      case '/memories': {
        // Always computed for the speaker alone, and only answered privately.
        if (chat.kind !== 'private') {
          await bot.sendMessage(message.chat.id, 'Ask me in a private chat so I only show what you can see.');
          return true;
        }
        const list = await this.memoriesVisibleTo(persona, speakerId);
        if (list.length === 0) {
          await bot.sendMessage(message.chat.id, "I don't remember anything you can see yet.");
          return true;
        }
        const lines = list.map((m, i) => {
          const mine = m.source.personId === speakerId ? '' : ` — from ${org.getPerson(m.source.personId)?.name}`;
          return `${i + 1}. ${m.content} [${describeScope(org, m.scope)}${mine}]`;
        });
        await bot.sendMessage(message.chat.id, `What I remember that you can see:\n${lines.join('\n')}`);
        return true;
      }

      case '/forget': {
        if (chat.kind !== 'private') {
          await bot.sendMessage(message.chat.id, 'Ask me in a private chat.');
          return true;
        }
        const index = Number.parseInt(args[0] ?? '', 10) - 1;
        const list = await this.memoriesVisibleTo(persona, speakerId);
        const target = list[index];
        if (!target) {
          await bot.sendMessage(message.chat.id, 'Send /memories first, then /forget with a number from the list.');
        } else if (target.source.personId !== speakerId) {
          await bot.sendMessage(message.chat.id, `Only ${org.getPerson(target.source.personId)?.name} can delete that one.`);
        } else {
          await this.deps.memories.delete(target.id);
          await bot.sendMessage(message.chat.id, `Forgotten: "${target.content}"`);
        }
        return true;
      }

      default:
        return false;
    }
  }

  private async memoriesVisibleTo(persona: Persona, personId: string): Promise<MemoryRecord[]> {
    const all = await this.deps.memories.listActive(persona.id);
    return all
      .filter((m) => isVisibleToAudience(this.deps.org, m, [personId]))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}

/** Web pages behind a reply, as plain links Telegram makes clickable. */
export function withSources(reply: string, sources: WebSource[]): string {
  const links = sources.slice(0, 3).map((s) => s.url);
  return links.length ? `${reply}\n\nSources:\n${links.join('\n')}` : reply;
}
