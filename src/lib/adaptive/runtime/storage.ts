import { MAX_ADAPTIVE_DOCUMENT_BYTES, type AdaptiveStorage } from '../persistence/storage';
/** Synthetic/local test store. Callback stays synchronous so clone/validate/commit
 * is atomic within this JavaScript process. File/Firestore are the durable stores. */
export class MemoryAdaptiveStorage implements AdaptiveStorage {
  private readonly documents = new Map<string, unknown>();
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }): Promise<T> {
    const value = this.documents.get(accountId);
    const { document, result } = mutate(value === undefined ? null : structuredClone(value));
    const json = JSON.stringify(document);
    if (Buffer.byteLength(json) > MAX_ADAPTIVE_DOCUMENT_BYTES) throw new Error('Adaptive account storage capacity reached');
    this.documents.set(accountId, JSON.parse(json));
    return result === undefined ? result : structuredClone(result);
  }
}
