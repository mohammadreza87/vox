/**
 * H3 (F037): the per-request question count stays within the seam limit
 * MAX_DECISION_QUESTIONS (24), which is itself within the vendor's documented
 * limit of 200 questions per request (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 2.1). v2 appends seven questions to at most seven v1 questions, so no
 * split is needed. Pure unit test; no provider.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DECISION_QUESTIONS } from '../../adaptive/decisions';
import { V1_QUESTION_NAMES, V2_QUESTION_NAMES } from '../decisions/catalog';
import { MAX_TRIAGE_QUESTIONS, triageQuestions } from '../triage';
import type { SkillChoice } from '../skill-routing';
import type { Persona } from '../types';
import { testOrgConfig } from './fixtures';

/** Section 2.1: the Decisions API accepts up to 200 questions per request. */
const VENDOR_MAX_QUESTIONS = 200;
const SKILLS: SkillChoice[] = [
  { id: 'x.alpha', title: 'Alpha', whenToUse: 'Use when alpha work is asked for.' },
  { id: 'x.beta', title: 'Beta', whenToUse: 'Use when beta work is asked for.' },
];

describe('question count per Decisions request', () => {
  it('the seam limit is 24 and within the vendor limit', () => {
    expect(MAX_DECISION_QUESTIONS).toBe(24);
    expect(MAX_DECISION_QUESTIONS).toBeLessThanOrEqual(VENDOR_MAX_QUESTIONS);
    expect(V1_QUESTION_NAMES.length + V2_QUESTION_NAMES.length).toBeLessThanOrEqual(MAX_DECISION_QUESTIONS);
  });

  it('triageQuestions stays within MAX_DECISION_QUESTIONS for every persona shape and set; v1 within MAX_TRIAGE_QUESTIONS', () => {
    const base = testOrgConfig().personas.find((p) => p.id === 'aria')!;
    const personas: Persona[] = [base, { ...base, personality: 'x'.repeat(4000), communicationStyle: 'y'.repeat(4000) }];
    let largest = 0;
    for (const p of personas) {
      for (const groupParticipation of ['mentions', 'balanced', 'active'] as const) {
        for (const askAddressed of [false, true]) {
          for (const routable of [undefined, SKILLS]) {
            const v1 = triageQuestions({ ...p, groupParticipation }, askAddressed, routable, 'v1');
            expect(v1.length).toBeLessThanOrEqual(MAX_TRIAGE_QUESTIONS);
            for (const set of ['v2', 'v2-live'] as const) {
              const all = triageQuestions({ ...p, groupParticipation }, askAddressed, routable, set);
              expect(all.slice(0, v1.length)).toEqual(v1);
              expect(all.length).toBe(v1.length + V2_QUESTION_NAMES.length);
              expect(all.length).toBeLessThanOrEqual(MAX_DECISION_QUESTIONS);
              largest = Math.max(largest, all.length);
            }
          }
        }
      }
    }
    expect(largest).toBe(MAX_TRIAGE_QUESTIONS + V2_QUESTION_NAMES.length);
  });
});
