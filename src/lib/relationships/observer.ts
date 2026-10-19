import { createHmac, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import type { RelationshipKey, RelationshipMode } from './types';
import { relationshipId } from './store';
export type ObservationType = 'turn' | 'duplicate' | 'assessment_failed' | 'planned' | 'decision' | 'sent' | 'deferred' | 'closed' | 'suppressed' | 'stale' | 'delivery_unknown' | 'control' | 'invalidated';
export interface Observation {
  id: string; at: string; schemaVersion: 1; feature: 'relationships'; mode: RelationshipMode;
  type: ObservationType; scope: 'private' | 'group'; scopeHash: string;
  action?: 'send' | 'defer' | 'close' | 'stay_quiet';
  policyVersion?: string; decisionModel?: string; revision?: string;
}
export const RELATIONSHIP_POLICY_VERSION = 'relationships-v1';
export const RELATIONSHIP_DECISION_MODEL = 'gpt-6-luna';
export interface ObservationStore { append(event: Observation): Promise<void>; recent(limit?: number): Promise<Observation[]> }
export interface RelationshipObserver { emit(key: RelationshipKey, mode: RelationshipMode, type: ObservationType, action?: Observation['action']): Promise<void> }
/** Build events from an allowlist. No caller text, IDs, exceptions or arbitrary details are copied. */
export class SafeRelationshipObserver implements RelationshipObserver {
  constructor(private readonly store: ObservationStore, private readonly secret: string, private readonly now: () => Date = () => new Date()) { if (secret.length < 32) throw new Error('Observer requires a pseudonym secret'); }
  async emit(key: RelationshipKey, mode: RelationshipMode, type: ObservationType, action?: Observation['action']): Promise<void> {
    const event: Observation = { id: randomUUID(), at: this.now().toISOString(), schemaVersion: 1, feature: 'relationships', mode, type, scope: key.audience.kind, scopeHash: createHmac('sha256', this.secret).update(relationshipId(key)).digest('hex') };
    event.policyVersion = RELATIONSHIP_POLICY_VERSION; event.decisionModel = RELATIONSHIP_DECISION_MODEL;
    const revision = process.env.STUDIO_REVISION ?? process.env.STUDIO_BUILD_REVISION ?? process.env.VOX_REVISION ?? '';
    if (/^[a-f0-9]{7,64}$/i.test(revision)) event.revision = revision.toLowerCase();
    if (action) event.action = action;
    await this.store.append(event);
  }
}
const MAX_EVENTS = 2000;
const RETENTION_MS = 30 * 86400_000;
export class InMemoryObservationStore implements ObservationStore {
  protected events: Observation[] = [];
  async append(event: Observation): Promise<void> { this.events = [...this.events, structuredClone(event)].filter((e) => Date.parse(e.at) >= Date.parse(event.at) - RETENTION_MS).slice(-MAX_EVENTS); }
  async recent(limit = 100): Promise<Observation[]> { return structuredClone(this.events.slice(-Math.max(1, Math.min(500, limit))).reverse()); }
}
export class FileObservationStore extends InMemoryObservationStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) { super(); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); if (existsSync(path)) this.events = (JSON.parse(readFileSync(path, 'utf8')) as Observation[]).slice(-MAX_EVENTS); }
  override append(event: Observation): Promise<void> {
    const run = async () => { const before = this.events; await super.append(event); try { writeFileSync(`${this.path}.tmp`, JSON.stringify(this.events), { mode: 0o600 }); renameSync(`${this.path}.tmp`, this.path); } catch (error) { this.events = before; throw error; } };
    const task = this.queue.then(run, run); this.queue = task.catch(() => undefined); return task;
  }
  override async recent(limit?: number): Promise<Observation[]> { await this.queue; return super.recent(limit); }
}
export class FirestoreObservationStore implements ObservationStore {
  constructor(private readonly db: Firestore, private readonly collection = 'vox_relationship_observations') {}
  async append(event: Observation): Promise<void> { await this.db.collection(this.collection).doc(event.id).set({ ...event, expiresAt: new Date(Date.parse(event.at) + RETENTION_MS) }); }
  async recent(limit = 100): Promise<Observation[]> {
    const snap = await this.db.collection(this.collection).where('at', '>=', new Date(Date.now() - RETENTION_MS).toISOString()).orderBy('at', 'desc').limit(Math.max(1, Math.min(500, limit))).get();
    return snap.docs.map((d) => { const e = d.data(); return { id: e.id, at: e.at, schemaVersion: 1, feature: 'relationships', mode: e.mode, type: e.type, scope: e.scope, scopeHash: e.scopeHash,
      ...(e.action ? { action: e.action } : {}), ...(e.policyVersion === RELATIONSHIP_POLICY_VERSION ? { policyVersion: e.policyVersion } : {}),
      ...(e.decisionModel === RELATIONSHIP_DECISION_MODEL ? { decisionModel: e.decisionModel } : {}),
      ...(typeof e.revision === 'string' && /^[a-f0-9]{7,64}$/i.test(e.revision) ? { revision: e.revision } : {}) } as Observation; });
  }
}
