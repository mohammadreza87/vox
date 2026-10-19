import { createHash } from 'crypto';

/** This is a selector, never an authorization source. Callers supply only the
 * current server-authorized projection, then recheck its FULL authority receipt
 * before provider use and delivery. Caches cannot supply candidate text. */
export interface RetrievalCandidate {
  id: string;
  text: string;
  /** Only server-authored explicit preferences may receive this priority. */
  layer: 'preference' | 'summary' | 'memory';
  freshness: number;
  /** Server-authored source IDs; suppress only after a covering summary fits. */
  sourceIds?: readonly string[];
}
export interface RetrievalRequest {
  query: string;
  candidates: readonly RetrievalCandidate[];
  /** Opaque, ephemeral scope and complete current authority receipt. */
  authority?: { scope: string; revision: string };
  maxBytes?: number;
  maxItems?: number;
}
export interface RetrievalResult {
  selected: RetrievalCandidate[];
  serializedBytes: number;
  cacheHit: boolean;
  /** Content-free counters for local evaluation; nothing is emitted or stored. */
  considered: number;
  oversized: number;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const MAX_CANDIDATES = 20_000;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 16_384;
const MAX_QUERY_CHARS = 8192;
const DEFAULT_BYTES = 8192;
const DEFAULT_ITEMS = 12;
const EN_STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'and', 'in', 'on', 'it', 'what', 'my', 'for', 'please']);
const FA_STOP = new Set(['از', 'به', 'در', 'را', 'و', 'است', 'من', 'این', 'آن', 'که', 'برای', 'چیست']);
const preferencePriority = (layer: RetrievalCandidate['layer']) => Number(layer === 'preference');

/** Arabic/Persian keyboard equivalents, combining marks, joiners and digits.
 * No translation or semantic/provider calls; mixed EN/FA words stay searchable. */
export function normalizeRetrievalText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[يى]/gu, 'ی').replace(/ك/gu, 'ک')
    .replace(/[\p{M}\u0640]/gu, '').replace(/[\u200c\u200d]/gu, ' ')
    .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660));
}
function terms(text: string): string[] {
  return [...new Set(normalizeRetrievalText(text).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(term => !EN_STOP.has(term) && !FA_STOP.has(term));
}
interface CachedRanking { revision: string; createdAt: number; ids: string[] }

/** Bounded process-local LRU. Values contain opaque IDs only, never text,
 * normalized terms, queries, summaries, or a retained candidate projection. */
export class AuthorizedContextRetriever {
  private readonly cache = new Map<string, CachedRanking>();
  private readonly scopes = new Map<string, string>();
  constructor(private readonly now: () => number = Date.now, private readonly cacheLimit = 64, private readonly ttlMs = 30_000) {}

  clear(): void { this.cache.clear(); this.scopes.clear(); }
  get cacheSize(): number { return this.cache.size; }

  select(request: RetrievalRequest): RetrievalResult {
    const maxBytes = request.maxBytes ?? DEFAULT_BYTES, maxItems = request.maxItems ?? DEFAULT_ITEMS;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 2 || maxBytes > DEFAULT_BYTES ||
        !Number.isSafeInteger(maxItems) || maxItems < 0 || maxItems > DEFAULT_ITEMS) throw new Error('invalid_retrieval_budget');
    const empty = (): RetrievalResult => ({ selected: [], serializedBytes: 2, cacheHit: false, considered: 0, oversized: 0 });
    // Fail closed on an unexpected unbounded upstream projection; never silently
    // discard its tail and report ranking quality on an incomplete candidate set.
    if (request.candidates.length > MAX_CANDIDATES) return empty();
    let inputBytes = 0, oversized = 0;
    const ids = new Set<string>(), texts = new Set<string>(), candidates: RetrievalCandidate[] = [];
    // Preferences first so a duplicate saved note cannot displace its trusted row.
    for (const candidate of [...request.candidates].sort((a, b) => preferencePriority(b.layer) - preferencePriority(a.layer))) {
      inputBytes += Buffer.byteLength(candidate.text, 'utf8');
      if (inputBytes > MAX_INPUT_BYTES) return empty();
      if (!candidate.id || ids.has(candidate.id)) return empty();
      ids.add(candidate.id);
      if (Buffer.byteLength(candidate.text, 'utf8') > MAX_TEXT_BYTES) { oversized++; continue; }
      if (!candidate.text.trim() || texts.has(candidate.text)) continue;
      texts.add(candidate.text); candidates.push(candidate);
    }
    const now = this.now();
    for (const [key, cached] of this.cache) if (cached.createdAt + this.ttlMs <= now) this.cache.delete(key);
    // No cache entry may survive a new authority receipt for the same scope.
    const scope = request.authority ? hash(request.authority.scope) : undefined;
    if (scope && this.scopes.get(scope) !== request.authority!.revision) {
      for (const [key, entry] of this.cache) if (entry.revision.startsWith(`${scope}:`)) this.cache.delete(key);
      this.scopes.delete(scope); this.scopes.set(scope, request.authority!.revision);
      while (this.scopes.size > Math.max(0, this.cacheLimit)) this.scopes.delete(this.scopes.keys().next().value!);
    }
    const receipt = scope ? `${scope}:${hash(request.authority!.revision)}` : undefined;
    // Hash current content too: even an accidental unchanged revision cannot
    // replay ranks or rows after an edit. Hashes never leave this local cache.
    const key = receipt ? hash([receipt, request.query.slice(0, MAX_QUERY_CHARS), candidates]) : undefined;
    const cached = key ? this.cache.get(key) : undefined;
    let order: string[];
    if (cached) { order = cached.ids; this.cache.delete(key!); this.cache.set(key!, cached); }
    else {
      const queryTerms = terms(request.query.slice(0, MAX_QUERY_CHARS)).slice(0, 128);
      const docs = candidates.map(candidate => ({ candidate, terms: new Set(terms(candidate.text)) }));
      const frequencies = new Map(queryTerms.map(term => [term, docs.filter(doc => doc.terms.has(term)).length]));
      const ranked = docs.map(doc => ({ ...doc, score: queryTerms.reduce((sum, term) => sum + (doc.terms.has(term)
        ? 1 + Math.log(1 + docs.length / (1 + frequencies.get(term)!)) : 0), 0) }));
      order = ranked.sort((a, b) => preferencePriority(b.candidate.layer) - preferencePriority(a.candidate.layer) ||
        b.score - a.score || Number(b.candidate.layer === 'summary') - Number(a.candidate.layer === 'summary') || b.candidate.freshness - a.candidate.freshness ||
        (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0)).map(row => row.candidate.id);
      if (key && this.cacheLimit > 0) {
        this.cache.set(key, { revision: receipt!, createdAt: now, ids: order });
        while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value!);
      }
    }
    const current = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const selected: RetrievalCandidate[] = [];
    const statements = (text: string) => normalizeRetrievalText(text).split(/[.!?؛؟\n]+/u).map(part => part.replace(/\s+/gu, ' ').trim()).filter(Boolean);
    const phrases = new Map(candidates.map(candidate => [candidate.id, statements(candidate.text)]));
    // Only a verbatim whole-statement sequence proves coverage. A bag of words
    // cannot preserve negation/entity/date association. Packing comes first.
    const covers = (summary: RetrievalCandidate, source: RetrievalCandidate) => {
      if (summary.layer !== 'summary' || source.layer === 'preference' || !summary.sourceIds?.includes(source.id)) return false;
      const original = phrases.get(source.id)!, proposed = phrases.get(summary.id)!;
      return original.length > 0 && proposed.some((_, start) => original.every((statement, offset) => proposed[start + offset] === statement));
    };
    for (const id of order) {

      const candidate = current.get(id);
      if (!candidate || selected.some(summary => covers(summary, candidate))) continue;
      const retained = selected.filter(source => !covers(candidate, source));
      if (retained.length >= maxItems) continue;
      // Preserve whole statements, including negations, dates and qualifications.
      if (bytes([...retained.map(row => row.text), candidate.text]) <= maxBytes) selected.splice(0, selected.length, ...retained, { ...candidate });
      else oversized++;
    }
    return { selected, serializedBytes: bytes(selected.map(row => row.text)), cacheHit: !!cached, considered: candidates.length, oversized };
  }
}
