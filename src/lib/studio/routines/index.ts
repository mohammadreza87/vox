import { createHash, randomUUID } from 'node:crypto';
import { adaptiveEligible, localClock, nextAdaptiveOccurrence, nextDailyOccurrence, validateSchedule } from './schedule';
import { ROUTINE_LIMITS, RoutineFileStore, validateBinding } from './store';
import type { Occurrence, Routine, RoutineBinding, RoutineDependencies, RoutineGuard, RoutineLedger, RoutineRequest } from './types';
export type * from './types';
export { ROUTINE_LIMITS } from './store';

const sameBinding = (a: RoutineBinding, b: RoutineBinding) =>
  a.memberId === b.memberId && a.agentId === b.agentId && a.telegramUserId === b.telegramUserId &&
  a.telegramChatId === b.telegramChatId && a.telegramBotId === b.telegramBotId && a.tokenFingerprint === b.tokenFingerprint;
const sameOwner = (a: RoutineBinding, b: RoutineBinding) =>
  a.memberId === b.memberId && a.agentId === b.agentId && a.telegramUserId === b.telegramUserId &&
  a.telegramChatId === b.telegramChatId && a.telegramBotId === b.telegramBotId;
const cleanInstruction = (value: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > ROUTINE_LIMITS.instructionChars) throw new Error('routine_invalid_instruction');
  return value.trim();
};
const abortable = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const abort = () => reject(new Error('routine_aborted'));
  if (signal.aborted) { work.catch(() => {}); abort(); return; }
  signal.addEventListener('abort', abort, { once: true });
  work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});

/** Explicit daily user tasks only. No imported conversation, relationship inference,
 * consent grant, generic reminder, remote retries, or multi-host coordination. */
export class RequestedRoutineEngine {
  private readonly store: RoutineFileStore;
  private readonly controller = new AbortController();
  private readonly active = new Map<string, AbortController>();
  constructor(private readonly dependencies: RoutineDependencies) {
    this.store = new RoutineFileStore(dependencies.filePath);
  }
  close(): void {
    this.controller.abort();
    for (const value of this.active.values()) value.abort();
  }
  private now(): Date { return this.dependencies.now?.() ?? new Date(); }
  private enabled(): boolean { return !this.controller.signal.aborted && (this.dependencies.enabled?.() ?? false); }
  private authorizedNow(binding: RoutineBinding): boolean {
    try { return this.enabled() && this.dependencies.authorizeNow(structuredClone(binding)); } catch { return false; }
  }
  private async authorized(binding: RoutineBinding): Promise<boolean> {
    if (!this.enabled()) return false;
    try { return await this.dependencies.authorize(structuredClone(binding)) && this.authorizedNow(binding); }
    catch { return false; }
  }

  /** Acknowledgement fence; a replay cannot claim a subsequently resumed/new task stopped. */
  stoppedNow(binding: RoutineBinding): boolean {
    try {
      const ledger = this.store.snapshot();
      return this.authorizedNow(binding) && !!ledger && ledger.routines.filter(r => sameOwner(r.binding, binding)).every(r => r.status === 'stopped');
    } catch { return false; }
  }

  async manage(rawBinding: RoutineBinding, request: RoutineRequest): Promise<{ routines: Routine[]; duplicate?: boolean }> {
    if (!request || !['create', 'list', 'update', 'pause', 'resume', 'stop', 'stop-all'].includes(request.type)) throw new Error('routine_invalid_request');
    const binding = validateBinding(rawBinding);
    if (!await this.authorized(binding)) throw new Error('routine_authority_denied');
    const now = this.now();
    const result = await this.store.transaction(ledger => {
      this.prune(ledger, now);
      if (!this.authorizedNow(binding)) throw new Error('routine_authority_denied');
      const visible = () => ledger.routines.filter(r => sameOwner(r.binding, binding));
      if (request.type === 'list') return { routines: visible() };
      if (!request.inboundMessageId || request.inboundMessageId.length > 100) throw new Error('routine_invalid_message');
      const key = createHash('sha256').update(JSON.stringify([binding.memberId, binding.telegramUserId, binding.telegramBotId, request.inboundMessageId])).digest('hex');
      if (ledger.inbound.some(item => item.key === key)) return { routines: visible(), duplicate: true };
      if (ledger.inbound.length >= ROUTINE_LIMITS.inbound) throw new Error('routine_dedup_capacity');
      if (request.type === 'create') {
        if (ledger.routines.length >= ROUTINE_LIMITS.routines || visible().filter(r => r.status !== 'stopped').length >= ROUTINE_LIMITS.routinesPerBinding) throw new Error('routine_capacity');
        const instruction = cleanInstruction(request.instruction);
        const timing = request.timing ?? (request.localTime ? 'fixed' : 'adaptive');
        if (timing !== 'adaptive' && timing !== 'fixed') throw new Error('routine_invalid_timing');
        if (timing === 'fixed' && !request.localTime) throw new Error('routine_invalid_time');
        const localTime = request.localTime ?? '09:00';
        validateSchedule(localTime, request.timeZone);
        ledger.routines.push({
          id: randomUUID(), binding, instruction, timing, localTime, timeZone: request.timeZone,
          status: 'active', revision: 1, nextRunAt: timing === 'adaptive' ? nextAdaptiveOccurrence(now, request.timeZone) : nextDailyOccurrence(now, localTime, request.timeZone),
          createdAt: now.toISOString(), updatedAt: now.toISOString(), recentLessons: [], recentLessonDates: [],
          decisionDay: null, decisionCount: 0, lastDeliveredAt: null,
        });
      } else if (request.type === 'stop-all') {
        // One owner-scoped transaction and inbound receipt, including old token
        // bindings owned by the currently authenticated rotated credential.
        for (const routine of visible()) {
          this.active.get(routine.id)?.abort();
          routine.revision++; routine.updatedAt = now.toISOString();
          routine.status = 'stopped'; routine.instruction = ''; routine.recentLessons = []; routine.recentLessonDates = []; routine.nextRunAt = null;
          for (const occurrence of ledger.occurrences) if (occurrence.routineId === routine.id && occurrence.status === 'generating') {
            occurrence.status = 'cancelled'; occurrence.updatedAt = now.toISOString();
          }
          // Dispatching, accepted and unknown entries remain transport receipts.
        }
      } else {
        const routine = visible().find(r => r.id === request.routineId);
        if (!routine) throw new Error('routine_not_found');
        if (routine.status === 'stopped' && request.type !== 'stop') throw new Error('routine_stopped');
        this.active.get(routine.id)?.abort();
        routine.revision++; routine.updatedAt = now.toISOString();
        if (request.type === 'stop') {
          routine.status = 'stopped'; routine.instruction = ''; routine.recentLessons = []; routine.recentLessonDates = []; routine.nextRunAt = null;
        } else if (request.type === 'pause') { routine.status = 'paused'; routine.nextRunAt = null; }
        else {
          if (request.type === 'update') {
            if (request.instruction !== undefined) { routine.instruction = cleanInstruction(request.instruction); routine.recentLessons = []; routine.recentLessonDates = []; }
            if (request.timing !== undefined) routine.timing = request.timing;
            else if (request.localTime !== undefined) routine.timing = 'fixed';
            if (request.localTime !== undefined) routine.localTime = request.localTime;
            if (request.timeZone !== undefined) routine.timeZone = request.timeZone;
            validateSchedule(routine.localTime, routine.timeZone);
          }
          // Current identity authorizes a rotated credential binding. Editing a
          // paused task preserves its pause; only resume activates it again.
          routine.binding = binding;
          if (request.type === 'resume') routine.status = 'active';
          const dayConsumed = ledger.occurrences.some(o => o.routineId === routine.id && ['accepted', 'dispatching', 'unknown', 'failed'].includes(o.status) && localClock(new Date(o.createdAt), routine.timeZone).day === localClock(now, routine.timeZone).day);
          routine.nextRunAt = routine.status === 'paused' ? null : routine.timing === 'adaptive' && !dayConsumed
            ? nextAdaptiveOccurrence(now, routine.timeZone)
            : nextDailyOccurrence(now, routine.timing === 'adaptive' ? '09:00' : routine.localTime, routine.timeZone);
        }
        for (const occurrence of ledger.occurrences) {
          if (occurrence.routineId === routine.id && occurrence.status === 'generating') { occurrence.status = 'cancelled'; occurrence.updatedAt = now.toISOString(); }
        }
      }
      ledger.inbound.push({ key, createdAt: now.toISOString() });
      return { routines: visible() };
    });
    if (!this.authorizedNow(binding)) throw new Error('routine_authority_denied');
    return result;
  }

  async tick(): Promise<{ claimed: number; accepted: number; failed: number; unknown: number }> {
    const result = { claimed: 0, accepted: 0, failed: 0, unknown: 0 };
    if (!this.enabled()) return result;
    // Retention also runs when every task is paused or stopped.
    const ids = await this.store.transaction(ledger => {
      this.prune(ledger, this.now());
      return ledger.routines.filter(r => r.status === 'active' && r.nextRunAt && r.nextRunAt <= this.now().toISOString())
        .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!) || a.id.localeCompare(b.id)).map(r => r.id);
    });
    // Every claim still reserves under the filesystem lock.
    for (const id of ids) {
      if (!this.enabled() || result.claimed >= ROUTINE_LIMITS.claimsPerTick) break;
      const claim = await this.claim(id);
      if (!claim) continue;
      result.claimed++;
      const state = await this.execute(claim.routine, claim.occurrence);
      if (state === 'accepted' || state === 'failed' || state === 'unknown') result[state]++;
    }
    return result;
  }

  private async claim(id: string): Promise<{ routine: Routine; occurrence: Occurrence } | null> {
    const now = this.now();
    return this.store.transaction(ledger => {
      this.prune(ledger, now);
      const routine = ledger.routines.find(r => r.id === id);
      if (!this.enabled() || !routine || routine.status !== 'active' || !routine.nextRunAt || routine.nextRunAt > now.toISOString()) return null;
      const pending = ledger.occurrences.some(o => o.routineId === id && ['generating', 'dispatching'].includes(o.status));
      if (pending) return null;
      if (routine.timing === 'adaptive' && !adaptiveEligible(now, routine.timeZone)) {
        routine.nextRunAt = nextAdaptiveOccurrence(now, routine.timeZone); return null;
      }
      const day = localClock(now, routine.timeZone).day;
      if (routine.decisionDay !== day) { routine.decisionDay = day; routine.decisionCount = 0; }
      if (routine.timing === 'adaptive' && routine.decisionCount >= 8) {
        routine.nextRunAt = nextDailyOccurrence(now, '09:00', routine.timeZone); return null;
      }
      if (ledger.occurrences.some(o => o.routineId === id && !['deferred', 'cancelled', 'generating'].includes(o.status) && localClock(new Date(o.createdAt), routine.timeZone).day === day)) {
        const next = nextDailyOccurrence(now, routine.timing === 'adaptive' ? '09:00' : routine.localTime, routine.timeZone);
        routine.nextRunAt = localClock(new Date(next), routine.timeZone).day === day
          ? nextDailyOccurrence(new Date(next), routine.timing === 'adaptive' ? '09:00' : routine.localTime, routine.timeZone) : next;
        return null;
      }
      if (ledger.occurrences.length >= ROUTINE_LIMITS.occurrences) throw new Error('routine_occurrence_capacity');
      const occurrence: Occurrence = { id: randomUUID(), routineId: id, revision: routine.revision, scheduledAt: routine.nextRunAt,
        createdAt: now.toISOString(), updatedAt: now.toISOString(), status: 'generating' };
      ledger.occurrences.push(occurrence);
      if (routine.timing === 'adaptive') routine.decisionCount++;
      routine.nextRunAt = nextDailyOccurrence(now, routine.timing === 'adaptive' ? '09:00' : routine.localTime, routine.timeZone);
      return { routine, occurrence };
    });
  }

  private guard(routine: Routine, occurrence: Occurrence, controller: AbortController): RoutineGuard {
    const matches = (ledger: RoutineLedger | null) => {
      if (!this.enabled() || controller.signal.aborted) return false;
      const current = ledger?.routines.find(r => r.id === routine.id);
      const job = ledger?.occurrences.find(o => o.id === occurrence.id);
      return Boolean(this.authorizedNow(routine.binding) && current && job && current.status === 'active' && current.revision === routine.revision && sameBinding(current.binding, routine.binding) &&
        ['generating', 'dispatching'].includes(job.status) && (routine.timing !== 'adaptive' || adaptiveEligible(this.now(), routine.timeZone)));
    };
    const isCurrentNow = () => matches(this.store.snapshot());
    return { signal: controller.signal, isCurrentNow, isCurrent: async () => {
      if (!this.enabled() || controller.signal.aborted) return false;
      if (!await this.authorized(routine.binding)) { await this.pauseInvalid(routine); return false; }
      // Async checks wait for concurrent transactions and inspect committed state
      // under the lock. The transport's synchronous last fence still denies busy.
      return this.store.transaction(ledger => matches(ledger));
    } };
  }

  private async pauseInvalid(routine: Routine): Promise<void> {
    await this.store.transaction(ledger => {
      const current = ledger.routines.find(r => r.id === routine.id);
      if (current?.revision === routine.revision && current.status === 'active') {
        current.status = 'paused'; current.revision++; current.nextRunAt = null; current.updatedAt = this.now().toISOString();
      }
    });
  }

  private async execute(routine: Routine, occurrence: Occurrence): Promise<Occurrence['status']> {
    const controller = new AbortController(); this.active.set(routine.id, controller);
    const guard = this.guard(routine, occurrence, controller);
    const timeout = setTimeout(() => controller.abort(), ROUTINE_LIMITS.claimMinutes * 60_000);
    try {
      if (!await guard.isCurrent()) return await this.finish(occurrence, 'cancelled');
      if (routine.timing === 'adaptive') {
        let choice: { action: 'send' | 'defer'; retryAfterMinutes?: number } = { action: 'defer' };
        try {
          if (this.dependencies.chooseTiming) choice = await abortable(this.dependencies.chooseTiming({ ...guard, binding: structuredClone(routine.binding), instruction: routine.instruction,
            timeZone: routine.timeZone, localTime: routine.localTime, lastDeliveredAt: routine.lastDeliveredAt, recentLessons: [...routine.recentLessons] }), controller.signal);
        } catch { /* No timing verdict means no delivery. */ }
        if (!await guard.isCurrent()) return await this.finish(occurrence, 'cancelled');
        if (choice.action !== 'send') {
          const delay = Number.isFinite(choice.retryAfterMinutes) ? Math.max(60, Math.min(24 * 60, choice.retryAfterMinutes!)) : 60;
          return await this.store.transaction(ledger => {
            const current = ledger.routines.find(r => r.id === routine.id);
            const job = ledger.occurrences.find(o => o.id === occurrence.id)!;
            job.status = 'deferred'; job.updatedAt = this.now().toISOString();
            if (current?.status === 'active' && current.revision === routine.revision && current.decisionCount < 8) {
              const retry = new Date(this.now().getTime() + delay * 60_000);
              if (adaptiveEligible(retry, routine.timeZone) && localClock(retry, routine.timeZone).day === current.decisionDay) current.nextRunAt = retry.toISOString();
            }
            return 'deferred' as const;
          });
        }
      }
      if (!await guard.isCurrent()) return await this.finish(occurrence, 'cancelled');
      let text: string;
      try { text = await abortable(this.dependencies.generate({ ...guard, binding: structuredClone(routine.binding), instruction: routine.instruction, recentLessons: [...routine.recentLessons] }), controller.signal); }
      catch { return await this.finish(occurrence, 'failed'); }
      if (typeof text !== 'string' || !text.trim() || text.length > ROUTINE_LIMITS.outputChars) return await this.finish(occurrence, 'failed');
      if (!await guard.isCurrent()) return await this.finish(occurrence, 'cancelled');
      const reserved = await this.store.transaction(ledger => {
        const current = ledger.routines.find(r => r.id === routine.id);
        const job = ledger.occurrences.find(o => o.id === occurrence.id);
        if (!this.authorizedNow(routine.binding) || controller.signal.aborted || current?.revision !== routine.revision || current.status !== 'active' || job?.status !== 'generating') return false;
        job.status = 'dispatching'; job.updatedAt = this.now().toISOString(); return true;
      });
      if (!reserved || !await guard.isCurrent()) return await this.finish(occurrence, 'cancelled');
      let receipt;
      try { receipt = await abortable(this.dependencies.send({ ...guard, binding: structuredClone(routine.binding), text: text.trim(), occurrenceId: occurrence.id }), controller.signal); }
      catch { return await this.finish(occurrence, 'unknown'); }
      const status = receipt && ['accepted', 'failed', 'unknown'].includes(receipt.status) ? receipt.status : 'unknown';
      return await this.finish(occurrence, status, status === 'accepted' ? text : undefined, receipt?.messageId);
    } finally { clearTimeout(timeout); if (this.active.get(routine.id) === controller) this.active.delete(routine.id); }
  }

  private async finish(occurrence: Occurrence, status: Occurrence['status'], text?: string, messageId?: string): Promise<Occurrence['status']> {
    return this.store.transaction(ledger => {
      const job = ledger.occurrences.find(o => o.id === occurrence.id);
      if (!job || !['generating', 'dispatching'].includes(job.status)) return job?.status ?? 'cancelled';
      job.status = status; job.updatedAt = this.now().toISOString();
      if (messageId && /^[0-9]{1,30}$/.test(messageId)) job.messageId = messageId;
      const routine = ledger.routines.find(r => r.id === occurrence.routineId);
      if (status === 'accepted' && routine?.status === 'active' && routine.revision === occurrence.revision && text && this.authorizedNow(routine.binding)) {
        routine.lastDeliveredAt = job.updatedAt;
        routine.recentLessons = [...routine.recentLessons, text.slice(0, ROUTINE_LIMITS.lessonChars)].slice(-ROUTINE_LIMITS.recentLessons);
        routine.recentLessonDates = [...routine.recentLessonDates, job.updatedAt].slice(-ROUTINE_LIMITS.recentLessons);
      }
      return status;
    });
  }

  private prune(ledger: RoutineLedger, now: Date): void {
    const oldest = new Date(now.getTime() - ROUTINE_LIMITS.retentionDays * 86_400_000).toISOString();
    const expired = new Date(now.getTime() - ROUTINE_LIMITS.claimMinutes * 60_000).toISOString();
    for (const occurrence of ledger.occurrences) {
      if (occurrence.updatedAt < expired && ['generating', 'dispatching'].includes(occurrence.status)) {
        occurrence.status = occurrence.status === 'dispatching' ? 'unknown' : 'failed'; occurrence.updatedAt = now.toISOString();
      }
    }
    ledger.occurrences = ledger.occurrences.filter(o => o.updatedAt >= oldest);
    ledger.inbound = ledger.inbound.filter(item => item.createdAt >= oldest);
    ledger.routines = ledger.routines.filter(r => r.status !== 'stopped' || r.updatedAt >= oldest);
    for (const routine of ledger.routines) {
      const recent = routine.recentLessons.map((text, i) => ({ text, at: routine.recentLessonDates[i] })).filter(item => item.at >= oldest);
      routine.recentLessons = recent.map(item => item.text); routine.recentLessonDates = recent.map(item => item.at);
    }
  }
}
