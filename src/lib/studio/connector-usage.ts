/**
 * Small-number protection for "Connectors people use" (Settings v2). A manager sees counts only, and a count must not
 * single anyone out: the viewer's own connections are never counted (no subtraction), an app shows only once at least
 * USAGE_MIN_PEOPLE other people use it, and, when the agent's audience is known, never when everyone else uses it.
 * Pure; shared by connections/runtime.ts (the source) and service.ts (the route), so neither can skip it.
 */
export const USAGE_MIN_PEOPLE = 3;

/**
 * Who else may use the agent: how many people other than the viewer (an org-wide agent), null when unbounded (a public
 * agent), or 'chosen' when its managers hand-pick that list (a private agent). A manager who picks the list can fill it
 * with accounts they control, connect those, and read one chosen person's choice off the difference, whatever the
 * threshold; so a hand-picked audience shows no counts at all.
 */
export type UsageAudience = number | null | 'chosen';

export function usageAudience(visibility: 'public' | 'org' | 'private', countOthers: () => number): UsageAudience {
  return visibility === 'public' ? null : visibility === 'private' ? 'chosen' : countOthers();
}

export function protectUsage<T extends { people: number }>(rows: readonly T[], audience: UsageAudience): T[] {
  if (audience === 'chosen') return [];
  return rows.filter((r) => Number.isSafeInteger(r.people) && r.people >= USAGE_MIN_PEOPLE && (audience === null || r.people < audience));
}
