/**
 * Zustand Stores
 * Centralized state management for Vox
 */

// Store Provider (main entry point)
export { StoreProvider } from './StoreProvider';

// Backward-compatible hooks (use these during migration)
export {
  useAuth,
  useTheme,
  useChat,
  useCustomContacts,
  useSubscription,
  useTranslator,
} from './StoreProvider';

// Direct store access (prefer backward-compatible hooks above)
export { useAuthStore, initAuthListener, getCurrentUserId } from './authStore';
export { useThemeStore, initTheme } from './themeStore';
export { useSubscriptionStore, useSubscriptionSelectors, initSubscription } from './subscriptionStore';
export { useChatStore, initChats } from './chatStore';
export { useContactsStore, initContacts } from './contactsStore';
export { useTranslatorStore, initTranslator, getSampleText, SUPPORTED_LANGUAGES } from './translatorStore';
export { usePlatformStore, usePlatform, useIsTelegram, useIsMobile, useTelegramUser, usePlatformAdapter } from './platformStore';

// Types
export type {
  Theme,
  AuthStore,
  ThemeStore,
  SubscriptionStore,
  ChatStore,
  ContactsStore,
  TranslatorStore,
  TranslatorVoice,
  LanguageCode,
  Platform,
  PlatformStore,
} from './types';

// Middleware
export {
  clearPersistedState,
  getStorageKey,
  loadPersistedState,
  savePersistedState,
  createPersistHelpers,
} from './middleware/persist';
export { createCloudSync, loadFromCloud, getAuthToken, syncOnUserChange } from './middleware/sync';
