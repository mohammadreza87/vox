/**
 * Embedding Service Interface
 *
 * Defines operations for semantic search using embeddings
 */

import { MemoryFact, EmbeddingResult, SemanticSearchResult } from '@/shared/types';

export interface IEmbeddingService {
  /**
   * Generate embedding for text using OpenAI
   */
  generateEmbedding(text: string): Promise<EmbeddingResult>;

  /**
   * Search for similar facts using semantic similarity
   *
   * @param userId - User ID for scoping the search
   * @param contactId - Contact ID to search facts for
   * @param query - Text query to search
   * @param limit - Maximum number of results
   * @param threshold - Minimum similarity threshold (0-1)
   */
  searchSimilarFacts(
    userId: string,
    contactId: string,
    query: string,
    limit?: number,
    threshold?: number
  ): Promise<SemanticSearchResult>;

  /**
   * Index a fact by generating and storing its embedding
   *
   * @param userId - User ID
   * @param contactId - Contact ID
   * @param fact - Fact to index
   */
  indexFact(
    userId: string,
    contactId: string,
    fact: MemoryFact
  ): Promise<void>;

  /**
   * Delete embedding for a fact
   */
  deleteFactEmbedding(
    userId: string,
    contactId: string,
    factKey: string
  ): Promise<void>;
}
