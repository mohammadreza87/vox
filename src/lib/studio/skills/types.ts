/**
 * Vox agent skill library: role packs, roles and skills.
 *
 * A skill is a compact practitioner playbook (when to use it, the method,
 * what excellent looks like, what to avoid). A role bundles a mission, deep
 * domain knowledge, a point of view, a voice and a default skill set. Packs
 * group roles for one kind of organisation (or one person's life).
 *
 * The catalog is static, versioned code: it is reviewed like code, validated
 * at module load (see catalog.ts) and rendered into the agent's cached system
 * prompt prefix (see render.ts). Content is original; `sources` attribute the
 * public work that inspired it.
 */

import type { Hue } from '../types';

export type PackId = 'lifestyle' | 'tech' | 'ai' | 'mobile' | 'publisher';
export const PACK_IDS: readonly PackId[] = ['lifestyle', 'tech', 'ai', 'mobile', 'publisher'];

export type SkillSpace = 'work' | 'personal';

/** Most skills an agent can carry; keeps the cached prompt prefix bounded. Client-safe. */
export const MAX_AGENT_SKILLS = 8;

export interface SkillSource {
  name: string;
  url: string;
  /** SPDX id when known (MIT, Apache-2.0, CC-BY-4.0…); omit for books, talks and standards. */
  license?: string;
}

/** Persian copy for user-facing strings; English stays the model-facing source of truth. */
export interface FaCopy {
  title: string;
  summary: string;
}

export interface AgentSkill {
  /** Namespaced kebab-case: `core.decision-memo`, `growth.ua-launch-plan`. */
  id: string;
  /** ≤ 40 chars; shown on chips. */
  title: string;
  /** ≤ 120 chars; one line for the UI. */
  summary: string;
  /** ≤ 220 chars; the trigger, starting "Use when…". */
  whenToUse: string;
  /** 3–7 ordered imperative steps, each ≤ 240 chars. How a world-class practitioner does it. */
  method: string[];
  /** 3–5 checks that separate excellent from adequate, each ≤ 180 chars. */
  qualityBar: string[];
  /** 2–4 anti-patterns, each ≤ 180 chars. */
  pitfalls: string[];
  /** 0–6 named methods or standards, each ≤ 60 chars (RICE, DORA, JTBD…). */
  frameworks: string[];
  /** ≤ 180 chars; the shape of the output when the skill produces one. */
  deliverable?: string;
  sources: SkillSource[];
  fa?: FaCopy;
}

export interface RoleTraits {
  /** 0..100 like SpawnBrief.traits */
  warmDirect: number;
  playfulSerious: number;
  conciseExpansive: number;
}

export interface AgentRole {
  /** `<pack>.<kebab>`: `tech.staff-engineer`. */
  id: string;
  pack: PackId;
  space: SkillSpace;
  /** ≤ 40 chars. */
  title: string;
  /** ≤ 110 chars; the role card line. */
  summary: string;
  /** ≤ 260 chars; what they are accountable for. */
  mission: string;
  /** 3–8 domain knowledge areas, each ≤ 90 chars. Specific: "SKAdNetwork 4 and AdAttributionKit postbacks", not "marketing". */
  knowledge: string[];
  /** 2–4 opinions this role holds and argues for, each ≤ 160 chars. */
  pointOfView: string[];
  /** ≤ 260 chars; how this role sounds at its best (register, rhythm, habits). */
  voice: string;
  /** ≤ 260 chars; honest limits and what they defer to humans or specialists. */
  boundaries: string;
  /** 3–6 default skill ids. */
  skills: string[];
  /** 0–6 skills the creator can add. */
  optionalSkills: string[];
  /** Exactly 3 "ask me…" starters, each ≤ 90 chars, in the user's voice. */
  starters: string[];
  hue: Hue;
  traits: RoleTraits;
  /** Lowercase routing keywords in English and Persian (synonyms, job titles, tools). 6–30 entries. */
  keywords: string[];
  fa?: FaCopy;
}

export interface SkillPack {
  id: PackId;
  space: SkillSpace;
  /** ≤ 24 chars. */
  title: string;
  /** ≤ 80 chars. */
  tagline: string;
  /** Ordered role ids. */
  roles: string[];
  fa?: { title: string; tagline: string };
}

/** What one content module exports (packs/<pack>.ts and packs/core.ts). */
export interface PackModule {
  pack?: SkillPack;
  roles: AgentRole[];
  skills: AgentSkill[];
}

/** The client-safe projection served to the Mini App (no playbook bodies). */
export interface CatalogView {
  version: string;
  packs: SkillPack[];
  roles: Array<Pick<AgentRole, 'id' | 'pack' | 'space' | 'title' | 'summary' | 'mission' | 'skills' | 'optionalSkills' | 'starters' | 'hue' | 'traits' | 'fa'>>;
  skills: Array<Pick<AgentSkill, 'id' | 'title' | 'summary' | 'fa'>>;
}

/** Result of routing a free-text brief to the library (see route.ts). */
export interface RouteSuggestion {
  /** Absent when no role fits: the agent stays custom. */
  roleId?: string;
  pack?: PackId;
  space?: SkillSpace;
  /** The suggested skill set (role defaults, plus any optional skills the brief clearly asks for). */
  skillIds: string[];
  /** 0..1, how sure the router is about roleId. */
  confidence: number;
  /** Up to 3 other plausible role ids, best first. */
  alternatives: string[];
  source: 'decisions' | 'local';
  /** One clarifying choice when the router is unsure; values are role ids, or `work` / `personal` when the candidates split across spaces. Send the chosen value back as `answer`. */
  clarify?: { question: string; options: Array<{ value: string; label: string }> };
}
