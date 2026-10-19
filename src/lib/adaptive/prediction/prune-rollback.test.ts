import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyExperience } from '../runtime/contracts';
import { pruneFilePredictionMetadata, stripPredictionMetadataForRollback } from './prune-rollback';
const accountId = 'telegram-account:123';
const fixture = () => ({ accountId, revision: 42, memories: [{ text: 'PRIVATE_CANARY', status: 'active' }], experience: { ...emptyExperience(),
  predictionTurns: [{ agentId: 'agent', space: 'work', sessionId: 'session', turnId: 'turn', revision: 3, evaluations: 2, inFlightUntil: 0, expiresAt: 10000,
    cancelled: true, reservation: 'reservation', policyReceipt: 'receipt', contextKey: 'audience', authorizationFingerprint: 'fingerprint', requiresImage: true, receiptExpiresAt: 9000, superseded: true }] } });
describe('scoped prediction rollback utility', () => {
  it('removes only new metadata, preserving original turn budgets and all other semantic data', () => {
    const before = fixture(), result = stripPredictionMetadataForRollback(before, accountId);
    expect(result.properties).toBe(8); expect(result.records).toBe(1);
    expect(result.document).toEqual({ ...before, experience: { ...before.experience, predictionTurns: [{ agentId: 'agent', space: 'work', sessionId: 'session', turnId: 'turn', revision: 3, evaluations: 2, inFlightUntil: 0, expiresAt: 10000 }] } });
    expect(before.experience.predictionTurns[0].cancelled).toBe(true);
    expect(() => stripPredictionMetadataForRollback(before, 'telegram-account:124')).toThrow('rollback_scope_mismatch');
  });
  it('dry-run makes no write; apply requires stopped providers and current CAS, then uses storage lock/atomic write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-rollback-')), filename = join(directory, createHash('sha256').update(accountId).digest('hex') + '.json');
    const bytes = JSON.stringify(fixture()); await writeFile(filename, bytes, { mode: 0o600 });
    try {
      const preview = await pruneFilePredictionMetadata({ directory, accountId });
      expect(await readFile(filename, 'utf8')).toBe(bytes); expect(preview).toMatchObject({ mode: 'dry-run', properties: 8 });
      await expect(pruneFilePredictionMetadata({ directory, accountId, apply: true, expectedContentSha256: preview.contentSha256 })).rejects.toThrow();
      await expect(pruneFilePredictionMetadata({ directory, accountId, apply: true, providersStopped: true, expectedContentSha256: '0'.repeat(64) })).rejects.toThrow('rollback_document_changed');
      const applied = await pruneFilePredictionMetadata({ directory, accountId, apply: true, providersStopped: true, expectedContentSha256: preview.contentSha256 });
      expect(applied).toMatchObject({ mode: 'applied', properties: 8 });
      const after = JSON.parse(await readFile(filename, 'utf8')); expect(after.memories).toEqual(fixture().memories); expect(after.experience.predictionTurns[0].evaluations).toBe(2); expect(after.experience.predictionTurns[0].cancelled).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
