/** Server-owned reviewed manifest. No approvals or jurisdiction are inferred from a toggle. */
import { z } from 'zod';
import { CAPABILITIES } from '../eligibility';
import type { AdaptiveServiceOptions } from './service';
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(200);
const approval = z.object({ schemaVersion: z.literal(1), id, revision: time.min(1), createdAt: time, updatedAt: time,
  jurisdiction: id, capability: z.enum(CAPABILITIES), state: z.enum(['blocked', 'review_pending', 'approved']),
  configurationVersion: id, effectiveAt: time, reviewExpiresAt: time, owner: id, approvalReference: id,
}).strict();
const schema = z.object({ schemaVersion: z.literal(1), configurationVersion: id,
  enabledCapabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length), approvals: z.array(approval).max(200),
  // Each account's applicable keys are explicitly resolved by the release owner.
  accounts: z.array(z.object({ accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/),
    jurisdictionKeys: z.array(id).min(1).max(20), allowDeclaredAdult: z.boolean(),
  }).strict()).max(1000),
}).strict();
/** Invalid supplied configuration fails startup, instead of silently turning features on.
 * The manifest is a configuration input; this parser does not establish legal approval. */
export function adaptiveOptionsFromManifest(raw: string | undefined): AdaptiveServiceOptions {
  if (!raw?.trim()) return {};
  const manifest = schema.parse(JSON.parse(raw));
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
