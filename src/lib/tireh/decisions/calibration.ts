/**
 * Offline calibration for the triage pre-pass: joins content-free
 * decision-log rows with separately labelled examples (row_id, question,
 * label) and computes precision and recall per question, choice value,
 * script language and threshold. Pure: no I/O, no network, no row ids or
 * label contents in the output.
 *
 * The gate in docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.8: at least 200
 * labelled Persian and 200 labelled English examples per question before any
 * v2 answer is consumed.
 */

import { CATALOGUE_CHOICE_VALUES, IMAGE_V1_QUESTION_NAMES, V1_QUESTION_NAMES, V2_QUESTION_NAMES } from './catalog';
import type { DecisionLogRow } from './log';

export interface LabelRow { rowId: string; question: string; label: string }

export type CalibrationLanguage = 'fa' | 'en' | 'mixed' | 'unknown' | 'all';

export interface CalibrationCell {
  question: string;
  /** Choice questions: the value scored one-vs-rest. */
  value?: string;
  language: CalibrationLanguage;
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  /** null when tp + fp = 0. */
  precision: number | null;
  /** null when tp + fn = 0. */
  recall: number | null;
  /** Labelled examples joined to an answered row for this question and language. */
  support: number;
}

export const CALIBRATION_GATE = 200;
export const DEFAULT_THRESHOLDS: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const LANGUAGES: readonly CalibrationLanguage[] = ['fa', 'en', 'mixed', 'unknown', 'all'];
const QUESTION_NAMES: ReadonlySet<string> = new Set<string>([...V1_QUESTION_NAMES, ...V2_QUESTION_NAMES, ...IMAGE_V1_QUESTION_NAMES]);
const ROW_ID = /^[A-Za-z0-9_-]{1,128}$/;

const isChoice = (question: string) => Object.prototype.hasOwnProperty.call(CATALOGUE_CHOICE_VALUES, question);

/**
 * Parses `row_id,question,label`. The header must be exactly that, so no
 * free-text column can enter. Predicate labels (0/1/true/false) normalise to
 * '1' or '0'; choice labels must be catalogue values. Throws with the line
 * number only, never the line's content.
 */
export function parseLabelsCsv(text: string): LabelRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== 'row_id,question,label') throw new Error('labels: the header must be exactly row_id,question,label');
  const out: LabelRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fail = (why: string): never => { throw new Error(`labels line ${i + 1}: ${why}`); };
    const cells = lines[i].split(',').map((c) => c.trim());
    if (cells.length !== 3) fail('expected exactly three columns');
    const [rowId, question, raw] = cells;
    if (!ROW_ID.test(rowId)) fail('invalid row_id');
    if (!QUESTION_NAMES.has(question)) fail('question is not a catalogue name');
    let label: string;
    if (isChoice(question)) {
      if (!CATALOGUE_CHOICE_VALUES[question].includes(raw)) fail('label is not a catalogue value for this question');
      label = raw;
    } else {
      const lower = raw.toLowerCase();
      if (lower === '1' || lower === 'true') label = '1';
      else if (lower === '0' || lower === 'false') label = '0';
      else return fail('predicate label must be 0, 1, true or false');
    }
    out.push({ rowId, question, label });
  }
  return out;
}

/** Labels whose row id is not in the log, or whose row never asked that question. */
export function unmatchedLabelCount(rows: readonly DecisionLogRow[], labels: readonly LabelRow[]): number {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return labels.filter((l) => !byId.get(l.rowId)?.names.includes(l.question)).length;
}

interface Example { language: Exclude<CalibrationLanguage, 'all'>; label: string; answer: DecisionLogRow['answers'][number] }

const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

/**
 * One cell per question, value (choices only), language (plus 'all') and
 * threshold. Predicates: predicted positive when probability >= t. Choices,
 * per value v: predicted when choice === v and confidence >= t; actual when
 * the label is v. Only rows with outcome 'answered' that carry the named
 * answer count.
 */
export function computeCalibration(rows: readonly DecisionLogRow[], labels: readonly LabelRow[], thresholds: readonly number[] = DEFAULT_THRESHOLDS): CalibrationCell[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byQuestion = new Map<string, Example[]>();
  for (const label of labels) {
    const row = byId.get(label.rowId);
    if (!row || row.outcome !== 'answered') continue;
    const answer = row.answers.find((a) => a.name === label.question);
    if (!answer) continue;
    byQuestion.set(label.question, [...(byQuestion.get(label.question) ?? []), { language: row.language, label: label.label, answer }]);
  }
  const cells: CalibrationCell[] = [];
  for (const question of [...byQuestion.keys()].sort()) {
    const examples = byQuestion.get(question)!;
    const values: Array<string | undefined> = isChoice(question) ? [...CATALOGUE_CHOICE_VALUES[question]] : [undefined];
    for (const value of values) {
      for (const language of LANGUAGES) {
        const scoped = examples.filter((e) => language === 'all' || e.language === language);
        for (const threshold of thresholds) {
          let tp = 0, fp = 0, fn = 0;
          for (const e of scoped) {
            const predicted = value === undefined
              ? e.answer.type === 'predicate' && e.answer.probability >= threshold
              : e.answer.type === 'choice' && e.answer.choice === value && e.answer.confidence >= threshold;
            const actual = value === undefined ? e.label === '1' : e.label === value;
            if (predicted && actual) tp++;
            else if (predicted) fp++;
            else if (actual) fn++;
          }
          cells.push({ question, ...(value === undefined ? {} : { value }), language, threshold, tp, fp, fn,
            precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), support: scoped.length });
        }
      }
    }
  }
  return cells;
}

const fixed = (value: number | null) => (value === null ? '-' : value.toFixed(3));

/** A TSV table plus one gate line per question and language: 'support n/200 (gate met|not met)'. */
export function formatCalibration(cells: readonly CalibrationCell[], gate = CALIBRATION_GATE): string {
  if (cells.length === 0) return 'No labelled examples joined to answered decision-log rows.\n';
  const lines = ['question\tvalue\tlanguage\tthreshold\ttp\tfp\tfn\tprecision\trecall\tsupport'];
  for (const c of cells) {
    lines.push([c.question, c.value ?? '', c.language, c.threshold.toFixed(2), c.tp, c.fp, c.fn, fixed(c.precision), fixed(c.recall), c.support].join('\t'));
  }
  lines.push('');
  const support = new Map<string, number>();
  for (const c of cells) support.set(`${c.question}\t${c.language}`, c.support);
  for (const [key, n] of support) lines.push(`${key}\tsupport ${n}/${gate} (${n >= gate ? 'gate met' : 'gate not met'})`);
  return `${lines.join('\n')}\n`;
}
