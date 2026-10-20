import { afterEach, expect, it } from 'vitest';
import { accountIdFor } from '../persistence/repository';
import type { AccountLedger } from './contracts';
import { rightsFixture, syntheticRightsPolicy } from './fixtures';
import { RIGHTS_COPY_VERSION } from './notice';
import { parseRightsPolicy } from './policy';

// Exact JSON-serialized notice hashes from base 6fbbb9c, before the v2 correction.
const v1Hashes = {
  en: '0e986b5b7860011904ac969c366c2d0a962d476c6b7e2956ff7c8246cf276e31',
  fa: '5a8fb8e055c5e1c313188e48e74b80ae08062df29804fce43e06c9121b050669',
};
const fixtures: Awaited<ReturnType<typeof rightsFixture>>[] = [];
const setup = async () => { const fixture = await rightsFixture(); fixtures.push(fixture); return fixture; };
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.close())); });

it.each(['v1', 'v1-new-hashes', 'old-en', 'old-fa'] as const)('rejects %s policy instead of silently upgrading its reviewed notice', async scenario => {
  const fixture = await setup(), policy = syntheticRightsPolicy();
  if (scenario === 'v1' || scenario === 'v1-new-hashes') policy.copyVersion = 'rights-intake-ri2-v1';
  if (scenario === 'v1') policy.noticeHashes = { ...v1Hashes };
  if (scenario === 'old-en') policy.noticeHashes.en = v1Hashes.en;
  if (scenario === 'old-fa') policy.noticeHashes.fa = v1Hashes.fa;
  const supplied = JSON.stringify(policy);
  expect(parseRightsPolicy(supplied)).toBeUndefined();
  fixture.setPolicy(policy);
  expect(fixture.service.snapshot(101, 'work')).toMatchObject({ available: false, policyStatus: 'unavailable', supportedKinds: [] });
  await expect(fixture.service.create(101, fixture.input())).rejects.toMatchObject({ status: 503 });
  expect(fixture.repository.read(accountIdFor(101))).toBeNull();
  expect(JSON.stringify(policy)).toBe(supplied);
});

it('accepts a synthetic v2 policy only with the current version and both new locale hashes', async () => {
  const fixture = await setup(), policy = syntheticRightsPolicy();
  expect(RIGHTS_COPY_VERSION).toBe('rights-intake-ri2-v2');
  expect(policy.noticeHashes.en).not.toBe(v1Hashes.en);
  expect(policy.noticeHashes.fa).not.toBe(v1Hashes.fa);
  expect(parseRightsPolicy(JSON.stringify(policy))).toEqual(policy);
  expect(fixture.service.snapshot(101, 'work')).toMatchObject({ available: true, intakePolicy: { copyVersion: RIGHTS_COPY_VERSION } });
  expect((await fixture.service.create(101, fixture.input())).request.intakePolicy.copyVersion).toBe(RIGHTS_COPY_VERSION);
});

it('leaves unconfigured intake unavailable without allocating a request', async () => {
  const fixture = await setup(); fixture.setPolicy(undefined);
  expect(parseRightsPolicy(undefined)).toBeUndefined();
  expect(fixture.service.snapshot(101, 'work')).toMatchObject({ available: false, policyStatus: 'unavailable', supportedKinds: [] });
  await expect(fixture.service.create(101, fixture.input())).rejects.toMatchObject({ status: 503 });
  expect(fixture.repository.read(accountIdFor(101))).toBeNull();
});

it('preserves a historical v1 request binding through current-policy reads and exact replay', async () => {
  const fixture = await setup(), input = fixture.input();
  const created = await fixture.service.create(101, input), account = accountIdFor(101);
  // Seed a historical record explicitly; v1 is never admitted as a current policy.
  await fixture.storage.transact(account, raw => {
    const document = structuredClone(raw) as AccountLedger;
    document.requests[0].intakePolicy.copyVersion = 'rights-intake-ri2-v1';
    return { document, result: undefined };
  });
  const before = fixture.repository.read(account);
  expect(fixture.service.snapshot(101, 'work')).toMatchObject({ available: true, intakePolicy: { copyVersion: RIGHTS_COPY_VERSION }, requests: [{ intakePolicy: { copyVersion: 'rights-intake-ri2-v1' } }] });
  expect(fixture.service.detail(101, 'work', created.request.requestId).request.intakePolicy.copyVersion).toBe('rights-intake-ri2-v1');
  expect(await fixture.service.create(101, input)).toMatchObject({ replayed: true, request: { intakePolicy: { copyVersion: 'rights-intake-ri2-v1' } } });
  expect(fixture.repository.read(account)).toEqual(before);
});
