import { constants, lstatSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { VoiceTemplateCipher } from './repository';
import { LocalVoiceIdentityProvider, LOCAL_VOICE_PROVIDER_ID, LOCAL_VOICE_PROVIDER_VERSION } from './local-provider';
import type { VoiceIdentityOptions } from './service';
import { VOICE_NOTICE_VERSION } from './contracts';

const reference = z.string().trim().min(1).max(200);
const approvalSchema = z.object({ providerId: z.literal(LOCAL_VOICE_PROVIDER_ID), providerVersion: z.literal(LOCAL_VOICE_PROVIDER_VERSION),
  location: z.literal('server'), approvalReference: reference, noticeVersion: z.literal(VOICE_NOTICE_VERSION),
  expiresAt: z.number().int().positive(), templateTtlMs: z.number().int().positive().max(180 * 86400_000),
  consentTtlMs: z.number().int().positive().max(365 * 86400_000),
  disclosure: z.object({ en: z.string().trim().min(1).max(10_000), fa: z.string().trim().min(1).max(10_000) }).strict(),
}).strict();
const absolutePath = z.string().min(1).max(1000).refine(path => isAbsolute(path) && !path.includes('\0'));
export const localVoiceConfigSchema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean(),
  socketPath: absolutePath.refine(path => Buffer.byteLength(path) <= 100), authKeyFile: absolutePath,
  encryptionKeyFile: absolutePath, approval: approvalSchema.optional(),
}).strict();
/** Server-owned file only. The descriptor also prevents a symlink swap while opening. */
export function readPrivateVoiceFile(path: string, maximum: number): Buffer {
  if (!isAbsolute(path)) throw new Error('local_voice_private_file_required');
  const before = lstatSync(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size < 1 || info.size > maximum ||
        before.dev !== info.dev || before.ino !== info.ino) throw new Error('local_voice_private_file_required');
    const buffer = Buffer.alloc(maximum + 1); let offset = 0;
    try {
      while (offset < buffer.length) { const count = readSync(descriptor, buffer, offset, buffer.length - offset, null); if (!count) break; offset += count; }
      if (!offset || offset > maximum) throw new Error('local_voice_private_file_required');
      return Buffer.from(buffer.subarray(0, offset));
    } finally { buffer.fill(0); }
  } finally { closeSync(descriptor); }
}
export async function localVoiceIdentityOptions(env: NodeJS.ProcessEnv, profile: { storage: 'file' | 'firestore' }):
  Promise<{ selected: boolean; options: VoiceIdentityOptions; readiness: string }> {
  const path = env.STUDIO_VOICE_IDENTITY_CONFIG_FILE?.trim();
  if (!path) return { selected: false, options: { enabled: false, readinessReason: 'recognition_not_configured' }, readiness: 'recognition_not_configured' };
  if (profile.storage !== 'file') throw new Error('local_voice_file_profile_required');
  const raw = readPrivateVoiceFile(path, 30_000);
  let config: z.infer<typeof localVoiceConfigSchema>;
  try { config = localVoiceConfigSchema.parse(JSON.parse(raw.toString('utf8'))); }
  finally { raw.fill(0); }
  let secret: Buffer | undefined, keyBytes: Buffer | undefined, key: Buffer | undefined;
  try {
    secret = readPrivateVoiceFile(config.authKeyFile, 65);
    keyBytes = readPrivateVoiceFile(config.encryptionKeyFile, 45);
    const authKey = secret.toString('utf8').trim(), encoded = keyBytes.toString('utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(authKey) || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('local_voice_key_invalid');
    key = Buffer.from(encoded, 'base64');
    if (key.byteLength !== 32 || key.toString('base64') !== encoded || timingSafeEqual(key, Buffer.from(authKey, 'hex'))) throw new Error('local_voice_key_invalid');
    const studioSecret = env.STUDIO_SECRET;
    if (studioSecret && (timingSafeEqual(key, createHash('sha256').update(studioSecret).digest()) ||
        Buffer.from(studioSecret).length >= 32 && timingSafeEqual(key, Buffer.from(studioSecret).subarray(0, 32)))) throw new Error('local_voice_key_must_be_dedicated');
    const cipher = new VoiceTemplateCipher(createHash('sha256').update(key).digest('hex').slice(0, 16), new Uint8Array(key));
    const provider = new LocalVoiceIdentityProvider({ socketPath: config.socketPath, authKey });
    const options: VoiceIdentityOptions = { provider, cipher, ...(config.approval ? { providerApproval: config.approval } : {}), enabled: false };
    let readiness = !(await import('../../tireh/flags')).tirehFlags(env).voiceRecognition || !config.enabled ? 'recognition_disabled'
      : !config.approval ? 'recognition_release_not_configured'
        : config.approval.expiresAt <= Date.now() ? 'recognition_release_expired' : 'local_engine_unavailable';
    // Readiness exports no sample. The worker independently reports whether its
    // actual inspection implementation and calibrated matching are qualified.
    try {
      const ready = await provider.readiness(AbortSignal.timeout(2000));
      if (readiness === 'local_engine_unavailable') {
        readiness = !ready.encoderReady ? 'local_engine_unavailable' : !ready.inspectionQualified ? 'inspection_not_qualified'
          : !ready.matchingQualified ? 'matching_not_qualified' : ready.reason === 'ready' ? 'ready' : 'local_engine_unavailable';
      }
    } catch { /* Read/delete remain available; capture stays off. */ }
    options.enabled = readiness === 'ready'; options.readinessReason = readiness;
    return { selected: true, options, readiness };
  } finally { secret?.fill(0); keyBytes?.fill(0); key?.fill(0); }
}
