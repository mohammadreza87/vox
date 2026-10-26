/**
 * Content-free, append-only memory audit log (`vox_audit`), step 8 of
 * docs/AGENT_INTELLIGENCE_SOLUTION.md (section 4.6, "Rights and hygiene").
 *
 * A row records who did what to which memory ids, for which audience, under
 * which policy key and with what outcome. It never carries memory content,
 * topics or message text: the strict schema rejects any extra key and ids
 * cannot contain whitespace. Rows are append-only by code convention (no
 * update or delete path besides the 12-month retention sweep).
 *
 * Reserved kinds, not written yet:
 *  - TODO(worker / Step 5): `retrieval` and `prompt_memory`, once retrieval runs in the job worker or the Step 1 snapshot;
 *  - TODO(consent ledger): `consent_change`, the adaptive persistence path is owned elsewhere;
 *  - TODO(S10L): `identity_change`.
 *
 * Retention (12 months): runtime.ts wraps the configured store in
 * withAuditRetention, so appends run `sweep(auditCutoff(now))` at most once a
 * day, and it also runs startAuditRetentionSweep (once at startup, then daily)
 * whatever the S08 flags are, so rows age out when nothing appends (TIREH_AUDIT_LOG
 * off, a rollback, a quiet persona). Both are best effort and never throw; a
 * rejected sweep is reported through `onError('sweep_failed')`, a fixed,
 * content-free code. A sweep never creates the file or collection.
 */

import { createHash, randomUUID } from 'crypto';
import { appendFile, chmod, readFile, rename, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { z } from 'zod';
import { scopeKey } from '../memory/visibility';
import type { MemoryRecord } from '../types';

export type AuditKind = 'write' | 'supersede' | 'share_offer' | 'share_approve' | 'revoke' | 'delete' | 'consent_change' | 'resnapshot' | 'identity_change' | 'retrieval' | 'prompt_memory'; // retrieval/prompt_memory/consent_change/identity_change: reserved, TODO (worker / Step 1)
export type AuditOutcome = 'applied' | 'denied' | 'failed' | 'previewed';
export interface AuditRow { id: string; kind: AuditKind; personaId: string; chatKeyHash?: string; audiencePersonIds: string[]; memoryIds: string[]; policyKey?: string; actorPersonId?: string; outcome: AuditOutcome; at: Date }
export type NewAuditRow = Omit<AuditRow, 'id'>;
export interface AuditStore {
  append(row: NewAuditRow): Promise<AuditRow>;
  list(filter: { personaId: string; memoryId?: string; since?: Date; limit?: number }): Promise<AuditRow[]>;
  /** 12-month retention; the only removal path. */
  sweep(cutoff: Date): Promise<number>;
}

export const AUDIT_KINDS = ['write', 'supersede', 'share_offer', 'share_approve', 'revoke', 'delete', 'consent_change', 'resnapshot', 'identity_change', 'retrieval', 'prompt_memory'] as const satisfies readonly AuditKind[];
export const AUDIT_OUTCOMES = ['applied', 'denied', 'failed', 'previewed'] as const satisfies readonly AuditOutcome[];
export const AUDIT_RETENTION_DAYS = 365;
export const MAX_AUDIT_IDS = 200;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Opaque ids only: no whitespace, so free text cannot pass as an id. */
export const auditIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:@-]+$/);
export const POLICY_KEY_PATTERN = /^(private|people|group|project|company|org):[0-9a-f]{16}:s\d{1,9}:(normal|personal|confidential)$/;

export const newAuditRowSchema: z.ZodType<NewAuditRow> = z.object({
  kind: z.enum(AUDIT_KINDS),
  personaId: auditIdSchema,
  chatKeyHash: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  audiencePersonIds: z.array(auditIdSchema).max(MAX_AUDIT_IDS),
  memoryIds: z.array(auditIdSchema).max(MAX_AUDIT_IDS),
  policyKey: z.string().regex(POLICY_KEY_PATTERN).optional(),
  actorPersonId: auditIdSchema.optional(),
  outcome: z.enum(AUDIT_OUTCOMES),
  at: z.date().refine((date) => !Number.isNaN(date.getTime()), 'invalid date'),
}).strict();

const ids = (values: readonly string[]): string[] => [...new Set(values)].sort().slice(0, MAX_AUDIT_IDS);

/** Sorts, de-duplicates and caps the id arrays, then validates strictly (throws on content or malformed fields). */
export function normalizeAuditRow(row: NewAuditRow): NewAuditRow {
  return newAuditRowSchema.parse({ ...row, audiencePersonIds: ids(row.audiencePersonIds ?? []), memoryIds: ids(row.memoryIds ?? []) });
}

/** Rows older than this are removed by `sweep` (12-month retention). */
export function auditCutoff(now: Date): Date {
  return new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** sha256 of the chat key, hex, first 32 characters: correlatable, not reversible to a chat id. */
export function chatKeyHash(chatKey: string): string {
  return sha256(chatKey).slice(0, 32);
}

/** Bounded, content-free policy key: scope kind, hashed scope key (no person ids), share version and sensitivity. */
export function memoryPolicyKey(m: Pick<MemoryRecord, 'scope' | 'shareVersion' | 'sensitivity'>): string {
  return `${m.scope.kind}:${sha256(scopeKey(m.scope)).slice(0, 16)}:s${m.shareVersion ?? 0}:${m.sensitivity}`;
}

export function clampAuditLimit(limit?: number): number {
  return Math.max(1, Math.min(MAX_LIMIT, Number.isSafeInteger(limit) ? limit! : DEFAULT_LIMIT));
}

function matches(row: AuditRow, filter: { personaId: string; memoryId?: string; since?: Date }): boolean {
  return row.personaId === filter.personaId && (filter.memoryId === undefined || row.memoryIds.includes(filter.memoryId)) &&
    (filter.since === undefined || row.at.getTime() >= filter.since.getTime());
}

/** Filters, sorts newest first and caps a row list (shared by every store). */
export function selectAuditRows(rows: readonly AuditRow[], filter: { personaId: string; memoryId?: string; since?: Date; limit?: number }): AuditRow[] {
  return rows.filter((row) => matches(row, filter)).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, clampAuditLimit(filter.limit));
}

export class InMemoryAuditStore implements AuditStore {
  readonly rows: AuditRow[] = [];

  async append(row: NewAuditRow): Promise<AuditRow> {
    const stored: AuditRow = { id: randomUUID(), ...normalizeAuditRow(row) };
    this.rows.push(stored);
    return stored;
  }

  async list(filter: { personaId: string; memoryId?: string; since?: Date; limit?: number }): Promise<AuditRow[]> {
    return selectAuditRows(this.rows, filter);
  }

  async sweep(cutoff: Date): Promise<number> {
    const before = this.rows.length;
    const kept = this.rows.filter((row) => row.at.getTime() >= cutoff.getTime());
    this.rows.splice(0, this.rows.length, ...kept);
    return before - kept.length;
  }
}

/** One stored line back to a validated row; null for a corrupted or invalid line. */
function reviveRow(line: string): AuditRow | null {
  try {
    const { id, at, ...rest } = JSON.parse(line) as Record<string, unknown>;
    if (typeof id !== 'string' || !auditIdSchema.safeParse(id).success) return null;
    const parsed = newAuditRowSchema.safeParse({ ...rest, at: new Date(String(at)) });
    return parsed.success ? { id, ...parsed.data } : null;
  } catch { return null; }
}

/** Append-only JSONL (mode 0o600). Appends are serialized in-process; sweep is the only rewrite (tmp + rename). */
export function createFileAuditStore(path: string): AuditStore {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = chain.then(operation, operation);
    chain = next.catch(() => undefined);
    return next;
  };
  const readAll = async (): Promise<AuditRow[]> => {
    if (!existsSync(path)) return [];
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(reviveRow).filter((row): row is AuditRow => !!row);
  };
  return {
    append: (row) => serial(async () => {
      const stored: AuditRow = { id: randomUUID(), ...normalizeAuditRow(row) };
      await appendFile(path, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
      return stored;
    }),
    list: (filter) => serial(async () => selectAuditRows(await readAll(), filter)),
    sweep: (cutoff) => serial(async () => {
      if (!existsSync(path)) return 0;
      const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
      const rows = lines.map(reviveRow).filter((row): row is AuditRow => !!row);
      const kept = rows.filter((row) => row.at.getTime() >= cutoff.getTime());
      const removed = rows.length - kept.length;
      if (removed === 0) return 0;
      await writeFile(`${path}.tmp`, kept.map((row) => `${JSON.stringify(row)}\n`).join(''), { mode: 0o600 });
      await chmod(`${path}.tmp`, 0o600);
      await rename(`${path}.tmp`, path);
      return removed;
    }),
  };
}

export const AUDIT_SWEEP_EVERY_MS = 86_400_000;

/** The only signal a retention sweep gives: fixed and content-free. */
export type AuditRetentionErrorCode = 'sweep_failed';
export interface AuditRetentionOptions {
  now?: () => Date;
  sweepEveryMs?: number;
  /** Called with a fixed code when a sweep rejects; a throwing callback is ignored. */
  onError?: (code: AuditRetentionErrorCode) => void;
}

/** One best-effort sweep: never rejects; a failure reaches onError('sweep_failed'). */
function sweepBestEffort(store: Pick<AuditStore, 'sweep'>, cutoff: () => Date, onError?: (code: AuditRetentionErrorCode) => void): Promise<void> {
  return Promise.resolve().then(() => store.sweep(cutoff())).then(() => undefined, () => {
    try { onError?.('sweep_failed'); } catch { /* never throws */ }
  });
}

/**
 * The 12-month retention when nothing appends: with TIREH_AUDIT_LOG off (TIREH_SHARING_V2 alone, or both S08 flags
 * off after a rollback) nothing calls append, so rows written while the flag was on would never age out. This
 * sweeps once now and then every `sweepEveryMs` on an unref'd timer, best effort; a rejected sweep is reported
 * through `onError('sweep_failed')`. A sweep never creates the file or collection.
 */
export function startAuditRetentionSweep(store: Pick<AuditStore, 'sweep'>, options: AuditRetentionOptions = {}): { stop(): void; flush(): Promise<void> } {
  const now = options.now ?? (() => new Date());
  let pending: Promise<unknown> = Promise.resolve();
  const sweep = () => { pending = sweepBestEffort(store, () => auditCutoff(now()), options.onError); };
  sweep();
  const timer = setInterval(sweep, options.sweepEveryMs ?? AUDIT_SWEEP_EVERY_MS);
  (timer as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer), async flush() { await pending; } };
}

/**
 * The 12-month retention, scheduled: the first append and then at most one
 * append per `sweepEveryMs` also start `sweep(auditCutoff(now))`. The sweep is
 * best effort and never delays or fails the append; a rejected sweep is
 * reported through `onError('sweep_failed')`. `flush()` awaits it (tests).
 */
export function withAuditRetention(store: AuditStore, options: AuditRetentionOptions = {}): AuditStore & { flush(): Promise<void> } {
  const now = options.now ?? (() => new Date());
  const every = options.sweepEveryMs ?? AUDIT_SWEEP_EVERY_MS;
  let lastSweep = -Infinity;
  let pending: Promise<unknown> = Promise.resolve();
  return {
    async append(row) {
      const stored = await store.append(row);
      const at = now();
      if (at.getTime() - lastSweep >= every) {
        lastSweep = at.getTime();
        pending = sweepBestEffort(store, () => auditCutoff(at), options.onError);
      }
      return stored;
    },
    list: (filter) => store.list(filter),
    sweep: (cutoff) => store.sweep(cutoff),
    async flush() { await pending; },
  };
}
