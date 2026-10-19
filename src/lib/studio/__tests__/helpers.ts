/**
 * Fakes for Vox Studio tests: scripted Claude, fake OpenAI / ElevenLabs,
 * fake Telegram bots, a real StudioStore on a temp dir and in-memory memory.
 */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';
import type { LLM, LLMRequest } from '../../tireh/llm';
import {
  InMemoryChatHistoryStore,
  InMemoryMemoryStore,
  InMemoryShareOfferStore,
  InMemoryUpdateDeduper,
} from '../../tireh/memory/store';
import type { TelegramBotClient, TelegramMessage, TelegramUpdate } from '../../tireh/telegram/client';
import { FakeLLM } from '../../tireh/__tests__/fixtures';
import type { ElevenLabsStudio, OpenAIMedia, VoiceOptions } from '../media';
import { Studio } from '../service';
import { StudioStore } from '../store';
import type { AgentVisibility, Member, PersonaSpec, Role } from '../types';

export const SECRET = 'test-secret-that-is-at-least-32-characters-long';
export const ID = { superadmin: 100, admin: 200, alice: 300, bob: 400, pending: 500, stranger: 999 };
export const T0 = new Date('2026-10-19T10:00:00Z');

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'vox-studio-'));
}

export function personaSpec(overrides: Partial<PersonaSpec> = {}): PersonaSpec {
  return {
    name: 'Nova',
    role: 'Game Designer',
    tagline: 'Finds the fun',
    backstory: 'Shipped three puzzle games.',
    personality: 'Curious and candid',
    communicationStyle: 'Short and clear',
    values: ['Craft'],
    expertise: ['Level design'],
    wontDo: 'Legal advice',
    languages: ['English'],
    culture: 'Persian',
    presentation: 'feminine',
    age: '30s',
    accent: 'Tehrani',
    voiceBrief: 'Warm feminine voice, 30s.',
    avatarHint: 'a small notebook',
    ...overrides,
  };
}

export function draftJson(persona: Partial<PersonaSpec> = {}, look: unknown = { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } }) {
  const p = personaSpec(persona);
  return JSON.stringify({ names: [p.name, 'Alt', 'Other'], persona: p, ...(look === undefined ? {} : { look }) });
}

/** Claude for persona design: answers from a queue, records every request. */
export class ScriptedLLM implements LLM {
  queue: string[] = [];
  requests: LLMRequest[] = [];
  push(...outputs: string[]) {
    this.queue.push(...outputs);
    return this;
  }
  async complete(request: LLMRequest): Promise<string> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next === undefined) throw new Error('ScriptedLLM: no scripted output left');
    return next;
  }
}

export function fakeTelegram() {
  let messageId = 1;
  const msg = (chatId: number) => ({ message_id: messageId++, chat: { id: chatId, type: 'private' }, date: 0 }) as TelegramMessage;
  return {
    sendMessage: vi.fn<(chatId: number, text: string, opts?: unknown) => Promise<TelegramMessage>>(async (chatId) => msg(chatId)),
    sendVoice: vi.fn(async (chatId: number) => msg(chatId)),
    sendChatAction: vi.fn(async () => true),
    answerCallbackQuery: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    downloadFile: vi.fn(async () => new ArrayBuffer(8)),
    getMe: vi.fn(async () => ({ id: 1, is_bot: true, first_name: 'Voxx', username: 'VoxxBot' })),
    deleteWebhook: vi.fn(async () => true),
    setWebhook: vi.fn(async () => true),
    // Long polling: hangs until a test scripts a batch with mockResolvedValueOnce.
    getUpdates: vi.fn((): Promise<TelegramUpdate[]> => new Promise(() => undefined)),
    getManagedBotToken: vi.fn(async (botId: number) => `token-${botId}`),
    setMyName: vi.fn(async () => true),
    setMyDescription: vi.fn(async () => true),
    setMyShortDescription: vi.fn(async () => true),
    setMyCommands: vi.fn(async () => true),
    setMyProfilePhoto: vi.fn(async () => true),
    setChatMenuButton: vi.fn(async () => true),
    getChatMemberCount: vi.fn(async () => 2),
    leaveChat: vi.fn(async () => true),
  };
}
export type FakeTelegram = ReturnType<typeof fakeTelegram>;

export function fakeOpenAI() {
  return {
    generateAvatar: vi.fn(async (prompt: string) => Buffer.from(`jpeg:${prompt.length}`)),
    transcribe: vi.fn(async () => 'hello there'),
  };
}

export function fakeEleven() {
  return {
    getVoiceOptions: vi.fn<() => Promise<VoiceOptions>>(async () => ({
      models: [{ id: 'eleven_v4', name: 'Eleven v4', languages: [{ code: 'en', name: 'English' }, { code: 'fa', name: 'Persian' }], persian: true, kind: 'quality' }],
      defaultVoices: [{ voiceId: 'fixture-sarah', name: 'Sarah', gender: 'female', language: 'en' }],
      tier: 'creator', libraryAllowed: true, ttsModel: 'eleven_v4',
    })),
    designVoices: vi.fn(async () => [
      { generatedVoiceId: 'gen-1', audio: Buffer.from('mp3-1'), mediaType: 'audio/mpeg' },
      { generatedVoiceId: 'gen-2', audio: Buffer.from('mp3-2'), mediaType: 'audio/mpeg' },
      { generatedVoiceId: 'gen-3', audio: Buffer.from('mp3-3'), mediaType: 'audio/mpeg' },
      { generatedVoiceId: 'gen-4', audio: Buffer.from('mp3-4'), mediaType: 'audio/mpeg' },
    ]),
    saveDesignedVoice: vi.fn(async () => 'voice-designed'),
    searchLibrary: vi.fn(async () => []),
    addLibraryVoice: vi.fn(async () => 'voice-library'),
    speak: vi.fn(async () => Buffer.from('spoken-mp3')),
    transcribe: vi.fn(async () => 'heard by scribe'),
    createSecret: vi.fn(async () => 'secret-1'),
    createAgent: vi.fn(async () => 'agent-xi-1'),
    updateAgent: vi.fn(async () => undefined),
    signedUrl: vi.fn(async () => 'wss://api.elevenlabs.io/v1/convai/conversation?signed=1'),
  };
}

export interface Harness {
  studio: Studio;
  store: StudioStore;
  dir: string;
  personaLLM: ScriptedLLM;
  chatLLM: FakeLLM;
  openai: ReturnType<typeof fakeOpenAI>;
  eleven: ReturnType<typeof fakeEleven>;
  manager: FakeTelegram;
  bots: Map<string, FakeTelegram>;
  botFor: ReturnType<typeof vi.fn>;
  memory: {
    memories: InMemoryMemoryStore;
    offers: InMemoryShareOfferStore;
    history: InMemoryChatHistoryStore;
    deduper: InMemoryUpdateDeduper;
  };
  imageToJpeg: ReturnType<typeof vi.fn>;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  clock: { now: Date };
  advanceDays(days: number): void;
}

export function makeStudio(options: { openai?: boolean; eleven?: boolean; manager?: boolean; managerUsername?: string } = {}): Harness {
  const dir = tempDir();
  const store = new StudioStore(dir);
  const personaLLM = new ScriptedLLM();
  const chatLLM = new FakeLLM();
  const openai = fakeOpenAI();
  const eleven = fakeEleven();
  const manager = fakeTelegram();
  const bots = new Map<string, FakeTelegram>();
  const botFor = vi.fn((token: string) => {
    if (!bots.has(token)) bots.set(token, fakeTelegram());
    return bots.get(token)! as unknown as TelegramBotClient;
  });
  const memory = {
    memories: new InMemoryMemoryStore(),
    offers: new InMemoryShareOfferStore(),
    history: new InMemoryChatHistoryStore(),
    deduper: new InMemoryUpdateDeduper(),
  };
  const imageToJpeg = vi.fn(async (data: Buffer) => Buffer.concat([Buffer.from('JPEG:'), data]));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const clock = { now: new Date(T0) };
  const studio = new Studio({
    store,
    personaLLM,
    chatLLM,
    openai: options.openai === false ? null : (openai as unknown as OpenAIMedia),
    eleven: options.eleven === false ? null : (eleven as unknown as ElevenLabsStudio),
    managerBot: options.manager === false ? null : (manager as unknown as TelegramBotClient),
    managerUsername: options.managerUsername ?? 'VoxxBot',
    botFor: botFor as unknown as (token: string) => TelegramBotClient,
    secret: SECRET,
    orgName: 'HOOR',
    superadminIds: [ID.superadmin],
    memory,
    imageToJpeg,
    logger,
    now: () => clock.now,
  });
  return {
    studio, store, dir, personaLLM, chatLLM, openai, eleven, manager, bots, botFor, memory, imageToJpeg, logger, clock,
    advanceDays(days: number) {
      clock.now = new Date(clock.now.getTime() + days * 86_400_000);
    },
  };
}

const NAMES: Record<number, string> = {
  [ID.superadmin]: 'Reza', [ID.admin]: 'Parastoo', [ID.alice]: 'Alice', [ID.bob]: 'Bob', [ID.pending]: 'Pat', [ID.stranger]: 'Stranger',
};

/** Superadmin (bootstrap), one admin, two members (Alice, Bob) and one pending person. */
export async function seedOrg(h: Harness) {
  const sa = await h.studio.ensureMember({ id: ID.superadmin, first_name: NAMES[ID.superadmin] });
  for (const id of [ID.admin, ID.alice, ID.bob, ID.pending]) await h.studio.ensureMember({ id, first_name: NAMES[id] });
  await h.studio.setRole(sa, ID.admin, 'admin');
  await h.studio.setRole(sa, ID.alice, 'member');
  await h.studio.setRole(sa, ID.bob, 'member');
  return {
    superadmin: await memberOf(h, ID.superadmin),
    admin: await memberOf(h, ID.admin),
    alice: await memberOf(h, ID.alice),
    bob: await memberOf(h, ID.bob),
    pending: await memberOf(h, ID.pending),
  };
}

export async function memberOf(h: Harness, id: number): Promise<Member> {
  const m = (await h.store.read()).members.find((x) => x.telegramId === id);
  if (!m) throw new Error(`no member ${id}`);
  return m;
}

export function fakeMember(id: number, role: Role): Member {
  return { telegramId: id, name: NAMES[id] ?? `U${id}`, role, joinedAt: T0.toISOString() };
}

let nextBotId = 7000;

/** draft → publish → managed bot update: an active agent in its forming period. */
/**
 * Draft → publish → managed bot. New agents are private by default; most
 * tests are about other behaviour, so `visibility` defaults to 'org' here.
 */
export async function hire(h: Harness, creator: Member, persona: Partial<PersonaSpec> = {}, successorOf?: string, visibility: AgentVisibility = 'org') {
  h.personaLLM.push(draftJson(persona));
  const { agent } = await h.studio.draft(creator, {}, successorOf);
  const { link } = await h.studio.publish(creator, agent.id);
  const username = new URL(link).pathname.split('/').pop()!;
  const botId = nextBotId++;
  const hired = await h.studio.onManagedBot({
    user: { id: creator.telegramId, is_bot: false, first_name: creator.name },
    bot: { id: botId, is_bot: true, first_name: persona.name ?? 'Nova', username },
  });
  if (!hired) throw new Error('hire failed');
  if (visibility !== 'private') {
    await h.store.update((st) => { st.agents.find((x) => x.id === hired.id)!.visibility = visibility; });
    hired.visibility = visibility;
  }
  return { agent: hired, botId, token: `token-${botId}`, bot: () => h.bots.get(`token-${botId}`)! };
}
