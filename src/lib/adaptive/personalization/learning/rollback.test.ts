import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { learningFixture } from './fixtures';
import { accountIdFor } from '../../persistence/repository';
import { ID } from '../../../studio/__tests__/helpers';
import { stripPreferenceLearningForRollback, pruneFilePreferenceLearning } from './rollback';
const fixtures: Awaited<ReturnType<typeof learningFixture>>[] = [], directories: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
it('armed document rollback is accepted by exact796073f strict schema while preserving current rights, Undo and budget tombstones', async () => {
  const x = await learningFixture(); fixtures.push(x); await x.enable(); x.enqueue(); await x.learning.tasks.settle();
  await x.f.save({ key: 'language', value: 'fa' }); // suppresses candidate, preserves current explicit+Undo.
  x.enqueue('Please make future replies brief.'); await x.learning.tasks.settle();
  await x.f.adaptive.withAccountDocument(ID.alice, d => { d.experience.preferenceLearning!.suppressions.push({ ...x.scope, evidenceId: 'a'.repeat(64), createdAt: 1, expiresAt: 9_999_999_999_999 }); });
  const document = await x.f.adaptive.withAccountDocument(ID.alice, d => structuredClone(d)), accountId = accountIdFor(ID.alice), stripped = stripPreferenceLearningForRollback(document, accountId) as typeof document;
  expect(document.experience.preferenceLearning?.intents).toHaveLength(1); expect(document.experience.preferenceLearning?.candidates).toHaveLength(1); expect(document.experience.predictionTurns.some(t => t.finalFingerprint)).toBe(true);
  expect(stripped).toEqual({ ...document, experience: { ...document.experience, preferenceLearning: undefined,
    predictionTurns: document.experience.predictionTurns.map(row => { const old = { ...row }; delete old.finalFingerprint; delete old.learningEvidenceId; delete old.learningReservation; return old; }) } });
  expect(stripped.experience.preferenceUndo).toEqual(document.experience.preferenceUndo); expect(stripped.permissions).toEqual(document.permissions); expect(stripped.deletions).toEqual(document.deletions);
  const directory = await mkdtemp(join(tmpdir(), 'vox-learning-old-schema-')); directories.push(directory);
  // Pinned exact historical source: no Git/history/network dependency in
  // shallow CI. Digests and provenance are reviewable alongside the fixtures.
  const fixtureDirectory = resolve('src/lib/adaptive/personalization/learning/compatibility/base796073f');
  const manifest = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8')) as {
    revision: string; files: Array<{ path: string; fixture: string; sha256: string }>;
  };
  expect(manifest.revision).toBe('796073f07c60d93ee52eaa5344628478ec7ada4f');
  for (const entry of manifest.files) {
    const source = await readFile(join(fixtureDirectory, entry.fixture));
    expect(createHash('sha256').update(source).digest('hex')).toBe(entry.sha256);
    const file = join(directory, entry.path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, source);
  }
  await symlink(resolve('node_modules'), join(directory, 'node_modules'));
  const probe = join(directory, 'probe.ts'), data = join(directory, 'documents.json');
  await writeFile(data, JSON.stringify([document.experience, stripped.experience]));
  await writeFile(probe, `import { readFileSync } from 'node:fs'; import { experienceDocumentSchema } from './src/lib/adaptive/runtime/contracts'; const [armed,clean]=JSON.parse(readFileSync(process.argv[2],'utf8')); if(experienceDocumentSchema.safeParse(armed).success||!experienceDocumentSchema.safeParse(clean).success)process.exit(1);`);
  execFileSync(resolve('node_modules/.bin/tsx'), [probe, data], { stdio: 'pipe' });
  const options = { directory: x.f.directory!, accountId }, preview = await pruneFilePreferenceLearning(options);
  expect(preview.changed).toBe(true); await expect(pruneFilePreferenceLearning({ ...options, apply: true })).rejects.toThrow();
  await expect(pruneFilePreferenceLearning({ ...options, apply: true, producersStopped: true, expectedContentSha256: '0'.repeat(64) })).rejects.toThrow('rollback_document_changed');
  await x.learning.tasks.close(); await pruneFilePreferenceLearning({ ...options, apply: true, producersStopped: true, expectedContentSha256: preview.contentSha256 });
  const stored = JSON.parse(await readFile(join(x.f.directory!, createHash('sha256').update(accountId).digest('hex') + '.json'), 'utf8'));
  expect(stored.experience.preferenceLearning).toBeUndefined(); expect(stored.experience.preferences).toEqual(document.experience.preferences);
});
it('disabled status/cancel add no optional learning or final-seal keys and need no rollback', async () => {
  const x = await learningFixture(); fixtures.push(x); await x.view(); x.learning.tasks.cancel(ID.alice, 'work');
  const document = await x.f.adaptive.withAccountDocument(ID.alice, d => structuredClone(d));
  expect(document.experience.preferenceLearning).toBeUndefined(); expect(document.experience.predictionTurns).toEqual([]);
  expect(stripPreferenceLearningForRollback(document, accountIdFor(ID.alice))).toEqual(document);
  expect(() => stripPreferenceLearningForRollback(document, accountIdFor(ID.bob))).toThrow('rollback_scope_mismatch');
});
