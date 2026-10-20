/**
 * Routing rules for the Brief step, in one place so product can tune them.
 * The server decides *which* role fits; the client decides *how loudly* to say so.
 */

import type { PackId, RouteSuggestion } from '@/lib/studio/skills/types';

export const ROUTING = {
  /** Debounce after the last keystroke before a (local, server-side) route. */
  debounceMs: 700,
  /** Client budget for the one Decisions-backed route on Draft (the server gives Decisions 1000 ms). */
  finalTimeoutMs: 1300,
  /** Show the cloud thinking only when a route is slower than this. */
  thinkingAfterMs: 150,
  /** Route once the brief has this many words or characters. */
  minWords: 3,
  minChars: 12,
  /** Match: apply the role (removable). */
  match: 0.75,
  /** Below this nothing is shown. */
  none: 0.4,
  /** After a clarifier answer, apply at this confidence. */
  afterAnswer: 0.55,
  /** Replace a showing role only when the new one is this much more confident. */
  replaceMargin: 0.1,
  /** Clear a showing role only when the text changed this much since it appeared. */
  clearChange: 0.4,
  /** Undo window after "Keep it custom". */
  undoMs: 5000,
} as const;

export type RoutingSource = 'decisions' | 'local' | 'picked' | 'successor';

export const routable = (text: string) => {
  const t = text.trim();
  return t.length >= ROUTING.minChars || t.split(/\s+/).filter(Boolean).length >= ROUTING.minWords;
};

export const isMatch = (s: RouteSuggestion) => !!s.roleId && !s.clarify && s.confidence >= ROUTING.match;
export const isNone = (s: RouteSuggestion) => !s.clarify && (!s.roleId || s.confidence < ROUTING.none);

/** Word-set distance, 0 (same words) … 1 (nothing in common). Cheap and script-agnostic. */
export function changeRatio(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().split(/[\s,.;:!?،؛]+/).filter(Boolean));
  const A = words(a), B = words(b);
  if (!A.size && !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return 1 - common / (A.size + B.size - common);
}

/** Validates a server answer; anything malformed counts as "no suggestion". */
export function asSuggestion(v: unknown): RouteSuggestion | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<RouteSuggestion>;
  if (typeof s.confidence !== 'number' || !Number.isFinite(s.confidence)) return null;
  const clarify = s.clarify && typeof s.clarify.question === 'string' && Array.isArray(s.clarify.options)
    ? { question: s.clarify.question, options: s.clarify.options.filter((o) => o && typeof o.value === 'string' && typeof o.label === 'string').slice(0, 4) }
    : undefined;
  return {
    roleId: typeof s.roleId === 'string' ? s.roleId : undefined,
    pack: s.pack,
    space: s.space,
    skillIds: Array.isArray(s.skillIds) ? s.skillIds.filter((id): id is string => typeof id === 'string') : [],
    confidence: s.confidence,
    alternatives: Array.isArray(s.alternatives) ? s.alternatives.filter((id): id is string => typeof id === 'string').slice(0, 3) : [],
    source: s.source === 'decisions' ? 'decisions' : 'local',
    // One option is a deliberate "did you mean…?" (Skip is the other answer).
    ...(clarify && clarify.options.length >= 1 ? { clarify } : {}),
  };
}

/** The free-text domain hint the drafter has always accepted, derived from the pack. */
export const PACK_DOMAIN: Record<PackId, string> = {
  lifestyle: 'Personal', tech: 'Product', ai: 'Product', mobile: 'Product', publisher: 'Publishing',
};

export const hasPersian = (text: string) => /[؀-ۿ]/.test(text);

/** dir="auto" everywhere content is shown; lang="fa" too when it is Persian, so CSS drops tracking and uppercase. */
export const textAttrs = (text?: string | null): { dir: 'auto'; lang?: 'fa' } =>
  (text && hasPersian(text) ? { dir: 'auto', lang: 'fa' } : { dir: 'auto' });
