import { qualifiedMemoryInterval } from '../memory-account-time';
import { fileRuntimeFs, fileRuntimePromises, assertFileRuntimePath, commitFileRuntimeRename, prepareFileRuntimeTransient, createFileRuntimeTransientDirectory } from '../../studio/file-runtime-owner';
const fs = fileRuntimePromises;
const { existsSync, readFileSync, constants, openSync, closeSync, fstatSync, lstatSync } = fileRuntimeFs;
/** Separate account documents; never shares the administrator-readable Studio state. */
import { createHash, randomUUID } from 'crypto';

import { assertAssistantDeliveryTransition, parseAssistantDeliveryControl } from '../assistant-delivery-control';
import type { AdaptiveDocument } from './repository';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { RevisionCounter, revisionField, type RevisionProbe } from '../../tireh/privacy/revisions';
import type { DirectAuthorityEvaluator } from './authority';
import type { SpaceKind } from './repository';
import type { IndexedAdaptiveQueries } from './indexed/contracts';
import { currentMemoryAccountWork, memoryAccountWorkDetails, parseMemoryLifecycle, isMemoryAccountErasing, assertMemoryAccountSource, assertMemoryAccountId, type MemoryAccountWork } from '../memory-account-lifecycle';
import { readMemoryAccountRoot, readMemoryAccountPrivateFile, memoryAccountFileDigest, checkMemoryAccountTime } from '../memory-account-lifecycle-file';
import { resolve } from 'path';

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
export function encodeAdaptiveStorageDocument(document: unknown): string {
  const json = JSON.stringify(document);
  if (Buffer.byteLength(json) > MAX_ADAPTIVE_DOCUMENT_BYTES) throw new Error('Adaptive account storage capacity reached');
  return json;
}
const encode = encodeAdaptiveStorageDocument;

/** Cross-instance process locks, fsync and atomic rename. A crashed lock fails closed;
 * an operator must inspect/remove it after verifying no writer still owns it. */
export class FileAdaptiveStorage implements AdaptiveStorage {
  readonly supportsCommittedWriteFence = true as const;
  private readonly assistantWriters = new WeakSet<object>();
  private readonly lifecycleWriters = new WeakMap<object, 'bootstrap' | 'migration'>();
  /** Revision bus also advances when a committed file changed in another writer. */
  readonly revisions = new RevisionCounter('file-adaptive');
  private readonly committedDigests = new Map<string, string>();
  constructor(readonly directory: string) { assertFileRuntimePath(directory); }
  static readonly assistantControlMarker = 'assistant-delivery-control-v1.json';
  static readonly assistantControlMarkerBytes = '{"version":1,"kind":"assistant-delivery-control"}\n';
  static readonly assistantControlV2Marker = 'assistant-delivery-control-v2.json';
  static readonly assistantControlV2MarkerBytes = '{"version":2,"kind":"assistant-delivery-control"}\n';
  assertAssistantDeliveryControlMarker(version:1|2=1): void {
    this.assertAssistantMarker(FileAdaptiveStorage.assistantControlMarker,FileAdaptiveStorage.assistantControlMarkerBytes);
    if(version===2||lstatSync(join(this.directory,FileAdaptiveStorage.assistantControlV2Marker),{throwIfNoEntry:false}))this.assertAssistantMarker(FileAdaptiveStorage.assistantControlV2Marker,FileAdaptiveStorage.assistantControlV2MarkerBytes);
  }
  private assertAssistantMarker(name:string,bytes:string):void {
    const directory=lstatSync(this.directory);
    if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('Assistant control format unavailable');
    const path=join(this.directory,name), before=lstatSync(path);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>128)throw new Error('Assistant control format unavailable');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.ino!==before.ino||stat.dev!==before.dev||stat.size>128||readFileSync(fd,'utf8')!==bytes)throw new Error('Assistant control format unavailable');}
    finally{closeSync(fd);}
  }
  async ensureAssistantDeliveryControlMarker(version:1|2=1): Promise<void> {
    await this.ensureAssistantMarker(FileAdaptiveStorage.assistantControlMarker,FileAdaptiveStorage.assistantControlMarkerBytes);
    if(version===2)await this.ensureAssistantMarker(FileAdaptiveStorage.assistantControlV2Marker,FileAdaptiveStorage.assistantControlV2MarkerBytes);
    this.assertAssistantDeliveryControlMarker(version);
  }
  private async ensureAssistantMarker(name:string,bytes:string):Promise<void>{
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});
    const directory=await fs.lstat(this.directory);if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('Assistant control format unavailable');
    let file;
    try {file=await fs.open(join(this.directory,name),'wx',0o600);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;this.assertAssistantMarker(name,bytes);}
    if(file){try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}
    else{const existing=await fs.open(join(this.directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{await existing.sync();}finally{await existing.close();}}
    const handle=await fs.open(this.directory,'r');try{await handle.sync();}finally{await handle.close();}
    this.assertAssistantMarker(name,bytes);
  }
  private committedRevision(accountId: string): number {
    const file = join(this.directory, `${key(accountId)}.json`);
    if (existsSync(`${file}.lock`)) throw new CommittedReadBusy();
    let digest: string;
    try { digest = createHash('sha256').update(readFileSync(file)).digest('hex'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; digest = 'missing'; }
    // A writer racing the synchronous read never vouches for a cached document.
    if (existsSync(`${file}.lock`)) throw new CommittedReadBusy();
    const previous = this.committedDigests.get(accountId);
    if (previous !== undefined && previous !== digest) this.revisions.bump(accountId);
    this.committedDigests.set(accountId, digest);
    return this.revisions.get(accountId);
  }
  revisionProbe(accountId: string): RevisionProbe {
    const value = this.committedRevision(accountId), probe = this.revisions.probe(accountId);
    return { key: probe.key, value, local: () => this.committedRevision(accountId) };
  }
  memoryAccountMarked(): boolean { return readMemoryAccountRoot(this.directory).marked; }
  /** Protective/capture read only; never returns a transaction draft or creates a file. */
  readMemoryAccountState(accountId: string): { status: 'ready'; document: unknown | null; digest?: string } | { status: 'busy' } {
    assertMemoryAccountId(accountId);
    const marked = this.memoryAccountMarked();
    const file = join(this.directory, `${key(accountId)}.json`);
    if (existsSync(`${file}.lock`)) return { status: 'busy' };
    let raw: string | null;
    if (marked) raw = readMemoryAccountPrivateFile(file, MAX_ADAPTIVE_DOCUMENT_BYTES);
    else { try { raw = readFileSync(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; raw = null; } }
    if (existsSync(`${file}.lock`)) return { status: 'busy' };
    return { status: 'ready', document: raw === null ? null : JSON.parse(raw), ...(raw === null ? {} : { digest: memoryAccountFileDigest(raw) }) };
  }
  assertMemoryAccountWork(accountId: string, document: unknown, work = currentMemoryAccountWork(), now?: number): void {
    if (!work) throw new Error('Original memory account work required');
    const captured = memoryAccountWorkDetails(work);
    if (captured.directory !== resolve(this.directory) || captured.accountId !== accountId || !document || typeof document !== 'object' || isMemoryAccountErasing(document) || !('memoryLifecycle' in document)) throw new Error('Memory account work refused');
    const lifecycle = parseMemoryLifecycle(document.memoryLifecycle, now ?? Number.MAX_SAFE_INTEGER);
    if (lifecycle.incarnation !== captured.incarnation) throw new Error('Memory account incarnation changed');
    if (now !== undefined) assertMemoryAccountSource(lifecycle, captured.sourceDateSeconds, now, qualifiedMemoryInterval(captured.clock, now).utcLowerMs);
  }
  readCommittedForEffect(accountId: string): { status: 'ready'; document: unknown | null } | { status: 'busy' } {
    if (this.memoryAccountMarked()) {
      const result = this.readMemoryAccountState(accountId);
      if (result.status === 'ready') {
        const work = currentMemoryAccountWork();
        if (!work) throw new Error('Original memory account work required');
        const now = checkMemoryAccountTime(this.directory, memoryAccountWorkDetails(work).clock);
        this.assertMemoryAccountWork(accountId, result.document, work, now);
      }
      return result;
    }
    if(lstatSync(join(this.directory,FileAdaptiveStorage.assistantControlMarker),{throwIfNoEntry:false})||lstatSync(join(this.directory,FileAdaptiveStorage.assistantControlV2Marker),{throwIfNoEntry:false}))this.assertAssistantDeliveryControlMarker();
    const file = join(this.directory, `${key(accountId)}.json`);
    if (existsSync(`${file}.lock`)) return { status: 'busy' };
    let raw:string;
    try { raw=readFileSync(file,'utf8'); }
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {status:'ready',document:null};throw error;}
    const document=JSON.parse(raw);
    if (document?.memoryLifecycle !== undefined || isMemoryAccountErasing(document)) throw new Error('Memory account format marker required');
    if(document?.assistantDeliveryControl!==undefined){try{this.assertAssistantDeliveryControlMarker(document.assistantDeliveryControl?.version===2?2:1);}catch{throw new Error('Assistant control format unavailable');}}
    if(existsSync(`${file}.lock`))return {status:'busy'};
    return {status:'ready',document};
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
  /** Internal ARC adapter mutation seam; ordinary canonical writers cannot mint effects. */
  async transactAssistantDeliveryControl<T>(accountId:string,mutate:(current:unknown|null)=>{document:unknown;result:T},beforeCommit?:()=>void):Promise<T>{
    this.assistantWriters.add(mutate);try{return await this.transact(accountId,mutate,beforeCommit);}finally{this.assistantWriters.delete(mutate);}
  }
  /** Dedicated privileged server seam; the repository supplies strict lifecycle policy. */
  async transactMemoryAccountLifecycle<T>(accountId: string, kind: 'bootstrap' | 'migration', mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit: () => void): Promise<T> {
    if (!this.memoryAccountMarked()) throw new Error('Memory account migration required');
    this.lifecycleWriters.set(mutate, kind);
    try { return await this.transact(accountId, mutate, beforeCommit); } finally { this.lifecycleWriters.delete(mutate); }
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit?: () => void): Promise<T> {
    const markedAtAdmission = this.memoryAccountMarked(), work: MemoryAccountWork | undefined = currentMemoryAccountWork(), lifecycleWriter = this.lifecycleWriters.get(mutate);
    if (markedAtAdmission && !lifecycleWriter) {
      if (!work) throw new Error('Original memory account work required');
      const captured = memoryAccountWorkDetails(work);
      if (captured.directory !== resolve(this.directory) || captured.accountId !== accountId) throw new Error('Memory account work refused');
    }
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${key(accountId)}.json`);
    const lock = `${file}.lock`;
    const deadline = Date.now() + 3000;
    while (true) {
      try { createFileRuntimeTransientDirectory(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error('Adaptive storage is busy');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      let current: unknown | null;
      let originalBytes: string | null = null;
      try { originalBytes = this.memoryAccountMarked() ? readMemoryAccountPrivateFile(file, MAX_ADAPTIVE_DOCUMENT_BYTES) : await fs.readFile(file, 'utf8'); current = originalBytes === null ? null : JSON.parse(originalBytes); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        current = null;
      }
      if (this.memoryAccountMarked()) {
        if (lifecycleWriter === 'bootstrap' ? current !== null : current === null) throw new Error('Memory account expected state changed');
        if (!lifecycleWriter) this.assertMemoryAccountWork(accountId, current, work);
        if (isMemoryAccountErasing(current)) throw new Error('Memory account is erasing');
      }
      const before=current===null?undefined:structuredClone(current) as AdaptiveDocument;
      assertFileRuntimePath(this.directory);
      const { document, result } = mutate(current);
      if (this.memoryAccountMarked()) {
        if (!document || typeof document !== 'object' || !('memoryLifecycle' in document)) throw new Error('Memory lifecycle required');
        const nextLifecycle = parseMemoryLifecycle(document.memoryLifecycle, Number.MAX_SAFE_INTEGER);
        if (!lifecycleWriter && JSON.stringify(parseMemoryLifecycle((before as AdaptiveDocument)?.memoryLifecycle, Number.MAX_SAFE_INTEGER)) !== JSON.stringify(nextLifecycle)) throw new Error('Memory lifecycle mutation refused');
      } else if ((before as AdaptiveDocument)?.memoryLifecycle !== undefined || (document as AdaptiveDocument)?.memoryLifecycle !== undefined || isMemoryAccountErasing(current) || isMemoryAccountErasing(document)) throw new Error('Memory account format marker required');
      if(before?.assistantDeliveryControl || (document as AdaptiveDocument)?.assistantDeliveryControl)this.assertAssistantDeliveryControlMarker((document as AdaptiveDocument)?.assistantDeliveryControl?.version===2||before?.assistantDeliveryControl?.version===2?2:1);
      if((document as AdaptiveDocument)?.assistantDeliveryControl!==undefined){const d=document as AdaptiveDocument;if(d.schemaVersion!==1)throw new Error('Assistant control format unavailable');parseAssistantDeliveryControl(d.assistantDeliveryControl,accountId,d.personId,d.updatedAt);}
      assertAssistantDeliveryTransition(before,document as AdaptiveDocument,this.assistantWriters.has(mutate));
      // Already qualified lifecycle rows are validated under the real account lock,
      // without rewriting payloads, changing optional omissions or assigning a new incarnation.
      if (lifecycleWriter === 'migration' && JSON.stringify(document) === JSON.stringify(current)) {
        if (readMemoryAccountPrivateFile(file, MAX_ADAPTIVE_DOCUMENT_BYTES) !== originalBytes) throw new Error('Memory account committed state changed');
        beforeCommit?.();
        return result === undefined ? result : structuredClone(result);
      }
      const json = encode(document);
      prepareFileRuntimeTransient(temporary);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
      // Owner I/O precedes the trusted authority/deadline fence; no I/O after its final clock.
      commitFileRuntimeRename(temporary, file, () => {
        if (this.memoryAccountMarked()) {
          if (!markedAtAdmission) throw new Error('Memory account admission changed');
          const actual = readMemoryAccountPrivateFile(file, MAX_ADAPTIVE_DOCUMENT_BYTES);
          if (actual !== originalBytes) throw new Error('Memory account committed state changed');
          if (!lifecycleWriter) {
            if (!work) throw new Error('Original memory account work required');
            const now = checkMemoryAccountTime(this.directory, memoryAccountWorkDetails(work).clock);
            this.assertMemoryAccountWork(accountId, actual === null ? null : JSON.parse(actual), work, now);
          }
        }
        return beforeCommit?.();
      });
      this.committedDigests.set(accountId, createHash('sha256').update(json).digest('hex'));
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
