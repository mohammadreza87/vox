/**
 * Select the memories a persona may use in a conversation, most relevant first.
 *
 * v1 is the original scorer, unchanged. v2 (TIREH_RETRIEVAL_V2=1, or an
 * explicit `mode: 'v2'`) adds Persian-aware tokenisation, reciprocal-rank
 * fusion of lexical and cosine ranks, recency/importance rescoring, distractor
 * suppression and a default of MAX_PROMPT_MEMORIES; see
 * docs/AGENT_INTELLIGENCE_SOLUTION.md 4.4. In both modes the code visibility
 * rule (isMemoryAllowedInChat) is the authority: indexes and caches only
 * narrow or speed up candidate generation.
 */

import { createHash } from 'crypto';
import type { ChatContext, MemoryRecord } from '../types';
import type { OrgDirectory } from '../org/directory';
import { tirehFlags } from '../flags';
import { audienceOf, hasGuestAudience, isMemoryAllowedInChat, scopeKey } from './visibility';
import { contentHash, memoryV2 } from './record-v2';
import { cosine } from './embeddings';
import type { MemoryStore } from './store';

export const MAX_PROMPT_MEMORIES = 8;
export const NEAR_DUPLICATE_COSINE = 0.92;
export const RRF_K = 60;
export const LONG_MEMORY_CHARS = 210;
export const ACTIVE_CACHE_MAX_RECORDS = 300;
export const VECTOR_CANDIDATE_LIMIT = 40;
export const MAX_SCOPE_KEYS_PER_QUERY = 30;

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

export interface RetrievalOptions {
  query: string;
  limit?: number;
  now?: Date;
  /** Defaults to 'v2' when TIREH_RETRIEVAL_V2=1 (read at call time), otherwise 'v1'. */
  mode?: 'v1' | 'v2';
  /** v2 only: query embedding for the semantic rank; ignored by v1. */
  queryEmbedding?: readonly number[];
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

/** The base scorer (6d00b80), kept verbatim. */
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

// ============================================
// v2: Persian-aware tokenisation
// ============================================

const ARABIC_LETTER_MAP: Readonly<Record<string, string>> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',
  'ك': 'ک',
  'ة': 'ه',
  'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', 'آ': 'ا',
  'ؤ': 'و',
};
const ARABIC_LETTERS = /[يىئكةأإٱآؤ]/g;
// Combining marks (harakat, hamza above U+0654), tatweel, ZWJ, LRM, RLM, BOM. ZWNJ is handled separately.
const REMOVED = /[\p{M}ـ‍‎‏﻿]/gu;
const ZWNJ = '‌';
const ZWNJ_PREFIX = /^(ن?می)‌/;
const ZWNJ_SUFFIX = /‌(هایشان|هایمان|هایتان|هایی|های|ها|ترین|تر|ام|ات|اش|ای|اند)$/;
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const DIGITS = /^\p{N}+$/u;

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(ARABIC_LETTERS, (c) => ARABIC_LETTER_MAP[c] ?? c)
    .replace(REMOVED, '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const EN_STOP = new Set([
  ...STOPWORDS,
  'the', 'and', 'for', 'are', 'was', 'you', 'our', 'has', 'had', 'how', 'why', 'who', 'can', 'did', 'does', 'not', 'but', 'please',
]);

const FA_STOP = new Set([
  'از', 'به', 'در', 'را', 'و', 'با', 'که', 'این', 'آن', 'است', 'بود', 'شد', 'هم', 'یا', 'تا', 'برای', 'چه', 'چی', 'کی',
  'کجا', 'چرا', 'چطور', 'من', 'تو', 'او', 'ما', 'شما', 'آنها', 'ایشان', 'یک', 'می', 'نمی', 'هست', 'نیست', 'باید', 'شده',
  'کرد', 'کرده', 'کن', 'کند', 'میشه', 'دیگه', 'رو', 'اون', 'ها', 'های', 'بر', 'اما', 'اگر', 'پس', 'نه', 'هر', 'همه',
  'چند', 'خیلی', 'ولی', 'چون', 'وقتی', 'همین', 'همان', 'الان', 'فقط', 'هنوز', 'بله', 'آره', 'شه', 'دارد', 'داره', 'هستند',
  'بودند', 'کنیم', 'کنم', 'چیه', 'کیه', 'کدام', 'کدوم', 'درباره', 'مورد',
].map(normalizeText));

function keepToken(token: string): boolean {
  if (EN_STOP.has(token) || FA_STOP.has(token)) return false;
  if (DIGITS.test(token)) return token.length >= 2;
  if (ARABIC_SCRIPT.test(token)) return token.length >= 2;
  return token.length >= 3;
}

/** Arabic-script stems for a token written without ZWNJ, e.g. کتابها → کتاب, میرود → رود. */
function arabicStems(token: string): string[] {
  const stems: string[] = [];
  if (token.length >= 5) {
    if (token.endsWith('های')) stems.push(token.slice(0, -3));
    else if (token.endsWith('ها')) stems.push(token.slice(0, -2));
  }
  if (token.startsWith('نمی') && token.length - 3 >= 3) stems.push(token.slice(3));
  else if (token.startsWith('می') && token.length - 2 >= 3) stems.push(token.slice(2));
  return stems;
}

/**
 * Persian-aware terms, unique, in first-seen order (v2 only). Words are the
 * runs of letters, digits and ZWNJ; ZWNJ affixes are stripped before joining.
 */
export function tokenize(text: string): string[] {
  const out = new Set<string>();
  const add = (t: string) => { if (t && keepToken(t)) out.add(t); };
  for (const raw of normalizeText(text).match(/[\p{L}\p{N}‌]+/gu) ?? []) {
    const hadZwnj = raw.includes(ZWNJ);
    const word = hadZwnj ? raw.replace(ZWNJ_PREFIX, '').replace(ZWNJ_SUFFIX, '').split(ZWNJ).join('') : raw;
    for (const token of word.split(/[^\p{L}\p{N}]+/u)) {
      if (!token) continue;
      add(token);
      if (ARABIC_SCRIPT.test(token)) {
        if (!hadZwnj) arabicStems(token).forEach(add);
      } else if (!DIGITS.test(token) && token.length >= 5 && token.endsWith('s') && !token.endsWith('ss')) {
        add(token.slice(0, -1));
      }
    }
  }
  return [...out];
}

/** FNV-1a 32-bit; terms are cached and compared only as these numbers. */
function hashTerm(term: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < term.length; i++) {
    hash ^= term.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// ============================================
// v2: derived-feature cache
// ============================================

/** Derived, content-free features of one record. Never visibility decisions. */
export interface MemoryFeatures {
  readonly updatedAtMs: number;
  readonly terms: ReadonlySet<number>;
  readonly termCount: number;
  readonly contentHash: string;
  readonly embeddingNorm?: number;
}

function computeFeatures(m: MemoryRecord): MemoryFeatures {
  const terms = new Set(tokenize(`${m.content} ${m.topic ?? ''}`).map(hashTerm));
  const features: { -readonly [K in keyof MemoryFeatures]: MemoryFeatures[K] } = {
    updatedAtMs: m.updatedAt.getTime(),
    terms,
    termCount: terms.size,
    contentHash: typeof m.contentHash === 'string' && m.contentHash ? m.contentHash : contentHash(m.content),
  };
  if (Array.isArray(m.embedding) && m.embedding.length) {
    features.embeddingNorm = Math.sqrt(m.embedding.reduce((sum, v) => sum + v * v, 0));
  }
  return features;
}

interface CacheEntry {
  revision: number | undefined;
  fingerprint: string;
  expiresAt: number;
  features: ReadonlyMap<string, MemoryFeatures>;
}

function fingerprintOf(memories: readonly MemoryRecord[]): string {
  const pairs = memories.map((m) => `${m.id}:${m.updatedAt.getTime()}`).sort();
  return createHash('sha256').update(pairs.join('\n')).digest('hex');
}

/**
 * In-process cache of derived retrieval features per persona, keyed by
 * (personaId, safetyRevision) and an id+updatedAt fingerprint, since a plain
 * add() never bumps safetyRevision. Holds ids, timestamps, hashes and numeric
 * term hashes only: no content, topic, query or authorization result. Bounded
 * by an LRU of personas and a TTL; never logged or persisted.
 */
export class ActiveMemoryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxPersonas: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { maxPersonas?: number; ttlMs?: number; now?: () => number } = {}) {
    this.maxPersonas = options.maxPersonas ?? 64;
    this.ttlMs = options.ttlMs ?? 600_000;
    this.now = options.now ?? Date.now;
  }

  /** Derived features only, never visibility decisions or text; null when > ACTIVE_CACHE_MAX_RECORDS or mixed personas. */
  features(personaId: string, safetyRevision: number | undefined, memories: readonly MemoryRecord[]): ReadonlyMap<string, MemoryFeatures> | null {
    if (memories.length > ACTIVE_CACHE_MAX_RECORDS || memories.some((m) => m.personaId !== personaId)) return null;
    if (new Set(memories.map((m) => m.id)).size !== memories.length) return null;
    const fingerprint = fingerprintOf(memories);
    const now = this.now();
    const hit = this.entries.get(personaId);
    this.entries.delete(personaId);
    if (hit && hit.revision === safetyRevision && hit.fingerprint === fingerprint && hit.expiresAt > now) {
      this.entries.set(personaId, hit);
      return hit.features;
    }
    const features = new Map(memories.map((m) => [m.id, computeFeatures(m)] as const));
    this.entries.set(personaId, { revision: safetyRevision, fingerprint, expiresAt: now + this.ttlMs, features });
    while (this.entries.size > this.maxPersonas) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return features;
  }

  clear(personaId?: string): void {
    if (personaId === undefined) this.entries.clear();
    else this.entries.delete(personaId);
  }

  get size(): number {
    return this.entries.size;
  }
}

const defaultCache = new ActiveMemoryCache();

// ============================================
// v2: fused ranking
// ============================================

interface Ranked { memory: MemoryRecord; value: number }

function byValueThenRecency(a: Ranked, b: Ranked): number {
  return b.value - a.value || b.memory.updatedAt.getTime() - a.memory.updatedAt.getTime() ||
    (a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0);
}

function sameEmbeddingSpace(a: MemoryRecord, b: MemoryRecord): boolean {
  return Array.isArray(a.embedding) && Array.isArray(b.embedding) && a.embedding.length > 0 &&
    a.embedding.length === b.embedding.length &&
    a.embeddingModel === b.embeddingModel && a.embeddingVersion === b.embeddingVersion;
}

/** Pure: never mutates inputs; returns input references. */
function selectMemoriesV2(org: OrgDirectory, memories: MemoryRecord[], chat: ChatContext, options: RetrievalOptions): MemoryRecord[] {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const audience = audienceOf(chat);
  const inConversation = (m: MemoryRecord) =>
    chat.kind !== 'group' ||
    (m.scope.kind === 'group' && m.scope.groupId === chat.group.id);
  const gate = (m: MemoryRecord) => inConversation(m) && isMemoryAllowedInChat(org, m, chat);

  const replaced = new Set<string>();
  for (const m of memories) if (m.supersedes && m.supersedes !== m.id) replaced.add(m.supersedes);

  const candidates = memories.filter((m) => {
    if (!gate(m) || m.supersededBy || replaced.has(m.id)) return false;
    const v2 = memoryV2(m);
    if (v2.invalidatedAt && v2.invalidatedAt.getTime() <= nowMs) return false;
    if (v2.expiresAt && v2.expiresAt.getTime() <= nowMs) return false;
    return true;
  });
  if (candidates.length === 0) return [];

  const cached = defaultCache.features(candidates[0].personaId, undefined, candidates);
  const features = new Map<MemoryRecord, MemoryFeatures>(
    candidates.map((m) => [m, cached?.get(m.id) ?? computeFeatures(m)]),
  );

  // Lexical rank.
  const queryTerms = new Set(tokenize(options.query).map(hashTerm));
  const lexical: Ranked[] = [];
  for (const m of candidates) {
    const f = features.get(m)!;
    let overlap = 0;
    for (const t of f.terms) if (queryTerms.has(t)) overlap++;
    const value = overlap / Math.sqrt(Math.max(1, f.termCount));
    if (value > 0) lexical.push({ memory: m, value });
  }
  lexical.sort(byValueThenRecency);

  // Semantic rank, only with a query embedding.
  const queryEmbedding = options.queryEmbedding;
  const lists = queryEmbedding && queryEmbedding.length > 0 ? 2 : 1;
  const semantic: Ranked[] = [];
  if (queryEmbedding && lists === 2) {
    for (const m of candidates) {
      if (m.sensitivity !== 'normal' || m.embedding?.length !== queryEmbedding.length) continue;
      const value = cosine(m.embedding, queryEmbedding);
      if (value > 0) semantic.push({ memory: m, value });
    }
    semantic.sort(byValueThenRecency);
  }

  // Reciprocal-rank fusion, normalised to [0, 1].
  const rrf = new Map<MemoryRecord, number>();
  for (const list of [lexical, semantic]) {
    list.forEach((entry, index) => rrf.set(entry.memory, (rrf.get(entry.memory) ?? 0) + 1 / (RRF_K + index + 1)));
  }
  const maxRrf = lists / (RRF_K + 1);

  const scored: Ranked[] = candidates.map((m) => {
    const v2 = memoryV2(m);
    const relevance = (rrf.get(m) ?? 0) / maxRrf;
    const since = (v2.lastRetrievedAt ?? m.updatedAt).getTime();
    const days = Math.max(0, (nowMs - since) / 86_400_000);
    const aboutAudience = m.aboutPersonIds.some((id) => audience.includes(id)) ? 1 : 0;
    const typeBoost = m.type === 'decision' ? 0.5 : m.type === 'relationship' ? 0.3 : 0;
    const statusBoost = v2.status === 'confirmed' ? 0.25 : v2.status === 'disputed' ? -0.25 : 0;
    const longPenalty = m.content.length > LONG_MEMORY_CHARS ? 0.25 : 0;
    const value = 4 * relevance + Math.exp(-0.1 * days) + v2.importance / 10 + aboutAudience + typeBoost +
      statusBoost + 0.5 * m.confidence - longPenalty;
    return { memory: m, value };
  });
  scored.sort(byValueThenRecency);

  // Distractor suppression in rank order.
  const limit = Math.max(0, options.limit ?? MAX_PROMPT_MEMORIES);
  const kept: MemoryRecord[] = [];
  const keptHashes = new Set<string>();
  for (const { memory } of scored) {
    if (kept.length >= limit) break;
    const hash = features.get(memory)!.contentHash;
    if (keptHashes.has(hash)) continue;
    if (kept.some((k) => sameEmbeddingSpace(k, memory) && cosine(k.embedding!, memory.embedding!) > NEAR_DUPLICATE_COSINE)) continue;
    kept.push(memory);
    keptHashes.add(hash);
  }
  // Final gate: the code rule is the authority, whatever ranked the list.
  return kept.slice(0, limit).filter(gate);
}

// ============================================
// v2: vector candidates (Firestore findNearest)
// ============================================

/**
 * Scope keys every reader of this chat may see, for a findNearest pre-filter.
 * Group chats with guests or unknown readers get none. People scopes are not
 * enumerable (any set containing the reader) and personal/confidential
 * records are never embedded, so both are served only by the in-process
 * path: a caller must always union these candidates with listActive.
 */
export function audienceScopeKeys(org: OrgDirectory, chat: ChatContext): string[] {
  if (audienceOf(chat).some((id) => !org.getPerson(id))) return [];
  if (chat.kind === 'group') {
    return hasGuestAudience(org, chat) ? [] : [scopeKey({ kind: 'group', groupId: chat.group.id })];
  }
  const personId = chat.personId;
  const person = org.getPerson(personId)!;
  const keys = [scopeKey({ kind: 'private', personId })];
  for (const group of org.config.groups) {
    if (org.isGroupMember(personId, group.id)) keys.push(scopeKey({ kind: 'group', groupId: group.id }));
  }
  if (!person.guest) {
    for (const project of org.listProjectsFor(personId)) keys.push(scopeKey({ kind: 'project', projectId: project.id }));
    for (const companyId of person.companyIds) keys.push(scopeKey({ kind: 'company', companyId }));
    keys.push(scopeKey({ kind: 'org' }));
  }
  return [...new Set(keys)].sort();
}

/**
 * Nearest-neighbour CANDIDATES from the store's vector index (Firestore only),
 * behind TIREH_VECTOR_RETRIEVAL=1 (which needs TIREH_RETRIEVAL_V2=1). Returns
 * [] on any store error (for example a missing index) so the caller falls back
 * to lexical retrieval. This is never a visibility decision: the caller must
 * union the result with listActive() and pass it through selectMemories.
 * Not wired into the gateway yet (TODO Step 5/7).
 */
export async function vectorCandidates(
  store: Pick<MemoryStore, 'findNearest'>,
  org: OrgDirectory,
  personaId: string,
  chat: ChatContext,
  queryEmbedding: readonly number[],
  options?: { limit?: number; env?: NodeJS.ProcessEnv },
): Promise<MemoryRecord[]> {
  if (!tirehFlags(options?.env).vectorRetrieval) return [];
  if (typeof store.findNearest !== 'function' || queryEmbedding.length === 0) return [];
  const keys = audienceScopeKeys(org, chat);
  if (keys.length === 0) return [];
  const limit = options?.limit ?? VECTOR_CANDIDATE_LIMIT;
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += MAX_SCOPE_KEYS_PER_QUERY) chunks.push(keys.slice(i, i + MAX_SCOPE_KEYS_PER_QUERY));
  try {
    const results = await Promise.all(chunks.map((chunk) => store.findNearest!(personaId, chunk, [...queryEmbedding], limit)));
    const byId = new Map<string, MemoryRecord>();
    for (const row of results.flat()) {
      if (row.personaId === personaId && !row.supersededBy && !byId.has(row.id)) byId.set(row.id, row);
    }
    return [...byId.values()];
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
