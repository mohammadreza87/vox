/**
 * The assembled, validated skill library. Content lives in packs/*.ts; this
 * module checks every limit and reference once at load so a broken catalog
 * fails tests and startup instead of producing a bad prompt.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { packSchema, roleSchema, skillSchema } from './schema';
import { MAX_AGENT_SKILLS, PACK_IDS, type AgentRole, type AgentSkill, type CatalogView, type PackModule, type SkillPack } from './types';
import { core } from './packs/core';
import { lifestyle } from './packs/lifestyle';
import { tech } from './packs/tech';
import { ai } from './packs/ai';
import { mobile } from './packs/mobile';
import { publisher } from './packs/publisher';

const MODULES: PackModule[] = [core, lifestyle, tech, ai, mobile, publisher];

export interface Catalog {
  version: string;
  packs: SkillPack[];
  roles: AgentRole[];
  skills: AgentSkill[];
}

/** Validate modules and cross-references; throws one error listing every problem. */
export function assembleCatalog(modules: PackModule[]): Catalog {
  const problems: string[] = [];
  const packs: SkillPack[] = [];
  const roles: AgentRole[] = [];
  const skills: AgentSkill[] = [];
  const check = <T>(schema: z.ZodType<T>, value: unknown, label: string): T | undefined => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues.slice(0, 5)) problems.push(`${label} ${issue.path.join('.')}: ${issue.message}`);
  };
  for (const mod of modules) {
    if (mod.pack) { const pack = check(packSchema, mod.pack, `pack ${mod.pack.id}`); if (pack) packs.push(pack as SkillPack); }
    for (const role of mod.roles) { const r = check(roleSchema, role, `role ${role.id}`); if (r) roles.push(r as AgentRole); }
    for (const skill of mod.skills) { const s = check(skillSchema, skill, `skill ${skill.id}`); if (s) skills.push(s as AgentSkill); }
  }
  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of dupes(roles.map((r) => r.id))) problems.push(`duplicate role ${id}`);
  for (const id of dupes(skills.map((s) => s.id))) problems.push(`duplicate skill ${id}`);
  const skillIds = new Set(skills.map((s) => s.id));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  for (const role of roles) {
    if (!role.id.startsWith(`${role.pack}.`)) problems.push(`role ${role.id} is not namespaced by its pack ${role.pack}`);
    for (const id of [...role.skills, ...role.optionalSkills]) if (!skillIds.has(id)) problems.push(`role ${role.id} references missing skill ${id}`);
    const overlap = role.optionalSkills.filter((id) => role.skills.includes(id));
    if (overlap.length) problems.push(`role ${role.id} lists ${overlap.join(', ')} as both default and optional`);
  }
  for (const pack of packs) {
    for (const id of pack.roles) {
      const role = roleById.get(id);
      if (!role) problems.push(`pack ${pack.id} lists missing role ${id}`);
      else if (role.pack !== pack.id) problems.push(`pack ${pack.id} lists role ${id} from pack ${role.pack}`);
    }
    for (const role of roles) if (role.pack === pack.id && !pack.roles.includes(role.id)) problems.push(`role ${role.id} is missing from pack ${pack.id}`);
  }
  if (problems.length) throw new Error(`Invalid skill catalog:\n${problems.join('\n')}`);
  const ordered = PACK_IDS.map((id) => packs.find((p) => p.id === id)).filter((p): p is SkillPack => Boolean(p));
  const version = createHash('sha256').update(JSON.stringify({ packs: ordered, roles, skills })).digest('hex').slice(0, 12);
  return { version, packs: ordered, roles, skills };
}

export { MAX_AGENT_SKILLS };

/**
 * Tests and development fail loudly on a broken catalog. In production a bad
 * content change must not take every agent's replies down with it: log once
 * and run without the library (agents keep their persona, lose only craft).
 */
function loadCatalog(): Catalog {
  try {
    return assembleCatalog(MODULES);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') throw error;
    console.error('[studio] skill catalog failed validation; running without the role library', error);
    return { version: 'unavailable', packs: [], roles: [], skills: [] };
  }
}

export const CATALOG: Catalog = loadCatalog();

const roleIndex = new Map(CATALOG.roles.map((r) => [r.id, r]));
const skillIndex = new Map(CATALOG.skills.map((s) => [s.id, s]));

export function getRole(id: string | undefined): AgentRole | undefined {
  return id ? roleIndex.get(id) : undefined;
}

export function getSkill(id: string): AgentSkill | undefined {
  return skillIndex.get(id);
}

/** Known skills in the given order, unknown or duplicate ids dropped. */
export function resolveSkills(ids: readonly string[] | undefined): AgentSkill[] {
  const seen = new Set<string>();
  const out: AgentSkill[] = [];
  for (const id of ids ?? []) {
    const skill = skillIndex.get(id);
    if (skill && !seen.has(id)) { seen.add(id); out.push(skill); }
  }
  return out;
}

/** The client-safe projection of an assembled catalog: no playbook bodies, keywords or voice. */
export function projectCatalog(catalog: Catalog): CatalogView {
  return {
    version: catalog.version,
    packs: catalog.packs,
    roles: catalog.roles.map(({ id, pack, space, title, summary, mission, skills, optionalSkills, starters, hue, traits, fa }) =>
      ({ id, pack, space, title, summary, mission, skills, optionalSkills, starters, hue, traits, ...(fa ? { fa } : {}) })),
    skills: catalog.skills.map(({ id, title, summary, fa }) => ({ id, title, summary, ...(fa ? { fa } : {}) })),
  };
}

let view: CatalogView | undefined;
export function catalogView(): CatalogView {
  view ??= projectCatalog(CATALOG);
  return view;
}
