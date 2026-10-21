import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { AdaptiveError } from '../persistence/service';
import type { AdaptiveStorage } from '../persistence/storage';
import type { VoiceScope } from './contracts';
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(200);
const cipherSchema = z.object({ keyId: id, iv: z.string().max(64), tag: z.string().max(64), bytes: z.string().max(100_000) }).strict();
export type EncryptedVoiceTemplate = z.infer<typeof cipherSchema>;
const rowSchema = z.object({ space: z.enum(['work', 'personal']), deviceId: z.string().uuid(), personId: id,
  revision: time, epoch: time, intent: z.enum(['not_asked', 'accepted', 'revoked', 'expired']), authority: id.optional(),
  intentExpiresAt: time.optional(), noticeVersion: id.optional(),
  receipt: z.object({ id: z.string().uuid(), expiresAt: time, copyHash: id, locale: z.enum(['en', 'fa']), authority: id }).strict().optional(),
  evidence: z.object({ copyHash: id, locale: z.enum(['en', 'fa']), decidedAt: time, statement: z.literal('enroll_my_voice') }).strict().optional(),
  capture: z.object({ id: z.string().uuid(), mode: z.enum(['enroll', 'test']), challenge: id, expiresAt: time, epoch: time, authority: id }).strict().optional(),
  template: cipherSchema.optional(), providerId: id.optional(), providerVersion: id.optional(), templateExpiresAt: time.optional(), templateEpoch: time.optional(),
  deletion: z.enum(['not_required', 'online_completed', 'provider_pending']), lastPurgeAt: time.optional(),
}).strict();
export type VoiceIdentityRow = z.infer<typeof rowSchema>;
const schema = z.object({ schemaVersion: z.literal(1), accountId: id, rows: z.array(rowSchema).max(20) }).strict();
export class VoiceIdentityRepository {
  constructor(readonly storage: AdaptiveStorage) {}
  all<T>(accountId: string, personId: string, fn: (rows: VoiceIdentityRow[]) => T, beforeCommit?: () => void): Promise<T> {
    if (!/^telegram-account:[1-9]\d{0,15}$/.test(accountId) || !personId) throw new Error('Invalid voice scope');
    return this.storage.transact(accountId, raw => {
      const document = raw === null ? { schemaVersion: 1 as const, accountId, rows: [] as VoiceIdentityRow[] } : schema.parse(raw);
      if (document.accountId !== accountId || new Set(document.rows.map(r => JSON.stringify([r.space, r.deviceId]))).size !== document.rows.length || document.rows.some(r => r.personId !== personId)) throw new Error('Invalid voice partition');
      const result = fn(document.rows); schema.parse(document);
      return { document, result };
    }, beforeCommit);
  }
  transaction<T>(accountId: string, personId: string, scope: VoiceScope, fn: (row: VoiceIdentityRow) => T, allocate = true, beforeCommit?: () => void): Promise<T> {
    return this.all(accountId, personId, rows => {
      let row = rows.find(r => r.space === scope.space && r.deviceId === scope.deviceId);
      if (!row) {
        row = { ...scope, personId, revision: 0, epoch: 0, intent: 'not_asked', deletion: 'not_required' };
        if (allocate) {
          if (rows.length >= 20) {
            // Earlier status reads created empty device rows. Reclaim only those
            // untouched placeholders, never enrollment evidence, revocation
            // epochs, accepted intent, captures, ciphertext or pending purge.
            const unused = rows.findIndex(r => r.intent === 'not_asked' && r.epoch === 0 && r.revision === 0 &&
              r.deletion === 'not_required' && !r.evidence && !r.receipt && !r.capture && !r.template && r.lastPurgeAt === undefined);
            if (unused < 0) throw new AdaptiveError(409, 'storage_capacity');
            rows.splice(unused, 1);
          }
          rows.push(row);
        }
      }
      return fn(row);
    }, beforeCommit);
  }
  /** Inspect/update an existing scope without allocating a device placeholder.
   * An absent row is an ephemeral empty projection and is never persisted. */
  existing<T>(accountId: string, personId: string, scope: VoiceScope, fn: (row: VoiceIdentityRow) => T, beforeCommit?: () => void): Promise<T> {
    return this.transaction(accountId, personId, scope, fn, false, beforeCommit);
  }
  /** Final effect fence: no asynchronous gap and no enrollment-row allocation. */
  currentForEffect(accountId: string, personId: string, scope: VoiceScope): VoiceIdentityRow | undefined {
    const current = this.storage.readCommittedForEffect?.(accountId);
    if (!current || current.status !== 'ready') throw new AdaptiveError(503, 'voice_authority_unavailable');
    if (current.document === null) return;
    const document = schema.parse(current.document);
    if (document.accountId !== accountId || document.rows.some(row => row.personId !== personId) ||
        new Set(document.rows.map(row => JSON.stringify([row.space, row.deviceId]))).size !== document.rows.length) {
      throw new AdaptiveError(503, 'voice_authority_unavailable');
    }
    return structuredClone(document.rows.find(row => row.space === scope.space && row.deviceId === scope.deviceId));
  }
}
/** Separate encryption key supplied by reviewed runtime key management. It is
 * never derived from a bot token, account ID or provider credentials. */
export class VoiceTemplateCipher {
  constructor(readonly keyId: string, private readonly key: Uint8Array) {
    if (!keyId || key.byteLength !== 32) throw new Error('Voice encryption requires a 256-bit key');
  }
  private aad(scope: { accountId: string; personId: string; space: string; deviceId: string; epoch: number }): Buffer {
    return Buffer.from(JSON.stringify([scope.accountId, scope.personId, scope.space, scope.deviceId, 'optional.biometric_recognition', scope.epoch]));
  }
  encrypt(bytes: Uint8Array, scope: Parameters<VoiceTemplateCipher['aad']>[0]): EncryptedVoiceTemplate {
    if (!bytes.byteLength || bytes.byteLength > 65_536) throw new Error('Invalid voice template');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(scope));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return { keyId: this.keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), bytes: encrypted.toString('base64') };
  }
  decrypt(value: EncryptedVoiceTemplate, scope: Parameters<VoiceTemplateCipher['aad']>[0]): Uint8Array {
    if (value.keyId !== this.keyId) throw new Error('Voice encryption key unavailable');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
    cipher.setAAD(this.aad(scope)); cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(value.bytes, 'base64')), cipher.final()]);
  }
}
export const voiceDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
