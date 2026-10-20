/**
 * Renders an agent's role and skills into the compact, model-facing text that
 * sits in the stable part of its system prompt (inside <craft>…</craft>).
 *
 * Output is deterministic for a given role and skill list, so the prompt
 * prefix stays byte-identical between turns. No sources, URLs or UI copy:
 * only what changes how the agent thinks and answers. Each skill is held to
 * a character budget by dropping its least essential lines first, so one
 * verbose playbook cannot crowd out the rest.
 */

import type { PersonaSkillSet } from '../../tireh/types';
import { MAX_ROUTABLE_SKILLS } from '../../tireh/skill-routing';
import { MAX_AGENT_SKILLS, type AgentRole, type AgentSkill } from './types';

/** ≈ 375 tokens at the chars/4 heuristic: the median authored playbook (~1,340 chars) renders in full. */
export const SKILL_CHAR_BUDGET = 1500;

const sentence = (text: string) => {
  const t = text.trim();
  return /[.!?…:;]$/.test(t) ? t : `${t}.`;
};
const joinItems = (items: readonly string[]) => items.map((i) => i.trim().replace(/[.;]+$/, '')).filter(Boolean).join('; ');

/** The role block that opens <craft> in both prompt modes. */
export function renderRole(role: AgentRole): string {
  return [
    `Your role: ${role.title}. ${sentence(role.mission)}`,
    `What you know deeply: ${sentence(joinItems(role.knowledge))}`,
    `Your point of view: ${role.pointOfView.map(sentence).join(' ')}`,
    `How this role sounds at its best: ${sentence(role.voice)}`,
    `Honest limits: ${sentence(role.boundaries)}`,
  ].join('\n');
}

/** How many of each list a rendered skill keeps (deliverable: 0 or 1). */
type SkillShape = Record<'method' | 'quality' | 'pitfalls' | 'frameworks' | 'deliverable', number>;

/** Trim order when a skill is over budget: least essential first. */
const TRIMS: ReadonlyArray<readonly [keyof SkillShape, number]> = [
  ['deliverable', 0], ['frameworks', 3], ['pitfalls', 2], ['quality', 3], ['method', 5],
  ['pitfalls', 1], ['quality', 2], ['frameworks', 0], ['method', 4],
];

function renderSkillWith(skill: AgentSkill, shape: SkillShape): string {
  const lines = [
    `<skill name="${skill.title.replace(/"/g, "'")}">`,
    sentence(skill.whenToUse),
    `Method: ${skill.method.slice(0, shape.method).map((step, i) => `${i + 1}) ${sentence(step)}`).join(' ')}`,
  ];
  const quality = skill.qualityBar.slice(0, shape.quality);
  if (quality.length) lines.push(`Excellent means: ${quality.map(sentence).join(' ')}`);
  const pitfalls = skill.pitfalls.slice(0, shape.pitfalls);
  if (pitfalls.length) lines.push(`Avoid: ${pitfalls.map(sentence).join(' ')}`);
  const frameworks = skill.frameworks.slice(0, shape.frameworks);
  if (frameworks.length) lines.push(`Frameworks: ${frameworks.join(', ')}.`);
  // Only when someone asks for the written artefact; chat replies stay plain sentences.
  if (shape.deliverable && skill.deliverable) lines.push(`If asked for the written deliverable: ${sentence(skill.deliverable)}`);
  lines.push('</skill>');
  return lines.join('\n');
}

/** Full playbook when it fits; otherwise drop the least essential lines, in a fixed order. */
export function renderSkill(skill: AgentSkill): string {
  let shape: SkillShape = { method: skill.method.length, quality: skill.qualityBar.length, pitfalls: skill.pitfalls.length, frameworks: skill.frameworks.length, deliverable: 1 };
  let text = renderSkillWith(skill, shape);
  for (const [key, cap] of TRIMS) {
    if (text.length <= SKILL_CHAR_BUDGET) break;
    if (shape[key] <= cap) continue;
    shape = { ...shape, [key]: cap };
    text = renderSkillWith(skill, shape);
  }
  return text;
}

/**
 * The agent's craft: its role (mission, knowledge, point of view, voice,
 * limits) and up to MAX_AGENT_SKILLS skill playbooks. Empty string when the
 * agent has neither.
 */
export function renderCraft(role: AgentRole | undefined, skills: readonly AgentSkill[]): string {
  const kept = skills.slice(0, MAX_AGENT_SKILLS);
  const parts: string[] = [];
  if (role) parts.push(renderRole(role));
  if (kept.length) {
    parts.push('Skills you practise. When one fits, use its method quietly and give the person the result: what you found, decided or recommend, in your own voice. Never recite the steps or name the skill unless asked, and never claim you ran an analysis or saw data you did not.');
    for (const skill of kept) parts.push(renderSkill(skill));
  }
  return parts.join('\n\n');
}

/**
 * The policy for per-message skill selection (docs/SKILL_ROUTING.md), in one
 * place so the offline eval applies exactly the same rule: the skills
 * Decisions may choose between for an agent, best kept first.
 *
 * Only agents with a library WORK role are routed. Personal (lifestyle)
 * playbooks trigger on mood and health ("feels anxious", "an injury"), so
 * offering them would have Decisions classify someone's emotional or health
 * state (docs/AGENT_INTELLIGENCE_SOLUTION.md §4.8), and selection could drop
 * a safety screen. Custom agents without a role are not routed either.
 * Pinned playbooks are never routable: they are always in the prompt.
 */
export function routableSkillsFor(role: AgentRole | undefined, skills: readonly AgentSkill[]): AgentSkill[] {
  if (role?.space !== 'work') return [];
  return skills.slice(0, MAX_AGENT_SKILLS).filter((s) => !s.pinned).slice(0, MAX_ROUTABLE_SKILLS);
}

/**
 * The same role and skills split for per-message selection: pinned playbooks
 * stay in the prompt, `routableSkillsFor` become selectable. Undefined when
 * fewer than two skills are routable, so the agent always gets the full craft.
 */
export function renderSkillSet(role: AgentRole | undefined, skills: readonly AgentSkill[]): PersonaSkillSet | undefined {
  const routable = routableSkillsFor(role, skills);
  if (!role || routable.length < 2) return undefined;
  return {
    role: renderRole(role),
    pinned: skills.slice(0, MAX_AGENT_SKILLS).filter((s) => s.pinned).map((s) => ({ id: s.id, playbook: renderSkill(s) })),
    routable: routable.map((s) => ({ id: s.id, title: s.title, whenToUse: s.whenToUse.trim(), playbook: renderSkill(s) })),
  };
}
