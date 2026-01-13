'use client';

/**
 * useContactMemory Hook
 *
 * React hook for accessing and managing contact memory
 * Provides memory context for chat and voice interactions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ContactMemory,
  MemoryContext,
  ExtractMemoryRequest,
  Message,
  IntentClassification,
  SimilarFact,
  PreflightResult,
} from '@/shared/types';
import {
  getMemoryService,
  getIntentService,
  getTokenBudgetService,
  getEmbeddingService,
} from '@/services/container';
import { getAuthToken } from '@/stores/middleware/sync';
import {
  buildPromptWithMemory,
  buildEnrichedPromptWithSearch,
  extractAndSaveMemory,
  shouldExtractMemory,
  getMemorySummary,
} from '@/lib/memory/context';

interface UseContactMemoryOptions {
  contactId: string | null;
  userId?: string | null;
  tier?: string;
  enabled?: boolean;
}

/**
 * Result from buildSmartContext with intent classification,
 * token budgeting, and semantic search integration
 */
export interface SmartContextResult {
  /** Enriched system prompt with all context */
  systemPrompt: string;
  /** Trimmed conversation history */
  conversationHistory: Message[];
  /** Classified intent */
  intent: IntentClassification;
  /** Total estimated tokens */
  tokensUsed: number;
  /** Semantic search results included */
  searchResults: SimilarFact[];
  /** Preflight result with budget info */
  preflight: PreflightResult;
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
  /**
   * Build smart context with intent classification, token budgeting, and semantic search.
   * This is the recommended way to build context for new messages.
   */
  buildSmartContext: (params: {
    message: string;
    basePrompt: string;
    history: Message[];
    contactPurpose?: string;
  }) => Promise<SmartContextResult>;
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
  userId = null,
  tier = 'free',
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

  // Build smart context with intent classification, token budgeting, and semantic search
  const buildSmartContext = useCallback(
    async (params: {
      message: string;
      basePrompt: string;
      history: Message[];
      contactPurpose?: string;
    }): Promise<SmartContextResult> => {
      const { message, basePrompt, history, contactPurpose } = params;

      // Get services
      const intentService = getIntentService();
      const tokenBudgetService = getTokenBudgetService();
      const embeddingService = getEmbeddingService();

      // 1. Classify intent
      const intent = intentService.classifyIntent(message, contactPurpose);

      // 2. Get token budget based on intent and tier
      const budget = tokenBudgetService.getBudget(intent.action, tier);

      // 3. Preflight estimation
      const preflight = tokenBudgetService.preflight(
        message,
        basePrompt,
        memoryContext?.contextString || '',
        history,
        intent.action,
        tier
      );

      // 4. Semantic search (if budget allows and we have userId/contactId)
      let searchResults: SimilarFact[] = [];
      if (!preflight.recommendations.skipSearch && userId && contactId) {
        try {
          const search = await embeddingService.searchSimilarFacts(
            userId,
            contactId,
            message
          );
          searchResults = search.results;
        } catch (err) {
          // Log but don't fail - semantic search is an enhancement
          console.warn('Semantic search failed:', err);
        }
      }

      // 5. Trim history if needed
      const trimmedHistory =
        preflight.recommendations.trimHistory && preflight.recommendations.trimHistory > 0
          ? tokenBudgetService.trimHistory(
              history,
              preflight.estimate.conversationHistory - preflight.recommendations.trimHistory * 50
            )
          : history;

      // 6. Build enriched prompt
      const systemPrompt = buildEnrichedPromptWithSearch(
        basePrompt,
        preflight.recommendations.reduceMemory ? null : memoryContext,
        searchResults,
        intent
      );

      // Log context building for debugging
      console.log(
        `[SmartContext] Intent: ${intent.action} (${Math.round(intent.confidence * 100)}%), ` +
          `Budget: ${budget.available} tokens, ` +
          `Estimated: ${preflight.estimate.total} tokens, ` +
          `Search results: ${searchResults.length}`
      );

      return {
        systemPrompt,
        conversationHistory: trimmedHistory,
        intent,
        tokensUsed: preflight.estimate.total,
        searchResults,
        preflight,
      };
    },
    [contactId, userId, tier, memoryContext]
  );

  // Memory summary for UI
  const summary = getMemorySummary(memory);

  return {
    memory,
    memoryContext,
    isLoading,
    error,
    buildEnrichedPrompt,
    buildSmartContext,
    saveMemory,
    generateGreeting,
    refresh,
    summary,
  };
}

export default useContactMemory;
