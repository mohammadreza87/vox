import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor, type AdaptiveDocument } from './repository';
import { AdaptiveService } from './service';
import { adaptiveOptionsFromManifest } from './config';
import { SqliteAdaptiveStorage } from './indexed/sqlite-storage';
import { AuthorizedContextRetriever } from '../retrieval';

const NOW = Date.UTC(2026, 9, 19, 12), ACCOUNT = accountIdFor(123);
const paths: string[] = [], stores: SqliteAdaptiveStorage[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const s of stores.splice(0)) s.close(); for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
async function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'vox-indexed-private-context-')); paths.push(path);
  let now = NOW, policyUntil = NOW + 100_000;
  const storage = new SqliteAdaptiveStorage(join(path, 'synthetic.sqlite'), { now: () => now }); stores.push(storage);
  const repository = new AdaptiveRepository(storage);
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic',
    enabledCapabilities: ['core_text', 'personalization'],
    accounts: [{ accountId: ACCOUNT, jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: ['core_text', 'personalization'].map(capability => ({ schemaVersion: 1, id: `synthetic-${capability}`, revision: 1,
      createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic',
      effectiveAt: NOW, reviewExpiresAt: NOW + 100_000, owner: 'synthetic', approvalReference: 'synthetic-only' })) }));
  const adaptive = new AdaptiveService(repository, { ...options, now: () => now, capabilityPolicy: (context, at) => {
    const result = options.capabilityPolicy?.(context, at);
    return result && { ...result, approvals: result.approvals.map(a => ({ ...a, reviewExpiresAt: policyUntil })) };
  } });
  const write = (fn: (d: AdaptiveDocument) => void) => repository.transaction(ACCOUNT, () => now, d => { fn(d); d.revision++; d.updatedAt = now; });
  await write(d => {
    d.declaration = { adultConfirmed: true, declaredAt: now };
    d.binding = { schemaVersion: 1, id: 'synthetic-binding', revision: 1, accountId: d.accountId, personId: d.personId,
      status: 'verified', method: 'account_confirmation', createdAt: now, updatedAt: now, verifiedAt: now, expiresAt: NOW + 90_000 };
    const permission = d.permissions.find(p => p.id === 'permission:work:optional.personalization')!;
    Object.assign(permission, { state: 'granted', effectiveAt: now, updatedAt: now, expiresAt: NOW + 80_000, epoch: 1, revision: 2 });
    d.agentGrants = [{ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: now }];
    d.memories = Array.from({ length: 300 }, (_, i) => ({ id: `memory-${String(i).padStart(3, '0')}`, revision: 1,
      space: 'work', text: `recent distractor ${i}`, status: 'active', createdAt: now - 1000 + i,
      updatedAt: now - 1000 + i, expiresAt: NOW + 60_000, revocationEpoch: 0 }));
    d.memories[0].text = 'Launch comet is on 31 October, not 30 October.';
    d.memories[1].text = 'رنگ مورد علاقهٔ من آبی است و کد آن ۱۲۳ است.';
  });
  const reset = () => { for (const k of Object.keys(storage.io) as (keyof typeof storage.io)[]) storage.io[k] = 0; };
  reset(); return { adaptive, storage, repository, write, reset, setNow: (value: number) => { now = value; },
    setPolicyUntil: (value: number) => { policyUntil = value; } };
}

it('loads an old relevant EN or FA fact from 300 rows without reading a canonical image', async () => {
  const f = await fixture();
  const en = await f.adaptive.readPrivateContext(123, 'work', 'agent', 'comet');
  expect(en.memories).toEqual([{ id: 'memory-000', text: 'Launch comet is on 31 October, not 30 October.' }]);
  expect(en.completion).toBe('complete');
  const fa = await f.adaptive.readPrivateContext(123, 'work', 'agent', 'كد ١٢٣');
  // OR lexical matching also admits the numeric distractor; the exact two-term
  // Persian match ranks first. This is not semantic exclusion of other matches.
  expect(fa.memories.map(m => m.id)).toEqual(['memory-001', 'memory-123']);
  expect(f.storage.io.bodyRowsRead).toBe(3); expect(f.storage.io.canonicalImageReads).toBe(0);
});

it('matches full catalog revisions using pure authority checks, including unselected correction and expiry', async () => {
  const f = await fixture(), initial = await f.adaptive.readPrivateContext(123, 'work', 'agent', 'comet');
  f.reset(); expect(await f.adaptive.readPrivateContextAuthority(123, 'work', 'agent')).toEqual({ revision: initial.revision });
  expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
  await f.write(d => { d.memories[299].text = 'corrected unselected source'; d.memories[299].revision++; });
  f.reset(); const corrected = await f.adaptive.readPrivateContextAuthority(123, 'work', 'agent');
  expect(corrected.revision).not.toBe(initial.revision); expect(f.storage.io.bodyRowsRead).toBe(0);
  f.setNow(NOW + 60_001);
  const expired = await f.adaptive.readPrivateContextAuthority(123, 'work', 'agent');
  expect(expired.revision).not.toBe(corrected.revision); expect(f.storage.io.bodyRowsRead).toBe(0);
  expect(f.storage.io.canonicalImageReads).toBe(0);
  expect((await f.adaptive.readPrivateContext(123, 'work', 'agent', 'comet')).memories).toEqual([]);
});

it('keeps all pure private projections body-free and account/space/agent scoped', async () => {
  const f = await fixture();
  expect((await f.adaptive.readAuthority(123, 'work')).identity.confirmed).toBe(true);
  expect(await f.adaptive.runtimePrivacy.read('agent', 'tg-123', 'work')).toMatchObject({ memoryEnabled: false, historyEnabled: false });
  expect((await f.adaptive.readPrivateContext(123, 'personal', 'agent', 'comet')).memories).toEqual([]);
  expect((await f.adaptive.readPrivateContext(123, 'work', 'other', 'comet')).memories).toEqual([]);
  await expect(f.adaptive.readPrivateContext(124, 'work', 'agent', 'comet')).rejects.toMatchObject({ code: 'adaptive_context_unavailable' });
  expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
});

it.each(['binding', 'permission', 'grant', 'capability'] as const)('denies %s before any private text load', async kind => {
  const f = await fixture();
  if (kind === 'binding') await f.write(d => { delete d.binding; });
  if (kind === 'permission') await f.write(d => { d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.state = 'withdrawn'; });
  if (kind === 'grant') await f.write(d => { d.agentGrants[0].allowed = false; d.agentGrants[0].revision++; });
  if (kind === 'capability') f.setPolicyUntil(NOW);
  f.reset(); expect((await f.adaptive.readPrivateContext(123, 'work', 'agent', 'comet')).memories).toEqual([]);
  expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
});

it('reports candidate truncation and retains final whole-record prompt budgets', async () => {
  const f = await fixture(), context = await f.adaptive.readPrivateContext(123, 'work', 'agent', 'distractor');
  expect(context.completion).toBe('partial'); expect(context.memories).toHaveLength(64);
  expect(f.storage.io.bodyRowsRead).toBe(64); expect(f.storage.io.bodyBytesRead).toBeLessThanOrEqual(128 * 1024);
  const packed = new AuthorizedContextRetriever().select({ query: 'distractor', candidates: context.memories.map(m => ({ ...m, layer: 'memory', freshness: 0 })) });
  expect(packed.selected.length).toBeLessThanOrEqual(12); expect(packed.serializedBytes).toBeLessThanOrEqual(8192);
  expect(f.storage.io.canonicalImageReads).toBe(0);
});

it('checks external capability again after query I/O before body acquisition', async () => {
  const f = await fixture(); f.setPolicyUntil(NOW + 10);
  const query = f.storage.indexed.queryCandidateIds.bind(f.storage.indexed);
  vi.spyOn(f.storage.indexed, 'queryCandidateIds').mockImplementation((...args) => { const result = query(...args); f.setNow(NOW + 11); return result; });
  await expect(f.adaptive.readPrivateContext(123, 'work', 'agent', 'comet')).rejects.toMatchObject({ code: 'adaptive_context_unavailable' });
  expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(NOW + 11);
});

it('suppresses bodies when policy changes during body I/O', async () => {
  const f = await fixture(); const load = f.storage.indexed.loadCandidateBodies.bind(f.storage.indexed);
  vi.spyOn(f.storage.indexed, 'loadCandidateBodies').mockImplementation((...args) => { const result = load(...args); f.setPolicyUntil(NOW); return result; });
  await expect(f.adaptive.readPrivateContext(123, 'work', 'agent', 'comet')).rejects.toMatchObject({ code: 'adaptive_context_unavailable' });
  expect(f.storage.io.bodyRowsRead).toBe(1); // Acquired while allowed; never released.
});

it('carries inherited unverified labels and source IDs without loading ancestor text', async () => {
  const f = await fixture(); await f.write(d => {
    d.memories[0].origin = 'user_reviewed_claim';
    d.memories[1].sourceRefs = [{ id: d.memories[0].id, revision: d.memories[0].revision }];
    d.memories[1].text = 'Derived summary of the comet date.';
  });
  f.reset(); const context = await f.adaptive.readPrivateContext(123, 'work', 'agent', 'Derived');
  expect(context.memories).toEqual([{ id: 'memory-001', text: 'User-reviewed claim (not independently verified): Derived summary of the comet date.', sourceIds: ['memory-000'] }]);
  expect(f.storage.io.bodyRowsRead).toBe(1); expect(f.storage.io.canonicalImageReads).toBe(0);
});

it('invalidates identical imported data under a fresh store namespace', async () => {
  const f = await fixture(), before = await f.adaptive.readPrivateContextAuthority(123, 'work', 'agent');
  const current = f.storage.readCommittedForEffect(ACCOUNT); expect(current.status).toBe('ready');
  if (current.status !== 'ready') throw new Error('Synthetic fixture missing');
  const path = mkdtempSync(join(tmpdir(), 'vox-private-import-')); paths.push(path);
  const storage = new SqliteAdaptiveStorage(join(path, 'synthetic.sqlite'), { now: () => NOW }); stores.push(storage);
  await storage.transact(ACCOUNT, () => ({ document: current.document, result: undefined }));
  // Same external policy options as the original, without duplicating internal configuration.
  const original = f.adaptive.repository.storage;
  Object.defineProperty(f.adaptive.repository, 'storage', { value: storage, configurable: true });
  try { expect((await f.adaptive.readPrivateContextAuthority(123, 'work', 'agent')).revision).not.toBe(before.revision); }
  finally { Object.defineProperty(f.adaptive.repository, 'storage', { value: original, configurable: true }); }
  expect(storage.io.canonicalImageReads).toBe(0); expect(storage.io.bodyRowsRead).toBe(0);
});
