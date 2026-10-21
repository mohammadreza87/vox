/**
 * CI lint over the triage question catalogue (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 4.8): no question may ask about a member's emotional, attitudinal,
 * health or performance state. v2 questions pass with no allowlist; the v1
 * questions stay byte-identical and need the reasoned V1_LINT_ALLOWLIST.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE_LINT_PATTERN, PERSONA_HEADER_PREFIX, V1_LINT_ALLOWLIST, catalogueTexts, lintQuestions, triageV2Questions } from '../decisions/catalog';
import { triageQuestions, type DecisionQuestion } from '../triage';
import type { SkillChoice } from '../skill-routing';
import type { Persona } from '../types';
import { testOrgConfig } from './fixtures';

const base = (): Persona => ({ ...testOrgConfig().personas[0], personality: 'Moody, stress-tested and emotional about performance', communicationStyle: 'Feels everything' });
const SKILL_SETS: Array<SkillChoice[] | undefined> = [
  undefined,
  [{ id: 'x.alpha', title: 'Alpha', whenToUse: 'Use when alpha work is asked for.' }, { id: 'x.beta', title: 'Beta', whenToUse: 'Use when beta work is asked for.' }],
  [{ id: 'care.wellbeing', title: 'Wellbeing', whenToUse: 'Use for health and stress questions.' }, { id: 'x.beta', title: 'Beta', whenToUse: 'Use when beta work is asked for.' }],
];

/** The union of every question the triage can send, across modes, skills and sets. */
function catalogue(sets: Array<'v1' | 'v2'>): DecisionQuestion[] {
  const out: DecisionQuestion[] = [];
  for (const participation of ['mentions', 'balanced', 'active'] as const) {
    for (const askAddressed of [false, true]) {
      for (const routable of SKILL_SETS) {
        for (const set of sets) out.push(...triageQuestions({ ...base(), groupParticipation: participation }, askAddressed, routable, set));
      }
    }
  }
  return out;
}

describe('CATALOGUE_LINT_PATTERN', () => {
  it('is exactly the contract regex (S12 copies it)', () => {
    expect(CATALOGUE_LINT_PATTERN.source).toBe(String.raw`\b(emotion\w*|mood\w*|stress\w*|attitude\w*|personalit\w*|health\w*|performance\w*|feel\w*)\b`);
    expect(CATALOGUE_LINT_PATTERN.flags).toBe('i');
  });

  it.each([
    ['How is the member feeling', true], ['stressed', true], ['their attitude toward', true], ['performance review', true],
    ['health', true], ['mood', true], ['emotional', true], ['Personality', true],
    ['feedback form', false], ['performer', false], ['healthy-check', true], ['a stressor', true], ['unhealthy', false],
  ])('%s matches: %s', (text, expected) => {
    expect(CATALOGUE_LINT_PATTERN.test(text)).toBe(expected);
  });
});

describe('catalogue lint', () => {
  it('strips the persona header line from instructions', () => {
    const texts = catalogueTexts(triageQuestions(base(), true, undefined, 'v1'));
    expect(texts.some((t) => t.text.includes(PERSONA_HEADER_PREFIX))).toBe(false);
    expect(texts.some((t) => t.text.includes('stress-tested'))).toBe(false);
  });

  it('the full catalogue (v1 and v2) passes with the v1 allowlist', () => {
    expect(lintQuestions(catalogue(['v1', 'v2']), V1_LINT_ALLOWLIST).violations).toEqual([]);
  });

  it('the v2 questions pass with no allowlist at all', () => {
    expect(lintQuestions(triageV2Questions(), []).violations).toEqual([]);
    const v2Only = catalogue(['v2']).filter((q) => !catalogue(['v1']).some((v) => v.name === q.name));
    expect(v2Only.length).toBeGreaterThan(0);
    expect(lintQuestions(v2Only, []).violations).toEqual([]);
  });

  it('without the allowlist the v1 catalogue is flagged, content-free', () => {
    const { violations } = lintQuestions(catalogue(['v1']), []);
    expect(violations).toContainEqual({ question: 'effort', field: 'choice', value: 'thoughtful', word: 'emotional' });
    expect(violations).toContainEqual({ question: 'skill', field: 'instructions', word: 'health' });
    for (const v of violations) expect(Object.keys(v).sort()).toEqual(v.value === undefined ? ['field', 'question', 'word'] : ['field', 'question', 'value', 'word']);
  });

  it('the wildcard skill allowance never covers the fixed none choice', () => {
    const skill = triageQuestions(base(), false, SKILL_SETS[1], 'v1').find((q) => q.name === 'skill')! as Extract<DecisionQuestion, { type: 'choice' }>;
    const tampered = { ...skill, choices: skill.choices.map((c) => c.value === 'none' ? { ...c, description: 'Skip when the mood is low.' } : c) };
    expect(lintQuestions([tampered], V1_LINT_ALLOWLIST).violations).toEqual([{ question: 'skill', field: 'choice', value: 'none', word: 'mood' }]);
  });

  it('every non-wildcard allowance is used, names a v1 question and has a reason', () => {
    const { usedAllowances } = lintQuestions(catalogue(['v1']), V1_LINT_ALLOWLIST);
    for (const entry of V1_LINT_ALLOWLIST) {
      expect(['effort', 'proactive', 'skill']).toContain(entry.question);
      expect(entry.reason.trim().length).toBeGreaterThan(10);
      if (entry.value !== '*') expect(usedAllowances.has(entry)).toBe(true);
    }
    // The wildcard is exercised by the wellbeing skill fixture.
    expect(usedAllowances.has(V1_LINT_ALLOWLIST.find((e) => e.value === '*')!)).toBe(true);
  });
});
