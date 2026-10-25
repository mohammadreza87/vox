/**
 * pyannoteAI voiceprint adapter (S11L). Written from pyannoteAI's public API
 * documentation and NOT verified against a live account: the media-input
 * upload, /v1/voiceprint, /v1/identify, /v1/diarize, job polling, the
 * confidence scale (0..100), the model name and the EU base URL must be
 * checked on the account before STUDIO_VOICE_RECOGNITION is enabled.
 *
 * Data flow: audio is uploaded to pyannoteAI's temporary media storage
 * (purged by the vendor within 48 h) and job outputs are deleted after 24 h.
 * Vox never persists raw samples. Candidate labels are opaque ('owner',
 * 'echo-<n>'); person ids, Telegram ids and names never leave Vox.
 *
 * Errors are VoiceprintProviderError codes only, never response bodies. This
 * module never logs and is never constructed with a real key in tests.
 */
import { createHash, randomUUID } from 'node:crypto';
import { netSpeechFromSegments } from './net-speech';
import { VoiceprintProviderError, type SpeechActivity, type VoiceprintProvider } from './provider';

export const PYANNOTE_DEFAULT_BASE_URL = 'https://api.pyannote.ai';
const MODEL = 'precision-2';
const POLL_INTERVAL_MS = 300;
const UPLOAD_CACHE_MS = 10 * 60_000;
const MAX_VOICEPRINT_CHARS = 20_000;
const MAX_CANDIDATES = 50;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new VoiceprintProviderError('aborted')); return; }
  const onAbort = () => { clearTimeout(timer); reject(new VoiceprintProviderError('aborted')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal.addEventListener('abort', onAbort, { once: true });
});

export class PyannoteVoiceprintProvider implements VoiceprintProvider {
  readonly id = 'pyannoteai' as const;
  readonly modelVersion = 'pyannoteai:precision-2' as const;
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  /** sha256(bytes) -> media key. Only the key and digest are cached, never the bytes. */
  private readonly uploads = new Map<string, { key: Promise<string>; expiresAt: number }>();

  constructor(o: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    if (!o.apiKey?.trim()) throw new Error('PYANNOTE_API_KEY is required');
    let url: URL;
    try { url = new URL(o.baseUrl ?? PYANNOTE_DEFAULT_BASE_URL); } catch { throw new Error('PYANNOTE_BASE_URL must be https on a pyannote.ai host'); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(host === 'api.pyannote.ai' || host.endsWith('.pyannote.ai')) || url.username || url.password || url.search || url.hash) {
      throw new Error('PYANNOTE_BASE_URL must be https on a pyannote.ai host');
    }
    this.apiKey = o.apiKey.trim();
    this.base = url.origin;
    this.fetchImpl = o.fetch ?? ((input, init) => fetch(input, init));
  }

  private async send(url: string, init: RequestInit, signal: AbortSignal, authorized: boolean): Promise<Response> {
    if (signal.aborted) throw new VoiceprintProviderError('aborted');
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init, signal,
        headers: { ...(authorized ? { Authorization: `Bearer ${this.apiKey}` } : {}), ...(init.headers as Record<string, string> | undefined) },
      });
    } catch {
      throw new VoiceprintProviderError(signal.aborted ? 'aborted' : 'http');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new VoiceprintProviderError('http');
    }
    return response;
  }

  private async api(path: string, init: RequestInit, signal: AbortSignal): Promise<Json> {
    const response = await this.send(`${this.base}/v1/${path}`, init, signal, true);
    let body: unknown;
    try { body = await response.json(); } catch { throw new VoiceprintProviderError(signal.aborted ? 'aborted' : 'bad_response'); }
    if (!isObject(body)) throw new VoiceprintProviderError('bad_response');
    return body;
  }

  private post(path: string, body: unknown, signal: AbortSignal): Promise<Json> {
    return this.api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
  }

  /** One upload per distinct audio for 10 minutes, so diarize and identify on the same note share it. */
  private upload(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
    const digest = createHash('sha256').update(bytes).digest('hex');
    const now = Date.now();
    for (const [k, v] of this.uploads) if (v.expiresAt <= now) this.uploads.delete(k);
    const hit = this.uploads.get(digest);
    if (hit) return hit.key;
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    const key = (async () => {
      try {
        const media = `media://vox-vp/${randomUUID()}`;
        const { url } = await this.post('media/input', { url: media }, signal);
        if (typeof url !== 'string') throw new VoiceprintProviderError('bad_response');
        let target: URL;
        try { target = new URL(url); } catch { throw new VoiceprintProviderError('bad_response'); }
        if (target.protocol !== 'https:') throw new VoiceprintProviderError('bad_response');
        // A presigned storage URL carries its own authorization: the API key is never sent to it.
        await this.send(target.href, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body }, signal, false);
        return media;
      } finally {
        body.fill(0);
      }
    })();
    this.uploads.set(digest, { key, expiresAt: now + UPLOAD_CACHE_MS });
    key.catch(() => { if (this.uploads.get(digest)?.key === key) this.uploads.delete(digest); });
    return key;
  }

  private async job(path: string, body: Json, signal: AbortSignal): Promise<unknown> {
    const { jobId } = await this.post(path, body, signal);
    if (typeof jobId !== 'string' || !jobId || jobId.length > 200) throw new VoiceprintProviderError('bad_response');
    for (;;) {
      const job = await this.api(`jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, signal);
      if (job.status === 'succeeded') return job.output;
      if (job.status === 'failed' || job.status === 'canceled') throw new VoiceprintProviderError('job_failed');
      await sleep(POLL_INTERVAL_MS, signal);
    }
  }

  async voiceprint(audio: Uint8Array, _mimeType: string, signal: AbortSignal): Promise<Uint8Array> {
    const url = await this.upload(audio, signal);
    const output = await this.job('voiceprint', { url, model: MODEL }, signal);
    const voiceprint = isObject(output) ? output.voiceprint : undefined;
    if (typeof voiceprint !== 'string' || !voiceprint || voiceprint.length > MAX_VOICEPRINT_CHARS) throw new VoiceprintProviderError('bad_response');
    // The pyannote string is kept as opaque UTF-8 bytes.
    return new TextEncoder().encode(voiceprint);
  }

  /** `query` is the query AUDIO, uploaded as received. */
  async identify(query: Uint8Array, candidates: readonly { id: string; template: Uint8Array }[], signal: AbortSignal): Promise<{ candidateId?: string; score: number }> {
    if (candidates.length < 1 || candidates.length > MAX_CANDIDATES) throw new VoiceprintProviderError('bad_response');
    const url = await this.upload(query, signal);
    const decoder = new TextDecoder();
    const labels = new Set(candidates.map(c => c.id));
    const output = await this.job('identify', {
      url, model: MODEL,
      voiceprints: candidates.map(c => ({ label: c.id, voiceprint: decoder.decode(c.template) })),
      matching: { exclusive: true, threshold: 0 },
    }, signal);
    const speakers = isObject(output) ? output.voiceprints : undefined;
    if (!Array.isArray(speakers)) throw new VoiceprintProviderError('bad_response');
    const distinct = new Set(speakers.map(s => isObject(s) ? s.speaker : undefined));
    if (distinct.size > 1) throw new VoiceprintProviderError('mixed_speakers');
    let best: { candidateId?: string; score: number } = { score: 0 };
    for (const entry of speakers) {
      const confidence = isObject(entry) && isObject(entry.confidence) ? entry.confidence : {};
      for (const [label, raw] of Object.entries(confidence)) {
        if (!labels.has(label) || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
        const score = Math.min(1, Math.max(0, raw / 100));
        if (best.candidateId === undefined || score > best.score) best = { candidateId: label, score };
      }
    }
    return best;
  }

  speechActivity(): SpeechActivity {
    return {
      measure: async (audio, _mimeType, signal) => {
        const url = await this.upload(audio, signal);
        const output = await this.job('diarize', { url, model: MODEL }, signal);
        const segments = isObject(output) ? output.diarization : undefined;
        if (!Array.isArray(segments)) throw new VoiceprintProviderError('bad_response');
        const valid = segments.filter(isObject)
          .filter((s): s is Json & { start: number; end: number } => typeof s.start === 'number' && typeof s.end === 'number');
        return {
          netSpeechMs: netSpeechFromSegments(valid),
          speakers: new Set(valid.map(s => s.speaker)).size,
        };
      },
    };
  }
}
