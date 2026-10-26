/**
 * H3 (F029): the catalogue lint also rejects common emotional, health, attitude
 * and performance terms in English and Persian (CATALOGUE_LINT_EXTENDED), while
 * every real catalogue question still passes with the documented allowlist.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_LINT, CATALOGUE_LINT_ALLOWLIST, CATALOGUE_LINT_EXTENDED, TRIAGE_V2_QUESTIONS, lintQuestions,
} from '../decisions/catalog';
import { IMAGE_TRIAGE_QUESTIONS } from '../images/questions';
import { skillQuestion, type SkillChoice } from '../skill-routing';
import { triageQuestions, type DecisionQuestion } from '../triage';
import type { Persona } from '../types';
import { testOrgConfig } from './fixtures';

const EN = ['anger', 'angry', 'upset', 'sad', 'sadness', 'happy', 'happiness', 'anxious', 'anxiety', 'frustrated', 'frustration',
  'sentiment', 'sick', 'sickness', 'illness', 'wellbeing', 'well-being', 'burnout', 'morale', 'productivity', 'productive', 'mental',
  'mentally', 'depressed', 'depression', 'motivation', 'motivated', 'temper', 'temperament', 'tone of the person', 'tone of the sender'];
const FA = ['احساس', 'احساسات', 'عاطفی', 'روحیه', 'روحيه', 'حال روحی', 'حال روحي', 'استرس', 'اضطراب', 'نگرانی', 'عصبانی', 'ناراحت', 'غمگین',
  'افسردگی', 'سلامت', 'سلامتی', 'بیمار', 'بيماری', 'عملکرد', 'بهره‌وری', 'بهره وری', 'بهرهوری', 'شخصیت', 'نگرش', 'خلق'];
const question = (text: string): DecisionQuestion => ({ type: 'predicate', name: 'synthetic', instructions: `Is the sender ${text} in the latest message?` });

const persona = (): Persona => testOrgConfig().personas.find((p) => p.id === 'aria')!;
const SKILLS: SkillChoice[] = [
  { id: 'x.alpha', title: 'Alpha', whenToUse: 'Use when alpha work is asked for.' },
  { id: 'x.beta', title: 'Beta', whenToUse: 'Use when beta work is asked for.' },
];

describe('CATALOGUE_LINT_EXTENDED', () => {
  it.each(EN)('rejects the English term %s', (term) => {
    expect(lintQuestions([question(term)], CATALOGUE_LINT_ALLOWLIST)).toEqual([{ question: 'synthetic', field: 'instructions', match: expect.any(String) }]);
  });

  it.each(FA)('rejects the Persian term %s', (term) => {
    expect(lintQuestions([question(term)], CATALOGUE_LINT_ALLOWLIST)).toHaveLength(1);
  });

  it('checks choice and level descriptions too', () => {
    const q: DecisionQuestion = { type: 'choice', name: 'synthetic_choice', instructions: 'Which fits the message?',
      choices: [{ value: 'a', description: 'The sender is frustrated' }, { value: 'b', description: 'Something else' }] };
    const s: DecisionQuestion = { type: 'score', name: 'synthetic_score', instructions: 'How long is the message?',
      levels: [{ label: 'low', description: 'روحیه پایین' }, { label: 'high', description: 'Long' }] };
    expect(lintQuestions([q, s], [])).toEqual([
      { question: 'synthetic_choice', field: 'choice:a', match: 'frustrated' },
      { question: 'synthetic_score', field: 'level:low', match: 'روحیه' },
    ]);
  });

  it('does not over-match: confidential, temperature-free text and work words pass', () => {
    for (const text of ['confidential', 'a sad-free plan', 'the shipped release', 'mentions a name'])
      expect(CATALOGUE_LINT_EXTENDED.test(text), text).toBe(text === 'a sad-free plan');
  });

  it('the contract regex is unchanged', () => {
    expect(CATALOGUE_LINT.source).toBe(String.raw`\b(emotion\w*|mood\w*|stress\w*|attitude\w*|personalit\w*|health\w*|performance\w*|feel\w*)\b`);
  });
});

describe('the real catalogue passes the extended lint', () => {
  it('v1 for every persona shape, the skill question and v2, with the four documented allowances only', () => {
    const out: DecisionQuestion[] = [];
    const base = persona();
    for (const p of [base, { ...base, personality: 'anxious, sad and frustrated', communicationStyle: 'temperamental' }]) {
      for (const groupParticipation of ['mentions', 'balanced', 'active'] as const) {
        for (const askAddressed of [false, true]) {
          for (const set of ['v1', 'v2', 'v2-live'] as const) out.push(...triageQuestions({ ...p, groupParticipation }, askAddressed, SKILLS, set));
        }
      }
    }
    out.push(skillQuestion(SKILLS)!);
    expect(lintQuestions(out, CATALOGUE_LINT_ALLOWLIST)).toEqual([]);
    expect(CATALOGUE_LINT_ALLOWLIST).toHaveLength(4);
  });

  it('the v2 and image questions pass with no allowance at all', () => {
    expect(lintQuestions(TRIAGE_V2_QUESTIONS, [])).toEqual([]);
    expect(lintQuestions(IMAGE_TRIAGE_QUESTIONS, [])).toEqual([]);
  });
});
