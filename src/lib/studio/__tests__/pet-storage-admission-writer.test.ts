// Protected parity: use actual FILE writers, then the actual standalone reader.
// No app sanitizer is imported into or substituted for reader admission.
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newCare } from '../../pet/care';
import { newCheckinAgent, newCheckinRecord, type PetCheckinRecord } from '../../pet/checkins';
import { newPlay, type PetPlay } from '../../pet/play';
import { FilePetCheckinStore } from '../pet-checkins/store';
import { FilePetGrowthStore } from '../pet-growth-store';
import { FilePetPlayStore } from '../pet-play-store';
import { FilePetStore } from '../pet-store';

const T = Date.UTC(2026, 9, 27, 12);
function snapshot(root: string): unknown[] {
  const rows: unknown[] = [];
  const visit = (path: string, rel: string) => {
    const stat = lstatSync(path);
    rows.push([rel, stat.mode, stat.nlink, stat.isSymbolicLink() ? ['link', readlinkSync(path)] : stat.isDirectory() ? ['dir'] : ['file', readFileSync(path).toString('base64')]]);
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`);
  };
  visit(root, ''); return rows;
}
async function fixture(run: (f: { root: string; pets: FilePetStore; plays: FilePetPlayStore; growth: FilePetGrowthStore; checkins: FilePetCheckinStore }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'vox-pet-writer-reader-'));
  const petsDir = join(root, 'pets');
  try { await run({ root, pets: new FilePetStore(petsDir), plays: new FilePetPlayStore(petsDir), growth: new FilePetGrowthStore(petsDir), checkins: new FilePetCheckinStore(petsDir) }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function read(root: string, previous = false): Record<string, number> | null {
  const before = snapshot(root);
  const helper = resolve(previous ? 'scripts/fixtures/pet-storage-admission-prior-reader/studio-adaptive-compatibility.mjs' : 'scripts/studio-adaptive-compatibility.mjs');
  const program = `import {pathToFileURL} from 'node:url';
    let fetches=0;globalThis.fetch=()=>{fetches++;throw new Error('Network forbidden in synthetic reader');};
    const helper=await import(pathToFileURL(process.argv[1]).href);
    try {const required=helper.assertReleaseAdaptiveCompatibility({STUDIO_DATA_DIR:process.argv[2],STUDIO_ADAPTIVE_FORMAT:'file'},helper.ADAPTIVE_RELEASE_CAPABILITIES);
      if(fetches)process.exit(3);process.stdout.write(JSON.stringify({ok:true,required}));}
    catch(e){if(fetches||e.message!=='Adaptive storage is incompatible with this release; current personalization controls must be preserved.')process.exit(4);process.stdout.write(JSON.stringify({ok:false}));}`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program, helper, root], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, timeout: 10_000,
  });
  expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0); expect(child.stderr).toBe('');
  expect(snapshot(root)).toEqual(before);
  const output = JSON.parse(child.stdout) as { ok: boolean; required?: Record<string, number> };
  return output.ok ? output.required! : null;
}
function fullPlay(): PetPlay {
  return { ...newPlay('agent-a', 7, -1.25), updatedAt: 2.5, seenAt: 0, visitsOpen: true,
    items: [{ id: 'starPin', earnedAt: 0 }], wearing: { head: 'bowtie', hand: 'glasses' },
    garden: { seed: 'flower', plantedAt: -1, waterings: 3, wateredDay: '2026-99-99', bloomedAt: 1.5 },
    book: [{ id: 'met', at: 0 }], games: { bop: { rounds: 20, best: true, zen: false, day: '2026-10-27', today: 60, lastRound: '1234abcd' } },
    tips: { T14: { shown: 2, dismissed: false, lastShownAt: -1, lastDay: '2026-10-27' } },
    asks: { P3b: { lastAskedAt: 0, declined: 2, lastDeclinedAt: 1, lastDay: '2026-10-27', acceptedAt: 0 } },
    seasons: { yalda: 1301, nowruz: 1699 }, litMine: [{ id: 'private-taught', litAt: -2.75, ref: 'a'.repeat(16) }] };
}
function fullCheckin(): PetCheckinRecord {
  return { ...newCheckinRecord(7, T, 'fa'), tz: 'UTC', sound: true, pausedAt: 0, pausedNoteAt: 1, resumedAt: 2, unopenedStreak: 100,
    agents: { 'agent-a': { ...newCheckinAgent(), enabled: true, week: [0, 0, 1, 2, 3, 4], lastSentAt: 0,
      consent: { purpose: 'optional.pet_checkins', state: 'withdrawn', revision: 1, effectiveAt: 5, withdrawnAt: 0, withdrawnVia: 'stop_all',
        evidence: { eventId: 'synthetic_01', noticeId: 'perm.P1.forming', noticeVersion: 'pet-checkins-v1', copyHash: 'b'.repeat(64), locale: 'fa',
          presentedAt: 9, decidedAt: 0, surface: 'mini_app', affirmative: true } } } }, seasons: { yalda: 1300, nowruz: 1600 },
    sent: [{ ref: 'abcdefgh_1234567', agentId: 'retired-agent', moment: 'C11', occurrence: 'nowruz:1405', day: '2026-99-99', personHash: 'c'.repeat(16),
      at: 0, state: 'unknown', lang: 'fa', variant: 15, openedAt: 0, openedVia: 'app', whyAt: 0, stoppedAt: 0, by: 'local' }] };
}

describe('pet standalone admission of actual FILE writer output', () => {
  it('admits minimal output for each existing writer and refuses the actual prior reader without modifying it', async () => fixture(async f => {
    await f.plays.update('agent-a', 7, () => ({ play: newPlay('agent-a', 7, T), result: null }));
    expect(read(f.root)?.petPlaySchema).toBe(1); expect(read(f.root, true)).toBeNull();
    await f.growth.update('agent-a', () => ({ lit: [{ id: 'room-first', kind: 'room', at: T }], result: null }));
    expect(read(f.root)?.petGrowthSchema).toBe(1);
    await f.checkins.update(7, () => ({ record: newCheckinRecord(7, T), result: null }));
    expect(read(f.root)?.petCheckinSchema).toBe(1); expect(read(f.root, true)).toBeNull();
    expect(JSON.parse(readFileSync(join(f.root, 'pets/growth/agent-a.json'), 'utf8'))).toEqual({ agentId: 'agent-a', lit: [{ id: 'room-first', kind: 'room', at: T }] });
  }));

  it('admits representative full stored normal forms, including fractional finite play/growth dates and existing consent shapes', async () => fixture(async f => {
    await f.pets.update('agent-a', 7, () => ({ care: newCare('agent-a', 7, T, 'UTC', 1), result: null }));
    await f.plays.update('agent-a', 7, () => ({ play: fullPlay(), result: null }));
    await f.growth.update('agent-a', () => ({ lit: [{ id: 'taught-one', kind: 'taught', at: -1.5, ref: 'd'.repeat(64), dimmedAt: 0.25 }], result: null }));
    await f.checkins.update(7, () => ({ record: fullCheckin(), result: null }));
    expect(await new FilePetPlayStore(join(f.root, 'pets')).get('agent-a', 7)).toEqual(fullPlay());
    expect(await new FilePetCheckinStore(join(f.root, 'pets')).get(7)).toEqual(fullCheckin());
    const required = read(f.root); expect(required).toMatchObject({ petCareSchema: 1, petPlaySchema: 1, petGrowthSchema: 1, petCheckinSchema: 1 });
    expect(read(f.root, true)).toBeNull();
  }));

  it('preserves shared erasure epochs and rejects stale writer epochs while admission keeps both off records and empty directory capabilities', async () => fixture(async f => {
    const oldEpoch = await f.pets.erasureEpoch(7);
    await f.plays.update('agent-a', 7, () => ({ play: newPlay('agent-a', 7, T), result: null }), oldEpoch);
    await f.checkins.update(7, () => ({ record: newCheckinRecord(7, T), result: null }), oldEpoch);
    await f.growth.update('agent-a', () => ({ lit: [{ id: 'task-first', kind: 'task', at: T }], result: null }));
    await f.pets.eraseUser(7);
    const newEpoch = await f.pets.erasureEpoch(7); expect(newEpoch).not.toBe(oldEpoch);
    const epochPath = join(f.root, 'pets/.epochs/7.json'); const epochBytes = readFileSync(epochPath);
    await expect(f.plays.update('agent-a', 7, () => ({ play: newPlay('agent-a', 7, T), result: null }), oldEpoch)).rejects.toThrow('Pet care changed');
    await expect(f.checkins.update(7, () => ({ record: newCheckinRecord(7, T), result: null }), oldEpoch)).rejects.toThrow('Pet care changed');
    expect(read(f.root)).toMatchObject({ petPlaySchema: 1, petGrowthSchema: 1, petCheckinSchema: 1 });
    expect(readFileSync(epochPath)).toEqual(epochBytes);
    await f.plays.eraseUser(7); await f.checkins.eraseUser(7); await f.growth.clearAgent('agent-a');
    expect(await f.plays.get('agent-a', 7)).toBeNull(); expect(await f.checkins.get(7)).toBeNull(); expect(await f.growth.get('agent-a')).toEqual([]);
    expect(read(f.root)).toMatchObject({ petPlaySchema: 1, petGrowthSchema: 1, petCheckinSchema: 1 }); expect(read(f.root, true)).toBeNull();
  }));
});
