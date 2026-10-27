import { fileRuntimeFs, assertFileRuntimePath, createFileRuntimeTransientDirectory } from '../studio/file-runtime-owner';
const { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } = fileRuntimeFs;
/**
 * Agent choices and card receipts (Circles S1), one record per (agent, Telegram user). Not in the single
 * studio/state document: strangers create them, and that document is written whole under Firestore's
 * 1 MiB cap. A record is bounded (one choice, at most RECEIPTS_PER_PERSON receipts), so nothing here
 * evicts another person's choice. Two implementations, picked like the pet store (runtime.ts):
 *  - FileAgentChoiceStore: one JSON file per agent (`<dataDir>/circles/<agentId>.json`), writes serialized
 *  - FirestoreAgentChoiceStore: `studio_agent_choices/{agentId}_{tgUserId}`, read-modify-write in a transaction
 * Records are validated on read; an invalid one throws (fail closed) and erasure still removes it.
 */


import { join, resolve } from 'path';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { AgentJoin, JoinReceipt } from '../studio/types';

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const CHOICE_COLLECTION = 'studio_agent_choices';
/** Cards one person may hold open for one agent; the oldest goes first. */
export const RECEIPTS_PER_PERSON = 5;

export interface AgentChoiceRecord {
  v: 1;
  agentId: string;
  telegramId: number;
  join?: AgentJoin;
  receipts: JoinReceipt[];
}

export interface AgentChoiceStore {
  get(agentId: string, telegramId: number): Promise<AgentChoiceRecord | null>;
  /** Atomic read-modify-write of one record; `record: null` deletes it, an unchanged record is not written. `fn` may rerun (Firestore retries). */
  update<T>(agentId: string, telegramId: number, fn: (current: AgentChoiceRecord | null) => { record: AgentChoiceRecord | null; result: T }): Promise<T>;
  /** Rights export: one person's records for every agent. */
  listForUser(telegramId: number): Promise<AgentChoiceRecord[]>;
  /** Rights erasure: deletes one person's records for every agent; returns how many went. */
  eraseUser(telegramId: number): Promise<number>;
  /** Agent fire/retire: deletes every person's record for that agent. */
  clearAgent(agentId: string): Promise<number>;
}

const iso = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const notice = z.object({ id: z.string(), version: z.string(), copyHash: z.string().regex(/^[a-f0-9]{64}$/), locale: z.enum(['en', 'fa']), presentedAt: iso }).strict();
const surface = z.enum(['dm_card', 'group_card', 'mini_app']);
const joinSchema = z.object({
  agentId: z.string(), telegramId: z.number().int().positive(), choice: z.enum(['joined', 'reply_only', 'declined']), notice, decidedAt: iso, surface,
  revision: z.number().int().positive(), eventId: z.string(), receiptId: z.string().optional(), adultDeclaredAt: iso.optional(),
}).strict();
const receiptSchema = z.object({
  id: z.string(), agentId: z.string(), telegramId: z.number().int().positive(), surface, notice, chatId: z.number().int().optional(), expiresAt: iso, consumedAt: iso.optional(),
}).strict();
const recordSchema = z.object({ v: z.literal(1), agentId: z.string(), telegramId: z.number().int().positive(), join: joinSchema.optional(), receipts: z.array(receiptSchema).max(RECEIPTS_PER_PERSON) }).strict();

/** A stored record for exactly this agent and person, or a thrown error: a corrupt choice never reads as none. */
export function parseChoiceRecord(raw: unknown, agentId: string, telegramId: number): AgentChoiceRecord {
  const record = recordSchema.parse(raw) as AgentChoiceRecord;
  const mine = (r: { agentId: string; telegramId: number }) => r.agentId === agentId && r.telegramId === telegramId;
  if (!mine(record) || (record.join && !mine(record.join)) || !record.receipts.every(mine)) throw new Error('invalid_agent_choice_record');
  return record;
}

function assertAgent(agentId: string) { if (!AGENT_ID.test(agentId)) throw new Error('Invalid agent id'); }
function assertUser(telegramId: number) { if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new Error('Invalid user id'); }
/** Firestore rejects undefined values; records have optional fields. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/* ---------- file ---------- */

type AgentFile = Record<string, unknown>;
const fileQueues = new Map<string, Promise<unknown>>();

export class FileAgentChoiceStore implements AgentChoiceStore {
  constructor(readonly dir: string) { assertFileRuntimePath(dir); }

  private file(agentId: string) { return join(this.dir, `${agentId}.json`); }

  private load(agentId: string): AgentFile {
    const file = this.file(agentId);
    if (!existsSync(file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_agent_choice_file');
    return parsed as AgentFile;
  }

  private save(agentId: string, records: AgentFile) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(agentId);
    if (!Object.keys(records).length) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify(records), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  private serial<T>(run: () => T): Promise<T> {
    const key = resolve(this.dir);
    const execute = () => {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const lock = join(this.dir, '.writer.lock');
      // Cross-process exclusion fails closed. A crashed lock requires an operator recovery.
      createFileRuntimeTransientDirectory(lock);
      try { return run(); } finally { rmdirSync(lock); }
    };
    const next = (fileQueues.get(key) ?? Promise.resolve()).then(execute, execute);
    const settled = next.catch(() => undefined);
    fileQueues.set(key, settled);
    void settled.then(() => { if (fileQueues.get(key) === settled) fileQueues.delete(key); });
    return next;
  }

  private agents(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => AGENT_ID.test(id));
  }

  async get(agentId: string, telegramId: number): Promise<AgentChoiceRecord | null> {
    assertAgent(agentId); assertUser(telegramId);
    return this.serial(() => {
      const raw = this.load(agentId)[telegramId];
      return raw === undefined ? null : parseChoiceRecord(raw, agentId, telegramId);
    });
  }

  async update<T>(agentId: string, telegramId: number, fn: (current: AgentChoiceRecord | null) => { record: AgentChoiceRecord | null; result: T }): Promise<T> {
    assertAgent(agentId); assertUser(telegramId);
    return this.serial(() => {
      const records = this.load(agentId);
      const before = records[telegramId] === undefined ? null : parseChoiceRecord(records[telegramId], agentId, telegramId);
      const { record, result } = fn(before === null ? null : structuredClone(before));
      if (JSON.stringify(record) === JSON.stringify(before)) return result;
      if (record) records[telegramId] = parseChoiceRecord(plain(record), agentId, telegramId);
      else delete records[telegramId];
      this.save(agentId, records);
      return result;
    });
  }

  async listForUser(telegramId: number): Promise<AgentChoiceRecord[]> {
    assertUser(telegramId);
    return this.serial(() => this.agents().flatMap((agentId) => {
      const raw = this.load(agentId)[telegramId];
      return raw === undefined ? [] : [parseChoiceRecord(raw, agentId, telegramId)];
    }));
  }

  async eraseUser(telegramId: number): Promise<number> {
    assertUser(telegramId);
    return this.serial(() => {
      let erased = 0;
      for (const agentId of this.agents()) {
        const records = this.load(agentId);
        if (!(String(telegramId) in records)) continue;
        delete records[telegramId];
        this.save(agentId, records);
        erased++;
      }
      return erased;
    });
  }

  async clearAgent(agentId: string): Promise<number> {
    assertAgent(agentId);
    return this.serial(() => {
      const count = existsSync(this.file(agentId)) ? Object.keys(this.load(agentId)).length : 0;
      rmSync(this.file(agentId), { force: true });
      return count;
    });
  }
}

/* ---------- Firestore ---------- */

/** Firestore batches hold at most 500 writes. */
const BATCH = 400;

/**
 * `studio_agent_choices/{agentId}_{telegramId}` = { agentId, telegramId, record, updatedAt }. agentId and
 * telegramId are top-level so export/erasure (by person) and retire (by agent) are single-field queries.
 */
export class FirestoreAgentChoiceStore implements AgentChoiceStore {
  constructor(private readonly db: Firestore, private readonly collection = CHOICE_COLLECTION) {}

  private ref(agentId: string, telegramId: number) { return this.db.collection(this.collection).doc(`${agentId}_${telegramId}`); }

  async get(agentId: string, telegramId: number): Promise<AgentChoiceRecord | null> {
    assertAgent(agentId); assertUser(telegramId);
    const snap = await this.ref(agentId, telegramId).get();
    return snap.exists ? parseChoiceRecord(snap.data()?.record, agentId, telegramId) : null;
  }

  async update<T>(agentId: string, telegramId: number, fn: (current: AgentChoiceRecord | null) => { record: AgentChoiceRecord | null; result: T }): Promise<T> {
    assertAgent(agentId); assertUser(telegramId);
    const ref = this.ref(agentId, telegramId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const before = snap.exists ? parseChoiceRecord(snap.data()?.record, agentId, telegramId) : null;
      const { record, result } = fn(before === null ? null : structuredClone(before));
      if (JSON.stringify(record) === JSON.stringify(before)) return result;
      if (record) tx.set(ref, { agentId, telegramId, record: parseChoiceRecord(plain(record), agentId, telegramId), updatedAt: Date.now() });
      else tx.delete(ref);
      return result;
    });
  }

  async listForUser(telegramId: number): Promise<AgentChoiceRecord[]> {
    assertUser(telegramId);
    const snap = await this.db.collection(this.collection).where('telegramId', '==', telegramId).get();
    return snap.docs.map((doc) => { const data = doc.data(); return parseChoiceRecord(data.record, String(data.agentId), telegramId); });
  }

  private async deleteWhere(field: 'telegramId' | 'agentId', value: number | string): Promise<number> {
    const refs: DocumentReference[] = (await this.db.collection(this.collection).where(field, '==', value).get()).docs.map((doc) => doc.ref);
    for (let i = 0; i < refs.length; i += BATCH) {
      const batch = this.db.batch();
      for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
      await batch.commit();
    }
    return refs.length;
  }

  async eraseUser(telegramId: number): Promise<number> { assertUser(telegramId); return this.deleteWhere('telegramId', telegramId); }
  async clearAgent(agentId: string): Promise<number> { assertAgent(agentId); return this.deleteWhere('agentId', agentId); }
}
