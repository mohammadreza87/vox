/**
 * Hardening H1 (F185, F208): the runtime wiring of the 12-month vox_audit
 * retention. wireSharingAudit wraps the audit store in withAuditRetention (an
 * audited write sweeps), and also runs startAuditRetentionSweep at startup in
 * the flags-on branch, so TIREH_SHARING_V2 alone (which appends nothing) still
 * ages rows out. A failed sweep logs the fixed code '[vox] audit sweep_failed'.
 * File storage under os.tmpdir() and a local Firestore fake; no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { AUDIT_COLLECTION } from '../../tireh/audit';
import { InMemoryMemoryStore, InMemoryShareOfferStore, type NewMemory } from '../../tireh/memory/store';
import { wireSharingAudit } from '../runtime';
import type { Studio } from '../service';

const DAY = 86_400_000;
const thirteenMonthsAgo = () => new Date(Date.now() - 395 * DAY);

let seq = 0;
const newMemory = (): NewMemory => ({
  personaId: 'agent-x', content: 'x', topic: 't', type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
  scope: { kind: 'private', personId: 'tg-1' }, authorizedPersonIds: ['tg-1'],
  source: { personId: 'tg-1', chatKind: 'private', at: new Date(), eventIds: [`ev-h1-retention-${++seq}`] },
});
const studioWith = () => ({ deps: { memory: { memories: new InMemoryMemoryStore(), offers: new InMemoryShareOfferStore() } } }) as unknown as Pick<Studio, 'deps'>;
const oldLine = (at: Date) => `${JSON.stringify({ id: 'audit-old-row', kind: 'write', personaId: 'agent-x', audiencePersonIds: ['tg-1'], memoryIds: ['m-old'], outcome: 'applied', at: at.toISOString() })}\n`;
const flush = async (studio: Pick<Studio, 'deps'>) => {
  const audit = studio.deps.audit as unknown as { flush?: () => Promise<void> } | undefined;
  if (typeof audit?.flush === 'function') await audit.flush();
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vox-h1-audit-retention-'));
  dirs.push(dir);
  return dir;
}
function flags(sharingV2: string, auditLog: string) {
  vi.stubEnv('TIREH_SHARING_V2', sharingV2);
  vi.stubEnv('TIREH_AUDIT_LOG', auditLog);
}

/** Just the Firestore surface the audit and notice stores use. */
function fakeFirestore(options: { failAuditReads?: boolean } = {}) {
  const data = new Map<string, Record<string, unknown>>();
  const time = (value: unknown) => (value instanceof Date ? value.getTime() : Number.NaN);
  type Op = '==' | '<' | '>=' | 'array-contains';
  const matches = (doc: Record<string, unknown>, [field, op, value]: [string, Op, unknown]) => {
    switch (op) {
      case '==': return doc[field] === value;
      case '<': return time(doc[field]) < time(value);
      case '>=': return time(doc[field]) >= time(value);
      case 'array-contains': return Array.isArray(doc[field]) && (doc[field] as unknown[]).includes(value);
    }
  };
  const ref = (path: string) => ({
    path,
    async create(value: Record<string, unknown>) { if (data.has(path)) throw new Error('exists'); data.set(path, { ...value }); },
    async delete() { data.delete(path); },
  });
  type Ref = ReturnType<typeof ref>;
  const query = (name: string, filters: Array<[string, Op, unknown]>, max = Infinity) => ({
    where: (field: string, op: Op, value: unknown) => query(name, [...filters, [field, op, value]], max),
    orderBy: () => query(name, filters, max),
    limit: (n: number) => query(name, filters, n),
    async get() {
      if (options.failAuditReads && name === AUDIT_COLLECTION) throw new Error('unavailable');
      const docs = [...data.entries()]
        .filter(([path, doc]) => path.startsWith(`${name}/`) && filters.every((f) => matches(doc, f)))
        .slice(0, max)
        .map(([path, doc]) => ({ id: path.slice(name.length + 1), ref: ref(path), data: () => ({ ...doc }) }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const db = {
    collection: (name: string) => ({ ...query(name, []), doc: (id: string) => ref(`${name}/${id}`) }),
    batch() {
      const pending: Array<() => Promise<void>> = [];
      return {
        create: (r: Ref, value: Record<string, unknown>) => { pending.push(() => r.create(value)); },
        delete: (r: Ref) => { pending.push(() => r.delete()); },
        commit: async () => { for (const write of pending) await write(); },
      };
    },
  };
  const auditIds = () => [...data.keys()].filter((path) => path.startsWith(`${AUDIT_COLLECTION}/`)).map((path) => path.slice(AUDIT_COLLECTION.length + 1));
  const seedOld = (at: Date) => data.set(`${AUDIT_COLLECTION}/audit-old-row`, { id: 'audit-old-row', kind: 'write', personaId: 'agent-x', audiencePersonIds: ['tg-1'], memoryIds: ['m-old'], outcome: 'applied', at });
  return { db: db as unknown as Firestore, auditIds, seedOld };
}

describe('runtime vox_audit retention on file storage (F185, F208)', () => {
  it('TIREH_AUDIT_LOG=1: a 13-month-old row is gone after one audited write (withAuditRetention is wired)', async () => {
    flags('', '1');
    const dir = tempDir();
    const file = join(dir, 'vox-audit.jsonl');
    const studio = studioWith();
    await wireSharingAudit(studio, dir, null);
    // Drain the startup sweep (no file yet: it removes nothing and creates nothing), so only the append can sweep.
    await studio.deps.audit!.list({ personaId: 'agent-x' });
    await settle();
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, oldLine(thirteenMonthsAgo()), { mode: 0o600 });

    await studio.deps.memory.memories.add(newMemory());
    await flush(studio);

    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('m-old');
    expect(text.trim().split('\n')).toHaveLength(1);
  });

  it('TIREH_SHARING_V2=1 alone appends nothing, and the startup sweep still removes a 13-month-old row', async () => {
    flags('1', '');
    const dir = tempDir();
    const file = join(dir, 'vox-audit.jsonl');
    const recent = new Date(Date.now() - 30 * DAY);
    writeFileSync(file, oldLine(thirteenMonthsAgo()) + oldLine(recent).replace('audit-old-row', 'audit-recent-row').replace('m-old', 'm-recent'), { mode: 0o600 });
    const studio = studioWith();
    await wireSharingAudit(studio, dir, null);
    await vi.waitFor(() => expect(readFileSync(file, 'utf8')).not.toContain('m-old'));
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('m-recent');
    expect(text.trim().split('\n')).toHaveLength(1);
    // No append with TIREH_AUDIT_LOG off.
    await studio.deps.memory.memories.add(newMemory());
    expect(readFileSync(file, 'utf8')).toBe(text);
  });
});

describe('runtime vox_audit retention on Firestore (F185, F208)', () => {
  it('TIREH_AUDIT_LOG=1: an audited write sweeps a 13-month-old row', async () => {
    flags('', '1');
    const { db, auditIds, seedOld } = fakeFirestore();
    const studio = studioWith();
    await wireSharingAudit(studio, '/nonexistent-h1-dir', db);
    await settle();
    seedOld(thirteenMonthsAgo());
    await studio.deps.memory.memories.add(newMemory());
    await flush(studio);
    const ids = auditIds();
    expect(ids).not.toContain('audit-old-row');
    expect(ids).toHaveLength(1);
  });

  it('TIREH_SHARING_V2=1 alone: the startup sweep removes a 13-month-old row with no appends', async () => {
    flags('1', '');
    const { db, auditIds, seedOld } = fakeFirestore();
    seedOld(thirteenMonthsAgo());
    const studio = studioWith();
    await wireSharingAudit(studio, '/nonexistent-h1-dir', db);
    await vi.waitFor(() => expect(auditIds()).toEqual([]));
  });

  it.each([
    { sharingV2: '1', auditLog: '1', label: 'flags on' },
    { sharingV2: '', auditLog: '', label: 'flags unset' },
  ])('a failed sweep logs only the fixed code ($label)', async ({ sharingV2, auditLog }) => {
    flags(sharingV2, auditLog);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db } = fakeFirestore({ failAuditReads: true });
    await wireSharingAudit(studioWith(), '/nonexistent-h1-dir', db);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[vox] audit sweep_failed'));
    for (const call of warn.mock.calls) expect(call).toEqual(['[vox] audit sweep_failed']);
  });
});
