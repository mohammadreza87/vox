import { fileRuntimeFs, assertFileRuntimePath } from './file-runtime-owner';
const { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } = fileRuntimeFs;
/**
 * Pet play records (design PET_CARE_GAME_DESIGN_2026_10_26 §3.4): one per (agent, Telegram user), beside pet care and
 * never inside it. Content-free (pet/play.ts sanitizePlay drops anything that is not a catalogue id, a time, a count
 * or a flag). It follows PetCare wherever a person's data goes, with the same storage profiles as pet-store.ts:
 *  - FilePetPlayStore: `<dataDir>/pets/play/<agentId>.json`, under the pet directory's own writer lock
 *  - FirestorePetPlayStore: `studio_pet_play/{agentId}_{tgUserId}`, read-modify-write in a transaction
 *
 * One erasure epoch for care and play: both stores read and rotate the same generation (`<pets>/.epochs/<userId>.json`,
 * or `studio_pets_epochs/{userId}`), so a request that opened before a forget can write neither. Export and forget
 * (My data, the rights intake), agent fire/retire and the 90-day guest sweep all reach this store too.
 */


import { join } from 'path';
import { randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { sanitizePlay, type PetPlay } from '../pet/play';
import { FirestoreStudioStore } from './firestore-store';
import { canUseAgent } from './permissions';
import { PET_COLLECTION, PetCareChangedError, petEpochCollection, petFileSerial, readPetFileEpoch, rotatePetFileEpoch } from './pet-store';
import { StudioStore } from './store';
import type { Studio } from './service';

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const PET_PLAY_COLLECTION = 'studio_pet_play';

export interface PetPlayStore {
  get(agentId: string, userId: number): Promise<PetPlay | null>;
  /**
   * Atomic read-modify-write of one record: `fn` gets the current play (null before the first) and returns the play to
   * save plus a result, or `play: null` to write nothing. `fn` may run more than once (Firestore retries). With
   * `expectedEpoch`, a forget since then fails it with PetCareChangedError.
   */
  update<T>(agentId: string, userId: number, fn: (current: PetPlay | null) => { play: PetPlay | null; result: T }, expectedEpoch?: string): Promise<T>;
  /** Rights export: every agent's play for one person. */
  listForUser(userId: number): Promise<PetPlay[]>;
  /** Rights erasure: rotates the shared epoch, then deletes one person's play for every agent; returns how many went. */
  eraseUser(userId: number): Promise<number>;
  /** Agent fire/retire: deletes every person's play for that agent. */
  clearAgent(agentId: string): Promise<number>;
  /** Retention: deletes the records not seen since `before` that `drop` picks; returns how many went. */
  sweep(before: number, drop: (agentId: string, userId: number) => boolean): Promise<number>;
}

function assertAgent(agentId: string) {
  if (!AGENT_ID.test(agentId)) throw new Error('Invalid agent id');
}
function assertUser(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id');
}

/* ---------- file ---------- */

type AgentFile = Record<string, PetPlay>;

/** `petsDir` is the pet care directory (FilePetStore.dir): the play files live in its `play/` and share its lock and epochs. */
export class FilePetPlayStore implements PetPlayStore {
  constructor(readonly petsDir: string) { assertFileRuntimePath(petsDir); }

  private get dir() { return join(this.petsDir, 'play'); }
  private file(agentId: string) { return join(this.dir, `${agentId}.json`); }

  private load(agentId: string): AgentFile {
    const file = this.file(agentId);
    if (!existsSync(file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AgentFile : {};
  }

  private save(agentId: string, records: AgentFile) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(agentId);
    if (!Object.keys(records).length) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify(records), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  private serial<T>(run: () => T): Promise<T> { return petFileSerial(this.petsDir, run); }

  private agents(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => AGENT_ID.test(id));
  }

  async get(agentId: string, userId: number): Promise<PetPlay | null> {
    assertAgent(agentId); assertUser(userId);
    return this.serial(() => sanitizePlay(this.load(agentId)[userId], agentId, userId));
  }

  async update<T>(agentId: string, userId: number, fn: (current: PetPlay | null) => { play: PetPlay | null; result: T }, expectedEpoch?: string): Promise<T> {
    assertAgent(agentId); assertUser(userId);
    return this.serial(() => {
      if (expectedEpoch !== undefined && readPetFileEpoch(this.petsDir, userId) !== expectedEpoch) throw new PetCareChangedError('Pet care changed');
      const records = this.load(agentId);
      const { play, result } = fn(sanitizePlay(records[userId], agentId, userId));
      if (!play) return result;
      // Re-sanitized on the way in: the path decides identity, and nothing outside the catalogue is ever stored.
      records[userId] = sanitizePlay({ ...structuredClone(play), v: 1, agentId, userId }, agentId, userId)!;
      this.save(agentId, records);
      return result;
    });
  }

  async listForUser(userId: number): Promise<PetPlay[]> {
    assertUser(userId);
    return this.serial(() => this.agents().flatMap((agentId) => {
      const play = sanitizePlay(this.load(agentId)[userId], agentId, userId);
      return play ? [play] : [];
    }));
  }

  async eraseUser(userId: number): Promise<number> {
    assertUser(userId);
    return this.serial(() => {
      rotatePetFileEpoch(this.petsDir, userId);
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
          const play = sanitizePlay(records[id], agentId, Number(id));
          return !play || (play.seenAt < before && drop(agentId, play.userId));
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

/** Firestore rejects undefined values; play has optional fields. */
const stored = (play: PetPlay) => JSON.parse(JSON.stringify(play)) as PetPlay;
const BATCH = 400;

/**
 * `studio_pet_play/{agentId}_{userId}` = { agentId, userId, seenAt, play, updatedAt }, top-level fields for the
 * by-user, by-agent and by-last-visit queries, exactly like `studio_pets`. The epoch is pet care's own document.
 */
export class FirestorePetPlayStore implements PetPlayStore {
  constructor(private readonly db: Firestore, private readonly collection = PET_PLAY_COLLECTION, private readonly careCollection = PET_COLLECTION) {}

  private epochRef(userId: number) { return this.db.collection(petEpochCollection(this.careCollection)).doc(String(userId)); }
  private ref(agentId: string, userId: number) { return this.db.collection(this.collection).doc(`${agentId}_${userId}`); }

  async get(agentId: string, userId: number): Promise<PetPlay | null> {
    assertAgent(agentId); assertUser(userId);
    const snap = await this.ref(agentId, userId).get();
    return snap.exists ? sanitizePlay(snap.data()?.play, agentId, userId) : null;
  }

  async update<T>(agentId: string, userId: number, fn: (current: PetPlay | null) => { play: PetPlay | null; result: T }, expectedEpoch?: string): Promise<T> {
    assertAgent(agentId); assertUser(userId);
    const ref = this.ref(agentId, userId);
    return this.db.runTransaction(async (tx) => {
      const epoch = (await tx.get(this.epochRef(userId))).data()?.epoch ?? 'initial';
      if (expectedEpoch !== undefined && epoch !== expectedEpoch) throw new PetCareChangedError('Pet care changed');
      const snap = await tx.get(ref);
      const { play, result } = fn(snap.exists ? sanitizePlay(snap.data()?.play, agentId, userId) : null);
      if (!play) return result;
      const clean = sanitizePlay({ ...stored(play), v: 1, agentId, userId }, agentId, userId)!;
      tx.set(ref, { agentId, userId, seenAt: clean.seenAt, play: stored(clean), updatedAt: Date.now() });
      return result;
    });
  }

  async listForUser(userId: number): Promise<PetPlay[]> {
    assertUser(userId);
    const snap = await this.db.collection(this.collection).where('userId', '==', userId).get();
    return snap.docs.flatMap((doc) => {
      const data = doc.data();
      const play = typeof data.agentId === 'string' ? sanitizePlay(data.play, data.agentId, userId) : null;
      return play ? [play] : [];
    });
  }

  private async deleteDocs(refs: DocumentReference[]): Promise<number> {
    for (let i = 0; i < refs.length; i += BATCH) {
      const batch = this.db.batch();
      for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
      await batch.commit();
    }
    return refs.length;
  }

  private async deleteWhere(field: 'userId' | 'agentId', value: number | string): Promise<number> {
    const snap = await this.db.collection(this.collection).where(field, '==', value).get();
    return this.deleteDocs(snap.docs.map((doc) => doc.ref));
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

const created = new WeakMap<Studio, Promise<PetPlayStore>>();

/**
 * The Studio's play store: `deps.petPlay` when wired (runtime.ts, tests), else derived from the Studio store the same
 * way petStoreFor is (file storage → `<dataDir>/pets/play`, Firestore → the same project). Created once per Studio.
 * Runtime wires it explicitly: route bundles carry their own class copies, so the instanceof fallback is for tests.
 */
export function petPlayStoreFor(studio: Studio): Promise<PetPlayStore> {
  if (studio.deps.petPlay) return Promise.resolve(studio.deps.petPlay);
  let pending = created.get(studio);
  if (!pending) {
    pending = (async (): Promise<PetPlayStore> => {
      const store = studio.deps.store;
      if (store instanceof StudioStore) return new FilePetPlayStore(join(store.dir, 'pets'));
      if (store instanceof FirestoreStudioStore) {
        const { getAdminDb } = await import('@/lib/firebase-admin');
        return new FirestorePetPlayStore(await getAdminDb());
      }
      throw new Error('Pet play storage is unavailable');
    })();
    pending.catch(() => created.delete(studio));
    created.set(studio, pending);
  }
  return pending;
}

/* ---------- retention ---------- */

/** The same window as pet care (pet-store.ts PET_GUEST_RETENTION_MS). */
export const PET_PLAY_GUEST_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const SWEEP_RETRY_MS = 10 * 60 * 1000;
const sweptAt = new WeakMap<Studio, number>();

/**
 * Pet play maintenance, beside sweepPetCare and on the same rules: every fired agent's play is cleared, and a record
 * whose person cannot use the agent (a guest, someone removed) goes once nobody has opened it for 90 days (`seenAt`
 * moves on every open, see pet-http.ts). Members' records stay. Throttled per Studio; never throws.
 */
export async function sweepPetPlay(studio: Studio, force = false): Promise<{ fired: number; stale: number } | null> {
  const now = (studio.deps.now?.() ?? new Date()).getTime();
  const last = sweptAt.get(studio);
  if (!force && last !== undefined && now - last < SWEEP_EVERY_MS) return null;
  sweptAt.set(studio, now);
  try {
    const plays = await petPlayStoreFor(studio);
    const state = await studio.deps.store.read();
    let fired = 0;
    for (const agent of state.agents) if (agent.status === 'fired') fired += await plays.clearAgent(agent.id);
    const members = new Map(state.members.map((m) => [m.telegramId, m]));
    const agents = new Map(state.agents.map((a) => [a.id, a]));
    const stale = await plays.sweep(now - PET_PLAY_GUEST_RETENTION_MS, (agentId, userId) => {
      const agent = agents.get(agentId);
      return !agent || !canUseAgent(members.get(userId), agent) || (agent.blocked ?? []).includes(userId);
    });
    return { fired, stale };
  } catch {
    (studio.deps.logger ?? console).warn('[studio] pet_play_sweep_failed');
    sweptAt.set(studio, now - SWEEP_EVERY_MS + SWEEP_RETRY_MS);
    return null;
  }
}
