/**
 * Token Budget Service Implementation
 *
 * Handles token estimation, budgeting, and history trimming
 * for optimizing context within token limits.
 */

import {
  Message,
  IntentAction,
  TokenBudget,
  TokenEstimate,
  PreflightResult,
  CHARS_PER_TOKEN,
  RESERVED_FOR_RESPONSE,
  TIER_MULTIPLIERS,
  DEFAULT_TIER_MULTIPLIER,
  INTENT_TOKEN_BUDGETS,
} from '@/shared/types';
import { ITokenBudgetService } from '../interfaces/ITokenBudgetService';

/**
 * Minimum tokens to keep for search results
 */
const MIN_SEARCH_TOKENS = 200;

/**
 * Minimum messages to keep in history
 */
const MIN_HISTORY_MESSAGES = 2;

export class TokenBudgetService implements ITokenBudgetService {
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  getBudget(intent: IntentAction, tier: string): TokenBudget {
    // Get base budget for intent
    const baseBudget = INTENT_TOKEN_BUDGETS[intent] || INTENT_TOKEN_BUDGETS.chat;

    // Apply tier multiplier
    const multiplier = TIER_MULTIPLIERS[tier] || DEFAULT_TIER_MULTIPLIER;
    const maxTotal = Math.round(baseBudget * multiplier);

    return {
      maxTotal,
      reservedForResponse: RESERVED_FOR_RESPONSE,
      available: maxTotal - RESERVED_FOR_RESPONSE,
    };
  }

  preflight(
    message: string,
    systemPrompt: string,
    memoryContext: string,
    history: Message[],
    intent: IntentAction,
    tier: string
  ): PreflightResult {
    // Calculate individual component estimates
    const systemPromptTokens = this.estimateTokens(systemPrompt);
    const memoryContextTokens = this.estimateTokens(memoryContext);
    const messageTokens = this.estimateTokens(message);

    // Estimate history tokens
    const historyTokens = history.reduce(
      (sum, msg) => sum + this.estimateTokens(msg.content),
      0
    );

    // Reserve space for potential search results
    const searchResultsTokens = MIN_SEARCH_TOKENS;

    // Calculate total
    const total =
      systemPromptTokens +
      memoryContextTokens +
      historyTokens +
      messageTokens +
      searchResultsTokens;

    const estimate: TokenEstimate = {
      systemPrompt: systemPromptTokens,
      memoryContext: memoryContextTokens,
      conversationHistory: historyTokens,
      searchResults: searchResultsTokens,
      total,
    };

    // Get budget
    const budget = this.getBudget(intent, tier);

    // Determine if within budget and generate recommendations
    const withinBudget = total <= budget.available;
    const recommendations: PreflightResult['recommendations'] = {};

    if (!withinBudget) {
      const excess = total - budget.available;

      // First recommendation: trim history
      if (historyTokens > 0 && history.length > MIN_HISTORY_MESSAGES) {
        const targetHistoryTokens = Math.max(0, historyTokens - excess);
        const messagesToRemove = this.calculateMessagesToRemove(
          history,
          historyTokens - targetHistoryTokens
        );
        if (messagesToRemove > 0) {
          recommendations.trimHistory = messagesToRemove;
        }
      }

      // Second recommendation: reduce memory
      if (excess > historyTokens / 2 && memoryContextTokens > 100) {
        recommendations.reduceMemory = true;
      }

      // Third recommendation: skip search (last resort)
      if (excess > historyTokens + memoryContextTokens / 2) {
        recommendations.skipSearch = true;
      }
    }

    return {
      estimate,
      budget,
      withinBudget,
      recommendations,
    };
  }

  trimHistory(history: Message[], targetTokens: number): Message[] {
    if (history.length <= MIN_HISTORY_MESSAGES) {
      return history;
    }

    // Calculate current tokens
    let currentTokens = history.reduce(
      (sum, msg) => sum + this.estimateTokens(msg.content),
      0
    );

    // If already under target, return as-is
    if (currentTokens <= targetTokens) {
      return history;
    }

    // Remove oldest messages until under target
    // Keep the most recent messages (end of array)
    const result = [...history];

    while (result.length > MIN_HISTORY_MESSAGES && currentTokens > targetTokens) {
      const removed = result.shift(); // Remove oldest
      if (removed) {
        currentTokens -= this.estimateTokens(removed.content);
      }
    }

    return result;
  }

  /**
   * Calculate how many messages to remove to save target tokens
   */
  private calculateMessagesToRemove(
    history: Message[],
    tokensToSave: number
  ): number {
    let savedTokens = 0;
    let messagesToRemove = 0;

    // Start from oldest messages
    for (let i = 0; i < history.length - MIN_HISTORY_MESSAGES; i++) {
      savedTokens += this.estimateTokens(history[i].content);
      messagesToRemove++;

      if (savedTokens >= tokensToSave) {
        break;
      }
    }

    return messagesToRemove;
  }
}
