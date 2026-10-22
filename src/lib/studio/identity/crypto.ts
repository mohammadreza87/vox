/**
 * AES-256-GCM sealing for S11L voiceprint templates. node:crypto only; no I/O
 * and no logging.
 *
 * KEY DESIGN IS A RELEASE GATE. VOICEPRINT_KEY is a dedicated 256-bit key from
 * the server environment. It is never STUDIO_SECRET and never derived from it
 * (parseVoiceprintKey refuses reuse; STUDIO_SECRET is read only for that check).
 * It is a development and pilot key only:
 *   - Production Firebase requires Cloud KMS envelope encryption (a KMS-wrapped
 *     data key for the 'vox_voiceprints' collection) before
 *     STUDIO_VOICE_RECOGNITION is enabled. A key from env stored beside the
 *     Firestore ciphertext is not acceptable there.
 *   - The Mac file profile has no KMS: its key custody, rotation and backup
 *     design (backups must exclude or re-encrypt voiceprints-v1.json) is an open
 *     release gate.
 * Rotating the key makes every template unreadable (verification returns
 * provider_error) and requires re-enrollment. See
 * docs/implementation/VOICE_PROVIDER_INTEGRATION.md.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { VoiceSpace } from './store';

export interface VoiceprintAad {
  personId: string;
  space: VoiceSpace;
  provider: string;
  modelVersion: string;
  consentEventId: string;
}

const VERSION = 'vp1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TEMPLATE_BYTES = 65_536;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && timingSafeEqual(a, b);

/**
 * VOICEPRINT_KEY: base64 of exactly 32 bytes. Null when unset or blank. Throws
 * when the size is wrong or the key reuses STUDIO_SECRET (its UTF-8 bytes, its
 * sha256 as src/lib/studio/crypto.ts derives it, or the same string).
 */
export function parseVoiceprintKey(raw: string | undefined, studioSecret?: string): Uint8Array | null {
  if (raw === undefined || !raw.trim()) return null;
  const trimmed = raw.trim();
  const reuse = () => new Error('VOICEPRINT_KEY must not reuse STUDIO_SECRET');
  if (studioSecret && trimmed === studioSecret) throw reuse();
  const decoded = Buffer.from(trimmed, 'base64');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || decoded.byteLength !== 32) throw new Error('VOICEPRINT_KEY must be base64 of 32 bytes');
  if (studioSecret) {
    if (sameBytes(decoded, Buffer.from(studioSecret)) || sameBytes(decoded, createHash('sha256').update(studioSecret).digest())) throw reuse();
  }
  const key = new Uint8Array(32);
  key.set(decoded);
  decoded.fill(0);
  return key;
}

const aadBytes = (aad: VoiceprintAad): Buffer =>
  Buffer.from(JSON.stringify(['vox_voiceprints', aad.personId, aad.space, aad.provider, aad.modelVersion, aad.consentEventId]), 'utf8');

/** Sealed format: `vp1.<keyId>.<iv b64>.<tag b64>.<ct b64>`. */
export class VoiceprintCipher {
  readonly keyId: string;
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (!ArrayBuffer.isView(key) || key.byteLength !== 32) throw new Error('VOICEPRINT_KEY must be base64 of 32 bytes');
    this.key = Buffer.from(key);
    this.keyId = createHash('sha256').update('vox-voiceprint-key').update(this.key).digest('hex').slice(0, 16);
  }

  seal(template: Uint8Array, aad: VoiceprintAad): string {
    if (!ArrayBuffer.isView(template) || template.byteLength < 1 || template.byteLength > MAX_TEMPLATE_BYTES) throw new Error('voiceprint_template_size');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aadBytes(aad));
    const ct = Buffer.concat([cipher.update(template), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, this.keyId, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
  }

  /** Throws on a version, keyId, tag or AAD mismatch. The caller zero-fills the result after use. */
  open(sealed: string, aad: VoiceprintAad): Uint8Array {
    const parts = typeof sealed === 'string' ? sealed.split('.') : [];
    if (parts.length !== 5 || parts[0] !== VERSION) throw new Error('voiceprint_version');
    if (parts[1] !== this.keyId) throw new Error('voiceprint_key');
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const ct = Buffer.from(parts[4], 'base64');
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES || ct.byteLength < 1 || ct.byteLength > MAX_TEMPLATE_BYTES) throw new Error('voiceprint_format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadBytes(aad));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    const out = new Uint8Array(plain.byteLength);
    out.set(plain);
    plain.fill(0);
    return out;
  }
}
