// Default (jsdom) environment: src/test/setup.ts dereferences `window`, so a
// node-environment pragma fails before any test runs.
//
// Glean-style negative identities: "the search result is the ground truth".
// For every scope kind and every outsider, in every retrieval flag state, no
// canary row reaches the outsider through selection, a warmed cache, a leaky
// vector index or the full gateway pipeline. Positive controls prove an
// authorised reader does get the canary, so nothing passes vacuously. The test
// asserts on payloads only and never logs them.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import type { ChatContext, MemoryRecord, MemoryScope, MemorySensitivity } from '../types';
import type { TelegramBotClient } from '../telegram/client';
import { PersonaGateway } from '../gateway';
import { OrgDirectory } from '../org/directory';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { snapshotScopeAudience } from '../memory/visibility';
import { activeMemoryCache, selectMemories, tokenize, vectorCandidates } from '../memory/retrieval';
import { embedMemory, FakeEmbeddingProvider } from '../memory/embeddings';
import { FakeLLM, fakeBot, GAMEEND_CHAT, groupText, LEADS_CHAT, privateText } from './fixtures';
import { evalOrgConfig } from './memory-eval/dataset';

const org = new OrgDirectory(evalOrgConfig());
const NOW = new Date('2026-10-19T10:00:00Z');
const TG: Record<string, number> = { reza: 1001, parastoo: 1002, milad: 1003, sina: 1004, nima: 1005, 'guest-ali': 9101, unknown: 4242 };
const GROUP_CHAT: Record<string, number> = { leads: LEADS_CHAT, 'gameend-team': GAMEEND_CHAT };

/** A reader: a private chat with a person (or an unknown Telegram id), or a person speaking in a group. */
type Reader = { person: string; group?: 'leads' | 'gameend-team' };
const label = (r: Reader) => (r.group ? `${r.person}@${r.group}` : r.person);

interface Case { kind: string; scope: MemoryScope; sensitivity: MemorySensitivity; outsiders: Reader[]; control?: Reader }
const others = (...ids: string[]) => ids.map((person) => ({ person }));
const CASES: Case[] = [
  { kind: 'private', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'normal', outsiders: others('parastoo', 'milad', 'sina', 'guest-ali'), control: { person: 'reza' } },
  { kind: 'personal', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'personal', outsiders: [...others('parastoo', 'milad', 'sina', 'nima', 'guest-ali'), { person: 'reza', group: 'leads' }], control: { person: 'reza' } },
  { kind: 'confidential', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'confidential', outsiders: [...others('parastoo', 'milad', 'sina', 'nima', 'guest-ali'), { person: 'reza', group: 'leads' }], control: { person: 'reza' } },
  { kind: 'people', scope: { kind: 'people', personIds: ['reza', 'parastoo'] }, sensitivity: 'normal', outsiders: others('milad', 'sina', 'guest-ali'), control: { person: 'parastoo' } },
  { kind: 'group', scope: { kind: 'group', groupId: 'leads' }, sensitivity: 'normal', outsiders: [...others('milad', 'sina', 'guest-ali'), { person: 'reza', group: 'gameend-team' }], control: { person: 'reza', group: 'leads' } },
  { kind: 'project', scope: { kind: 'project', projectId: 'gameend' }, sensitivity: 'normal', outsiders: others('sina', 'nima', 'guest-ali'), control: { person: 'milad' } },
  { kind: 'company', scope: { kind: 'company', companyId: 'ludaxis' }, sensitivity: 'normal', outsiders: others('sina', 'nima', 'guest-ali'), control: { person: 'parastoo' } },
  { kind: 'org', scope: { kind: 'org' }, sensitivity: 'normal', outsiders: others('guest-ali', 'unknown'), control: { person: 'sina' } },
];

const QUERY_EN = 'What is the budget launch plan?';
const QUERY_FA = 'برنامه بودجه رونمایی چیست';

function canaries(c: Case): { records: MemoryRecord[]; tokens: string[] } {
  const suffix = randomUUID().slice(0, 8);
  const en = `CANARY-${c.kind}-${suffix}`;
  const fa = `CANARYFA-${c.kind}-${suffix}`;
  const at = new Date('2026-10-10T10:00:00Z');
  const authorizedPersonIds = c.scope.kind === 'private' ? [c.scope.personId] : c.scope.kind === 'people' ? [...c.scope.personIds] : snapshotScopeAudience(org, c.scope);
  const base = (id: string, content: string): MemoryRecord => ({
    id, personaId: 'aria', content, type: 'decision', scope: c.scope, sensitivity: c.sensitivity,
    source: { personId: 'reza', chatKind: c.scope.kind === 'group' ? 'group' : 'private', ...(c.scope.kind === 'group' ? { groupId: c.scope.groupId } : {}), at, eventIds: [`ev-${id}`] },
    aboutPersonIds: [], authorizedPersonIds, confidence: 0.9, createdAt: at, updatedAt: at, importance: 10, status: 'confirmed',
  });
  return {
    records: [base(`${c.kind}-en-${suffix}`, `${en} budget launch plan is approved`), base(`${c.kind}-fa-${suffix}`, `برنامه بودجه رونمایی تایید شد ${fa}`)],
    tokens: [en, fa],
  };
}

function chatOf(r: Reader): ChatContext {
  return r.group
    ? { kind: 'group', chatKey: `g-${r.group}`, group: org.getGroup(r.group)! }
    : { kind: 'private', chatKey: `p-${r.person}`, personId: r.person === 'unknown' ? 'unknown-person' : r.person };
}

function makeGateway(records: MemoryRecord[]) {
  const llm = new FakeLLM();
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  for (const r of records) memories.records.set(r.id, r);
  const bot = fakeBot();
  const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new PersonaGateway({
    org, llm, memories, offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs),
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient, logger: silent, now: () => NOW,
  });
  return { gateway, llm, bot };
}

async function converse(r: Reader, records: MemoryRecord[]) {
  const ctx = makeGateway(records);
  for (const query of [QUERY_EN, QUERY_FA]) {
    const update = r.group ? groupText(GROUP_CHAT[r.group], TG[r.person], `Aria, ${query}`) : privateText(TG[r.person], query);
    await ctx.gateway.handleUpdate('aria', update);
  }
  return ctx;
}

/** Every outgoing payload: provider requests, prompts, extraction requests and Telegram calls. */
function payloads({ llm, bot }: ReturnType<typeof makeGateway>): string {
  return JSON.stringify([llm.replyRequests, llm.replyPrompts, llm.extractionRequests, bot.sendMessage.mock.calls, bot.sendVoice.mock.calls, bot.editMessageText.mock.calls, bot.answerCallbackQuery.mock.calls]);
}

const FLAG_STATES = [
  { name: 'flags unset', env: { TIREH_RETRIEVAL_V2: undefined, TIREH_VECTOR_RETRIEVAL: undefined } },
  { name: 'TIREH_RETRIEVAL_V2=1', env: { TIREH_RETRIEVAL_V2: '1', TIREH_VECTOR_RETRIEVAL: undefined } },
  { name: 'TIREH_RETRIEVAL_V2=1 + TIREH_VECTOR_RETRIEVAL=1', env: { TIREH_RETRIEVAL_V2: '1', TIREH_VECTOR_RETRIEVAL: '1' } },
] as const;

const embedder = new FakeEmbeddingProvider({ dimensions: 128, tokenizer: tokenize });
let queryVectors: number[][] = [];
beforeAll(async () => { queryVectors = await embedder.embed([QUERY_EN, QUERY_FA]); });
afterEach(() => { vi.unstubAllEnvs(); activeMemoryCache.clear(); });

async function embedded(records: MemoryRecord[]): Promise<MemoryRecord[]> {
  return Promise.all(records.map(async (r) => { const e = await embedMemory(r, embedder); return e ? { ...r, ...e } : r; }));
}

const OUTSIDER_ROWS = CASES.flatMap((c) => c.outsiders.map((r) => [c.kind, label(r), c, r] as const));
const CONTROL_ROWS = CASES.filter((c) => c.control).map((c) => [c.kind, label(c.control!), c, c.control!] as const);

describe.each(FLAG_STATES)('negative identities ($name)', ({ env }) => {
  const stub = () => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); };

  it.each(OUTSIDER_ROWS)('%s canary: outsider %s gets zero rows from selection, a warmed cache and a leaky index', async (_kind, _label, c, outsider) => {
    stub();
    const { records } = canaries(c);
    const withVectors = await embedded(records);
    const chat = chatOf(outsider);
    for (const [i, query] of [QUERY_EN, QUERY_FA].entries()) {
      // (a) selection, flag-resolved mode and explicit v2 with and without a query embedding
      expect(selectMemories(org, withVectors, chat, { query, now: NOW })).toEqual([]);
      expect(selectMemories(org, withVectors, chat, { query, now: NOW, mode: 'v2', queryEmbedding: queryVectors[i] })).toEqual([]);
      // (b) warm the feature cache as an authorised reader, then ask as the outsider
      if (c.control) expect(selectMemories(org, withVectors, chatOf(c.control), { query, now: NOW, mode: 'v2', queryEmbedding: queryVectors[i] })).toHaveLength(2);
      expect(selectMemories(org, withVectors, chat, { query, now: NOW })).toEqual([]);
      expect(selectMemories(org, withVectors, chat, { query, now: NOW, mode: 'v2', queryEmbedding: queryVectors[i] })).toEqual([]);
      // (c) a vector index that returns every canary, piped through selection
      const findNearest = vi.fn(async () => withVectors);
      const candidates = await vectorCandidates({ findNearest }, org, chat, 'aria', queryVectors[i]);
      expect(selectMemories(org, candidates, chat, { query, now: NOW, queryEmbedding: queryVectors[i] })).toEqual([]);
      expect(selectMemories(org, await findNearest(), chat, { query, now: NOW, mode: 'v2', queryEmbedding: queryVectors[i] })).toEqual([]);
    }
  });

  it.each(OUTSIDER_ROWS)('%s canary: outsider %s sees no canary in any LLM or Telegram payload', async (_kind, _label, c, outsider) => {
    stub();
    const { records, tokens } = canaries(c);
    const ctx = await converse(outsider, await embedded(records));
    const sent = payloads(ctx);
    for (const token of tokens) expect(sent.includes(token)).toBe(false);
    if (outsider.person === 'unknown') expect(ctx.llm.replyRequests).toHaveLength(0);
  });

  it.each(CONTROL_ROWS)('%s canary: positive control %s receives the canary in the reply prompt', async (_kind, _label, c, reader) => {
    stub();
    const { records, tokens } = canaries(c);
    const ctx = await converse(reader, await embedded(records));
    expect(ctx.llm.replyPrompts.length).toBeGreaterThan(0);
    const prompts = ctx.llm.replyPrompts.join('\n');
    for (const token of tokens) expect(prompts.includes(token)).toBe(true);
  });
});
