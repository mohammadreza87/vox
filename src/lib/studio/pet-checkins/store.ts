import { fileRuntimeFs, assertFileRuntimePath } from '../file-runtime-owner';
const { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } = fileRuntimeFs;
/**
 * Pet check-in records (design PET_CARE_GAME_DESIGN_2026_10_26 §5, §6.2 P1): one per person (`pet/checkins.ts`
 * PetCheckinRecord), holding each agent's consent and moment types, the caps' counters and the content-free sent rows.
 * The storage profiles follow pet-play-store.ts:
 *  - FilePetCheckinStore: `<dataDir>/pets/checkins/<userId>.json`, under the pet directory's writer lock
 *  - FirestorePetCheckinStore: `studio_pet_checkins/{userId}`, read-modify-write in a transaction
 *
 * The record shares pet care's erasure epoch, so an open from before a forget can write nothing here either. Export
 * and forget (My data, the rights intake) and agent fire reach it. sanitizeCheckinRecord drops anything that is not a
 * catalogue id, an opaque reference, a hash, a local day, a time, a count or a flag: no text can ever be stored.
 */


import { join } from 'path';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  CHECKIN_LIMITS, CHECKIN_MOMENT_IDS, CHECKIN_MOMENT_TYPES, CHECKIN_POLICY_VERSION, CHECKIN_PURPOSE, CHECKIN_REF, CHECKIN_TYPE_DEFAULTS,
  type CheckinMomentId, type CheckinTypes, type PetCheckinRecord,
} from '../../pet/checkins';
import { SEASON_IDS } from '../../pet/play';
import { FirestoreStudioStore } from '../firestore-store';
import { PET_COLLECTION, PetCareChangedError, petEpochCollection, petFileSerial, readPetFileEpoch } from '../pet-store';
import { StudioStore } from '../store';
import type { Studio } from '../service';

export const PET_CHECKIN_COLLECTION = 'studio_pet_checkins';
const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_AGENTS = 64;

export interface PetCheckinStore {
  get(userId: number): Promise<PetCheckinRecord | null>;
  /**
   * Atomic read-modify-write of one person's record: `fn` gets the current record (null before the first) and returns
   * the record to save plus a result, or `record: null` to write nothing. `fn` may run more than once (Firestore
   * retries). With `expectedEpoch`, a forget since then fails it with PetCareChangedError.
   */
  update<T>(userId: number, fn: (current: PetCheckinRecord | null) => { record: PetCheckinRecord | null; result: T }, expectedEpoch?: string): Promise<T>;
  /** The people with check-ins on for at least one agent (the trigger's work list). */
  listEnabled(): Promise<number[]>;
  /** Rights erasure: deletes the person's record; returns 1 when one went. The shared epoch is rotated by care's own erasure. */
  eraseUser(userId: number): Promise<number>;
  /** Agent fire/retire: removes that agent's consent, counters and sent rows from every record. */
  clearAgent(agentId: string): Promise<number>;
}

/* ---------- sanitizing ---------- */

const time = z.number().int().nonnegative().safe();
const typesSchema = z.object(Object.fromEntries(CHECKIN_MOMENT_TYPES.map((t) => [t, z.boolean()])) as Record<keyof CheckinTypes, z.ZodBoolean>);
const evidenceSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/), noticeId: z.enum(['perm.P1', 'perm.P1.forming']), noticeVersion: z.literal(CHECKIN_POLICY_VERSION),
  copyHash: z.string().regex(/^[a-f0-9]{64}$/), locale: z.enum(['en', 'fa']), presentedAt: time, decidedAt: time, surface: z.literal('mini_app'), affirmative: z.literal(true),
});
const consentSchema = z.object({
  purpose: z.literal(CHECKIN_PURPOSE), state: z.enum(['granted', 'withdrawn']), revision: z.number().int().positive().max(1_000_000), effectiveAt: time,
  evidence: evidenceSchema, withdrawnAt: time.optional(), withdrawnVia: z.enum(['settings', 'stop_all']).optional(),
});
const agentSchema = z.object({
  enabled: z.boolean(), types: typesSchema.catch({ ...CHECKIN_TYPE_DEFAULTS }), consent: consentSchema.optional().catch(undefined),
  lastSentAt: time.optional(), week: z.array(time).max(16).catch([]),
});
const sentSchema = z.object({
  ref: z.string().regex(CHECKIN_REF), agentId: z.string().regex(AGENT_ID), moment: z.enum(CHECKIN_MOMENT_IDS as unknown as [CheckinMomentId, ...CheckinMomentId[]]),
  occurrence: z.string().regex(/^[a-z0-9:_-]{1,48}$/), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), personHash: z.string().regex(/^[a-f0-9]{16,64}$/),
  at: time, state: z.enum(['reserved', 'accepted', 'unknown', 'failed', 'cancelled']), lang: z.enum(['en', 'fa']), variant: z.number().int().min(0).max(15),
  openedAt: time.optional(), openedVia: z.enum(['ref', 'app']).optional(), whyAt: time.optional(), stoppedAt: time.optional(), by: z.enum(['local', 'decisions']).optional(),
});
const zone = z.string().max(64).regex(/^(UTC|[A-Za-z_]+\/[A-Za-z_+\-/0-9]+)$/);
const recordSchema = z.object({
  v: z.literal(1), createdAt: time, updatedAt: time, lang: z.enum(['en', 'fa']).catch('en'), tz: zone.optional().catch(undefined), sound: z.boolean().catch(false),
  pausedAt: time.optional().catch(undefined), pausedNoteAt: time.optional().catch(undefined), resumedAt: time.optional().catch(undefined), unopenedStreak: z.number().int().min(0).max(100).catch(0),
  agents: z.record(z.string(), z.unknown()).catch({}),
  seasons: z.object(Object.fromEntries(SEASON_IDS.map((s) => [s, z.number().int().min(1300).max(1600).optional()]))).catch({}),
  sent: z.array(z.unknown()).catch([]),
});

/** The stored form: unknown keys dropped, bad rows and agents skipped, arrays capped. Null when it is not a record at all. */
export function sanitizeCheckinRecord(raw: unknown, userId: number): PetCheckinRecord | null {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const agents: PetCheckinRecord['agents'] = {};
  for (const [id, value] of Object.entries(r.agents).slice(0, MAX_AGENTS)) {
    if (!AGENT_ID.test(id)) continue;
    const a = agentSchema.safeParse(value);
    if (!a.success) continue;
    agents[id] = { enabled: a.data.enabled, types: { ...a.data.types }, week: a.data.week.slice(-CHECKIN_LIMITS.perAgentPerWeek * 2),
      ...(a.data.consent ? { consent: a.data.consent } : {}), ...(a.data.lastSentAt !== undefined ? { lastSentAt: a.data.lastSentAt } : {}) };
  }
  const sent = r.sent.flatMap((row) => { const s = sentSchema.safeParse(row); return s.success ? [s.data] : []; }).slice(-CHECKIN_LIMITS.sentRows);
  const seasons: PetCheckinRecord['seasons'] = {};
  for (const id of SEASON_IDS) if (r.seasons[id] !== undefined) seasons[id] = r.seasons[id];
  return {
    v: 1, userId, createdAt: r.createdAt, updatedAt: r.updatedAt, lang: r.lang, sound: r.sound, unopenedStreak: r.unopenedStreak, agents, seasons, sent,
    ...(r.tz ? { tz: r.tz } : {}), ...(r.pausedAt !== undefined ? { pausedAt: r.pausedAt } : {}), ...(r.pausedNoteAt !== undefined ? { pausedNoteAt: r.pausedNoteAt } : {}),
    ...(r.resumedAt !== undefined ? { resumedAt: r.resumedAt } : {}),
  };
}

/** Firestore rejects undefined values; JSON drops them. */
const plain = (record: PetCheckinRecord) => JSON.parse(JSON.stringify(record)) as PetCheckinRecord;
const anyEnabled = (record: PetCheckinRecord) => Object.values(record.agents).some((a) => a.enabled);
function assertUser(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id');
}
function withoutAgent(record: PetCheckinRecord, agentId: string): PetCheckinRecord | null {
  if (!(agentId in record.agents) && !record.sent.some((s) => s.agentId === agentId)) return null;
  const agents = { ...record.agents };
  delete agents[agentId];
  return { ...record, agents, sent: record.sent.filter((s) => s.agentId !== agentId) };
}

/* ---------- file ---------- */

/** `petsDir` is the pet care directory (FilePetStore.dir): the records live in its `checkins/` and share its lock and epochs. */
export class FilePetCheckinStore implements PetCheckinStore {
  constructor(readonly petsDir: string) { assertFileRuntimePath(petsDir); }

  private get dir() { return join(this.petsDir, 'checkins'); }
  private file(userId: number) { return join(this.dir, `${userId}.json`); }
  private serial<T>(run: () => T): Promise<T> { return petFileSerial(this.petsDir, run); }

  private load(userId: number): PetCheckinRecord | null {
    const file = this.file(userId);
    return existsSync(file) ? sanitizeCheckinRecord(JSON.parse(readFileSync(file, 'utf8')), userId) : null;
  }

  private save(record: PetCheckinRecord) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(record.userId);
    writeFileSync(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  private users(): number[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => /^\d{1,16}\.json$/.test(f)).map((f) => Number(f.slice(0, -5))).filter((id) => Number.isSafeInteger(id) && id > 0);
  }

  async get(userId: number): Promise<PetCheckinRecord | null> {
    assertUser(userId);
    return this.serial(() => this.load(userId));
  }

  async update<T>(userId: number, fn: (current: PetCheckinRecord | null) => { record: PetCheckinRecord | null; result: T }, expectedEpoch?: string): Promise<T> {
    assertUser(userId);
    return this.serial(() => {
      if (expectedEpoch !== undefined && readPetFileEpoch(this.petsDir, userId) !== expectedEpoch) throw new PetCareChangedError('Pet care changed');
      const { record, result } = fn(this.load(userId));
      if (!record) return result;
      const clean = sanitizeCheckinRecord(plain({ ...record, v: 1, userId }), userId);
      if (clean) this.save(clean);
      return result;
    });
  }

  async listEnabled(): Promise<number[]> {
    return this.serial(() => this.users().filter((id) => { const r = this.load(id); return !!r && anyEnabled(r); }));
  }

  async eraseUser(userId: number): Promise<number> {
    assertUser(userId);
    return this.serial(() => {
      const had = existsSync(this.file(userId));
      rmSync(this.file(userId), { force: true });
      return had ? 1 : 0;
    });
  }

  async clearAgent(agentId: string): Promise<number> {
    if (!AGENT_ID.test(agentId)) throw new Error('Invalid agent id');
    return this.serial(() => {
      let cleared = 0;
      for (const id of this.users()) {
        const record = this.load(id);
        const next = record && withoutAgent(record, agentId);
        if (next) { this.save(next); cleared++; }
      }
      return cleared;
    });
  }
}

/* ---------- Firestore ---------- */

/** `studio_pet_checkins/{userId}` = { userId, enabled, record, updatedAt }; `enabled` (any agent on) is the trigger's query field. */
export class FirestorePetCheckinStore implements PetCheckinStore {
  constructor(private readonly db: Firestore, private readonly collection = PET_CHECKIN_COLLECTION, private readonly careCollection = PET_COLLECTION) {}

  private ref(userId: number) { return this.db.collection(this.collection).doc(String(userId)); }
  private epochRef(userId: number) { return this.db.collection(petEpochCollection(this.careCollection)).doc(String(userId)); }

  async get(userId: number): Promise<PetCheckinRecord | null> {
    assertUser(userId);
    const snap = await this.ref(userId).get();
    return snap.exists ? sanitizeCheckinRecord(snap.data()?.record, userId) : null;
  }

  async update<T>(userId: number, fn: (current: PetCheckinRecord | null) => { record: PetCheckinRecord | null; result: T }, expectedEpoch?: string): Promise<T> {
    assertUser(userId);
    const ref = this.ref(userId);
    return this.db.runTransaction(async (tx) => {
      const epoch = (await tx.get(this.epochRef(userId))).data()?.epoch ?? 'initial';
      if (expectedEpoch !== undefined && epoch !== expectedEpoch) throw new PetCareChangedError('Pet care changed');
      const snap = await tx.get(ref);
      const { record, result } = fn(snap.exists ? sanitizeCheckinRecord(snap.data()?.record, userId) : null);
      if (!record) return result;
      const clean = sanitizeCheckinRecord(plain({ ...record, v: 1, userId }), userId);
      if (clean) tx.set(ref, { userId, enabled: anyEnabled(clean), record: plain(clean), updatedAt: Date.now() });
      return result;
    });
  }

  async listEnabled(): Promise<number[]> {
    const snap = await this.db.collection(this.collection).where('enabled', '==', true).get();
    return snap.docs.map((doc) => doc.data().userId).filter((id): id is number => Number.isSafeInteger(id) && id > 0);
  }

  async eraseUser(userId: number): Promise<number> {
    assertUser(userId);
    const ref = this.ref(userId);
    const had = (await ref.get()).exists;
    await ref.delete();
    return had ? 1 : 0;
  }

  async clearAgent(agentId: string): Promise<number> {
    if (!AGENT_ID.test(agentId)) throw new Error('Invalid agent id');
    const snap = await this.db.collection(this.collection).get();
    let cleared = 0;
    for (const doc of snap.docs) {
      const userId = doc.data().userId;
      if (typeof userId !== 'number') continue;
      const changed = await this.update(userId, (current) => {
        const next = current && withoutAgent(current, agentId);
        return { record: next, result: !!next };
      });
      if (changed) cleared++;
    }
    return cleared;
  }
}

/* ---------- wiring ---------- */

const created = new WeakMap<Studio, Promise<PetCheckinStore>>();

/**
 * The Studio's check-in store: `deps.petCheckins` when wired (runtime.ts, tests), else derived from the Studio store
 * like petPlayStoreFor. Runtime wires it explicitly: route bundles carry their own class copies, so the instanceof
 * fallback is for tests.
 */
export function petCheckinStoreFor(studio: Studio): Promise<PetCheckinStore> {
  if (studio.deps.petCheckins) return Promise.resolve(studio.deps.petCheckins);
  let pending = created.get(studio);
  if (!pending) {
    pending = (async (): Promise<PetCheckinStore> => {
      const store = studio.deps.store;
      if (store instanceof StudioStore) return new FilePetCheckinStore(join(store.dir, 'pets'));
      if (store instanceof FirestoreStudioStore) {
        const { getAdminDb } = await import('@/lib/firebase-admin');
        return new FirestorePetCheckinStore(await getAdminDb());
      }
      throw new Error('Pet check-in storage is unavailable');
    })();
    pending.catch(() => created.delete(studio));
    created.set(studio, pending);
  }
  return pending;
}

/** A fresh opaque reference (22 base64url characters): the Open button's `?ci=` and the callback buttons. */
export function newCheckinRef(): string {
  return Buffer.from(randomUUID().replace(/-/g, ''), 'hex').toString('base64url');
}
