/**
 * Select the memories a persona may use in a conversation, most relevant first.
 *
 * v1 (default) is the original lexical scorer, unchanged. v2 (TIREH_RETRIEVAL_V2=1,
 * docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.4) adds Persian-aware tokens,
 * reciprocal-rank fusion of lexical and cosine ranks, rescoring, suppression of
 * near-duplicate, superseded, invalidated and expired records, and re-applies
 * the visibility rules as the final gate. Caches hold derived features only,
 * never visibility decisions; nothing here logs.
 */

import { createHash } from 'crypto';
import type { ChatContext, MemoryRecord } from '../types';
import type { OrgDirectory } from '../org/directory';
import { tirehFlags } from '../flags';
import { audienceOf, isMemoryAllowedInChat, scopeKey } from './visibility';
import { contentHash, isExpired, isInvalidated, memoryV2 } from './record-v2';
import type { MemoryStore } from './store';

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'from', 'have', 'just', 'like', 'more',
  'should', 'some', 'that', 'than', 'their', 'them', 'then', 'there', 'they', 'this', 'what',
  'when', 'where', 'which', 'will', 'with', 'would', 'your',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 3 && !STOPWORDS.has(t))
  );
}

export const MAX_PROMPT_MEMORIES = 8;
export const NEAR_DUPLICATE_COSINE = 0.92;
export const RRF_K = 60;
export const MIN_VECTOR_COSINE = 0.2;
export const RELEVANCE_WEIGHT = 3;
export const IN_PROCESS_MAX_RECORDS = 300;
export const MAX_VECTOR_SCOPE_KEYS = 30;
export const VECTOR_CANDIDATE_LIMIT = 40;
export const UNKNOWN_REVISION = -1;

export interface RetrievalOptions {
  query: string;
  limit?: number;
  now?: Date;
  /** Explicit mode; otherwise TIREH_RETRIEVAL_V2=1 selects v2. */
  mode?: 'v1' | 'v2';
  /** v2 only: the query's embedding, for the cosine rank. */
  queryEmbedding?: readonly number[];
}

function selectMemoriesV1(
  org: OrgDirectory,
  memories: MemoryRecord[],
  chat: ChatContext,
  { query, limit = 20, now = new Date() }: RetrievalOptions
): MemoryRecord[] {
  const audience = audienceOf(chat);
  const queryTokens = tokens(query);

  // Group membership does not grant permission to move knowledge from a DM,
  // another group or a project into this conversation.
  const inConversation = (m: MemoryRecord) =>
    chat.kind !== 'group' ||
    (m.scope.kind === 'group' && m.scope.groupId === chat.group.id);

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

export function selectMemories(
  org: OrgDirectory,
  memories: MemoryRecord[],
  chat: ChatContext,
  options: RetrievalOptions
): MemoryRecord[] {
  const mode = options.mode ?? (tirehFlags().retrievalV2 ? 'v2' : 'v1');
  return mode === 'v2' ? selectMemoriesV2(org, memories, chat, options) : selectMemoriesV1(org, memories, chat, options);
}

// ============================================
// v2 TOKENIZER (Persian-aware)
// ============================================

const ARABIC_SCRIPT_MAP: Readonly<Record<string, string>> = {
  '\u064A': '\u06CC', '\u0649': '\u06CC',           // ي ى -> ی
  '\u0643': '\u06A9',                               // ك -> ک
  '\u0629': '\u0647', '\u06C0': '\u0647',           // ة ۀ -> ه
  '\u0623': '\u0627', '\u0625': '\u0627', '\u0671': '\u0627', '\u0622': '\u0627', // أ إ ٱ آ -> ا
  '\u0624': '\u0648',                               // ؤ -> و
  '\u0626': '\u06CC',                               // ئ -> ی
};

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064A\u0649\u0643\u0629\u06C0\u0623\u0625\u0671\u0622\u0624\u0626]/g, (c) => ARABIC_SCRIPT_MAP[c] ?? c)
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u064B-\u065F\u0670\u0640\u200E\u200F]/g, '')
    .replace(/[\u200C\u200D\u00A0]/g, ' ');
}

const FA_STOPWORDS: ReadonlySet<string> = new Set(
  ('و در به از که این آن با را برای تا هم یا اما ولی اگر چه چی است هست نیست بود شد شده شود می نمی ها های یک من تو او ما شما آنها خود دیگر همه هر بر پس نیز کرد کند کنم کنیم باشد دارد داره هستم بودم چون چرا کجا کی چطور چند ای ی باید ام اش مان تان شان رو خب آیا')
    .split(' ')
    .map(normalizeText),
);

const EN_STOPWORDS: ReadonlySet<string> = new Set([
  ...STOPWORDS,
  'the', 'and', 'for', 'are', 'was', 'were', 'has', 'had', 'not', 'but', 'can', 'could', 'did', 'does', 'how', 'who', 'why',
  'you', 'our', 'its', 'into', 'over', 'any', 'all', 'she', 'his', 'her', 'him', 'they', 'them', 'we', 'me', 'my',
]);

const FA_SUFFIXES = ['هایی', 'های', 'ها'];
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const DIGIT = /\p{Nd}/u;

/** Persian-aware tokens, v2 only. Deduplicated in first-occurrence order. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of normalizeText(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    let token = raw;
    if (DIGIT.test(token)) {
      // numbers and codes are kept at any length
    } else if (ARABIC_SCRIPT.test(token)) {
      if (token.length < 2 || FA_STOPWORDS.has(token)) continue;
      if (token.length >= 5) {
        const suffix = FA_SUFFIXES.find((s) => token.endsWith(s) && token.length - s.length >= 3);
        if (suffix) token = token.slice(0, -suffix.length);
      }
    } else {
      if (token.length < 3 || EN_STOPWORDS.has(token)) continue;
      if (token.length >= 5 && token.endsWith('s') && !/(ss|us|is)$/.test(token)) token = token.slice(0, -1);
    }
    if (!seen.has(token)) { seen.add(token); out.push(token); }
  }
  return out;
}

// ============================================
// v2 FEATURES AND CACHE
// ============================================

export interface MemoryFeatures {
  readonly tokens: ReadonlySet<string>;
  readonly approxTokens: number;
  readonly contentHash: string;
  readonly vector?: Float32Array;
}

function featuresOf(m: MemoryRecord): MemoryFeatures {
  const vector = Array.isArray(m.embedding) && m.embedding.length > 0 && m.embedding.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? Float32Array.from(m.embedding)
    : undefined;
  return {
    tokens: new Set(tokenize(`${m.content} ${m.topic ?? ''}`)),
    // chars / 3.5, the same approximation S03 uses; not a billing count.
    approxTokens: Math.ceil(m.content.length / 3.5),
    contentHash: m.contentHash ?? contentHash(m.content),
    vector,
  };
}

function fingerprint(memories: readonly MemoryRecord[]): string {
  const lines = [...memories]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((m) => `${m.id}|${m.updatedAt.getTime()}|${m.content.length}|${m.embeddingVersion ?? 0}|${m.embedding?.length ?? 0}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

interface CacheEntry { revision: number; fingerprint: string; features: ReadonlyMap<string, MemoryFeatures> }

/**
 * In-process feature cache for the file profile and small personas, keyed by
 * (personaId, safetyRevision) plus an id/updatedAt fingerprint: add() never
 * bumps safetyRevision, so the fingerprint is what notices new rows. Derived
 * features only, never visibility decisions, audiences or query results.
 */
export class ActiveMemoryCache {
  readonly stats = { hits: 0, misses: 0 };
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxPersonas: number;
  private readonly maxRecords: number;

  constructor(options: { maxPersonas?: number; maxRecords?: number } = {}) {
    this.maxPersonas = options.maxPersonas ?? 16;
    this.maxRecords = options.maxRecords ?? IN_PROCESS_MAX_RECORDS;
  }

  /** null when the set exceeds maxRecords or mixes personas (no caching). */
  features(personaId: string, safetyRevision: number, memories: readonly MemoryRecord[]): ReadonlyMap<string, MemoryFeatures> | null {
    if (memories.length > this.maxRecords || memories.some((m) => m.personaId !== personaId)) return null;
    const print = fingerprint(memories);
    const entry = this.entries.get(personaId);
    if (entry && entry.revision === safetyRevision && entry.fingerprint === print) {
      this.stats.hits++;
      this.entries.delete(personaId);
      this.entries.set(personaId, entry);
      return entry.features;
    }
    this.stats.misses++;
    const features = new Map<string, MemoryFeatures>();
    for (const m of memories) features.set(m.id, featuresOf(m));
    this.entries.delete(personaId);
    this.entries.set(personaId, { revision: safetyRevision, fingerprint: print, features });
    while (this.entries.size > this.maxPersonas) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return features;
  }

  invalidate(personaId?: string): void {
    if (personaId === undefined) this.entries.clear();
    else this.entries.delete(personaId);
  }

  clear(): void {
    this.entries.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }
}

export const activeMemoryCache = new ActiveMemoryCache();

function vectorCosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return Math.min(1, Math.max(-1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
}

const byId = (a: MemoryRecord, b: MemoryRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function selectMemoriesV2(
  org: OrgDirectory,
  memories: MemoryRecord[],
  chat: ChatContext,
  { query, limit, now = new Date(), queryEmbedding }: RetrievalOptions
): MemoryRecord[] {
  const audience = audienceOf(chat);
  const inConversation = (m: MemoryRecord) =>
    chat.kind !== 'group' ||
    (m.scope.kind === 'group' && m.scope.groupId === chat.group.id);

  // (a) Visibility first, then invalidated, expired and superseded records.
  const allowed = memories.filter((m) => inConversation(m) && isMemoryAllowedInChat(org, m, chat) && !isInvalidated(m, now) && !isExpired(m, now));
  const replaced = new Set(allowed.flatMap((m) => (m.supersedes && m.supersedes !== m.id ? [m.supersedes] : [])));
  const visible = allowed.filter((m) => !replaced.has(m.id));
  if (visible.length === 0) return [];

  const personaId = memories[0]?.personaId;
  const cached = personaId !== undefined ? activeMemoryCache.features(personaId, UNKNOWN_REVISION, memories) : null;
  const local = new Map<string, MemoryFeatures>();
  const feature = (m: MemoryRecord): MemoryFeatures => {
    const hit = cached?.get(m.id) ?? local.get(m.id);
    if (hit) return hit;
    const computed = featuresOf(m);
    local.set(m.id, computed);
    return computed;
  };

  // (b) Lexical rank.
  const qTokens = new Set(tokenize(query));
  const overlap = new Map<string, number>();
  for (const m of visible) {
    let n = 0;
    for (const t of feature(m).tokens) if (qTokens.has(t)) n++;
    if (n > 0) overlap.set(m.id, n);
  }
  const lexical = visible.filter((m) => overlap.has(m.id))
    .sort((a, b) => overlap.get(b.id)! - overlap.get(a.id)! || byId(a, b));

  // (c) Vector rank, only with a query embedding.
  const lists: MemoryRecord[][] = [lexical];
  if (queryEmbedding?.length) {
    const sims = new Map<string, number>();
    for (const m of visible) {
      const v = feature(m).vector;
      if (!v || v.length !== queryEmbedding.length) continue;
      const c = vectorCosine(v, queryEmbedding);
      if (c >= MIN_VECTOR_COSINE) sims.set(m.id, c);
    }
    lists.push(visible.filter((m) => sims.has(m.id)).sort((a, b) => sims.get(b.id)! - sims.get(a.id)! || byId(a, b)));
  }

  // (d) Reciprocal-rank fusion.
  const rrf = new Map<string, number>();
  for (const list of lists) list.forEach((m, i) => rrf.set(m.id, (rrf.get(m.id) ?? 0) + 1 / (RRF_K + i + 1)));
  const listsUsed = lists.length;

  // (e) Rescore.
  const scored = visible.map((m) => {
    const v2 = memoryV2(m);
    const f = feature(m);
    const relevance = RELEVANCE_WEIGHT * (rrf.get(m.id) ?? 0) * (RRF_K + 1) / listsUsed;
    const since = (v2.lastRetrievedAt ?? m.updatedAt).getTime();
    const days = Math.max(0, (now.getTime() - since) / 86_400_000);
    const score = relevance
      + Math.exp(-0.1 * days)
      + v2.importance / 10
      + (m.aboutPersonIds.some((id) => audience.includes(id)) ? 1 : 0)
      + (m.type === 'decision' ? 0.5 : m.type === 'relationship' ? 0.3 : 0)
      + (v2.status === 'confirmed' ? 0.25 : v2.status === 'disputed' ? -0.5 : 0)
      - 0.5 * Math.min(1, Math.max(0, (f.approxTokens - 60) / 60));
    return { m, f, score };
  });

  // (f) Deterministic order.
  scored.sort((a, b) => b.score - a.score || b.m.updatedAt.getTime() - a.m.updatedAt.getTime() || byId(a.m, b.m));

  // (g, h) Near-duplicate suppression, bounded count.
  const max = limit ?? MAX_PROMPT_MEMORIES;
  const kept: Array<{ m: MemoryRecord; f: MemoryFeatures }> = [];
  for (const entry of scored) {
    if (kept.length >= max) break;
    const duplicate = kept.some((k) => k.f.contentHash === entry.f.contentHash ||
      (!!k.f.vector && !!entry.f.vector && k.f.vector.length === entry.f.vector.length && vectorCosine(k.f.vector, entry.f.vector) > NEAR_DUPLICATE_COSINE));
    if (!duplicate) kept.push(entry);
  }

  // (i) Final gate: the code rule is the authority, whatever the ranking did.
  return kept.map((k) => k.m).filter((m) => inConversation(m) && isMemoryAllowedInChat(org, m, chat));
}

// ============================================
// FIRESTORE VECTOR CANDIDATES
// ============================================

/**
 * Scope keys that could be visible in this chat. Narrows Firestore candidates
 * only; it is never authority (selectMemories decides).
 */
export function allowedScopeKeys(org: OrgDirectory, chat: ChatContext, memories?: readonly MemoryRecord[]): string[] {
  if (chat.kind === 'group') return chat.group.hasGuests ? [] : [`group:${chat.group.id}`];
  const person = org.getPerson(chat.personId);
  if (!person) return [];
  const keys = new Set<string>([`private:${person.id}`]);
  for (const group of org.config.groups) if (group.memberIds.includes(person.id)) keys.add(`group:${group.id}`);
  if (!person.guest) {
    keys.add('org');
    for (const project of org.listProjectsFor(person.id)) keys.add(`project:${project.id}`);
    for (const companyId of person.companyIds) keys.add(`company:${companyId}`);
  }
  for (const m of memories ?? []) {
    if (m.scope.kind === 'people' && m.scope.personIds.includes(person.id)) keys.add(scopeKey(m.scope));
  }
  return [...keys].sort();
}

/**
 * Firestore findNearest candidates (TIREH_VECTOR_RETRIEVAL). Candidates must
 * still go through selectMemories. Any failure yields [] so the caller falls
 * back to in-process scoring. Not wired into the gateway in this step.
 */
export async function vectorCandidates(
  store: Pick<MemoryStore, 'findNearest'>,
  org: OrgDirectory,
  chat: ChatContext,
  personaId: string,
  queryEmbedding: readonly number[],
  options: { limit?: number; memories?: readonly MemoryRecord[] } = {},
): Promise<MemoryRecord[]> {
  if (!tirehFlags().vectorRetrieval || typeof store.findNearest !== 'function') return [];
  const keys = allowedScopeKeys(org, chat, options.memories);
  if (keys.length === 0) return [];
  try {
    const out = new Map<string, MemoryRecord>();
    for (let i = 0; i < keys.length; i += MAX_VECTOR_SCOPE_KEYS) {
      const rows = await store.findNearest(personaId, keys.slice(i, i + MAX_VECTOR_SCOPE_KEYS), [...queryEmbedding], options.limit ?? VECTOR_CANDIDATE_LIMIT);
      for (const row of rows) if (!out.has(row.id)) out.set(row.id, row);
    }
    return [...out.values()];
  } catch {
    return [];
  }
}

/** Groups of memories that share a topic and disagree, for the persona to surface */
export function findConflicts(memories: MemoryRecord[]): MemoryRecord[][] {
  const byTopic = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    if (!memory.topic) continue;
    const key = memory.topic.toLowerCase().trim();
    byTopic.set(key, [...(byTopic.get(key) ?? []), memory]);
  }
  return [...byTopic.values()].filter(
    (group) => group.length > 1 && new Set(group.map((m) => m.content.trim().toLowerCase())).size > 1
  );
}
