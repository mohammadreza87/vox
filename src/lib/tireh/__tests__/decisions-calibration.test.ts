/** S09: the offline calibration report (pure logic behind scripts/decisions-calibration.ts). */
import { describe, expect, it } from 'vitest';
import { calibrationReport, formatCalibrationReport, parseDecisionLogJsonl, parseLabelsCsv, type CalibrationBlock } from '../decisions/calibration';
import type { DecisionLogRow } from '../decisions/log';

const AT = new Date('2026-10-15T10:00:00Z');
const base = (id: string, language: DecisionLogRow['language']): Omit<DecisionLogRow, 'answers' | 'names'> => ({
  id, questionSetVersion: 'v2', outcome: 'answered', elapsedMs: 300, routeTaken: 'thoughtful', personaId: 'aria', chatKind: 'private', language, at: AT,
});
const memorableRow = (id: string, language: DecisionLogRow['language'], probability: number): DecisionLogRow =>
  ({ ...base(id, language), names: ['memorable'], answers: [{ name: 'memorable', type: 'predicate', probability }] });

const PREDICATE_ROWS: DecisionLogRow[] = [
  memorableRow('ROWID_en1', 'en', 0.9), memorableRow('ROWID_en2', 'en', 0.6), memorableRow('ROWID_en3', 'en', 0.3), memorableRow('ROWID_en4', 'en', 0.1),
  memorableRow('ROWID_fa1', 'fa', 0.95), memorableRow('ROWID_fa2', 'fa', 0.85), memorableRow('ROWID_fa3', 'fa', 0.4), memorableRow('ROWID_fa4', 'fa', 0.05),
  { ...base('ROWID_en5', 'en'), names: ['memorable'], answers: [], outcome: 'unknown', unknownReason: 'timeout' },
];
const PREDICATE_LABELS = `id,question,label
ROWID_en1,memorable,1
ROWID_en2,memorable,0
ROWID_en3,memorable,true
ROWID_en4,memorable,false
ROWID_fa1,memorable,1
ROWID_fa2,memorable,1
ROWID_fa3,memorable,0
ROWID_fa4,memorable,0
ROWID_en5,memorable,1
ROWID_missing,memorable,1
`;

const block = (blocks: CalibrationBlock[], question: string, language: string, value?: string) =>
  blocks.find((b) => b.question === question && b.language === language && b.value === value)!;
const cell = (b: CalibrationBlock, threshold: number) => b.cells.find((c) => c.threshold === threshold)!;

describe('calibrationReport: predicates', () => {
  const blocks = calibrationReport(PREDICATE_ROWS, parseLabelsCsv(PREDICATE_LABELS), [0.2, 0.5, 0.8, 0.99]);

  it('computes exact precision and recall per language at 0.2, 0.5 and 0.8', () => {
    const en = block(blocks, 'memorable', 'en'), fa = block(blocks, 'memorable', 'fa');
    expect(cell(en, 0.2)).toMatchObject({ tp: 2, fp: 1, fn: 0, recall: 1 });
    expect(cell(en, 0.2).precision).toBeCloseTo(2 / 3, 10);
    expect(cell(en, 0.5)).toMatchObject({ precision: 0.5, recall: 0.5 });
    expect(cell(en, 0.8)).toMatchObject({ precision: 1, recall: 0.5 });
    expect(cell(fa, 0.2).precision).toBeCloseTo(2 / 3, 10);
    expect(cell(fa, 0.5)).toMatchObject({ precision: 1, recall: 1 });
    expect(cell(fa, 0.8)).toMatchObject({ precision: 1, recall: 1 });
  });

  it('gives a null precision when nothing is predicted positive', () => {
    expect(cell(block(blocks, 'memorable', 'fa'), 0.99)).toMatchObject({ precision: null, recall: 0, tp: 0, fp: 0, fn: 2 });
  });

  it('counts unanswered rows and excludes them; marks blocks under 200 insufficient; ignores unjoined labels', () => {
    const en = block(blocks, 'memorable', 'en');
    expect(en).toMatchObject({ n: 5, positives: 3, unanswered: 1, insufficient: true });
    expect(block(blocks, 'memorable', 'fa')).toMatchObject({ n: 4, unanswered: 0, insufficient: true });
    expect(blocks).toHaveLength(2);
  });

  it('a CSV language column overrides the row label', () => {
    const labels = parseLabelsCsv('id,question,label,language\nROWID_en1,memorable,1,mixed\nROWID_en2,memorable,0,\n');
    const out = calibrationReport(PREDICATE_ROWS, labels, [0.5]);
    expect(out.map((b) => [b.language, b.n])).toEqual([['en', 1], ['mixed', 1]]);
  });

  it('is not insufficient at 200 examples', () => {
    const rows = Array.from({ length: 200 }, (_, i) => memorableRow(`r${i}`, 'en', i % 2 ? 0.9 : 0.1));
    const labels = rows.map((r, i) => ({ id: r.id, question: 'memorable', label: i % 2 === 1 }));
    expect(calibrationReport(rows, labels, [0.5])[0]).toMatchObject({ n: 200, insufficient: false, cells: [{ precision: 1, recall: 1 }] });
  });
});

describe('calibrationReport: choices', () => {
  const routeRow = (id: string, choice: string, confidence: number, probabilities?: Array<{ value: string; probability: number }>): DecisionLogRow =>
    ({ ...base(id, 'en'), names: ['route'], answers: [{ name: 'route', type: 'choice', choice, confidence, ...(probabilities ? { probabilities } : {}) }] });
  const rows = [
    routeRow('A', 'task', 0.7, [{ value: 'task', probability: 0.7 }, { value: 'smalltalk', probability: 0.2 }, { value: 'answer', probability: 0.1 }]),
    routeRow('B', 'smalltalk', 0.6),
    routeRow('C', 'answer', 0.9),
  ];
  const blocks = calibrationReport(rows, parseLabelsCsv('id,question,label\nA,route,task\nB,route,smalltalk\nC,route,task\n'), [0.5]);

  it('scores one-vs-rest per value from probabilities, falling back to confidence for the chosen value', () => {
    expect(cell(block(blocks, 'route', 'en', 'task'), 0.5)).toMatchObject({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5 });
    expect(cell(block(blocks, 'route', 'en', 'smalltalk'), 0.5)).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(cell(block(blocks, 'route', 'en', 'answer'), 0.5)).toMatchObject({ tp: 0, fp: 1, fn: 0, precision: 0, recall: null });
    expect(block(blocks, 'route', 'en', 'task')).toMatchObject({ n: 3, positives: 2, unanswered: 0 });
  });
});

describe('parsing', () => {
  it('rejects a bad label, an unknown catalogue value and a bad header with the line number', () => {
    expect(() => parseLabelsCsv('id,question,label\nr1,memorable,1\nr2,memorable,maybe yes\n')).toThrow('labels line 3');
    expect(() => parseLabelsCsv('id,question,label\nr1,route,banter\n')).toThrow('labels line 2');
    expect(() => parseLabelsCsv('id,question,label,language\nr1,route,task,de\n')).toThrow('labels line 2');
    expect(() => parseLabelsCsv('question,id,label\n')).toThrow('labels line 1');
  });

  it('accepts skill ids and other catalogue-shaped values for questions without a fixed catalogue', () => {
    expect(parseLabelsCsv('id,question,label\nr1,skill,care.wellbeing\n')).toEqual([{ id: 'r1', question: 'skill', label: 'care.wellbeing' }]);
  });

  it('parseDecisionLogJsonl skips malformed lines and rows that fail the schema', () => {
    const good = JSON.stringify({ ...memorableRow('g1', 'en', 0.5), at: AT.toISOString() });
    const bad = JSON.stringify({ ...memorableRow('b1', 'en', 0.5), at: AT.toISOString(), text: 'CANARY' });
    const rows = parseDecisionLogJsonl(`${good}\n{oops\n${bad}\n\n`);
    expect(rows.map((r) => r.id)).toEqual(['g1']);
    expect(rows[0].at).toEqual(AT);
  });
});

describe('formatCalibrationReport', () => {
  it('prints a fixed-width table without row ids', () => {
    const text = formatCalibrationReport(calibrationReport(PREDICATE_ROWS, parseLabelsCsv(PREDICATE_LABELS), [0.2, 0.5, 0.8]));
    expect(text).not.toContain('ROWID');
    expect(text).toContain('memorable');
    expect(text).toContain('insufficient');
    const widths = new Set(text.trimEnd().split('\n').filter((l) => !l.startsWith('-')).map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  it('says so when nothing joined', () => {
    expect(formatCalibrationReport([])).toContain('No labelled examples');
  });
});
