/**
 * Content-free decision log for calibrating the triage pre-pass
 * (docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.8), behind TIREH_DECISION_LOG=1.
 *
 * A row records which catalogue questions were asked, the answers
 * (probabilities and fixed catalogue values only), timing, tokens, the route a
 * reply would take, the persona id, the chat kind and a script-ratio language
 * label. It never holds message text, persona or member names, person ids,
 * chat ids or skill ids: the strict schema admits catalogue names and values
 * only and has no free-text field. Writes are fire-and-forget and never affect
 * delivery. Rows older than 90 days are swept.
 *
 * Calibration joins labels to rows by the store-generated row id; the labelled
 * set must come from a separately consented or synthetic evaluation run.
 */

import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { Firestore, Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { DecisionUnknownReason } from '../../adaptive/decisions';
import { tirehFlags, type TriageQuestionSet } from '../flags';
import type { DecideDetail, DecisionAnswer, DecisionQuestion, Triage } from '../triage';
import { CATALOGUE_CHOICE_VALUES, IMAGE_V1_QUESTION_NAMES, SKILL_SELECTED, V1_QUESTION_NAMES, V2_QUESTION_NAMES } from './catalog';
import { scriptLanguage } from './language';

export interface DecisionLogRow {
  id: string;
  questionSetVersion: 'v1' | 'v2' | 'v2-live' | 'image-v1';
  names: string[];
  answers: Array<
    | { name: string; type: 'predicate'; probability: number }
    | { name: string; type: 'choice'; choice: string; confidence: number; probabilities?: Array<{ value: string; probability: number }> }
    | { name: string; type: 'score'; score: number; confidence: number }>;
  outcome: 'answered' | 'unknown';
  unknownReason?: string;
  elapsedMs: number;
  inputTokens?: number;
  routeTaken: 'quick' | 'thoughtful' | 'web' | 'untriaged';
  personaId: string;
  chatKind: 'private' | 'group';
  language: 'fa' | 'en' | 'mixed' | 'unknown';
  at: Date;
}
export type NewDecisionLogRow = Omit<DecisionLogRow, 'id'>;
type LogAnswer = NewDecisionLogRow['answers'][number];

export interface DecisionLogStore {
  append(row: NewDecisionLogRow): Promise<void>;
  list(filter?: { since?: Date; until?: Date; limit?: number }): Promise<DecisionLogRow[]>;
  sweep(now: Date, retentionDays?: number): Promise<number>;
}

/** Fire-and-forget: record() is synchronous, never throws and never logs row content. */
export interface DecisionLogSink { record(row: NewDecisionLogRow): void }

export const DECISION_LOG_COLLECTION = 'vox_decision_log';
export const DECISION_LOG_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
const MAX_ENTRIES = 32;
const DEFAULT_LIST_LIMIT = 1000;
const MAX_LIST_LIMIT = 10_000;

const QUESTION_NAMES: ReadonlySet<string> = new Set<string>([...V1_QUESTION_NAMES, ...V2_QUESTION_NAMES, ...IMAGE_V1_QUESTION_NAMES]);
const UNKNOWN_REASONS = ['disabled', 'invalid_input', 'unauthorized', 'stale', 'cancelled', 'timeout', 'rate_limited', 'unsupported',
  'provider_error', 'malformed', 'refusal', 'budget', 'busy', 'circuit_open', 'decider_error', 'no_answers',
] as const satisfies ReadonlyArray<DecisionUnknownReason | 'decider_error' | 'no_answers'>;

const unitSchema = z.number().min(0).max(1);
const nameSchema = z.string().refine((name) => QUESTION_NAMES.has(name));
const inCatalogue = (name: string, value: string) => (CATALOGUE_CHOICE_VALUES[name] ?? []).includes(value);

const answerSchema = z.discriminatedUnion('type', [
  z.object({ name: nameSchema, type: z.literal('predicate'), probability: unitSchema }).strict(),
  z.object({ name: nameSchema, type: z.literal('choice'), choice: z.string(), confidence: unitSchema,
    probabilities: z.array(z.object({ value: z.string(), probability: unitSchema }).strict()).max(MAX_ENTRIES).optional() }).strict()
    .refine((a) => inCatalogue(a.name, a.choice) && (a.probabilities ?? []).every((p) => inCatalogue(a.name, p.value))),
  z.object({ name: nameSchema, type: z.literal('score'), score: z.number().finite(), confidence: unitSchema }).strict(),
]);

/** Strict: catalogue names and values only, no free-text field. */
export const newDecisionLogRowSchema: z.ZodType<NewDecisionLogRow> = z.object({
  questionSetVersion: z.enum(['v1', 'v2', 'v2-live', 'image-v1']),
  names: z.array(nameSchema).min(1).max(MAX_ENTRIES),
  answers: z.array(answerSchema).max(MAX_ENTRIES),
  outcome: z.enum(['answered', 'unknown']),
  unknownReason: z.enum(UNKNOWN_REASONS).optional(),
  elapsedMs: z.number().int().min(0).max(600_000),
  inputTokens: z.number().int().min(0).optional(),
  routeTaken: z.enum(['quick', 'thoughtful', 'web', 'untriaged']),
  personaId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  chatKind: z.enum(['private', 'group']),
  language: z.enum(['fa', 'en', 'mixed', 'unknown']),
  at: z.date(),
}).strict();

const storedIdSchema = z.string().min(1).max(128);

/** A stored row (`at` as Date, ISO string or Firestore Timestamp) plus its id; null when invalid. */
function parseStoredRow(id: unknown, value: unknown): DecisionLogRow | null {
  if (!storedIdSchema.safeParse(id).success || !value || typeof value !== 'object') return null;
  const { id: _ignored, at, ...rest } = value as Record<string, unknown>;
  void _ignored;
  const date = at instanceof Date ? at
    : typeof at === 'string' ? new Date(at)
    : at && typeof at === 'object' && typeof (at as { toDate?: unknown }).toDate === 'function' ? (at as { toDate(): Date }).toDate()
    : undefined;
  if (!date || Number.isNaN(date.getTime())) return null;
  const row = newDecisionLogRowSchema.safeParse({ ...rest, at: date });
  return row.success ? { id: id as string, ...row.data } : null;
}

export interface DecisionLogRowInput {
  set: TriageQuestionSet | 'image-v1';
  questions: readonly DecisionQuestion[];
  answers?: Record<string, DecisionAnswer>;
  detail?: DecideDetail;
  triage: Triage | null;
  /** The decider threw: the row is unknown 'decider_error'. */
  failed?: boolean;
  elapsedMs: number;
  webSearchAvailable: boolean;
  fastModel: boolean;
  personaId: string;
  chatKind: 'private' | 'group';
  /** Used only for scriptLanguage(); never stored. */
  latestMessage: string;
  at: Date;
}

const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** One answer as logged: catalogue values only, the skill id replaced, malformed answers dropped. */
function logAnswer(question: DecisionQuestion, answer: DecisionAnswer | undefined): LogAnswer | null {
  if (!answer || typeof answer !== 'object' || answer.type !== question.type) return null;
  const name = question.name;
  if (answer.type === 'predicate') return unit(answer.probability) ? { name, type: 'predicate', probability: answer.probability } : null;
  if (answer.type === 'score') return Number.isFinite(answer.score) && unit(answer.confidence) ? { name, type: 'score', score: answer.score, confidence: answer.confidence } : null;
  if (typeof answer.choice !== 'string' || !unit(answer.confidence)) return null;
  // Never a skill id: only whether a playbook was chosen.
  if (name === 'skill') return { name, type: 'choice', choice: answer.choice === 'none' ? 'none' : SKILL_SELECTED, confidence: answer.confidence };
  if (!inCatalogue(name, answer.choice)) return null;
  const probabilities = Array.isArray(answer.probabilities)
    ? answer.probabilities.filter((p) => p && typeof p.value === 'string' && inCatalogue(name, p.value) && unit(p.probability)).map((p) => ({ value: p.value, probability: p.probability }))
    : [];
  return { name, type: 'choice', choice: answer.choice, confidence: answer.confidence, ...(probabilities.length ? { probabilities } : {}) };
}

/** The route composeReply would take for this triage (the same formula). */
function routeTaken(input: DecisionLogRowInput): NewDecisionLogRow['routeTaken'] {
  const { triage } = input;
  if (!triage) return 'untriaged';
  if (input.webSearchAvailable && triage.needsWeb) return 'web';
  return triage.effort === 'quick' && input.fastModel ? 'quick' : 'thoughtful';
}

/**
 * Builds a content-free row from what gateway triage saw. Pure; returns null
 * when the result would not validate. `latestMessage` feeds only the
 * script-ratio label and is discarded.
 */
export function decisionLogRow(input: DecisionLogRowInput): NewDecisionLogRow | null {
  try {
    const raw = input.failed ? {} : input.detail?.answers ?? input.answers ?? {};
    const answers = input.failed ? [] : input.questions.flatMap((q) => {
      const a = logAnswer(q, (raw as Record<string, DecisionAnswer | undefined>)[q.name]);
      return a ? [a] : [];
    });
    let outcome: NewDecisionLogRow['outcome'];
    let unknownReason: string | undefined;
    if (input.failed) { outcome = 'unknown'; unknownReason = 'decider_error'; }
    else if (input.detail) { outcome = input.detail.outcome; unknownReason = input.detail.outcome === 'unknown' ? input.detail.unknownReason : undefined; }
    else if (Object.keys(raw).length > 0) outcome = 'answered';
    else { outcome = 'unknown'; unknownReason = 'no_answers'; }
    if (unknownReason !== undefined && !(UNKNOWN_REASONS as readonly string[]).includes(unknownReason)) unknownReason = undefined;
    const elapsed = input.detail?.elapsedMs ?? input.elapsedMs;
    const inputTokens = input.detail?.inputTokens;
    const row = {
      questionSetVersion: input.set,
      names: input.questions.map((q) => q.name),
      answers,
      outcome,
      ...(unknownReason !== undefined ? { unknownReason } : {}),
      elapsedMs: Math.min(600_000, Math.max(0, Math.round(Number.isFinite(elapsed) ? elapsed : 0))),
      ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
      routeTaken: routeTaken(input),
      personaId: input.personaId,
      chatKind: input.chatKind,
      language: scriptLanguage(input.latestMessage),
      at: input.at,
    };
    const parsed = newDecisionLogRowSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const withoutUndefined = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T;

const inRange = (at: Date, filter: { since?: Date; until?: Date }) =>
  (!filter.since || at.getTime() >= filter.since.getTime()) && (!filter.until || at.getTime() < filter.until.getTime());

const listLimit = (limit: number | undefined) =>
  Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(typeof limit === 'number' && Number.isFinite(limit) ? limit : DEFAULT_LIST_LIMIT)));

const cutoffOf = (now: Date, retentionDays: number) => now.getTime() - retentionDays * DAY_MS;

export class InMemoryDecisionLogStore implements DecisionLogStore {
  readonly rows: DecisionLogRow[] = [];

  async append(row: NewDecisionLogRow): Promise<void> {
    this.rows.push({ id: randomUUID(), ...withoutUndefined(row), at: new Date(row.at) });
  }

  async list(filter: { since?: Date; until?: Date; limit?: number } = {}): Promise<DecisionLogRow[]> {
    return this.rows.filter((r) => inRange(r.at, filter)).sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, listLimit(filter.limit)).map((r) => ({ ...r, at: new Date(r.at) }));
  }

  async sweep(now: Date, retentionDays = DECISION_LOG_RETENTION_DAYS): Promise<number> {
    const cutoff = cutoffOf(now, retentionDays);
    const kept = this.rows.filter((r) => r.at.getTime() >= cutoff);
    const removed = this.rows.length - kept.length;
    this.rows.splice(0, this.rows.length, ...kept);
    return removed;
  }
}

/** JSONL file store, mode 0o600; writes serialised through one promise chain (single process). */
export function createFileDecisionLogStore(path: string): DecisionLogStore {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => T): Promise<T> => {
    const next = chain.then(work);
    chain = next.catch(() => undefined);
    return next;
  };
  const readLines = (): Array<{ line: string; row: DecisionLogRow | null }> => {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        return { line, row: value && typeof value === 'object' ? parseStoredRow((value as { id?: unknown }).id, value) : null };
      } catch { return { line, row: null }; }
    });
  };
  return {
    append: (row) => serial(() => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify({ id: randomUUID(), ...withoutUndefined(row), at: row.at.toISOString() })}\n`, { mode: 0o600 });
    }),
    list: (filter = {}) => serial(() => readLines().flatMap(({ row }) => (row && inRange(row.at, filter) ? [row] : []))
      .sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, listLimit(filter.limit))),
    sweep: (now, retentionDays = DECISION_LOG_RETENTION_DAYS) => serial(() => {
      if (!existsSync(path)) return 0;
      const cutoff = cutoffOf(now, retentionDays);
      let removed = 0;
      const kept: string[] = [];
      for (const { line, row } of readLines()) {
        if (!row) continue; // corrupt lines are not carried over
        if (row.at.getTime() >= cutoff) kept.push(line);
        else removed++;
      }
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 });
      renameSync(tmp, path);
      return removed;
    }),
  };
}

/** Firestore store: collection 'vox_decision_log', one document per row, `at` stored as a Date. */
export class FirestoreDecisionLogStore implements DecisionLogStore {
  constructor(private readonly db: Firestore) {}

  private get collection() { return this.db.collection(DECISION_LOG_COLLECTION); }

  async append(row: NewDecisionLogRow): Promise<void> {
    await this.collection.doc(randomUUID()).set({ ...withoutUndefined(row), at: new Date(row.at) });
  }

  async list(filter: { since?: Date; until?: Date; limit?: number } = {}): Promise<DecisionLogRow[]> {
    let query: Query = this.collection;
    if (filter.since) query = query.where('at', '>=', filter.since);
    if (filter.until) query = query.where('at', '<', filter.until);
    const snapshot = await query.orderBy('at').limit(listLimit(filter.limit)).get();
    return snapshot.docs.flatMap((doc) => {
      const row = parseStoredRow(doc.id, doc.data());
      return row ? [row] : [];
    });
  }

  async sweep(now: Date, retentionDays = DECISION_LOG_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(cutoffOf(now, retentionDays));
    let removed = 0;
    for (let round = 0; round < 50; round++) {
      const snapshot = await this.collection.where('at', '<', cutoff).limit(400).get();
      if (snapshot.empty) break;
      const batch = this.db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
      removed += snapshot.size;
      if (snapshot.size < 400) break;
    }
    return removed;
  }
}

/**
 * The 90-day retention, scheduled whatever TIREH_DECISION_LOG is now: once at startup and then every
 * `sweepEveryMs` (default 24 h) on an unref'd timer, so rows written before a rollback still age out. Neither
 * store's sweep creates the file or collection. Best effort; `flush()` awaits the sweep in flight (tests).
 */
export function startDecisionLogRetentionSweep(store: Pick<DecisionLogStore, 'sweep'>, options: { now?: () => Date; sweepEveryMs?: number; retentionDays?: number; onError?: (code: 'sweep_failed') => void } = {}): { stop(): void; flush(): Promise<void> } {
  const now = options.now ?? (() => new Date());
  const retentionDays = options.retentionDays ?? DECISION_LOG_RETENTION_DAYS;
  let pending: Promise<unknown> = Promise.resolve();
  const sweep = () => {
    pending = pending.then(() => store.sweep(now(), retentionDays)).catch(() => { try { options.onError?.('sweep_failed'); } catch { /* never throws */ } });
  };
  sweep();
  const timer = setInterval(sweep, options.sweepEveryMs ?? DAY_MS);
  (timer as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer), async flush() { await pending; } };
}

export type DecisionLogErrorCode = 'invalid_row' | 'append_failed' | 'sweep_failed' | 'dropped';

export interface DecisionLogSinkOptions {
  /** Read on every record(); default tirehFlags().decisionLog. */
  enabled?: () => boolean;
  now?: () => Date;
  retentionDays?: number;
  /** Minimum interval between sweeps (default 24 h). */
  sweepEveryMs?: number;
  /** Appends in flight before new rows are dropped (default 100). */
  maxPending?: number;
  /** Fixed codes only: never an error object, message or row. */
  onError?: (code: DecisionLogErrorCode) => void;
}

/** record() checks the flag, validates, enqueues the append and, at most once per interval, a sweep. Never throws. */
export function createDecisionLogSink(store: DecisionLogStore, options: DecisionLogSinkOptions = {}): DecisionLogSink & { flush(): Promise<void> } {
  const enabled = options.enabled ?? (() => tirehFlags().decisionLog);
  const now = options.now ?? (() => new Date());
  const retentionDays = options.retentionDays ?? DECISION_LOG_RETENTION_DAYS;
  const sweepEveryMs = options.sweepEveryMs ?? DAY_MS;
  const maxPending = options.maxPending ?? 100;
  const fail = (code: DecisionLogErrorCode) => { try { options.onError?.(code); } catch { /* never throws */ } };
  const inFlight = new Set<Promise<void>>();
  let appends = 0;
  let lastSweep = -Infinity;
  const track = (work: () => Promise<unknown>, code: DecisionLogErrorCode, done?: () => void) => {
    const promise: Promise<void> = Promise.resolve().then(work).then(() => undefined, () => fail(code))
      .finally(() => { inFlight.delete(promise); done?.(); });
    inFlight.add(promise);
  };
  return {
    record(row) {
      try {
        if (!enabled()) return;
        const parsed = newDecisionLogRowSchema.safeParse(row);
        if (!parsed.success) { fail('invalid_row'); return; }
        if (appends >= maxPending) { fail('dropped'); return; }
        appends++;
        track(() => store.append(parsed.data), 'append_failed', () => { appends--; });
        const at = now();
        if (at.getTime() - lastSweep >= sweepEveryMs) {
          lastSweep = at.getTime();
          track(() => store.sweep(at, retentionDays), 'sweep_failed');
        }
      } catch { /* never throws into delivery */ }
    },
    async flush() {
      while (inFlight.size) await Promise.all([...inFlight]);
    },
  };
}
