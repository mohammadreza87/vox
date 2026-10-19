import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { accountIdFor } from '../persistence/repository';
import { experienceDocumentSchema } from '../runtime/contracts';
import { preferenceFixture } from './__tests__/fixtures';
import { pruneFilePreferenceUndo, stripPreferenceUndoForRollback } from './rollback';

it('leaves old-format reads unchanged and removes only undo metadata under explicit per-account CAS for rollback', async () => {
  const f = await preferenceFixture({ file: true }), accountId = accountIdFor(f.telegramId);
  const file = join(f.directory!, createHash('sha256').update(accountId).digest('hex') + '.json');
  try {
    await f.state();
    expect(JSON.parse(await readFile(file, 'utf8')).experience.preferenceUndo).toBeUndefined();
    await f.save({ key: 'language', value: 'fa' }); await f.save({ key: 'language', value: 'en' });
    const bytes = await readFile(file, 'utf8'), before = JSON.parse(bytes);
    const preview = await pruneFilePreferenceUndo({ directory: f.directory!, accountId });
    expect(preview.changed).toBe(true); expect(await readFile(file, 'utf8')).toBe(bytes);
    await expect(pruneFilePreferenceUndo({ directory: f.directory!, accountId, apply: true, expectedContentSha256: preview.contentSha256 })).rejects.toThrow();
    await expect(pruneFilePreferenceUndo({ directory: f.directory!, accountId, apply: true, producersStopped: true, expectedContentSha256: '0'.repeat(64) })).rejects.toThrow('rollback_document_changed');
    await pruneFilePreferenceUndo({ directory: f.directory!, accountId, apply: true, producersStopped: true, expectedContentSha256: preview.contentSha256 });
    const after = JSON.parse(await readFile(file, 'utf8')); const expected = structuredClone(before); delete expected.experience.preferenceUndo;
    expect(after).toEqual(expected);
    expect(experienceDocumentSchema.omit({ preferenceUndo: true }).safeParse(after.experience).success).toBe(true);
    expect(after.experience.preferences[0].setting).toEqual({ key: 'language', value: 'en' });
    expect(() => stripPreferenceUndoForRollback(before, 'telegram-account:999')).toThrow('rollback_scope_mismatch');
  } finally { await f.close(); }
});
