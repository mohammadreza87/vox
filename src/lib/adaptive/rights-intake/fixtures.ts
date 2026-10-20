/** Synthetic fixtures only; not a reviewed activation policy. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RightsFileStorage } from './storage';
import { RightsRepository, fail } from './repository';
import { RightsIntakeService } from './service';
import type { RightsPolicy } from './policy';
import { rightsCopy, RIGHTS_COPY_VERSION } from './notice';
export const NOW = Date.UTC(2026, 9, 20, 12);
export function syntheticRightsPolicy(): RightsPolicy {
  return { version: 1, id: 'synthetic-only-ri1', revision: 1, effectiveAt: NOW, expiresAt: NOW + 100_000_000,
    reviewOwner: 'synthetic', reviewReference: 'not-production-approval', topology: 'single_persistent_process', assurance: 'signed_telegram_account',
    supportedKinds: ['access_export','correction','erasure','restriction','objection','portability','withdrawal'], privacyOperatorIds: [999], copyVersion: RIGHTS_COPY_VERSION,
    noticeHashes: { en: createHash('sha256').update(JSON.stringify(rightsCopy.en)).digest('hex'), fa: createHash('sha256').update(JSON.stringify(rightsCopy.fa)).digest('hex') },
    retention: { requestReviewAfterMs: 10_000_000, auditRetentionMs: 10_000_000, receiptRetentionMs: 100_000 }, handleLifetimeMs: 10_000, deadlineRules: [] };
}
export async function rightsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vox-ri1-'));
  let now = NOW, policy: unknown = syntheticRightsPolicy(), accountAllowed = true, operatorAllowed = true;
  const storage = new RightsFileStorage(directory), repository = new RightsRepository(storage);
  const options = { key: Buffer.alloc(32, 1), policy: () => policy, clock: () => now,
    assertAccountNow: () => { if (!accountAllowed) fail(403, 'account_intake_unavailable'); },
    assertOperatorNow: () => { if (!operatorAllowed) fail(403, 'privacy_operator_required'); } };
  const service = new RightsIntakeService(repository, options);
  const input = (kind: 'access_export' | 'erasure' = 'access_export') => ({ version: 1 as const, eventId: randomUUID(), space: 'work' as const, kind, locale: 'en' as const, expectedIntakePolicyRevision: 1 });
  return { directory, storage, repository, service, options, input, setNow: (value: number) => { now = value; }, setPolicy: (value: unknown) => { policy = value; }, denyAccount: () => { accountAllowed = false; }, denyOperator: () => { operatorAllowed = false; }, close: () => rm(directory, { recursive: true, force: true }) };
}
