import { createHash } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { connectionSchema, recordSchemas, type ConnectionsRecords, type RecordCollection } from './contracts';

export const CONNECTION_COLLECTIONS = Object.keys(recordSchemas) as RecordCollection[];
export type RawConnectionsRecords = Record<RecordCollection, unknown[]>;
export const emptyRecords = (): RawConnectionsRecords => ({ providerAccounts: [], connections: [], grants: [], sources: [], operations: [], approvals: [], payloads: [], outbox: [], tombstones: [], attempts: [], audits: [], subscriptions: [], eventInbox: [], workflows: [], occurrences: [] });
export interface ConnectionsStorage {
  /** Retry-safe synchronous callback, atomic commit, no provider/network I/O in callback. */
  transact<T>(partitionId: string, mutate: (records: RawConnectionsRecords) => { records: ConnectionsRecords; result: T }): Promise<T>;
  /** Read-only snapshot of one partition (rights export): no lock, no write, nothing created. Empty when it never existed. */
  peek?(partitionId: string): Promise<RawConnectionsRecords>;
  /** Manager counts: distinct people with a live connection to this agent, per provider, never counting `excludeAccountId` (the viewer). Counts only, never who. */
  countLivePeopleByAgent?(agentId: string, excludeAccountId?: string): Promise<Record<string, number>>;
}
/** Distinct owner accounts per provider among schema-2, connected rows bound to `agentId` (Work and Personal count once), without `excludeAccountId`. */
export function countLivePeople(rows: Iterable<unknown>, agentId: string, excludeAccountId?: string): Record<string, number> {
  const people = new Map<string, Set<string>>();
  for (const row of rows) {
    const parsed = connectionSchema.safeParse(row);
    if (!parsed.success) continue;
    const connection = parsed.data;
    if (connection.schemaVersion !== 2 || connection.agentId !== agentId || connection.lifecycle !== 'connected' || connection.ownerAccountId === excludeAccountId) continue;
    let set = people.get(connection.providerId);
    if (!set) people.set(connection.providerId, set = new Set());
    set.add(connection.ownerAccountId);
  }
  return Object.fromEntries([...people].map(([providerId, owners]) => [providerId, owners.size]));
}
const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);
/** Transactional synthetic fixture. Serialized across all instances sharing this storage. */
export class InMemoryConnectionsStorage implements ConnectionsStorage {
  private readonly partitions = new Map<string, RawConnectionsRecords>();
  private tail: Promise<void> = Promise.resolve();
  async transact<T>(partitionId: string, mutate: (records: RawConnectionsRecords) => { records: ConnectionsRecords; result: T }): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const next = mutate(clone(this.partitions.get(partitionId) ?? emptyRecords()));
      this.partitions.set(partitionId, clone(next.records));
      return clone(next.result);
    } finally { release(); }
  }
  async peek(partitionId: string): Promise<RawConnectionsRecords> { return clone(this.partitions.get(partitionId) ?? emptyRecords()); }
  async countLivePeopleByAgent(agentId: string, excludeAccountId?: string): Promise<Record<string, number>> {
    return countLivePeople([...this.partitions.values()].flatMap(records => records.connections), agentId, excludeAccountId);
  }
}
const key = (value: string) => createHash('sha256').update(value).digest('hex');
/** Normalized, server-only Firestore documents. Does not initialize Firebase or read secrets.
 * The fence document prevents concurrent partition scans from creating duplicate intents.
 * Deployment must deny client SDK access to all connections_* collections. */
export class FirestoreConnectionsStorage implements ConnectionsStorage {
  constructor(private readonly db: Firestore, private readonly prefix = 'connections') {}
  async transact<T>(partitionId: string, mutate: (records: RawConnectionsRecords) => { records: ConnectionsRecords; result: T }): Promise<T> {
    const result = await this.db.runTransaction(async tx => {
      const fence = this.db.collection(`${this.prefix}_fences`).doc(key(partitionId));
      const fenceSnapshot = await tx.get(fence);
      const current = emptyRecords();
      const snapshots = await Promise.all(CONNECTION_COLLECTIONS.map(collection =>
        tx.get(this.db.collection(`${this.prefix}_${collection}`).where('partitionId', '==', partitionId).limit(2001))));
      const existing = new Map<string, { collection: RecordCollection; id: string; json: string }>();
      for (let i = 0; i < CONNECTION_COLLECTIONS.length; i++) {
        const collection = CONNECTION_COLLECTIONS[i];
        if (snapshots[i].size > 2000) throw new Error('Connections partition capacity reached');
        for (const doc of snapshots[i].docs) {
          const data: unknown = doc.data();
          current[collection].push(data);
          existing.set(`${collection}:${doc.id}`, { collection, id: doc.id, json: JSON.stringify(data) });
        }
      }
      const next = mutate(current);
      let writes = 0;
      for (const collection of CONNECTION_COLLECTIONS) for (const record of next.records[collection]) {
        const docId = key(`${partitionId}:${record.id}`);
        const previous = existing.get(`${collection}:${docId}`);
        const json = JSON.stringify(record);
        if (Buffer.byteLength(json) > 300_000) throw new Error('Connections record capacity reached');
        if (previous?.json !== json) { tx.set(this.db.collection(`${this.prefix}_${collection}`).doc(docId), record); writes++; }
        existing.delete(`${collection}:${docId}`);
      }
      for (const old of existing.values()) { tx.delete(this.db.collection(`${this.prefix}_${old.collection}`).doc(old.id)); writes++; }
      // Keep below Firestore's 500-write transaction limit, including the fence.
      if (writes > 450) throw new Error('Connections transaction capacity reached');
      if (writes > 0) {
        const currentRevision: unknown = fenceSnapshot.exists ? fenceSnapshot.get('revision') : 0;
        if (!Number.isSafeInteger(currentRevision) || (currentRevision as number) < 0) throw new Error('Invalid Connections fence');
        tx.set(fence, { revision: (currentRevision as number) + 1, partitionId });
      }
      return next.result;
    });
    return clone(result);
  }
  async peek(partitionId: string): Promise<RawConnectionsRecords> {
    const current = emptyRecords();
    const snapshots = await Promise.all(CONNECTION_COLLECTIONS.map(collection =>
      this.db.collection(`${this.prefix}_${collection}`).where('partitionId', '==', partitionId).limit(2001).get()));
    for (let i = 0; i < CONNECTION_COLLECTIONS.length; i++) for (const doc of snapshots[i].docs) current[CONNECTION_COLLECTIONS[i]].push(doc.data());
    return current;
  }
  /** One single-field query (agentId); bounded. Needs no composite index. */
  async countLivePeopleByAgent(agentId: string, excludeAccountId?: string): Promise<Record<string, number>> {
    const snapshot = await this.db.collection(`${this.prefix}_connections`).where('agentId', '==', agentId).limit(5000).get();
    return countLivePeople(snapshot.docs.map(doc => doc.data()), agentId, excludeAccountId);
  }
}

/**
 * Collections a release added after file storage first shipped. Every generation any release wrote holds a directory for
 * each other collection (tombstones and grants among them), so a missing one there is damage and fails closed. A release
 * that adds a collection lists it here, so partitions written before it read as having none.
 */
export const COLLECTIONS_ADDED_LATER: readonly RecordCollection[] = [];
/** A collection directory's record files, or null when the generation predates that (later) collection.
 * Throws ENOENT when the generation directory or an always-written collection is missing, so nothing lost reads as empty. */
export async function collectionFiles(generationDirectory: string, collection: RecordCollection, addedLater: readonly RecordCollection[] = COLLECTIONS_ADDED_LATER): Promise<string[] | null> {
  const { promises: fs } = await import('fs');
  const { join } = await import('path');
  try { return await fs.readdir(join(generationDirectory, collection)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !addedLater.includes(collection)) throw error;
    if (!(await fs.stat(generationDirectory)).isDirectory()) throw new Error('Invalid Connections generation');
    return null;
  }
}
const sameGeneration = (raw: unknown, generation: string) => !!raw && typeof raw === 'object' && 'generation' in raw && raw.generation === generation;
/** Local polling deployments: normalized per-record files with an atomic generation pointer.
 * A crashed lock fails closed until an operator confirms no writer and removes the lock.
 * The pointer switches only after all new records are fsynced; old generations are purged.
 * File permissions are a local boundary, not a substitute for isolated broker identity. */
export class FileConnectionsStorage implements ConnectionsStorage {
  constructor(readonly directory: string) {}
  async transact<T>(partitionId: string, mutate: (records: RawConnectionsRecords) => { records: ConnectionsRecords; result: T }): Promise<T> {
    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    const { randomUUID } = await import('crypto');
    const root = join(this.directory, key(partitionId));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const lock = join(root, 'lock');
    const deadline = Date.now() + 3000;
    while (true) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error('Connections storage is busy');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const generation = `generation-${randomUUID()}`;
    const nextDirectory = join(root, generation);
    const pointerFile = join(root, 'current.json');
    const temporaryPointer = join(root, `${generation}.pointer`);
    let committed = false;
    try {
      const current = emptyRecords();
      let previousGeneration: string | undefined;
      try {
        const raw: unknown = JSON.parse(await fs.readFile(pointerFile, 'utf8'));
        if (!raw || typeof raw !== 'object' || !('generation' in raw) || typeof raw.generation !== 'string' ||
            !/^generation-[0-9a-f-]{36}$/.test(raw.generation)) throw new Error('Invalid Connections generation');
        previousGeneration = raw.generation;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      // Recover abandoned generations left by a crash around pointer replacement. The
      // current pointer remains authoritative; never resurrect an orphan record.
      for (const entry of await fs.readdir(root)) if (/^generation-[0-9a-f-]{36}$/.test(entry) && entry !== previousGeneration)
        await fs.rm(join(root, entry), { recursive: true, force: true });
      if (previousGeneration) for (const collection of CONNECTION_COLLECTIONS) {
        // A collection added after this generation was written reads as empty; anything else missing still throws.
        const files = await collectionFiles(join(root, previousGeneration), collection) ?? [];
        if (files.length > 2000) throw new Error('Connections partition capacity reached');
        for (const file of files) {
          if (!/^[0-9a-f]{64}\.json$/.test(file)) throw new Error('Invalid Connections record file');
          const filePath = join(root, previousGeneration, collection, file);
          if ((await fs.stat(filePath)).size > 300_000) throw new Error('Connections record capacity reached');
          const json = await fs.readFile(filePath, 'utf8');
          if (Buffer.byteLength(json) > 300_000) throw new Error('Connections record capacity reached');
          current[collection].push(JSON.parse(json));
        }
      }
      const before = JSON.stringify(current);
      const next = mutate(current);
      if (before === JSON.stringify(next.records)) return clone(next.result);
      await fs.mkdir(nextDirectory, { mode: 0o700 });
      let totalBytes = 0;
      for (const collection of CONNECTION_COLLECTIONS) {
        const collectionDirectory = join(nextDirectory, collection);
        await fs.mkdir(collectionDirectory, { mode: 0o700 });
        if (next.records[collection].length > 2000) throw new Error('Connections partition capacity reached');
        for (const record of next.records[collection]) {
          const json = JSON.stringify(record);
          const bytes = Buffer.byteLength(json); totalBytes += bytes;
          if (bytes > 300_000 || totalBytes > 20_000_000) throw new Error('Connections storage capacity reached');
          const handle = await fs.open(join(collectionDirectory, `${key(record.id)}.json`), 'wx', 0o600);
          try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
        }
        const handle = await fs.open(collectionDirectory, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      }
      const generationHandle = await fs.open(nextDirectory, 'r');
      try { await generationHandle.sync(); } finally { await generationHandle.close(); }
      const pointer = await fs.open(temporaryPointer, 'wx', 0o600);
      try { await pointer.writeFile(JSON.stringify({ generation })); await pointer.sync(); } finally { await pointer.close(); }
      await fs.rename(temporaryPointer, pointerFile); committed = true;
      const directoryHandle = await fs.open(root, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      // Never retain historical payload copies as an incidental backup.
      if (previousGeneration) await fs.rm(join(root, previousGeneration), { recursive: true, force: true });
      return clone(next.result);
    } finally {
      await fs.unlink(temporaryPointer).catch(() => undefined);
      if (!committed) await fs.rm(nextDirectory, { recursive: true, force: true });
      await fs.rmdir(lock);
    }
  }
  /** Lock-free read of one partition's current generation; retried when a writer swaps the generation mid-read. */
  private async readCurrent(root: string, collections: readonly RecordCollection[]): Promise<RawConnectionsRecords> {
    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    for (let attempt = 0; ; attempt++) {
      const current = emptyRecords();
      try {
        let raw: unknown;
        try { raw = JSON.parse(await fs.readFile(join(root, 'current.json'), 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return current; throw error; }
        if (!raw || typeof raw !== 'object' || !('generation' in raw) || typeof raw.generation !== 'string' ||
            !/^generation-[0-9a-f-]{36}$/.test(raw.generation)) throw new Error('Invalid Connections generation');
        let absent = false;
        for (const collection of collections) {
          // A collection added after this generation was written reads as empty (checked against a stable pointer below).
          const files = await collectionFiles(join(root, raw.generation), collection);
          if (!files) { absent = true; continue; }
          if (files.length > 2000) throw new Error('Connections partition capacity reached');
          for (const file of files) {
            if (!/^[0-9a-f]{64}\.json$/.test(file)) throw new Error('Invalid Connections record file');
            const json = await fs.readFile(join(root, raw.generation, collection, file), 'utf8');
            if (Buffer.byteLength(json) > 300_000) throw new Error('Connections record capacity reached');
            current[collection].push(JSON.parse(json));
          }
        }
        // A writer removes an old generation only after moving the pointer, so an unchanged pointer means the
        // directory was simply never created, not caught mid-removal. Otherwise retry like any generation swap.
        if (absent && !sameGeneration(JSON.parse(await fs.readFile(join(root, 'current.json'), 'utf8')), raw.generation))
          throw Object.assign(new Error('Connections generation changed'), { code: 'ENOENT' });
        return current;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || attempt >= 2) throw error;
      }
    }
  }
  async peek(partitionId: string): Promise<RawConnectionsRecords> {
    const { join } = await import('path');
    return this.readCurrent(join(this.directory, key(partitionId)), CONNECTION_COLLECTIONS);
  }
  /** O(partitions); callers cache it. Reads only each partition's connections. */
  async countLivePeopleByAgent(agentId: string, excludeAccountId?: string): Promise<Record<string, number>> {
    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    let entries: string[];
    try { entries = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
    const rows: unknown[] = [];
    for (const entry of entries) if (/^[0-9a-f]{64}$/.test(entry)) rows.push(...(await this.readCurrent(join(this.directory, entry), ['connections'])).connections);
    return countLivePeople(rows, agentId, excludeAccountId);
  }
}
