/**
 * Growth moments on the server (design PET_CARE_GAME_DESIGN_2026_10_26 §4.11): the drafter's `growth` block (persona.ts
 * asks for it in the same draft call), its lint, the default fallback, the creator's edit while forming, and the opaque
 * reference a taught moment keeps to its source note. A bad or missing block never fails a draft.
 *
 * Lint, per moment (a failing moment is dropped; too few left means the role family's default set):
 *  - title ≤ GROWTH_LIMITS.titleChars and says "we"; hint ≤ GROWTH_LIMITS.hintChars;
 *  - no digits in any script, no emoji, no links or @handles (pet voice);
 *  - the pet copy lint's guilt, missing-you, suffering, FOMO, pressure, counting-absence and streak lists
 *    (scripts/lib/pet-copy-lint.mjs, the one source of those lists);
 *  - no PRIV-027 topic: health, religion, politics, sexuality, vulnerability, personality or emotion scores, performance.
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { lintText } from '../../../scripts/lib/pet-copy-lint.mjs';
import {
  allMoments, DRAFTED_KINDS, defaultGrowth, GROWTH_KINDS, GROWTH_LIMITS, growthLang, MAX_DRAFTED, MIN_DRAFTED,
  type AgentGrowth, type GrowthKind, type GrowthLang, type GrowthMoment,
} from '../pet/growth';
import type { Agent, PersonaSpec } from './types';

/** What the drafter may return (lenient: every kind parses; room and season are then left to the templates). */
const momentSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  hint: z.string().min(1).max(200),
  kind: z.enum(GROWTH_KINDS as unknown as [GrowthKind, ...GrowthKind[]]),
});
export const growthBlockSchema = z.object({ moments: z.array(momentSchema).min(1).max(GROWTH_LIMITS.maxMoments) });

/** What the drafter is shown (persona.ts promptSchema): only the kinds it writes, within the limits. */
export const promptGrowthSchema = z.object({
  moments: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
    title: z.string().min(1).max(GROWTH_LIMITS.titleChars),
    hint: z.string().min(1).max(GROWTH_LIMITS.hintChars),
    kind: z.enum(DRAFTED_KINDS as unknown as [GrowthKind, ...GrowthKind[]]),
  })).min(Math.max(MIN_DRAFTED, 10)).max(MAX_DRAFTED),
});

export const GROWTH_RULES = `Also draft "growth": ${Math.max(MIN_DRAFTED, 10)} to ${MAX_DRAFTED} growth moments, the things this agent will learn or do with the people it works with, specific to its role and the brief. Each has:
- "id": a short lowercase slug, unique (for example "taught-release-plan").
- "kind": "taught" (the team teaches it something and says "remember this"), "task" (the first time they do a kind of work together) or "access" (the day it gets a permission it needs, such as a calendar or check-ins). Mostly taught, a few task, one or two access.
- "title": at most ${GROWTH_LIMITS.titleChars} characters, in the persona's first language, said by the agent about the team with "we" ("We learned how we plan a release", «یاد گرفتیم نسخه‌ها رو چطور منتشر می‌کنیم»).
- "hint": at most ${GROWTH_LIMITS.hintChars} characters, an invitation to one person, never pressure ("Tell me how your team plans a release, then say “remember this”", «بگو تیمت نسخهٔ تازه رو چطور منتشر می‌کنه، آخرش بگو «یادت باشه»»).
Work context only: no person names, no digits or numbers, no emoji, no links, and nothing about health, religion, politics, sexuality, feelings, personality or anyone's performance. Never guilt, urgency or "don't miss". Do not write room or festival moments; those exist already.`;

/* ---------- lint ---------- */

/** PRIV-027 categories (design §8.3) in English and Persian stems. Deliberately broad: a dropped moment costs nothing. */
const SENSITIVE: readonly RegExp[] = [
  /\b(?:health|healthy|medic\w*|doctor|illness|sick\w*|disease|diagnos\w*|therap\w*|mental|anxiety|depress\w*|stress\w*|diet|weight|pregnan\w*|disab\w*|injur\w*)\b/i,
  /\b(?:relig\w*|faith|pray\w*|church|mosque|temple|god|spiritual\w*)\b/i,
  /\b(?:politic\w*|election\w*|vote\w*|voting|government|protest\w*)\b/i,
  /\b(?:sex\w*|gender|dating|romance|romantic)\b/i,
  /\b(?:feel\w*|feeling|emotion\w*|mood\w*|personality|vulnerab\w*|lonel\w*|sad\w*|upset)\b/i,
  /\b(?:performance|productivity|rating|ranking|score\w*|kpi|appraisal)\b/i,
  /سلامت|بیمار|درمان|پزشک|دکتر|دارو|افسردگ|اضطراب|استرس|رژیم|باردار|معلول/u,
  /مذهب|(?<![\p{L}])دین(?:ی)?(?![\p{L}])|نماز|(?<![\p{L}])خدا(?![\p{L}])|مسجد|کلیسا|معنوی/u,
  /سیاس|انتخابات|(?<![\p{L}])رأی(?![\p{L}])|دولت|اعتراض/u,
  /جنسی|جنسیت|دوست\s*دختر|دوست\s*پسر|عاشق/u,
  /احساس|حس\s*و\s*حال|عاطف|شخصیت|غمگین|ناراحت/u,
  /عملکرد|بهره‌وری|بهره\s*وری|امتیاز|رتبه|ارزیابی/u,
];
const DIGIT = /[0-9۰-۹٠-٩]/;
const LINK = /https?:|www\.|@\w|\.com\b|t\.me/i;
/** "We" in the title: English we/our/us, Persian first-person plural endings or «با هم»/«ما». */
const SAYS_WE: Readonly<Record<GrowthLang, RegExp>> = {
  en: /\b(?:we|we've|our|us)\b/i,
  fa: /(?:یم|مون|ما|با\s*هم)(?=$|[\s‌⁩.!،؛:»)])/u,
};

/** Why a moment fails the lint (empty: it passes). */
export function lintMoment(m: Pick<GrowthMoment, 'title' | 'hint'>, lang: GrowthLang): string[] {
  const why: string[] = [];
  const title = m.title.trim(), hint = m.hint.trim();
  if (!title || title.length > GROWTH_LIMITS.titleChars) why.push('title_length');
  if (!hint || hint.length > GROWTH_LIMITS.hintChars) why.push('hint_length');
  if (!SAYS_WE[lang].test(title) && !SAYS_WE.en.test(title) && !SAYS_WE.fa.test(title)) why.push('title_not_we');
  for (const text of [title, hint]) {
    if (DIGIT.test(text)) why.push('digit');
    if (LINK.test(text)) why.push('link');
    if (SENSITIVE.some((re) => re.test(text))) why.push('sensitive_topic');
    for (const v of lintText({ text, voice: 'pet' })) if (v.rule !== 'latin-punctuation-in-persian' || lang === 'fa') why.push(v.rule);
  }
  return [...new Set(why)];
}

const slug = (id: string) => id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 48);
const bytes = (g: AgentGrowth) => Buffer.byteLength(JSON.stringify(g), 'utf8');

/**
 * The stored growth for a drafted persona: the drafter's moments that pass the lint (room and season ones dropped,
 * ids made unique slugs, at most MAX_DRAFTED, within GROWTH_LIMITS.maxBytes), or the role family's default set when
 * fewer than MIN_DRAFTED survive. Never throws.
 */
export function draftedGrowth(raw: unknown, persona: Pick<PersonaSpec, 'role' | 'languages'>): AgentGrowth {
  const lang = growthLang(persona.languages);
  const fallback = defaultGrowth(persona.role, lang);
  const parsed = growthBlockSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  const reserved = new Set(allMoments(fallback, {}).filter((m) => !DRAFTED_KINDS.includes(m.kind)).map((m) => m.id));
  const seen = new Set<string>();
  const moments: GrowthMoment[] = [];
  for (const m of parsed.data.moments) {
    if (!DRAFTED_KINDS.includes(m.kind)) continue;
    const id = slug(m.id);
    if (!/^[a-z0-9]/.test(id) || seen.has(id) || reserved.has(id)) continue;
    const moment = { id, title: m.title.replace(/\s+/g, ' ').trim(), hint: m.hint.replace(/\s+/g, ' ').trim(), kind: m.kind };
    if (lintMoment(moment, lang).length) continue;
    seen.add(id);
    moments.push(moment);
    if (moments.length >= MAX_DRAFTED) break;
  }
  const growth: AgentGrowth = { v: 1, lang, source: 'drafted', moments };
  while (growth.moments.length > MIN_DRAFTED && bytes(growth) > GROWTH_LIMITS.maxBytes) growth.moments.pop();
  return growth.moments.length >= MIN_DRAFTED && bytes(growth) <= GROWTH_LIMITS.maxBytes ? growth : fallback;
}

/**
 * A creator's edit while forming (the persona edit path, PATCH agents/:id `{ growth: { moments } }`): the same lint as
 * the drafter's, but a failing moment is refused with its index instead of being dropped.
 */
export function validateGrowthEdit(input: unknown, agent: Pick<Agent, 'persona' | 'growth'>): { ok: true; growth: AgentGrowth } | { ok: false; error: string } {
  const parsed = z.object({ moments: z.array(momentSchema).min(MIN_DRAFTED).max(MAX_DRAFTED) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: `growth: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
  const lang = agent.growth?.lang ?? growthLang(agent.persona.languages);
  const seen = new Set<string>();
  const moments: GrowthMoment[] = [];
  for (const [i, m] of parsed.data.moments.entries()) {
    if (!DRAFTED_KINDS.includes(m.kind)) return { ok: false, error: `growth.moments.${i}: room and season moments are fixed` };
    const id = slug(m.id);
    if (!/^[a-z0-9]/.test(id) || seen.has(id) || id.startsWith('room-') || id.startsWith('season-')) return { ok: false, error: `growth.moments.${i}: id must be a unique slug` };
    const moment = { id, title: m.title.replace(/\s+/g, ' ').trim(), hint: m.hint.replace(/\s+/g, ' ').trim(), kind: m.kind };
    const why = lintMoment(moment, lang);
    if (why.length) return { ok: false, error: `growth.moments.${i}: ${why.join(', ')}` };
    seen.add(id);
    moments.push(moment);
  }
  const growth: AgentGrowth = { v: 1, lang, source: 'drafted', moments };
  if (bytes(growth) > GROWTH_LIMITS.maxBytes) return { ok: false, error: 'growth: too long' };
  return { ok: true, growth };
}

/** The moments an agent shows: its stored set (or the default for agents hired before growth existed) plus templates. */
export function agentMoments(agent: Pick<Agent, 'persona' | 'growth'>): GrowthMoment[] {
  return allMoments(agent.growth, { role: agent.persona.role, languages: agent.persona.languages });
}

/**
 * The opaque reference a taught moment keeps to its source note copy: a keyed hash, so the lit record never holds the
 * copy id (which names its owner) and the reference cannot be reversed without the Studio secret.
 */
export function noteRef(secret: string, copyId: string): string {
  return createHmac('sha256', secret).update(`pet-growth-note:v1:${copyId}`).digest('hex').slice(0, 32);
}
