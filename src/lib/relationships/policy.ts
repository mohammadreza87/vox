import type { RelationshipPolicy, RelationshipState } from './types';
export const DEFAULT_RELATIONSHIP_POLICY: RelationshipPolicy = {
  minimumDelayMs: 3600_000, maximumDelayMs: 30 * 86400_000, expiryMs: 7 * 86400_000,
  cooldownMs: 86400_000, retryMs: 3600_000, leaseMs: 120_000, maxAttempts: 4, allowGroupOutreach: false,
};
export type ExplicitControl = 'pause' | 'resume' | 'stop' | 'forget';
/** Deliberately anchored: quoted/reported requests do not operate user controls. */
export function parseExplicitControl(text: string): ExplicitControl | null {
  const value = text.trim().toLowerCase().replace(/[.!؟?]+$/u, '').trim().replace(/^please\s+/u, '').replace(/,?\s+please$/u, '').replace(/^لطفاً?\s+/u, '');
  if (/^(?:\/stop|stop(?: messaging me| checking in| following up)?|leave me alone|no more (?:messages|check.?ins|follow.?ups)|do not (?:message me|follow up)|don't (?:message me|follow up)|(?:do not|don't) send me (?:any )?(?:more )?(?:messages|check.?ins|follow.?ups)|stop (?:sending me )?(?:messages|check.?ins|follow.?ups)|دیگه پیام نده|پیام نده|پیگیری نکن)$/u.test(value)) return 'stop';
  if (/^(?:\/pause|pause(?: follow.?ups)?|فعلا پیام نده|فعلاً پیام نده)$/u.test(value)) return 'pause';
  if (/^(?:\/resume|resume(?: follow.?ups)?|you can (?:message me|follow up) again|دوباره پیام بده)$/u.test(value)) return 'resume';
  if (/^(?:\/forgetall|forget everything(?: about me| (?:that )?i (?:told|have told|said to) you)?|همه چیز را فراموش کن|همه چیز رو فراموش کن)$/u.test(value)) return 'forget';
  return null;
}
export function validTimeZone(value: string): boolean { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; } }
export function isQuiet(state: RelationshipState, now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: state.timeZone }).format(now));
  const { start, end } = state.quietHours;
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
