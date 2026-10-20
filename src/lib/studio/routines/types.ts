export interface RoutineBinding {
  memberId: string;
  agentId: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramBotId: string;
  /** SHA-256 identity of the exact bot credential, never the credential. */
  tokenFingerprint: string;
}

export interface Routine {
  id: string;
  binding: RoutineBinding;
  instruction: string;
  timing: 'adaptive' | 'fixed';
  localTime: string;
  timeZone: string;
  status: 'active' | 'paused' | 'stopped';
  revision: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  recentLessons: string[];
  recentLessonDates: string[];
  decisionDay: string | null;
  decisionCount: number;
  lastDeliveredAt: string | null;
}

export type RoutineRequest =
  | { type: 'create'; inboundMessageId: string; instruction: string; timing?: 'adaptive' | 'fixed'; localTime?: string; timeZone: string }
  | { type: 'list' }
  | { type: 'update'; inboundMessageId: string; routineId: string; instruction?: string; timing?: 'adaptive' | 'fixed'; localTime?: string; timeZone?: string }
  | { type: 'pause' | 'resume' | 'stop'; inboundMessageId: string; routineId: string };

export type RoutineReceipt = { status: 'accepted' | 'failed' | 'unknown'; messageId?: string };
export interface RoutineGuard { signal: AbortSignal; isCurrent(): Promise<boolean>; isCurrentNow(): boolean }
export interface RoutineDependencies {
  filePath: string;
  /** Re-read current authenticated account, role, agent access and bot identity.
   * Optional relationship-memory consent never authorizes these routines. */
  authorize(binding: RoutineBinding): Promise<boolean>;
  /** Current committed Studio authority, synchronous and fail-closed while busy. */
  authorizeNow(binding: RoutineBinding): boolean;
  chooseTiming?(input: RoutineGuard & {
    binding: RoutineBinding; instruction: string; timeZone: string; localTime: string;
    lastDeliveredAt: string | null; recentLessons: string[];
  }): Promise<{ action: 'send' | 'defer'; retryAfterMinutes?: number }>;
  generate(input: RoutineGuard & {
    binding: RoutineBinding; instruction: string; recentLessons: string[];
  }): Promise<string>;
  /** Exactly one transport attempt. Await isCurrent immediately before exporting
   * text, then synchronously check the adapter's committed authority/kill flag.
   * Throw, timeout or unclear remote result MUST mean unknown, never retry. */
  send(input: RoutineGuard & {
    binding: RoutineBinding; text: string; occurrenceId: string;
  }): Promise<RoutineReceipt>;
  now?(): Date;
  enabled?(): boolean;
}

export interface Occurrence {
  id: string;
  routineId: string;
  revision: number;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
  status: 'generating' | 'dispatching' | 'accepted' | 'failed' | 'unknown' | 'cancelled' | 'deferred';
  messageId?: string;
}

export interface RoutineLedger {
  version: 1;
  routines: Routine[];
  occurrences: Occurrence[];
  inbound: { key: string; createdAt: string }[];
}
