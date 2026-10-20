import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, unlinkSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdaptiveRepository, accountIdFor, digest } from '../repository';
import { ManagedFileV2Storage } from './managed-storage';
import { AdaptiveService } from '../service';
import { adaptiveOptionsFromManifest } from '../config';
import { MessageMemoryService } from '../../message-memory/service';
import { hasCommittedPersonalizationTransport } from '../indexed-private-context';
import { AdaptiveExperienceService } from '../../runtime/service';
import { ProductPauseService } from '../../product-pause/service';
const paths: string[] = [], stores: ManagedFileV2Storage[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
const accountId = accountIdFor(123), NOW = 1_800_000_000_000;
async function fixture(analytics = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'vox-direct-authority-')); paths.push(root);
  let now = NOW;
  const storage = new ManagedFileV2Storage(join(root, 'store'), { now: () => now, newStoreSeed: { generation: 2, lifecycleWatermark: now, schemaVersion: 2 } }); stores.push(storage);
  const capabilities = ['core_text', ...(analytics ? ['product_analytics'] : [])];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: capabilities,
    accounts: [{ accountId, jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }], approvals: capabilities.map(capability => ({ schemaVersion: 1, id: capability, revision: 1, createdAt: now, updatedAt: now,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: now, reviewExpiresAt: now + 86400_000, owner: 'synthetic', approvalReference: 'synthetic' })) }));
  const repo = new AdaptiveRepository(storage), adaptive = new AdaptiveService(repo, { ...options, now: () => now });
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  await adaptive.setAgentAccess(123, 'agent', { space: 'work', allowed: true, expectedRevision: (await adaptive.read(123, 'work')).revision, eventId: 'grant-synthetic' });
  await adaptive.withAccountDocument(123, d => { d.memories.push({ id: 'note', revision: 1, space: 'work', text: 'STORED_NOTE_BODY_CANARY', status: 'active', createdAt: now, updatedAt: now, expiresAt: now + 86400_000, revocationEpoch: 0 }); });
  await new ProductPauseService(adaptive).command(123, { version: 1, eventId: 'pause'.repeat(6), expectedCommandSeq: 0, space: 'work', action: 'pause' });
  const headFile = join(storage.directory, 'head.json');
  const head = () => JSON.parse(readFileSync(headFile, 'utf8'));
  const authorityFile = () => join(storage.directory, 'authority', `${head().accounts[0].authorityFile}.json`);
  const evaluate = () => ({ value: true, deadline: now + 10000 });
  return { root, storage, repo, adaptive, headFile, head, authorityFile, evaluate, now: () => now, setNow: (at: number) => { now = at; } };
}
it('paused current-input preview and every export/final guard acquire zero canonical images; own save still transacts canonical', async () => {
  const f = await fixture(), requests: unknown[] = [];
  const llm = { committedExportFence: true as const, identity: { provider: 'synthetic' }, complete: async (request: any) => {
    expect(await request.authorize()).toBe(true); expect(request.authorizeNow()).toBe(true);
    requests.push({ system: request.system, messages: request.messages }); return JSON.stringify({ claims: ['Current claim'] });
  } };
  const service = new MessageMemoryService(f.adaptive, { llm, secret: 'synthetic-direct-secret-with-32-bytes', now: f.now, agentAuthority: async () => 'studio', agentAuthorityNow: () => 'studio' });
  const before = f.storage.io.canonicalImageReads;
  const preview = await service.preview(123, { space: 'work', agentId: 'agent', locale: 'en', text: 'Only current text' });
  const accept = { space: 'work' as const, agentId: 'agent', claims: preview.claims, sourceTextHash: preview.sourceTextHash, receipt: preview.receipt };
  service.revalidateNow(123, accept);
  expect(f.storage.io.canonicalImageReads - before).toBe(0); expect(f.storage.io.authorityImageReads).toBeGreaterThan(3);
  expect(JSON.stringify(requests)).not.toContain('STORED_NOTE_BODY_CANARY');
  const image = readFileSync(f.authorityFile(), 'utf8');
  expect(image).not.toMatch(/STORED_NOTE_BODY_CANARY|"preferences"|"relationships"|"latest"|"commandSeq"/);
  expect(await service.accept(123, accept)).toMatchObject({ memoryIds: [expect.any(String)] });
  expect(f.storage.io.canonicalImageReads).toBeGreaterThan(before);
});
it.each(['missing', 'digest', 'namespace', 'canonical', 'schema', 'controls', 'account', 'person', 'permission_scope', 'pause_epoch', 'head_downgrade', 'unknown', 'symlink'] as const)('rejects %s projection without a canonical fallback', async kind => {
  const f = await fixture(), file = f.authorityFile(), h = f.head(), image = JSON.parse(readFileSync(file, 'utf8'));
  if (kind === 'head_downgrade') { delete h.authorityProjectionVersion; for (const r of h.accounts) { delete r.authorityFile; delete r.authorityDigest; } writeFileSync(f.headFile, JSON.stringify(h)); }
  else if (kind === 'missing') unlinkSync(file);
  else if (kind === 'symlink') { const target = join(f.root, 'redirect.json'); writeFileSync(target, JSON.stringify(image)); unlinkSync(file); symlinkSync(target, file); }
  else {
    if (kind === 'digest') image.controls.revision++;
    if (kind === 'namespace') image.incarnation = 'c5f30d10-0b4d-4dc1-a190-f020658860a4';
    if (kind === 'canonical') image.canonicalDigest = 'a'.repeat(64);
    if (kind === 'schema') image.schemaVersion = 1;
    if (kind === 'controls') delete image.controls.productPause;
    if (kind === 'account') image.controls.accountId = accountIdFor(456);
    if (kind === 'person') image.controls.personId = 'account-profile:unrelated';
    if (kind === 'permission_scope') image.controls.permissions[0].spaceId = 'unrelated-space';
    if (kind === 'pause_epoch') image.controls.productPause.scopes[0].useEpoch = -1;
    if (kind === 'unknown') image.noteText = 'FORBIDDEN';
    writeFileSync(file, JSON.stringify(image));
    if (kind !== 'digest') { h.accounts[0].authorityDigest = digest(image); writeFileSync(f.headFile, JSON.stringify(h)); }
  }
  const before = f.storage.io.canonicalImageReads;
  expect(f.adaptive.readDirectAuthorityForEffect(123, 'work', f.evaluate).status).not.toBe('ready');
  expect(f.storage.io.canonicalImageReads).toBe(before);
});
it('publishes coherent canonical and authority references; guard abort preserves old pair and postcommit denial preserves new pair', async () => {
  const f = await fixture(), old = f.head();
  await expect(f.repo.transaction(accountId, f.now, d => { d.revision++; }, () => { throw Error('prepublish'); })).rejects.toThrow();
  expect(f.head().accounts).toEqual(old.accounts);
  let calls = 0;
  await expect(f.repo.transaction(accountId, f.now, d => { d.revision++; }, () => { if (++calls === 2) throw Error('postpublish'); })).rejects.toMatchObject({ committed: true });
  const next = f.head(), image = JSON.parse(readFileSync(f.authorityFile(), 'utf8'));
  expect(next.accounts[0].file).not.toBe(old.accounts[0].file);
  expect(image.canonicalFile).toBe(next.accounts[0].file); expect(image.canonicalDigest).toBe(next.accounts[0].digest);
  expect(readdirSync(join(f.storage.directory, 'records'))).toHaveLength(1); expect(readdirSync(join(f.storage.directory, 'authority'))).toHaveLength(1);
});
it('retains a deadline observed during evaluation and refuses regressed clocks after restart', async () => {
  const f = await fixture();
  expect(() => f.storage.readDirectAuthorityForEffect(accountId, 'work', () => { f.setNow(NOW + 20000); return { value: true, deadline: NOW + 10000 }; })).toThrow();
  expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 20000);
  f.storage.close();
  const reopened = new ManagedFileV2Storage(f.storage.directory, { now: () => NOW }); stores.push(reopened);
  expect(() => reopened.readDirectAuthorityForEffect(accountId, 'work', f.evaluate)).toThrow(/clock_regression/);
  expect(reopened.io.canonicalImageReads).toBe(0);
});
it('cannot return an earlier projection after the head changes during pure evaluation', async () => {
  const f = await fixture(), h = f.head();
  expect(() => f.storage.readDirectAuthorityForEffect(accountId, 'work', () => {
    const changed = structuredClone(h); changed.accounts[0].digest = 'a'.repeat(64); writeFileSync(f.headFile, JSON.stringify(changed)); return f.evaluate();
  })).toThrow();
  expect(f.storage.io.canonicalImageReads).toBeGreaterThan(0); // fixture writes only
});

it('paused turn recording skips denied analytic/proactive acquisition but preserves independently allowed analytics writes', async () => {
  const denied = await fixture(), allowed = await fixture(true);
  await allowed.adaptive.withAccountDocument(123, d => { const p = d.permissions.find(p => p.id === 'permission:work:optional.product_analytics')!; p.state = 'granted'; p.expiresAt = NOW + 100000; });
  const turn = { space: 'work' as const, agentId: 'agent', turnId: 'current-turn', channel: 'voice' as const, status: 'responded' as const, durationMs: 1 };
  const beforeDenied = denied.storage.io.canonicalImageReads, beforeAllowed = allowed.storage.io.canonicalImageReads;
  expect(await new AdaptiveExperienceService(denied.adaptive).recordTurn(123, turn)).toEqual({ recorded: false, inboxCreated: false });
  expect(denied.storage.io.canonicalImageReads).toBe(beforeDenied);
  expect(await new AdaptiveExperienceService(allowed.adaptive).recordTurn(123, turn)).toEqual({ recorded: true, inboxCreated: false });
  expect(allowed.storage.io.canonicalImageReads).toBeGreaterThan(beforeAllowed);
});

it('prepared FILE adapters without the exact projection capability cannot qualify or fall back to canonical reads', async () => {
  const f = await fixture(); expect(hasCommittedPersonalizationTransport(f.storage)).toBe(true);
  const canonical = f.storage.readCommittedForEffect.bind(f.storage); let calls = 0;
  for (const missing of ['method', 'version'] as const) {
    const adapter = { canonicalSchemaVersion: 2 as const, identity: f.storage.identity, supportsCommittedWriteFence: true as const,
      sampleClock: f.storage.sampleClock.bind(f.storage), transact: f.storage.transact.bind(f.storage),
      readCommittedForEffect: (id: string) => { calls++; return canonical(id); },
      ...(missing === 'method' ? { fileAuthorityProjectionVersion: 1 as const } : { readDirectAuthorityForEffect: f.storage.readDirectAuthorityForEffect.bind(f.storage) }) };
    expect(hasCommittedPersonalizationTransport(adapter)).toBe(false);
    const adaptive = new AdaptiveService(new AdaptiveRepository(adapter));
    expect(adaptive.readDirectAuthorityForEffect(123, 'work', f.evaluate)).toEqual({ status: 'unsupported' });
    await expect(adaptive.withDirectAuthority(123, 'work', f.evaluate)).rejects.toMatchObject({ code: 'adaptive_controls_unavailable' });
  }
  expect(calls).toBe(0);
});
