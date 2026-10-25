/**
 * Small-number protection for "Connectors people use" (Settings v2). A manager sees counts only, and a count must not
 * single anyone out: the viewer's own connections are never counted (no subtraction), an app shows only once at least
 * USAGE_MIN_PEOPLE other people use it, and, when the agent's audience is known, never when everyone else uses it.
 * Pure; shared by connections/runtime.ts (the source) and service.ts (the route), so neither can skip it.
 */
export const USAGE_MIN_PEOPLE = 3;

/** `audience`: how many people other than the viewer may use the agent, or null when unbounded (a public agent). */
export function protectUsage<T extends { people: number }>(rows: readonly T[], audience: number | null): T[] {
  return rows.filter((r) => Number.isSafeInteger(r.people) && r.people >= USAGE_MIN_PEOPLE && (audience === null || r.people < audience));
}
