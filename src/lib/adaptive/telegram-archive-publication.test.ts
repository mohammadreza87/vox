import { describe, expect, it } from 'vitest';
import { pruneTelegramArchives, resetTelegramArchives, suppressTelegramArchiveSource, telegramArchiveEntrySchema,
  type TelegramArchiveEntry } from './telegram-archive-state';
import { stripTelegramArchiveForRollback } from './telegram-archive-rollback';
import type { ArchiveSnapshotOperation, ArchiveState } from '../tireh/memory/telegram-archive/contracts';

const file = { fileId: 'SYNTHETIC_FILE', digest: 'a'.repeat(64), messageId: 1 };
function row(): TelegramArchiveEntry {
  const event = { eventId: 'e', logicalId: 'telegram:1', revision: 1, occurredAt: 10, receivedAt: 10, expiresAt: 1000,
    role: 'user' as const, text: 'SYNTHETIC_REMOVED_SOURCE' };
  return { agentId: 'a', space: 'work', enabled: true, generation: 1, clearedAt: 0, index: [event],
    state: { schemaVersion: 1, scope: { accountId: 'telegram-account:42', personId: 'p', agentId: 'a', space: 'work', containerId: 'c' },
      botId: 7, revision: 3, head: { ...file, sequence: 1 }, pending: [event],
      receipts: [{ eventId: event.eventId, logicalId: event.logicalId, sourceRevision: event.revision, fingerprint: 'b'.repeat(64) }] } };
}
function publication(stage: ArchiveSnapshotOperation['stage']): ArchiveSnapshotOperation {
  return { id: 'pub', stage, authorityRevision: 'authority', authorityDigest: 'a'.repeat(64), sourceRevision: 3,
    sourceStateDigest: 'b'.repeat(64), sourceHead: { ...file, sequence: 1 }, receiptCount: 1, receiptDigest: 'c'.repeat(64),
    createdAt: 10, validUntil: 1000, planJson: '{}', planDigest: 'd'.repeat(64), chunkRefs: [], ordinal: 0,
    budgetBytes: 4096, reservation: ' '.repeat(100) };
}
function checkpoint(stage: NonNullable<ArchiveState['operation']>['stage']): NonNullable<ArchiveState['operation']> {
  return { id: 'checkpoint', stage, sequence: 2, authorityRevision: 'authority', eventIds: ['e'], createdAt: 10,
    ...(stage === 'bundle_verified' ? { bundle: file } : {}) };
}

describe('archive reset preserves external-effect uncertainty', () => {
  it.each(['prepared', 'bundle_sending', 'bundle_verified', 'manifest_sending', 'unknown'] as const)(
    'clears checkpoint %s content while retaining only possible effects', stage => {
      const value = row(); value.state!.operation = checkpoint(stage);
      resetTelegramArchives({ telegramArchives: [value] }, 100, 'work', 'a', true);
      expect(value.state).toBeUndefined(); expect(value.index).toEqual([]); expect(value.enabled).toBe(false);
      expect(JSON.stringify(value)).not.toContain('SYNTHETIC_REMOVED_SOURCE');
      if (stage === 'prepared') { expect(value.retiredOperation).toBeUndefined(); expect(value.snapshotPublicationVersion).toBeUndefined(); }
      else {
        expect(value.retiredOperation).toMatchObject({ kind: 'checkpoint', id: 'checkpoint', stage: 'unknown', botId: 7 });
        expect(value.retiredOperation!.files).toEqual(stage === 'bundle_verified' ? [file] : []);
        expect(value.retiredOperation).not.toHaveProperty('eventIds'); expect(value.snapshotPublicationVersion).toBe(1);
      }
      expect(telegramArchiveEntrySchema.safeParse(value).success).toBe(true);
    });

  it.each(['prepared', 'chunk_sending', 'chunk_uploaded', 'manifest_sending', 'manifest_uploaded', 'ready', 'unknown'] as const)(
    'retires snapshot %s effects without its plan or reservation', stage => {
      const value = row(); value.state!.publication = publication(stage); value.snapshotPublicationVersion = 1;
      if (stage !== 'prepared' && stage !== 'chunk_sending') value.state!.publication.chunkRefs = [file];
      resetTelegramArchives({ telegramArchives: [value] }, 100);
      if (stage === 'prepared') expect(value.retiredOperation).toBeUndefined();
      else {
        expect(value.retiredOperation).toMatchObject({ kind: 'snapshot', id: 'pub', stage: 'unknown' });
        expect(Object.keys(value.retiredOperation!).sort()).toEqual(['botId', 'createdAt', 'files', 'id', 'kind', 'scope', 'stage']);
        expect(value.retiredOperation!.files).toEqual(stage === 'chunk_sending' ? [] : [file]);
      }
      expect(JSON.stringify(value)).not.toContain('SYNTHETIC_REMOVED_SOURCE');
      expect(telegramArchiveEntrySchema.safeParse(value).success).toBe(true);
    });

  it('preserves an earlier retired receipt through repeated clear, disable, expiry and re-enable', () => {
    const value = row(); value.state!.operation = checkpoint('bundle_verified');
    const document = { telegramArchives: [value] };
    resetTelegramArchives(document, 100); const retired = structuredClone(value.retiredOperation);
    resetTelegramArchives(document, 200, 'work', 'a', true);
    value.enabled = true;
    resetTelegramArchives(document, 300, 'work', 'a');
    expect(value.retiredOperation).toEqual(retired); expect(value.snapshotPublicationVersion).toBe(1);
    expect(pruneTelegramArchives(document, 5000)).toBe(false);
    expect(value.retiredOperation).toEqual(retired); expect(value.clearedAt).toBe(300);
  });

  it('expiry pruning uses the same content-free retirement barrier', () => {
    const value = row(); value.state!.operation = checkpoint('manifest_sending');
    expect(pruneTelegramArchives({ telegramArchives: [value] }, 1000)).toBe(true);
    expect(value.state).toBeUndefined(); expect(value.index).toEqual([]);
    expect(value.retiredOperation).toMatchObject({ kind: 'checkpoint', stage: 'unknown' });
    expect(value.snapshotPublicationVersion).toBe(1);
  });

  it('known edits retire a stale publication while preserving unrelated source state', () => {
    const value = row(); value.state!.pending = []; value.state!.publication = publication('chunk_uploaded');
    value.state!.publication.chunkRefs = [file]; value.snapshotPublicationVersion = 1;
    expect(suppressTelegramArchiveSource(value, 'telegram:1')).toBe(true);
    expect(value.state!.publication).toBeUndefined(); expect(value.state!.head).toEqual({ ...file, sequence: 1 });
    expect(value.state!.receipts[0].suppressed).toBe(true);
    expect(value.retiredOperation).toMatchObject({ kind: 'snapshot', files: [file] });
    const retired = structuredClone(value.retiredOperation); resetTelegramArchives({ telegramArchives: [value] }, 500);
    expect(value.retiredOperation).toEqual(retired); expect(value.state).toBeUndefined();
  });

  it('requires current reader metadata and rejects future or mismatched scope records', () => {
    const value = row(); value.state!.operation = checkpoint('unknown'); resetTelegramArchives({ telegramArchives: [value] }, 100);
    const missing = structuredClone(value); delete missing.snapshotPublicationVersion;
    expect(telegramArchiveEntrySchema.safeParse(missing).success).toBe(false);
    expect(telegramArchiveEntrySchema.safeParse({ ...value, snapshotPublicationVersion: 2 }).success).toBe(false);
    expect(telegramArchiveEntrySchema.safeParse({ ...value, retiredOperation: { ...value.retiredOperation, scope: { ...value.retiredOperation!.scope, agentId: 'other' } } }).success).toBe(false);
    expect(telegramArchiveEntrySchema.safeParse({ ...value, retiredOperation: { ...value.retiredOperation, payload: 'forbidden' } }).success).toBe(false);
    const overlapping = row(); overlapping.state!.operation = checkpoint('unknown');
    expect(telegramArchiveEntrySchema.safeParse({ ...overlapping, snapshotPublicationVersion: 1, retiredOperation: value.retiredOperation }).success).toBe(false);
  });

  it('rollback refuses a retired uncertain effect or prepared publication', () => {
    const value = row(); value.state!.operation = checkpoint('unknown'); resetTelegramArchives({ telegramArchives: [value] }, 100);
    expect(() => stripTelegramArchiveForRollback({ accountId: 'telegram-account:42', telegramArchives: [value] }, 'telegram-account:42')).toThrow('pending_work');
    const prepared = row(); prepared.state!.pending = []; prepared.state!.publication = publication('prepared'); prepared.snapshotPublicationVersion = 1;
    expect(() => stripTelegramArchiveForRollback({ accountId: 'telegram-account:42', telegramArchives: [prepared] }, 'telegram-account:42')).toThrow('pending_work');
  });
});
