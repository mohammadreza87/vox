import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor } from './repository';
import { AdaptiveService } from './service';
import { SqliteAdaptiveStorage } from './indexed/sqlite-storage';

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
