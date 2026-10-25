/**
 * Stores for the reply-style bandit (procedural.ts): in-memory, single-host
 * JSON file, and Firestore ('vox_reply_style' posteriors, 'vox_reply_style_eval'
 * offline-evaluation rows).
 *
 * Every row is parsed with its strict schema on write (an invalid row throws)
 * and on read (an invalid row is skipped). Deletion by subject matches raw
 * fields, so a malformed row of a withdrawn subject is still deleted. Rows are
 * content-free by schema: no message text, model output or raw personId.
 */
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { mkdir, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DocumentReference, Firestore, Query } from 'firebase-admin/firestore';
import {
  POSTERIOR_IDLE_DELETE_MS,
  evalRowSchema,
  posteriorRowSchema,
} from './procedural';
import type {
  PosteriorRow,
  ReplyStyleDeleteFilter,
  ReplyStyleEvalFilter,
  ReplyStyleEvalRow,
  ReplyStyleStore,
  ReplyStyleTxRead,
  ReplyStyleTxSnapshot,
  ReplyStyleTxWrite,
} from './procedural';

/** File store cap on evaluation rows; the oldest settled rows are dropped first. */
export const MAX_FILE_EVAL_ROWS = 20_000;
export const DEFAULT_REPLY_STYLE_COLLECTIONS = Object.freeze({ posteriors: 'vox_reply_style', evals: 'vox_reply_style_eval' });
const DEFAULT_LIST_LIMIT = 1_000;
const MAX_LIST_LIMIT = 10_000;
const DELETE_PAGE = 400;
const MAX_DELETE_ROUNDS = 10_000;
const LOCK_ATTEMPTS = 500;
const LOCK_WAIT_MS = 10;
const COLLECTION_NAME = /^[A-Za-z0-9_-]{1,100}$/;

type Counts = { posteriors: number; evals: number };

// ---------------------------------------------------------------------------
// Shared row helpers
// ---------------------------------------------------------------------------

function parsePosterior(raw: unknown): PosteriorRow | null {
  const parsed = posteriorRowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseEval(raw: unknown): ReplyStyleEvalRow | null {
  const parsed = evalRowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function field(raw: unknown, ...path: string[]): unknown {
  let value: unknown = raw;
  for (const key of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function matchesPosterior(raw: unknown, filter: ReplyStyleDeleteFilter): boolean {
  return field(raw, 'subject') === filter.subject
    && (filter.personaId === undefined || field(raw, 'personaId') === filter.personaId)
    && (filter.space === undefined || field(raw, 'space') === filter.space);
}

function matchesEval(raw: unknown, filter: ReplyStyleDeleteFilter): boolean {
  return field(raw, 'context', 'subject') === filter.subject
    && (filter.personaId === undefined || field(raw, 'context', 'personaId') === filter.personaId)
    && (filter.space === undefined || field(raw, 'context', 'space') === filter.space);
}

function validDeleteFilter(filter: ReplyStyleDeleteFilter): ReplyStyleDeleteFilter {
  if (!filter || typeof filter.subject !== 'string' || !/^[0-9a-f]{32}$/.test(filter.subject)) throw new RangeError('reply_style_delete_filter');
  return filter;
}

function listLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('reply_style_list_limit');
  return Math.min(limit, MAX_LIST_LIMIT);
}

function selectEval(rows: Iterable<ReplyStyleEvalRow>, filter: ReplyStyleEvalFilter = {}): ReplyStyleEvalRow[] {
  const limit = listLimit(filter.limit);
  return [...rows]
    .filter((row) => (filter.personaId === undefined || row.context.personaId === filter.personaId)
      && (filter.since === undefined || row.at >= filter.since)
      && (filter.until === undefined || row.at <= filter.until))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * Keeps at most max evaluation rows: drops the oldest settled rows first,
 * then the oldest unsettled ones. Returns rows in (at, id) order.
 */
export function capEvalRows(rows: readonly ReplyStyleEvalRow[], max: number = MAX_FILE_EVAL_ROWS): ReplyStyleEvalRow[] {
  const ordered = [...rows].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  let excess = ordered.length - max;
  if (excess <= 0) return ordered;
  const drop = new Set<string>();
  for (const row of ordered) {
    if (excess === 0) break;
    if (row.settledAt !== undefined) { drop.add(row.id); excess--; }
  }
  for (const row of ordered) {
    if (excess === 0) break;
    if (!drop.has(row.id)) { drop.add(row.id); excess--; }
  }
  return ordered.filter((row) => !drop.has(row.id));
}

// ---------------------------------------------------------------------------
// State shared by the memory and file stores (raw rows, parsed on read)
// ---------------------------------------------------------------------------

interface State { posteriors: Map<string, unknown>; evals: Map<string, unknown>; dirty: boolean }

const emptyState = (): State => ({ posteriors: new Map(), evals: new Map(), dirty: false });

function readPosteriorsFrom(state: State, ids: readonly string[]): PosteriorRow[] {
  const out: PosteriorRow[] = [];
  for (const id of new Set(ids)) {
    const row = parsePosterior(state.posteriors.get(id));
    if (row && row.id === id) out.push(structuredClone(row));
  }
  return out;
}

function recordExposureIn(state: State, row: ReplyStyleEvalRow): void {
  const parsed = evalRowSchema.parse(structuredClone(row));
  if (state.evals.has(parsed.id)) throw new Error('reply_style_duplicate_exposure');
  state.evals.set(parsed.id, parsed);
  state.dirty = true;
}

function transactIn<T>(state: State, read: ReplyStyleTxRead,
  fn: (snapshot: ReplyStyleTxSnapshot) => ReplyStyleTxWrite<T>): T {
  const exposures = new Map<string, ReplyStyleEvalRow>();
  for (const id of new Set(read.exposureIds)) {
    const row = parseEval(state.evals.get(id));
    if (row && row.id === id) exposures.set(id, structuredClone(row));
  }
  const posteriors = new Map<string, PosteriorRow>();
  for (const row of readPosteriorsFrom(state, read.posteriorIds)) posteriors.set(row.id, row);
  const out = fn({ exposures, posteriors });
  // Validate every write before applying any: a throw commits nothing.
  const evalWrites = (out.exposures ?? []).map((row) => evalRowSchema.parse(structuredClone(row)));
  const posteriorWrites = (out.posteriors ?? []).map((row) => posteriorRowSchema.parse(structuredClone(row)));
  for (const row of evalWrites) state.evals.set(row.id, row);
  for (const row of posteriorWrites) state.posteriors.set(row.id, row);
  if (evalWrites.length + posteriorWrites.length > 0) state.dirty = true;
  return structuredClone(out.result);
}

function listEvalFrom(state: State, filter?: ReplyStyleEvalFilter): ReplyStyleEvalRow[] {
  const rows: ReplyStyleEvalRow[] = [];
  for (const raw of state.evals.values()) {
    const row = parseEval(raw);
    if (row) rows.push(structuredClone(row));
  }
  return selectEval(rows, filter);
}

function deleteSubjectIn(state: State, filter: ReplyStyleDeleteFilter): Counts {
  const counts: Counts = { posteriors: 0, evals: 0 };
  for (const [id, raw] of state.posteriors) if (matchesPosterior(raw, filter)) { state.posteriors.delete(id); counts.posteriors++; }
  for (const [id, raw] of state.evals) if (matchesEval(raw, filter)) { state.evals.delete(id); counts.evals++; }
  if (counts.posteriors + counts.evals > 0) state.dirty = true;
  return counts;
}

function sweepIn(state: State, now: number): Counts {
  const counts: Counts = { posteriors: 0, evals: 0 };
  const idleCutoff = now - POSTERIOR_IDLE_DELETE_MS;
  for (const [id, raw] of state.posteriors) {
    const updatedAt = field(raw, 'updatedAt');
    if (typeof updatedAt === 'number' && updatedAt <= idleCutoff) { state.posteriors.delete(id); counts.posteriors++; }
  }
  for (const [id, raw] of state.evals) {
    const expiresAt = field(raw, 'expiresAt');
    if (typeof expiresAt === 'number' && expiresAt <= now) { state.evals.delete(id); counts.evals++; }
  }
  if (counts.posteriors + counts.evals > 0) state.dirty = true;
  return counts;
}

function validNow(now: number): number {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new RangeError('reply_style_now');
  return now;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

/** Process-local store for tests and single-process development. */
export class InMemoryReplyStyleStore implements ReplyStyleStore {
  private readonly state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  /** seed: raw rows keyed by their id, validated only on read (fixtures and invalid-row tests). */
  constructor(seed?: { posteriors?: readonly unknown[]; evals?: readonly unknown[] }) {
    for (const raw of seed?.posteriors ?? []) {
      const id = field(raw, 'id');
      if (typeof id === 'string') this.state.posteriors.set(id, structuredClone(raw));
    }
    for (const raw of seed?.evals ?? []) {
      const id = field(raw, 'id');
      if (typeof id === 'string') this.state.evals.set(id, structuredClone(raw));
    }
  }

  readPosteriors(ids: readonly string[]): Promise<PosteriorRow[]> {
    return this.run(() => readPosteriorsFrom(this.state, [...ids]));
  }

  recordExposure(row: ReplyStyleEvalRow): Promise<void> {
    return this.run(() => recordExposureIn(this.state, row));
  }

  transact<T>(read: ReplyStyleTxRead, fn: (snapshot: ReplyStyleTxSnapshot) => ReplyStyleTxWrite<T>): Promise<T> {
    return this.run(() => transactIn(this.state, read, fn));
  }

  listEval(filter?: ReplyStyleEvalFilter): Promise<ReplyStyleEvalRow[]> {
    return this.run(() => listEvalFrom(this.state, filter));
  }

  deleteSubject(filter: ReplyStyleDeleteFilter): Promise<Counts> {
    return this.run(() => deleteSubjectIn(this.state, validDeleteFilter(filter)));
  }

  sweep(now: number): Promise<Counts> {
    return this.run(() => sweepIn(this.state, validNow(now)));
  }

  /** Raw copy of every stored row, for content-free assertions in tests. */
  dump(): { posteriors: unknown[]; evals: unknown[] } {
    return structuredClone({ posteriors: [...this.state.posteriors.values()], evals: [...this.state.evals.values()] });
  }

  private run<T>(operation: () => T): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}

// ---------------------------------------------------------------------------
// File store (single host)
// ---------------------------------------------------------------------------

interface FileShape { version: 1; posteriors: unknown[]; evals: unknown[] }

/**
 * One JSON file `{version:1, posteriors, evals}`, 0600 in a 0700 directory.
 * Every operation takes a `${path}.lock` mkdir lock, reloads from disk,
 * applies the change and replaces the file through an fsynced temp file. The
 * lock coordinates processes on one host only; use Firestore for multiple
 * instances. A bad version or envelope throws 'invalid_reply_style_store' and
 * the file is never silently replaced.
 */
export class FileReplyStyleStore implements ReplyStyleStore {
  constructor(private readonly path: string) {
    if (typeof path !== 'string' || path.length === 0) throw new RangeError('reply_style_store_path');
  }

  readPosteriors(ids: readonly string[]): Promise<PosteriorRow[]> {
    return this.withState((state) => readPosteriorsFrom(state, [...ids]));
  }

  recordExposure(row: ReplyStyleEvalRow): Promise<void> {
    return this.withState((state) => recordExposureIn(state, row));
  }

  transact<T>(read: ReplyStyleTxRead, fn: (snapshot: ReplyStyleTxSnapshot) => ReplyStyleTxWrite<T>): Promise<T> {
    return this.withState((state) => transactIn(state, read, fn));
  }

  listEval(filter?: ReplyStyleEvalFilter): Promise<ReplyStyleEvalRow[]> {
    return this.withState((state) => listEvalFrom(state, filter));
  }

  deleteSubject(filter: ReplyStyleDeleteFilter): Promise<Counts> {
    return this.withState((state) => deleteSubjectIn(state, validDeleteFilter(filter)));
  }

  sweep(now: number): Promise<Counts> {
    return this.withState((state) => sweepIn(state, validNow(now)));
  }

  private async withState<T>(operation: (state: State) => T): Promise<T> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    let acquired = false;
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      try {
        await mkdir(lock);
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      }
    }
    if (!acquired) throw new Error('reply_style_lock_busy');
    try {
      const state = this.load();
      const result = operation(state);
      if (state.dirty) this.write(state);
      return result;
    } finally {
      await rmdir(lock);
    }
  }

  private load(): State {
    let fd: number;
    try {
      // O_NOFOLLOW: a symlink planted at the store path fails closed (ELOOP) instead of being read.
      fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return emptyState();
      if (code === 'ELOOP') throw new Error('invalid_reply_style_store');
      throw error;
    }
    let text: string;
    try {
      if (!fstatSync(fd).isFile()) throw new Error('invalid_reply_style_store');
      text = readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error('invalid_reply_style_store'); }
    const shape = raw as Partial<FileShape> | null;
    if (!shape || typeof shape !== 'object' || Array.isArray(shape) || shape.version !== 1
        || !Array.isArray(shape.posteriors) || !Array.isArray(shape.evals)
        || Object.keys(shape).some((key) => key !== 'version' && key !== 'posteriors' && key !== 'evals')) {
      throw new Error('invalid_reply_style_store');
    }
    const state = emptyState();
    for (const [rows, target] of [[shape.posteriors, state.posteriors], [shape.evals, state.evals]] as const) {
      for (const row of rows) {
        const id = field(row, 'id');
        if (typeof id !== 'string' || target.has(id)) throw new Error('invalid_reply_style_store');
        target.set(id, row);
      }
    }
    return state;
  }

  private write(state: State): void {
    const evals = [...state.evals.values()];
    let keptEvals: unknown[] = evals;
    if (evals.length > MAX_FILE_EVAL_ROWS) {
      // Invalid rows are dropped first; capEvalRows then drops the oldest settled, then the oldest unsettled.
      const valid = evals.map(parseEval).filter((row): row is ReplyStyleEvalRow => row !== null);
      const invalid = evals.filter((row) => parseEval(row) === null);
      const capped = capEvalRows(valid, MAX_FILE_EVAL_ROWS);
      const room = MAX_FILE_EVAL_ROWS - capped.length;
      keptEvals = [...(room > 0 ? invalid.slice(Math.max(0, invalid.length - room)) : []), ...capped];
    }
    const body: FileShape = { version: 1, posteriors: [...state.posteriors.values()], evals: keptEvals };
    const json = JSON.stringify(body);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    // Under the lock: drop a stale temp file, then create it exclusively without following a link
    // (O_CREAT | O_EXCL | O_NOFOLLOW), so a planted symlink or pre-existing file is never written through.
    try {
      unlinkSync(tmp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      try {
        writeSync(fd, json);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.path);
    } catch (error) {
      try { unlinkSync(tmp); } catch { /* already gone */ }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Firestore store
// ---------------------------------------------------------------------------

/** Firestore rejects undefined fields; rows hold only JSON values. */
const toDoc = (row: object): Record<string, unknown> => JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

/**
 * Collections 'vox_reply_style' (posteriors) and 'vox_reply_style_eval'
 * (evaluation rows). Document ids are the row ids; numbers are plain numbers.
 * Queries use equality filters or one range filter, so single-field indexes
 * suffice. deleteSubject and sweep delete in pages of 400; they are not
 * atomic across pages, are idempotent and must be retried after a failure.
 */
export class FirestoreReplyStyleStore implements ReplyStyleStore {
  private readonly collections: { posteriors: string; evals: string };

  constructor(private readonly db: Firestore, collections: { posteriors: string; evals: string } = DEFAULT_REPLY_STYLE_COLLECTIONS) {
    if (!COLLECTION_NAME.test(collections?.posteriors ?? '') || !COLLECTION_NAME.test(collections?.evals ?? '')
        || collections.posteriors === collections.evals) {
      throw new RangeError('reply_style_collections');
    }
    this.collections = { posteriors: collections.posteriors, evals: collections.evals };
  }

  async readPosteriors(ids: readonly string[]): Promise<PosteriorRow[]> {
    const unique = [...new Set(ids)].filter((id) => /^[0-9a-f]{40}$/.test(id));
    const snaps = await Promise.all(unique.map((id) => this.posteriorRef(id).get()));
    const out: PosteriorRow[] = [];
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const row = parsePosterior(snap.data());
      if (row && row.id === unique[i]) out.push(row);
    });
    return out;
  }

  async recordExposure(row: ReplyStyleEvalRow): Promise<void> {
    const parsed = evalRowSchema.parse(structuredClone(row));
    const ref = this.evalRef(parsed.id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) throw new Error('reply_style_duplicate_exposure');
      tx.set(ref, toDoc(parsed));
    });
  }

  transact<T>(read: ReplyStyleTxRead, fn: (snapshot: ReplyStyleTxSnapshot) => ReplyStyleTxWrite<T>): Promise<T> {
    return this.db.runTransaction(async (tx) => {
      // Firestore rule: every read happens before any write.
      const exposures = new Map<string, ReplyStyleEvalRow>();
      for (const id of new Set(read.exposureIds)) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) continue;
        const snap = await tx.get(this.evalRef(id));
        const row = snap.exists ? parseEval(snap.data()) : null;
        if (row && row.id === id) exposures.set(id, row);
      }
      const posteriors = new Map<string, PosteriorRow>();
      for (const id of new Set(read.posteriorIds)) {
        if (!/^[0-9a-f]{40}$/.test(id)) continue;
        const snap = await tx.get(this.posteriorRef(id));
        const row = snap.exists ? parsePosterior(snap.data()) : null;
        if (row && row.id === id) posteriors.set(id, row);
      }
      const out = fn({ exposures, posteriors });
      const evalWrites = (out.exposures ?? []).map((row) => evalRowSchema.parse(structuredClone(row)));
      const posteriorWrites = (out.posteriors ?? []).map((row) => posteriorRowSchema.parse(structuredClone(row)));
      for (const row of evalWrites) tx.set(this.evalRef(row.id), toDoc(row));
      for (const row of posteriorWrites) tx.set(this.posteriorRef(row.id), toDoc(row));
      return out.result;
    });
  }

  /**
   * One equality or one range filter per query; the rest is filtered in
   * memory over at most MAX_LIST_LIMIT fetched rows. For offline export only.
   */
  async listEval(filter: ReplyStyleEvalFilter = {}): Promise<ReplyStyleEvalRow[]> {
    listLimit(filter.limit);
    let query: Query = this.db.collection(this.collections.evals);
    if (filter.personaId !== undefined) {
      query = query.where('context.personaId', '==', filter.personaId);
    } else {
      if (filter.since !== undefined) query = query.where('at', '>=', filter.since);
      if (filter.until !== undefined) query = query.where('at', '<=', filter.until);
    }
    const snap = await query.limit(MAX_LIST_LIMIT).get();
    const rows = snap.docs.map((doc) => parseEval(doc.data())).filter((row): row is ReplyStyleEvalRow => row !== null);
    return selectEval(rows, filter);
  }

  async deleteSubject(filter: ReplyStyleDeleteFilter): Promise<Counts> {
    const valid = validDeleteFilter(filter);
    let posteriors: Query = this.db.collection(this.collections.posteriors).where('subject', '==', valid.subject);
    let evals: Query = this.db.collection(this.collections.evals).where('context.subject', '==', valid.subject);
    if (valid.personaId !== undefined) {
      posteriors = posteriors.where('personaId', '==', valid.personaId);
      evals = evals.where('context.personaId', '==', valid.personaId);
    }
    if (valid.space !== undefined) {
      posteriors = posteriors.where('space', '==', valid.space);
      evals = evals.where('context.space', '==', valid.space);
    }
    return { posteriors: await this.deleteAll(posteriors), evals: await this.deleteAll(evals) };
  }

  async sweep(now: number): Promise<Counts> {
    const at = validNow(now);
    const evals = await this.deleteAll(this.db.collection(this.collections.evals).where('expiresAt', '<=', at));
    const posteriors = await this.deleteAll(this.db.collection(this.collections.posteriors)
      .where('updatedAt', '<=', at - POSTERIOR_IDLE_DELETE_MS));
    return { posteriors, evals };
  }

  private posteriorRef(id: string): DocumentReference {
    return this.db.collection(this.collections.posteriors).doc(id);
  }

  private evalRef(id: string): DocumentReference {
    return this.db.collection(this.collections.evals).doc(id);
  }

  private async deleteAll(query: Query): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_DELETE_ROUNDS; round++) {
      const page = await query.limit(DELETE_PAGE).get();
      if (page.docs.length === 0) return total;
      const batch = this.db.batch();
      for (const doc of page.docs) batch.delete(doc.ref);
      await batch.commit();
      total += page.docs.length;
    }
    throw new Error('reply_style_delete_incomplete');
  }
}
