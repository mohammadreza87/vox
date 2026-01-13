/**
 * Intent Classification Types
 *
 * Types for classifying user message intent to optimize context building
 */

/**
 * Possible user intent actions
 */
export type IntentAction =
  | 'chat'        // General conversation
  | 'learn'       // User sharing info about themselves
  | 'practice'    // Practice/exercise request
  | 'explain'     // Ask for explanation
  | 'help'        // Request assistance
  | 'feedback'    // Ask for feedback
  | 'continue'    // Continue from previous topic
  | 'new_topic';  // Start new discussion

/**
 * Result of intent classification
 */
export interface IntentClassification {
  /** Classified action type */
  action: IntentAction;

  /** Confidence score 0-1 */
  confidence: number;

  /** Keywords extracted from message */
  keywords: string[];

  /** Whether this is a simple yes/no or short question */
  isSimpleQuestion: boolean;

  /** Suggested context mode based on intent */
  suggestedContextMode: 'full' | 'minimal' | 'focused';
}

/**
 * Token budgets by intent type
 */
export const INTENT_TOKEN_BUDGETS: Record<IntentAction, number> = {
  chat: 800,         // General: moderate context
  learn: 600,        // Learning facts: less context needed
  practice: 1000,    // Practice: need full context for exercises
  explain: 500,      // Explanations: focused context
  help: 1000,        // Help: full context
  feedback: 800,     // Feedback: moderate context
  continue: 1200,    // Continue: need more history
  new_topic: 400,    // New topic: minimal context
};

/**
 * Context modes by intent
 */
export const INTENT_CONTEXT_MODES: Record<IntentAction, 'full' | 'minimal' | 'focused'> = {
  chat: 'full',
  learn: 'minimal',
  practice: 'full',
  explain: 'focused',
  help: 'full',
  feedback: 'focused',
  continue: 'full',
  new_topic: 'minimal',
};
