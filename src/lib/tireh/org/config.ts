/**
 * Org config loading and validation.
 *
 * The organization (people, projects, groups, personas) is versioned config,
 * not user-editable data: persona identity changes must be deliberate.
 *
 * Sources, in order:
 *   1. TIREH_ORG_CONFIG       — JSON string
 *   2. TIREH_ORG_CONFIG_PATH  — path to a JSON file
 *   3. DEFAULT_ORG_CONFIG     — HOOR seed without Telegram ids
 */

import { readFileSync } from 'fs';
import { z } from 'zod';
import type { OrgConfig } from '../types';
import { DEFAULT_ORG_CONFIG } from './default-org';

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids must be lowercase kebab-case');

const personSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  telegramUserId: z.number().int().positive().optional(),
  managerId: idSchema.optional(),
  companyIds: z.array(idSchema).default([]),
  projectIds: z.array(idSchema).default([]),
  notes: z.string().optional(),
  guest: z.boolean().optional(),
});

const personaSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  personality: z.string().min(1),
  communicationStyle: z.string().min(1),
  values: z.array(z.string()).default([]),
  voice: z.object({
    elevenLabsVoiceId: z.string().min(1),
    description: z.string().default(''),
  }),
  ownerId: idSchema,
  telegramUsername: z.string().optional(),
  identityVersion: z.number().int().positive().default(1),
  replyWithVoice: z.enum(['never', 'mirror', 'always']).default('mirror'),
  strangerPolicy: z.string().optional(),
});

export const orgConfigSchema = z.object({
  organization: z.object({ id: idSchema, name: z.string().min(1) }),
  people: z.array(personSchema).min(1),
  relationships: z
    .array(z.object({ a: idSchema, b: idSchema, label: z.string().min(1) }))
    .default([]),
  companies: z.array(z.object({ id: idSchema, name: z.string().min(1) })).default([]),
  projects: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().min(1),
        companyId: idSchema,
        memberIds: z.array(idSchema),
        description: z.string().optional(),
      })
    )
    .default([]),
  groups: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().min(1),
        telegramChatId: z.number().int(),
        memberIds: z.array(idSchema).min(1),
        projectId: idSchema.optional(),
        companyId: idSchema.optional(),
      })
    )
    .default([]),
  personas: z.array(personaSchema).min(1),
});

/** Parse and cross-check references. Throws with every problem found. */
export function parseOrgConfig(raw: unknown): OrgConfig {
  const config = orgConfigSchema.parse(raw) as OrgConfig;
  const problems: string[] = [];

  const people = new Set(config.people.map((p) => p.id));
  const companies = new Set(config.companies.map((c) => c.id));
  const projects = new Set(config.projects.map((p) => p.id));

  const duplicates = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const dup of duplicates(config.people.map((p) => p.id))) problems.push(`duplicate person id "${dup}"`);
  for (const dup of duplicates(config.personas.map((p) => p.id))) problems.push(`duplicate persona id "${dup}"`);
  for (const dup of duplicates(config.groups.map((g) => String(g.telegramChatId)))) {
    problems.push(`duplicate group telegramChatId ${dup}`);
  }
  const telegramIds = config.people.flatMap((p) => (p.telegramUserId ? [String(p.telegramUserId)] : []));
  for (const dup of duplicates(telegramIds)) problems.push(`duplicate telegramUserId ${dup}`);

  for (const person of config.people) {
    if (person.managerId && !people.has(person.managerId)) {
      problems.push(`person "${person.id}" has unknown manager "${person.managerId}"`);
    }
    for (const c of person.companyIds) {
      if (!companies.has(c)) problems.push(`person "${person.id}" has unknown company "${c}"`);
    }
  }
  for (const project of config.projects) {
    if (!companies.has(project.companyId)) {
      problems.push(`project "${project.id}" has unknown company "${project.companyId}"`);
    }
    for (const m of project.memberIds) {
      if (!people.has(m)) problems.push(`project "${project.id}" has unknown member "${m}"`);
    }
  }
  for (const group of config.groups) {
    for (const m of group.memberIds) {
      if (!people.has(m)) problems.push(`group "${group.id}" has unknown member "${m}"`);
    }
    if (group.projectId && !projects.has(group.projectId)) {
      problems.push(`group "${group.id}" has unknown project "${group.projectId}"`);
    }
    if (group.companyId && !companies.has(group.companyId)) {
      problems.push(`group "${group.id}" has unknown company "${group.companyId}"`);
    }
  }
  for (const rel of config.relationships) {
    if (!people.has(rel.a) || !people.has(rel.b)) {
      problems.push(`relationship "${rel.label}" references an unknown person`);
    }
  }
  for (const persona of config.personas) {
    if (!people.has(persona.ownerId)) {
      problems.push(`persona "${persona.id}" has unknown owner "${persona.ownerId}"`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid TIREH org config:\n- ${problems.join('\n- ')}`);
  }

  // Project membership is the source of truth; mirror it onto people.
  for (const person of config.people) {
    person.projectIds = config.projects
      .filter((p) => p.memberIds.includes(person.id))
      .map((p) => p.id);
  }

  return config;
}

export function loadOrgConfig(env: NodeJS.ProcessEnv = process.env): OrgConfig {
  if (env.TIREH_ORG_CONFIG) {
    return parseOrgConfig(JSON.parse(env.TIREH_ORG_CONFIG));
  }
  if (env.TIREH_ORG_CONFIG_PATH) {
    return parseOrgConfig(JSON.parse(readFileSync(env.TIREH_ORG_CONFIG_PATH, 'utf8')));
  }
  return parseOrgConfig(structuredClone(DEFAULT_ORG_CONFIG));
}
