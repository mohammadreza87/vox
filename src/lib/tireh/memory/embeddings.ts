/**
 * Embedding seam for memory retrieval (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * sections 2.3 and 4.4). Only normal-sensitivity memory content is ever
 * embedded. Providers never log and never put input text or keys in errors.
 * Server-only: the OpenAI adapter must never be constructed in a client bundle.
 */

import { createHash } from 'crypto';
import OpenAI from 'openai';
import type { MemoryRecord } from '../types';
import { contentHash } from './record-v2';

export const EMBEDDING_VERSION = 1;
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const MAX_EMBEDDING_BATCH = 128;

export interface EmbeddingProvider {
  readonly model: string;
  readonly version: number;
  readonly dimensions: number;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}

function assertNonBlank(texts: readonly string[]): void {
  for (const text of texts) {
    if (typeof text !== 'string' || text.trim() === '') throw new TypeError('embedding_input_empty');
  }
}

/** A content-free error: only a fixed code and, when known, the HTTP status. */
export class EmbeddingRequestError extends Error {
  constructor(readonly code: 'embedding_request_failed' | 'embedding_aborted', readonly status?: number) {
    super(status ? `${code}:${status}` : code);
    this.name = code === 'embedding_aborted' ? 'AbortError' : 'EmbeddingRequestError';
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly version = EMBEDDING_VERSION;
  readonly dimensions: number;
  private readonly client: OpenAI;
  private readonly sendDimensions: boolean;

  constructor(options: { apiKey: string; fetch?: typeof fetch; model?: string; dimensions?: number }) {
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
    this.sendDimensions = !!options.dimensions;
    this.client = new OpenAI({ apiKey: options.apiKey, fetch: options.fetch, maxRetries: 0, logLevel: 'off' });
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    assertNonBlank(texts);
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += MAX_EMBEDDING_BATCH) {
      const batch = texts.slice(start, start + MAX_EMBEDDING_BATCH);
      let response: OpenAI.Embeddings.CreateEmbeddingResponse;
      try {
        response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
          encoding_format: 'float',
          ...(this.sendDimensions ? { dimensions: this.dimensions } : {}),
        }, { signal });
      } catch (error) {
        // Never surface provider messages: a server may echo the input back.
        if (signal?.aborted || (error as { name?: string })?.name === 'APIUserAbortError') {
          throw new EmbeddingRequestError('embedding_aborted');
        }
        const status = (error as { status?: unknown })?.status;
        throw new EmbeddingRequestError('embedding_request_failed', typeof status === 'number' ? status : undefined);
      }
      const rows = [...response.data].sort((a, b) => a.index - b.index);
      if (rows.length !== batch.length) throw new Error('embedding_count_mismatch');
      for (const row of rows) {
        if (!Array.isArray(row.embedding) || row.embedding.length !== this.dimensions) throw new Error('embedding_dimension_mismatch');
        out.push(row.embedding);
      }
    }
    return out;
  }
}

const defaultFakeTokenizer = (text: string): string[] =>
  text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);

/** Deterministic feature-hashing embedder for tests. No network. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly version = EMBEDDING_VERSION;
  readonly dimensions: number;
  /** Counts only, never texts. */
  calls = 0;
  inputs = 0;
  private readonly tokenizer: (text: string) => string[];
  private readonly failWith?: Error;

  constructor(options: { dimensions?: number; model?: string; tokenizer?: (text: string) => string[]; failWith?: Error } = {}) {
    this.dimensions = options.dimensions ?? 64;
    this.model = options.model ?? 'fake-embedding';
    this.tokenizer = options.tokenizer ?? defaultFakeTokenizer;
    this.failWith = options.failWith;
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    this.calls++;
    this.inputs += texts.length;
    if (this.failWith) throw this.failWith;
    if (signal?.aborted) throw new EmbeddingRequestError('embedding_aborted');
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const token of this.tokenizer(text)) {
        const h = createHash('sha256').update(token).digest();
        const idx = h.readUInt32BE(0) % this.dimensions;
        v[idx] += (h[4] & 1) ? 1 : -1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return norm === 0 ? v : v.map((x) => x / norm);
    });
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return Math.min(1, Math.max(-1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
}

/** Embeds content only (never topic or source), and only for normal, non-blank records. */
export async function embedMemory(
  m: MemoryRecord,
  p: EmbeddingProvider,
): Promise<Pick<MemoryRecord, 'embedding' | 'embeddingModel' | 'embeddingVersion' | 'contentHash'> | null> {
  if (m.sensitivity !== 'normal' || m.content.trim() === '') return null;
  const [embedding] = await p.embed([m.content.normalize('NFKC').trim()]);
  return { embedding, embeddingModel: p.model, embeddingVersion: p.version, contentHash: contentHash(m.content) };
}

/** Configuration only, not a flag. Not wired anywhere in this step. */
export function createEmbeddingProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAIEmbeddingProvider({ apiKey, model: env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL });
}
