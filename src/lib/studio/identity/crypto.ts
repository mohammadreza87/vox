/**
 * AES-256-GCM sealing for voiceprint templates (S11L). node:crypto only: no
 * I/O and no logging.
 *
 * INTERIM KEY DESIGN. VOICEPRINT_KEY is a dedicated 256-bit key held in the
 * server environment; it is never STUDIO_SECRET or derived from it. This is
 * not the key-management design that docs/AGENT_INTELLIGENCE_SOLUTION.md
 * section 4.9 requires:
 *   - On Firebase, Cloud KMS envelope encryption (a data key per row wrapped
 *     by a KMS key) is required and is a release gate. Runtime refuses
 *     STUDIO_VOICE_RECOGNITION=1 on Firestore in production until it exists.
 *   - On the Mac file profile, a written key and backup scheme (where the key
 *     lives, rotation by keyId, backups that exclude or re-encrypt the store)
 *     is a release gate.
 * Neither gate is satisfied by this code. See
 * docs/implementation/VOICE_PROVIDER_INTEGRATION.md.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface VoiceprintCipher {
  readonly keyId: string;
  seal(plain: Uint8Array, aad: readonly string[]): string;
  open(sealed: string, aad: readonly string[]): Uint8Array;
}

const PREFIX = 'vpk1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 65_536;

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const aadBytes = (aad: readonly string[]): Buffer => Buffer.from(JSON.stringify(['vox_voiceprints', ...aad]), 'utf8');

export class AesGcmVoiceprintCipher implements VoiceprintCipher {
  readonly keyId: string;
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (!ArrayBuffer.isView(key) || key.byteLength !== 32) throw new Error('Voiceprint encryption requires a 256-bit key');
    this.key = Buffer.from(key);
    this.keyId = createHash('sha256').update('vox-voiceprint-key-id\0').update(this.key).digest('hex').slice(0, 16);
  }

  seal(plain: Uint8Array, aad: readonly string[]): string {
    if (!ArrayBuffer.isView(plain) || plain.byteLength === 0 || plain.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new Error('Voiceprint template size is invalid');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aadBytes(aad));
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, this.keyId, b64url(iv), b64url(tag), b64url(ciphertext)].join('.');
  }

  /** The caller zero-fills the returned bytes after use. A GCM authentication failure throws. */
  open(sealed: string, aad: readonly string[]): Uint8Array {
    const parts = typeof sealed === 'string' ? sealed.split('.') : [];
    if (parts.length !== 5 || parts[0] !== PREFIX || parts[1] !== this.keyId) throw new Error('voiceprint_key_unavailable');
    const iv = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const ciphertext = Buffer.from(parts[4], 'base64url');
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES || ciphertext.byteLength === 0) throw new Error('voiceprint_template_invalid');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadBytes(aad));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const out = new Uint8Array(plain.byteLength);
    out.set(plain);
    plain.fill(0);
    return out;
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && timingSafeEqual(a, b);

/**
 * VOICEPRINT_KEY: base64 of exactly 32 bytes. Returns null when unset or blank.
 * Refuses any key equal to, or trivially derived from, STUDIO_SECRET.
 */
export function voiceprintCipherFromEnv(env: NodeJS.ProcessEnv = process.env): AesGcmVoiceprintCipher | null {
  const raw = env.VOICEPRINT_KEY?.trim();
  if (!raw) return null;
  const secret = env.STUDIO_SECRET;
  const reuse = () => new Error('VOICEPRINT_KEY must not reuse STUDIO_SECRET');
  if (secret && raw === secret) throw reuse();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) throw new Error('VOICEPRINT_KEY must be base64 of exactly 32 bytes');
  const key = Buffer.from(raw, 'base64');
  if (key.byteLength !== 32) throw new Error('VOICEPRINT_KEY must be base64 of exactly 32 bytes');
  if (secret) {
    const prefix = Buffer.from(secret).subarray(0, 32);
    const hashed = createHash('sha256').update(secret).digest();
    if (sameBytes(key, prefix) || sameBytes(key, hashed)) throw reuse();
  }
  return new AesGcmVoiceprintCipher(key);
}
