/**
 * Embedding seam for memory retrieval (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.4).
 *
 * Only normal-sensitivity memory text is ever embedded. Providers never log,
 * and errors carry a code only: no input text, query or response body.
 * Not imported by the gateway, Studio or runtime in this step; nothing
 * constructs a provider in production yet (the PRIV-009 processor row must
 * exist first).
 */

// Type-only: the SDK is loaded lazily on first embed, so importing cosine()
// from retrieval.ts (and so from the gateway) never loads it.
import type OpenAI from 'openai';
import type { MemoryRecord } from '../types';
import { contentHash } from './record-v2';

export const EMBEDDING_VERSION = 1;
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

const MAX_EMBEDDING_INPUTS = 2048;
const EMBEDDING_CHUNK = 256;

export interface EmbeddingProvider {
  readonly model: string;
  readonly version: number;
  readonly dimensions: number;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}

/** The message is the code only, never text. */
export class EmbeddingError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'EmbeddingError';
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly version = EMBEDDING_VERSION;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly fetchImpl?: typeof fetch;
  private client?: OpenAI;

  constructor(options: { apiKey: string; fetch?: typeof fetch; model?: string; dimensions?: number }) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch;
    this.model = options.model ?? (process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL);
    this.dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  }

  private async openai(): Promise<OpenAI> {
    if (!this.client) {
      const { default: OpenAIClient } = await import('openai');
      // logLevel 'off': the SDK never logs, whatever OPENAI_LOG says (main's hardening, kept on merge).
      this.client = new OpenAIClient({ apiKey: this.apiKey, fetch: this.fetchImpl, maxRetries: 0, timeout: 10_000, logLevel: 'off' });
    }
    return this.client;
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > MAX_EMBEDDING_INPUTS || texts.some((text) => typeof text !== 'string' || !text.trim())) {
      throw new EmbeddingError('embedding_invalid_input');
    }
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_CHUNK) {
      const input = texts.slice(start, start + EMBEDDING_CHUNK);
      let data: Array<{ index: number; embedding: number[] }>;
      try {
        const client = await this.openai();
        const response = await client.embeddings.create(
          { model: this.model, input, dimensions: this.dimensions, encoding_format: 'float' },
          { signal },
        );
        data = response.data as Array<{ index: number; embedding: number[] }>;
      } catch (error) {
        if (isAbort(error, signal)) throw new EmbeddingError('embedding_aborted');
        const status = (error as { status?: unknown } | null)?.status;
        throw new EmbeddingError('embedding_failed' + (typeof status === 'number' ? `:${status}` : ''));
      }
      if (!Array.isArray(data) || data.length !== input.length) throw new EmbeddingError('embedding_shape');
      const sorted = [...data].sort((a, b) => a.index - b.index);
      for (const row of sorted) {
        if (!Array.isArray(row.embedding) || row.embedding.length !== this.dimensions) throw new EmbeddingError('embedding_shape');
        out.push(row.embedding);
      }
    }
    return out;
  }
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic, network-free hashed-trigram embedding for tests and evals. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly version = EMBEDDING_VERSION;
  readonly dimensions: number;
  calls = 0;

  constructor(options: { dimensions?: number; model?: string } = {}) {
    this.dimensions = options.dimensions ?? 64;
    this.model = options.model ?? 'fake-embedding';
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    this.calls++;
    return texts.map((text) => this.vector(text));
  }

  private vector(text: string): number[] {
    const values = new Array<number>(this.dimensions).fill(0);
    const padded = ` ${text.normalize('NFKC').toLowerCase()} `;
    const chars = [...padded];
    for (let i = 0; i + 3 <= chars.length; i++) {
      const hash = fnv1a(chars.slice(i, i + 3).join(''));
      const bucket = hash % this.dimensions;
      values[bucket] += (hash & 0x80000000) ? -1 : 1;
    }
    const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? values : values.map((v) => v / norm);
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Embedding fields for a record, or null unless the record is normal sensitivity. */
export async function embedMemory(
  m: MemoryRecord,
  p: EmbeddingProvider,
): Promise<Pick<MemoryRecord, 'embedding' | 'embeddingModel' | 'embeddingVersion' | 'contentHash'> | null> {
  if (m.sensitivity !== 'normal') return null;
  const [embedding] = await p.embed([m.content]);
  return { embedding, embeddingModel: p.model, embeddingVersion: p.version, contentHash: contentHash(m.content) };
}
