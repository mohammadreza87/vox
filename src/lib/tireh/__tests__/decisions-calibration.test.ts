/**
 * S09: the pure calibration core behind scripts/decisions-calibration.ts.
 * The CLI itself is not spawned: tsx child processes hit EPERM in this sandbox.
 */
import { describe, expect, it } from 'vitest';
import { computeCalibration, formatCalibration, parseLabelsCsv, unmatchedLabelCount, type CalibrationCell } from '../decisions/calibration';
import type { DecisionLogRow } from '../decisions/log';

const AT = new Date('2026-10-15T10:00:00Z');
const row = (id: string, language: 'fa' | 'en', memorable: number, route: string, confidence: number): DecisionLogRow => ({
  id, questionSetVersion: 'v2', names: ['memorable', 'route'], outcome: 'answered', elapsedMs: 300, routeTaken: 'thoughtful', personaId: 'aria', chatKind: 'private', language, at: AT,
  answers: [{ name: 'memorable', type: 'predicate', probability: memorable }, { name: 'route', type: 'choice', choice: route, confidence }],
});
const ROWS: DecisionLogRow[] = [
  row('r1', 'en', 0.8, 'smalltalk', 0.9),
  row('r2', 'en', 0.4, 'smalltalk', 0.6),
  row('r3', 'en', 0.2, 'answer', 0.4),
  row('r4', 'fa', 0.6, 'smalltalk', 0.8),
  row('r5', 'fa', 0.9, 'task', 0.9),
  row('r6', 'fa', 0.1, 'smalltalk', 0.35),
  { ...row('r7', 'en', 0.99, 'smalltalk', 0.99), outcome: 'unknown', unknownReason: 'timeout', answers: [] },
];
const LABELS = `row_id,question,label
r1,memorable,1
r2,memorable,true
r3,memorable,0
r4,memorable,false
r5,memorable,1
r6,memorable,0
r7,memorable,1
r1,route,smalltalk
r2,route,answer
r3,route,smalltalk
r4,route,smalltalk
r5,route,task
r6,route,smalltalk
r7,route,smalltalk
missing-row,route,task
`;

const find = (cells: CalibrationCell[], question: string, language: string, threshold: number, value?: string) =>
  cells.find((c) => c.question === question && c.language === language && c.threshold === threshold && c.value === value)!;
const counts = (c: CalibrationCell) => [c.tp, c.fp, c.fn];

describe('parseLabelsCsv', () => {
  it('accepts 0/1/true/false for predicates (normalised) and catalogue values for choices', () => {
    expect(parseLabelsCsv('row_id,question,label\na,memorable,1\nb,memorable,true\nc,personal_life,0\nd,confidential,FALSE\ne,route,clarify\n')).toEqual([
      { rowId: 'a', question: 'memorable', label: '1' }, { rowId: 'b', question: 'memorable', label: '1' },
      { rowId: 'c', question: 'personal_life', label: '0' }, { rowId: 'd', question: 'confidential', label: '0' },
      { rowId: 'e', question: 'route', label: 'clarify' },
    ]);
  });

  it.each([
    ['an extra text column', 'row_id,question,label,text\na,memorable,1,CANARY free text\n'],
    ['an extra cell on a row', 'row_id,question,label\na,memorable,1,CANARY\n'],
    ['a different header', 'id,question,label\na,memorable,1\n'],
    ['an unknown question', 'row_id,question,label\na,member_mood,1\n'],
    ['a choice label outside the catalogue', 'row_id,question,label\na,route,banter\n'],
    ['a predicate label that is not 0/1/true/false', 'row_id,question,label\na,memorable,yes\n'],
  ])('rejects %s without echoing content', (_label, csv) => {
    let message = '';
    try { parseLabelsCsv(csv); } catch (error) { message = (error as Error).message; }
    expect(message).not.toBe('');
    expect(message).not.toContain('CANARY');
  });
});

describe('computeCalibration', () => {
  const labels = parseLabelsCsv(LABELS);
  const cells = computeCalibration(ROWS, labels, [0.3, 0.5, 0.7]);

  it('predicate memorable: exact tp/fp/fn, precision and recall per language', () => {
    expect(counts(find(cells, 'memorable', 'en', 0.3))).toEqual([2, 0, 0]);
    expect(counts(find(cells, 'memorable', 'en', 0.5))).toEqual([1, 0, 1]);
    expect(counts(find(cells, 'memorable', 'en', 0.7))).toEqual([1, 0, 1]);
    expect(counts(find(cells, 'memorable', 'fa', 0.3))).toEqual([1, 1, 0]);
    expect(counts(find(cells, 'memorable', 'fa', 0.5))).toEqual([1, 1, 0]);
    expect(counts(find(cells, 'memorable', 'fa', 0.7))).toEqual([1, 0, 0]);
    expect(find(cells, 'memorable', 'en', 0.5)).toMatchObject({ precision: 1, recall: 0.5, support: 3 });
    expect(find(cells, 'memorable', 'fa', 0.3)).toMatchObject({ precision: 0.5, recall: 1, support: 3 });
    expect(find(cells, 'memorable', 'fa', 0.3).value).toBeUndefined();
  });

  it('choice route = smalltalk: exact tp/fp/fn per language', () => {
    expect(counts(find(cells, 'route', 'en', 0.3, 'smalltalk'))).toEqual([1, 1, 1]);
    expect(counts(find(cells, 'route', 'en', 0.5, 'smalltalk'))).toEqual([1, 1, 1]);
    expect(counts(find(cells, 'route', 'en', 0.7, 'smalltalk'))).toEqual([1, 0, 1]);
    expect(counts(find(cells, 'route', 'fa', 0.3, 'smalltalk'))).toEqual([2, 0, 0]);
    expect(counts(find(cells, 'route', 'fa', 0.5, 'smalltalk'))).toEqual([1, 0, 1]);
    expect(counts(find(cells, 'route', 'fa', 0.7, 'smalltalk'))).toEqual([1, 0, 1]);
    expect(find(cells, 'route', 'en', 0.7, 'smalltalk')).toMatchObject({ precision: 1, recall: 0.5 });
    expect(find(cells, 'route', 'fa', 0.7, 'task')).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(find(cells, 'route', 'en', 0.7, 'clarify')).toMatchObject({ tp: 0, fp: 0, fn: 0, precision: null, recall: null });
  });

  it("the 'all' aggregate equals the per-language sums, and unknown rows are ignored", () => {
    for (const [question, value] of [['memorable', undefined], ['route', 'smalltalk'], ['route', 'answer']] as Array<[string, string | undefined]>) {
      for (const t of [0.3, 0.5, 0.7]) {
        const all = find(cells, question, 'all', t, value);
        const parts = (['fa', 'en', 'mixed', 'unknown'] as const).map((l) => find(cells, question, l, t, value));
        expect(counts(all)).toEqual([0, 1, 2].map((i) => parts.reduce((n, c) => n + counts(c)[i], 0)));
        expect(all.support).toBe(6);
      }
    }
  });

  it('defaults to thresholds 0.1..0.9 and counts unmatched labels without exposing them', () => {
    expect(new Set(computeCalibration(ROWS, labels).map((c) => c.threshold))).toEqual(new Set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]));
    expect(unmatchedLabelCount(ROWS, labels)).toBe(1);
  });
});

describe('formatCalibration', () => {
  const cells = computeCalibration(ROWS, parseLabelsCsv(LABELS), [0.5]);

  it('prints a TSV table and support n/200 gate lines per question and language, never row ids', () => {
    const out = formatCalibration(cells);
    expect(out.split('\n')[0]).toBe('question\tvalue\tlanguage\tthreshold\ttp\tfp\tfn\tprecision\trecall\tsupport');
    expect(out).toContain('memorable\ten\tsupport 3/200 (gate not met)');
    expect(out).toContain('route\tall\tsupport 6/200 (gate not met)');
    for (const id of ['r1', 'r5', 'missing-row']) expect(out).not.toMatch(new RegExp(`\\b${id}\\b`));
  });

  it('a lower gate is reported as met', () => {
    expect(formatCalibration(cells, 3)).toContain('memorable\tfa\tsupport 3/3 (gate met)');
  });
});
