/**
 * Memory Repository Interface
 * Defines the contract for contact memory data access operations.
 * Used for storing and retrieving conversation context/memory.
 */

import {
  ContactMemory,
  MemoryFact,
  SessionSummary,
  LastInteraction,
} from '@/shared/types';

export interface SaveFactsInput {
  facts: Omit<MemoryFact, 'extractedAt'>[];
}

export interface SaveSessionInput {
  type: 'chat' | 'call';
  duration?: number;
  messageCount?: number;
  summary: string;
  keyTopics: string[];
  userMood?: string;
}

export interface UpdateLastInteractionInput {
  type: 'chat' | 'call';
  lastTopic: string;
  nextSteps?: string;
}

export interface IMemoryRepository {
  /**
   * Get complete memory for a contact
   */
  getMemory(userId: string, contactId: string): Promise<ContactMemory | null>;

  /**
   * Get memories for multiple contacts (batch operation)
   */
  getMemoriesForContacts(userId: string, contactIds: string[]): Promise<Map<string, ContactMemory>>;

  /**
   * Create or initialize memory for a contact
   */
  createMemory(userId: string, contactId: string): Promise<ContactMemory>;

  /**
   * Add new facts to a contact's memory
   * Merges with existing facts, updating duplicates by key
   */
  saveFacts(userId: string, contactId: string, input: SaveFactsInput): Promise<void>;

  /**
   * Add a session summary to memory
   */
  saveSession(userId: string, contactId: string, input: SaveSessionInput): Promise<void>;

  /**
   * Update the last interaction context
   */
  updateLastInteraction(userId: string, contactId: string, input: UpdateLastInteractionInput): Promise<void>;

  /**
   * Get only the facts for a contact
   */
  getFacts(userId: string, contactId: string): Promise<MemoryFact[]>;

  /**
   * Get recent sessions for a contact
   */
  getSessions(userId: string, contactId: string, limit?: number): Promise<SessionSummary[]>;

  /**
   * Delete a specific fact by key
   */
  deleteFact(userId: string, contactId: string, factKey: string): Promise<void>;

  /**
   * Clear all memory for a contact
   */
  clearMemory(userId: string, contactId: string): Promise<void>;

  /**
   * Delete memory document entirely
   */
  deleteMemory(userId: string, contactId: string): Promise<void>;
}
