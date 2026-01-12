/**
 * Memory Context Utilities
 *
 * Helper functions for building prompts with memory context
 */

import { MemoryContext, ContactMemory } from '@/shared/types';

/**
 * Build a system prompt enriched with memory context
 *
 * @param basePrompt - The contact's original system prompt
 * @param memoryContext - The formatted memory context
 * @returns Enriched system prompt
 */
export function buildPromptWithMemory(
  basePrompt: string,
  memoryContext: MemoryContext | null
): string {
  if (!memoryContext || !memoryContext.contextString) {
    return basePrompt;
  }

  // Insert memory context before the base prompt
  return `${memoryContext.contextString}\n\n---\n\n${basePrompt}`;
}

/**
 * Extract memory from a conversation and save it
 * This is a client-side helper that calls the API
 */
export async function extractAndSaveMemory(params: {
  contactId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  type: 'chat' | 'call';
  duration?: number;
  authToken: string;
}): Promise<void> {
  const { contactId, messages, type, duration, authToken } = params;

  // Skip if conversation is too short
  if (messages.length < 2) {
    return;
  }

  try {
    const response = await fetch('/api/memory/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        contactId,
        messages: messages.map((m, i) => ({
          role: m.role,
          content: m.content,
          timestamp: Date.now() - (messages.length - i) * 1000, // Approximate timestamps
        })),
        type,
        duration,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to extract memory');
    }

    // The extraction API already saves the memory
    // This could be enhanced to return the extraction result for immediate use
  } catch (error) {
    // Log but don't throw - memory extraction is non-blocking
    console.error('Memory extraction failed:', error);
  }
}

/**
 * Check if we should extract memory from this conversation
 * Returns true if conversation has enough substance
 */
export function shouldExtractMemory(
  messages: Array<{ role: string; content: string }>
): boolean {
  // Minimum 3 exchanges (user-assistant pairs)
  if (messages.length < 4) {
    return false;
  }

  // At least 100 total characters of content
  const totalLength = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalLength < 100) {
    return false;
  }

  return true;
}

/**
 * Format days since last interaction for display
 */
export function formatTimeSince(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get a summary of memory for display in UI
 */
export function getMemorySummary(memory: ContactMemory | null): {
  factCount: number;
  sessionCount: number;
  lastInteraction: string | null;
  hasMemory: boolean;
} {
  if (!memory) {
    return {
      factCount: 0,
      sessionCount: 0,
      lastInteraction: null,
      hasMemory: false,
    };
  }

  return {
    factCount: memory.facts.length,
    sessionCount: memory.sessions.length,
    lastInteraction: memory.lastInteraction
      ? formatTimeSince(memory.lastInteraction.date)
      : null,
    hasMemory: memory.facts.length > 0 || memory.sessions.length > 0,
  };
}
