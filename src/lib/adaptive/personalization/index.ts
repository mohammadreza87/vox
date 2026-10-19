import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const scopeId = z.string().regex(/^[A-Za-z0-9_:-]{1,200}$/);
const time = z.number().int().nonnegative().safe();
export const preferenceValueSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('response_length'), value: z.enum(['brief', 'balanced', 'detailed']) }).strict(),
  z.object({ key: z.literal('language'), value: z.enum(['auto', 'en', 'fa']) }).strict(),
  z.object({ key: z.literal('formatting'), value: z.enum(['plain', 'structured']) }).strict(),
]);
export type PreferenceValue = z.infer<typeof preferenceValueSchema>;
export type PreferenceKey = PreferenceValue['key'];
const record = z.object({
  schemaVersion: z.literal(1), id, revision: z.number().int().positive(), tenantId: scopeId, spaceId: scopeId,
  containerId: scopeId, personId: scopeId, agentId: id, createdAt: time, updatedAt: time,
  origin: z.enum(['explicit', 'hypothesis']), status: z.enum(['active', 'reset']),
  setting: preferenceValueSchema, expiresAt: time.optional(), evidenceEventIds: z.array(id).max(16),
}).strict().refine(p => p.updatedAt >= p.createdAt)
  .refine(p => p.origin !== 'hypothesis' || (p.expiresAt !== undefined && p.expiresAt > p.createdAt && p.expiresAt - p.createdAt <= 7 * 86_400_000 && p.evidenceEventIds.length > 0 && p.status === 'active'));
export type PreferenceRecord = z.infer<typeof record>;
export interface PreferenceScope {
  readonly tenantId: string; readonly spaceId: string; readonly containerId: string;
  readonly personId: string; readonly agentId: string;
}
export interface ResolvedPreference {
  readonly setting: PreferenceValue;
  readonly source: 'default' | 'explicit' | 'hypothesis' | 'reset';
  readonly recordId?: string;
  readonly revision?: number;
  readonly expiresAt?: number;
}
const defaults: Record<PreferenceKey, PreferenceValue> = {
  response_length: { key: 'response_length', value: 'balanced' },
  language: { key: 'language', value: 'auto' },
  formatting: { key: 'formatting', value: 'plain' },
};

/** Only approved, low-risk configuration; no inferred identity, emotion, health,
 * accessibility setting, permission, audience or arbitrary generated UI/code. */
export async function resolvePreferences(inputs: readonly unknown[], scope: PreferenceScope, now: number,
  /** Rechecks current verified person, exact scope, consent and source/tombstones. */
  authorize: (preference: PreferenceRecord) => Promise<boolean>): Promise<ResolvedPreference[]> {
  if (!Number.isSafeInteger(now) || now < 0) return (Object.keys(defaults) as PreferenceKey[]).map(key => ({ setting: defaults[key], source: 'default' }));
  const permitted: PreferenceRecord[] = [];
  for (const input of inputs) {
    const parsed = record.safeParse(input);
    if (!parsed.success) continue;
    const preference = parsed.data;
    if (preference.createdAt > now || preference.updatedAt > now ||
        (preference.expiresAt !== undefined && preference.expiresAt <= now) ||
        preference.tenantId !== scope.tenantId || preference.spaceId !== scope.spaceId ||
        preference.containerId !== scope.containerId || preference.personId !== scope.personId || preference.agentId !== scope.agentId ||
        !await authorize(preference)) continue;
    permitted.push(preference);
  }
  return (Object.keys(defaults) as PreferenceKey[]).map(key => {
    const options = permitted.filter(p => p.setting.key === key);
    const sorted = (items: PreferenceRecord[]) => items.sort((a, b) => b.updatedAt - a.updatedAt || b.revision - a.revision || a.id.localeCompare(b.id));
    // Any current explicit choice/reset outranks every unconfirmed inference.
    const selected = sorted(options.filter(p => p.origin === 'explicit'))[0] ?? sorted(options.filter(p => p.origin === 'hypothesis'))[0];
    if (!selected) return { setting: defaults[key], source: 'default' };
    return { setting: selected.status === 'reset' ? defaults[key] : selected.setting,
      source: selected.status === 'reset' ? 'reset' : selected.origin, recordId: selected.id,
      revision: selected.revision, ...(selected.expiresAt === undefined ? {} : { expiresAt: selected.expiresAt }) };
  });
}
export const preferenceRecordSchema = record;
