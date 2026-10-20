import { validateRightsUseHoldTransition } from '../../rights-use-holds/state';
/** Off-default, single-process local storage. No format discovery, migration or
 * fallback is performed. Opening this adapter is an explicit server operation. */
import Database from 'better-sqlite3';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { chmodSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { z } from 'zod';
import type { AdaptiveStorage, AdaptiveAccountPageInput, AdaptiveAccountPage } from '../storage';
import { digest, validateAdaptiveDocument, type AdaptiveDocument } from '../repository';
import { INDEXED_FORMAT_VERSION, IndexedStorageError, emptyIndexedIo,
  type IndexedIoCounters, type IndexedStoreMetadata } from './contracts';
import { accountKey, projectDocument, validateAccountId } from './projection';
import { IndexedQueryEngine } from './queries';
const openStores = new Set<string>();
const integer = z.number().int().nonnegative().safe();
const metadataSchema = z.object({ formatVersion: z.literal(INDEXED_FORMAT_VERSION), schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  incarnation: z.string().uuid(), generation: integer.min(1), lifecycleWatermark: integer }).strict();
const DDL = `
CREATE TABLE store_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), json TEXT NOT NULL) STRICT;
CREATE TABLE accounts (account_key TEXT PRIMARY KEY, account_id TEXT NOT NULL UNIQUE, canonical TEXT NOT NULL, canonical_digest TEXT NOT NULL) STRICT;
CREATE TABLE controls (account_key TEXT PRIMARY KEY REFERENCES accounts(account_key) ON DELETE CASCADE, json TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
CREATE TABLE catalogs (account_key TEXT NOT NULL REFERENCES accounts(account_key) ON DELETE CASCADE, space TEXT NOT NULL CHECK(space IN ('work','personal')), version INTEGER NOT NULL CHECK(version>0), digest TEXT NOT NULL, PRIMARY KEY(account_key,space)) STRICT;
CREATE TABLE memory_meta (account_key TEXT NOT NULL REFERENCES accounts(account_key) ON DELETE CASCADE, space TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, epoch INTEGER NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, body_bytes INTEGER NOT NULL, body_digest TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(account_key,space,id), UNIQUE(account_key,id)) STRICT;
CREATE INDEX memory_expiry ON memory_meta(account_key,space,status,expires_at);
CREATE TABLE bodies (account_key TEXT NOT NULL, space TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(account_key,space,id,revision), FOREIGN KEY(account_key,space,id) REFERENCES memory_meta(account_key,space,id) ON DELETE CASCADE) STRICT;
CREATE TABLE postings (account_key TEXT NOT NULL, space TEXT NOT NULL, term TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(account_key,space,term,id), FOREIGN KEY(account_key,space,id) REFERENCES memory_meta(account_key,space,id) ON DELETE CASCADE) STRICT;
CREATE TABLE source_edges (account_key TEXT NOT NULL, space TEXT NOT NULL, derived_id TEXT NOT NULL, source_id TEXT NOT NULL, expected_revision INTEGER NOT NULL, PRIMARY KEY(account_key,space,derived_id,source_id), FOREIGN KEY(account_key,space,derived_id) REFERENCES memory_meta(account_key,space,id) ON DELETE CASCADE) STRICT;
CREATE INDEX source_reverse ON source_edges(account_key,space,source_id,derived_id);
CREATE TABLE outbox (account_key TEXT NOT NULL REFERENCES accounts(account_key) ON DELETE CASCADE, event_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(account_key,event_id)) STRICT;
`;
function schemaDefinitions(db: Database.Database): unknown {
  return db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
}
function expectedSchema(): unknown {
  const db = new Database(':memory:'); try { db.exec(DDL); return schemaDefinitions(db); } finally { db.close(); }
}
const expectedObjects = ['accounts', 'bodies', 'catalogs', 'controls', 'memory_expiry', 'memory_meta', 'outbox', 'postings', 'source_edges', 'source_reverse', 'store_meta'];
export interface SqliteAdaptiveStorageOptions {
  validateDocument?: (raw: unknown, accountId: string, now: number) => AdaptiveDocument;
  now?: () => number;
  /** Explicit transition tools only. Rejected for any existing database. A new
   * incarnation is always generated; identity can never be imported/reused. */
  newStoreSeed?: { generation: number; lifecycleWatermark: number; schemaVersion?: 1 | 2 | 3 };
}
export class SqliteAdaptiveStorage implements AdaptiveStorage {
  private transactionClock?: (clock: () => number) => number;
  readonly supportsCommittedWriteFence = true as const;
  readonly indexed: IndexedQueryEngine;
  readonly canonicalSchemaVersion: 1 | 2 | 3;
  readonly identity: Readonly<Pick<IndexedStoreMetadata, 'incarnation' | 'generation'>>;
  /** Application materialization counters; these are not disk-page or latency measurements. */
  readonly io = emptyIndexedIo();
  readonly database: Database.Database;
  readonly clock: () => number;
  private readonly validator: NonNullable<SqliteAdaptiveStorageOptions['validateDocument']>;
  private readonly secret = randomBytes(32);
  private writer = false;
  private closed = false;
  private readonly storePath: string;
  constructor(path: string, options: SqliteAdaptiveStorageOptions = {}) {
    if (path === ':memory:' || !path) throw new IndexedStorageError('invalid_scope');
    this.storePath = resolve(path); this.clock = options.now ?? Date.now;
    this.validator = options.validateDocument ?? validateAdaptiveDocument;
    const seed = z.object({ generation: integer.min(1), lifecycleWatermark: integer, schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }).strict().safeParse(options.newStoreSeed ?? { generation: 1, lifecycleWatermark: 0 });
    if (!seed.success) throw new IndexedStorageError('invalid_scope');
    if (openStores.has(this.storePath)) throw new IndexedStorageError('busy');
    openStores.add(this.storePath);
    let opened: Database.Database | undefined;
    try {
      mkdirSync(dirname(this.storePath), { recursive: true, mode: 0o700 });
      opened = new Database(this.storePath, { timeout: 0 }); this.database = opened;
      chmodSync(this.storePath, 0o600);
      // EXCLUSIVE retains the OS-level database lock until close. This staged
      // topology intentionally rejects concurrent processes and DB-wide writers.
      for (const pragma of ['journal_mode = DELETE', 'synchronous = FULL', 'foreign_keys = ON',
        'secure_delete = ON', 'busy_timeout = 0', 'locking_mode = EXCLUSIVE', 'trusted_schema = OFF']) opened.pragma(pragma);
      const required: Record<string, unknown> = { journal_mode: 'delete', synchronous: 2, foreign_keys: 1,
        secure_delete: 1, busy_timeout: 0, locking_mode: 'exclusive', trusted_schema: 0 };
      for (const [key, value] of Object.entries(required)) if (opened.pragma(key, { simple: true }) !== value) throw new IndexedStorageError('corrupt');
      opened.exec('BEGIN EXCLUSIVE');
      const version = opened.pragma('user_version', { simple: true });
      const objects = opened.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
      if (version === 0 && objects.length === 0) {
        this.sampleTime(seed.data.lifecycleWatermark);
        opened.exec(DDL);
        opened.prepare('INSERT INTO store_meta(singleton,json) VALUES(1,?)').run(JSON.stringify({ formatVersion: 1,
          schemaVersion: seed.data.schemaVersion ?? 1, incarnation: randomUUID(), generation: seed.data.generation, lifecycleWatermark: seed.data.lifecycleWatermark }));
        opened.pragma(`user_version = ${seed.data.schemaVersion ?? 1}`);
      } else if (options.newStoreSeed !== undefined || (version !== 1 && version !== 2 && version !== 3) || JSON.stringify(objects.map(o => o.name)) !== JSON.stringify(expectedObjects)) throw new IndexedStorageError('corrupt');
      if (JSON.stringify(schemaDefinitions(opened)) !== JSON.stringify(expectedSchema())) throw new IndexedStorageError('corrupt');
      const identity = this.readMetadata();
      if (identity.schemaVersion !== opened.pragma('user_version', { simple: true })) throw new IndexedStorageError('corrupt');
      this.canonicalSchemaVersion = identity.schemaVersion;
      this.identity = Object.freeze({ incarnation: identity.incarnation, generation: identity.generation });
      if (opened.pragma('quick_check', { simple: true }) !== 'ok' || (opened.pragma('foreign_key_check') as unknown[]).length !== 0) throw new IndexedStorageError('corrupt');
      opened.exec('COMMIT');
      this.indexed = new IndexedQueryEngine(this);
    } catch (error) {
      if (opened?.inTransaction) opened.exec('ROLLBACK'); opened?.close(); openStores.delete(this.storePath);
      throw this.error(error);
    }
  }
  private error(error: unknown, committed: boolean | 'unknown' = false): IndexedStorageError {
    if (error instanceof IndexedStorageError) return error;
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    return new IndexedStorageError(code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED') ? 'busy' : 'corrupt', committed);
  }
  assertAvailable(): void { if (this.closed) throw new IndexedStorageError('closed'); if (this.writer) throw new IndexedStorageError('busy'); }
  sampleClock(clock: () => number): number {
    if (this.transactionClock) return this.transactionClock(clock);
    this.assertAvailable(); this.writer = true;
    try {
      const observed = this.sampleTime(0, clock());
      this.publishObservation(observed, this.io); return observed;
    } finally { this.writer = false; }
  }
  sampleTime(watermark: number, at?: number): number {
    const now = at ?? this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now < watermark) throw new IndexedStorageError('clock_regression');
    return now;
  }
  readMetadata(): IndexedStoreMetadata {
    const row = this.database.prepare('SELECT json FROM store_meta WHERE singleton=1').get() as { json: string } | undefined;
    if (!row) throw new IndexedStorageError('corrupt');
    const parsed = metadataSchema.safeParse(JSON.parse(row.json));
    if (!parsed.success || this.canonicalSchemaVersion && parsed.data.schemaVersion !== this.canonicalSchemaVersion) throw new IndexedStorageError('corrupt'); return parsed.data;
  }
  sign(value: unknown): string { return createHmac('sha256', this.secret).update(JSON.stringify(value)).digest('hex'); }
  verify(value: { seal: string }): boolean {
    const { seal, ...payload } = value;
    if (typeof seal !== 'string' || !/^[a-f0-9]{64}$/.test(seal)) return false;
    return timingSafeEqual(Buffer.from(seal, 'hex'), Buffer.from(this.sign(payload), 'hex'));
  }
  count(io: IndexedIoCounters, key: keyof IndexedIoCounters, value = 1): void { io[key] += value; if (io !== this.io) this.io[key] += value; }
  private advance(meta: IndexedStoreMetadata, now: number, io: IndexedIoCounters): void {
    if (now === meta.lifecycleWatermark) return;
    meta.lifecycleWatermark = now;
    this.database.prepare('UPDATE store_meta SET json=? WHERE singleton=1').run(JSON.stringify(meta)); this.count(io, 'watermarkWrites');
  }
  private publishObservation(observedAt: number, io: IndexedIoCounters): void {
    let committing = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const meta = this.readMetadata(); this.sampleTime(meta.lifecycleWatermark, observedAt);
      this.advance(meta, observedAt, io);
      committing = true; this.database.exec('COMMIT');
      this.sampleTime(meta.lifecycleWatermark);
    } catch (error) {
      if (this.database.inTransaction) this.database.exec('ROLLBACK');
      if (committing && !(error instanceof IndexedStorageError)) throw new IndexedStorageError('commit_uncertain', 'unknown');
      throw this.error(error);
    }
  }
  /** Every compact read takes a writer reservation, so it cannot use an old SQL
   * snapshot behind a live writer. The watermark publication is deliberately a
   * measured durable write. Constant time does not issue an UPDATE. */
  readWindow<T>(io: IndexedIoCounters, read: (now: number, meta: IndexedStoreMetadata) => T,
    checkFresh: (value: T, now: number) => void | { denied?: boolean; deadline?: number; observedDenial?: boolean }, at?: number, options?: { publishFresh: true }): T {
    this.assertAvailable(); this.writer = true; let committed = false, committing = false, observedTime: number | undefined;
    const sample = (floor: number, override?: number) => {
      const value = this.sampleTime(Math.max(floor, observedTime ?? floor), override); observedTime = value; return value;
    };
    try {
      this.database.exec('BEGIN IMMEDIATE'); const meta = this.readMetadata();
      const now = sample(meta.lifecycleWatermark, at);
      if (!options?.publishFresh) this.advance(meta, now, io);
      const value = read(now, meta);
      sample(meta.lifecycleWatermark);
      committing = true; this.database.exec('COMMIT'); committed = true;
      let fresh = sample(meta.lifecycleWatermark);
      if (options?.publishFresh) { this.publishObservation(fresh, io); fresh = sample(fresh); }
      const evaluation = checkFresh(value, fresh);
      const afterEvaluation = sample(meta.lifecycleWatermark);
      if (!evaluation?.denied && evaluation?.deadline !== undefined && evaluation.deadline <= afterEvaluation) throw new IndexedStorageError('expired');
      if (evaluation?.denied || evaluation?.observedDenial) {
        this.publishObservation(afterEvaluation, io);
        const afterPublication = sample(afterEvaluation);
        if (!evaluation.denied && evaluation.deadline !== undefined && evaluation.deadline <= afterPublication) throw new IndexedStorageError('expired');
      }
      return value;
    } catch (error) {
      if (this.database.inTransaction) this.database.exec('ROLLBACK');
      if (committing && !committed) throw new IndexedStorageError('commit_uncertain', 'unknown');
      if (observedTime !== undefined) {
        // Keep the actual argument supplied to a denying evaluator, even if its
        // clock regresses before it returns/throws. Never infer it by resampling.
        try {
          const floor = this.readMetadata().lifecycleWatermark;
          let publicationAt = Math.max(floor, observedTime);
          try { publicationAt = Math.max(publicationAt, this.sampleTime(0)); } catch { /* Preserve the last valid sample. */ }
          this.publishObservation(publicationAt, io);
        } catch (publicationError) { throw this.error(publicationError, committed); }
      }
      throw this.error(error, committed);
    } finally { this.writer = false; }
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit?: () => void): Promise<T> {
    validateAccountId(accountId); this.assertAvailable(); this.writer = true; let committed = false, committing = false;
    let observedTime: number | undefined;
    try {
      this.database.exec('BEGIN IMMEDIATE'); const meta = this.readMetadata(), now = this.sampleTime(meta.lifecycleWatermark);
      observedTime = now;
      this.transactionClock = clock => { observedTime = this.sampleTime(observedTime!, clock()); return observedTime; };
      const key = accountKey(accountId), current = this.database.prepare('SELECT canonical,canonical_digest FROM accounts WHERE account_key=?').get(key) as { canonical: string; canonical_digest: string } | undefined;
      if (current) { this.io.canonicalImageReads++; if (digest(JSON.parse(current.canonical)) !== current.canonical_digest) throw new IndexedStorageError('corrupt'); if (this.validator(JSON.parse(current.canonical), accountId, now).schemaVersion !== this.canonicalSchemaVersion) throw new IndexedStorageError('invalid_controls'); }
      const output = mutate(current ? JSON.parse(current.canonical) : null);
      if (output && typeof output === 'object' && 'then' in output) throw new IndexedStorageError('corrupt');
      // Mutation callbacks sample current business time after acquiring storage.
      // Validate against fresh time, never the earlier input-read sample.
      const outputAt = this.sampleTime(observedTime); observedTime = outputAt;
      const document = this.validator(output.document, accountId, outputAt);
      if (document.schemaVersion !== this.canonicalSchemaVersion) throw new IndexedStorageError('invalid_controls');
      validateRightsUseHoldTransition(current ? this.validator(JSON.parse(current.canonical),accountId,outputAt) : null,document);
      const canonical = JSON.stringify(output.document);
      const serializedAt = this.sampleTime(observedTime); observedTime = serializedAt;
      const serializedDocument = this.validator(JSON.parse(canonical), accountId, serializedAt);
      if (digest(document) !== digest(serializedDocument)) throw new IndexedStorageError('corrupt');
      const p = projectDocument(serializedDocument, canonical);
      this.database.prepare('INSERT INTO accounts VALUES(?,?,?,?) ON CONFLICT(account_key) DO UPDATE SET canonical=excluded.canonical,canonical_digest=excluded.canonical_digest').run(key, accountId, canonical, digest(output.document));
      this.database.prepare('INSERT INTO controls VALUES(?,?,?) ON CONFLICT(account_key) DO UPDATE SET json=excluded.json,digest=excluded.digest').run(key, p.controlsJson, p.controlsDigest);
      for (const catalog of p.catalogs) this.database.prepare(`INSERT INTO catalogs VALUES(?,?,1,?) ON CONFLICT(account_key,space) DO UPDATE SET version=CASE WHEN digest<>excluded.digest THEN version+1 ELSE version END,digest=excluded.digest`).run(key, catalog.space, catalog.digest);
      this.database.prepare('DELETE FROM memory_meta WHERE account_key=?').run(key);
      for (const row of p.memories) {
        const m = row.metadata;
        this.database.prepare('INSERT INTO memory_meta VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(key, m.space, m.id, m.revision, m.epoch, m.status, m.expiresAt, m.updatedAt, m.bodyBytes, m.bodyDigest, row.metadataJson);
        if (row.text !== undefined) {
          this.database.prepare('INSERT INTO bodies VALUES(?,?,?,?,?,?)').run(key, m.space, m.id, m.revision, row.text, m.bodyDigest);
          for (const term of row.terms) this.database.prepare('INSERT INTO postings VALUES(?,?,?,?,?)').run(key, m.space, term, m.id, m.revision);
        }
        for (const ref of m.sourceRefs) this.database.prepare('INSERT INTO source_edges VALUES(?,?,?,?,?)').run(key, m.space, m.id, ref.id, ref.revision);
      }
      this.database.prepare('DELETE FROM outbox WHERE account_key=?').run(key);
      for (const row of p.outbox) this.database.prepare('INSERT INTO outbox VALUES(?,?,?)').run(key, row.eventId, JSON.stringify(row));
      this.advance(meta, serializedAt, this.io);
      observedTime = this.sampleTime(observedTime);
      beforeCommit?.(); // Last user operation immediately before synchronous COMMIT.
      committing = true; this.database.exec('COMMIT'); committed = true;
      const result = output.result === undefined ? output.result : structuredClone(output.result);
      observedTime = this.sampleTime(observedTime);
      try { beforeCommit?.(); } catch { throw new IndexedStorageError('denied', true); }
      return result;
    } catch (error) {
      if (!committed && this.database.inTransaction) this.database.exec('ROLLBACK');
      if (committing && !committed) throw new IndexedStorageError('commit_uncertain', 'unknown');
      try {
        // A callback/guard may itself observe expiry. A failed mutation rolls
        // back its data, but never rolls back an observed lifecycle deadline.
        const watermark = this.readMetadata().lifecycleWatermark;
        // A clock regression can follow a later validated observation. Retain
        // that high-water mark even when publication's fresh-clock check denies.
        let publicationAt = Math.max(watermark, observedTime ?? watermark);
        try { publicationAt = Math.max(publicationAt, this.sampleTime(0)); } catch { /* Retain valid observations; publication rechecks the current clock. */ }
        this.publishObservation(publicationAt, this.io);
      } catch (publicationError) {
        throw new IndexedStorageError(publicationError instanceof IndexedStorageError ? publicationError.reason : 'corrupt', committed);
      }
      if (committed && (!(error instanceof IndexedStorageError) || error.committed !== true))
        throw new IndexedStorageError(error instanceof IndexedStorageError ? error.reason : 'denied', true);
      throw error;
    } finally { this.transactionClock = undefined; this.writer = false; }
  }
  readCommittedForEffect(accountId: string): { status: 'ready'; document: unknown | null } | { status: 'busy' } {
    validateAccountId(accountId);
    try {
      return this.readWindow(emptyIndexedIo(), (now) => {
        const row = this.database.prepare('SELECT canonical,canonical_digest FROM accounts WHERE account_key=?').get(accountKey(accountId)) as { canonical: string; canonical_digest: string } | undefined;
        if (!row) return { status: 'ready' as const, document: null };
        this.io.canonicalImageReads++; const document: unknown = JSON.parse(row.canonical);
        if (digest(document) !== row.canonical_digest) throw new IndexedStorageError('corrupt');
        if (this.validator(document, accountId, now).schemaVersion !== this.canonicalSchemaVersion) throw new IndexedStorageError('invalid_controls');
        return { status: 'ready' as const, document };
      }, () => undefined);
    } catch (error) { if (error instanceof IndexedStorageError && error.reason === 'busy') return { status: 'busy' }; throw error; }
  }
  readCommittedWithoutObservationForEffect(accountId:string):{status:'ready';document:unknown|null;observedAt:number}|{status:'busy'} {
    validateAccountId(accountId);if(this.writer||this.database.inTransaction)return {status:'busy'};this.assertAvailable();this.writer=true;
    try {
      // A short synchronous shared read transaction, never BEGIN IMMEDIATE.
      this.database.exec('BEGIN');const meta=this.readMetadata(),now=this.sampleTime(meta.lifecycleWatermark);
      const row=this.database.prepare('SELECT canonical,canonical_digest FROM accounts WHERE account_key=?').get(accountKey(accountId)) as {canonical:string;canonical_digest:string}|undefined;
      let document:unknown|null=null;
      if(row){this.io.canonicalImageReads++;document=JSON.parse(row.canonical);if(digest(document)!==row.canonical_digest || this.validator(document,accountId,now).schemaVersion!==this.canonicalSchemaVersion)throw new IndexedStorageError('corrupt');}
      this.sampleTime(now);this.database.exec('COMMIT');
      const latest=this.readMetadata(),fresh=this.sampleTime(Math.max(now,latest.lifecycleWatermark));
      if(JSON.stringify(meta)!==JSON.stringify(latest))return {status:'busy'};
      return {status:'ready',document,observedAt:fresh};
    }catch(error){if(this.database.inTransaction)this.database.exec('ROLLBACK');const failure=this.error(error);if(failure.reason==='busy')return {status:'busy'};throw failure;}
    finally{this.writer=false;}
  }
  async listAccounts(input: AdaptiveAccountPageInput): Promise<AdaptiveAccountPage> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 || input.after !== undefined && !/^[a-f0-9]{64}$/.test(input.after)) throw new Error('Invalid adaptive enumeration');
    return this.readWindow(emptyIndexedIo(), () => {
      const rows = this.database.prepare('SELECT account_key,account_id FROM accounts WHERE account_key>? ORDER BY account_key LIMIT ?').all(input.after ?? '', input.limit + 1) as { account_key: string; account_id: string }[];
      for (const row of rows) { validateAccountId(row.account_id); if (accountKey(row.account_id) !== row.account_key) throw new IndexedStorageError('corrupt'); }
      return { accountIds: rows.slice(0, input.limit).map(r => r.account_id), ...(rows.length > input.limit ? { next: rows[input.limit - 1].account_key } : {}) };
    }, () => undefined);
  }
  close(): void {
    if (this.closed) return; if (this.writer) throw new IndexedStorageError('busy');
    this.database.close(); this.closed = true; this.secret.fill(0); openStores.delete(this.storePath);
  }
}
