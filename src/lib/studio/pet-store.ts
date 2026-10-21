/**
 * Pet care state, one record per (agent, Telegram user). Not in the single studio/state document:
 * every tap batch writes, and the care page must not contend with Studio edits. Two implementations,
 * picked the same way the Studio store is (runtime.ts):
 *  - FilePetStore: one JSON file per agent (`<dataDir>/pets/<agentId>.json`), writes serialized
 *  - FirestorePetStore: `studio_pets/{agentId}_{tgUserId}`, read-modify-write in a transaction
 *
 * Stored values are re-validated on read (sanitizeCare), so a hand-edited or older record can never
 * put a need outside [floor, 100].
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { clampNeeds, NEW_PET, safeZone } from '../pet/care';
import { QUIET_HOURS, type PetCare, type Stage } from '../pet/types';
import { FirestoreStudioStore } from './firestore-store';
import { canUseAgent } from './permissions';
import { StudioStore } from './store';
import type { Studio } from './service';
import { brandError, namedError } from '../error-contract';

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const PET_COLLECTION = 'studio_pets';

export interface PetStore {
  get(agentId: string, userId: number): Promise<PetCare | null>;
  /** Durable deletion generation; old requests cannot recreate erased care. */
  erasureEpoch(userId: number): Promise<string>;
  /** Synchronous committed effect fence. Unsupported stores cannot serve private pet turns. */
  erasureEpochNow?(userId: number): string | null;
  /**
   * Atomic read-modify-write of one record: `fn` gets the current care (null on a first meeting) and
   * returns the care to save plus a result. `fn` may run more than once (Firestore retries).
   */
  update<T>(agentId: string, userId: number, fn: (current: PetCare | null) => { care: PetCare; result: T }, expectedEpoch?: string): Promise<T>;
  /** Rights export: every agent's care for one person. */
  listForUser(userId: number): Promise<PetCare[]>;
  /** Rights erasure: deletes one person's care for every agent; returns how many records went. */
  eraseUser(userId: number): Promise<number>;
  /** Agent fire/retire: deletes every person's care for that agent. */
  clearAgent(agentId: string): Promise<number>;
  /** Retention: deletes the records not seen since `before` that `drop` picks; returns how many went. */
  sweep(before: number, drop: (agentId: string, userId: number) => boolean): Promise<number>;
}

const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const stage = (v: unknown): Stage => (v === 1 || v === 2 || v === 3 || v === 4 ? v : 1);

/** A stored record as PetCare, or null if it isn't one for this agent and user. */
export function sanitizeCare(raw: unknown, agentId: string, userId: number): PetCare | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.agentId !== agentId || r.userId !== userId) return null;
  const caps = (r.caps && typeof r.caps === 'object' ? r.caps : {}) as Record<string, unknown>;
  const now = num(r.lastUpdatedAt, 0);
  const care: PetCare = {
    v: 1, agentId, userId,
    tummy: num(r.tummy, NEW_PET.tummy), joy: num(r.joy, NEW_PET.joy), energy: num(r.energy, NEW_PET.energy),
    bond: Math.max(0, Math.floor(num(r.bond, 0))),
    seenBond: Math.max(0, Math.floor(num(r.seenBond, 0))),
    asleep: r.asleep === true,
    lastUpdatedAt: now, lastSeenAt: num(r.lastSeenAt, now), firstMetAt: num(r.firstMetAt, now),
    tz: safeZone(r.tz), quietStart: QUIET_HOURS.start, quietEnd: QUIET_HOURS.end,
    lastSeenStage: stage(r.lastSeenStage),
    caps: {
      hourStart: num(caps.hourStart, 0), petJoy: Math.max(0, num(caps.petJoy, 0)), talkJoy: Math.max(0, num(caps.talkJoy, 0)),
      careBond: Math.max(0, num(caps.careBond, 0)), dayStart: num(caps.dayStart, 0),
    },
  };
  if (care.asleep) care.sleptAt = num(r.sleptAt, now);
  return clampNeeds(care);
}

function assertAgent(agentId: string) {
  if (!AGENT_ID.test(agentId)) throw new Error('Invalid agent id');
}
function assertUser(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id');
}

/* ---------- file ---------- */

type AgentFile = Record<string, PetCare>;

/** Local disk: one JSON file per agent, written atomically, every change serialized through one queue. */
const fileQueues = new Map<string, Promise<unknown>>();
export class PetCareChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PetCareChangedError';
    brandError(this, 'PetCareChangedError');
  }
  static is(error: unknown): error is PetCareChangedError {
    return namedError(error, 'PetCareChangedError');
  }
}

export class FilePetStore implements PetStore {

  constructor(readonly dir: string) {}

  private file(agentId: string) {
    return join(this.dir, `${agentId}.json`);
  }

  private load(agentId: string): AgentFile {
    const file = this.file(agentId);
    if (!existsSync(file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AgentFile : {};
  }

  private save(agentId: string, records: AgentFile) {
    mkdirSync(this.dir, { recursive: true });
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
      mkdirSync(lock, { mode: 0o700 });
      try { return run(); } finally { rmdirSync(lock); }
    };
    const next = (fileQueues.get(key) ?? Promise.resolve()).then(execute, execute);
    const settled = next.catch(() => undefined);
    fileQueues.set(key, settled);
    void settled.then(() => { if (fileQueues.get(key) === settled) fileQueues.delete(key); });
    return next;
  }

  private epoch(userId: number): string {
    const file = join(this.dir, '.epochs', `${userId}.json`);
    if (!existsSync(file)) return 'initial';
    const record = JSON.parse(readFileSync(file, 'utf8'));
    if (record.v !== 1 || typeof record.epoch !== 'string' || !/^[a-f0-9-]{36}$/.test(record.epoch)) throw new Error('Invalid pet erasure epoch');
    return record.epoch;
  }

  async erasureEpoch(userId: number): Promise<string> {
    assertUser(userId);
    return this.serial(() => this.epoch(userId));
  }

  erasureEpochNow(userId: number): string | null {
    assertUser(userId);
    if (existsSync(join(this.dir, '.writer.lock'))) return null;
    try { const epoch = this.epoch(userId); return existsSync(join(this.dir, '.writer.lock')) ? null : epoch; } catch { return null; }
  }

  private agents(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => AGENT_ID.test(id));
  }

  async get(agentId: string, userId: number): Promise<PetCare | null> {
    assertAgent(agentId); assertUser(userId);
    return this.serial(() => sanitizeCare(this.load(agentId)[userId], agentId, userId));
  }

  async update<T>(agentId: string, userId: number, fn: (current: PetCare | null) => { care: PetCare; result: T }, expectedEpoch?: string): Promise<T> {
    assertAgent(agentId); assertUser(userId);
    return this.serial(() => {
      if (expectedEpoch !== undefined && this.epoch(userId) !== expectedEpoch) throw new PetCareChangedError('Pet care changed');
      const records = this.load(agentId);
      const { care, result } = fn(sanitizeCare(records[userId], agentId, userId));
      records[userId] = structuredClone({ ...care, agentId, userId });
      this.save(agentId, records);
      return result;
    });
  }

  async listForUser(userId: number): Promise<PetCare[]> {
    assertUser(userId);
    return this.serial(() => this.agents().flatMap((agentId) => {
      const care = sanitizeCare(this.load(agentId)[userId], agentId, userId);
      return care ? [care] : [];
    }));
  }

  async eraseUser(userId: number): Promise<number> {
    assertUser(userId);
    return this.serial(() => {
      const epochs = join(this.dir, '.epochs');
      mkdirSync(epochs, { recursive: true, mode: 0o700 });
      const file = join(epochs, `${userId}.json`);
      writeFileSync(`${file}.tmp`, JSON.stringify({ v: 1, epoch: randomUUID() }), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      let erased = 0;
      for (const agentId of this.agents()) {
        const records = this.load(agentId);
        if (!(String(userId) in records)) continue;
        delete records[userId];
        this.save(agentId, records);
        erased++;
      }
      return erased;
    });
  }

  async clearAgent(agentId: string): Promise<number> {
    assertAgent(agentId);
    return this.serial(() => {
      const count = Object.keys(this.load(agentId)).length;
      rmSync(this.file(agentId), { force: true });
      return count;
    });
  }

  async sweep(before: number, drop: (agentId: string, userId: number) => boolean): Promise<number> {
    return this.serial(() => {
      let swept = 0;
      for (const agentId of this.agents()) {
        const records = this.load(agentId);
        const gone = Object.keys(records).filter((id) => {
          const care = sanitizeCare(records[id], agentId, Number(id));
          return !care || (care.lastSeenAt < before && drop(agentId, care.userId));
        });
        if (!gone.length) continue;
        for (const id of gone) delete records[id];
        this.save(agentId, records);
        swept += gone.length;
      }
      return swept;
    });
  }
}

/* ---------- Firestore ---------- */

/** Firestore rejects undefined values; care has optional fields. */
const stored = (care: PetCare) => JSON.parse(JSON.stringify(care)) as PetCare;
/** Firestore batches hold at most 500 writes. */
const BATCH = 400;

/**
 * `studio_pets/{agentId}_{userId}` = { agentId, userId, seenAt, care, updatedAt }. agentId, userId and
 * seenAt (care.lastSeenAt) are top-level so export/erasure (by user), retire (by agent) and the
 * retention sweep (by last visit) are single-field queries.
 */
export class FirestorePetStore implements PetStore {
  constructor(private readonly db: Firestore, private readonly collection = PET_COLLECTION) {}

  private epochRef(userId: number) { return this.db.collection(`${this.collection}_epochs`).doc(String(userId)); }

  async erasureEpoch(userId: number): Promise<string> {
    assertUser(userId);
    return (await this.epochRef(userId).get()).data()?.epoch ?? 'initial';
  }

  private ref(agentId: string, userId: number) {
    return this.db.collection(this.collection).doc(`${agentId}_${userId}`);
  }

  async get(agentId: string, userId: number): Promise<PetCare | null> {
    assertAgent(agentId); assertUser(userId);
    const snap = await this.ref(agentId, userId).get();
    return snap.exists ? sanitizeCare(snap.data()?.care, agentId, userId) : null;
  }

  async update<T>(agentId: string, userId: number, fn: (current: PetCare | null) => { care: PetCare; result: T }, expectedEpoch?: string): Promise<T> {
    assertAgent(agentId); assertUser(userId);
    const ref = this.ref(agentId, userId);
    return this.db.runTransaction(async (tx) => {
      const epoch = (await tx.get(this.epochRef(userId))).data()?.epoch ?? 'initial';
      if (expectedEpoch !== undefined && epoch !== expectedEpoch) throw new PetCareChangedError('Pet care changed');
      const snap = await tx.get(ref);
      const { care, result } = fn(snap.exists ? sanitizeCare(snap.data()?.care, agentId, userId) : null);
      tx.set(ref, { agentId, userId, seenAt: care.lastSeenAt, care: stored({ ...care, agentId, userId }), updatedAt: Date.now() });
      return result;
    });
  }

  async listForUser(userId: number): Promise<PetCare[]> {
    assertUser(userId);
    const snap = await this.db.collection(this.collection).where('userId', '==', userId).get();
    return snap.docs.flatMap((doc) => {
      const data = doc.data();
      const care = typeof data.agentId === 'string' ? sanitizeCare(data.care, data.agentId, userId) : null;
      return care ? [care] : [];
    });
  }

  private async deleteWhere(field: 'userId' | 'agentId', value: number | string): Promise<number> {
    const snap = await this.db.collection(this.collection).where(field, '==', value).get();
    return this.deleteDocs(snap.docs.map((doc) => doc.ref));
  }

  private async deleteDocs(refs: DocumentReference[]): Promise<number> {
    for (let i = 0; i < refs.length; i += BATCH) {
      const batch = this.db.batch();
      for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
      await batch.commit();
    }
    return refs.length;
  }

  async eraseUser(userId: number): Promise<number> {
    assertUser(userId);
    // Rotate before deleting: concurrent transactions on the old epoch must retry and fail.
    await this.db.runTransaction(async (tx) => {
      await tx.get(this.epochRef(userId));
      tx.set(this.epochRef(userId), { epoch: randomUUID() });
    });
    return this.deleteWhere('userId', userId);
  }

  async clearAgent(agentId: string): Promise<number> {
    assertAgent(agentId);
    return this.deleteWhere('agentId', agentId);
  }

  async sweep(before: number, drop: (agentId: string, userId: number) => boolean): Promise<number> {
    const snap = await this.db.collection(this.collection).where('seenAt', '<=', before - 1).get();
    return this.deleteDocs(snap.docs.filter((doc) => {
      const { agentId, userId } = doc.data();
      return typeof agentId === 'string' && typeof userId === 'number' && drop(agentId, userId);
    }).map((doc) => doc.ref));
  }
}

/* ---------- wiring ---------- */

const created = new WeakMap<Studio, Promise<PetStore>>();

/**
 * The Studio's pet store: `deps.pets` when wired (tests, runtime), else derived from the Studio
 * store the same way runtime.ts switches (file storage → beside studio.json, Firestore → the same
 * project). Created once per Studio.
 */
export function petStoreFor(studio: Studio): Promise<PetStore> {
  if (studio.deps.pets) return Promise.resolve(studio.deps.pets);
  let pending = created.get(studio);
  if (!pending) {
    pending = (async (): Promise<PetStore> => {
      const store = studio.deps.store;
      if (store instanceof StudioStore) return new FilePetStore(join(store.dir, 'pets'));
      if (store instanceof FirestoreStudioStore) {
        const { getAdminDb } = await import('@/lib/firebase-admin');
        return new FirestorePetStore(await getAdminDb());
      }
      throw new Error('Pet care storage is unavailable');
    })();
    pending.catch(() => created.delete(studio));
    created.set(studio, pending);
  }
  return pending;
}

/* ---------- retention ---------- */

/** A guest (or anyone who can no longer use the agent) who hasn't visited for this long loses the record. */
export const PET_GUEST_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** The sweep runs at most this often per Studio (the polling refresh and pet traffic both nudge it); a failed one retries sooner. */
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const SWEEP_RETRY_MS = 10 * 60 * 1000;
const sweptAt = new WeakMap<Studio, number>();

/**
 * Idempotent pet maintenance: every fired agent's care is cleared (retries a cleanup that failed at
 * fire time and removes a write that raced it), and a record whose person cannot use the agent
 * (a public agent's guest, someone removed from Studio) goes once it is PET_GUEST_RETENTION_MS old.
 * Members' records stay (the member rights path exports and erases them). Throttled per Studio; never
 * throws. Returns what it deleted, or null when it was not due or failed.
 */
export async function sweepPetCare(studio: Studio, force = false): Promise<{ fired: number; stale: number } | null> {
  const now = (studio.deps.now?.() ?? new Date()).getTime();
  const last = sweptAt.get(studio);
  if (!force && last !== undefined && now - last < SWEEP_EVERY_MS) return null;
  sweptAt.set(studio, now);
  try {
    const pets = await petStoreFor(studio);
    const state = await studio.deps.store.read();
    let fired = 0;
    for (const agent of state.agents) if (agent.status === 'fired') fired += await pets.clearAgent(agent.id);
    const members = new Map(state.members.map((m) => [m.telegramId, m]));
    const agents = new Map(state.agents.map((a) => [a.id, a]));
    const stale = await pets.sweep(now - PET_GUEST_RETENTION_MS, (agentId, userId) => {
      const agent = agents.get(agentId);
      return !agent || !canUseAgent(members.get(userId), agent) || (agent.blocked ?? []).includes(userId);
    });
    return { fired, stale };
  } catch {
    (studio.deps.logger ?? console).warn('[studio] pet_sweep_failed');
    sweptAt.set(studio, now - SWEEP_EVERY_MS + SWEEP_RETRY_MS);
    return null;
  }
}
