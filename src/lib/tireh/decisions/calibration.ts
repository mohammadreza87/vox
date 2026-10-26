/**
 * Offline calibration report for the triage pre-pass: joins content-free
 * decision-log rows with separately labelled examples (keyed by row id and
 * question) and computes precision and recall per question, threshold and
 * language. Pure: no I/O, no network. The report never prints row ids.
 *
 * The doc's gate (docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.8): at least
 * 200 labelled examples per language and question before any v2 answer is
 * consumed; smaller blocks are marked insufficient.
 */

import { parseDecisionLogRow, type DecisionLogRow } from './log';
import { TRIAGE_V2_CONTEXT_NEEDS, TRIAGE_V2_ROUTES, TRIAGE_V2_STYLE_REQUESTS, TRIAGE_V2_THREAD_STATUSES } from './catalog';

export type CalibrationLanguage = 'fa' | 'en' | 'mixed' | 'unknown';

export interface CalibrationLabel {
  id: string;
  question: string;
  /** Predicates: true/false. Choices: the correct catalogue value. */
  label: boolean | string;
  /** Overrides the row's script label when present. */
  language?: CalibrationLanguage;
}

export interface CalibrationCell { threshold: number; precision: number | null; recall: number | null; tp: number; fp: number; fn: number }

export interface CalibrationBlock {
  question: string;
  /** Choice questions: the value scored one-vs-rest. */
  value?: string;
  language: string;
  /** Labelled examples joined to a row (answered and unanswered). */
  n: number;
  /** Labelled positives among the n examples. */
  positives: number;
  /** Examples whose row has no usable answer (outcome unknown); excluded from precision and recall. */
  unanswered: number;
  /** n below the 200-example gate. */
  insufficient: boolean;
  cells: CalibrationCell[];
}

export const CALIBRATION_MIN_EXAMPLES = 200;
export const DEFAULT_THRESHOLDS: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

const LANGUAGES: readonly CalibrationLanguage[] = ['fa', 'en', 'mixed', 'unknown'];
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const VALUE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
/** Known fixed choice catalogues; other choice questions (e.g. skill) accept any catalogue-shaped value. */
const KNOWN_CHOICES: Record<string, readonly string[]> = {
  effort: ['quick', 'thoughtful'],
  route: TRIAGE_V2_ROUTES,
  context_need: TRIAGE_V2_CONTEXT_NEEDS,
  thread_status: TRIAGE_V2_THREAD_STATUSES,
  explicit_style_request: TRIAGE_V2_STYLE_REQUESTS,
};

/** Validated rows from a decision-log JSONL file; malformed lines are skipped. */
export function parseDecisionLogJsonl(text: string): DecisionLogRow[] {
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const row = parseDecisionLogRow(JSON.parse(line));
      return row ? [row] : [];
    } catch { return []; }
  });
}

/** Parses `id,question,label[,language]`. Throws with the line number on a bad line. */
export function parseLabelsCsv(text: string): CalibrationLabel[] {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((c) => c.trim().toLowerCase());
  const withLanguage = header.length === 4 && header[3] === 'language';
  if (header[0] !== 'id' || header[1] !== 'question' || header[2] !== 'label' || !(header.length === 3 || withLanguage)) {
    throw new Error('labels line 1: expected header id,question,label[,language]');
  }
  const out: CalibrationLabel[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split(',').map((c) => c.trim());
    const fail = (why: string): never => { throw new Error(`labels line ${i + 1}: ${why}`); };
    if (cells.length !== header.length && !(withLanguage && cells.length === 3)) fail('wrong number of columns');
    const [id, question, raw, language] = cells;
    if (!id || id.length > 128) fail('missing or invalid id');
    if (!NAME.test(question)) fail('invalid question name');
    let label: boolean | string;
    const lower = raw.toLowerCase();
    if (lower === '1' || lower === 'true') label = true;
    else if (lower === '0' || lower === 'false') label = false;
    else if (VALUE.test(raw) && (!KNOWN_CHOICES[question] || KNOWN_CHOICES[question].includes(raw))) label = raw;
    else return fail('label is neither 0/1/true/false nor a catalogue value');
    if (language && !LANGUAGES.includes(language as CalibrationLanguage)) fail('invalid language');
    out.push({ id, question, label, ...(language ? { language: language as CalibrationLanguage } : {}) });
  }
  return out;
}

const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

interface Example { score: number | null; positive: boolean }

function cells(examples: readonly Example[], thresholds: readonly number[]): CalibrationCell[] {
  const answered = examples.filter((e) => e.score !== null) as Array<{ score: number; positive: boolean }>;
  return thresholds.map((threshold) => {
    let tp = 0, fp = 0, fn = 0;
    for (const e of answered) {
      const predicted = e.score >= threshold;
      if (predicted && e.positive) tp++;
      else if (predicted) fp++;
      else if (e.positive) fn++;
    }
    return { threshold, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), tp, fp, fn };
  });
}

/** Precision/recall per question (per value for choices) and language. */
export function calibrationReport(rows: readonly DecisionLogRow[], labels: readonly CalibrationLabel[], thresholds: readonly number[] = DEFAULT_THRESHOLDS): CalibrationBlock[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  type Joined = { label: CalibrationLabel; row: DecisionLogRow; language: string };
  const groups = new Map<string, Joined[]>();
  for (const label of labels) {
    const row = byId.get(label.id);
    if (!row || !row.names.includes(label.question)) continue;
    const language = label.language ?? row.language;
    const key = `${label.question}\u0000${typeof label.label === 'boolean' ? 'p' : 'c'}\u0000${language}`;
    groups.set(key, [...(groups.get(key) ?? []), { label, row, language }]);
  }
  const blocks: CalibrationBlock[] = [];
  for (const [key, joined] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [question, kind, language] = key.split('\u0000');
    const answerOf = (j: Joined) => j.row.outcome === 'answered' ? j.row.answers.find((a) => a.name === question) : undefined;
    if (kind === 'p') {
      const examples = joined.map((j): Example => {
        const a = answerOf(j);
        return { score: a?.type === 'predicate' ? a.probability : null, positive: j.label.label === true };
      });
      blocks.push({ question, language, n: examples.length, positives: examples.filter((e) => e.positive).length,
        unanswered: examples.filter((e) => e.score === null).length, insufficient: examples.length < CALIBRATION_MIN_EXAMPLES, cells: cells(examples, thresholds) });
      continue;
    }
    const values = new Set<string>();
    for (const j of joined) {
      values.add(j.label.label as string);
      const a = answerOf(j);
      if (a?.type === 'choice') { values.add(a.choice); for (const p of a.probabilities ?? []) values.add(p.value); }
    }
    for (const value of [...values].sort()) {
      const examples = joined.map((j): Example => {
        const a = answerOf(j);
        const score = a?.type === 'choice' ? (a.probabilities?.find((p) => p.value === value)?.probability ?? (a.choice === value ? a.confidence : 0)) : null;
        return { score, positive: j.label.label === value };
      });
      blocks.push({ question, value, language, n: examples.length, positives: examples.filter((e) => e.positive).length,
        unanswered: examples.filter((e) => e.score === null).length, insufficient: examples.length < CALIBRATION_MIN_EXAMPLES, cells: cells(examples, thresholds) });
    }
  }
  return blocks;
}

const pad = (text: string, width: number) => (text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length));
const num = (value: number | null) => (value === null ? '   -  ' : value.toFixed(3).padStart(6));

/** A fixed-width text table. Never prints row ids. */
export function formatCalibrationReport(blocks: readonly CalibrationBlock[]): string {
  if (blocks.length === 0) return 'No labelled examples joined to decision-log rows.\n';
  const header = `${pad('question', 24)} ${pad('value', 18)} ${pad('lang', 7)} ${'n'.padStart(6)} ${'pos'.padStart(6)} ${'unans'.padStart(6)} ${pad('gate', 12)} ${'thr'.padStart(5)} ${'prec'.padStart(6)} ${'recall'.padStart(6)} ${'tp'.padStart(5)} ${'fp'.padStart(5)} ${'fn'.padStart(5)}`;
  const lines = [header, '-'.repeat(header.length)];
  for (const b of blocks) {
    for (const c of b.cells) {
      lines.push(`${pad(b.question, 24)} ${pad(b.value ?? '', 18)} ${pad(b.language, 7)} ${String(b.n).padStart(6)} ${String(b.positives).padStart(6)} ${String(b.unanswered).padStart(6)} ${pad(b.insufficient ? 'insufficient' : 'ok', 12)} ${c.threshold.toFixed(2).padStart(5)} ${num(c.precision)} ${num(c.recall)} ${String(c.tp).padStart(5)} ${String(c.fp).padStart(5)} ${String(c.fn).padStart(5)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The calibration gate for consuming live answers (care game design §8.7 rule 6): a question passes for a language
 * when the report has at least one block for it there and every such block (each choice value, one-vs-rest) has at
 * least CALIBRATION_MIN_EXAMPLES labelled examples. Anything else (no labels, a smaller block, another language) fails.
 */
export function petCalibrationPasses(blocks: readonly CalibrationBlock[], question: string, language: CalibrationLanguage): boolean {
  const mine = blocks.filter((b) => b.question === question && b.language === language);
  return mine.length > 0 && mine.every((b) => !b.insufficient && b.n >= CALIBRATION_MIN_EXAMPLES);
}

/**
 * Every `question:language` pair (fa and en only) that passes the gate: the value an operator copies into
 * STUDIO_PET_DECISIONS_CALIBRATED after reviewing the report (tireh/pet-flags.ts), sorted.
 */
export function petCalibratedPairs(blocks: readonly CalibrationBlock[]): string[] {
  const pairs = new Set<string>();
  for (const b of blocks) if ((b.language === 'fa' || b.language === 'en') && petCalibrationPasses(blocks, b.question, b.language)) pairs.add(`${b.question}:${b.language}`);
  return [...pairs].sort();
}
