/**
 * Intent Service Interface
 *
 * Defines operations for classifying user message intent
 */

import { IntentClassification } from '@/shared/types';

export interface IIntentService {
  /**
   * Classify the intent of a user message
   *
   * @param message - The user's message
   * @param contactPurpose - Optional contact purpose for context
   * @returns Classification result with action, confidence, and recommendations
   */
  classifyIntent(
    message: string,
    contactPurpose?: string
  ): IntentClassification;
}
