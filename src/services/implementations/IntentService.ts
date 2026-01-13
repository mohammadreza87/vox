/**
 * Intent Service Implementation
 *
 * Pattern-based intent classification for user messages.
 * No LLM call needed - uses regex patterns for fast, deterministic classification.
 */

import {
  IntentAction,
  IntentClassification,
  INTENT_CONTEXT_MODES,
} from '@/shared/types';
import { IIntentService } from '../interfaces/IIntentService';

/**
 * Intent detection patterns
 * Each pattern array is tested in order; first match wins
 */
const INTENT_PATTERNS: Record<IntentAction, RegExp[]> = {
  learn: [
    /^(my name is|i('m| am)|i work|i live|i like|i have|i want to learn)/i,
    /^(call me|you can call me)/i,
    /\b(my|i'm|i am)\b.*(name|called|from|work|job|hobby|favorite|prefer)/i,
    /^(i('m| am) (a|an|the)|i (work|live|study))/i,
  ],
  practice: [
    /^(let'?s? practice|can we practice|help me practice|i want to practice)/i,
    /^(quiz me|test me|give me a|let'?s? do)/i,
    /\b(practice|drill|exercise|quiz|test)\b/i,
    /^(can you|could you|would you).*(quiz|test|practice)/i,
  ],
  explain: [
    /^(what is|what are|what does|how do|why is|can you explain)/i,
    /^(tell me about|explain|describe|what'?s? the)/i,
    /^(how (do|does|can|should)|why (do|does|is|are))/i,
    /\?(what|how|why|when|where|which)\b/i,
  ],
  help: [
    /^(help|can you help|i need help|assist|support)/i,
    /^(i('m| am) (stuck|confused|lost|struggling))/i,
    /\b(help me|assist me|guide me)\b/i,
  ],
  feedback: [
    /^(how did i do|was that|is this correct|check this)/i,
    /^(rate my|review my|feedback on|what do you think)/i,
    /\b(correct|right|wrong|good|bad)\?/i,
    /^(did i|am i|was i).*(right|correct|good)/i,
  ],
  continue: [
    /^(let'?s? continue|where were we|pick up|continue from)/i,
    /^(back to|resume|go on|keep going)/i,
    /\b(continue|resume|pick up|where we left)\b/i,
  ],
  new_topic: [
    /^(new topic|something else|let'?s? talk about|change topic)/i,
    /^(can we (talk|discuss|switch)|i want to (talk|discuss))/i,
    /\b(different topic|change subject|something new)\b/i,
  ],
  chat: [], // Default fallback, no specific patterns
};

/**
 * Simple question patterns (yes/no, short answers)
 */
const SIMPLE_QUESTION_PATTERNS = [
  /^(yes|no|yeah|nope|sure|okay|ok|yep|nah)[\s!?.]*$/i,
  /^(i think so|i guess|maybe|probably|definitely|absolutely)[\s!?.]*$/i,
  /^.{1,20}[\s!?.]*$/i, // Very short messages (under 20 chars)
];

/**
 * Extract keywords from message
 */
function extractKeywords(message: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'can',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'i', 'me', 'my', 'we', 'you', 'your', 'it', 'its', 'this',
    'that', 'these', 'those', 'and', 'or', 'but', 'if', 'then',
  ]);

  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 10); // Limit to 10 keywords
}

/**
 * Check if message is a simple question/response
 */
function isSimpleQuestion(message: string): boolean {
  return SIMPLE_QUESTION_PATTERNS.some(pattern => pattern.test(message.trim()));
}

export class IntentService implements IIntentService {
  classifyIntent(
    message: string,
    contactPurpose?: string
  ): IntentClassification {
    const trimmedMessage = message.trim();
    const keywords = extractKeywords(trimmedMessage);
    const isSimple = isSimpleQuestion(trimmedMessage);

    // Check each intent pattern
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      if (intent === 'chat') continue; // Skip default

      for (const pattern of patterns) {
        if (pattern.test(trimmedMessage)) {
          const action = intent as IntentAction;
          return {
            action,
            confidence: 0.85,
            keywords,
            isSimpleQuestion: isSimple,
            suggestedContextMode: INTENT_CONTEXT_MODES[action],
          };
        }
      }
    }

    // Check for contact-specific hints
    if (contactPurpose) {
      const purposeLower = contactPurpose.toLowerCase();

      // If talking to a tutor and message contains learning-related words
      if (purposeLower.includes('tutor') || purposeLower.includes('teacher')) {
        if (/\b(learn|practice|help|explain)\b/i.test(trimmedMessage)) {
          return {
            action: 'practice',
            confidence: 0.7,
            keywords,
            isSimpleQuestion: isSimple,
            suggestedContextMode: 'full',
          };
        }
      }

      // If talking to a coach and asking for feedback
      if (purposeLower.includes('coach') || purposeLower.includes('mentor')) {
        if (/\b(think|feel|opinion|advice)\b/i.test(trimmedMessage)) {
          return {
            action: 'feedback',
            confidence: 0.7,
            keywords,
            isSimpleQuestion: isSimple,
            suggestedContextMode: 'focused',
          };
        }
      }
    }

    // Default to chat
    return {
      action: 'chat',
      confidence: 0.5,
      keywords,
      isSimpleQuestion: isSimple,
      suggestedContextMode: isSimple ? 'minimal' : 'full',
    };
  }
}
