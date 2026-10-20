// Default (jsdom) environment: src/test/setup.ts dereferences `window`, so a
// node-environment pragma fails before any test runs.
//
// Synthetic EN/FA memory eval. The fake embedder is a hashing bag-of-words over
// the v2 tokenizer: these numbers prove pipeline mechanics and Persian
// tokenisation, not real text-embedding-3-small quality. The output table is
// content-free (ids, labels and numbers only).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatContext, MemoryRecord } from '../../types';
import { audienceOf } from '../../memory/visibility';
import { selectMemories, tokenize } from '../../memory/retrieval';
import { embedMemory, FakeEmbeddingProvider } from '../../memory/embeddings';
import { EVAL_MEMORIES, EVAL_NOW, EVAL_QUESTIONS, evalOrg, type EvalCategory, type EvalQuestion } from './dataset';

const org = evalOrg();
const MODES = ['v1@8', 'v2-lexical', 'v2-embedding', 'v2-flag-default'] as const;
type Mode = typeof MODES[number];
const CATEGORIES: EvalCategory[] = ['single_session', 'multi_session', 'update', 'temporal', 'abstention', 'cross_person_leakage'];

const embedder = new FakeEmbeddingProvider({ dimensions: 256, tokenizer: tokenize });
let records: MemoryRecord[] = [];
const queryVectors = new Map<string, number[]>();
const readers = new Map(EVAL_MEMORIES.map((m) => [m.record.id, m.readers]));

function chatFor(q: EvalQuestion): ChatContext {
  return q.chat.kind === 'private'
    ? { kind: 'private', chatKey: `eval-${q.chat.personId}`, personId: q.chat.personId }
    : { kind: 'group', chatKey: `eval-${q.chat.groupId}`, group: org.getGroup(q.chat.groupId)! };
}

function run(mode: Mode, q: EvalQuestion): string[] {
  const chat = chatFor(q);
  const base = { query: q.query, now: EVAL_NOW };
  switch (mode) {
    case 'v1@8': return selectMemories(org, records, chat, { ...base, mode: 'v1' }).slice(0, 8).map((m) => m.id);
    case 'v2-lexical': return selectMemories(org, records, chat, { ...base, mode: 'v2' }).map((m) => m.id);
    case 'v2-embedding': return selectMemories(org, records, chat, { ...base, mode: 'v2', queryEmbedding: queryVectors.get(q.id) }).map((m) => m.id);
    case 'v2-flag-default': {
      vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
      try { return selectMemories(org, records, chat, base).map((m) => m.id); } finally { vi.unstubAllEnvs(); }
    }
  }
}

interface Result { q: EvalQuestion; mode: Mode; ids: string[]; recall: number | null; leaks: number; blockedHits: number }
const results: Result[] = [];

beforeAll(async () => {
  records = await Promise.all(EVAL_MEMORIES.map(async ({ record }) => {
    const embedded = await embedMemory(record, embedder);
    return embedded ? { ...record, ...embedded } : record;
  }));
  const vectors = await embedder.embed(EVAL_QUESTIONS.map((q) => q.query));
  EVAL_QUESTIONS.forEach((q, i) => queryVectors.set(q.id, vectors[i]));
  for (const q of EVAL_QUESTIONS) {
    const audience = audienceOf(chatFor(q));
    for (const mode of MODES) {
      const ids = run(mode, q);
      const top = ids.slice(0, 8);
      results.push({
        q, mode, ids,
        recall: q.expected.length ? q.expected.filter((id) => top.includes(id)).length / q.expected.length : null,
        leaks: ids.filter((id) => !audience.every((person) => readers.get(id)?.includes(person))).length,
        blockedHits: ids.filter((id) => q.blocked.includes(id)).length,
      });
    }
  }
  report();
});

afterEach(() => { vi.unstubAllEnvs(); });

function recallOf(mode: Mode, filter: (q: EvalQuestion) => boolean): number | null {
  const rows = results.filter((r) => r.mode === mode && r.recall !== null && filter(r.q));
  return rows.length ? rows.reduce((s, r) => s + r.recall!, 0) / rows.length : null;
}
const sum = (mode: Mode, key: 'leaks' | 'blockedHits', filter: (q: EvalQuestion) => boolean = () => true) =>
  results.filter((r) => r.mode === mode && filter(r.q)).reduce((s, r) => s + r[key], 0);

function report() {
  const fmt = (x: number | null) => (x === null ? '  -  ' : x.toFixed(3));
  const lines = ['memory eval (synthetic, fake embeddings): recall@8 / leakage / blockedHits', `mode               ${['overall', 'fa', 'en', ...CATEGORIES].map((c) => c.slice(0, 12).padEnd(12)).join(' ')} leak blocked`];
  for (const mode of MODES) {
    const cells = [
      recallOf(mode, () => true), recallOf(mode, (q) => q.lang === 'fa'), recallOf(mode, (q) => q.lang === 'en'),
      ...CATEGORIES.map((c) => recallOf(mode, (q) => q.category === c)),
    ].map((x) => fmt(x).padEnd(12));
    lines.push(`${mode.padEnd(18)} ${cells.join(' ')} ${String(sum(mode, 'leaks')).padStart(4)} ${String(sum(mode, 'blockedHits')).padStart(7)}`);
  }
  lines.push(`blockedHits by category: ${MODES.map((mode) => `${mode} ${CATEGORIES.map((c) => `${c}=${sum(mode, 'blockedHits', (q) => q.category === c)}`).join(',')}`).join(' | ')}`);
  lines.push('recall@8 by language and category');
  for (const mode of MODES) {
    for (const lang of ['fa', 'en'] as const) {
      const cells = CATEGORIES.slice(0, 4).map((c) => fmt(recallOf(mode, (q) => q.lang === lang && q.category === c)).padEnd(12));
      lines.push(`${`${mode}/${lang}`.padEnd(18)} ${cells.join(' ')}`);
    }
  }
  console.info(lines.join('\n'));
}

describe('memory eval dataset guard', () => {
  it('has exactly 100 questions with the documented category counts and a ~50/50 language split', () => {
    expect(EVAL_QUESTIONS).toHaveLength(100);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, EVAL_QUESTIONS.filter((q) => q.category === c).length]));
    expect(counts).toEqual({ single_session: 25, multi_session: 20, update: 15, temporal: 15, abstention: 10, cross_person_leakage: 15 });
    for (const c of CATEGORIES) {
      const fa = EVAL_QUESTIONS.filter((q) => q.category === c && q.lang === 'fa').length;
      expect(Math.abs(fa - (counts[c] - fa))).toBeLessThanOrEqual(1);
    }
    expect(new Set(EVAL_QUESTIONS.map((q) => q.id)).size).toBe(100);
  });

  it('has 70-90 memories, about half Persian, about half with v2 fields, all scope kinds and sensitivities', () => {
    expect(EVAL_MEMORIES.length).toBeGreaterThanOrEqual(70);
    expect(EVAL_MEMORIES.length).toBeLessThanOrEqual(90);
    const fa = EVAL_MEMORIES.filter((m) => m.lang === 'fa').length;
    expect(fa / EVAL_MEMORIES.length).toBeGreaterThan(0.4);
    expect(fa / EVAL_MEMORIES.length).toBeLessThan(0.6);
    const v2 = EVAL_MEMORIES.filter((m) => m.record.importance !== undefined).length;
    expect(v2 / EVAL_MEMORIES.length).toBeGreaterThan(0.4);
    expect(new Set(EVAL_MEMORIES.map((m) => m.record.scope.kind))).toEqual(new Set(['private', 'people', 'group', 'project', 'company', 'org']));
    expect(new Set(EVAL_MEMORIES.map((m) => m.record.sensitivity))).toEqual(new Set(['normal', 'personal', 'confidential']));
    expect(EVAL_MEMORIES.some((m) => m.record.supersededBy)).toBe(true);
    expect(EVAL_MEMORIES.some((m) => m.record.invalidatedBy && m.record.invalidatedAt)).toBe(true);
    expect(EVAL_MEMORIES.some((m) => m.record.expiresAt && m.record.expiresAt < EVAL_NOW)).toBe(true);
    expect(new Set(EVAL_MEMORIES.map((m) => m.record.id)).size).toBe(EVAL_MEMORIES.length);
  });

  it('has at least 10 FA queries the v1 tokenizer cannot match', () => {
    expect(EVAL_QUESTIONS.filter((q) => q.lang === 'fa' && q.v1Hard).length).toBeGreaterThanOrEqual(10);
  });

  it('references only known memories; expected rows are readable by the asker; blocked rows are not expected', () => {
    for (const q of EVAL_QUESTIONS) {
      const audience = audienceOf(chatFor(q));
      for (const id of [...q.expected, ...q.blocked]) expect(readers.has(id), `${q.id} -> ${id}`).toBe(true);
      for (const id of q.expected) expect(audience.every((p) => readers.get(id)!.includes(p)), `${q.id} -> ${id}`).toBe(true);
      expect(q.expected.filter((id) => q.blocked.includes(id))).toEqual([]);
      if (q.category === 'abstention' || q.category === 'cross_person_leakage') expect(q.expected).toEqual([]);
      if (q.category !== 'single_session' && q.category !== 'multi_session') expect(q.blocked.length).toBeGreaterThan(0);
    }
  });

  it('embeds only normal-sensitivity records', () => {
    for (const r of records) expect(r.embedding !== undefined).toBe(r.sensitivity === 'normal');
  });
});

describe('memory eval results', () => {
  it.each(MODES)('leakage is 0 in mode %s', (mode) => {
    expect(sum(mode, 'leaks')).toBe(0);
  });

  it('v2 never returns blocked rows for update, temporal and abstention', () => {
    for (const mode of ['v2-lexical', 'v2-embedding', 'v2-flag-default'] as const) {
      for (const category of ['update', 'temporal', 'abstention'] as const) {
        expect(sum(mode, 'blockedHits', (q) => q.category === category), `${mode}/${category}`).toBe(0);
      }
      expect(sum(mode, 'blockedHits', (q) => q.category === 'cross_person_leakage'), mode).toBe(0);
    }
  });

  it('v2 recall@8 >= v1@8 overall and per language', () => {
    for (const mode of ['v2-lexical', 'v2-embedding', 'v2-flag-default'] as const) {
      expect(recallOf(mode, () => true)!).toBeGreaterThanOrEqual(recallOf('v1@8', () => true)!);
      for (const lang of ['fa', 'en'] as const) {
        expect(recallOf(mode, (q) => q.lang === lang)!, `${mode}/${lang}`).toBeGreaterThanOrEqual(recallOf('v1@8', (q) => q.lang === lang)!);
      }
    }
  });

  it('FA v2 lexical recall@8 is strictly better than FA v1@8', () => {
    expect(recallOf('v2-lexical', (q) => q.lang === 'fa')!).toBeGreaterThan(recallOf('v1@8', (q) => q.lang === 'fa')!);
  });

  it('v2 with a query embedding reaches recall@8 >= 0.8 overall (synthetic tripwire, not a quality claim)', () => {
    expect(recallOf('v2-embedding', () => true)!).toBeGreaterThanOrEqual(0.8);
  });

  it('the flag-default path equals explicit v2 lexical', () => {
    for (const q of EVAL_QUESTIONS) {
      const a = results.find((r) => r.q === q && r.mode === 'v2-flag-default')!.ids;
      const b = results.find((r) => r.q === q && r.mode === 'v2-lexical')!.ids;
      expect(a).toEqual(b);
    }
  });

  it('returns at most 8 rows per question in every v2 mode', () => {
    for (const r of results) if (r.mode !== 'v1@8') expect(r.ids.length).toBeLessThanOrEqual(8);
  });
});
