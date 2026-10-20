/**
 * Per-message skill selection policy (docs/SKILL_ROUTING.md) against the
 * shipped catalog. Decisions must judge the task a message asks for, never
 * someone's mood or health (docs/AGENT_INTELLIGENCE_SOLUTION.md §4.8), so no
 * choice it is offered may be described in those terms.
 */
import { describe, expect, it } from 'vitest';
import { skillQuestion } from '../../../tireh/skill-routing';
import { CATALOG } from '../catalog';
import { renderSkillSet, routableSkillsFor } from '../render';
import type { AgentRole, AgentSkill } from '../types';

/** Mood, emotion and health vocabulary. Matched as whole words, case-insensitive. */
const MOOD_HEALTH = [
  'feel', 'feels', 'feeling', 'feelings', 'emotion', 'emotions', 'emotional', 'anxious', 'anxiety', 'stress', 'stressed',
  'sad', 'overwhelmed', 'lonely', 'loneliness', 'burnt out', 'burned out', 'burnout', 'upset', 'mood', 'panic', 'depressed',
  'depression', 'grief', 'grieving', 'trauma', 'self-harm', 'suicide', 'suicidal', 'mental health', 'wellbeing',
  'well-being', 'injury', 'injured', 'illness', 'ill', 'sick', 'disease', 'pregnancy', 'pregnant', 'pain', 'symptom',
  'symptoms', 'diagnosis', 'diagnosed', 'medication', 'medical', 'therapy', 'therapist',
];
/** Task terms that only look like the words above. */
const TASK_TERMS = [/\bpain points?\b/gi, /\bmood ?boards?\b/gi, /\bstress[- ]test(s|ing)?\b/gi, /\bfeel(s)? (of|like) the (game|app|product)\b/gi];
/**
 * Compliance and policy skills whose TASK is about such systems or rules, not
 * about the person writing. Each entry names the words it may use.
 */
const ALLOWED: Record<string, readonly string[]> = {
  'gov.transparency-notices': ['emotion'],
};

const pattern = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+')}(?![\\p{L}\\p{N}-])`, 'iu');
const flagged = (text: string, allowed: readonly string[] = []) => {
  const cleaned = TASK_TERMS.reduce((t, re) => t.replace(re, ' '), text);
  return MOOD_HEALTH.filter((w) => !allowed.includes(w) && pattern(w).test(cleaned));
};

const skillsOf = (role: AgentRole): AgentSkill[] =>
  [...new Set([...role.skills, ...role.optionalSkills])].map((id) => CATALOG.skills.find((s) => s.id === id)!).filter(Boolean);

describe('routing policy', () => {
  it('routes only agents with a library work role; personal roles and custom agents keep the full craft', () => {
    const work = CATALOG.roles.filter((r) => r.space === 'work');
    const personal = CATALOG.roles.filter((r) => r.space === 'personal');
    expect(work.length).toBeGreaterThan(0);
    expect(personal.length).toBeGreaterThan(0);
    for (const role of personal) {
      expect(routableSkillsFor(role, skillsOf(role)), role.id).toEqual([]);
      expect(renderSkillSet(role, skillsOf(role)), role.id).toBeUndefined();
    }
    const anyWork = work.find((r) => routableSkillsFor(r, skillsOf(r)).length >= 2)!;
    expect(routableSkillsFor(undefined, skillsOf(anyWork))).toEqual([]);
    expect(renderSkillSet(undefined, skillsOf(anyWork))).toBeUndefined();
    expect(renderSkillSet(anyWork, skillsOf(anyWork))).toBeDefined();
    // Pinned playbooks are never routable.
    for (const role of work) expect(routableSkillsFor(role, skillsOf(role)).some((s) => s.pinned), role.id).toBe(false);
  });

  it('the matcher catches mood and health wording and ignores task terms', () => {
    expect(flagged('Use when someone feels anxious about a deadline.')).toEqual(['feels', 'anxious']);
    expect(flagged('Use when the team is burnt out after a launch.')).toEqual(['burnt out']);
    expect(flagged('Use when a player reports an injury or pain.')).toEqual(['injury', 'pain']);
    expect(flagged('Use when mapping user pain points and a mood board for onboarding.')).toEqual([]);
    expect(flagged('Use when the illustration style is final.')).toEqual([]);
  });

  it('offers Decisions no choice described by mood or health, for any work role', () => {
    const problems: string[] = [];
    for (const role of CATALOG.roles.filter((r) => r.space === 'work')) {
      const routable = routableSkillsFor(role, skillsOf(role));
      const question = skillQuestion(routable);
      if (question?.type !== 'choice') continue;
      for (const choice of question.choices) {
        const words = flagged(choice.description ?? '', ALLOWED[choice.value]);
        if (words.length) problems.push(`${role.id} → ${choice.value} [${words.join(', ')}]: ${choice.description}`);
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it('keeps the allowlist current: every exception is offered somewhere and still needs its words', () => {
    for (const [id, words] of Object.entries(ALLOWED)) {
      const offered = CATALOG.roles.filter((r) => r.space === 'work').some((r) => routableSkillsFor(r, skillsOf(r)).some((s) => s.id === id));
      const skill = CATALOG.skills.find((s) => s.id === id);
      expect(offered, id).toBe(true);
      expect(flagged(`${skill?.title}: ${skill?.whenToUse}`), id).toEqual(expect.arrayContaining([...words]));
    }
  });
});
