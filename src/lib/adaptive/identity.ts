import { ADAPTIVE_SCHEMA_VERSION, type Account, type IdentityContext, type PersonAccountBinding } from './types';

export function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

export function validEpoch(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validId(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validRecord(record: { schemaVersion: number; id: string; revision: number; createdAt: number; updatedAt: number }, now: number): boolean {
  return record.schemaVersion === ADAPTIVE_SCHEMA_VERSION && validId(record.id) &&
    validRevision(record.revision) && validTime(record.createdAt) && validTime(record.updatedAt) &&
    record.createdAt <= record.updatedAt && record.updatedAt <= now;
}

/** Verification is a trusted server input, not something this pure module performs. */
export function resolveVerifiedPerson(
  identity: IdentityContext, account: Account, binding: PersonAccountBinding | undefined, now: number,
): string | undefined {
  const selected = identity.selectedPerson;
  if (!validTime(now) || !selected || !binding || !validRecord(account, now) || !validRecord(binding, now)) return;
  if (account.status !== 'active' || account.id !== identity.authenticatedAccountId ||
      binding.status !== 'verified' || binding.accountId !== account.id ||
      binding.id !== selected.bindingId || binding.personId !== selected.personId ||
      binding.revision !== selected.bindingRevision || !validId(binding.personId) ||
      !['account_confirmation', 'authenticated_person_confirmation'].includes(binding.method) ||
      (binding.method === 'account_confirmation' && binding.personId !== account.ownerPersonId) ||
      !validTime(binding.verifiedAt) || binding.verifiedAt > now ||
      !validTime(binding.expiresAt) || binding.expiresAt <= now) return;
  return binding.personId;
}
