/**
 * CI lint over the triage question catalogue (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 4.8): no question may ask about a member's emotional, attitudinal,
 * health, personality or performance state. The v2 questions pass with no
 * allowance; the frozen v1 texts need exactly the four reasoned entries in
 * CATALOGUE_LINT_ALLOWLIST. A new question that trips the regex fails CI here.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_LINT, CATALOGUE_LINT_ALLOWLIST, IMAGE_V1_QUESTION_NAMES, PERSONA_HEADER_PREFIX, TRIAGE_V2_QUESTIONS, lintQuestions,
} from '../decisions/catalog';
import { skillQuestion, type SkillChoice } from '../skill-routing';
import { triageQuestions, type DecisionQuestion } from '../triage';
import type { Persona } from '../types';
import { testOrgConfig } from './fixtures';

const CONTRACT_REGEX = String.raw`\b(emotion\w*|mood\w*|stress\w*|attitude\w*|personalit\w*|health\w*|performance\w*|feel\w*)\b`;
const persona = (): Persona => testOrgConfig().personas.find((p) => p.id === 'aria')!;
const SKILLS: SkillChoice[] = [
  { id: 'x.alpha', title: 'Alpha', whenToUse: 'Use when alpha work is asked for.' },
  { id: 'x.beta', title: 'Beta', whenToUse: 'Use when beta work is asked for.' },
];

/** Every question the triage can send: the v1 matrix, a skill question, the v2 set and the reserved image names. */
function catalogue(): DecisionQuestion[] {
  const out: DecisionQuestion[] = [];
  const personas: Persona[] = [persona(), { ...persona(), personality: 'moody and stressed', communicationStyle: 'emotional, feels a lot' }];
  for (const p of personas) {
    for (const groupParticipation of ['mentions', 'balanced', 'active'] as const) {
      for (const askAddressed of [false, true]) out.push(...triageQuestions({ ...p, groupParticipation }, askAddressed, undefined, 'v1'));
    }
  }
  out.push(skillQuestion(SKILLS)!);
  out.push(...TRIAGE_V2_QUESTIONS);
  return out;
}

describe('CATALOGUE_LINT', () => {
  it('is the contract regex verbatim', () => {
    expect(CATALOGUE_LINT.source).toBe(CONTRACT_REGEX);
    expect(CATALOGUE_LINT.flags).toBe('i');
  });

  it('positive controls: a question about a member\'s mood and a choice about their attitude are violations', () => {
    const questions: DecisionQuestion[] = [
      { type: 'predicate', name: 'synthetic_mood', instructions: 'How is the member\'s mood today?' },
      { type: 'choice', name: 'synthetic_attitude', instructions: 'Which fits the message?', choices: [{ value: 'a', description: 'Their attitude towards the team' }, { value: 'b', description: 'Something else' }] },
    ];
    expect(lintQuestions(questions, CATALOGUE_LINT_ALLOWLIST)).toEqual([
      { question: 'synthetic_mood', field: 'instructions', match: 'mood' },
      { question: 'synthetic_attitude', field: 'choice:a', match: 'attitude' },
    ]);
  });
});

describe('catalogue lint', () => {
  it('the whole catalogue passes with the documented allowlist', () => {
    expect(lintQuestions(catalogue(), CATALOGUE_LINT_ALLOWLIST)).toEqual([]);
  });

  it('the v2 questions pass with no allowlist at all', () => {
    expect(TRIAGE_V2_QUESTIONS).toHaveLength(7);
    expect(lintQuestions(TRIAGE_V2_QUESTIONS, [])).toEqual([]);
  });

  it('the reserved image question names are lint-clean', () => {
    for (const name of IMAGE_V1_QUESTION_NAMES) expect(CATALOGUE_LINT.test(name.replace(/_/g, ' '))).toBe(false);
  });

  it('the persona header line is stripped, so persona text never trips the lint', () => {
    const p = { ...persona(), personality: 'moody and stressed', groupParticipation: 'active' as const };
    const questions = triageQuestions(p, true, undefined, 'v1');
    expect(questions.some((q) => q.instructions.includes(`${PERSONA_HEADER_PREFIX} `) && q.instructions.includes('moody'))).toBe(true);
    const violations = lintQuestions(questions, []);
    expect(violations.some((v) => v.match.toLowerCase().startsWith('mood') || v.match.toLowerCase().startsWith('stress'))).toBe(false);
  });

  it('exactly four allowances, each with a reason, and none is stale', () => {
    expect(CATALOGUE_LINT_ALLOWLIST).toHaveLength(4);
    for (const entry of CATALOGUE_LINT_ALLOWLIST) expect(entry.reason.trim().length).toBeGreaterThan(10);
    const unallowed = lintQuestions(catalogue(), []);
    for (const entry of CATALOGUE_LINT_ALLOWLIST.filter((e) => e.field !== 'choice:*')) {
      expect(unallowed.some((v) => v.question === entry.question && v.field === entry.field)).toBe(true);
    }
    expect(CATALOGUE_LINT_ALLOWLIST.map((e) => `${e.question}/${e.field}`).sort())
      .toEqual(['effort/choice:thoughtful', 'proactive/instructions', 'skill/choice:*', 'skill/instructions']);
  });

  it('the skill choice:* allowance covers skill catalogue content (titles and whenToUse)', () => {
    const skill = skillQuestion([{ id: 'care.wellbeing', title: 'Wellbeing', whenToUse: 'Use for health questions.' }, SKILLS[1]])!;
    expect(lintQuestions([skill], [])).toContainEqual({ question: 'skill', field: 'choice:care.wellbeing', match: 'health' });
    expect(lintQuestions([skill], CATALOGUE_LINT_ALLOWLIST)).toEqual([]);
  });

  it('violations are content-free: question name, field and the matched word only', () => {
    for (const v of lintQuestions(catalogue(), [])) expect(Object.keys(v).sort()).toEqual(['field', 'match', 'question']);
  });
});
