/**
 * Agent-wide lit growth moments (design PET_CARE_GAME_DESIGN_2026_10_26 §4.11): one record per agent, never per person.
 * Each entry is a moment id, its kind and dates, plus for a taught moment an opaque keyed hash of its source note copy
 * (growth.ts noteRef): never who lit it, never what was said. Same storage profiles as pet-play-store.ts:
 *  - FilePetGrowthStore: `<dataDir>/pets/growth/<agentId>.json`, under the pet directory's writer lock
 *  - FirestorePetGrowthStore: `studio_pet_growth/{agentId}`, read-modify-write in a transaction
 *
 * Agent fire/retire clears it (service.ts fire cleanup and sweepPetGrowth). A person's forget changes nothing here except
 * that the taught moments their erased notes lit are dimmed (circle-notes.ts calls dimGrowthForNotes); a privately
 * taught moment (in the teacher's own `PetPlay.litMine`) is removed from their play record the same way.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { dimMoments, lightMoment, sanitizeLit, type GrowthKind, type GrowthLit } from '../pet/growth';
import { FirestoreStudioStore } from './firestore-store';
import { noteRef } from './growth';
import { petFileSerial } from './pet-store';
import { petPlayStoreFor } from './pet-play-store';
import { receiptOwner } from '../circles/codec';
import { StudioStore } from './store';
import type { Studio } from './service';

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const PET_GROWTH_COLLECTION = 'studio_pet_growth';

export interface PetGrowthStore {
  get(agentId: string): Promise<GrowthLit[]>;
  /** Atomic read-modify-write of one agent's lit list; `lit: null` writes nothing. `fn` may run more than once. */
  update<T>(agentId: string, fn: (current: GrowthLit[]) => { lit: GrowthLit[] | null; result: T }): Promise<T>;
  /** Agent fire/retire. Returns how many lit moments went. */
  clearAgent(agentId: string): Promise<number>;
}

function assertAgent(agentId: string) {
  if (!AGENT_ID.test(agentId)) throw new Error('Invalid agent id');
}

export class FilePetGrowthStore implements PetGrowthStore {
  constructor(readonly petsDir: string) {}

  private get dir() { return join(this.petsDir, 'growth'); }
  private file(agentId: string) { return join(this.dir, `${agentId}.json`); }
  private load(agentId: string): GrowthLit[] {
    const file = this.file(agentId);
    if (!existsSync(file)) return [];
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return sanitizeLit((parsed as { lit?: unknown } | null)?.lit);
  }
  private save(agentId: string, lit: GrowthLit[]) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(agentId);
    if (!lit.length) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify({ agentId, lit }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  private serial<T>(run: () => T): Promise<T> { return petFileSerial(this.petsDir, run); }

  async get(agentId: string): Promise<GrowthLit[]> {
    assertAgent(agentId);
    return this.serial(() => this.load(agentId));
  }

  async update<T>(agentId: string, fn: (current: GrowthLit[]) => { lit: GrowthLit[] | null; result: T }): Promise<T> {
    assertAgent(agentId);
    return this.serial(() => {
      const { lit, result } = fn(this.load(agentId));
      if (lit) this.save(agentId, sanitizeLit(lit));
      return result;
    });
  }

  async clearAgent(agentId: string): Promise<number> {
    assertAgent(agentId);
    return this.serial(() => {
      const count = this.load(agentId).length;
      rmSync(this.file(agentId), { force: true });
      return count;
    });
  }
}

/** Firestore rejects undefined values. */
const stored = (lit: GrowthLit[]) => JSON.parse(JSON.stringify(lit)) as GrowthLit[];

export class FirestorePetGrowthStore implements PetGrowthStore {
  constructor(private readonly db: Firestore, private readonly collection = PET_GROWTH_COLLECTION) {}
  private ref(agentId: string) { return this.db.collection(this.collection).doc(agentId); }

  async get(agentId: string): Promise<GrowthLit[]> {
    assertAgent(agentId);
    const snap = await this.ref(agentId).get();
    return snap.exists ? sanitizeLit(snap.data()?.lit) : [];
  }

  async update<T>(agentId: string, fn: (current: GrowthLit[]) => { lit: GrowthLit[] | null; result: T }): Promise<T> {
    assertAgent(agentId);
    const ref = this.ref(agentId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const { lit, result } = fn(snap.exists ? sanitizeLit(snap.data()?.lit) : []);
      if (!lit) return result;
      const clean = sanitizeLit(lit);
      if (clean.length) tx.set(ref, { agentId, lit: stored(clean), updatedAt: Date.now() });
      else tx.delete(ref);
      return result;
    });
  }

  async clearAgent(agentId: string): Promise<number> {
    assertAgent(agentId);
    const ref = this.ref(agentId);
    const snap = await ref.get();
    if (!snap.exists) return 0;
    await ref.delete();
    return sanitizeLit(snap.data()?.lit).length;
  }
}

/* ---------- wiring ---------- */

const created = new WeakMap<Studio, Promise<PetGrowthStore>>();

/**
 * The Studio's growth store: `deps.petGrowth` when wired (runtime.ts, tests), else derived from the Studio store like
 * petPlayStoreFor. Runtime wires it explicitly: route bundles carry their own class copies (the instanceof fallback is for tests).
 */
export function petGrowthStoreFor(studio: Studio): Promise<PetGrowthStore> {
  if (studio.deps.petGrowth) return Promise.resolve(studio.deps.petGrowth);
  let pending = created.get(studio);
  if (!pending) {
    pending = (async (): Promise<PetGrowthStore> => {
      const store = studio.deps.store;
      if (store instanceof StudioStore) return new FilePetGrowthStore(join(store.dir, 'pets'));
      if (store instanceof FirestoreStudioStore) {
        const { getAdminDb } = await import('@/lib/firebase-admin');
        return new FirestorePetGrowthStore(await getAdminDb());
      }
      throw new Error('Pet growth storage is unavailable');
    })();
    pending.catch(() => created.delete(studio));
    created.set(studio, pending);
  }
  return pending;
}

/** Lights one agent-wide moment (idempotent). True when it was dark and is lit now. */
export async function lightAgentMoment(studio: Studio, agentId: string, entry: { id: string; kind: GrowthKind; at: number; ref?: string }): Promise<boolean> {
  const store = await petGrowthStoreFor(studio);
  return store.update(agentId, (current) => {
    const r = lightMoment(current, entry);
    return { lit: r.changed ? r.lit : null, result: r.changed };
  });
}

/**
 * The erasure hook (§4.11 "Erasure", PRIV-033): note copies were erased, so every agent-wide taught moment they lit
 * dims. Called by circle-notes.ts wherever a copy is erased. Never throws: a failed dim is logged, content-free.
 */
export async function dimGrowthForNotes(studio: Studio, copies: ReadonlyArray<{ copyId: string; agentIds: readonly string[] }>): Promise<number> {
  if (!copies.length) return 0;
  try {
    const store = await petGrowthStoreFor(studio);
    const at = (studio.deps.now?.() ?? new Date()).getTime();
    const byAgent = new Map<string, Set<string>>();
    for (const c of copies) for (const agentId of c.agentIds) {
      if (!AGENT_ID.test(agentId)) continue;
      if (!byAgent.has(agentId)) byAgent.set(agentId, new Set());
      byAgent.get(agentId)!.add(noteRef(studio.deps.secret, c.copyId));
    }
    let dimmed = 0;
    for (const [agentId, refs] of byAgent) {
      dimmed += await store.update(agentId, (current) => {
        const r = dimMoments(current, refs, at);
        return { lit: r.dimmed ? r.lit : null, result: r.dimmed };
      });
    }
    // A privately taught moment lives in its teacher's own play record (litMine): the copy id names that owner.
    const plays = await petPlayStoreFor(studio);
    for (const c of copies) {
      const owner = receiptOwner(c.copyId);
      if (!owner) continue;
      const ref = noteRef(studio.deps.secret, c.copyId);
      for (const agentId of c.agentIds) {
        if (!AGENT_ID.test(agentId)) continue;
        dimmed += await plays.update(agentId, owner, (play) => {
          const kept = play?.litMine.filter((l) => l.ref !== ref) ?? [];
          return !play || kept.length === play.litMine.length ? { play: null, result: 0 } : { play: { ...play, litMine: kept }, result: play.litMine.length - kept.length };
        });
      }
    }
    return dimmed;
  } catch {
    (studio.deps.logger ?? console).warn('[studio] pet_growth_dim_failed');
    return 0;
  }
}

const sweptAt = new WeakMap<Studio, number>();
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

/** Clears every fired agent's lit moments; throttled per Studio like sweepPetPlay; never throws. */
export async function sweepPetGrowth(studio: Studio, force = false): Promise<number | null> {
  const now = (studio.deps.now?.() ?? new Date()).getTime();
  const last = sweptAt.get(studio);
  if (!force && last !== undefined && now - last < SWEEP_EVERY_MS) return null;
  sweptAt.set(studio, now);
  try {
    const store = await petGrowthStoreFor(studio);
    let fired = 0;
    for (const agent of (await studio.deps.store.read()).agents) if (agent.status === 'fired') fired += await store.clearAgent(agent.id);
    return fired;
  } catch {
    (studio.deps.logger ?? console).warn('[studio] pet_growth_sweep_failed');
    return null;
  }
}
