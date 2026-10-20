import { createHash } from 'crypto';
import type { RelationshipKey, RelationshipState } from './types';
import { purgeTemporalEvidence } from './temporal';
import { relationshipScopeSchema } from '../adaptive/relationships/contracts';

export function relationshipId(key: RelationshipKey): string {
  const owner = key.audience.kind === 'private' ? key.audience.personId : key.audience.groupId;
  if (![key.personaId, key.chatKey, owner].every((x) => typeof x === 'string' && x.length > 0 && x.length <= 200)) throw new Error('Invalid relationship key');
  if (!['private', 'group'].includes(key.audience.kind)) throw new Error('Invalid relationship audience');
  const identity: unknown[] = [key.personaId, key.chatKey, key.audience.kind, owner];
  if (key.scope !== undefined) {
    // Parsing canonicalizes field order, so equivalent objects have one identity.
    const scope = relationshipScopeSchema.parse(key.scope);
    if (key.audience.kind === 'private' && owner !== scope.personId) throw new Error('Relationship scope does not own this private context');
    identity.push(scope);
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
export function emptyRelationship(key: RelationshipKey): RelationshipState {
  return { key: structuredClone(key), epoch: 0, revision: 0, disabled: false, timeZone: '', quietHours: { start: 22, end: 8 }, unansweredCount: 0, preferences: [], situations: [], intentions: [], eventIds: [], forgottenSourceIds: [] };
}
/** Mutators must be synchronous, deterministic and free of external side effects: Firestore retries them. */
export interface RelationshipStore {
  bumpEpoch(personaId: string): Promise<void>;
  read(key: RelationshipKey): Promise<RelationshipState>;
  /** Single-process committed snapshot; throws while any write is queued. */
  readCommittedForEffect?(key: RelationshipKey): RelationshipState;
  update<T>(key: RelationshipKey, fn: (state: RelationshipState) => T): Promise<T>;
  due(now: Date, limit: number): Promise<RelationshipKey[]>;
  keysForPersona(personaId: string): Promise<RelationshipKey[]>;
  keysForAccount(accountId: string): Promise<RelationshipKey[]>;
}
export function nextDue(state: RelationshipState): string | null {
  const times = state.intentions.flatMap((j) => j.status === 'pending' ? [j.dueAt] : j.status === 'evaluating' || j.status === 'sending' ? [j.leaseUntil ?? j.dueAt] : []);
  return times.sort()[0] ?? null;
}
export function bounded(state: RelationshipState): void {
  const id = relationshipId(state.key);
  if (state.intentions.some((j) => relationshipId(j.key) !== id)) throw new Error('Invalid intention relationship scope');
  state.eventIds = state.eventIds.slice(-256);
  state.forgottenSourceIds = state.forgottenSourceIds.slice(-256);
  state.preferences = state.preferences.slice(-24);
  state.situations = state.situations.slice(-24);
  state.feedback = (state.feedback ?? []).slice(-24);
  const active = state.intentions.filter((j) => ['pending', 'evaluating', 'sending'].includes(j.status));
  if (active.length > 24) throw new Error('Relationship queue is full');
  // Terminal records are delivery receipts, not a second private evidence archive.
  for (const job of state.intentions) if (!['pending', 'evaluating', 'sending'].includes(job.status)) {
    job.purpose = ''; job.topic = ''; job.sourceIds = [];
    purgeTemporalEvidence(job);
  }
  state.intentions = [...state.intentions.filter((j) => !['pending', 'evaluating', 'sending'].includes(j.status)).slice(-24), ...active];
  if (Buffer.byteLength(JSON.stringify(state)) > 200_000) throw new Error('Relationship state limit exceeded');
}
export function currentEpoch(state: RelationshipState, epoch: number): RelationshipState {
  if ((state.epoch ?? 0) === epoch) return state;
  const fresh = emptyRelationship(state.key);
  return { ...fresh, epoch, revision: state.revision + 1, disabled: state.disabled, pausedUntil: state.pausedUntil,
    timeZone: state.timeZone, quietHours: state.quietHours, unansweredCount: state.unansweredCount,
    lastOutreachAt: state.lastOutreachAt, lastTelegramMessageId: state.lastTelegramMessageId,
    eventIds: state.eventIds, forgottenSourceIds: state.forgottenSourceIds };
}
export class InMemoryRelationshipStore implements RelationshipStore {
  protected epochs = new Map<string, number>();
  protected states = new Map<string, RelationshipState>();
  protected queue: Promise<unknown> = Promise.resolve();
  private pendingWrites = 0;
  readCommittedForEffect(key: RelationshipKey): RelationshipState {
    if (this.pendingWrites !== 0) throw new Error('Relationship store busy');
    return structuredClone(currentEpoch(this.states.get(relationshipId(key)) ?? emptyRelationship(key), this.epochs.get(key.personaId) ?? 0));
  }
  protected async commit(states: Map<string, RelationshipState>): Promise<void> { this.states = states; }
  bumpEpoch(personaId: string): Promise<void> {
    const run = async () => { const previous = this.epochs; this.epochs = new Map(previous); this.epochs.set(personaId, (this.epochs.get(personaId) ?? 0) + 1);
      try { await this.commit(this.states); } catch (error) { this.epochs = previous; throw error; } };
    this.pendingWrites++;
    const task = this.queue.then(run, run).finally(() => { this.pendingWrites--; }); this.queue = task.catch(() => undefined); return task;
  }
  async read(key: RelationshipKey): Promise<RelationshipState> { await this.queue; return structuredClone(currentEpoch(this.states.get(relationshipId(key)) ?? emptyRelationship(key), this.epochs.get(key.personaId) ?? 0)); }
  update<T>(key: RelationshipKey, fn: (state: RelationshipState) => T): Promise<T> {
    const run = async () => {
      const id = relationshipId(key); const state = structuredClone(currentEpoch(this.states.get(id) ?? emptyRelationship(key), this.epochs.get(key.personaId) ?? 0));
      const result = fn(state); bounded(state);
      const next = new Map(this.states); next.set(id, state); await this.commit(next);
      return structuredClone(result);
    };
    this.pendingWrites++;
    const task = this.queue.then(run, run).finally(() => { this.pendingWrites--; }); this.queue = task.catch(() => undefined); return task;
  }
  async due(now: Date, limit: number): Promise<RelationshipKey[]> {
    await this.queue;
    return [...this.states.values()].filter((s) => { const due = nextDue(s); return due && due <= now.toISOString(); }).sort((a,b) => nextDue(a)!.localeCompare(nextDue(b)!)).slice(0, limit).map((s) => structuredClone(s.key));
  }
  async keysForPersona(personaId: string): Promise<RelationshipKey[]> { await this.queue; return [...this.states.values()].filter((s) => s.key.personaId === personaId).map((s) => structuredClone(s.key)); }
  async keysForAccount(accountId: string): Promise<RelationshipKey[]> { await this.queue; return [...this.states.values()].filter((s) => s.key.scope?.accountId === accountId).map((s) => structuredClone(s.key)); }
}
