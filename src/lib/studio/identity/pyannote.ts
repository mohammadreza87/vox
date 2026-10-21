/**
 * pyannoteAI voiceprint adapter (S11L).
 *
 * Written from pyannoteAI's public API documentation and NOT yet verified
 * against a live account: the media-input upload, /v1/voiceprint,
 * /v1/identify, job polling, the confidence scale, the model name and the EU
 * base URL must all be checked before STUDIO_VOICE_RECOGNITION is enabled.
 * Every response is parsed defensively; an unexpected shape or a non-2xx
 * status throws a content-free error ("pyannote <op> failed: HTTP <status>").
 *
 * Retention: pyannoteAI keeps media-input files and returned voiceprints for
 * at most 24 hours (verify on the account). That is what the UX-07
 * {sample_deletion_term} placeholder must state. The processor-table row for
 * pyannoteAI belongs to step S15 (PRIV-009).
 *
 * Only opaque candidate ids ('self', 'echo:<n>') are sent; never a person id,
 * a Telegram id or a name. This module never logs. It is never constructed in
 * tests; tests use a fake VoiceprintProvider.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { VoiceprintProvider } from './voice';

/** Verify against the account's model name before release. */
export const PYANNOTE_MODEL_VERSION = 'pyannoteai-voiceprint-v1';
const DEFAULT_BASE_URL = 'https://api.pyannote.ai';
const POLL_MS = 500;
const MAX_POLLS = 240;

const presignedSchema = z.object({ url: z.string().url() }).passthrough();
const jobSchema = z.object({ jobId: z.string().min(1).max(200) }).passthrough();
const statusSchema = z.object({ status: z.string().min(1).max(40), output: z.unknown().optional() }).passthrough();
const voiceprintOutput = z.object({ voiceprint: z.string().min(1).max(1_000_000) }).passthrough();
const identifyOutput = z.object({
  voiceprints: z.array(z.object({ confidence: z.record(z.string(), z.number()).optional() }).passthrough()).max(10_000).optional(),
}).passthrough();

class PyannoteError extends Error {
  constructor(op: string, status: number) { super(`pyannote ${op} failed: HTTP ${status}`); this.name = 'PyannoteError'; }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason ?? new Error('aborted')); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); };
  signal.addEventListener('abort', onAbort, { once: true });
});

export class PyannoteVoiceprintProvider implements VoiceprintProvider {
  readonly id = 'pyannoteai';
  readonly modelVersion = PYANNOTE_MODEL_VERSION;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(o: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    if (!o.apiKey || !o.apiKey.trim()) throw new Error('PYANNOTE_API_KEY is required');
    let url: URL;
    try { url = new URL(o.baseUrl ?? DEFAULT_BASE_URL); } catch { throw new Error('PYANNOTE_BASE_URL must be an https origin'); }
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('PYANNOTE_BASE_URL must be an https origin');
    }
    this.apiKey = o.apiKey.trim();
    this.baseUrl = url.origin;
    this.fetchImpl = o.fetch ?? ((input, init) => fetch(input, init));
  }

  private async send(op: string, url: string, init: RequestInit, signal: AbortSignal, authorized = true): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal, headers: { ...(authorized ? { Authorization: `Bearer ${this.apiKey}` } : {}), ...(init.headers as Record<string, string> | undefined) } });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new PyannoteError(op, 0);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new PyannoteError(op, response.status);
    }
    return response;
  }

  private async json<T>(op: string, schema: z.ZodType<T>, path: string, init: RequestInit, signal: AbortSignal): Promise<T> {
    const response = await this.send(op, `${this.baseUrl}${path}`, init, signal);
    let body: unknown;
    try { body = await response.json(); } catch { throw new PyannoteError(op, response.status); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new PyannoteError(op, response.status);
    return parsed.data;
  }

  private post<T>(op: string, schema: z.ZodType<T>, path: string, body: unknown, signal: AbortSignal): Promise<T> {
    return this.json(op, schema, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
  }

  /** Uploads bytes to pyannote's temporary media input and returns the media:// reference. */
  private async upload(bytes: Uint8Array, mime: string, signal: AbortSignal): Promise<string> {
    const media = `media://vox-${randomUUID()}`;
    const { url } = await this.post('media', presignedSchema, '/v1/media/input', { url: media }, signal);
    if (new URL(url).protocol !== 'https:') throw new PyannoteError('media', 0);
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    // The presigned URL carries its own authorization; the API key is never sent to it.
    await this.send('upload', url, { method: 'PUT', headers: { 'Content-Type': mime || 'application/octet-stream' }, body }, signal, false);
    return media;
  }

  private async poll(op: string, jobId: string, signal: AbortSignal): Promise<unknown> {
    for (let i = 0; i < MAX_POLLS; i++) {
      const job = await this.json(op, statusSchema, `/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, signal);
      if (job.status === 'succeeded') return job.output;
      if (job.status === 'failed' || job.status === 'canceled') throw new PyannoteError(op, 200);
      await sleep(POLL_MS, signal);
    }
    throw new PyannoteError(op, 0);
  }

  async voiceprint(audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Uint8Array> {
    const url = await this.upload(audio, mimeType, signal);
    const { jobId } = await this.post('voiceprint', jobSchema, '/v1/voiceprint', { url }, signal);
    const output = voiceprintOutput.safeParse(await this.poll('voiceprint', jobId, signal));
    if (!output.success) throw new PyannoteError('voiceprint', 200);
    const bytes = Buffer.from(output.data.voiceprint, 'base64');
    if (!bytes.byteLength) throw new PyannoteError('voiceprint', 200);
    const template = new Uint8Array(bytes.byteLength);
    template.set(bytes);
    bytes.fill(0);
    return template;
  }

  /** `query` is the raw voice-note audio; no query template is derived or stored by Vox. */
  async identify(query: Uint8Array, candidates: readonly { id: string; template: Uint8Array }[], signal: AbortSignal): Promise<{ candidateId?: string; score: number }> {
    const url = await this.upload(query, 'application/octet-stream', signal);
    const labels = new Set(candidates.map(c => c.id));
    const { jobId } = await this.post('identify', jobSchema, '/v1/identify', {
      url,
      voiceprints: candidates.map(c => ({ label: c.id, voiceprint: Buffer.from(c.template).toString('base64') })),
      matching: { exclusive: false, threshold: 0 },
    }, signal);
    const output = identifyOutput.safeParse(await this.poll('identify', jobId, signal));
    if (!output.success) throw new PyannoteError('identify', 200);
    let best: { candidateId?: string; score: number } = { score: 0 };
    for (const entry of output.data.voiceprints ?? []) {
      for (const [label, raw] of Object.entries(entry.confidence ?? {})) {
        if (!labels.has(label) || !Number.isFinite(raw)) continue;
        const score = Math.min(1, Math.max(0, raw > 1 ? raw / 100 : raw));
        if (best.candidateId === undefined || score > best.score) best = { candidateId: label, score };
      }
    }
    return best;
  }
}
