/**
 * EN/FA memory eval (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.4): recall@8 and
 * leakage over a synthetic HOOR corpus, for v1, v2 lexical and v2 with fake
 * embeddings. Modes are explicit, so the result does not depend on
 * TIREH_RETRIEVAL_V2. Fake-embedding numbers are report-only: the fake has no
 * semantics and says nothing about real Persian paraphrase recall.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { embedMemory, FakeEmbeddingProvider } from '../../memory/embeddings';
import { selectMemories } from '../../memory/retrieval';
import { isVisibleInChat } from '../../memory/visibility';
import type { MemoryRecord } from '../../types';
import { BY_ID, CORPUS, RECORDS } from './corpus';
import { isStale, report, score, type EvalReport, type QuestionResult } from './metrics';
import { ASKERS, chatFor, EVAL_NOW, evalOrg } from './org';
import { QUESTIONS } from './questions';

const org = evalOrg();

function run(mode: 'v1' | 'v2' | 'v2+fake', records: readonly MemoryRecord[], embeddings?: Map<string, number[]>): QuestionResult[] {
  return QUESTIONS.map((question) => {
    const chat = chatFor(org, question.asker);
    const options = mode === 'v1'
      ? { query: question.query, now: EVAL_NOW, mode: 'v1' as const, limit: 8 }
      : { query: question.query, now: EVAL_NOW, mode: 'v2' as const, queryEmbedding: mode === 'v2+fake' ? embeddings?.get(question.id) : undefined };
    const returned = selectMemories(org, [...records], chat, options).map((m) => m.id);
    return score(question, returned, EVAL_NOW);
  });
}

describe('memory eval fixture sanity', () => {
  it('has 95-110 items, at least 10 per category and 45 per language', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(95);
    expect(QUESTIONS.length).toBeLessThanOrEqual(110);
    for (const category of ['single', 'multi', 'update', 'temporal', 'abstention', 'leakage'] as const) {
      expect(QUESTIONS.filter((q) => q.category === category).length).toBeGreaterThanOrEqual(10);
    }
    for (const lang of ['en', 'fa'] as const) expect(QUESTIONS.filter((q) => q.lang === lang).length).toBeGreaterThanOrEqual(45);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    expect(CORPUS.length).toBeGreaterThanOrEqual(110);
    expect(new Set(RECORDS.map((r) => r.id)).size).toBe(RECORDS.length);
    expect(CORPUS.filter((r) => r.lang === 'fa').length).toBeGreaterThanOrEqual(50);
    expect(new Set(RECORDS.map((r) => r.sensitivity))).toEqual(new Set(['normal', 'personal', 'confidential']));
    expect(new Set(RECORDS.map((r) => r.scope.kind))).toEqual(new Set(['private', 'people', 'group', 'project', 'company', 'org']));
  });

  it('labels agree with isVisibleInChat for every live record and asker', () => {
    for (const row of CORPUS) {
      if (row.record.supersededBy) continue;
      for (const asker of ASKERS) {
        expect([row.record.id, asker, row.visibleTo.includes(asker)]).toEqual([row.record.id, asker, isVisibleInChat(org, row.record, chatFor(org, asker))]);
      }
    }
  });

  it('every gold id is visible to its asker and every forbidden id is invisible, superseded, invalidated or expired', () => {
    for (const q of QUESTIONS) {
      const chat = chatFor(org, q.asker);
      if (q.category === 'abstention') expect(q.goldIds).toEqual([]);
      for (const id of q.goldIds) {
        const row = BY_ID.get(id);
        expect([q.id, id, !!row && isVisibleInChat(org, row.record, chat) && !isStale(row.record, EVAL_NOW)]).toEqual([q.id, id, true]);
      }
      for (const id of q.forbiddenIds) {
        const row = BY_ID.get(id)!;
        expect(row).toBeDefined();
        const excluded = !isVisibleInChat(org, row.record, chat) || !!row.record.supersededBy || isStale(row.record, EVAL_NOW);
        expect([q.id, id, excluded]).toEqual([q.id, id, true]);
      }
    }
  });
});

describe('memory eval gates', () => {
  let v1: EvalReport;
  let v2: EvalReport;
  let fused: EvalReport;
  const results: Record<string, QuestionResult[]> = {};

  beforeAll(async () => {
    const provider = new FakeEmbeddingProvider();
    const embedded: MemoryRecord[] = [];
    for (const record of RECORDS) {
      const fields = await embedMemory(record, provider);
      embedded.push(fields ? { ...record, ...fields } : record);
    }
    const queryEmbeddings = new Map<string, number[]>();
    const vectors = await provider.embed(QUESTIONS.map((q) => q.query));
    QUESTIONS.forEach((q, i) => queryEmbeddings.set(q.id, vectors[i]));

    results.v1 = run('v1', RECORDS);
    results.v2 = run('v2', RECORDS);
    results.fused = run('v2+fake', embedded, queryEmbeddings);
    v1 = report('v1', results.v1);
    v2 = report('v2-lexical', results.v2);
    fused = report('v2-fake-embedding', results.fused);
    // Content-free report: numbers, categories and languages only.
    console.info(JSON.stringify({ memoryEval: [v1, v2, fused] }));
  });

  it('never leaks in any mode, and abstention items return none of their forbidden ids', () => {
    for (const r of [v1, v2, fused]) {
      expect([r.mode, r.leakage]).toEqual([r.mode, 0]);
      expect([r.mode, r.abstentionForbiddenReturned]).toEqual([r.mode, 0]);
    }
  });

  it('v2 never returns invalidated or expired records', () => {
    expect(v2.staleReturned).toBe(0);
    expect(fused.staleReturned).toBe(0);
  });

  it('meets the v2 lexical recall@8 gates and beats v1', () => {
    expect(v2.recallAt8).toBeGreaterThanOrEqual(0.85);
    expect(v2.byLanguage.en.recall).toBeGreaterThanOrEqual(0.85);
    expect(v2.byLanguage.fa.recall).toBeGreaterThanOrEqual(0.80);
    expect(v2.recallAt8).toBeGreaterThanOrEqual(v1.recallAt8 ?? 0);
    expect(v2.byLanguage.fa.recall).toBeGreaterThan(v1.byLanguage.fa.recall ?? 0);
  });

  it('returns at most 8 memories per question in v2', () => {
    for (const r of [...results.v2, ...results.fused]) expect(r.returned.length).toBeLessThanOrEqual(8);
  });

  it('keeps the report content-free', () => {
    const text = JSON.stringify([v1, v2, fused]);
    for (const row of CORPUS) expect(text).not.toContain(row.record.content.trim().slice(0, 12));
    for (const q of QUESTIONS) expect(text).not.toContain(q.query.slice(0, 12));
  });
});
