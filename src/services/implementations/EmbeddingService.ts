/**
 * Embedding Service Implementation
 *
 * Uses OpenAI embeddings for semantic search on memory facts.
 * Stores embeddings in Firestore subcollection.
 */

import OpenAI from 'openai';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  MemoryFact,
  EmbeddingResult,
  SemanticSearchResult,
  SimilarFact,
  FactEmbedding,
  EMBEDDING_CONFIG,
} from '@/shared/types';
import { IEmbeddingService } from '../interfaces/IEmbeddingService';

// Lazy-initialized OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export class EmbeddingService implements IEmbeddingService {
  private readonly usersCollection = 'users';
  private readonly memoriesSubcollection = 'contactMemories';
  private readonly embeddingsSubcollection = 'factEmbeddings';

  private getDb() {
    if (!db) {
      throw new Error('Firestore is not initialized');
    }
    return db;
  }

  private getEmbeddingsRef(userId: string, contactId: string) {
    return collection(
      this.getDb(),
      this.usersCollection,
      userId,
      this.memoriesSubcollection,
      contactId,
      this.embeddingsSubcollection
    );
  }

  private getEmbeddingDocRef(userId: string, contactId: string, factKey: string) {
    return doc(this.getEmbeddingsRef(userId, contactId), factKey);
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const client = getOpenAIClient();

    const response = await client.embeddings.create({
      model: EMBEDDING_CONFIG.model,
      input: text,
      dimensions: EMBEDDING_CONFIG.dimensions,
    });

    return {
      embedding: response.data[0].embedding,
      tokens: response.usage.total_tokens,
    };
  }

  async searchSimilarFacts(
    userId: string,
    contactId: string,
    query: string,
    limit = EMBEDDING_CONFIG.defaultLimit,
    threshold = EMBEDDING_CONFIG.defaultThreshold
  ): Promise<SemanticSearchResult> {
    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Get all fact embeddings for this contact
    const embeddingsRef = this.getEmbeddingsRef(userId, contactId);
    const snapshot = await getDocs(embeddingsRef);

    if (snapshot.empty) {
      return {
        query,
        results: [],
        tokensUsed: queryEmbedding.tokens,
      };
    }

    // Calculate similarity for each fact
    const scored: SimilarFact[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data() as FactEmbedding;

      if (data.embedding && data.embedding.length > 0) {
        const similarity = this.cosineSimilarity(
          queryEmbedding.embedding,
          data.embedding
        );

        if (similarity >= threshold) {
          scored.push({
            fact: {
              key: data.factKey,
              value: data.content,
              source: 'chat', // Default, actual source stored in memory
              confidence: 1,
              extractedAt: data.createdAt instanceof Date
                ? data.createdAt
                : new Date(),
            },
            similarity,
          });
        }
      }
    });

    // Sort by similarity and limit
    const results = scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return {
      query,
      results,
      tokensUsed: queryEmbedding.tokens,
    };
  }

  async indexFact(
    userId: string,
    contactId: string,
    fact: MemoryFact
  ): Promise<void> {
    // Generate embedding for the fact value
    const embedding = await this.generateEmbedding(fact.value);

    // Store in Firestore
    const docRef = this.getEmbeddingDocRef(userId, contactId, fact.key);

    await setDoc(docRef, {
      factKey: fact.key,
      embedding: embedding.embedding,
      content: fact.value,
      createdAt: serverTimestamp(),
    });
  }

  async deleteFactEmbedding(
    userId: string,
    contactId: string,
    factKey: string
  ): Promise<void> {
    const docRef = this.getEmbeddingDocRef(userId, contactId, factKey);
    await deleteDoc(docRef);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
