/** Separate account documents; never shares the administrator-readable Studio state. */
import { createHash, randomUUID } from 'crypto';
import { promises as fs, existsSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { RevisionCounter, revisionField, type RevisionProbe } from '../../tireh/privacy/revisions';
import type { DirectAuthorityEvaluator } from './authority';
import type { SpaceKind } from './repository';
import type { IndexedAdaptiveQueries } from './indexed/contracts';

export interface AdaptiveAccountPage { accountIds: string[]; next?: string }
export interface AdaptiveAccountPageInput { after?: string; limit: number }

export interface AdaptiveStorage {
  /** Only explicit prepared stores create/accept the v2 canonical cohort. */
  readonly canonicalSchemaVersion?: 1 | 2 | 3;
  /** Required only for the prepared FILE narrow authority layout. */
  readonly fileAuthorityProjectionVersion?: 1 | 2;
  /** Managed-format namespace, never an access grant. Original FILE has none. */
  readonly identity?: Readonly<{ incarnation: string; generation: number }>;
  /** Optional server-only read model. Presence never selects or migrates a store. */
  readonly indexed?: IndexedAdaptiveQueries;
  /** Managed FILE lifecycle observation, outside writers; durable monotonic metadata only. */
  observeLifecycleTime?(observedAt: number): void;
  /** Trusted server clock only, never a draft/deadline timestamp. Canonical
   * writers latch the sample; outside writers it is durable before return.
   * This clock observation is not an access grant or an effect deadline check. */
  sampleClock?(clock: () => number): number;
  /** Callback must be synchronous and retry safe. A throw commits nothing. */
  transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit?: () => void): Promise<T>;
  readonly supportsCommittedWriteFence?: true;
  /** Explicit narrow authority channel. Presence does not advertise indexed queries or body access. */
  readDirectAuthorityForEffect?<T>(accountId: string, space: SpaceKind, evaluate: DirectAuthorityEvaluator<T>):
    { status: 'ready'; value: T } | { status: 'busy' | 'unsupported' | 'missing' };
  /** File-only effect fence; synchronous committed snapshot, no writer in progress. */
  readCommittedForEffect?(accountId: string): { status: 'ready'; document: unknown | null } | { status: 'busy' };
  /** RF2 proof-only committed snapshot. No durable clock observation or writer
   * reservation; observedAt is checked against the committed clock floor. */
  readCommittedWithoutObservationForEffect?(accountId:string):{status:'ready';document:unknown|null;observedAt:number}|{status:'busy'};
  /** Server maintenance only. Opaque stable key cursor; never returns document payloads.
   * Concurrent inserts before a cursor are visited on the next full sweep. */
  listAccounts?(input: AdaptiveAccountPageInput): Promise<AdaptiveAccountPage>;
  /** In-process commit revision of one document, advanced by every commit
   * through `transact`. With readCommittedForEffect it lets a turn snapshot
   * read committed state through that existing seam and recheck it cheaply. */
  revisionProbe?(accountId: string): RevisionProbe;
  /** For stores without a synchronous committed read (Firestore, memory): the
   * committed document (or null) and a revision probe taken no later than the
   * read. Never locks, writes or rewrites. */
  load?(accountId: string): Promise<AdaptiveLoad>;
}
export interface AdaptiveLoad { value: unknown | null; probe: RevisionProbe }
/** A committed read refused because a writer holds the lock: run the ordinary transaction. */
export class CommittedReadBusy extends Error { readonly name = 'CommittedReadBusy'; }
/** Read-only committed load of one document for a turn read scope: the store's
 * own readCommittedForEffect with its commit-revision probe (file format), else
 * its async `load` (Firestore, memory). Undefined when it has neither. */
export function committedLoader(storage: AdaptiveStorage): ((accountId: string) => Promise<AdaptiveLoad>) | undefined {
  const read = storage.readCommittedForEffect?.bind(storage), revision = storage.revisionProbe?.bind(storage);
  if (read && revision) return async accountId => {
    // Probe before reading: a commit racing the read can only make it look stale.
    const probe = revision(accountId), snapshot = read(accountId);
    if (snapshot.status !== 'ready') throw new CommittedReadBusy();
    return { value: snapshot.document, probe };
  };
  return storage.load?.bind(storage);
}
export const MAX_ADAPTIVE_DOCUMENT_BYTES = 700_000;
const key = (id: string) => createHash('sha256').update(id).digest('hex');
function pageInput(input: AdaptiveAccountPageInput): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
      (input.after !== undefined && !/^[a-f0-9]{64}$/.test(input.after))) throw new Error('Invalid adaptive enumeration');
}
function accountFrom(raw: unknown, expectedKey: string): string | undefined {
  if (!raw || typeof raw !== 'object' || !('accountId' in raw)) return undefined;
  const id = raw.accountId;
  if (typeof id !== 'string' || !/^telegram-account:[1-9]\d{0,15}$/.test(id) ||
      !Number.isSafeInteger(Number(id.slice('telegram-account:'.length))) || key(id) !== expectedKey) throw new Error('Invalid adaptive account index');
  return id;
}
function encode(document: unknown): string {
  const json = JSON.stringify(document);
  if (Buffer.byteLength(json) > MAX_ADAPTIVE_DOCUMENT_BYTES) throw new Error('Adaptive account storage capacity reached');
  return json;
}

/** Cross-instance process locks, fsync and atomic rename. A crashed lock fails closed;
 * an operator must inspect/remove it after verifying no writer still owns it. */
export class FileAdaptiveStorage implements AdaptiveStorage {
  readonly supportsCommittedWriteFence = true as const;
  /** In-process revision bus: bumped after each atomic rename in this process. */
  readonly revisions = new RevisionCounter('file-adaptive');
  constructor(readonly directory: string) {}
  revisionProbe(accountId: string): RevisionProbe { return this.revisions.probe(accountId); }
  readCommittedForEffect(accountId: string): { status: 'ready'; document: unknown | null } | { status: 'busy' } {
    const file = join(this.directory, `${key(accountId)}.json`);
    if (existsSync(`${file}.lock`)) return { status: 'busy' };
    try { return { status: 'ready', document: JSON.parse(readFileSync(file, 'utf8')) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'ready', document: null }; throw error; }
  }
  async listAccounts(input: AdaptiveAccountPageInput): Promise<AdaptiveAccountPage> {
    pageInput(input);
    // Streaming directory scan bounds retained keys and payload reads to limit+1.
    // Filesystem enumeration is not an indexed database query.
    let directory;
    try { directory = await fs.opendir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { accountIds: [] }; throw error; }
    const keys: string[] = [];
    for await (const entry of directory) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      const id = entry.name.slice(0, -5);
      if (input.after && id <= input.after) continue;
      keys.push(id); keys.sort(); if (keys.length > input.limit + 1) keys.pop();
    }
    const chosen = keys.slice(0, input.limit), accountIds: string[] = [];
    for (const id of chosen) {
      const account = accountFrom(JSON.parse(await fs.readFile(join(this.directory, `${id}.json`), 'utf8')), id);
      if (account) accountIds.push(account);
    }
    return { accountIds, ...(keys.length > input.limit ? { next: chosen.at(-1)! } : {}) };
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit?: () => void): Promise<T> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${key(accountId)}.json`);
    const lock = `${file}.lock`;
    const deadline = Date.now() + 3000;
    while (true) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error('Adaptive storage is busy');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      let current: unknown | null;
      try { current = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        current = null;
      }
      const { document, result } = mutate(current);
      const json = encode(document);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
      if (beforeCommit) {
        // Supported single-process topology: external Studio authority and
        // deadlines cannot change between the last check and atomic commit.
        beforeCommit(); renameSync(temporary, file);
      } else await fs.rename(temporary, file);
      this.revisions.bump(accountId);
      const directory = await fs.open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return result === undefined ? result : structuredClone(result);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
      await fs.rmdir(lock);
    }
  }
}

export class FirestoreAdaptiveStorage implements AdaptiveStorage {
  constructor(private readonly db: Firestore, private readonly collection = 'adaptiveAccounts') {}
  async listAccounts(input: AdaptiveAccountPageInput): Promise<AdaptiveAccountPage> {
    pageInput(input);
    let query = this.db.collection(this.collection).orderBy(FieldPath.documentId()).select('json').limit(input.limit + 1);
    if (input.after) query = query.startAfter(input.after);
    const page = await query.get(), selected = page.docs.slice(0, input.limit), accountIds: string[] = [];
    for (const document of selected) {
      const raw = document.get('json');
      if (typeof raw !== 'string') throw new Error('Invalid adaptive document');
      const account = accountFrom(JSON.parse(raw), document.id);
      if (account) accountIds.push(account);
    }
    return { accountIds, ...(page.docs.length > input.limit ? { next: selected.at(-1)!.id } : {}) };
  }
  async load(accountId: string): Promise<AdaptiveLoad> {
    const ref = this.db.collection(this.collection).doc(key(accountId));
    const snap = await ref.get();
    const raw = snap.exists ? snap.get('json') : null;
    if (snap.exists && typeof raw !== 'string') throw new Error('Invalid adaptive document');
    return { value: raw === null ? null : JSON.parse(raw),
      probe: { key: `firestore:${ref.path}`, value: revisionField(snap.exists ? snap.get('rev') : 0), remote: { path: ref.path, field: 'rev' } } };
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }): Promise<T> {
    const ref = this.db.collection(this.collection).doc(key(accountId));
    const result = await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const raw = snap.exists ? snap.get('json') : null;
      // Existing malformed documents never become an empty account.
      if (snap.exists && typeof raw !== 'string') throw new Error('Invalid adaptive document');
      const { document, result } = mutate(raw === null ? null : JSON.parse(raw));
      // `rev` is a storage-level commit counter for revision rechecks; the
      // document's own revision is not bumped by every writer.
      tx.set(ref, { json: encode(document), rev: revisionField(snap.exists ? snap.get('rev') : 0) + 1, updatedAt: new Date() });
      return result;
    });
    return result === undefined ? result : structuredClone(result);
  }
}

/** Synthetic/local adapter with the same rollback and per-account serialization contract. */
export class MemoryAdaptiveStorage implements AdaptiveStorage {
  private readonly documents = new Map<string, unknown>();
  private readonly queues = new Map<string, Promise<void>>();
  readonly revisions = new RevisionCounter('memory-adaptive');
  async load(accountId: string): Promise<AdaptiveLoad> {
    const probe = this.revisions.probe(accountId);
    const document = this.documents.get(accountId);
    return { value: document === undefined ? null : structuredClone(document), probe };
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }): Promise<T> {
    const prior = this.queues.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(accountId, pending);
    await prior;
    try {
      const { document, result } = mutate(structuredClone(this.documents.get(accountId) ?? null));
      const json = encode(document);
      this.documents.set(accountId, JSON.parse(json));
      this.revisions.bump(accountId);
      return result === undefined ? result : structuredClone(result);
    } finally { release(); if (this.queues.get(accountId) === pending) this.queues.delete(accountId); }
  }
  async listAccounts(input: AdaptiveAccountPageInput): Promise<AdaptiveAccountPage> {
    pageInput(input);
    const rows = [...this.documents].map(([id, raw]) => ({ key: key(id), raw })).filter(row => !input.after || row.key > input.after)
      .sort((a, b) => a.key.localeCompare(b.key)).slice(0, input.limit + 1);
    return { accountIds: rows.slice(0, input.limit).flatMap(row => { const id = accountFrom(row.raw, row.key); return id ? [id] : []; }),
      ...(rows.length > input.limit ? { next: rows[input.limit - 1].key } : {}) };
  }
}
