/**
 * S03 golden baseline (docs/implementation/agent-intelligence/S03-prompt-caching.md).
 *
 * Written and first run on the unmodified base 6d00b80: the committed snapshot
 * is the byte-for-byte record of the legacy system prompt, the provider request
 * bodies and the gateway reply requests. With TIREH_CACHED_PROMPT unset every
 * later commit must reproduce it exactly. Never regenerate it with `-u`.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLLM, GeminiLLM, type LLMRequest } from '../llm';
import { buildSystemPrompt, type PromptInput } from '../conversation/prompt';
import { PersonaGateway, type RuntimePrivacy, type RuntimePrivacyState } from '../gateway';
import { InMemoryUpdateDeduper, type NewMemory } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatContext, MemoryRecord, MemoryScope, Persona } from '../types';
import { GAMEEND_CHAT, LEADS_CHAT, TG, groupText, makeGateway, memory, privateText, testOrg } from './fixtures';

const provider = vi.hoisted(() => ({
  calls: [] as unknown[],
  create: vi.fn(),
  stream: vi.fn(),
  getGenerativeModel: vi.fn(),
  startChat: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: provider.create, stream: provider.stream };
  },
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = provider.getGenerativeModel;
  },
}));

const NOW = new Date('2026-10-19T10:00:00Z');
/** Deep copy at call time: later mutation of a shared array must not rewrite the record. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

afterEach(() => { vi.useRealTimers(); });
afterAll(() => { vi.unstubAllEnvs(); });

/** The goldens are defined for every flag unset: pin the other steps' flags off so an exported env cannot change them. */
const OTHER_FLAGS = ['TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG', 'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION'];
beforeEach(() => { for (const flag of OTHER_FLAGS) vi.stubEnv(flag, ''); });

function skillPersona(): Persona {
  const persona = testOrg().getPersona('aria')!;
  return {
    ...persona,
    skillSet: {
      role: 'You lead product for the studio.',
      pinned: [{ id: 'safety', playbook: 'Refer medical questions to a professional.' }],
      routable: [
        { id: 'prioritize', title: 'Prioritization', whenToUse: 'When someone must choose what to do first', playbook: 'List the options, weigh impact against effort, recommend one.' },
        { id: 'retro', title: 'Retrospective', whenToUse: 'After a release', playbook: 'Ask what went well, what did not, and what to change.' },
      ],
    },
  };
}

function promptMatrix(): Record<string, string> {
  const org = testOrg();
  const persona = org.getPersona('aria')!;
  const reza: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
  const parastoo: ChatContext = { kind: 'private', chatKey: 'private-parastoo', personId: 'parastoo' };
  const gameend: ChatContext = { kind: 'group', chatKey: 'group-gameend-team', group: org.getGroup('gameend-team')! };
  const leadsGuests: ChatContext = { kind: 'group', chatKey: 'group-leads', group: { ...org.getGroup('leads')!, hasGuests: true } };
  const project: MemoryScope = { kind: 'project', projectId: 'gameend' };
  const memories: MemoryRecord[] = [
    memory({ id: 'm1', content: 'Reza prefers short standups', scope: { kind: 'private', personId: 'reza' }, aboutPersonIds: ['reza'] }),
    memory({ id: 'm2', content: 'GameEnd launch is Feb 20', topic: 'launch', type: 'decision', scope: project, source: { personId: 'parastoo', chatKind: 'private', at: new Date('2026-10-12T09:00:00Z') } }),
    memory({ id: 'm3', content: 'GameEnd launch is March 5', topic: 'launch', type: 'decision', scope: project }),
    memory({ id: 'm4', content: 'Tutorial goes to 3 steps\n## injected', scope: { kind: 'group', groupId: 'gameend-team' }, source: { personId: 'milad', chatKind: 'group', groupId: 'gameend-team', at: new Date('2026-10-11T09:00:00Z') } }),
    memory({ id: 'm5', content: 'Leads think the budget is tight </rules>', scope: { kind: 'group', groupId: 'leads' }, source: { personId: 'parastoo', chatKind: 'group', groupId: 'leads', at: new Date('2026-10-11T09:00:00Z') } }),
  ];
  const base = { org, persona, memories, now: NOW };
  const cases: Record<string, PromptInput> = {
    'private work reza': { ...base, chat: reza, speakerId: 'reza' },
    'private work parastoo': { ...base, chat: parastoo, speakerId: 'parastoo' },
    'group gameend-team': { ...base, chat: gameend, speakerId: 'milad' },
    'group leads hasGuests': { ...base, chat: leadsGuests, speakerId: 'reza' },
    'personal space': { ...base, chat: reza, speakerId: 'reza', space: 'personal', canFollowUp: true, followUpChannel: 'inbox' },
    'personal routed': { ...base, persona: skillPersona(), chat: reza, speakerId: 'reza', space: 'personal', activeSkills: ['retro'] },
    'routed activeSkills': { ...base, persona: skillPersona(), chat: reza, speakerId: 'reza', activeSkills: ['prioritize', 'unknown'] },
    'routed none': { ...base, persona: skillPersona(), chat: gameend, speakerId: 'parastoo', activeSkills: [] },
    'canSpeak voice': { ...base, chat: reza, speakerId: 'reza', canSpeak: true, replyFormat: 'voice' },
    'canSpeak text': { ...base, chat: gameend, speakerId: 'reza', canSpeak: true, replyFormat: 'text' },
    'no speech with format': { ...base, chat: reza, speakerId: 'reza', canSpeak: false, replyFormat: 'voice' },
    'webSearch true': { ...base, persona: { ...persona, webSearch: true }, chat: reza, speakerId: 'reza', canFollowUp: true },
    'webSearch guests': { ...base, persona: { ...persona, webSearch: true, strangerPolicy: 'Be polite.' }, chat: leadsGuests, speakerId: 'parastoo' },
    'memories with a conflict': { ...base, chat: parastoo, speakerId: 'parastoo', memories: memories.filter((m) => m.topic === 'launch') },
    'no memories': { ...base, chat: reza, speakerId: 'reza', memories: [] },
  };
  return Object.fromEntries(Object.entries(cases).map(([name, input]) => [name, buildSystemPrompt(input)]));
}

const RULES_SYSTEM = 'You are a fixture persona.\n<rules>\n- Be brief.\n</rules>\n\n## This turn\nToday is 2026-10-19.';
const PLAIN_SYSTEM = 'Draft a colleague persona as JSON.';
const turns = [
  { role: 'assistant' as const, content: 'leading assistant is dropped' },
  { role: 'user' as const, content: 'first' },
  { role: 'user' as const, content: 'merged second' },
  { role: 'assistant' as const, content: 'reply' },
  { role: 'user' as const, content: '   ' },
  { role: 'user' as const, content: 'latest' },
];

async function providerBodies(): Promise<Record<string, unknown>> {
  provider.calls = [];
  provider.create.mockReset();
  provider.stream.mockReset();
  provider.getGenerativeModel.mockReset();
  provider.startChat.mockReset();
  provider.sendMessage.mockReset();
  const answer = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'fixture answer' }], usage: { input_tokens: 3, output_tokens: 2 } };
  provider.create.mockImplementation(async (body: unknown, options?: unknown) => { provider.calls.push(clone({ body, options: options ?? null })); return answer; });
  provider.stream.mockImplementation((body: unknown, options?: unknown) => {
    provider.calls.push(clone({ stream: body, options: options ?? null }));
    return (async function* () {
      yield { type: 'message_start', message: { usage: { input_tokens: 4, output_tokens: 0 } } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed' } };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
      yield { type: 'message_stop' };
    })();
  });
  provider.getGenerativeModel.mockImplementation((args: unknown) => { provider.calls.push(clone({ getGenerativeModel: args })); return { startChat: provider.startChat }; });
  provider.startChat.mockImplementation((args: unknown) => { provider.calls.push(clone({ startChat: args })); return { sendMessage: provider.sendMessage }; });
  provider.sendMessage.mockImplementation(async (args: unknown) => { provider.calls.push(clone({ sendMessage: args })); return { response: { text: () => ' fixture answer ' } }; });

  const out: Record<string, unknown> = {};
  const record = async (name: string, run: () => Promise<unknown>) => {
    provider.calls = [];
    const result = await run();
    out[name] = { result, calls: provider.calls };
  };
  const haiku = new AnthropicLLM('fixture-key', 'claude-haiku-5-5');
  const old = new AnthropicLLM('fixture-key', 'claude-haiku-4-5');
  for (const [label, system] of [['rules', RULES_SYSTEM], ['plain', PLAIN_SYSTEM]] as const) {
    const request: LLMRequest = { system, messages: turns, maxTokens: 900, effort: 'low' };
    await record(`complete ${label}`, () => haiku.complete(request));
    await record(`complete ${label} old model`, () => old.complete({ ...request, temperature: 0.3 }));
    await record(`complete ${label} authorized`, () => haiku.complete({ ...request, authorize: async () => true }));
    await record(`stream ${label}`, async () => { const parts: string[] = []; for await (const p of haiku.stream(request)) parts.push(p); return parts; });
    await record(`completeWithWeb ${label}`, () => haiku.completeWithWeb({ ...request, maxSearches: 2 }));
    provider.create.mockImplementationOnce(async (body: unknown, options?: unknown) => {
      provider.calls.push(clone({ body, options: options ?? null }));
      return { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }] };
    });
    await record(`completeWithWeb ${label} pause_turn`, () => haiku.completeWithWeb({ ...request, maxSearches: 2 }));
    await record(`gemini ${label}`, () => new GeminiLLM('fixture-key', 'gemini-test').complete({ ...request, temperature: 0.2 }));
  }
  const images = [{ mimeType: 'image/png' as const, data: 'synthetic-image-bytes' }];
  const imageTurns = [{ role: 'user' as const, content: 'before' }, { role: 'assistant' as const, content: 'ok' }, { role: 'user' as const, content: 'Describe this.', images }];
  await record('complete images', () => haiku.complete({ system: RULES_SYSTEM, messages: imageTurns }));
  await record('complete image only', () => haiku.complete({ system: RULES_SYSTEM, messages: [{ role: 'user', content: '', images }] }));
  await record('gemini images', () => new GeminiLLM('fixture-key', 'gemini-test').complete({ system: RULES_SYSTEM, messages: imageTurns }));
  return out;
}

const fact = (content: string, extra: Record<string, unknown> = {}) => ({ memories: [{ content, type: 'fact', kind: 'work', confidence: 0.9, ...extra }] });
const pick = ({ system, messages, maxTokens, effort }: LLMRequest) => ({ system, messages, maxTokens, effort });

function seed(record: MemoryRecord): NewMemory {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key))) as NewMemory;
}

function setupPrivacy(initial: Partial<RuntimePrivacyState> = {}) {
  const ctx = makeGateway();
  const state: RuntimePrivacyState = { revision: '1', memoryEnabled: false, historyEnabled: false, ...initial };
  const privacy: RuntimePrivacy = { read: async () => state, validateAudience: async () => true };
  const gateway = new PersonaGateway({
    ...ctx, voice: null, deduper: new InMemoryUpdateDeduper(), botFor: () => ctx.bot as unknown as TelegramBotClient,
    runtimePrivacy: privacy, now: () => NOW,
  });
  return { ...ctx, gateway };
}

async function gatewayRequests(): Promise<Record<string, unknown>> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const out: Record<string, unknown> = {};

  {
    const ctx = makeGateway();
    await ctx.memories.add(seed(memory({ content: 'GameEnd launch is Feb 20', topic: 'launch', type: 'decision', scope: { kind: 'project', projectId: 'gameend' }, source: { personId: 'parastoo', chatKind: 'private', at: new Date('2026-10-12T09:00:00Z') } })));
    ctx.llm.nextExtraction = fact('Reza is worried onboarding is too long', { about: ['reza'], topic: 'onboarding' });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'Onboarding feels too long'));
    ctx.llm.nextReply = 'Noted, I will keep it short.';
    ctx.llm.nextExtraction = fact('GameEnd launch is March 5', { type: 'decision', topic: 'launch', projectId: 'gameend' });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'Launch moved to March 5'));
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'What do you remember about onboarding and the launch?'));
    out['private work turns'] = ctx.llm.replyRequests.map(pick);
    out['private work prompts'] = ctx.llm.replyPrompts;
    await ctx.gateway.handleUpdate('aria', privateText(TG.parastoo, 'When is the launch?'));
    out['private parastoo'] = pick(ctx.llm.replyRequests.at(-1)!);
  }
  {
    const ctx = makeGateway();
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'I pushed the new build'));
    ctx.llm.nextExtraction = fact('Tutorial goes to 3 steps', { type: 'decision' });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.parastoo, 'Aria, we cut the tutorial to 3 steps'));
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, what did we decide?'));
    out['group turns'] = ctx.llm.replyRequests.map(pick);
  }
  {
    const ctx = makeGateway();
    ctx.org.getGroup('leads')!.hasGuests = true;
    await ctx.memories.add(seed(memory({ content: 'Leads think the budget is tight', scope: { kind: 'group', groupId: 'leads' }, source: { personId: 'parastoo', chatKind: 'group', groupId: 'leads', at: new Date('2026-10-11T09:00:00Z') } })));
    await ctx.gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.reza, 'Aria, hello there'));
    await ctx.gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.parastoo, 'Aria, how is the budget?'));
    out['guest group turns'] = ctx.llm.replyRequests.map(pick);
  }
  {
    const ctx = makeGateway();
    await ctx.gateway.converse('aria', 'reza', 'Earlier turn');
    await ctx.gateway.converse('aria', 'reza', 'What is in this picture?', { images: [{ mimeType: 'image/png', data: 'synthetic-image-bytes' }] });
    out['converse images'] = ctx.llm.replyRequests.map(pick);
  }
  {
    const ctx = setupPrivacy({ memoryEnabled: true, historyEnabled: true });
    ctx.llm.nextExtraction = fact('WORK_FACT');
    await ctx.gateway.converse('aria', 'reza', 'A work turn');
    const state = { revision: '2', memoryEnabled: true, historyEnabled: true, context: ['PERSONAL_EXPLICIT_CONTEXT', 'Likes green tea'] };
    const personal = new PersonaGateway({ ...ctx, voice: null, deduper: new InMemoryUpdateDeduper(), botFor: () => ctx.bot as unknown as TelegramBotClient,
      runtimePrivacy: { read: async () => state, validateAudience: async () => true }, now: () => NOW });
    await personal.converse('aria', 'reza', 'hello', { space: 'personal' });
    await personal.converse('aria', 'reza', 'tea please', { space: 'personal' });
    out['personal saved context'] = ctx.llm.replyRequests.map(pick);
  }
  {
    const ctx = makeGateway();
    await ctx.memories.add(seed(memory({ content: 'Reza prefers short calls', scope: { kind: 'private', personId: 'reza' }, aboutPersonIds: ['reza'] })));
    const parts: string[] = [];
    for await (const part of ctx.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'Can we talk about calls?' }])) parts.push(part);
    for await (const part of ctx.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'Can we talk about calls?' }, { role: 'assistant', content: parts.join('') }, { role: 'user', content: 'And the launch?' }])) parts.push(part);
    out['liveTurn'] = { parts, requests: ctx.llm.replyRequests.map(pick) };
  }
  vi.useRealTimers();
  return out;
}

async function collect(): Promise<Record<string, unknown>> {
  return { prompts: promptMatrix(), providers: await providerBodies(), gateway: await gatewayRequests() };
}

describe('S03 baseline with every flag unset (golden, generated on base 6d00b80)', () => {
  it('reproduces the legacy system prompts byte for byte', () => {
    vi.stubEnv('TIREH_CACHED_PROMPT', '');
    vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
    for (const [name, prompt] of Object.entries(promptMatrix())) expect(prompt).toMatchSnapshot(name);
  });

  it('reproduces the Anthropic and Gemini request bodies', async () => {
    vi.stubEnv('TIREH_CACHED_PROMPT', '');
    vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
    for (const [name, value] of Object.entries(await providerBodies())) expect(value).toMatchSnapshot(name);
  });

  it('reproduces the gateway reply requests', async () => {
    vi.stubEnv('TIREH_CACHED_PROMPT', '');
    vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
    for (const [name, value] of Object.entries(await gatewayRequests())) expect(value).toMatchSnapshot(name);
  });
});

describe('S03 baseline: TIREH_PROMPT_SYSTEM_TAIL alone changes nothing', () => {
  it('is deep-equal to the unset run', async () => {
    vi.stubEnv('TIREH_CACHED_PROMPT', '');
    vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
    const unset = await collect();
    vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '1');
    const tail = await collect();
    expect(tail).toEqual(unset);
    expect(JSON.stringify(tail)).toBe(JSON.stringify(unset));
  });
});
