/**
 * Field limits for the skill library, kept free of side effects so a single
 * pack module can be checked on its own (catalog.ts assembles them all).
 */

import { z } from 'zod';
import { HUES } from '../types';
import { PACK_IDS, type PackId } from './types';

const line = (max: number) => z.string().trim().min(1).max(max);
const fa = z.object({ title: line(60), summary: line(160) }).strict().optional();
export const skillId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const roleId = z.string().regex(/^(?:lifestyle|tech|ai|mobile|publisher)\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
const trait = z.number().int().min(0).max(100);

export const skillSchema = z.object({
  id: skillId,
  title: line(40),
  summary: line(120),
  whenToUse: line(220).regex(/^Use when\b/, 'whenToUse must start with "Use when"'),
  method: z.array(line(240)).min(3).max(7),
  qualityBar: z.array(line(180)).min(3).max(5),
  pitfalls: z.array(line(180)).min(2).max(4),
  frameworks: z.array(line(60)).max(6),
  deliverable: line(180).optional(),
  sources: z.array(z.object({ name: line(120), url: z.string().url(), license: line(40).optional() }).strict()).min(1).max(6),
  fa,
}).strict();

export const roleSchema = z.object({
  id: roleId,
  pack: z.enum(PACK_IDS as [PackId, ...PackId[]]),
  space: z.enum(['work', 'personal']),
  title: line(40),
  summary: line(110),
  mission: line(260),
  knowledge: z.array(line(90)).min(3).max(8),
  pointOfView: z.array(line(160)).min(2).max(4),
  voice: line(260),
  boundaries: line(260),
  skills: z.array(skillId).min(3).max(6),
  optionalSkills: z.array(skillId).max(6),
  starters: z.array(line(90)).length(3),
  hue: z.enum(HUES as [string, ...string[]]),
  traits: z.object({ warmDirect: trait, playfulSerious: trait, conciseExpansive: trait }).strict(),
  keywords: z.array(z.string().trim().min(2).max(40)).min(6).max(30),
  fa,
}).strict();

export const packSchema = z.object({
  id: z.enum(PACK_IDS as [PackId, ...PackId[]]),
  space: z.enum(['work', 'personal']),
  title: line(24),
  tagline: line(80),
  roles: z.array(roleId).min(1).max(16),
  fa: z.object({ title: line(40), tagline: line(120) }).strict().optional(),
}).strict();

