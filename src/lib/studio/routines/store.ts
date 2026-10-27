import { fileRuntimeFs, assertFileRuntimePath, createFileRuntimeTransientDirectory, prepareFileRuntimeTransient, openFileRuntimeDescriptor, type BoundFileRuntimeDescriptor } from '../file-runtime-owner';
const fs = fileRuntimeFs;
import { randomUUID } from 'node:crypto';

import path from 'node:path';
import { z } from 'zod';
import type { RoutineLedger } from './types';

export const ROUTINE_LIMITS = Object.freeze({
  routines: 500, routinesPerBinding: 8, occurrences: 10_000, inbound: 10_000,
  retentionDays: 30, instructionChars: 2_000, lessonChars: 400, recentLessons: 7,
  outputChars: 4_000, fileBytes: 8 * 1024 * 1024, claimMinutes: 15,
  claimsPerTick: 4,
});
const timestamp = z.string().datetime();
const binding = z.object({
  memberId: z.string().min(1).max(200), agentId: z.string().min(1).max(200),
  telegramUserId: z.string().regex(/^[1-9]\d{0,19}$/),
  telegramChatId: z.string().regex(/^[1-9]\d{0,19}$/),
  telegramBotId: z.string().regex(/^[1-9]\d{0,19}$/),
  tokenFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(v => v.telegramUserId === v.telegramChatId);
const ledgerSchema = z.object({
  version: z.literal(1),
  routines: z.array(z.object({
    id: z.string().uuid(), binding, instruction: z.string().max(ROUTINE_LIMITS.instructionChars), timing: z.enum(['adaptive', 'fixed']),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().min(1).max(100),
    status: z.enum(['active', 'paused', 'stopped']), revision: z.number().int().positive(),
    nextRunAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp,
    recentLessons: z.array(z.string().max(ROUTINE_LIMITS.lessonChars)).max(ROUTINE_LIMITS.recentLessons),
    recentLessonDates: z.array(timestamp).max(ROUTINE_LIMITS.recentLessons),
    decisionDay: z.string().nullable(), decisionCount: z.number().int().min(0).max(8), lastDeliveredAt: timestamp.nullable(),
  }).strict()).max(ROUTINE_LIMITS.routines),
  occurrences: z.array(z.object({
    id: z.string().uuid(), routineId: z.string().uuid(), revision: z.number().int().positive(),
    scheduledAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    status: z.enum(['generating', 'dispatching', 'accepted', 'failed', 'unknown', 'cancelled', 'deferred']),
    messageId: z.string().max(100).optional(),
  }).strict()).max(ROUTINE_LIMITS.occurrences),
  inbound: z.array(z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestamp }).strict()).max(ROUTINE_LIMITS.inbound),
}).strict();

export function validateBinding(value: unknown) { return binding.parse(value); }

/** One host, shared local filesystem only. All transactions own a nonempty
 * directory atomically installed by rename. Dead-process cleanup removes only
 * the observed owner filename; another contender's nonempty lock cannot be
 * removed by stale cleanup. PID reuse fails closed. Never use on network FS. */
export class RoutineFileStore {
  constructor(readonly filePath: string) {
    assertFileRuntimePath(filePath);
    if (!path.isAbsolute(filePath)) throw new Error('routine_absolute_path_required');
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }

  /** Synchronous final export fence: any in-flight transaction fails closed. */
  snapshot(): RoutineLedger | null {
    if (fs.existsSync(`${this.filePath}.lock`)) return null;
    try { return this.read(); } catch { return null; }
  }

  async transaction<T>(callback: (ledger: RoutineLedger) => T): Promise<T> {
    const release = await this.acquire();
    try {
      const ledger = this.read();
      const result = callback(ledger);
      this.write(ledger);
      return structuredClone(result);
    } finally { release(); }
  }

  private read(): RoutineLedger {
    try {
      if (fs.statSync(this.filePath).size > ROUTINE_LIMITS.fileBytes) throw new Error('routine_ledger_capacity');
      return ledgerSchema.parse(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, routines: [], occurrences: [], inbound: [] };
      throw new Error('routine_ledger_unavailable');
    }
  }

  private write(ledger: RoutineLedger): void {
    const data = JSON.stringify(ledgerSchema.parse(ledger));
    if (Buffer.byteLength(data) > ROUTINE_LIMITS.fileBytes) throw new Error('routine_ledger_capacity');
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor: BoundFileRuntimeDescriptor | undefined;
    try {
      prepareFileRuntimeTransient(temporary);
      descriptor = openFileRuntimeDescriptor(temporary, 'wx', 0o600);
      descriptor.writeFile(data);
      descriptor.sync();
      descriptor.close(); descriptor = undefined;
      fs.renameSync(temporary, this.filePath);
      const parent = fs.openSync(path.dirname(this.filePath), 'r');
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    } finally {
      if (descriptor !== undefined) descriptor.close();
      try { fs.unlinkSync(temporary); } catch { /* renamed or failed before create */ }
    }
  }

  private async acquire(): Promise<() => void> {
    const lock = `${this.filePath}.lock`;
    const owner = `${process.pid}-${randomUUID()}`;
    const staging = `${lock}.${owner}`;
    createFileRuntimeTransientDirectory(staging);
    fs.writeFileSync(path.join(staging, owner), '', { mode: 0o600 });
    const deadline = Date.now() + 2_000;
    try {
      for (;;) {
        try {
          fs.renameSync(staging, lock);
          return () => {
            fs.unlinkSync(path.join(lock, owner));
            try { fs.rmdirSync(lock); }
            catch (error) {
              // Another contender can atomically replace our now-empty directory
              // with its populated lock. Its lock must remain untouched.
              if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
            }
          };
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        }
        this.cleanDeadLock(lock);
        if (Date.now() >= deadline) throw new Error('routine_ledger_busy');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      try { fs.rmSync(staging, { recursive: true }); } catch { /* installed */ }
    }
  }

  private cleanDeadLock(lock: string): void {
    try {
      const names = fs.readdirSync(lock);
      if (names.length !== 1 || !/^\d+-[a-f0-9-]{36}$/.test(names[0])) return;
      const pid = Number(names[0].split('-')[0]);
      try { process.kill(pid, 0); return; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
      try { fs.unlinkSync(path.join(lock, names[0])); } catch { /* another reaper */ }
      try { fs.rmdirSync(lock); } catch { /* acquired by a live contender */ }
    } catch { /* contender removed the old lock */ }
  }
}
