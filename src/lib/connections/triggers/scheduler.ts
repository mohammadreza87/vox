import { createHash } from 'node:crypto';
import type { ConnectionWorkflow } from '../contracts';
import { ConnectionsError } from '../errors';
export function assertTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(0); }
  catch { throw new ConnectionsError(400, 'workflow_timezone_invalid'); }
}
function localParts(now: number, timezone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function inQuietHours(workflow: ConnectionWorkflow, now: number): boolean {
  if (!workflow.quietHours) return false;
  const hour = Number(localParts(now, workflow.timezone).hour);
  const { startHour: start, endHour: end } = workflow.quietHours;
  return start === end || (start < end ? hour >= start && hour < end : hour >= start || hour < end);
}
/** One local-day key across a fall-back fold. Missing spring-forward time is skipped.
 * No catch-up burst: only the current interval/local minute is considered. */
export function scheduledSlot(workflow: ConnectionWorkflow, now: number): { key: string; slotAt: number } | undefined {
  if (workflow.schedule.kind === 'event' || inQuietHours(workflow, now)) return undefined;
  if (workflow.schedule.kind === 'interval') {
    const period = workflow.schedule.minutes * 60_000;
    const index = Math.floor((now - workflow.createdAt) / period);
    if (index < 1) return undefined;
    return { key: `interval:${index}`, slotAt: workflow.createdAt + index * period };
  }
  const p = localParts(now, workflow.timezone);
  if (`${p.hour}:${p.minute}` !== workflow.schedule.localTime) return undefined;
  return { key: `daily:${p.year}-${p.month}-${p.day}:${workflow.schedule.localTime}`, slotAt: Math.floor(now / 60_000) * 60_000 };
}
export function occurrenceUuid(workflowId: string, key: string): string {
  const bytes = createHash('sha256').update(JSON.stringify(['vox-workflow-v1', workflowId, key])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Bounded validation for a rule that could actually run during its authorization. */
export function hasEligibleOccurrence(workflow: ConnectionWorkflow, now: number): boolean {
  if (workflow.expiresAt <= now || workflow.quietHours?.startHour === workflow.quietHours?.endHour && workflow.quietHours !== null) return false;
  if (workflow.schedule.kind === 'event') return true;
  if (workflow.schedule.kind === 'interval') {
    const period = workflow.schedule.minutes * 60_000;
    for (let candidate = workflow.createdAt + period, count = 0; candidate < workflow.expiresAt && count < 3000; candidate += period, count++)
      if (candidate > now && !inQuietHours(workflow, candidate)) return true;
    return false;
  }
  const local = localParts(now, workflow.timezone);
  const [hour, minute] = workflow.schedule.localTime.split(':').map(Number);
  const firstLocalDay = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day));
  for (let day = 0; day < 33; day++) {
    const desired = firstLocalDay + day * 86_400_000 + hour * 3_600_000 + minute * 60_000;
    if (desired > workflow.expiresAt + 86_400_000) break;
    let candidate = desired;
    for (let iteration = 0; iteration < 3; iteration++) {
      const parts = localParts(candidate, workflow.timezone);
      const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      candidate += desired - rendered;
    }
    // Explicitly consider both sides of unusual one/two-hour DST folds. A gap
    // fails the exact rendered-local-time check and is skipped.
    for (const offset of [-7_200_000, -3_600_000, 0, 3_600_000, 7_200_000]) {
      const possible = candidate + offset;
      if (possible > now && possible < workflow.expiresAt && scheduledSlot(workflow, possible)) return true;
    }
  }
  return false;
}
