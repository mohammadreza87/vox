import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'util';
import {
  ActiveMemoryCache,
  ACTIVE_CACHE_MAX_RECORDS,
  audienceScopeKeys,
  LONG_MEMORY_CHARS,
  MAX_PROMPT_MEMORIES,
  MAX_SCOPE_KEYS_PER_QUERY,
  NEAR_DUPLICATE_COSINE,
  RRF_K,
  selectMemories,
  tokenize,
  VECTOR_CANDIDATE_LIMIT,
  vectorCandidates,
} from '../memory/retrieval';
import { audienceOf, isMemoryAllowedInChat } from '../memory/visibility';
import { parseOrgConfig } from '../org/config';
import { OrgDirectory } from '../org/directory';
import type { ChatContext, MemoryRecord, MemoryScope } from '../types';
import { memory, testOrg, testOrgConfig } from './fixtures';

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Frozen copy of the base selectMemories (6d00b80), the v1 reference.
// ---------------------------------------------------------------------------
const BASE_STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'from', 'have', 'just', 'like', 'more',
  'should', 'some', 'that', 'than', 'their', 'them', 'then', 'there', 'they', 'this', 'what',
  'when', 'where', 'which', 'will', 'with', 'would', 'your',
]);
function baseTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3 && !BASE_STOPWORDS.has(t)));
}
function baseSelect(org: OrgDirectory, memories: MemoryRecord[], chat: ChatContext, { query, limit = 20, now = new Date() }: { query: string; limit?: number; now?: Date }): MemoryRecord[] {
  const audience = audienceOf(chat);
  const queryTokens = baseTokens(query);
  const inConversation = (m: MemoryRecord) => chat.kind !== 'group' || (m.scope.kind === 'group' && m.scope.groupId === chat.group.id);
  const scored = memories
    .filter((m) => inConversation(m) && isMemoryAllowedInChat(org, m, chat))
    .map((memory) => {
      const memoryTokens = baseTokens(`${memory.content} ${memory.topic ?? ''}`);
      let overlap = 0;
      for (const t of memoryTokens) if (queryTokens.has(t)) overlap++;
      const ageDays = (now.getTime() - memory.updatedAt.getTime()) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / 90);
      const aboutAudience = memory.aboutPersonIds.some((id) => audience.includes(id)) ? 1 : 0;
      const typeBoost = memory.type === 'decision' ? 0.5 : memory.type === 'relationship' ? 0.3 : 0;
      return { memory, score: overlap * 2 + aboutAudience + recency + typeBoost + memory.confidence * 0.5 };
    });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.memory);
}

// ---------------------------------------------------------------------------
const NOW = new Date('2026-10-20T10:00:00Z');
const org = testOrg();
const rezaDm: ChatContext = { kind: 'private', chatKey: 'p-reza', personId: 'reza' };
const parastooDm: ChatContext = { kind: 'private', chatKey: 'p-parastoo', personId: 'parastoo' };
const gameendGroup = (): ChatContext => ({ kind: 'group', chatKey: 'g', group: org.getGroup('gameend-team')! });
let seq = 0;
const uid = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function rec(content: string, extra: Partial<MemoryRecord> = {}, scope: MemoryScope = { kind: 'org' }): MemoryRecord {
  return memory({ id: uid('m'), content, scope, updatedAt: daysAgo(5), createdAt: daysAgo(5), ...extra });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

describe('tokenize', () => {
  it('unifies Arabic and Persian letters', () => {
    expect(tokenize('كيان')).toEqual(tokenize('کیان'));
    expect(tokenize('كيان')).toEqual(['کیان']);
  });

  it('strips ZWNJ affixes and joins', () => {
    expect(tokenize('می‌رود')).toEqual(['رود']);
    expect(tokenize('نمی‌دونم')).toEqual(['دونم']);
    expect(tokenize('کتاب‌ها')).toEqual(['کتاب']);
    expect(tokenize('کتاب‌هایمان')).toEqual(['کتاب']);
    expect(tokenize('بزرگ‌ترین')).toEqual(['بزرگ']);
    expect(tokenize('خانه‌ی')).toEqual(['خانهی']);
  });

  it('emits light stems for words written without ZWNJ', () => {
    expect(tokenize('کتابها')).toEqual(['کتابها', 'کتاب']);
    expect(tokenize('میرود')).toEqual(['میرود', 'رود']);
    expect(tokenize('دفترهای')).toEqual(['دفترهای', 'دفتر']);
  });

  it('maps Persian and Arabic-Indic digits to ASCII', () => {
    expect(tokenize('۱۲')).toEqual(['12']);
    expect(tokenize('١٢')).toEqual(['12']);
    expect(tokenize('۲۰ بهمن')).toEqual(['20', 'بهمن']);
  });

  it('removes tatweel, harakat and directional marks', () => {
    expect(tokenize('كتـــاب')).toEqual(['کتاب']);
    expect(tokenize('کِتاب')).toEqual(['کتاب']);
    expect(tokenize('‏کتاب‎')).toEqual(['کتاب']);
    expect(tokenize('مسئول')).toEqual(tokenize('مسیول'));
  });

  it('drops English and Persian stopwords', () => {
    expect(tokenize('what is the plan for the launch, please')).toEqual(['plan', 'launch']);
    expect(tokenize('این برای ما است')).toEqual([]);
    expect(tokenize('آنها از کجا')).toEqual([]);
  });

  it('emits singular forms of English plurals', () => {
    expect(tokenize('deadlines')).toEqual(['deadlines', 'deadline']);
    expect(tokenize('access')).toEqual(['access']);
    expect(tokenize('bus')).toEqual(['bus']);
  });

  it('returns unique terms in first-seen order', () => {
    expect(tokenize('Launch launch LAUNCH demo')).toEqual(['launch', 'demo']);
  });
});

// ---------------------------------------------------------------------------
// Seeded random corpora for the v1 byte-identity check.
// ---------------------------------------------------------------------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ['launch', 'gameend', 'budget', 'deadline', 'design', 'review', 'sprint', 'onboarding', 'about', 'their', 'demo', 'kian', 'لانچ', 'بودجه', 'جلسه', 'طراحی', 'نسخه', 'release', 'retention', 'hiring'];
const PEOPLE = ['reza', 'parastoo', 'milad', 'sina'];

function randomCorpus(seed: number): { memories: MemoryRecord[]; chat: ChatContext; query: string; limit?: number } {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const scopes: Array<() => MemoryScope> = [
    () => ({ kind: 'private', personId: pick(PEOPLE) }),
    () => ({ kind: 'people', personIds: [pick(PEOPLE), pick(PEOPLE)] }),
    () => ({ kind: 'group', groupId: pick(['gameend-team', 'leads']) }),
    () => ({ kind: 'project', projectId: 'gameend' }),
    () => ({ kind: 'company', companyId: pick(['ludaxis', 'joyixir']) }),
    () => ({ kind: 'org' }),
  ];
  const n = 5 + Math.floor(r() * 40);
  const memories: MemoryRecord[] = [];
  for (let i = 0; i < n; i++) {
    const scope = pick(scopes)();
    const words = Array.from({ length: 2 + Math.floor(r() * 6) }, () => pick(WORDS));
    const at = daysAgo(Math.floor(r() * 120));
    const m = memory({
      id: `r${seed}-${i}`,
      content: words.join(' '),
      topic: r() < 0.5 ? pick(WORDS) : undefined,
      scope,
      type: pick(['fact', 'decision', 'preference', 'event', 'relationship'] as const),
      sensitivity: r() < 0.8 ? 'normal' : pick(['personal', 'confidential'] as const),
      aboutPersonIds: r() < 0.4 ? [pick(PEOPLE)] : [],
      confidence: Math.round(r() * 100) / 100,
      updatedAt: at,
      createdAt: at,
      ...(r() < 0.2 ? { authorizedPersonIds: PEOPLE.filter(() => r() < 0.6) } : {}),
      ...(r() < 0.05 ? { supersededBy: 'x' } : {}),
      ...(r() < 0.1 ? { expiresAt: daysAgo(1), importance: 9, embedding: [r(), r()] } : {}),
    });
    memories.push(m);
  }
  const chat: ChatContext = r() < 0.6
    ? { kind: 'private', chatKey: 'p', personId: pick(PEOPLE) }
    : { kind: 'group', chatKey: 'g', group: org.getGroup(pick(['gameend-team', 'leads']))! };
  const query = Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(WORDS)).join(' ');
  const limit = r() < 0.3 ? 1 + Math.floor(r() * 25) : undefined;
  return { memories, chat, query, limit };
}

describe('v1 byte identity with flags unset', () => {
  it('matches the frozen base algorithm on 200 seeded corpora', () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '');
    let nonEmpty = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { memories, chat, query, limit } = randomCorpus(seed);
      const expected = baseSelect(org, memories, chat, { query, limit, now: NOW }).map((m) => m.id);
      if (expected.length) nonEmpty++;
      expect(selectMemories(org, memories, chat, { query, limit, now: NOW }).map((m) => m.id)).toEqual(expected);
      expect(selectMemories(org, memories, chat, { query, limit, now: NOW, mode: 'v1' }).map((m) => m.id)).toEqual(expected);
      expect(selectMemories(org, memories, chat, { query, limit, now: NOW, mode: 'v1', queryEmbedding: [0.1, 0.2] }).map((m) => m.id)).toEqual(expected);
    }
    expect(nonEmpty).toBeGreaterThan(100);
  });

  it('treats any value other than 1 as off', () => {
    const { memories, chat, query } = randomCorpus(7);
    const expected = baseSelect(org, memories, chat, { query, now: NOW }).map((m) => m.id);
    for (const value of ['0', 'true', 'yes', '']) {
      vi.stubEnv('TIREH_RETRIEVAL_V2', value);
      expect(selectMemories(org, memories, chat, { query, now: NOW }).map((m) => m.id)).toEqual(expected);
    }
  });
});

describe('TIREH_RETRIEVAL_V2=1', () => {
  const many = () => Array.from({ length: 40 }, (_, i) => rec(`GameEnd launch note ${i} about the budget`, { id: uid(`many${i}`) }));

  it('defaults to at most 8 results, honours an explicit limit, and an explicit v1 overrides the flag', () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    const corpus = many();
    expect(selectMemories(org, corpus, rezaDm, { query: 'launch budget', now: NOW })).toHaveLength(MAX_PROMPT_MEMORIES);
    expect(selectMemories(org, corpus, rezaDm, { query: 'launch budget', now: NOW, limit: 30 })).toHaveLength(30);
    const v1 = selectMemories(org, corpus, rezaDm, { query: 'launch budget', now: NOW, mode: 'v1' });
    expect(v1).toHaveLength(20);
    expect(v1.map((m) => m.id)).toEqual(baseSelect(org, corpus, rezaDm, { query: 'launch budget', now: NOW }).map((m) => m.id));
  });

  it('exports the documented constants', () => {
    expect([MAX_PROMPT_MEMORIES, NEAR_DUPLICATE_COSINE, RRF_K, LONG_MEMORY_CHARS, ACTIVE_CACHE_MAX_RECORDS, VECTOR_CANDIDATE_LIMIT, MAX_SCOPE_KEYS_PER_QUERY])
      .toEqual([8, 0.92, 60, 210, 300, 40, 30]);
  });
});

describe('v2 suppression and ranking', () => {
  const v2 = (memories: MemoryRecord[], query: string, extra: { queryEmbedding?: number[]; limit?: number; chat?: ChatContext } = {}) =>
    selectMemories(org, memories, extra.chat ?? rezaDm, { query, now: NOW, mode: 'v2', queryEmbedding: extra.queryEmbedding, limit: extra.limit }).map((m) => m.id);

  it('suppresses expired, invalidated, superseded and replaced records', () => {
    const live = rec('Launch date is Feb 20');
    const expired = rec('Launch date is Feb 10', { expiresAt: daysAgo(1) });
    const expiresLater = rec('Launch date window opens Feb 1', { expiresAt: daysAgo(-3) });
    const invalidated = rec('Launch date is Feb 12', { invalidatedAt: daysAgo(0.5) });
    const superseded = rec('Launch date is Feb 14', { supersededBy: 'someone' });
    const predecessor = rec('Launch date is Feb 16');
    const successor = rec('Launch date is Feb 18 after the slip', { supersedes: predecessor.id });
    const ids = v2([live, expired, expiresLater, invalidated, superseded, predecessor, successor], 'launch date');
    expect(ids).toEqual(expect.arrayContaining([live.id, expiresLater.id, successor.id]));
    expect(ids).not.toEqual(expect.arrayContaining([expired.id]));
    for (const id of [expired.id, invalidated.id, superseded.id, predecessor.id]) expect(ids).not.toContain(id);
  });

  it('keeps only the higher-ranked of a contentHash duplicate and a cosine near-duplicate', () => {
    const strong = rec('Launch date is Feb 20', { type: 'decision', updatedAt: daysAgo(1) });
    const exactDup = rec('  Launch date is Feb 20 ', { updatedAt: daysAgo(30) });
    const embedA = rec('Budget review moved to Monday', { embedding: [1, 0, 0], embeddingModel: 'fake', embeddingVersion: 1, importance: 9 });
    const embedB = rec('Budget review is now on Monday', { embedding: [0.99, 0.1, 0], embeddingModel: 'fake', embeddingVersion: 1, importance: 2 });
    const otherModel = rec('Budget review on Monday confirmed', { embedding: [0.99, 0.1, 0], embeddingModel: 'other', embeddingVersion: 1, importance: 1 });
    const ids = v2([exactDup, strong, embedB, embedA, otherModel], 'launch date budget review monday');
    expect(ids).toContain(strong.id);
    expect(ids).not.toContain(exactDup.id);
    expect(ids).toContain(embedA.id);
    expect(ids).not.toContain(embedB.id);
    expect(ids).toContain(otherModel.id);
  });

  it('ranks a record found by both lexical and semantic lists above single-list hits', () => {
    const both = rec('Kian roadmap milestone', { embedding: [1, 0], embeddingModel: 'f', embeddingVersion: 1 });
    const lexOnly = rec('Kian roadmap milestone review');
    const semOnly = rec('Unrelated wording entirely', { embedding: [0.6, 0.8], embeddingModel: 'f', embeddingVersion: 1 });
    const ids = v2([lexOnly, semOnly, both], 'kian roadmap milestone', { queryEmbedding: [1, 0] });
    expect(ids[0]).toBe(both.id);
    expect(ids).toContain(semOnly.id);
  });

  it('ignores embeddings of non-normal records and mismatched lengths in the semantic rank', () => {
    const personal = rec('Private health note', { sensitivity: 'personal', embedding: [1, 0], embeddingModel: 'f', embeddingVersion: 1 }, { kind: 'private', personId: 'reza' });
    const mismatched = rec('Different length vector', { embedding: [1, 0, 0] });
    const plain = rec('Kian timeline');
    const ids = v2([personal, mismatched, plain], 'zzz', { queryEmbedding: [1, 0], limit: 3 });
    expect(ids).toHaveLength(3);
    // No list ranks them: order falls back to the rescoring terms only.
    const shuffled = v2([plain, mismatched, personal], 'zzz', { limit: 3 });
    expect(ids).toEqual(shuffled);
  });

  it('prefers higher importance and more recent lastRetrievedAt at equal relevance', () => {
    const low = rec('Hiring plan for designers', { importance: 2 });
    const high = rec('Hiring plan for engineers', { importance: 9 });
    expect(v2([low, high], 'hiring plan')[0]).toBe(high.id);

    const stale = rec('Retention metric is D7', { lastRetrievedAt: daysAgo(60) });
    const fresh = rec('Retention metric is D30', { lastRetrievedAt: daysAgo(0) });
    expect(v2([stale, fresh], 'retention metric')[0]).toBe(fresh.id);
  });

  it('applies the about-audience and decision boosts and penalises over-long records', () => {
    const plain = rec('Sprint cadence is two weeks');
    const about = rec('Sprint cadence is two weeks for design', { aboutPersonIds: ['reza'] });
    expect(v2([plain, about], 'sprint cadence')[0]).toBe(about.id);

    const fact = rec('Pricing tier is final now');
    const decision = rec('Pricing tier is final', { type: 'decision' });
    expect(v2([fact, decision], 'pricing tier')[0]).toBe(decision.id);

    const short = rec('Release train ships Thursdays');
    const long = rec(`Release train ships Thursdays ${'x'.repeat(LONG_MEMORY_CHARS)}`);
    expect(v2([long, short], 'release train thursdays')[0]).toBe(short.id);

    const disputed = rec('Office move is in March', { status: 'disputed' });
    const confirmed = rec('Office move is in April', { status: 'confirmed' });
    expect(v2([disputed, confirmed], 'office move')[0]).toBe(confirmed.id);
  });

  it('does not mutate deep-frozen inputs and returns input references', () => {
    const corpus = deepFreeze([rec('Launch date is Feb 20', { embedding: [1, 0], embeddingModel: 'f', embeddingVersion: 1 }), rec('Budget is 10k')]);
    const before = JSON.stringify(corpus);
    const out = selectMemories(org, corpus as MemoryRecord[], rezaDm, { query: 'launch budget', now: NOW, mode: 'v2', queryEmbedding: [1, 0] });
    expect(out.length).toBe(2);
    for (const m of out) expect(corpus).toContain(m);
    expect(JSON.stringify(corpus)).toBe(before);
  });

  it('final gate: an invisible record never appears, however well it scores', () => {
    const invisible = rec('Launch launch launch decision', {
      type: 'decision', importance: 10, status: 'confirmed', aboutPersonIds: ['reza'], confidence: 1,
      lastRetrievedAt: NOW, embedding: [1, 0], embeddingModel: 'f', embeddingVersion: 1,
    }, { kind: 'private', personId: 'parastoo' });
    const visible = rec('Something else entirely', { importance: 1, confidence: 0 });
    expect(v2([invisible, visible], 'launch decision', { queryEmbedding: [1, 0] })).toEqual([visible.id]);
    expect(v2([invisible], 'launch decision', { queryEmbedding: [1, 0], chat: parastooDm })).toEqual([invisible.id]);

    const leadsRecord = rec('Leads budget launch', { importance: 10, type: 'decision' }, { kind: 'group', groupId: 'leads' });
    const teamRecord = rec('Team note', {}, { kind: 'group', groupId: 'gameend-team' });
    expect(v2([leadsRecord, teamRecord], 'leads budget launch', { chat: gameendGroup() })).toEqual([teamRecord.id]);
    const orgRecord = rec('Org launch budget', { importance: 10 });
    expect(v2([orgRecord], 'launch budget', { chat: gameendGroup() })).toEqual([]);
  });
});

describe('ActiveMemoryCache', () => {
  const CANARY = 'CANARY_S06_CACHE_PRIVATE_TEXT_913';
  const corpus = () => [rec(`${CANARY} launch`, { id: 'c1', topic: `${CANARY} topic` }), rec('Budget review', { id: 'c2' })];

  it('hits on the same revision and fingerprint, misses after updatedAt, id-set or revision changes', () => {
    const cache = new ActiveMemoryCache();
    const rows = corpus();
    const first = cache.features('aria', 3, rows);
    expect(first).not.toBeNull();
    expect(cache.features('aria', 3, [...rows].reverse())).toBe(first);
    expect(cache.features('aria', 4, rows)).not.toBe(first);
    const second = cache.features('aria', 4, rows);
    expect(cache.features('aria', 4, [{ ...rows[0], updatedAt: new Date(rows[0].updatedAt.getTime() + 1) }, rows[1]])).not.toBe(second);
    const third = cache.features('aria', 4, rows);
    expect(cache.features('aria', 4, [rows[0]])).not.toBe(third);
    expect(cache.features('aria', undefined, rows)).not.toBe(cache.features('aria', 4, rows));
  });

  it('returns null above the record cap or with mixed personas, and v2 results match the cached path', () => {
    const cache = new ActiveMemoryCache();
    const big = Array.from({ length: ACTIVE_CACHE_MAX_RECORDS + 1 }, (_, i) => rec(`filler ${i}`, { id: uid('f'), importance: 1, confidence: 0, updatedAt: daysAgo(400) }));
    expect(cache.features('aria', 0, big)).toBeNull();
    expect(cache.features('aria', 0, [rec('a'), { ...rec('b'), personaId: 'other' }])).toBeNull();
    expect(cache.features('aria', 0, [{ ...rec('b'), personaId: 'other' }])).toBeNull();
    expect(cache.size).toBe(0);

    const relevant = Array.from({ length: 12 }, (_, i) => rec(`Kian milestone ${i} review`, { id: uid('k'), updatedAt: daysAgo(i) }));
    const cachedPath = selectMemories(org, [...relevant, ...big.slice(0, ACTIVE_CACHE_MAX_RECORDS - relevant.length)], rezaDm, { query: 'kian milestone review', now: NOW, mode: 'v2' });
    const uncachedPath = selectMemories(org, [...relevant, ...big], rezaDm, { query: 'kian milestone review', now: NOW, mode: 'v2' });
    expect(uncachedPath.map((m) => m.id)).toEqual(cachedPath.map((m) => m.id));

    const otherPersona = { ...rec('Unrelated other persona row', { importance: 1, confidence: 0, updatedAt: daysAgo(400) }), personaId: 'other' };
    const mixed = selectMemories(org, [...relevant, otherPersona], rezaDm, { query: 'kian milestone review', now: NOW, mode: 'v2', limit: 12 });
    expect(mixed.map((m) => m.id)).toEqual(selectMemories(org, relevant, rezaDm, { query: 'kian milestone review', now: NOW, mode: 'v2', limit: 12 }).map((m) => m.id));
  });

  it('expires entries after the TTL and evicts the least recently used persona', () => {
    let clock = 1_000;
    const cache = new ActiveMemoryCache({ maxPersonas: 2, ttlMs: 100, now: () => clock });
    const rowsFor = (personaId: string) => corpus().map((m) => ({ ...m, personaId }));
    const a = rowsFor('a');
    const first = cache.features('a', 1, a);
    clock += 50;
    expect(cache.features('a', 1, a)).toBe(first);
    clock += 101;
    expect(cache.features('a', 1, a)).not.toBe(first);

    const b = rowsFor('b');
    const c = rowsFor('c');
    const fa = cache.features('a', 1, a);
    cache.features('b', 1, b);
    expect(cache.features('a', 1, a)).toBe(fa); // touch a: b is now least recently used
    cache.features('c', 1, c);
    expect(cache.size).toBe(2);
    const fb = cache.features('b', 1, b);
    expect(fb).not.toBeNull();
    cache.clear('b');
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('holds no content, topic or query text', () => {
    const cache = new ActiveMemoryCache();
    const features = cache.features('aria', 1, corpus())!;
    const serialized = [JSON.stringify(cache), inspect(cache, { depth: 10, showHidden: true }), inspect(features, { depth: 10 }),
      JSON.stringify([...features.values()].map((f) => ({ ...f, terms: [...f.terms] })))].join('\n');
    expect(serialized).not.toContain('CANARY');
    expect(serialized).not.toContain('launch');
    expect(serialized).not.toContain('Budget');
    for (const f of features.values()) {
      expect(Object.keys(f).sort()).toEqual(['contentHash', 'termCount', 'terms', 'updatedAtMs']);
      for (const t of f.terms) expect(typeof t).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
const guestOrg = new OrgDirectory(parseOrgConfig({
  ...testOrgConfig(),
  people: [...testOrgConfig().people, { id: 'negar', name: 'Negar', role: 'Guest', telegramUserId: 2001, companyIds: ['ludaxis'], projectIds: ['gameend'], guest: true }],
  groups: [...testOrgConfig().groups, { id: 'partners', name: 'Partners', telegramChatId: -100700, memberIds: ['reza', 'negar'] }],
}));

describe('audienceScopeKeys', () => {
  it('lists private, group, project, company and org keys for a private member', () => {
    expect(audienceScopeKeys(org, rezaDm)).toEqual(['company:ludaxis', 'group:gameend-team', 'group:leads', 'org', 'private:reza', 'project:gameend']);
    expect(audienceScopeKeys(org, { kind: 'private', chatKey: 's', personId: 'sina' })).toEqual(['company:joyixir', 'org', 'private:sina']);
  });

  it('gives a private guest only the private and group keys', () => {
    expect(audienceScopeKeys(guestOrg, { kind: 'private', chatKey: 'n', personId: 'negar' })).toEqual(['group:partners', 'private:negar']);
  });

  it('gives an unknown person nothing', () => {
    expect(audienceScopeKeys(org, { kind: 'private', chatKey: 'u', personId: 'nobody' })).toEqual([]);
  });

  it('gives a group chat its group key, and a guest group nothing', () => {
    expect(audienceScopeKeys(org, gameendGroup())).toEqual(['group:gameend-team']);
    expect(audienceScopeKeys(org, { kind: 'group', chatKey: 'g', group: { ...org.getGroup('leads')!, hasGuests: true } })).toEqual([]);
    expect(audienceScopeKeys(guestOrg, { kind: 'group', chatKey: 'g', group: guestOrg.getGroup('partners')! })).toEqual([]);
    expect(audienceScopeKeys(org, { kind: 'group', chatKey: 'g', group: { ...org.getGroup('leads')!, memberIds: ['reza', 'ghost'] } })).toEqual([]);
  });
});

describe('vectorCandidates', () => {
  const row = (id: string, extra: Partial<MemoryRecord> = {}) => rec(`row ${id}`, { id, ...extra });
  function store(rows: MemoryRecord[] | (() => never)) {
    return { findNearest: vi.fn<(personaId: string, keys: string[], vector: number[], limit: number) => Promise<MemoryRecord[]>>(async () => {
      if (typeof rows === 'function') return rows();
      return rows;
    }) };
  }
  const ON = { TIREH_RETRIEVAL_V2: '1', TIREH_VECTOR_RETRIEVAL: '1' };

  it('returns [] without calling findNearest when off, half-on, unsupported, guest or empty', async () => {
    const s = store([row('a')]);
    expect(await vectorCandidates(s, org, 'aria', rezaDm, [1, 0], { env: {} })).toEqual([]);
    expect(await vectorCandidates(s, org, 'aria', rezaDm, [1, 0], { env: { TIREH_VECTOR_RETRIEVAL: '1' } })).toEqual([]);
    expect(await vectorCandidates({}, org, 'aria', rezaDm, [1, 0], { env: ON })).toEqual([]);
    expect(await vectorCandidates(s, org, 'aria', { kind: 'group', chatKey: 'g', group: { ...org.getGroup('leads')!, hasGuests: true } }, [1, 0], { env: ON })).toEqual([]);
    expect(await vectorCandidates(s, org, 'aria', { kind: 'private', chatKey: 'u', personId: 'nobody' }, [1, 0], { env: ON })).toEqual([]);
    expect(await vectorCandidates(s, org, 'aria', rezaDm, [], { env: ON })).toEqual([]);
    expect(s.findNearest).not.toHaveBeenCalled();
  });

  it('reads the process environment when no env is given', async () => {
    const s = store([row('a')]);
    // Pin the flags off first, so an exported TIREH_VECTOR_RETRIEVAL=1 cannot fail the off arm.
    vi.stubEnv('TIREH_RETRIEVAL_V2', '');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '');
    expect(await vectorCandidates(s, org, 'aria', rezaDm, [1, 0])).toEqual([]);
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    expect((await vectorCandidates(s, org, 'aria', rezaDm, [1, 0])).map((m) => m.id)).toEqual(['a']);
  });

  it('chunks more than 30 keys, dedupes by id and drops other-persona and superseded rows', async () => {
    const groups = Array.from({ length: 35 }, (_, i) => ({ id: `g${String(i).padStart(2, '0')}`, name: `G${i}`, telegramChatId: -200 - i, memberIds: ['reza'] }));
    const bigOrg = new OrgDirectory(parseOrgConfig({ ...testOrgConfig(), groups }));
    const s = store([row('a'), row('a'), row('b', { supersededBy: 'c' }), { ...row('d'), personaId: 'other' }, row('e')]);
    const out = await vectorCandidates(s, bigOrg, 'aria', rezaDm, [1, 0], { env: ON });
    expect(out.map((m) => m.id)).toEqual(['a', 'e']);
    const keys = audienceScopeKeys(bigOrg, rezaDm);
    expect(keys.length).toBeGreaterThan(MAX_SCOPE_KEYS_PER_QUERY);
    expect(s.findNearest).toHaveBeenCalledTimes(Math.ceil(keys.length / MAX_SCOPE_KEYS_PER_QUERY));
    const sent = s.findNearest.mock.calls.map((call) => call[1]);
    for (const chunk of sent) expect(chunk.length).toBeLessThanOrEqual(MAX_SCOPE_KEYS_PER_QUERY);
    expect(sent.flat()).toEqual(keys);
    for (const call of s.findNearest.mock.calls) {
      expect(call[0]).toBe('aria');
      expect(call[2]).toEqual([1, 0]);
      expect(call[3]).toBe(VECTOR_CANDIDATE_LIMIT);
    }
    await vectorCandidates(s, bigOrg, 'aria', rezaDm, [1, 0], { env: ON, limit: 7 });
    expect(s.findNearest.mock.calls.at(-1)?.[3]).toBe(7);
  });

  it('returns [] when findNearest throws', async () => {
    const s = store(() => { throw Object.assign(new Error('FAILED_PRECONDITION: missing index'), { code: 9 }); });
    expect(await vectorCandidates(s, org, 'aria', rezaDm, [1, 0], { env: ON })).toEqual([]);
    expect(s.findNearest).toHaveBeenCalled();
  });
});
