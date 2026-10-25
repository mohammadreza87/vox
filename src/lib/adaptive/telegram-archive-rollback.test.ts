import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rollbackFileTelegramArchive, stripTelegramArchiveForRollback } from './telegram-archive-rollback';

const accountId = 'telegram-account:123';
const entry = { agentId: 'agent', space: 'personal', enabled: false, generation: 3, clearedAt: 100, index: [] };
const document = () => ({ accountId, revision: 99, grants: [{ revoked: true }], tombstones: ['source'], telegramArchives: [entry] });
describe('archive downgrade keeps current canonical authority', () => {
  it('removes only the extension and leaves the input untouched', () => {
    const original = document(), { telegramArchives: _archives, ...rest } = original;
    expect(_archives).toHaveLength(1);
    expect(stripTelegramArchiveForRollback(original, accountId).document).toEqual(rest);
    expect(original.telegramArchives).toHaveLength(1);
    expect(() => stripTelegramArchiveForRollback(original, 'telegram-account:999')).toThrow('scope');
  });
  it('refuses pending accepted events', () => {
    const state = { schemaVersion: 1, scope: { accountId, personId: 'p', agentId: 'agent', space: 'personal', containerId: 'c' },
      botId: 2, revision: 1, receipts: [], pending: [{ eventId: 'e', logicalId: 'l', revision: 1, role: 'user', text: 'pending', occurredAt: 1, receivedAt: 1, expiresAt: 200 }] };
    expect(() => stripTelegramArchiveForRollback({ ...document(), telegramArchives: [{ ...entry, state }] }, accountId)).toThrow('pending_work');
  });
  it('defaults to dry run, fences concurrent changes, and preserves all other fields on apply', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'archive-rollback-'));
    const file = join(directory, createHash('sha256').update(accountId).digest('hex') + '.json');
    try {
      await writeFile(file, JSON.stringify(document()));
      const preview = await rollbackFileTelegramArchive({ directory, accountId });
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(document());
      await expect(rollbackFileTelegramArchive({ directory, accountId, apply: true })).rejects.toThrow('stop_producers');
      await writeFile(file, JSON.stringify({ ...document(), revision: 100 }));
      await expect(rollbackFileTelegramArchive({ directory, accountId, apply: true, producersStopped: true, expectedContentSha256: preview.contentSha256 })).rejects.toThrow('document_changed');
      const latest = await rollbackFileTelegramArchive({ directory, accountId });
      await rollbackFileTelegramArchive({ directory, accountId, apply: true, producersStopped: true, expectedContentSha256: latest.contentSha256 });
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ accountId, revision: 100, grants: [{ revoked: true }], tombstones: ['source'] });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
