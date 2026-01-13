/**
 * Embedding Types for Semantic Search
 *
 * Types for OpenAI embeddings and similarity search
 */

import { MemoryFact } from './memory';

/**
 * Result from embedding generation
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[];

  /** Tokens used to generate this embedding */
  tokens: number;
}

/**
 * A fact with its similarity score
 */
export interface SimilarFact {
  /** The matched fact */
  fact: MemoryFact;

  /** Cosine similarity score (0-1) */
  similarity: number;
}

/**
 * Result of semantic search
 */
export interface SemanticSearchResult {
  /** The query that was searched */
  query: string;

  /** Similar facts found */
  results: SimilarFact[];

  /** Tokens used for the search */
  tokensUsed: number;
}

/**
 * Fact embedding stored in Firestore
 */
export interface FactEmbedding {
  /** The fact key this embedding is for */
  factKey: string;

  /** The embedding vector */
  embedding: number[];

  /** The original fact content */
  content: string;

  /** When this embedding was created */
  createdAt: Date;
}

/**
 * OpenAI embedding model configuration
 */
export const EMBEDDING_CONFIG = {
  /** Model to use for embeddings */
  model: 'text-embedding-3-small',

  /** Embedding dimensions */
  dimensions: 1536,

  /** Default similarity threshold */
  defaultThreshold: 0.7,

  /** Default number of results to return */
  defaultLimit: 5,
} as const;
