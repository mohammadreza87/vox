/**
 * Stores for reply-style procedural memory (procedural.ts): in-memory, a single
 * JSON file for the single-process Mac profile, and Firestore. Every read and
 * write goes through the strict content-free schemas; a parse failure throws,
 * so the store fails closed and ReplyStylePolicy falls back to no sampling.
 * The raw personId is never written: rows carry only the hashed person key.
 */
import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Firestore, Query } from 'firebase-admin/firestore';
import {
  posteriorDocId, posteriorDocIdForPersonKey, REPLY_STYLE_ID_PATTERN, replyStyleEvalRecordSchema, replyStylePosteriorDocSchema,
  type ReplySpace, type ReplyStyleEvalRecord, type ReplyStyleKey, type ReplyStylePosteriorDoc, type ReplyStyleStore,
} from './procedural';

export type { ReplyStyleStore } from './procedural';

export const MAX_REPLY_STYLE_FILE_BYTES = 4_000_000;
export const MAX_REPLY_STYLE_POSTERIOR_DOCS = 5_000;
export const MAX_REPLY_STYLE_DECISIONS = 20_000;
const MAX_LIST = 1000;
const DELETE_CHUNK = 400;
const MAX_DELETE_ROUNDS = 1000;
const MAX_JSON_FIELD_CHARS = 200_000;

type ScopeFilter = { personKey: string; personaId?: string; space?: ReplySpace };
type DecisionFilter = { since?: number; until?: number; limit?: number };
type Mutate<T> = (decision: ReplyStyleEvalRecord | null, doc: ReplyStylePosteriorDoc | null) =>
  { decision?: ReplyStyleEvalRecord; doc?: ReplyStylePosteriorDoc; result: T };

// ---------------------------------------------------------------------------
// Validation shared by all stores
// ---------------------------------------------------------------------------

function parsePosterior(value: unknown, expectedId?: string): ReplyStylePosteriorDoc {
  const doc = replyStylePosteriorDocSchema.parse(value);
  if (doc.id !== posteriorDocIdForPersonKey(doc.personKey, doc.personaId, doc.space, doc.route)
      || (expectedId !== undefined && doc.id !== expectedId)) throw new Error('reply_style_doc_identity');
  return doc;
}

function parseDecision(value: unknown, expectedId?: string): ReplyStyleEvalRecord {
  const record = replyStyleEvalRecordSchema.parse(value);
  if (expectedId !== undefined && record.id !== expectedId) throw new Error('reply_style_decision_identity');
  return record;
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > MAX_JSON_FIELD_CHARS) throw new Error('reply_style_row_invalid');
  try { return JSON.parse(value); } catch { throw new Error('reply_style_row_invalid'); }
}

/** Decision ids double as Firestore document ids, so they must never contain a path separator. */
const isDecisionId = (id: unknown): id is string =>
  typeof id === 'string' && REPLY_STYLE_ID_PATTERN.test(id) && id !== '.' && id !== '..' && !/^__.*__$/.test(id);

const inScope = (filter: ScopeFilter, personKey: string, personaId: string, space: ReplySpace) =>
  personKey === filter.personKey && (filter.personaId === undefined || personaId === filter.personaId)
  && (filter.space === undefined || space === filter.space);

const listLimit = (limit: number | undefined) =>
  limit === undefined || !Number.isFinite(limit) ? MAX_LIST : Math.max(1, Math.min(MAX_LIST, Math.floor(limit)));

// ---------------------------------------------------------------------------
// Map-backed state shared by the in-memory and file stores
// ---------------------------------------------------------------------------

interface State { posteriors: Map<string, ReplyStylePosteriorDoc>; decisions: Map<string, ReplyStyleEvalRecord> }

const emptyState = (): State => ({ posteriors: new Map(), decisions: new Map() });

function stateAppend(state: State, record: ReplyStyleEvalRecord): void {
  const parsed = parseDecision(structuredClone(record));
  if (!isDecisionId(parsed.id)) throw new Error('reply_style_bad_decision_id');
  if (state.decisions.has(parsed.id)) throw new Error('reply_style_duplicate_decision');
  state.decisions.set(parsed.id, parsed);
  if (state.decisions.size > MAX_REPLY_STYLE_DECISIONS) {
    const oldest = [...state.decisions.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    for (const row of oldest.slice(0, state.decisions.size - MAX_REPLY_STYLE_DECISIONS)) state.decisions.delete(row.id);
  }
}

function stateSettle<T>(state: State, decisionId: string, mutate: Mutate<T>, posteriorCap: number): T {
  const stored = isDecisionId(decisionId) ? state.decisions.get(decisionId) : undefined;
  const decision = stored ? structuredClone(stored) : null;
  const docId = decision ? posteriorDocIdForPersonKey(decision.context.personKey, decision.context.personaId,
    decision.context.space, decision.context.route) : null;
  const existing = docId ? state.posteriors.get(docId) : undefined;
  const out = mutate(decision, existing ? structuredClone(existing) : null);
  const nextDecision = out.decision ? parseDecision(structuredClone(out.decision), decisionId) : undefined;
  if (nextDecision && !decision) throw new Error('reply_style_decision_identity');
  const nextDoc = out.doc ? parsePosterior(structuredClone(out.doc), docId ?? undefined) : undefined;
  if (nextDoc && !docId) throw new Error('reply_style_doc_identity');
  if (nextDoc && !existing && state.posteriors.size >= posteriorCap) throw new Error('reply_style_capacity');
  if (nextDecision) state.decisions.set(decisionId, nextDecision);
  if (nextDoc) state.posteriors.set(nextDoc.id, nextDoc);
  return out.result;
}

function stateListPosteriors(state: State, filter: ScopeFilter): ReplyStylePosteriorDoc[] {
  return [...state.posteriors.values()].filter(doc => inScope(filter, doc.personKey, doc.personaId, doc.space))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_LIST).map(doc => structuredClone(doc));
}

function stateListDecisions(state: State, filter: DecisionFilter): ReplyStyleEvalRecord[] {
  return [...state.decisions.values()]
    .filter(row => (filter.since === undefined || row.at >= filter.since) && (filter.until === undefined || row.at <= filter.until))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, listLimit(filter.limit)).map(row => structuredClone(row));
}

function stateDeleteScope(state: State, filter: ScopeFilter): { posteriors: number; decisions: number } {
  let posteriors = 0;
  let decisions = 0;
  for (const [id, doc] of state.posteriors) if (inScope(filter, doc.personKey, doc.personaId, doc.space)) { state.posteriors.delete(id); posteriors++; }
  for (const [id, row] of state.decisions) if (inScope(filter, row.context.personKey, row.context.personaId, row.context.space)) { state.decisions.delete(id); decisions++; }
  return { posteriors, decisions };
}

function stateSweep(state: State, now: number): number {
  let removed = 0;
  for (const [id, row] of state.decisions) if (row.expiresAt <= now) { state.decisions.delete(id); removed++; }
  return removed;
}

/** Promise-chain mutex: one task at a time, a failure never blocks later tasks. */
class Serial {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(task: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export class InMemoryReplyStyleStore implements ReplyStyleStore {
  private state = emptyState();
  private readonly serial = new Serial();

  async get(key: ReplyStyleKey): Promise<ReplyStylePosteriorDoc | null> {
    const doc = this.state.posteriors.get(posteriorDocId(key));
    return doc ? structuredClone(doc) : null;
  }

  appendDecision(record: ReplyStyleEvalRecord): Promise<void> {
    return this.serial.run(() => this.transact(state => stateAppend(state, record)));
  }

  settle<T>(decisionId: string, mutate: Mutate<T>): Promise<T> {
    return this.serial.run(() => this.transact(state => stateSettle(state, decisionId, mutate, MAX_REPLY_STYLE_POSTERIOR_DOCS)));
  }

  async listPosteriors(filter: ScopeFilter): Promise<ReplyStylePosteriorDoc[]> {
    return stateListPosteriors(this.state, filter);
  }

  async listDecisions(filter: DecisionFilter): Promise<ReplyStyleEvalRecord[]> {
    return stateListDecisions(this.state, filter);
  }

  deleteScope(filter: ScopeFilter): Promise<{ posteriors: number; decisions: number }> {
    return this.serial.run(() => stateDeleteScope(this.state, filter));
  }

  sweep(now: number): Promise<number> {
    return this.serial.run(() => stateSweep(this.state, now));
  }

  /** Runs on a draft; the draft replaces the state only when the task does not throw. */
  private transact<T>(task: (draft: State) => T): T {
    const draft: State = { posteriors: new Map(this.state.posteriors), decisions: new Map(this.state.decisions) };
    const result = task(draft);
    this.state = draft;
    return result;
  }
}

// ---------------------------------------------------------------------------
// File store (single process only)
// ---------------------------------------------------------------------------

interface FileShape { schemaVersion: 1; posteriors: ReplyStylePosteriorDoc[]; decisions: ReplyStyleEvalRecord[] }

/**
 * One JSON file, 0600 in a 0700 directory, replaced atomically on every
 * mutation. Writers are serialised within this process only. A corrupt or
 * invalid file makes every call throw and is never silently replaced.
 */
export class FileReplyStyleStore implements ReplyStyleStore {
  private readonly serial = new Serial();

  constructor(private readonly path: string) {
    if (typeof path !== 'string' || path.length === 0) throw new Error('reply_style_bad_path');
  }

  get(key: ReplyStyleKey): Promise<ReplyStylePosteriorDoc | null> {
    return this.serial.run(() => this.load().posteriors.get(posteriorDocId(key)) ?? null);
  }

  appendDecision(record: ReplyStyleEvalRecord): Promise<void> {
    return this.serial.run(() => { const state = this.load(); stateAppend(state, record); this.write(state); });
  }

  settle<T>(decisionId: string, mutate: Mutate<T>): Promise<T> {
    return this.serial.run(() => {
      const state = this.load();
      const before = { posteriors: new Map(state.posteriors), decisions: new Map(state.decisions) };
      const result = stateSettle(state, decisionId, mutate, MAX_REPLY_STYLE_POSTERIOR_DOCS);
      if (changed(before, state)) this.write(state);
      return result;
    });
  }

  listPosteriors(filter: ScopeFilter): Promise<ReplyStylePosteriorDoc[]> {
    return this.serial.run(() => stateListPosteriors(this.load(), filter));
  }

  listDecisions(filter: DecisionFilter): Promise<ReplyStyleEvalRecord[]> {
    return this.serial.run(() => stateListDecisions(this.load(), filter));
  }

  deleteScope(filter: ScopeFilter): Promise<{ posteriors: number; decisions: number }> {
    return this.serial.run(() => {
      const state = this.load();
      const counts = stateDeleteScope(state, filter);
      if (counts.posteriors + counts.decisions > 0) this.write(state);
      return counts;
    });
  }

  sweep(now: number): Promise<number> {
    return this.serial.run(() => {
      const state = this.load();
      const removed = stateSweep(state, now);
      if (removed > 0) this.write(state);
      return removed;
    });
  }

  private load(): State {
    let fd: number;
    try {
      fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return emptyState();
      throw new Error('reply_style_file_unreadable');
    }
    let text: string;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_REPLY_STYLE_FILE_BYTES) throw new Error('reply_style_file_refused');
      text = readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_REPLY_STYLE_FILE_BYTES) throw new Error('reply_style_file_refused');
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error('reply_style_file_corrupt'); }
    const shape = raw as Partial<FileShape> | null;
    if (!shape || typeof shape !== 'object' || Array.isArray(shape) || shape.schemaVersion !== 1
        || !Array.isArray(shape.posteriors) || !Array.isArray(shape.decisions)
        || Object.keys(shape).some(key => key !== 'schemaVersion' && key !== 'posteriors' && key !== 'decisions')
        || shape.posteriors.length > MAX_REPLY_STYLE_POSTERIOR_DOCS || shape.decisions.length > MAX_REPLY_STYLE_DECISIONS) {
      throw new Error('reply_style_file_corrupt');
    }
    const state = emptyState();
    try {
      for (const value of shape.posteriors) {
        const doc = parsePosterior(value);
        if (state.posteriors.has(doc.id)) throw new Error('duplicate');
        state.posteriors.set(doc.id, doc);
      }
      for (const value of shape.decisions) {
        const row = parseDecision(value);
        if (!isDecisionId(row.id) || state.decisions.has(row.id)) throw new Error('duplicate');
        state.decisions.set(row.id, row);
      }
    } catch {
      throw new Error('reply_style_file_corrupt');
    }
    return state;
  }

  private write(state: State): void {
    const decisions = [...state.decisions.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const posteriors = [...state.posteriors.values()].sort((a, b) => a.id.localeCompare(b.id));
    let json = JSON.stringify({ schemaVersion: 1, posteriors, decisions } satisfies FileShape);
    // Keep the file readable under the read limit: drop the oldest evaluation rows first.
    while (Buffer.byteLength(json, 'utf8') > MAX_REPLY_STYLE_FILE_BYTES && decisions.length > 0) {
      decisions.splice(0, Math.max(1, Math.ceil(decisions.length / 10)));
      json = JSON.stringify({ schemaVersion: 1, posteriors, decisions } satisfies FileShape);
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_REPLY_STYLE_FILE_BYTES) throw new Error('reply_style_capacity');
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    const fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      try {
        writeFileSync(fd, json, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.path);
    } catch (error) {
      try { unlinkSync(tmp); } catch { /* already gone */ }
      throw error;
    }
  }
}

function changed(before: State, after: State): boolean {
  if (before.posteriors.size !== after.posteriors.size || before.decisions.size !== after.decisions.size) return true;
  for (const [id, doc] of after.posteriors) if (before.posteriors.get(id) !== doc) return true;
  for (const [id, row] of after.decisions) if (before.decisions.get(id) !== row) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Firestore store
// ---------------------------------------------------------------------------

/**
 * Collections 'vox_reply_style' (posterior docs) and 'vox_reply_style_eval'
 * (offline-evaluation rows; enable the Firestore TTL policy on expiresAt at
 * deploy time, or schedule sweep()). No other collection is touched.
 */
export class FirestoreReplyStyleStore implements ReplyStyleStore {
  private readonly posteriorsName: string;
  private readonly decisionsName: string;

  constructor(private readonly db: Firestore, options: { posteriors?: string; decisions?: string } = {}) {
    this.posteriorsName = options.posteriors ?? 'vox_reply_style';
    this.decisionsName = options.decisions ?? 'vox_reply_style_eval';
  }

  async get(key: ReplyStyleKey): Promise<ReplyStylePosteriorDoc | null> {
    const id = posteriorDocId(key);
    const snap = await this.db.collection(this.posteriorsName).doc(id).get();
    return snap.exists ? parsePosterior(parseJsonField(snap.get('json')), id) : null;
  }

  async appendDecision(record: ReplyStyleEvalRecord): Promise<void> {
    const parsed = parseDecision(structuredClone(record));
    if (!isDecisionId(parsed.id)) throw new Error('reply_style_bad_decision_id');
    const ref = this.db.collection(this.decisionsName).doc(parsed.id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) throw new Error('reply_style_duplicate_decision');
      tx.set(ref, decisionRow(parsed));
    });
  }

  settle<T>(decisionId: string, mutate: Mutate<T>): Promise<T> {
    return this.db.runTransaction(async (tx) => {
      const evalRef = isDecisionId(decisionId) ? this.db.collection(this.decisionsName).doc(decisionId) : null;
      const evalSnap = evalRef ? await tx.get(evalRef) : null;
      const decision = evalSnap?.exists ? parseDecision(parseJsonField(evalSnap.get('json')), decisionId) : null;
      const docId = decision ? posteriorDocIdForPersonKey(decision.context.personKey, decision.context.personaId,
        decision.context.space, decision.context.route) : null;
      const docRef = docId ? this.db.collection(this.posteriorsName).doc(docId) : null;
      const docSnap = docRef ? await tx.get(docRef) : null;
      const doc = docSnap?.exists ? parsePosterior(parseJsonField(docSnap.get('json')), docId ?? undefined) : null;
      const out = mutate(decision, doc);
      const nextDecision = out.decision ? parseDecision(structuredClone(out.decision), decisionId) : undefined;
      const nextDoc = out.doc ? parsePosterior(structuredClone(out.doc), docId ?? undefined) : undefined;
      if (nextDecision) {
        if (!evalRef || !decision) throw new Error('reply_style_decision_identity');
        tx.set(evalRef, decisionRow(nextDecision));
      }
      if (nextDoc) {
        if (!docRef) throw new Error('reply_style_doc_identity');
        tx.set(docRef, posteriorRow(nextDoc));
      }
      return out.result;
    });
  }

  async listPosteriors(filter: ScopeFilter): Promise<ReplyStylePosteriorDoc[]> {
    const snap = await this.scopeQuery(this.posteriorsName, filter).limit(MAX_LIST).get();
    return snap.docs.map(d => parsePosterior(parseJsonField(d.get('json')), d.id))
      .filter(doc => inScope(filter, doc.personKey, doc.personaId, doc.space));
  }

  async listDecisions(filter: DecisionFilter): Promise<ReplyStyleEvalRecord[]> {
    let query: Query = this.db.collection(this.decisionsName);
    if (filter.since !== undefined) query = query.where('at', '>=', new Date(filter.since));
    if (filter.until !== undefined) query = query.where('at', '<=', new Date(filter.until));
    const snap = await query.orderBy('at').limit(listLimit(filter.limit)).get();
    return snap.docs.map(d => parseDecision(parseJsonField(d.get('json')), d.id));
  }

  async deleteScope(filter: ScopeFilter): Promise<{ posteriors: number; decisions: number }> {
    const posteriors = await this.deleteAll(this.scopeQuery(this.posteriorsName, filter));
    const decisions = await this.deleteAll(this.scopeQuery(this.decisionsName, filter));
    return { posteriors, decisions };
  }

  sweep(now: number): Promise<number> {
    return this.deleteAll(this.db.collection(this.decisionsName).where('expiresAt', '<=', new Date(now)));
  }

  private scopeQuery(collection: string, filter: ScopeFilter): Query {
    let query: Query = this.db.collection(collection).where('personKey', '==', filter.personKey);
    if (filter.personaId !== undefined) query = query.where('personaId', '==', filter.personaId);
    if (filter.space !== undefined) query = query.where('space', '==', filter.space);
    return query;
  }

  private async deleteAll(query: Query): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_DELETE_ROUNDS; round++) {
      const snap = await query.limit(DELETE_CHUNK).get();
      if (snap.empty) return total;
      const batch = this.db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      total += snap.size;
    }
    throw new Error('reply_style_delete_incomplete');
  }
}

function posteriorRow(doc: ReplyStylePosteriorDoc) {
  return { personKey: doc.personKey, personaId: doc.personaId, space: doc.space, route: doc.route,
    json: JSON.stringify(doc), updatedAt: new Date(doc.updatedAt) };
}

function decisionRow(record: ReplyStyleEvalRecord) {
  return { personKey: record.context.personKey, personaId: record.context.personaId, space: record.context.space,
    at: new Date(record.at), expiresAt: new Date(record.expiresAt), settled: record.reward !== null, json: JSON.stringify(record) };
}
