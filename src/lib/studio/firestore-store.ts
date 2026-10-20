/**
 * Studio state for serverless production: one Firestore document updated in
 * transactions (safe across concurrent instances) and media in Cloud Storage.
 *
 *   studio/state            { json: "<StudioState>", revision, updatedAt }
 *
 * `revision` is a monotonic commit counter outside the JSON, so turn rechecks
 * can read it alone with a field mask.
 *   gs://<bucket>/studio/media/<file>
 */

import type { Firestore } from 'firebase-admin/firestore';
import { EMPTY_STATE, SAFE_FILE, type StudioStorage } from './store';
import type { AuditEntry, StudioState } from './types';
import { activeReadScope } from '../tireh/privacy/read-scope';
import { revisionField } from '../tireh/privacy/revisions';

/** Firestore documents max out at 1 MiB; the audit trail is trimmed to fit. */
const AUDIT_LIMIT = 500;

interface MediaBucket {
  file(path: string): {
    save(data: Buffer, options?: { contentType?: string; resumable?: boolean }): Promise<unknown>;
    download(): Promise<[Buffer]>;
    exists(): Promise<[boolean]>;
  };
}

const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp3: 'audio/mpeg' };

function parse(json: unknown): StudioState {
  if (typeof json !== 'string') return structuredClone(EMPTY_STATE);
  return { ...structuredClone(EMPTY_STATE), ...(JSON.parse(json) as StudioState) };
}

export class FirestoreStudioStore implements StudioStorage {
  constructor(
    private readonly db: Firestore,
    private readonly bucket: MediaBucket,
    private readonly docPath = 'studio/state'
  ) {}

  async read(): Promise<StudioState> {
    const scope = activeReadScope();
    if (scope) {
      const loaded = await scope.document(this, 'state', async () => {
        const snap = await this.db.doc(this.docPath).get();
        return { value: parse(snap.get('json')), probe: { key: `firestore:${this.docPath}`, value: revisionField(snap.get('revision')),
          remote: { path: this.docPath, field: 'revision' } } };
      });
      return structuredClone(loaded.value);
    }
    const snap = await this.db.doc(this.docPath).get();
    return parse(snap.get('json'));
  }

  async update<T>(fn: (state: StudioState) => T): Promise<T> {
    activeReadScope()?.noteWrite();
    const ref = this.db.doc(this.docPath);
    const result = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const draft = parse(snap.get('json'));
      const out = fn(draft);
      if (draft.audit.length > AUDIT_LIMIT) draft.audit.splice(0, draft.audit.length - AUDIT_LIMIT);
      tx.set(ref, { json: JSON.stringify(draft), revision: revisionField(snap.get('revision')) + 1, updatedAt: new Date() });
      return out;
    });
    return result === undefined ? result : structuredClone(result);
  }

  audit(entry: Omit<AuditEntry, 'at'>): Promise<void> {
    return this.update((s) => {
      s.audit.push({ ...entry, at: new Date().toISOString() });
    });
  }

  async saveMedia(name: string, data: Buffer): Promise<string> {
    if (!SAFE_FILE.test(name)) throw new Error('Unsafe media file name');
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    await this.bucket.file(`studio/media/${name}`).save(data, { contentType: CONTENT_TYPES[ext], resumable: false });
    return name;
  }

  async readMedia(name: string): Promise<Buffer | null> {
    if (!SAFE_FILE.test(name)) return null;
    const file = this.bucket.file(`studio/media/${name}`);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [data] = await file.download();
    return data;
  }
}
