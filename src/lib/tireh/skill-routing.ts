/**
 * Per-message skill selection (docs/SKILL_ROUTING.md).
 *
 * One `choice` question, asked inside the existing triage request, picks which
 * of the agent's playbooks the latest message calls for. Pinned safety skills
 * are never offered here: they are always in the prompt. The question judges
 * the task being asked for, never the person's mood or health.
 *
 * Anything missing, malformed or unsure returns null, and the turn keeps the
 * full craft prompt: selection can only narrow what the agent reads, never
 * take a capability away when it is in doubt.
 */

import type { DecisionAnswer, DecisionQuestion } from './triage';

export interface SkillChoice {
  id: string;
  title: string;
  whenToUse: string;
}

export interface SkillPick {
  /** Chosen skill ids, best first; empty when no playbook fits (`none`). */
  ids: string[];
  confidence: number;
}

export const SKILL_QUESTION = 'skill';
export const NO_SKILL = 'none';
/** Below this the turn stays unrouted (full craft). */
export const SKILL_MIN_CONFIDENCE = 0.45;
/** A runner-up playbook joins the first when its own probability reaches this. */
export const SECOND_SKILL_PROBABILITY = 0.25;
/** Decisions accepts at most 16 choices; one is `none`. */
export const MAX_ROUTABLE_SKILLS = 15;
/** The sandbox preview asks only the skill question; the eval's p95 was 424 ms. */
export const SANDBOX_SKILL_TIMEOUT_MS = 800;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The `skill` question, or undefined when there is nothing to choose between. */
export function skillQuestion(routable: readonly SkillChoice[]): DecisionQuestion | undefined {
  const skills = routable.slice(0, MAX_ROUTABLE_SKILLS);
  if (skills.length < 2 || new Set(skills.map((s) => s.id)).size !== skills.length || skills.some((s) => s.id === NO_SKILL)) return undefined;
  return {
    type: 'choice',
    name: SKILL_QUESTION,
    instructions: 'Which of this colleague\'s playbooks fits the task the latest message asks for? Judge the task, not the person\'s mood, feelings or health. Choose none for greetings, thanks, small talk, a quick factual answer, or when no playbook clearly fits.',
    choices: [
      ...skills.map((s) => ({ value: s.id, description: clip(`${s.title}: ${s.whenToUse}`, 400) })),
      { value: NO_SKILL, description: 'No playbook: greetings, thanks, small talk, a quick factual answer, or nothing above clearly fits.' },
    ],
  };
}

const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Rollout of per-message selection (`STUDIO_SKILL_ROUTING`):
 *   on      ask, and route the reply prompt on a confident answer (default)
 *   shadow  ask and log the outcome content-free; replies stay unrouted
 *   off     never ask
 */
export type SkillRouting = 'on' | 'shadow' | 'off';

/** Unset means `on`; an unrecognised value means `off`, so a typo never routes. */
export function parseSkillRouting(value: string | undefined): SkillRouting {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return 'on';
  return v === 'on' || v === 'shadow' || v === 'off' ? v : 'off';
}

/** Why `readSkillPick` returned null, for content-free diagnostics only. */
export function skillMiss(answer: DecisionAnswer | undefined, routable: readonly SkillChoice[]): 'no_answer' | 'low_confidence' {
  if (!answer || typeof answer !== 'object' || answer.type !== 'choice' || !probability(answer.confidence)) return 'no_answer';
  const known = answer.choice === NO_SKILL || routable.slice(0, MAX_ROUTABLE_SKILLS).some((s) => s.id === answer.choice);
  return known && answer.confidence < SKILL_MIN_CONFIDENCE ? 'low_confidence' : 'no_answer';
}

/** Per-option probabilities, or none at all when the list is not a well-formed list (no runner-up). */
function runnerUps(value: unknown): Array<{ value: string; probability: number }> {
  if (!Array.isArray(value) || value.length > 256) return [];
  const out: Array<{ value: string; probability: number }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return [];
    const { value: option, probability: p } = entry as { value?: unknown; probability?: unknown };
    if (typeof option !== 'string' || !probability(p)) return [];
    out.push({ value: option, probability: p });
  }
  return out;
}

/** The playbooks to load for this turn; null keeps the turn unrouted. Never throws. */
export function readSkillPick(answer: DecisionAnswer | undefined, routable: readonly SkillChoice[]): SkillPick | null {
  if (!answer || typeof answer !== 'object' || answer.type !== 'choice' || typeof answer.choice !== 'string' || !probability(answer.confidence)) return null;
  const ids = new Set(routable.slice(0, MAX_ROUTABLE_SKILLS).map((s) => s.id));
  if (answer.choice !== NO_SKILL && !ids.has(answer.choice)) return null;
  if (answer.confidence < SKILL_MIN_CONFIDENCE) return null;
  if (answer.choice === NO_SKILL) return { ids: [], confidence: answer.confidence };
  const runnerUp = runnerUps(answer.probabilities)
    .filter((p) => p.value !== answer.choice && p.value !== NO_SKILL && ids.has(p.value))
    .sort((a, b) => b.probability - a.probability)[0];
  return {
    ids: runnerUp && runnerUp.probability >= SECOND_SKILL_PROBABILITY ? [answer.choice, runnerUp.value] : [answer.choice],
    confidence: answer.confidence,
  };
}
