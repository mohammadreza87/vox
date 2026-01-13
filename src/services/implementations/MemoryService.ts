/**
 * Memory Service Implementation
 * Handles business logic for contact memory/context engineering
 */

import {
  ContactMemory,
  MemoryContext,
  ExtractMemoryRequest,
  ExtractMemoryResponse,
  MemoryFact,
  SessionSummary,
  MemoryExtractionResult,
} from '@/shared/types';
import { IMemoryRepository } from '@/repositories/interfaces';
import { IMemoryService, BuildContextOptions } from '../interfaces/IMemoryService';
import { IEmbeddingService } from '../interfaces/IEmbeddingService';
import { getCurrentUserId } from '@/stores/authStore';
import { getAuthToken } from '@/stores/middleware/sync';

const DEFAULT_MAX_FACTS = 10;
const DEFAULT_MAX_SESSIONS = 3;
const DEFAULT_MAX_TOKENS = 500;

export class MemoryService implements IMemoryService {
  private embeddingService: IEmbeddingService | null = null;

  constructor(private readonly memoryRepository: IMemoryRepository) {}

  /**
   * Set the embedding service for semantic search indexing.
   * Optional: if not set, facts won't be indexed for semantic search.
   */
  setEmbeddingService(embeddingService: IEmbeddingService): void {
    this.embeddingService = embeddingService;
  }

  private getUserId(): string {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return userId;
  }

  async getMemory(contactId: string): Promise<ContactMemory | null> {
    const userId = this.getUserId();
    return this.memoryRepository.getMemory(userId, contactId);
  }

  async buildContextForContact(
    contactId: string,
    options: BuildContextOptions = {}
  ): Promise<MemoryContext> {
    const userId = this.getUserId();
    const {
      maxFacts = DEFAULT_MAX_FACTS,
      maxSessions = DEFAULT_MAX_SESSIONS,
      maxTokens = DEFAULT_MAX_TOKENS,
    } = options;

    const memory = await this.memoryRepository.getMemory(userId, contactId);

    if (!memory) {
      return {
        contextString: '',
        facts: [],
        recentSessions: [],
        lastInteraction: null,
        totalSessions: 0,
        totalFacts: 0,
      };
    }

    // Get most relevant facts (sorted by confidence, limited)
    const relevantFacts = memory.facts
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxFacts);

    // Get recent sessions
    const recentSessions = memory.sessions
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, maxSessions);

    // Build context string
    const contextString = this.buildContextString(
      relevantFacts,
      recentSessions,
      memory.lastInteraction,
      maxTokens
    );

    return {
      contextString,
      facts: relevantFacts,
      recentSessions,
      lastInteraction: memory.lastInteraction,
      totalSessions: memory.sessions.length,
      totalFacts: memory.facts.length,
    };
  }

  private buildContextString(
    facts: MemoryFact[],
    sessions: SessionSummary[],
    lastInteraction: ContactMemory['lastInteraction'],
    maxTokens: number
  ): string {
    const parts: string[] = [];

    // Add facts section
    if (facts.length > 0) {
      parts.push('## What you know about this user:');
      for (const fact of facts) {
        parts.push(`- ${fact.value}`);
      }
    }

    // Add recent sessions section
    if (sessions.length > 0) {
      parts.push('\n## Recent conversation history:');
      for (const session of sessions) {
        const dateStr = this.formatRelativeDate(session.date);
        parts.push(`- ${dateStr}: ${session.summary}`);
      }
    }

    // Add continuation context
    if (lastInteraction) {
      const daysSince = this.getDaysSince(lastInteraction.date);
      parts.push('\n## Where you left off:');
      parts.push(`- Last topic: ${lastInteraction.lastTopic}`);
      if (lastInteraction.nextSteps) {
        parts.push(`- Planned next: ${lastInteraction.nextSteps}`);
      }
      if (daysSince > 0) {
        parts.push(`- It's been ${daysSince} day${daysSince > 1 ? 's' : ''} since your last conversation.`);
      }
    }

    // Add instruction
    if (parts.length > 0) {
      parts.push('\n## Instructions:');
      parts.push('- Reference previous conversations naturally when relevant.');
      parts.push('- Offer to continue from where you left off if appropriate.');
      parts.push('- Use what you know about the user to personalize responses.');
    }

    const fullContext = parts.join('\n');

    // Rough token estimation (1 token ≈ 4 chars)
    const estimatedTokens = fullContext.length / 4;
    if (estimatedTokens > maxTokens) {
      // Truncate if too long (keep first N characters)
      return fullContext.substring(0, maxTokens * 4) + '...';
    }

    return fullContext;
  }

  async extractMemoriesFromConversation(
    request: ExtractMemoryRequest
  ): Promise<ExtractMemoryResponse> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('User not authenticated');
    }

    // Call the memory extraction API
    const response = await fetch('/api/memory/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to extract memories');
    }

    return response.json();
  }

  async saveExtractedMemories(
    contactId: string,
    extraction: ExtractMemoryResponse,
    type: 'chat' | 'call',
    metadata?: { duration?: number; messageCount?: number }
  ): Promise<void> {
    const userId = this.getUserId();

    // Save facts and index them for semantic search
    if (extraction.facts.length > 0) {
      const factsWithSource: MemoryFact[] = extraction.facts.map((f) => ({
        ...f,
        source: type,
        extractedAt: new Date(),
      }));

      await this.memoryRepository.saveFacts(userId, contactId, {
        facts: factsWithSource,
      });

      // Index facts for semantic search (non-blocking)
      if (this.embeddingService) {
        this.indexFactsAsync(userId, contactId, factsWithSource);
      }
    }

    // Save session summary
    await this.memoryRepository.saveSession(userId, contactId, {
      type,
      duration: metadata?.duration,
      messageCount: metadata?.messageCount,
      summary: extraction.session.summary,
      keyTopics: extraction.session.keyTopics,
      userMood: extraction.session.userMood,
    });

    // Update last interaction
    await this.memoryRepository.updateLastInteraction(userId, contactId, {
      type,
      lastTopic: extraction.lastInteraction.lastTopic,
      nextSteps: extraction.lastInteraction.nextSteps,
    });
  }

  /**
   * Index facts asynchronously for semantic search.
   * This runs in the background and doesn't block the main flow.
   */
  private async indexFactsAsync(
    userId: string,
    contactId: string,
    facts: MemoryFact[]
  ): Promise<void> {
    if (!this.embeddingService) return;

    try {
      // Index each fact
      const indexPromises = facts.map((fact) =>
        this.embeddingService!.indexFact(userId, contactId, fact).catch((err) => {
          console.warn(`Failed to index fact "${fact.key}":`, err);
        })
      );

      await Promise.all(indexPromises);
      console.log(`[MemoryService] Indexed ${facts.length} facts for semantic search`);
    } catch (err) {
      // Log but don't throw - indexing is non-critical
      console.warn('[MemoryService] Failed to index facts:', err);
    }
  }

  async processConversation(request: ExtractMemoryRequest): Promise<void> {
    const extraction = await this.extractMemoriesFromConversation(request);
    await this.saveExtractedMemories(
      request.contactId,
      extraction,
      request.type,
      { duration: request.duration, messageCount: request.messages.length }
    );
  }

  async getFacts(contactId: string): Promise<MemoryFact[]> {
    const userId = this.getUserId();
    return this.memoryRepository.getFacts(userId, contactId);
  }

  async getRecentSessions(contactId: string, limit = 5): Promise<SessionSummary[]> {
    const userId = this.getUserId();
    return this.memoryRepository.getSessions(userId, contactId, limit);
  }

  async addFact(
    contactId: string,
    key: string,
    value: string,
    source: 'chat' | 'call'
  ): Promise<void> {
    const userId = this.getUserId();
    const fact: MemoryFact = {
      key,
      value,
      source,
      confidence: 1,
      extractedAt: new Date(),
    };

    await this.memoryRepository.saveFacts(userId, contactId, {
      facts: [fact],
    });

    // Index fact for semantic search (non-blocking)
    if (this.embeddingService) {
      this.embeddingService.indexFact(userId, contactId, fact).catch((err) => {
        console.warn(`Failed to index fact "${key}":`, err);
      });
    }
  }

  async deleteFact(contactId: string, factKey: string): Promise<void> {
    const userId = this.getUserId();
    await this.memoryRepository.deleteFact(userId, contactId, factKey);

    // Delete embedding for semantic search (non-blocking)
    if (this.embeddingService) {
      this.embeddingService.deleteFactEmbedding(userId, contactId, factKey).catch((err) => {
        console.warn(`Failed to delete embedding for fact "${factKey}":`, err);
      });
    }
  }

  async clearMemory(contactId: string): Promise<void> {
    const userId = this.getUserId();
    await this.memoryRepository.clearMemory(userId, contactId);
  }

  async generateGreeting(contactId: string, contactName: string): Promise<string> {
    const memory = await this.getMemory(contactId);

    if (!memory?.lastInteraction) {
      return `Hi! I'm ${contactName}. How can I help you today?`;
    }

    const daysSince = this.getDaysSince(memory.lastInteraction.date);
    const lastTopic = memory.lastInteraction.lastTopic;
    const nextSteps = memory.lastInteraction.nextSteps;

    // Same day
    if (daysSince < 1) {
      if (nextSteps) {
        return `Welcome back! Ready to ${nextSteps.toLowerCase()}?`;
      }
      return `Welcome back! Ready to continue with ${lastTopic}?`;
    }

    // Within a week
    if (daysSince < 7) {
      if (nextSteps) {
        return `Hey! Last time we talked about ${lastTopic}. Want to ${nextSteps.toLowerCase()}, or try something new?`;
      }
      return `Hey! Last time we worked on ${lastTopic}. Want to pick up where we left off?`;
    }

    // More than a week
    if (nextSteps) {
      return `Hi again! It's been a while. Last time we discussed ${lastTopic} and planned to ${nextSteps.toLowerCase()}. Should we continue or start fresh?`;
    }
    return `Hi again! It's been ${daysSince} days. Last time we discussed ${lastTopic}. Should we review or try something new?`;
  }

  // Helper methods

  private getDaysSince(date: Date): number {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  private formatRelativeDate(date: Date): string {
    const days = this.getDaysSince(date);

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${days >= 14 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
}
