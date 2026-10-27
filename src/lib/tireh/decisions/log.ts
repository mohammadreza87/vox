import { fileRuntimeFs, assertFileRuntimePath } from '../../studio/file-runtime-owner';
const { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = fileRuntimeFs;
/**
 * Content-free decision log for calibrating the triage pre-pass
 * (docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.8), behind TIREH_DECISION_LOG=1.
 *
 * A row records which questions were asked, the parsed answers (probabilities
 * and fixed catalogue values only), timing, tokens, the route the triage
 * implies, the persona (an agent id), the chat kind and a script-ratio
 * language label. It never holds message text, persona names, person ids,
 * chat keys or message ids; the strict schema rejects any other key and any
 * choice value that could carry text. Writes are fire-and-forget and never
 * affect delivery. Rows older than 90 days are swept.
 */

import { randomUUID } from 'crypto';

import { dirname } from 'path';
import type { Firestore, Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { tirehFlags } from '../flags';
import type { DecideDetail, DecisionAnswer, DecisionQuestion, Triage } from '../triage';
import { scriptLanguage } from './language';

export const DECISION_LOG_COLLECTION = 'vox_decision_log';
export const DECISION_LOG_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
const MAX_NAMES = 24;
const MAX_PROBABILITIES = 32;

export type DecisionLogAnswer =
  | { name: string; type: 'predicate'; probability: number }
  | { name: string; type: 'choice'; choice: string; confidence: number; probabilities?: Array<{ value: string; probability: number }> }
  | { name: string; type: 'score'; score: number; confidence: number };

export interface DecisionLogRow {
  id: string;
  questionSetVersion: 'v1' | 'v2' | 'v2-live' | 'image-v1' | 'pet-v1';
  names: string[];
  answers: DecisionLogAnswer[];
  outcome: 'answered' | 'unknown';
  unknownReason?: string;
  elapsedMs: number;
  inputTokens?: number;
  /** `pet`: a pet decision (care game design §8.6), never a triage route. */
  routeTaken: 'quick' | 'thoughtful' | 'web' | 'untriaged' | 'pet';
  personaId: string;
  chatKind: 'private' | 'group';
  language: 'fa' | 'en' | 'mixed' | 'unknown';
  at: Date;
}
export type NewDecisionLogRow = Omit<DecisionLogRow, 'id'>;

export interface DecisionLogStore {
  append(row: NewDecisionLogRow): Promise<void>;
  list(filter?: { since?: Date; until?: Date; limit?: number }): Promise<DecisionLogRow[]>;
  sweep(now: Date, retentionDays?: number): Promise<number>;
}

export interface DecisionLogSink { record(row: NewDecisionLogRow): void }

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
/** A catalogue value: no spaces, so it cannot carry free text. */
const VALUE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const unitSchema = z.number().min(0).max(1);
const UNKNOWN_REASONS = ['disabled', 'invalid_input', 'unauthorized', 'stale', 'cancelled', 'timeout', 'rate_limited', 'unsupported',
  'provider_error', 'malformed', 'refusal', 'budget', 'busy', 'circuit_open', 'empty', 'threw'] as const;

const answerSchema = z.discriminatedUnion('type', [
  z.object({ name: z.string().regex(NAME), type: z.literal('predicate'), probability: unitSchema }).strict(),
  z.object({ name: z.string().regex(NAME), type: z.literal('choice'), choice: z.string().regex(VALUE), confidence: unitSchema,
    probabilities: z.array(z.object({ value: z.string().regex(VALUE), probability: unitSchema }).strict()).max(MAX_PROBABILITIES).optional() }).strict(),
  z.object({ name: z.string().regex(NAME), type: z.literal('score'), score: z.number().finite(), confidence: unitSchema }).strict(),
]);

export const newDecisionLogRowSchema: z.ZodType<NewDecisionLogRow> = z.object({
  questionSetVersion: z.enum(['v1', 'v2', 'v2-live', 'image-v1', 'pet-v1']),
  names: z.array(z.string().regex(NAME)).min(1).max(MAX_NAMES),
  answers: z.array(answerSchema).max(MAX_NAMES),
  outcome: z.enum(['answered', 'unknown']),
  unknownReason: z.enum(UNKNOWN_REASONS).optional(),
  elapsedMs: z.number().int().min(0).max(600_000),
  inputTokens: z.number().int().min(0).optional(),
  routeTaken: z.enum(['quick', 'thoughtful', 'web', 'untriaged', 'pet']),
  personaId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  chatKind: z.enum(['private', 'group']),
  language: z.enum(['fa', 'en', 'mixed', 'unknown']),
  at: z.date(),
}).strict()
  .refine((row) => new Set(row.names).size === row.names.length, { message: 'duplicate_name' })
  .refine((row) => row.answers.every((a) => row.names.includes(a.name)), { message: 'answer_not_asked' });

const storedRowSchema = z.object({ id: z.string().min(1).max(128) }).passthrough();

/** Parses one stored row (`at` as a Date or ISO string); null when invalid. */
export function parseDecisionLogRow(value: unknown): DecisionLogRow | null {
  const stored = storedRowSchema.safeParse(value);
  if (!stored.success) return null;
  const { id, at, ...rest } = stored.data as { id: string; at?: unknown } & Record<string, unknown>;
  const date = at instanceof Date ? at : typeof at === 'string' ? new Date(at) : at && typeof at === 'object' && typeof (at as { toDate?: unknown }).toDate === 'function' ? (at as { toDate(): Date }).toDate() : undefined;
  if (!date || Number.isNaN(date.getTime())) return null;
  const row = newDecisionLogRowSchema.safeParse({ ...rest, at: date });
  return row.success ? { id, ...row.data } : null;
}

const withoutUndefined = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T;

const inRange = (at: Date, filter: { since?: Date; until?: Date }) =>
  (!filter.since || at.getTime() >= filter.since.getTime()) && (!filter.until || at.getTime() < filter.until.getTime());

export class InMemoryDecisionLogStore implements DecisionLogStore {
  readonly rows: DecisionLogRow[] = [];

  async append(row: NewDecisionLogRow): Promise<void> {
    this.rows.push({ id: randomUUID(), ...withoutUndefined(row), at: new Date(row.at) });
  }

  async list(filter: { since?: Date; until?: Date; limit?: number } = {}): Promise<DecisionLogRow[]> {
    const rows = this.rows.filter((r) => inRange(r.at, filter)).sort((a, b) => a.at.getTime() - b.at.getTime());
    return (filter.limit === undefined ? rows : rows.slice(0, filter.limit)).map((r) => ({ ...r, at: new Date(r.at) }));
  }

  async sweep(now: Date, retentionDays = DECISION_LOG_RETENTION_DAYS): Promise<number> {
    const cutoff = now.getTime() - retentionDays * DAY_MS;
    const before = this.rows.length;
    const kept = this.rows.filter((r) => r.at.getTime() >= cutoff);
    this.rows.splice(0, this.rows.length, ...kept);
    return before - kept.length;
  }
}

/** JSONL file store, mode 0o600, writes serialised through one promise chain. */
export function createFileDecisionLogStore(path: string): DecisionLogStore {
  assertFileRuntimePath(path);
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => T | Promise<T>): Promise<T> => {
    const next = chain.then(work);
    chain = next.catch(() => undefined);
    return next;
  };
  const readRows = (): Array<{ line: string; row: DecisionLogRow | null }> => {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => {
      try { return { line, row: parseDecisionLogRow(JSON.parse(line)) }; } catch { return { line, row: null }; }
    });
  };
  return {
    append: (row) => serial(() => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify({ id: randomUUID(), ...withoutUndefined(row), at: row.at.toISOString() })}\n`, { mode: 0o600 });
    }),
    list: (filter = {}) => serial(() => {
      const rows = readRows().flatMap(({ row }) => (row && inRange(row.at, filter) ? [row] : []))
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      return filter.limit === undefined ? rows : rows.slice(0, filter.limit);
    }),
    sweep: (now, retentionDays = DECISION_LOG_RETENTION_DAYS) => serial(() => {
      if (!existsSync(path)) return 0;
      const cutoff = now.getTime() - retentionDays * DAY_MS;
      let removed = 0;
      const kept: string[] = [];
      for (const { line, row } of readRows()) {
        if (!row) continue;
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

/** Firestore store: collection 'vox_decision_log'. */
export class FirestoreDecisionLogStore implements DecisionLogStore {
  constructor(private readonly db: Firestore) {}

  private get collection() { return this.db.collection(DECISION_LOG_COLLECTION); }

  async append(row: NewDecisionLogRow): Promise<void> {
    await this.collection.doc().set(withoutUndefined(row));
  }

  async list(filter: { since?: Date; until?: Date; limit?: number } = {}): Promise<DecisionLogRow[]> {
    let query: Query = this.collection;
    if (filter.since) query = query.where('at', '>=', filter.since);
    if (filter.until) query = query.where('at', '<', filter.until);
    query = query.orderBy('at');
    if (filter.limit !== undefined) query = query.limit(filter.limit);
    const snapshot = await query.get();
    return snapshot.docs.flatMap((doc) => {
      const row = parseDecisionLogRow({ ...doc.data(), id: doc.id });
      return row ? [row] : [];
    });
  }

  async sweep(now: Date, retentionDays = DECISION_LOG_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    let removed = 0;
    for (;;) {
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

export type DecisionLogWarning = 'decision_log_invalid_row' | 'decision_log_append_failed' | 'decision_log_sweep_failed';

export interface DecisionLogSinkOptions {
  now?: () => Date;
  retentionDays?: number;
  /** Minimum interval between sweeps (default 24 h). */
  sweepEveryMs?: number;
  /** Read at call time; default tirehFlags().decisionLog. */
  enabled?: () => boolean;
  /** Fixed codes only: never an error object, message or row. Default no-op. */
  warn?: (code: DecisionLogWarning) => void;
}

/** Fire-and-forget sink: record() is synchronous, returns void and never throws. */
export function createDecisionLogSink(store: DecisionLogStore, options: DecisionLogSinkOptions = {}): DecisionLogSink {
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled ?? (() => tirehFlags().decisionLog);
  const sweepEveryMs = options.sweepEveryMs ?? DAY_MS;
  const retentionDays = options.retentionDays ?? DECISION_LOG_RETENTION_DAYS;
  const warn = (code: DecisionLogWarning) => { try { options.warn?.(code); } catch { /* never throws */ } };
  let lastSweep = -Infinity;
  return {
    record(row) {
      try {
        if (!enabled()) return;
        const parsed = newDecisionLogRowSchema.safeParse(row);
        if (!parsed.success) { warn('decision_log_invalid_row'); return; }
        void Promise.resolve().then(() => store.append(parsed.data)).catch(() => warn('decision_log_append_failed'));
        const at = now();
        if (at.getTime() - lastSweep >= sweepEveryMs) {
          lastSweep = at.getTime();
          void Promise.resolve().then(() => store.sweep(at, retentionDays)).catch(() => warn('decision_log_sweep_failed'));
        }
      } catch { /* never throws into delivery */ }
    },
  };
}

export interface TriageDecisionEvent {
  questions: readonly DecisionQuestion[];
  answers: Record<string, DecisionAnswer> | null;
  detail?: DecideDetail;
  elapsedMs: number;
  triage: Triage | null;
  personaId: string;
  chatKind: 'private' | 'group';
  space: 'work' | 'personal';
  webSearch: boolean;
  fastLlm: boolean;
  /** Feeds scriptLanguage() only; never stored. */
  latestText: string;
  at: Date;
}

const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Only answers to questions that were asked, with values from that question's catalogue. */
function logAnswer(question: DecisionQuestion, answer: DecisionAnswer | undefined): DecisionLogAnswer | null {
  if (!answer || typeof answer !== 'object' || answer.type !== question.type) return null;
  const name = question.name;
  if (answer.type === 'predicate') return unit(answer.probability) ? { name, type: 'predicate', probability: answer.probability } : null;
  if (answer.type === 'score') return Number.isFinite(answer.score) && unit(answer.confidence) ? { name, type: 'score', score: answer.score, confidence: answer.confidence } : null;
  if (question.type !== 'choice') return null;
  const values = new Set(question.choices.map((c) => c.value).filter((v) => VALUE.test(v)));
  if (typeof answer.choice !== 'string' || !values.has(answer.choice) || !unit(answer.confidence)) return null;
  const probabilities = Array.isArray(answer.probabilities)
    ? answer.probabilities.filter((p) => p && typeof p.value === 'string' && values.has(p.value) && unit(p.probability)).slice(0, MAX_PROBABILITIES).map((p) => ({ value: p.value, probability: p.probability }))
    : undefined;
  return { name, type: 'choice', choice: answer.choice, confidence: answer.confidence, ...(probabilities?.length ? { probabilities } : {}) };
}

function routeTaken(event: TriageDecisionEvent): NewDecisionLogRow['routeTaken'] {
  const { triage } = event;
  if (!triage) return 'untriaged';
  // Mirrors composeReply: search first, then quick only with a fast model.
  if (event.space === 'work' && event.webSearch && triage.needsWeb) return 'web';
  return triage.effort === 'quick' && event.fastLlm ? 'quick' : 'thoughtful';
}

/** Builds and records one content-free triage row. Never throws. */
export function recordTriageDecision(sink: DecisionLogSink, event: TriageDecisionEvent): void {
  try {
    const answers = event.questions.flatMap((q) => {
      const a = logAnswer(q, event.answers?.[q.name]);
      return a ? [a] : [];
    });
    const asked = event.questions.some((q) => q.name === 'route');
    const set = tirehFlags().triageQuestionSet;
    const outcome = answers.length > 0 ? 'answered' : 'unknown';
    const unknownReason = event.detail?.unknownReason ?? (event.answers === null ? 'threw' : 'empty');
    const inputTokens = event.detail?.inputTokens;
    sink.record({
      questionSetVersion: !asked ? 'v1' : set === 'v2-live' ? 'v2-live' : 'v2',
      names: event.questions.map((q) => q.name),
      answers,
      outcome,
      ...(outcome === 'unknown' ? { unknownReason } : {}),
      elapsedMs: Math.max(0, Math.round(event.elapsedMs)),
      ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
      routeTaken: routeTaken(event),
      personaId: event.personaId,
      chatKind: event.chatKind,
      language: scriptLanguage(event.latestText),
      at: event.at,
    });
  } catch { /* never throws into delivery */ }
}

/** One pet decision (care game design §8.6): which questions were asked, and what came back. Content-free. */
export interface PetDecisionEvent {
  questions: readonly DecisionQuestion[];
  /** null: the call failed or timed out before any answer */
  detail: DecideDetail | null;
  elapsedMs: number;
  /** the agent (persona) id; never a person id */
  personaId: string;
  /** the person's language on the pet page (not a script ratio: pet inputs carry no text) */
  language: 'fa' | 'en';
  at: Date;
}

/** Builds and records one `pet-v1` row, routed `pet`. Only answers to the questions asked, with catalogue values. Never throws. */
export function recordPetDecision(sink: DecisionLogSink, event: PetDecisionEvent): void {
  try {
    const answers = event.questions.flatMap((q) => {
      const a = logAnswer(q, event.detail?.answers[q.name]);
      return a ? [a] : [];
    });
    const outcome = answers.length > 0 ? 'answered' : 'unknown';
    const inputTokens = event.detail?.inputTokens;
    sink.record({
      questionSetVersion: 'pet-v1',
      names: event.questions.map((q) => q.name),
      answers,
      outcome,
      ...(outcome === 'unknown' ? { unknownReason: event.detail?.unknownReason ?? (event.detail === null ? 'timeout' : 'empty') } : {}),
      elapsedMs: Math.max(0, Math.round(event.elapsedMs)),
      ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
      routeTaken: 'pet',
      personaId: event.personaId,
      chatKind: 'private',
      language: event.language,
      at: event.at,
    });
  } catch { /* never throws into a pet request */ }
}
