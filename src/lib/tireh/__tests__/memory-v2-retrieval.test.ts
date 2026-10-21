// Default (jsdom) environment: src/test/setup.ts dereferences `window`, so a
// node-environment pragma fails before any test runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatContext, MemoryRecord, MemoryScope, MemorySensitivity, MemoryType } from '../types';
import { OrgDirectory } from '../org/directory';
import { audienceOf, isMemoryAllowedInChat } from '../memory/visibility';
import {
  ActiveMemoryCache,
  activeMemoryCache,
  allowedScopeKeys,
  MAX_PROMPT_MEMORIES,
  selectMemories,
  tokenize,
  vectorCandidates,
  type RetrievalOptions,
} from '../memory/retrieval';
import { FakeEmbeddingProvider } from '../memory/embeddings';
import { InMemoryMemoryStore, type MemoryStore } from '../memory/store';
import { memory, testOrg, testOrgConfig } from './fixtures';

type FindNearest = NonNullable<MemoryStore['findNearest']>;
const ZWNJ = String.fromCharCode(0x200c);
const AR_YEH = String.fromCharCode(0x064a);
const AR_KAF = String.fromCharCode(0x0643);
const NOW = new Date('2026-10-20T12:00:00Z');

afterEach(() => { vi.unstubAllEnvs(); activeMemoryCache.clear(); });

// ---------------------------------------------------------------------------
// Verbatim base (6d00b80) selectMemories: the v1 parity oracle.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'from', 'have', 'just', 'like', 'more',
  'should', 'some', 'that', 'than', 'their', 'them', 'then', 'there', 'they', 'this', 'what',
  'when', 'where', 'which', 'will', 'with', 'would', 'your',
]);
function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3 && !STOPWORDS.has(t)));
}
function baseSelectMemories(org: OrgDirectory, memories: MemoryRecord[], chat: ChatContext, { query, limit = 20, now = new Date() }: { query: string; limit?: number; now?: Date }): MemoryRecord[] {
  const audience = audienceOf(chat);
  const queryTokens = tokens(query);
  const inConversation = (m: MemoryRecord) => chat.kind !== 'group' || (m.scope.kind === 'group' && m.scope.groupId === chat.group.id);
  const scored = memories
    .filter((m) => inConversation(m) && isMemoryAllowedInChat(org, m, chat))
    .map((memory) => {
      const memoryTokens = tokens(`${memory.content} ${memory.topic ?? ''}`);
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

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const org = testOrg();
const PEOPLE = ['reza', 'parastoo', 'milad', 'sina'];
const WORDS = ['launch', 'GameEnd', 'sprint', 'budget', 'hiring', 'deadline', 'demo', 'weekly', 'design', 'review', 'date',
  'February', 'team', 'goals', 'the', 'about', 'with', 'status', 'steps', 'کار', 'تیم', 'بودجه', `کتاب${ZWNJ}ها`, `عل${AR_YEH}`,
  'علی', 'استخدام', 'جلسه', 'هفتگی', `می${ZWNJ}خواهم`, 'آن', '۲۰', 'Q4'];

function randomFixture(seed: number) {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const scopes: MemoryScope[] = [
    { kind: 'private', personId: pick(PEOPLE) }, { kind: 'people', personIds: [pick(PEOPLE), pick(PEOPLE)] },
    { kind: 'group', groupId: pick(['gameend-team', 'leads']) }, { kind: 'project', projectId: 'gameend' },
    { kind: 'company', companyId: pick(['ludaxis', 'joyixir']) }, { kind: 'org' },
  ];
  const count = Math.floor(rnd() * 40);
  const memories: MemoryRecord[] = Array.from({ length: count }, (_, i) => {
    const scope = pick(scopes);
    const at = new Date(NOW.getTime() - Math.floor(rnd() * 200) * 86_400_000);
    const base = memory({
      id: `s${seed}-m${i}`, content: words(1 + Math.floor(rnd() * 8)), scope, topic: rnd() < 0.3 ? words(1) : undefined,
      type: pick<MemoryType>(['fact', 'decision', 'preference', 'event', 'relationship']),
      sensitivity: pick<MemorySensitivity>(['normal', 'normal', 'normal', 'personal', 'confidential']),
      aboutPersonIds: rnd() < 0.4 ? [pick(PEOPLE)] : [], confidence: Math.round(rnd() * 10) / 10,
      source: { personId: pick(PEOPLE), chatKind: 'private', at }, createdAt: at, updatedAt: at,
      supersededBy: rnd() < 0.1 ? 'x' : undefined,
    });
    if (rnd() < 0.2) delete base.authorizedPersonIds;
    if (rnd() < 0.5) Object.assign(base, { importance: Math.floor(rnd() * 12), status: pick(['asserted', 'confirmed', 'disputed']),
      lastRetrievedAt: at, expiresAt: rnd() < 0.2 ? new Date(NOW.getTime() - 1000) : undefined, invalidatedBy: rnd() < 0.1 ? 'y' : undefined,
      embedding: [rnd(), rnd(), rnd()], contentHash: 'same' });
    return base;
  });
  const chats: ChatContext[] = [
    ...PEOPLE.map((personId) => ({ kind: 'private' as const, chatKey: `p-${personId}`, personId })),
    { kind: 'private', chatKey: 'p-unknown', personId: 'stranger' },
    { kind: 'group', chatKey: 'g1', group: org.getGroup('gameend-team')! },
    { kind: 'group', chatKey: 'g2', group: org.getGroup('leads')! },
    { kind: 'group', chatKey: 'g3', group: { ...org.getGroup('leads')!, hasGuests: true } },
  ];
  return { memories, chat: pick(chats), query: words(1 + Math.floor(rnd() * 6)), limit: pick([undefined, 2, 30]) };
}

describe('v1 parity with the base oracle', () => {
  it('matches the verbatim base selectMemories over 200 seeded fixtures (mode v1, flag unset, flag 0)', () => {
    let nonEmpty = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { memories, chat, query, limit } = randomFixture(seed);
      const options = { query, now: NOW, ...(limit === undefined ? {} : { limit }) };
      const expected = baseSelectMemories(org, memories, chat, options).map((m) => m.id);
      if (expected.length) nonEmpty++;
      expect(selectMemories(org, memories, chat, { ...options, mode: 'v1', queryEmbedding: [1, 2, 3] }).map((m) => m.id)).toEqual(expected);
      vi.stubEnv('TIREH_RETRIEVAL_V2', undefined);
      expect(selectMemories(org, memories, chat, options).map((m) => m.id)).toEqual(expected);
      vi.stubEnv('TIREH_RETRIEVAL_V2', '0');
      expect(selectMemories(org, memories, chat, options).map((m) => m.id)).toEqual(expected);
      vi.stubEnv('TIREH_RETRIEVAL_V2', 'true');
      expect(selectMemories(org, memories, chat, options).map((m) => m.id)).toEqual(expected);
      vi.unstubAllEnvs();
    }
    expect(nonEmpty).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
const reza: ChatContext = { kind: 'private', chatKey: 'p-reza', personId: 'reza' };
const sina: ChatContext = { kind: 'private', chatKey: 'p-sina', personId: 'sina' };
const leads: ChatContext = { kind: 'group', chatKey: 'g-leads', group: org.getGroup('leads')! };
const at = new Date('2026-10-10T12:00:00Z');
let seq = 0;
function rec(partial: Partial<MemoryRecord> & { content: string }): MemoryRecord {
  return memory({ id: partial.id ?? `r${++seq}`, scope: { kind: 'org' }, createdAt: at, updatedAt: at, confidence: 0.9, ...partial });
}
const many = (n: number, extra: Partial<MemoryRecord> = {}) => Array.from({ length: n }, (_, i) => rec({ id: `bulk-${String(i).padStart(3, '0')}`, content: `budget note ${i}`, ...extra }));

describe('mode resolution', () => {
  it('TIREH_RETRIEVAL_V2=1 returns at most 8 by default, honours limit 30, and mode v1 overrides', () => {
    const rows = many(40);
    vi.stubEnv('TIREH_RETRIEVAL_V2', undefined);
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW })).toHaveLength(20);
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW })).toHaveLength(MAX_PROMPT_MEMORIES);
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW, limit: 30 })).toHaveLength(30);
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW, mode: 'v1' })).toHaveLength(20);
    vi.stubEnv('TIREH_RETRIEVAL_V2', '');
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW })).toHaveLength(20);
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW, mode: 'v2' })).toHaveLength(8);
  });
});

describe('tokenize', () => {
  const matches = (a: string, b: string) => tokenize(a).some((t) => tokenize(b).includes(t));
  it('folds Arabic keyboard variants', () => {
    expect(matches(`عل${AR_YEH}`, 'علی')).toBe(true);
    expect(matches(`${AR_KAF}ار`, 'کار')).toBe(true);
    expect(tokenize(`${AR_KAF}ار`)).toEqual(['کار']);
  });
  it('handles ZWNJ prefixes and plural suffixes', () => {
    expect(tokenize(`می${ZWNJ}خواهم`)).toEqual(['خواهم']);
    expect(tokenize(`کتاب${ZWNJ}ها`)).toEqual(['کتاب']);
    expect(tokenize('کتابها')).toEqual(['کتاب']);
    expect(tokenize('کتابهایی')).toEqual(['کتاب']);
    expect(tokenize('میخواهم')).toEqual(['میخواهم']);
  });
  it('removes diacritics, maps digits and drops stopwords', () => {
    expect(tokenize('کِتاب')).toEqual(['کتاب']);
    expect(tokenize('۲۰ ٢٠')).toEqual(['20']);
    expect(tokenize('آن the and')).toEqual([]);
    expect(tokenize('کار تیم')).toEqual(['کار', 'تیم']);
  });
  it('stems English plurals conservatively and keeps short codes with digits', () => {
    expect(tokenize('steps status class')).toEqual(['step', 'status', 'class']);
    expect(tokenize('Q4 a1 it')).toEqual(['q4', 'a1']);
    expect(tokenize('Launch launch LAUNCH')).toEqual(['launch']);
  });
});

describe('v2 fusion', () => {
  const embedder = new FakeEmbeddingProvider({ dimensions: 128, tokenizer: tokenize });
  it('is lexical-only without a queryEmbedding; with one, a zero-overlap paraphrase enters the top 8', async () => {
    const fillers = Array.from({ length: 12 }, (_, i) => rec({ id: `f${String(i).padStart(2, '0')}`, content: `launch note number${i}` }));
    const [gloss] = await embedder.embed(['ship date GameEnd launch']);
    const paraphrase = rec({ id: 'paraphrase', content: 'ship date moved to spring', embedding: gloss });
    const [q] = await embedder.embed(['GameEnd launch']);
    const rows = [...fillers, paraphrase];
    expect(selectMemories(org, rows, reza, { query: 'GameEnd launch', now: NOW, mode: 'v2' }).map((m) => m.id)).not.toContain('paraphrase');
    expect(selectMemories(org, rows, reza, { query: 'GameEnd launch', now: NOW, mode: 'v2', queryEmbedding: q }).map((m) => m.id)).toContain('paraphrase');
  });
  it('a record matching neither list still fills free slots (v1-compatible)', () => {
    const rows = [rec({ id: 'hit', content: 'budget approved' }), rec({ id: 'none', content: 'unrelated words entirely' })];
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW, mode: 'v2' }).map((m) => m.id)).toEqual(['hit', 'none']);
  });
  it('ignores vectors of a different length', () => {
    const rows = [rec({ id: 'odd', content: 'zzz', embedding: [1, 0] })];
    expect(selectMemories(org, rows, reza, { query: 'q', now: NOW, mode: 'v2', queryEmbedding: [1, 0, 0] }).map((m) => m.id)).toEqual(['odd']);
  });
});

describe('v2 rescoring order', () => {
  const v2 = (rows: MemoryRecord[], chat: ChatContext = reza) => selectMemories(org, rows, chat, { query: 'nothing matches', now: NOW, mode: 'v2' }).map((m) => m.id);
  it('importance 9 beats 5 at equal relevance', () => {
    expect(v2([rec({ id: 'a', content: 'one', importance: 5 }), rec({ id: 'b', content: 'two', importance: 9 })])).toEqual(['b', 'a']);
  });
  it('an older lastRetrievedAt ranks lower', () => {
    expect(v2([rec({ id: 'a', content: 'one', lastRetrievedAt: new Date('2026-08-01') }), rec({ id: 'b', content: 'two', lastRetrievedAt: new Date('2026-10-19') })])).toEqual(['b', 'a']);
  });
  it('about-audience, decision over fact, and disputed demoted', () => {
    expect(v2([rec({ id: 'a', content: 'one' }), rec({ id: 'b', content: 'two', aboutPersonIds: ['reza'] })])).toEqual(['b', 'a']);
    expect(v2([rec({ id: 'a', content: 'one', type: 'fact' }), rec({ id: 'b', content: 'two', type: 'decision' })])).toEqual(['b', 'a']);
    expect(v2([rec({ id: 'a', content: 'one', status: 'disputed' }), rec({ id: 'b', content: 'two' })])).toEqual(['b', 'a']);
    expect(v2([rec({ id: 'a', content: 'one' }), rec({ id: 'b', content: 'two', status: 'confirmed' })])).toEqual(['b', 'a']);
  });
  it('a 400-character record is penalised below an equal 100-character one', () => {
    expect(v2([rec({ id: 'a', content: 'x'.repeat(400) }), rec({ id: 'b', content: 'y'.repeat(100) })])).toEqual(['b', 'a']);
  });
  it('relevance outranks the priors', () => {
    expect(selectMemories(org, [rec({ id: 'a', content: 'one', importance: 10, type: 'decision' }), rec({ id: 'b', content: 'budget' })], reza, { query: 'budget', now: NOW, mode: 'v2' }).map((m) => m.id)).toEqual(['b', 'a']);
  });
});

describe('v2 suppression', () => {
  const ids = (rows: MemoryRecord[]) => selectMemories(org, rows, reza, { query: 'x', now: NOW, mode: 'v2' }).map((m) => m.id);
  const near = (c: number) => [c, Math.sqrt(1 - c * c), 0];
  it('cosine 0.93 keeps only the higher-ranked; 0.91 keeps both', () => {
    expect(ids([rec({ id: 'a', content: 'one', importance: 9, embedding: [1, 0, 0] }), rec({ id: 'b', content: 'two', embedding: near(0.93) })])).toEqual(['a']);
    // Distinct ids: the feature cache fingerprint (id, updatedAt, length) would otherwise match the first set.
    expect(ids([rec({ id: 'c', content: 'one', importance: 9, embedding: [1, 0, 0] }), rec({ id: 'd', content: 'two', embedding: near(0.91) })])).toEqual(['c', 'd']);
  });
  it('an equal contentHash keeps one', () => {
    expect(ids([rec({ id: 'a', content: 'Same text', importance: 9 }), rec({ id: 'b', content: '  Same text ' })])).toEqual(['a']);
    expect(ids([rec({ id: 'a', content: 'one', contentHash: 'h' }), rec({ id: 'b', content: 'two', contentHash: 'h' })])).toHaveLength(1);
  });
  it('drops invalidated, expired and superseded-target records; keeps future expiry', () => {
    const rows = [
      rec({ id: 'inv-at', content: 'a', invalidatedAt: NOW }),
      rec({ id: 'inv-by', content: 'b', invalidatedBy: 'z' }),
      rec({ id: 'expired', content: 'c', expiresAt: NOW }),
      rec({ id: 'old', content: 'd' }),
      rec({ id: 'new', content: 'e', supersedes: 'old' }),
      rec({ id: 'future', content: 'f', expiresAt: new Date(NOW.getTime() + 86_400_000), invalidatedAt: new Date(NOW.getTime() + 1) }),
    ];
    expect(ids(rows).sort()).toEqual(['future', 'new']);
  });
});

describe('v2 final gate', () => {
  it('never returns invisible records, whatever their relevance', () => {
    const rows = [
      rec({ id: 'theirs', content: 'budget budget budget', scope: { kind: 'private', personId: 'parastoo' }, importance: 10, embedding: [1, 0] }),
      rec({ id: 'legacy-project', content: 'budget', scope: { kind: 'project', projectId: 'gameend' }, authorizedPersonIds: undefined }),
      rec({ id: 'mine', content: 'other' }),
    ];
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW, mode: 'v2', queryEmbedding: [1, 0] }).map((m) => m.id)).toEqual(['mine']);
  });
  it('applies group inConversation and denies hasGuests groups', () => {
    const rows = [
      rec({ id: 'leads', content: 'budget', scope: { kind: 'group', groupId: 'leads' } }),
      rec({ id: 'project', content: 'budget', scope: { kind: 'project', projectId: 'gameend' } }),
      rec({ id: 'org', content: 'budget' }),
      rec({ id: 'team', content: 'budget', scope: { kind: 'group', groupId: 'gameend-team' } }),
    ];
    expect(selectMemories(org, rows, leads, { query: 'budget', now: NOW, mode: 'v2' }).map((m) => m.id)).toEqual(['leads']);
    expect(selectMemories(org, rows, { ...leads, group: { ...leads.kind === 'group' ? leads.group : org.getGroup('leads')!, hasGuests: true } }, { query: 'budget', now: NOW, mode: 'v2' })).toEqual([]);
  });
  it('sensitive records appear only in the owner\'s 1:1', () => {
    const secret = rec({ id: 'secret', content: 'budget worry', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'personal' });
    const shared = rec({ id: 'secret-g', content: 'budget worry', scope: { kind: 'group', groupId: 'leads' }, sensitivity: 'confidential' });
    expect(selectMemories(org, [secret, shared], reza, { query: 'budget', now: NOW, mode: 'v2' }).map((m) => m.id)).toEqual(['secret']);
    expect(selectMemories(org, [secret, shared], sina, { query: 'budget', now: NOW, mode: 'v2' })).toEqual([]);
    expect(selectMemories(org, [secret, shared], leads, { query: 'budget', now: NOW, mode: 'v2' })).toEqual([]);
  });
});

describe('v2 purity', () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !(value instanceof Date)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  }
  it('leaves deep-frozen inputs unchanged and returns the same object references', () => {
    const rows = deepFreeze([rec({ id: 'a', content: 'x'.repeat(500) + ' budget', embedding: [1, 0] }), rec({ id: 'b', content: 'budget plan' })]);
    const snapshot = JSON.stringify(rows);
    const out = selectMemories(org, rows, reza, { query: 'budget', now: NOW, mode: 'v2', queryEmbedding: [1, 0] });
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(out).toHaveLength(2);
    for (const m of out) expect(rows).toContain(m);
    expect(out.find((m) => m.id === 'a')!.content).toHaveLength(507);
  });
});

describe('ActiveMemoryCache', () => {
  const NEW = { personaId: 'aria', content: 'budget fresh', type: 'fact' as const, scope: { kind: 'org' as const }, sensitivity: 'normal' as const,
    source: { personId: 'reza', chatKind: 'private' as const, at }, aboutPersonIds: [], confidence: 0.9, authorizedPersonIds: PEOPLE };

  it('hits for the same (persona, revision, set) and misses on a revision change', () => {
    const cache = new ActiveMemoryCache();
    const rows = many(5);
    const first = cache.features('aria', 1, rows);
    expect(cache.features('aria', 1, [...rows].reverse())).toBe(first);
    expect(cache.stats).toEqual({ hits: 1, misses: 1 });
    cache.features('aria', 2, rows);
    expect(cache.stats.misses).toBe(2);
  });

  it('add() without a revision bump misses via the fingerprint; update() misses', async () => {
    const cache = new ActiveMemoryCache();
    const store = new InMemoryMemoryStore();
    const first = await store.add(NEW);
    cache.features('aria', await store.safetyRevision('aria'), await store.listActive('aria'));
    const revision = await store.safetyRevision('aria');
    await store.add({ ...NEW, content: 'another', source: { ...NEW.source, eventIds: ['e2'] } });
    expect(await store.safetyRevision('aria')).toBe(revision);
    const after = cache.features('aria', revision, await store.listActive('aria'));
    expect(after!.size).toBe(2);
    expect(cache.stats).toEqual({ hits: 0, misses: 2 });
    cache.features('aria', revision, await store.listActive('aria'));
    expect(cache.stats.hits).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.update(first.id, { content: 'budget fresh!' });
    cache.features('aria', revision, await store.listActive('aria'));
    expect(cache.stats.misses).toBe(3);
  });

  it('returns null above maxRecords or for mixed personas, and selectMemories still works', () => {
    const cache = new ActiveMemoryCache();
    const rows = many(301);
    expect(cache.features('aria', 0, rows)).toBeNull();
    expect(cache.features('aria', 0, [rec({ content: 'a' }), rec({ content: 'b', personaId: 'other' })])).toBeNull();
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW, mode: 'v2' })).toHaveLength(8);
  });

  it('evicts least-recently-used personas beyond maxPersonas', () => {
    const cache = new ActiveMemoryCache({ maxPersonas: 2 });
    const set = (p: string) => [rec({ id: `${p}-1`, content: 'x', personaId: p })];
    cache.features('a', 0, set('a'));
    cache.features('b', 0, set('b'));
    cache.features('a', 0, set('a'));
    cache.features('c', 0, set('c'));
    expect(cache.stats).toEqual({ hits: 1, misses: 3 });
    cache.features('a', 0, set('a'));
    expect(cache.stats.hits).toBe(2);
    cache.features('b', 0, set('b'));
    expect(cache.stats.misses).toBe(4);
    cache.invalidate('a');
    cache.features('a', 0, set('a'));
    expect(cache.stats.misses).toBe(5);
    cache.clear();
    expect(cache.stats).toEqual({ hits: 0, misses: 0 });
  });

  it('an owner-warmed cache gives an outsider zero invisible rows', () => {
    const rows = [
      rec({ id: 'reza-private', content: 'budget secret plan', scope: { kind: 'private', personId: 'reza' } }),
      rec({ id: 'reza-personal', content: 'budget worry', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'personal' }),
      rec({ id: 'leads-only', content: 'budget leads', scope: { kind: 'group', groupId: 'leads' } }),
      rec({ id: 'everyone', content: 'office hours' }),
    ];
    expect(selectMemories(org, rows, reza, { query: 'budget', now: NOW, mode: 'v2' })).toHaveLength(4);
    const hits = activeMemoryCache.stats.hits;
    expect(selectMemories(org, rows, sina, { query: 'budget', now: NOW, mode: 'v2' }).map((m) => m.id)).toEqual(['everyone']);
    expect(activeMemoryCache.stats.hits).toBe(hits + 1);
  });
});

function guestOrg() {
  const config = testOrgConfig();
  config.people.push({ id: 'guest-ali', name: 'Ali', role: 'Guest', telegramUserId: 9101, companyIds: [], projectIds: [], guest: true });
  config.groups.push({ id: 'lobby', name: 'Lobby', telegramChatId: -100900, memberIds: ['reza', 'guest-ali'] });
  return new OrgDirectory(config);
}

describe('allowedScopeKeys', () => {
  const g = guestOrg();
  it('member: private, groups, org, projects, companies and people sets from memories', () => {
    const people = rec({ content: 'x', scope: { kind: 'people', personIds: ['reza', 'parastoo'] } });
    const notMine = rec({ content: 'x', scope: { kind: 'people', personIds: ['milad', 'parastoo'] } });
    expect(allowedScopeKeys(g, reza, [people, notMine])).toEqual(['company:ludaxis', 'group:gameend-team', 'group:leads', 'group:lobby', 'org', 'people:parastoo,reza', 'private:reza', 'project:gameend'].sort());
  });
  it('guest: only private and own groups; unknown person: none', () => {
    expect(allowedScopeKeys(g, { kind: 'private', chatKey: 'x', personId: 'guest-ali' })).toEqual(['group:lobby', 'private:guest-ali']);
    expect(allowedScopeKeys(g, { kind: 'private', chatKey: 'x', personId: 'nobody' })).toEqual([]);
  });
  it('group: its own key; hasGuests group: none', () => {
    expect(allowedScopeKeys(g, leads)).toEqual(['group:leads']);
    expect(allowedScopeKeys(g, { kind: 'group', chatKey: 'l', group: { ...g.getGroup('lobby')!, hasGuests: true } })).toEqual([]);
  });
});

describe('vectorCandidates', () => {
  const lots = Array.from({ length: 39 }, (_, i) => rec({ content: 'x', scope: { kind: 'people', personIds: ['reza', `p${String(i).padStart(2, '0')}`] } }));
  beforeEach(() => { vi.stubEnv('TIREH_RETRIEVAL_V2', '1'); vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1'); });

  it('flag off gives [] with zero store calls', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', undefined);
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', undefined);
    const findNearest = vi.fn(async () => [rec({ content: 'x' })]);
    expect(await vectorCandidates({ findNearest }, org, reza, 'aria', [1, 0])).toEqual([]);
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    expect(await vectorCandidates({ findNearest }, org, reza, 'aria', [1, 0])).toEqual([]);
    expect(findNearest).not.toHaveBeenCalled();
  });

  it('chunks 45 keys into 2 calls of at most 30 and merges duplicates', async () => {
    const dup = rec({ id: 'dup', content: 'x' });
    const findNearest = vi.fn<FindNearest>(async (_p, keys) => [dup, rec({ id: `only-${keys.length}`, content: 'y' })]);
    const out = await vectorCandidates({ findNearest }, org, reza, 'aria', [1, 0], { memories: lots });
    expect(findNearest).toHaveBeenCalledTimes(2);
    expect(findNearest.mock.calls.map((c) => c[1].length)).toEqual([30, 15]);
    expect(findNearest.mock.calls[0][3]).toBe(40);
    expect(out.map((m) => m.id)).toEqual(['dup', 'only-30', 'only-15']);
  });

  it('a throwing store or a store without findNearest gives []', async () => {
    const findNearest = vi.fn(async () => { throw new Error('index missing'); });
    expect(await vectorCandidates({ findNearest }, org, reza, 'aria', [1, 0])).toEqual([]);
    expect(await vectorCandidates({}, org, reza, 'aria', [1, 0])).toEqual([]);
  });

  it('no keys means no call', async () => {
    const findNearest = vi.fn(async () => []);
    expect(await vectorCandidates({ findNearest }, org, { kind: 'private', chatKey: 'x', personId: 'nobody' }, 'aria', [1, 0])).toEqual([]);
    expect(findNearest).not.toHaveBeenCalled();
  });

  it('candidates still go through the final gate', async () => {
    const leak = rec({ id: 'leak', content: 'budget', scope: { kind: 'private', personId: 'parastoo' } });
    const findNearest = vi.fn<FindNearest>(async () => [leak]);
    const candidates = await vectorCandidates({ findNearest }, org, sina, 'aria', [1, 0], { limit: 5 });
    expect(candidates).toHaveLength(1);
    expect(findNearest.mock.calls[0][3]).toBe(5);
    expect(selectMemories(org, candidates, sina, { query: 'budget', now: NOW } as RetrievalOptions)).toEqual([]);
  });
});
