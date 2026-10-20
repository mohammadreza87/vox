/** Server-owned reviewed manifest. No approvals or jurisdiction are inferred from a toggle. */
import { z } from 'zod';
import { CAPABILITIES } from '../eligibility';
import { validId, validTime } from '../identity';
import type { AdaptiveServiceOptions } from './service';
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(200);
const approval = z.object({ schemaVersion: z.literal(1), id, revision: time.min(1), createdAt: time, updatedAt: time,
  jurisdiction: id, capability: z.enum(CAPABILITIES), state: z.enum(['blocked', 'review_pending', 'approved']),
  configurationVersion: id, effectiveAt: time, reviewExpiresAt: time, owner: id, approvalReference: id,
}).strict();
export const INTERNAL_PILOT_CAPABILITIES = ['core_text', 'product_analytics', 'personalization', 'auto_memory',
  'reminder_delivery', 'proactive_suggestions', 'relationship_outreach'] as const;
const DAY = 24 * 60 * 60 * 1000;
const pilotSchema = z.object({
  schemaVersion: z.literal(2), basis: z.literal('internal_company_pilot'), configurationVersion: id.refine(validId),
  enabledCapabilities: z.array(z.enum(INTERNAL_PILOT_CAPABILITIES)).min(1).max(INTERNAL_PILOT_CAPABILITIES.length),
  accounts: z.array(z.object({ accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/)
    .refine(account => Number.isSafeInteger(Number(account.slice('telegram-account:'.length)))) }).strict()).min(1).max(20),
  review: z.object({ id, revision: time.min(1), owner: id, reviewReference: id,
    effectiveAt: time, reviewExpiresAt: time,
  }).strict().refine(review => [review.id, review.owner, review.reviewReference].every(validId) && review.reviewExpiresAt > review.effectiveAt && review.reviewExpiresAt - review.effectiveAt <= 90 * DAY),
}).strict();
export interface InternalPilotAuthority {
  /** Synchronous committed current membership. Missing, busy or unavailable denies.
   * The authority version must change when current membership/role is changed. */
  currentInternalMember?: (accountId: string) => { allowed: boolean; authorityVersion: string } | undefined;
}

function internalPilotOptions(raw: unknown, authority: InternalPilotAuthority): AdaptiveServiceOptions {
  const manifest = pilotSchema.parse(raw);
  if (new Set(manifest.accounts.map(account => account.accountId)).size !== manifest.accounts.length ||
      new Set(manifest.enabledCapabilities).size !== manifest.enabledCapabilities.length) throw new Error('Duplicate adaptive manifest entries');
  return {
    inboxEnabled: manifest.enabledCapabilities.some(capability => capability === 'proactive_suggestions' || capability === 'reminder_delivery'),
    internalPilotPolicy: (context, now) => {
      const result = (decision: import('../eligibility').CapabilityDecision) => ({
        basis: 'internal_company_pilot' as const, accountId: context.accountId, personId: context.personId, capability: context.capability, decision,
      });
      if (!manifest.accounts.some(account => account.accountId === context.accountId) ||
          !manifest.enabledCapabilities.some(capability => capability === context.capability)) return result({ eligible: false, reason: 'disabled' });
      let membership;
      try { membership = authority.currentInternalMember?.(context.accountId); } catch { /* fail closed */ }
      if (membership?.allowed !== true || typeof membership.authorityVersion !== 'string' || !validId(membership.authorityVersion) || membership.authorityVersion.length > 200) {
        return result({ eligible: false, reason: 'approval_missing' });
      }
      if (!validTime(now) || now < manifest.review.effectiveAt || now >= manifest.review.reviewExpiresAt) return result({ eligible: false, reason: 'approval_invalid' });
      const declaration = context.declaration;
      const adultExpiresAt = declaration ? declaration.declaredAt + 365 * DAY : now;
      if (!validId(context.personId) || declaration?.adultConfirmed !== true || !validTime(declaration.declaredAt) || declaration.declaredAt > now ||
          !validTime(adultExpiresAt) || adultExpiresAt <= now) return result({ eligible: false, reason: 'adult_required' });
      return result({ eligible: true, validUntil: Math.min(adultExpiresAt, manifest.review.reviewExpiresAt),
        approvalVersions: [JSON.stringify(['internal_company_pilot', manifest.review.id, manifest.review.revision,
          manifest.configurationVersion, context.accountId, membership.authorityVersion, manifest.review.owner,
          manifest.review.reviewReference, manifest.review.effectiveAt, manifest.review.reviewExpiresAt])],
      });
    },
  };
}
const schema = z.object({ schemaVersion: z.literal(1), configurationVersion: id,
  enabledCapabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length), approvals: z.array(approval).max(200),
  // Each account's applicable keys are explicitly resolved by the release owner.
  accounts: z.array(z.object({ accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/),
    jurisdictionKeys: z.array(id).min(1).max(20), allowDeclaredAdult: z.boolean(),
  }).strict()).max(1000),
}).strict();
/** Invalid supplied configuration fails startup, instead of silently turning features on.
 * The manifest is a configuration input; this parser does not establish legal approval. */
export function adaptiveOptionsFromManifest(raw: string | undefined, authority: InternalPilotAuthority = {}): AdaptiveServiceOptions {
  if (!raw?.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && parsed.schemaVersion === 2) return internalPilotOptions(parsed, authority);
  const manifest = schema.parse(parsed);
  if (new Set(manifest.accounts.map(a => a.accountId)).size !== manifest.accounts.length ||
      new Set(manifest.enabledCapabilities).size !== manifest.enabledCapabilities.length ||
      manifest.accounts.some(a => new Set(a.jurisdictionKeys).size !== a.jurisdictionKeys.length)) throw new Error('Duplicate adaptive manifest entries');
  return { inboxEnabled: manifest.enabledCapabilities.some(c => c === 'proactive_suggestions' || c === 'reminder_delivery'), capabilityPolicy: (context, now) => {
    const account = manifest.accounts.find(a => a.accountId === context.accountId);
    if (!account) return;
    const declaration = context.declaration;
    return { request: { capability: context.capability, personId: context.personId,
      configurationVersion: manifest.configurationVersion, enabled: manifest.enabledCapabilities.includes(context.capability),
      jurisdiction: { status: 'known', requiredKeys: account.jurisdictionKeys },
      adultEntry: { personId: context.personId,
        state: account.allowDeclaredAdult && declaration?.adultConfirmed === true ? 'adult_confirmed' : 'unknown',
        method: 'explicit_declaration', effectiveAt: declaration?.declaredAt ?? now,
        expiresAt: declaration ? declaration.declaredAt + 365 * 24 * 60 * 60 * 1000 : now, revision: 1 },
    }, approvals: manifest.approvals };
  } };
}
