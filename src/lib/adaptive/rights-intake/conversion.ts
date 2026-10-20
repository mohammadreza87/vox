/** Explicit local administration only. These callbacks are trusted operator
 * attestations, not an authentication scheme or a public account API. */
import { rightsPolicySchema } from './policy';
import { requestSchema } from './contracts';
import { localUseDigest } from './local-use-state';
import { fail, type RightsRepository } from './repository';
export async function prepareRightsLocalUseLedger(input: {
  repository: RightsRepository; accountId: string; policy: () => unknown; clock: () => number;
  assertLocalAdministrationNow: () => void; assertQuiescedNow: () => void;
}): Promise<void> {
  requestSchema.shape.accountId.parse(input.accountId);
  input.assertLocalAdministrationNow(); input.assertQuiescedNow();
  const existing = input.repository.read(input.accountId);
  if (!existing) return fail(409,'rights_conversion_not_eligible');
  const inspect = () => {
    input.assertLocalAdministrationNow(); input.assertQuiescedNow();
    if (input.repository.storage.supportsCommittedWriteFence !== true) return fail(503,'rights_conversion_unavailable');
    const now = input.clock(), parsed = rightsPolicySchema.safeParse(input.policy());
    if (!Number.isSafeInteger(now) || now < existing.observedServerTime || !parsed.success || (parsed.data.version !== 2 && parsed.data.version !== 3) || !parsed.data.localFulfillment.ledgerConversion || parsed.data.effectiveAt > now || parsed.data.expiresAt <= now) return fail(503,'reviewed_policy_unavailable');
    input.repository.observeTime(now); return {now,digest:localUseDigest(parsed.data)};
  };
  const initial = inspect();
  await input.repository.migrateToV3(input.accountId, () => inspect().now, () => {
    const current = inspect(); if (current.digest !== initial.digest) return fail(409,'rights_conflict');
  });
  if (inspect().digest !== initial.digest) return fail(409,'rights_conflict');
}

export async function prepareRightsLocalErasureLedger(input:{repository:RightsRepository;accountId:string;policy:()=>unknown;clock:()=>number;assertLocalAdministrationNow:()=>void;assertQuiescedNow:()=>void}):Promise<void> {
  requestSchema.shape.accountId.parse(input.accountId);input.assertLocalAdministrationNow();input.assertQuiescedNow();
  const existing=input.repository.read(input.accountId);if(!existing || existing.version===2)return fail(409,'rights_conversion_not_eligible');
  const inspect=()=>{input.assertLocalAdministrationNow();input.assertQuiescedNow();const p=rightsPolicySchema.safeParse(input.policy()),now=input.clock();
    if(input.repository.storage.supportsCommittedWriteFence!==true || !Number.isSafeInteger(now) || now<existing.observedServerTime || !p.success || p.data.version!==3 || p.data.effectiveAt>now || p.data.expiresAt<=now)return fail(503,'reviewed_policy_unavailable');
    input.repository.observeTime(now);return {now,digest:localUseDigest(p.data)};};
  const initial=inspect();await input.repository.migrateToV4(input.accountId,()=>inspect().now,()=>{if(inspect().digest!==initial.digest)return fail(409,'rights_conflict');});
  if(inspect().digest!==initial.digest)return fail(409,'rights_conflict');
}
