import { constants, existsSync, mkdirSync, lstatSync, readlinkSync, fstatSync, readSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, relative, parse, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { emptyExperimentDocument, experimentDocumentSchema, type ExperimentDocument } from './contracts';
const MAX_BYTES = 2_000_000;
const stat = (path: string) => { try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } };
function canonicalDirectory(path: string): string {
  let absolute = resolve(path);
  for (const [alias, target] of [['/tmp', '/private/tmp'], ['/var', '/private/var']] as const) {
    if (absolute !== alias && !absolute.startsWith(`${alias}/`)) continue;
    if (stat(alias)?.isSymbolicLink()) { const link = readlinkSync(alias);
      if (link !== target && link !== target.slice(1)) throw new Error('Unsafe experiment directory');
      absolute = join(target, relative(alias, absolute)); } break;
  } return absolute;
}
export interface ExperimentStorage {
  read(): ExperimentDocument;
  /** Synchronous, serialized, atomic. A thrown fence must commit nothing. */
  transaction<T>(mutate: (document: ExperimentDocument) => T, fence?: () => void): T;
}
export function validateExperimentDocument(raw: unknown): ExperimentDocument {
  const d = experimentDocumentSchema.parse(raw);
  for (const rows of [d.definitions.map(r => r.config.id), d.assignments.map(r => r.id), d.derived.map(r => r.id), d.exposures.map(r => r.id), d.tombstones.map(r => r.id)])
    if (new Set(rows).size !== rows.length) throw new Error('Duplicate experiment record');
  const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  for (const row of d.assignments) {
    const c = d.definitions.find(e => e.config.id === row.experimentId)?.config;
    if (!c || c.assignmentVersion !== row.assignmentVersion || row.id !== digest(['assignment', c.id, c.assignmentVersion, row.unit]) ||
        row.variant !== (parseInt(digest([c.salt, c.id, c.assignmentVersion, row.unit]).slice(0, 12), 16) % 10000 < c.candidateBasisPoints ? 'candidate' : 'control')) throw new Error('Invalid experiment assignment');
  }
  for (const row of d.derived) {
    const a = d.assignments.find(a => a.id === row.assignmentId), e = d.definitions.find(e => e.config.id === row.experimentId);
    if (!a || !e || a.unit !== row.unit || a.variant !== row.variant || a.experimentId !== row.experimentId || a.assignmentVersion !== row.assignmentVersion ||
        row.configRevision > e.revision || row.expiresAt <= row.createdAt || row.density !== (row.variant === 'candidate' ? e.config.candidateDensity : e.config.baselineDensity) ||
        row.id !== digest(['derived', row.assignmentId, row.source, row.authorityRevision, row.configRevision])) throw new Error('Invalid experimental derived lineage');
  }
  for (const row of d.exposures) {
    const a = d.assignments.find(a => a.id === row.assignmentId), e = d.definitions.find(e => e.config.id === row.experimentId);
    if (!a || !e || a.unit !== row.unit || a.variant !== row.variant || a.experimentId !== row.experimentId || a.assignmentVersion !== row.assignmentVersion || row.configRevision > e.revision || row.id !== digest(['exposure', row.derivedId])) throw new Error('Invalid experiment exposure');
  }
  const reserved = new Set([...d.derived.map(r => createHash('sha256').update(JSON.stringify(['source', r.unit, r.source.id])).digest('hex')), ...d.assignments.map(r => createHash('sha256').update(JSON.stringify(['scope-suppressed', r.unit, r.experimentId, r.assignmentVersion])).digest('hex'))]);
  for (const t of d.tombstones) reserved.delete(t.id);
  if (d.tombstones.length + reserved.size + d.definitions.filter(r => r.phase !== 'killed').length > 3000) throw new Error('Experiment tombstone reserve reached');
  if (Buffer.byteLength(JSON.stringify(d)) > MAX_BYTES) throw new Error('Experiment storage capacity reached');
  return d;
}
export class MemoryExperimentStorage implements ExperimentStorage {
  private document = emptyExperimentDocument();
  read(): ExperimentDocument { return structuredClone(this.document); }
  transaction<T>(mutate: (document: ExperimentDocument) => T, fence?: () => void): T {
    const draft = this.read(), result = mutate(draft); validateExperimentDocument(draft); fence?.(); this.document = draft; return result;
  }
}
/** Separate content-free local ledger. No canonical memory or Studio document is read/written.
 * Fresh reads have no process cache. A lock contention/crash lock fails closed. */
export class FileExperimentStorage implements ExperimentStorage {
  readonly directory: string;
  constructor(directory: string) { this.directory = canonicalDirectory(directory); this.root(false); }
  private root(create: boolean): boolean {
    let current = parse(this.directory).root;
    for (const part of relative(current, this.directory).split(sep).filter(Boolean)) {
      current = join(current, part); const info = stat(current);
      if (!info) { if (!create) return false; mkdirSync(current, { mode: 0o700 }); }
      else if (!info.isDirectory() || info.isSymbolicLink() || current === this.directory && (info.mode & 0o077) !== 0) throw new Error('Unsafe experiment directory');
    } return true;
  }
  private get file() { return join(this.directory, 'ledger.json'); }
  private get lock() { return join(this.directory, 'writer.lock'); }
  private load(): ExperimentDocument {
    if (!this.root(false)) return emptyExperimentDocument();
    const info = stat(this.file); if (!info) return emptyExperimentDocument();
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > MAX_BYTES) throw new Error('Unsafe experiment ledger');
    const fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_BYTES || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('Unsafe experiment ledger');
      const bytes = Buffer.alloc(MAX_BYTES + 1); let length = 0, read = 0;
      do { read = readSync(fd, bytes, length, bytes.length - length, null); length += read; } while (read > 0 && length < bytes.length);
      if (length > MAX_BYTES) throw new Error('Experiment ledger capacity reached');
      this.root(false); const latest = stat(this.file);
      if (!latest || latest.isSymbolicLink() || latest.ino !== opened.ino || latest.dev !== opened.dev) throw new Error('Experiment ledger changed');
      return validateExperimentDocument(JSON.parse(bytes.subarray(0, length).toString('utf8')));
    } finally { closeSync(fd); }
  }
  read(): ExperimentDocument {
    this.root(false); if (stat(this.lock)) throw new Error('Experiment store busy');
    const d = this.load(); this.root(false); if (stat(this.lock)) throw new Error('Experiment store busy'); return d;
  }
  transaction<T>(mutate: (document: ExperimentDocument) => T, fence?: () => void): T {
    this.root(true); const directoryInfo = lstatSync(this.directory);
    mkdirSync(this.lock, { mode: 0o700 });
    const temporary = join(this.directory, `ledger-${randomUUID()}.tmp`);
    try {
      const draft = this.load(), result = mutate(draft);
      validateExperimentDocument(draft);
      const serialized = JSON.stringify(draft); fence?.(); this.root(false);
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, serialized); fsyncSync(fd); } finally { closeSync(fd); }
      // Recheck after serialization/durability work, immediately before publication.
      fence?.(); this.root(false);
      const latestDirectory = lstatSync(this.directory);
      if (latestDirectory.ino !== directoryInfo.ino || latestDirectory.dev !== directoryInfo.dev) throw new Error('Experiment directory changed');
      renameSync(temporary, this.file);
      const directoryFd = openSync(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      return result;
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
      rmdirSync(this.lock);
    }
  }
}
