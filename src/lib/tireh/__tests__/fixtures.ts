import { canPersonSee } from '../memory/visibility';
import { vi } from 'vitest';
import { parseOrgConfig } from '../org/config';
import { OrgDirectory } from '../org/directory';
import type { LLM, LLMRequest } from '../llm';
import type { TelegramBotClient, TelegramMessage, TelegramUpdate } from '../telegram/client';
import type { VoiceService } from '../voice';
import {
  InMemoryChatHistoryStore,
  InMemoryMemoryStore,
  InMemoryShareOfferStore,
  InMemoryUpdateDeduper,
} from '../memory/store';
import { PersonaGateway } from '../gateway';
import type { MemoryRecord, MemoryScope } from '../types';

export const TG = { reza: 1001, parastoo: 1002, milad: 1003, sina: 1004, stranger: 9999 };
export const GAMEEND_CHAT = -100500;
export const LEADS_CHAT = -100600;

export function testOrgConfig() {
  return parseOrgConfig({
    organization: { id: 'hoor', name: 'HOOR' },
    people: [
      { id: 'reza', name: 'Reza', role: 'HOOR / Super Admin', telegramUserId: TG.reza, companyIds: ['ludaxis'] },
      { id: 'parastoo', name: 'Parastoo', role: 'Executive', managerId: 'reza', telegramUserId: TG.parastoo, companyIds: ['ludaxis'] },
      { id: 'milad', name: 'Milad', role: 'Team member', managerId: 'parastoo', telegramUserId: TG.milad, companyIds: ['ludaxis'] },
      { id: 'sina', name: 'Sina', role: 'Team member', managerId: 'reza', telegramUserId: TG.sina, companyIds: ['joyixir'] },
    ],
    relationships: [{ a: 'reza', b: 'parastoo', label: 'long-time collaborators' }],
    companies: [
      { id: 'ludaxis', name: 'Ludaxis' },
      { id: 'joyixir', name: 'Joyixir' },
    ],
    projects: [{ id: 'gameend', name: 'GameEnd', companyId: 'ludaxis', memberIds: ['reza', 'parastoo', 'milad'] }],
    groups: [
      { id: 'gameend-team', name: 'GameEnd Team', telegramChatId: GAMEEND_CHAT, memberIds: ['reza', 'parastoo', 'milad'], projectId: 'gameend' },
      { id: 'leads', name: 'Leads', telegramChatId: LEADS_CHAT, memberIds: ['reza', 'parastoo'] },
    ],
    personas: [
      {
        id: 'aria',
        name: 'Aria',
        role: 'Product Lead',
        personality: 'Analytical and warm',
        communicationStyle: 'Concise',
        values: ['Truthfulness'],
        voice: { elevenLabsVoiceId: 'voice-aria', description: 'calm' },
        ownerId: 'reza',
        telegramUsername: 'hoor_aria_bot',
        replyWithVoice: 'mirror',
      },
    ],
  });
}

export function testOrg(): OrgDirectory {
  return new OrgDirectory(testOrgConfig());
}

/**
 * Scripted LLM. Replies record the system prompt they were given; extraction
 * calls return whatever `nextExtraction` holds (then reset to empty).
 */
export class FakeLLM implements LLM {
  replyPrompts: string[] = [];
  replyRequests: LLMRequest[] = [];
  extractionCalls = 0;
  extractionRequests: LLMRequest[] = [];
  nextExtraction: unknown = { memories: [] };
  nextReply = 'Sure.';

  async complete(request: LLMRequest): Promise<string> {
    if (request.system.startsWith('You extract long-term memories')) {
      this.extractionCalls++;
      this.extractionRequests.push(request);
      const out = this.nextExtraction;
      this.nextExtraction = { memories: [] };
      return typeof out === 'string' ? out : JSON.stringify(out);
    }
    this.replyPrompts.push(request.system);
    this.replyRequests.push(request);
    return this.nextReply;
  }

  get lastPrompt(): string {
    return this.replyPrompts[this.replyPrompts.length - 1] ?? '';
  }
}

export function fakeBot() {
  let nextId = 5000;
  const sent: Array<{ method: string; chatId?: number; text?: string; options?: unknown }> = [];
  const bot = {
    sent,
    sendMessage: vi.fn(async (chatId: number, text: string, options?: unknown) => {
      sent.push({ method: 'sendMessage', chatId, text, options });
      return { message_id: nextId++, chat: { id: chatId, type: 'private' }, date: 0 } as TelegramMessage;
    }),
    sendVoice: vi.fn(async (chatId: number, _audio: ArrayBuffer, options?: unknown) => {
      sent.push({ method: 'sendVoice', chatId, options });
      return { message_id: nextId++, chat: { id: chatId, type: 'private' }, date: 0 } as TelegramMessage;
    }),
    sendChatAction: vi.fn(async () => true),
    answerCallbackQuery: vi.fn(async (_id: string, text?: string) => {
      sent.push({ method: 'answerCallbackQuery', text });
      return true;
    }),
    editMessageText: vi.fn(async (chatId: number, _messageId: number, text: string) => {
      sent.push({ method: 'editMessageText', chatId, text });
      return true;
    }),
    downloadFile: vi.fn(async () => new ArrayBuffer(8)),
  };
  return bot;
}

export type FakeBot = ReturnType<typeof fakeBot>;

export function fakeVoice(transcript = 'transcribed words'): VoiceService & { transcribe: ReturnType<typeof vi.fn>; synthesize: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn(async () => transcript),
    synthesize: vi.fn(async () => ({ audio: new ArrayBuffer(4), mimeType: 'audio/mpeg', filename: 'voice.mp3' })),
  };
}

export function makeGateway(options: { voice?: VoiceService | null } = {}) {
  const org = testOrg();
  const llm = new FakeLLM();
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const offers = new InMemoryShareOfferStore();
  const history = new InMemoryChatHistoryStore(epochs);
  const bot = fakeBot();
  const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new PersonaGateway({
    org,
    llm,
    memories,
    offers,
    history,
    deduper: new InMemoryUpdateDeduper(),
    voice: options.voice === undefined ? null : options.voice,
    botFor: () => bot as unknown as TelegramBotClient,
    logger: silent,
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  return { org, llm, memories, offers, history, bot, gateway, logger: silent };
}

let updateId = 1;
let messageId = 100;

export function privateText(fromTelegramId: number, text: string): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from: { id: fromTelegramId, is_bot: false, first_name: 'x' },
      chat: { id: fromTelegramId, type: 'private' },
      date: 0,
      text,
    },
  };
}

export function groupText(chatId: number, fromTelegramId: number, text: string, extra: Partial<TelegramMessage> = {}): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from: { id: fromTelegramId, is_bot: false, first_name: 'x' },
      chat: { id: chatId, type: 'supergroup', title: 'g' },
      date: 0,
      text,
      ...extra,
    },
  };
}

export function privateVoice(fromTelegramId: number): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from: { id: fromTelegramId, is_bot: false, first_name: 'x' },
      chat: { id: fromTelegramId, type: 'private' },
      date: 0,
      voice: { file_id: 'file-1', duration: 3, mime_type: 'audio/ogg' },
    },
  };
}

export function callback(fromTelegramId: number, data: string): TelegramUpdate {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: fromTelegramId, is_bot: false, first_name: 'x' },
      data,
      message: { message_id: messageId++, chat: { id: fromTelegramId, type: 'private' }, date: 0 },
    },
  };
}

export function memory(partial: Partial<MemoryRecord> & { content: string; scope: MemoryScope }): MemoryRecord {
  const at = partial.source?.at ?? new Date('2026-10-10T10:00:00Z');
  return {
    id: partial.id ?? `m-${Math.random().toString(36).slice(2)}`,
    personaId: 'aria',
    type: 'fact',
    sensitivity: 'normal',
    source: { personId: 'reza', chatKind: 'private', at },
    aboutPersonIds: [],
    authorizedPersonIds: partial.scope.kind === 'private' ? [partial.scope.personId] : partial.scope.kind === 'people' ? [...partial.scope.personIds] : testOrg().listPeople().filter((p) => canPersonSee(testOrg(), p.id, partial.scope)).map((p) => p.id),
    confidence: 0.9,
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}
