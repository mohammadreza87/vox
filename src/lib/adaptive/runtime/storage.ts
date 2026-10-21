import { MAX_ADAPTIVE_DOCUMENT_BYTES, type AdaptiveLoad, type AdaptiveStorage } from '../persistence/storage';
import { RevisionCounter } from '../../tireh/privacy/revisions';
/** Synthetic/local test store. Callback stays synchronous so clone/validate/commit
 * is atomic within this JavaScript process. File/Firestore are the durable stores. */
export class MemoryAdaptiveStorage implements AdaptiveStorage {
  private readonly documents = new Map<string, unknown>();
  readonly revisions = new RevisionCounter('memory-adaptive');
  /** Synthetic equivalent of the FILE synchronous effect fence; transactions commit without awaits. */
  readCommittedForEffect(accountId: string): { status: 'ready'; document: unknown | null } {
    const document = this.documents.get(accountId);
    return { status: 'ready', document: document === undefined ? null : structuredClone(document) };
  }
  async load(accountId: string): Promise<AdaptiveLoad> {
    const probe = this.revisions.probe(accountId);
    const value = this.documents.get(accountId);
    return { value: value === undefined ? null : structuredClone(value), probe };
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }): Promise<T> {
    const value = this.documents.get(accountId);
    const { document, result } = mutate(value === undefined ? null : structuredClone(value));
    const json = JSON.stringify(document);
    if (Buffer.byteLength(json) > MAX_ADAPTIVE_DOCUMENT_BYTES) throw new Error('Adaptive account storage capacity reached');
    this.documents.set(accountId, JSON.parse(json));
    this.revisions.bump(accountId);
    return result === undefined ? result : structuredClone(result);
  }
}
