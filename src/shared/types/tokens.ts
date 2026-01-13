/**
 * Token Budgeting Types
 *
 * Types for managing token usage and context budgets
 */

import { Message } from './index';
import { IntentAction } from './intent';

/**
 * Breakdown of token usage by component
 */
export interface TokenEstimate {
  /** Tokens for system prompt */
  systemPrompt: number;

  /** Tokens for memory context */
  memoryContext: number;

  /** Tokens for conversation history */
  conversationHistory: number;

  /** Tokens for semantic search results */
  searchResults: number;

  /** Total estimated tokens */
  total: number;
}

/**
 * Token budget configuration
 */
export interface TokenBudget {
  /** Maximum total tokens for request */
  maxTotal: number;

  /** Tokens reserved for AI response */
  reservedForResponse: number;

  /** Available tokens for context */
  available: number;
}

/**
 * Result of preflight token estimation
 */
export interface PreflightResult {
  /** Detailed token estimate */
  estimate: TokenEstimate;

  /** Token budget based on intent/tier */
  budget: TokenBudget;

  /** Whether estimate is within budget */
  withinBudget: boolean;

  /** Recommendations to fit within budget */
  recommendations: {
    /** Number of history messages to remove */
    trimHistory?: number;

    /** Use minimal memory context */
    reduceMemory?: boolean;

    /** Skip semantic search */
    skipSearch?: boolean;
  };
}

/**
 * Characters per token approximation
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Tokens reserved for AI response
 */
export const RESERVED_FOR_RESPONSE = 1024;

/**
 * Model context limits
 */
export const MODEL_LIMITS: Record<string, number> = {
  'gpt-4o-mini': 128000,
  'gpt-4o': 128000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-sonnet-4-20250514': 200000,
  'gemini-2.0-flash-001': 1000000,
  'gemini-2.0-pro-exp-02-05': 1000000,
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
};

/**
 * Budget multipliers by subscription tier
 */
export const TIER_MULTIPLIERS: Record<string, number> = {
  free: 0.5,      // Half budget for free users
  pro: 1.0,       // Full budget
  max: 1.5,       // Extra budget for max tier
};

/**
 * Default budget when tier unknown
 */
export const DEFAULT_TIER_MULTIPLIER = 1.0;
