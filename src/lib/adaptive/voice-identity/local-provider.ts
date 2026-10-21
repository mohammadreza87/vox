import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { VoiceEffectFence, VoiceIdentityProvider } from './provider';
import { MAX_VOICE_BYTES } from './contracts';
import { AdaptiveError } from '../persistence/service';

export const LOCAL_VOICE_PROVIDER_ID = 'vox-local-ecapa';
export const LOCAL_VOICE_MODEL_DIGEST = '0575cb64845e6b9a10db9bcb74d5ac32b326b8dc90352671d345e2ee3d0126a2';
export const LOCAL_VOICE_PROVIDER_VERSION = 'ecapa-0f99f2d0ebe8-0575cb64845e-v1';
const readinessSchema = z.object({ protocolVersion: z.literal(1), providerId: z.literal(LOCAL_VOICE_PROVIDER_ID),
  providerVersion: z.literal(LOCAL_VOICE_PROVIDER_VERSION), modelDigest: z.literal(LOCAL_VOICE_MODEL_DIGEST),
  encoderReady: z.boolean(), inspectionQualified: z.boolean(), matchingQualified: z.boolean(),
  reason: z.enum(['ready', 'inspection_not_qualified', 'matching_not_qualified']) }).strict();
export type LocalVoiceReadiness = z.infer<typeof readinessSchema>;
const inspectSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('unknown'), reason: z.string().max(80) }).strict(),
  z.object({ outcome: z.literal('eligible_single_live'), inspectionLease: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
const templateSchema = z.object({ template: z.string().min(4).max(87_384).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
const comparisonSchema = z.object({ candidateId: z.literal('self').optional() }).strict();
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const safeError = (error: unknown): Error => AdaptiveError.is(error) ? error : new Error('local_voice_unavailable');
const fail = (): never => { throw new Error('local_voice_unavailable'); };
/** Only a private local socket is accepted: no URL, TCP, DNS or cloud fallback. */
export class LocalVoiceIdentityProvider implements VoiceIdentityProvider {
  readonly id = LOCAL_VOICE_PROVIDER_ID;
  readonly version = LOCAL_VOICE_PROVIDER_VERSION;
  readonly location = 'server' as const;
  readonly retention = 'request_only' as const;
  private readonly leases = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly options: { socketPath: string; authKey: string; timeoutMs?: number }) {
    if (!isAbsolute(options.socketPath) || Buffer.byteLength(options.socketPath) > 100 || options.socketPath.includes('\0') ||
        !/^[a-f0-9]{64}$/.test(options.authKey) || options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 20_000)) fail();
  }
  private socket(): void {
    const info = lstatSync(this.options.socketPath);
    if (!info.isSocket() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) fail();
  }
  private async call<T>(path: '/ready' | '/inspect' | '/extract' | '/compare' | '/purge', value: unknown, schema: z.ZodType<T>, signal?: AbortSignal, authorize?: () => void): Promise<T> {
    if (signal?.aborted) fail();
    this.socket();
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > 1_500_000) { body.fill(0); fail(); }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const chunks: Buffer[] = [];
      const finish = (error?: Error, result?: T) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); body.fill(0); chunks.forEach(chunk => chunk.fill(0));
        if (error) reject(error); else resolve(result!);
      };
      const request = httpRequest({ socketPath: this.options.socketPath, path, method: 'POST', headers: {
        Authorization: `Bearer ${this.options.authKey}`, 'Content-Type': 'application/json', 'Content-Length': body.length,
      } }, response => {
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 100_000) { chunk.fill(0); response.destroy(); request.destroy(); finish(new Error('local_voice_unavailable')); }
          else chunks.push(chunk);
        });
        response.on('error', () => finish(new Error('local_voice_unavailable')));
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) fail();
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const parsed = schema.parse(value); authorize?.(); finish(undefined, parsed);
          } catch (error) { finish(safeError(error)); }
          finally { chunks.forEach(chunk => chunk.fill(0)); }
        });
      });
      const abort = () => { request.destroy(); finish(new Error('local_voice_unavailable')); };
      const timer = setTimeout(abort, this.options.timeoutMs ?? 5000);
      signal?.addEventListener('abort', abort, { once: true });
      request.on('error', () => finish(new Error('local_voice_unavailable')));
      // The final authorization runs after asynchronous connection setup, with
      // no await before the first request-body write.
      request.on('socket', socket => {
        const send = () => {
          try { if (signal?.aborted || settled) return abort(); authorize?.(); request.end(body); }
          catch (error) { request.destroy(); finish(safeError(error)); }
        };
        if (socket.connecting) socket.once('connect', send); else send();
      });
      if (signal?.aborted) abort();
    });
  }
  readiness(signal?: AbortSignal, authorize?: () => void): Promise<LocalVoiceReadiness> {
    return this.call('/ready', {}, readinessSchema, signal, authorize);
  }
  private context(input: VoiceEffectFence): string {
    if (!input.authorize || !/^[0-9a-f-]{36}$/i.test(input.captureContext ?? '')) fail();
    input.authorize!(); return input.captureContext!;
  }
  private async qualified(input: VoiceEffectFence & { signal: AbortSignal }): Promise<boolean> {
    this.context(input);
    const ready = await this.readiness(input.signal, input.authorize);
    input.authorize!();
    return ready.encoderReady && ready.inspectionQualified && ready.matchingQualified && ready.reason === 'ready';
  }
  async inspect(input: Parameters<VoiceIdentityProvider['inspect']>[0]): Promise<'eligible_single_live' | 'unknown'> {
    if (!input.audio.byteLength || input.audio.byteLength > MAX_VOICE_BYTES || !/^\d{6}$/.test(input.challenge) || input.maxDurationMs > 10_000) fail();
    if (!await this.qualified(input)) return 'unknown';
    const result = await this.call('/inspect', { audio: Buffer.from(input.audio).toString('base64'), mimeType: input.mimeType,
      challenge: input.challenge, maxDurationMs: input.maxDurationMs }, inspectSchema, input.signal, input.authorize);
    if (result.outcome !== 'eligible_single_live') return 'unknown';
    const now = Date.now();
    for (const [key, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(key);
    if (this.leases.size >= 32) fail();
    this.leases.set(`${this.context(input)}:${digest(input.audio)}`, { value: result.inspectionLease, expiresAt: now + 30_000 });
    return 'eligible_single_live';
  }
  async extract(input: Parameters<VoiceIdentityProvider['extract']>[0]): Promise<Uint8Array> {
    if (!await this.qualified(input)) fail();
    const key = `${this.context(input)}:${digest(input.audio)}`, lease = this.leases.get(key); this.leases.delete(key);
    if (!lease || lease.expiresAt <= Date.now()) fail();
    const result = await this.call('/extract', { audio: Buffer.from(input.audio).toString('base64'), mimeType: input.mimeType,
      inspectionLease: lease!.value }, templateSchema, input.signal, input.authorize);
    const template = Buffer.from(result.template, 'base64');
    if (!template.byteLength || template.byteLength > 65_536) { template.fill(0); fail(); }
    return template;
  }
  async compare(input: Parameters<VoiceIdentityProvider['compare']>[0]): Promise<{ candidateId?: string }> {
    if (!await this.qualified(input)) return {};
    if (input.candidates.length !== 1 || input.candidates[0].id !== 'self' || input.query.length > 65_536 || input.candidates[0].template.length > 65_536) fail();
    return this.call('/compare', { query: Buffer.from(input.query).toString('base64'), candidates: input.candidates.map(candidate => ({
      id: candidate.id, template: Buffer.from(candidate.template).toString('base64'),
    })) }, comparisonSchema, input.signal, input.authorize);
  }
  async purge(input: Parameters<VoiceIdentityProvider['purge']>[0]): Promise<void> {
    this.leases.clear();
    try { await this.call('/purge', {}, z.object({ purged: z.literal(true) }).strict(), input.signal); }
    finally { input.template.fill(0); }
  }
}
