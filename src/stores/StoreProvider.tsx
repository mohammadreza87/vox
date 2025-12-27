'use client';

import { useEffect, useRef, ReactNode } from 'react';
import {
  useAuthStore,
  initAuthListener,
  useThemeStore,
  initTheme,
  useChatStore,
  initChats,
  useContactsStore,
  initContacts,
  useSubscriptionStore,
  initSubscription,
  useTranslatorStore,
  initTranslator,
} from './index';

interface StoreProviderProps {
  children: ReactNode;
}

/**
 * StoreProvider
 * Initializes all Zustand stores and handles auth state changes
 */
export function StoreProvider({ children }: StoreProviderProps) {
  const initialized = useRef(false);
  const previousUserId = useRef<string | null>(null);

  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.loading);
  const authInitialized = useAuthStore((state) => state.initialized);

  // Initialize auth listener on mount
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      const unsubscribe = initAuthListener();
      return () => unsubscribe();
    }
  }, []);

  // Initialize theme on mount
  useEffect(() => {
    const themeStore = useThemeStore.getState();
    themeStore.syncFromDocument();
    themeStore.setMounted(true);
  }, []);

  // Initialize translator on mount
  useEffect(() => {
    initTranslator();
  }, []);

  // Handle user state changes
  useEffect(() => {
    if (!authInitialized) return;

    const currentUserId = user?.uid || null;

    // User changed - reload data
    if (currentUserId !== previousUserId.current) {
      previousUserId.current = currentUserId;

      // Initialize stores with user data
      const initializeUserData = async () => {
        // Theme
        await initTheme(currentUserId);

        // Subscription
        if (currentUserId) {
          await initSubscription();
        }

        // Chats
        await initChats();

        // Contacts
        await initContacts();

        // Translator (reload with new user key)
        initTranslator();
      };

      initializeUserData();
    }
  }, [user, authInitialized]);

  return <>{children}</>;
}

/**
 * Backward-compatible hooks
 * These hooks provide the same API as the original contexts
 * but use Zustand stores under the hood
 */

// Auth hook (compatible with useAuth from AuthContext)
export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const signIn = useAuthStore((state) => state.signIn);
  const signUp = useAuthStore((state) => state.signUp);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const logout = useAuthStore((state) => state.logout);
  const updateUserProfile = useAuthStore((state) => state.updateUserProfile);

  return {
    user,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    logout,
    updateUserProfile,
  };
}

// Theme hook (compatible with useTheme from ThemeContext)
export function useTheme() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return { theme, toggleTheme, setTheme };
}

// Chat hook (compatible with useChat from ChatContext)
export function useChat() {
  const chats = useChatStore((state) => state.chats);
  const activeChat = useChatStore((state) => state.activeChat);
  const setActiveChat = useChatStore((state) => state.setActiveChat);
  const startChat = useChatStore((state) => state.startChat);
  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const updateLastMessage = useChatStore((state) => state.updateLastMessage);
  const deleteChat = useChatStore((state) => state.deleteChat);
  const getChat = useChatStore((state) => state.getChat);
  const getChatByContactId = useChatStore((state) => state.getChatByContactId);
  const isLoading = useChatStore((state) => state.isLoading);

  return {
    chats,
    activeChat,
    setActiveChat,
    startChat,
    addMessage,
    updateMessage,
    updateLastMessage,
    deleteChat,
    getChat,
    getChatByContactId,
    isLoading,
  };
}

// Custom contacts hook (compatible with useCustomContacts from CustomContactsContext)
export function useCustomContacts() {
  const customContacts = useContactsStore((state) => state.customContacts);
  const addContact = useContactsStore((state) => state.addContact);
  const updateContact = useContactsStore((state) => state.updateContact);
  const deleteContact = useContactsStore((state) => state.deleteContact);
  const getContact = useContactsStore((state) => state.getContact);
  const isLoading = useContactsStore((state) => state.isLoading);
  const refreshContacts = useContactsStore((state) => state.refreshContacts);

  return {
    customContacts,
    addContact,
    updateContact,
    deleteContact,
    getContact,
    isLoading,
    refreshContacts,
  };
}

// Subscription hook (compatible with useSubscription from SubscriptionContext)
export function useSubscription() {
  const tier = useSubscriptionStore((state) => state.tier);
  const subscription = useSubscriptionStore((state) => state.subscription);
  const usage = useSubscriptionStore((state) => state.usage);
  const isLoading = useSubscriptionStore((state) => state.isLoading);
  const upgradeModalFeature = useSubscriptionStore((state) => state.upgradeModalFeature);
  const refreshSubscription = useSubscriptionStore((state) => state.refreshSubscription);
  const incrementLocalMessageCount = useSubscriptionStore((state) => state.incrementLocalMessageCount);
  const updateLocalContactsCount = useSubscriptionStore((state) => state.updateLocalContactsCount);
  const showUpgradeModal = useSubscriptionStore((state) => state.showUpgradeModal);
  const hideUpgradeModal = useSubscriptionStore((state) => state.hideUpgradeModal);

  // Import computed selectors
  const { useSubscriptionSelectors } = require('./subscriptionStore');
  const selectors = useSubscriptionSelectors();

  return {
    tier,
    subscription,
    usage,
    isLoading,
    upgradeModalFeature,
    refreshSubscription,
    incrementLocalMessageCount,
    updateLocalContactsCount,
    showUpgradeModal,
    hideUpgradeModal,
    ...selectors,
  };
}

// Translator hook (compatible with useTranslator from TranslatorContext)
export function useTranslator() {
  const isSetupComplete = useTranslatorStore((state) => state.isSetupComplete);
  const translatorVoice = useTranslatorStore((state) => state.translatorVoice);
  const sourceLanguage = useTranslatorStore((state) => state.sourceLanguage);
  const targetLanguage = useTranslatorStore((state) => state.targetLanguage);
  const setSourceLanguage = useTranslatorStore((state) => state.setSourceLanguage);
  const setTargetLanguage = useTranslatorStore((state) => state.setTargetLanguage);
  const saveTranslatorVoice = useTranslatorStore((state) => state.saveTranslatorVoice);
  const clearTranslatorVoice = useTranslatorStore((state) => state.clearTranslatorVoice);

  // Import getSampleText from store
  const { getSampleText } = require('./translatorStore');

  return {
    isSetupComplete,
    translatorVoice,
    sourceLanguage,
    targetLanguage,
    setSourceLanguage,
    setTargetLanguage,
    saveTranslatorVoice,
    clearTranslatorVoice,
    getSampleText,
  };
}
