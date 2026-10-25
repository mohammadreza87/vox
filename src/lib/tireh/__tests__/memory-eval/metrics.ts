/**
 * recall@8 and leakage for the memory eval. Reports are content-free:
 * numbers, category and language names only.
 */
import type { MemoryRecord } from '../../types';
import { BY_ID } from './corpus';
import type { AskerKey } from './org';
import type { EvalCategory, EvalQuestion } from './questions';

export const RECALL_K = 8;
/** Report-only: a stricter cut that shows ordering quality inside the 8. */
export const RECALL_STRICT_K = 3;

/** Independent oracle: the fixture's hand-written label, and never a superseded record. */
export function oracleAllows(id: string, asker: AskerKey): boolean {
  const row = BY_ID.get(id);
  return !!row && !row.record.supersededBy && row.visibleTo.includes(asker);
}

/** Scope-visible but stale at `now`: excluded by v2 only (v1 has no notion of it). */
export function isStale(record: MemoryRecord, now: Date): boolean {
  return (!!record.invalidatedAt && record.invalidatedAt.getTime() <= now.getTime()) ||
    (!!record.expiresAt && record.expiresAt.getTime() <= now.getTime());
}

export interface QuestionResult {
  question: EvalQuestion;
  returned: string[];
  recall: number | null;
  recallAt3: number | null;
  /** Privacy leaks: returned ids the asker may never receive (invisible or superseded). */
  leaked: string[];
  /** Returned ids that were forbidden only because they are invalidated or expired. */
  stale: string[];
}

export function score(question: EvalQuestion, returned: readonly string[], now: Date): QuestionResult {
  const at = (k: number) => question.goldIds.length
    ? question.goldIds.filter((id) => returned.slice(0, k).includes(id)).length / question.goldIds.length : null;
  const recall = at(RECALL_K);
  const leaked: string[] = [];
  const stale: string[] = [];
  for (const id of returned) {
    const row = BY_ID.get(id);
    const forbidden = question.forbiddenIds.includes(id);
    if (!oracleAllows(id, question.asker)) leaked.push(id);
    else if (forbidden && row && isStale(row.record, now)) stale.push(id);
    else if (forbidden) leaked.push(id);
  }
  return { question, returned: [...returned], recall, recallAt3: at(RECALL_STRICT_K), leaked, stale };
}

interface Bucket { recall: number | null; recallAt3: number | null; items: number }

export interface EvalReport {
  mode: string;
  questions: number;
  recallAt8: number | null;
  recallAt3: number | null;
  byLanguage: Record<'en' | 'fa', Bucket>;
  byCategory: Partial<Record<EvalCategory, Bucket>>;
  leakage: number;
  staleReturned: number;
  abstentionForbiddenReturned: number;
}

const mean = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000 : null;

/** Mean over items with gold; null when a bucket has none (abstention). */
function bucket(results: QuestionResult[]): Bucket {
  const scored = results.filter((r) => r.recall !== null);
  return { recall: mean(scored.map((r) => r.recall ?? 0)), recallAt3: mean(scored.map((r) => r.recallAt3 ?? 0)), items: scored.length };
}

export function report(mode: string, results: QuestionResult[]): EvalReport {
  const categories = [...new Set(results.map((r) => r.question.category))];
  return {
    mode,
    questions: results.length,
    recallAt8: bucket(results).recall,
    recallAt3: bucket(results).recallAt3,
    byLanguage: {
      en: bucket(results.filter((r) => r.question.lang === 'en')),
      fa: bucket(results.filter((r) => r.question.lang === 'fa')),
    },
    byCategory: Object.fromEntries(categories.map((c) => [c, bucket(results.filter((r) => r.question.category === c))])),
    leakage: results.reduce((sum, r) => sum + r.leaked.length, 0),
    staleReturned: results.reduce((sum, r) => sum + r.stale.length, 0),
    abstentionForbiddenReturned: results
      .filter((r) => r.question.category === 'abstention')
      .reduce((sum, r) => sum + r.returned.filter((id) => r.question.forbiddenIds.includes(id)).length, 0),
  };
}
