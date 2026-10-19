import { createHash } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { bounded, currentEpoch, emptyRelationship, nextDue, relationshipId, type RelationshipStore } from './store';
import type { RelationshipKey, RelationshipState } from './types';

const DATA_RETENTION_MS = 90 * 86400_000;
/** Durable controls contain no conversational text and survive private-data TTL deletion. */
function controls(state: RelationshipState) {
  return {
    disabled: state.disabled, pausedUntil: state.pausedUntil, timeZone: state.timeZone,
    quietHours: state.quietHours, lastOutreachAt: state.lastOutreachAt, unansweredCount: state.unansweredCount,
    lastTelegramMessageId: state.lastTelegramMessageId,
  };
}
function expires(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value) return (value as { toMillis(): number }).toMillis();
  return Number.POSITIVE_INFINITY; // Existing records acquire TTL on their next mutation.
}
/** Data records expire independently of user controls; no growth of the Studio singleton document. */
export class FirestoreRelationshipStore implements RelationshipStore {
  constructor(private readonly db: Firestore, private readonly collection = 'vox_relationships', private readonly now: () => Date = () => new Date()) {}
  private epochRef(personaId: string) { return this.db.collection(`${this.collection}_epochs`).doc(createHash('sha256').update(personaId).digest('hex')); }
  private controlRef(key: RelationshipKey) { return this.db.collection(`${this.collection}_controls`).doc(relationshipId(key)); }
  async bumpEpoch(personaId: string): Promise<void> {
    const ref = this.epochRef(personaId);
    await this.db.runTransaction(async (tx) => { const snap = await tx.get(ref); tx.set(ref, { epoch: (snap.get('epoch') ?? 0) + 1 }); });
  }
  private restore(key: RelationshipKey, json: unknown, expiry: unknown, epoch: number, controlJson: unknown): RelationshipState {
    const state = typeof json === 'string' && expires(expiry) > this.now().getTime() ? JSON.parse(json) as RelationshipState : emptyRelationship(key);
    const current = currentEpoch(state, epoch);
    // Only the control projection is copied: unvalidated arbitrary document fields cannot become context.
    if (typeof controlJson === 'string') Object.assign(current, controls(JSON.parse(controlJson) as RelationshipState));
    return current;
  }
  async read(key: RelationshipKey): Promise<RelationshipState> {
    const ref = this.db.collection(this.collection).doc(relationshipId(key));
    return this.db.runTransaction(async (tx) => {
      const [snap, epoch, control] = await Promise.all([tx.get(ref), tx.get(this.epochRef(key.personaId)), tx.get(this.controlRef(key))]);
      return this.restore(key, snap.get('json'), snap.get('expiresAt'), epoch.get('epoch') ?? 0, control.get('json'));
    });
  }
  async update<T>(key: RelationshipKey, fn: (state: RelationshipState) => T): Promise<T> {
    const ref = this.db.collection(this.collection).doc(relationshipId(key));
    const controlRef = this.controlRef(key);
    return this.db.runTransaction(async (tx) => {
      const [snap, epoch, control] = await Promise.all([tx.get(ref), tx.get(this.epochRef(key.personaId)), tx.get(controlRef)]);
      const state = this.restore(key, snap.get('json'), snap.get('expiresAt'), epoch.get('epoch') ?? 0, control.get('json'));
      const result = fn(state); bounded(state);
      tx.set(ref, { personaId: key.personaId, nextDueAt: nextDue(state), json: JSON.stringify(state), expiresAt: new Date(this.now().getTime() + DATA_RETENTION_MS) });
      tx.set(controlRef, { json: JSON.stringify(controls(state)) });
      return result;
    });
  }
  async due(now: Date, limit: number): Promise<RelationshipKey[]> {
    const snap = await this.db.collection(this.collection).where('nextDueAt', '>', '').where('nextDueAt', '<=', now.toISOString()).orderBy('nextDueAt').limit(limit).get();
    // Include expired record keys: the claimant's transaction clears expired data
    // and its due index. Filtering them here could starve newer work until TTL runs.
    return snap.docs.map((doc) => (JSON.parse(doc.get('json')) as RelationshipState).key);
  }
  async keysForPersona(personaId: string): Promise<RelationshipKey[]> {
    const snap = await this.db.collection(this.collection).where('personaId', '==', personaId).get();
    return snap.docs.map((doc) => (JSON.parse(doc.get('json')) as RelationshipState).key);
  }
}
