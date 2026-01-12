'use client';

/**
 * useContactMemory Hook
 *
 * React hook for accessing and managing contact memory
 * Provides memory context for chat and voice interactions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ContactMemory, MemoryContext, ExtractMemoryRequest } from '@/shared/types';
import { getMemoryService } from '@/services/container';
import { getAuthToken } from '@/stores/middleware/sync';
import {
  buildPromptWithMemory,
  extractAndSaveMemory,
  shouldExtractMemory,
  getMemorySummary,
} from '@/lib/memory/context';

interface UseContactMemoryOptions {
  contactId: string | null;
  enabled?: boolean;
}

interface UseContactMemoryReturn {
  /** Full memory object */
  memory: ContactMemory | null;
  /** Formatted context for prompt injection */
  memoryContext: MemoryContext | null;
  /** Whether memory is being loaded */
  isLoading: boolean;
  /** Error if loading failed */
  error: Error | null;
  /** Build enriched prompt with memory */
  buildEnrichedPrompt: (basePrompt: string) => string;
  /** Extract and save memory from conversation */
  saveMemory: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    type: 'chat' | 'call';
    duration?: number;
  }) => Promise<void>;
  /** Generate context-aware greeting */
  generateGreeting: (contactName: string) => Promise<string>;
  /** Refresh memory data */
  refresh: () => Promise<void>;
  /** Memory summary for UI display */
  summary: ReturnType<typeof getMemorySummary>;
}

/**
 * Hook for accessing contact memory in React components
 *
 * @example
 * ```tsx
 * const {
 *   memoryContext,
 *   buildEnrichedPrompt,
 *   saveMemory,
 *   generateGreeting,
 * } = useContactMemory({ contactId: selectedContact?.id ?? null });
 *
 * // Before sending a message
 * const enrichedPrompt = buildEnrichedPrompt(contact.systemPrompt);
 *
 * // After conversation ends
 * await saveMemory({ messages, type: 'chat' });
 * ```
 */
export function useContactMemory({
  contactId,
  enabled = true,
}: UseContactMemoryOptions): UseContactMemoryReturn {
  const [memory, setMemory] = useState<ContactMemory | null>(null);
  const [memoryContext, setMemoryContext] = useState<MemoryContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track current contactId to prevent stale updates
  const currentContactIdRef = useRef(contactId);
  currentContactIdRef.current = contactId;

  // Load memory context when contactId changes
  const loadMemory = useCallback(async () => {
    if (!contactId || !enabled) {
      setMemory(null);
      setMemoryContext(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const memoryService = getMemoryService();
      const [fetchedMemory, context] = await Promise.all([
        memoryService.getMemory(contactId),
        memoryService.buildContextForContact(contactId),
      ]);

      // Only update if contactId hasn't changed
      if (currentContactIdRef.current === contactId) {
        setMemory(fetchedMemory);
        setMemoryContext(context);
      }
    } catch (err) {
      if (currentContactIdRef.current === contactId) {
        setError(err instanceof Error ? err : new Error('Failed to load memory'));
      }
    } finally {
      if (currentContactIdRef.current === contactId) {
        setIsLoading(false);
      }
    }
  }, [contactId, enabled]);

  // Load memory on mount and when contactId changes
  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  // Build prompt with memory context
  const buildEnrichedPrompt = useCallback(
    (basePrompt: string): string => {
      return buildPromptWithMemory(basePrompt, memoryContext);
    },
    [memoryContext]
  );

  // Save memory from conversation
  const saveMemory = useCallback(
    async (params: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      type: 'chat' | 'call';
      duration?: number;
    }) => {
      if (!contactId) {
        return;
      }

      // Check if conversation has enough substance
      if (!shouldExtractMemory(params.messages)) {
        return;
      }

      const token = await getAuthToken();
      if (!token) {
        console.warn('Cannot save memory: not authenticated');
        return;
      }

      await extractAndSaveMemory({
        contactId,
        messages: params.messages,
        type: params.type,
        duration: params.duration,
        authToken: token,
      });

      // Refresh memory after saving (with a small delay to allow processing)
      setTimeout(() => loadMemory(), 1000);
    },
    [contactId, loadMemory]
  );

  // Generate context-aware greeting
  const generateGreeting = useCallback(
    async (contactName: string): Promise<string> => {
      if (!contactId) {
        return `Hi! I'm ${contactName}. How can I help you today?`;
      }

      try {
        const memoryService = getMemoryService();
        return await memoryService.generateGreeting(contactId, contactName);
      } catch (err) {
        console.error('Failed to generate greeting:', err);
        return `Hi! I'm ${contactName}. How can I help you today?`;
      }
    },
    [contactId]
  );

  // Refresh memory
  const refresh = useCallback(async () => {
    await loadMemory();
  }, [loadMemory]);

  // Memory summary for UI
  const summary = getMemorySummary(memory);

  return {
    memory,
    memoryContext,
    isLoading,
    error,
    buildEnrichedPrompt,
    saveMemory,
    generateGreeting,
    refresh,
    summary,
  };
}

export default useContactMemory;
