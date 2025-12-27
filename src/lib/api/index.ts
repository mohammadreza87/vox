/**
 * API Client
 * Centralized API layer for Vox
 *
 * Usage:
 * ```typescript
 * import { chatApi, voiceApi, subscriptionApi } from '@/lib/api';
 *
 * // Get chats
 * const chats = await chatApi.getChats();
 *
 * // Generate TTS
 * const audioUrl = await voiceApi.textToSpeech('Hello', 'voice_id');
 *
 * // Get subscription
 * const { subscription, usage } = await subscriptionApi.getSubscription();
 * ```
 */

// Core client
export { api, ApiClient } from './client';

// Error handling
export { ApiError, getErrorMessage, ERROR_MESSAGES } from './errors';
export type { ApiErrorCode, ApiErrorDetails } from './errors';

// Types
export type * from './types';

// API Modules
import * as chatApi from './modules/chat';
import * as userApi from './modules/user';
import * as subscriptionApi from './modules/subscription';
import * as voiceApi from './modules/voice';
import * as translatorApi from './modules/translator';
import * as contactsApi from './modules/contacts';
import * as telegramApi from './modules/telegram';

export { chatApi, userApi, subscriptionApi, voiceApi, translatorApi, contactsApi, telegramApi };

// Convenience re-exports for common operations
export {
  // Chat
  getChats,
  createChat,
  getChat,
  deleteChat,
  getMessages,
  addMessage,
  syncChats,
  getMigrationStatus,
  runMigration,
} from './modules/chat';

export {
  // User
  getPreferences,
  updatePreferences,
  setTheme,
} from './modules/user';

export {
  // Subscription
  getSubscription,
  createCheckoutSession,
  createPortalSession,
} from './modules/subscription';

export {
  // Voice
  textToSpeech,
  cloneVoice,
  generateResponse,
  streamResponse,
} from './modules/voice';

export {
  // Translator
  translate,
  translatorTTS,
} from './modules/translator';

export {
  // Contacts
  getCustomContacts,
  createCustomContact,
  updateCustomContact,
  deleteCustomContact,
} from './modules/contacts';
