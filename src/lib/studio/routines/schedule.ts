/** One occurrence per local calendar day. Gaps use the first valid minute after
 * the requested time; overlaps use the first occurrence only. Missed days skip. */
export function validateSchedule(localTime: string, timeZone: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error('routine_invalid_time');
  if (!timeZone || timeZone.length > 100 || /^[+-]/.test(timeZone)) throw new Error('routine_invalid_timezone');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); }
  catch { throw new Error('routine_invalid_timezone'); }
}

export function localClock(at: Date, timeZone: string): { day: string; time: string } {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(part => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export function adaptiveEligible(at: Date, timeZone: string): boolean {
  const { time } = localClock(at, timeZone);
  return time >= '09:00' && time < '20:00';
}

export function nextAdaptiveOccurrence(at: Date, timeZone: string): string {
  return adaptiveEligible(at, timeZone) ? at.toISOString() : nextDailyOccurrence(at, '09:00', timeZone);
}

export function nextDailyOccurrence(after: Date, localTime: string, timeZone: string): string {
  validateSchedule(localTime, timeZone);
  if (!Number.isFinite(after.getTime())) throw new Error('routine_invalid_clock');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = (at: number) => {
    const values = Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
    return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
  };
  // Start before this local date, so the second half of an overlap cannot be
  // mistaken for today's first occurrence after a restart or schedule update.
  const localDate = parts(after.getTime()).date;
  const start = Date.parse(`${localDate}T00:00:00Z`) - 24 * 60 * 60_000;
  const considered = new Set<string>();
  for (let at = start; at < start + 5 * 24 * 60 * 60_000; at += 60_000) {
    const value = parts(at);
    if (value.date < localDate || considered.has(value.date) || value.time < localTime) continue;
    considered.add(value.date);
    if (at > after.getTime()) return new Date(at).toISOString();
  }
  throw new Error('routine_schedule_unavailable');
}
