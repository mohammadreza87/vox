import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor } from './repository';
import { AdaptiveService } from './service';
import { SqliteAdaptiveStorage } from './indexed/sqlite-storage';
import { FileAdaptiveStorage } from './storage';
import { ManagedFileV2Storage } from './indexed/managed-storage';
import type { RuntimeControlEvaluation, RuntimeControlStamp } from './authority';

const paths: string[] = [], stores: SqliteAdaptiveStorage[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const s of stores.splice(0)) s.close(); for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
async function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'vox-compact-authority-')); paths.push(path);
  const file = join(path, 'synthetic.sqlite'); let now = 1000;
  const storage = new SqliteAdaptiveStorage(file, { now: () => now }); stores.push(storage);
  const repository = new AdaptiveRepository(storage);
  await repository.transaction(accountIdFor(123), () => now, d => {
    d.binding = { schemaVersion: 1, id: 'synthetic', revision: 1, accountId: d.accountId, personId: d.personId,
      status: 'verified', method: 'account_confirmation', createdAt: now, updatedAt: now, verifiedAt: now, expiresAt: 90_000 };
    d.memories = Array.from({ length: 300 }, (_, i) => ({ id: `note-${i}`, revision: 1, space: 'work',
      text: `PRIVATE_BODY_${i}`, status: 'active', createdAt: now, updatedAt: now, expiresAt: 80_000, revocationEpoch: 0 }));
  });
  for (const key of Object.keys(storage.io) as (keyof typeof storage.io)[]) storage.io[key] = 0;
  const adaptive = new AdaptiveService(repository, { now: () => now });
  return { storage, adaptive, file, setNow: (value: number) => { now = value; } };
}

it('passes distinct compact controls and current store identity with zero canonical or body materialization', async () => {
  const f = await fixture();
  const result = await f.adaptive.withRuntimeControls(123, 'work', (controls, now, storeIdentity) => {
    expect(controls).not.toHaveProperty('memories'); expect(controls).not.toHaveProperty('observer');
    expect(controls.experience).not.toHaveProperty('inbox');
    expect(JSON.stringify(controls)).not.toContain('PRIVATE_BODY_');
    return { value: { confirmed: f.adaptive.isProfileConfirmed(controls, now), storeIdentity }, deadline: 10_000 };
  });
  expect(result.confirmed).toBe(true); expect(result.storeIdentity).toMatch(/^[a-f0-9]{64}$/);
  expect(f.storage.io.canonicalImageReads).toBe(0); expect(f.storage.io.bodyRowsRead).toBe(0);
  expect(f.adaptive.readRuntimeControlsForEffect(123, 'personal', () => ({ value: false, denied: true })))
    .toEqual({ status: 'ready', value: false });
  expect(f.storage.io.canonicalImageReads).toBe(0);
});

it('evaluates external policy after native I/O and keeps its denial time across reopen', async () => {
  const f = await fixture(); const exec = f.storage.database.exec.bind(f.storage.database); let crossed = false;
  vi.spyOn(f.storage.database, 'exec').mockImplementation(sql => {
    const result = exec(sql);
    if (sql === 'COMMIT' && !crossed) { crossed = true; f.setNow(2001); }
    return result;
  });
  const observed = await f.adaptive.withRuntimeControls(123, 'work', (_controls, now) => ({ value: now < 2000, denied: now >= 2000,
    ...(now < 2000 ? { deadline: 2000 } : {}) }));
  expect(observed).toBe(false);
  vi.restoreAllMocks(); f.storage.close();
  const reopened = new SqliteAdaptiveStorage(f.file, { now: () => 1500 }); stores.push(reopened);
  const adaptive = new AdaptiveService(new AdaptiveRepository(reopened), { now: () => 1500 });
  const evaluate = vi.fn(() => ({ value: true, deadline: 2000 }));
  expect(adaptive.readRuntimeControlsForEffect(123, 'work', evaluate).status).toBe('busy');
  expect(evaluate).not.toHaveBeenCalled(); expect(reopened.io.canonicalImageReads).toBe(0);
});

it('never releases an evaluation whose external deadline crossed during callback work', async () => {
  const f = await fixture();
  await expect(f.adaptive.withRuntimeControls(123, 'work', () => {
    f.setNow(2001); return { value: 'MUST_NOT_ESCAPE', deadline: 2000 };
  })).rejects.toMatchObject({ code: 'adaptive_controls_unavailable' });
  expect(f.storage.io.canonicalImageReads).toBe(0); expect(f.storage.io.bodyRowsRead).toBe(0);
});

it('freezes mapped wrappers and exposes catalog changes separately from the stable store namespace', async () => {
  const f = await fixture(); let initialStamp: RuntimeControlStamp;
  const namespace = await f.adaptive.withRuntimeControls(123, 'work', (controls, _now, identity, stamp) => {
    initialStamp = stamp;
    expect(Object.isFrozen(controls)).toBe(true); expect(Object.isFrozen(controls.experience)).toBe(true);
    expect(Object.isFrozen(controls.relationships)).toBe(true); expect(Object.isFrozen(controls.binding)).toBe(true);
    expect(Object.isFrozen(stamp)).toBe(true);
    expect(Reflect.set(controls, 'binding', undefined)).toBe(false);
    expect(Reflect.set(controls.experience, 'preferences', [])).toBe(false);
    return { value: identity };
  });
  expect(namespace).toBe(f.adaptive.storeIdentity);
  await f.adaptive.repository.transaction(accountIdFor(123), () => 1000, d => { d.memories[0].text = 'CORRECTED'; d.memories[0].revision++; });
  await f.adaptive.withRuntimeControls(123, 'work', (_c, _now, identity, stamp) => {
    expect(identity).toBe(namespace); expect(stamp!.catalogDigest).not.toBe(initialStamp!.catalogDigest);
    expect(stamp!.catalogVersion).toBeGreaterThan(initialStamp!.catalogVersion);
    return { value: true };
  });
});

for (const kind of ['indexed', 'file'] as const) {
  async function serviceFixture() {
    if (kind === 'indexed') return fixture();
    const path = mkdtempSync(join(tmpdir(), 'vox-file-authority-')); paths.push(path);
    let now = 1000; const storage = new FileAdaptiveStorage(path);
    const repository = new AdaptiveRepository(storage);
    await repository.transaction(accountIdFor(123), () => now, () => {});
    return { storage, adaptive: new AdaptiveService(repository, { now: () => now }), setNow: (value: number) => { now = value; } };
  }
  it(`${kind}: rejects async wrapper and async values without unhandled promise rejection`, async () => {
    const f = await serviceFixture();
    for (const make of [() => Promise.reject(new Error('synthetic-invalid-wrapper')),
      () => ({ value: Promise.reject(new Error('synthetic-invalid-value')) }),
      () => ({ value: [Promise.reject(new Error('synthetic-invalid-first')), Promise.reject(new Error('synthetic-invalid-sibling'))] }),
      () => ({ value: true, unknown: Promise.reject(new Error('synthetic-invalid-extra')) }),
      () => ({ value: { nested: Promise.reject(new Error('synthetic-invalid-nested-value')) } })]) {
      const result = f.adaptive.readRuntimeControlsForEffect(123, 'work', () => make() as unknown as RuntimeControlEvaluation<boolean>);
      expect(result.status).toBe('busy');
      await new Promise(resolve => setImmediate(resolve));
    }
  });
  it(`${kind}: rejects accessor/thenable outputs without invoking user methods`, async () => {
    const f = await serviceFixture(); const getter = vi.fn(() => true), then = vi.fn();
    for (const value of [Object.defineProperty({}, 'value', { get: getter }), { value: { then } },
      { value: Object.defineProperty({}, 'bad', { get: getter }) }]) {
      expect(f.adaptive.readRuntimeControlsForEffect(123, 'work', () => value as RuntimeControlEvaluation<boolean>).status).toBe('busy');
    }
    expect(getter).not.toHaveBeenCalled(); expect(then).not.toHaveBeenCalled();
  });
  it(`${kind}: suppresses callback deadline crossing for synchronous and asynchronous reads`, async () => {
    const f = await serviceFixture();
    expect(f.adaptive.readRuntimeControlsForEffect(123, 'work', () => {
      f.setNow(2001); return { value: 'MUST_NOT_ESCAPE', deadline: 2000 };
    }).status).toBe('busy');
    await expect(f.adaptive.withRuntimeControls(123, 'work', () => {
      f.setNow(4001); return { value: 'MUST_NOT_ESCAPE', deadline: 4000 };
    })).rejects.toThrow();
  });
}

it('FILE fallback suppresses a result if durability crosses the external deadline', async () => {
  const path = mkdtempSync(join(tmpdir(), 'vox-file-durability-')); paths.push(path);
  let now = 1000; const storage = new FileAdaptiveStorage(path); const repository = new AdaptiveRepository(storage);
  await repository.transaction(accountIdFor(123), () => now, () => {});
  const adaptive = new AdaptiveService(repository, { now: () => now });
  const transact = storage.transact.bind(storage);
  vi.spyOn(storage, 'transact').mockImplementation(async (...args) => { const result = await transact(...args); now = 2001; return result; });
  await expect(adaptive.withRuntimeControls(123, 'work', controls => {
    expect(Object.isFrozen(controls)).toBe(true); expect(controls).not.toHaveProperty('memories');
    return { value: 'MUST_NOT_ESCAPE', deadline: 2000 };
  })).rejects.toMatchObject({ code: 'adaptive_controls_unavailable' });
});


it.each(['sync', 'async'] as const)('managed FILE %s persists a post-publication expiry before rejecting the result', async mode => {
  const path = mkdtempSync(join(tmpdir(), 'vox-managed-service-clock-')); paths.push(path);
  let now = 1000;
  const storage = new ManagedFileV2Storage(path, { now: () => now, newStoreSeed: { generation: 1, lifecycleWatermark: 1000 } });
  try {
    const repository = new AdaptiveRepository(storage); await repository.transaction(accountIdFor(123), () => now, () => {});
    const adaptive = new AdaptiveService(repository, { now: () => now });
    const observe = storage.observeLifecycleTime.bind(storage); let crossed = false;
    vi.spyOn(storage, 'observeLifecycleTime').mockImplementation(at => { observe(at); if (!crossed) { crossed = true; now = 2001; } });
    const evaluate = () => ({ value: 'MUST_NOT_ESCAPE', deadline: 2000 });
    if (mode === 'sync') expect(adaptive.readRuntimeControlsForEffect(123, 'work', evaluate).status).toBe('busy');
    else await expect(adaptive.withRuntimeControls(123, 'work', evaluate)).rejects.toThrow();
    expect(storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(2001);
    now = 1500; expect(adaptive.readRuntimeControlsForEffect(123, 'work', evaluate).status).toBe('busy');
  } finally { storage.close(); }
});
