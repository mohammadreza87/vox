/**
 * Memory Service Interface
 * Defines business logic operations for contact memory/context engineering
 */

import {
  ContactMemory,
  MemoryContext,
  ExtractMemoryRequest,
  ExtractMemoryResponse,
  MemoryFact,
  SessionSummary,
} from '@/shared/types';

export interface BuildContextOptions {
  maxFacts?: number;        // Maximum facts to include (default: 10)
  maxSessions?: number;     // Maximum session summaries (default: 3)
  maxTokens?: number;       // Approximate token limit (default: 500)
}

export interface IMemoryService {
  /**
   * Get complete memory for a contact
   */
  getMemory(contactId: string): Promise<ContactMemory | null>;

  /**
   * Build context string for injection into system prompt
   * Returns formatted memory context optimized for LLM consumption
   */
  buildContextForContact(contactId: string, options?: BuildContextOptions): Promise<MemoryContext>;

  /**
   * Extract memories from a conversation using LLM
   * Analyzes conversation and extracts facts, summary, and continuation context
   */
  extractMemoriesFromConversation(request: ExtractMemoryRequest): Promise<ExtractMemoryResponse>;

  /**
   * Save extracted memories to storage
   * Called after extractMemoriesFromConversation
   */
  saveExtractedMemories(
    contactId: string,
    extraction: ExtractMemoryResponse,
    type: 'chat' | 'call',
    metadata?: { duration?: number; messageCount?: number }
  ): Promise<void>;

  /**
   * Convenience method: Extract and save in one call
   */
  processConversation(request: ExtractMemoryRequest): Promise<void>;

  /**
   * Get facts for a contact
   */
  getFacts(contactId: string): Promise<MemoryFact[]>;

  /**
   * Get recent sessions for a contact
   */
  getRecentSessions(contactId: string, limit?: number): Promise<SessionSummary[]>;

  /**
   * Manually add a fact
   */
  addFact(contactId: string, key: string, value: string, source: 'chat' | 'call'): Promise<void>;

  /**
   * Delete a fact
   */
  deleteFact(contactId: string, factKey: string): Promise<void>;

  /**
   * Clear all memory for a contact
   */
  clearMemory(contactId: string): Promise<void>;

  /**
   * Generate a context-aware greeting based on memory
   */
  generateGreeting(contactId: string, contactName: string): Promise<string>;
}
