/**
 * Token Budget Service Interface
 *
 * Defines operations for token estimation and budget management
 */

import { Message, IntentAction, TokenBudget, PreflightResult } from '@/shared/types';

export interface ITokenBudgetService {
  /**
   * Estimate tokens for a text string
   * Uses approximation: 1 token ≈ 4 characters
   */
  estimateTokens(text: string): number;

  /**
   * Get token budget based on intent and subscription tier
   */
  getBudget(intent: IntentAction, tier: string): TokenBudget;

  /**
   * Perform preflight estimation before request
   * Returns estimate, budget, and recommendations
   */
  preflight(
    message: string,
    systemPrompt: string,
    memoryContext: string,
    history: Message[],
    intent: IntentAction,
    tier: string
  ): PreflightResult;

  /**
   * Trim conversation history to fit within target token count
   * Removes oldest messages first, keeps most recent
   */
  trimHistory(
    history: Message[],
    targetTokens: number
  ): Message[];
}
