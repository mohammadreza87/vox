/**
 * AES-256-GCM encryption for agent bot tokens at rest.
 * Key: STUDIO_SECRET (any string ≥ 32 chars), hashed to 32 bytes.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function key(secret: string): Buffer {
  if (!secret || secret.length < 32) throw new Error('STUDIO_SECRET must be at least 32 characters');
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decryptSecret(sealed: string, secret: string): string {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognized secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
