/**
 * Shared Types for Zustand Stores
 */

import { User } from 'firebase/auth';
import { Chat, Message, PreMadeContactConfig } from '@/shared/types';
import { SubscriptionTier } from '@/config/subscription';
import { UserSubscription, UsageData, GatedFeature } from '@/shared/types/subscription';

// Theme types
export type Theme = 'light' | 'dark';

// Auth Store Types - re-exported from authStore.ts for backwards compatibility
// The canonical types are defined in authStore.ts
export type { AuthState, AuthActions, AuthStore } from './authStore';

// Theme Store Types
export interface ThemeState {
  theme: Theme;
  mounted: boolean;
}

export interface ThemeActions {
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setMounted: (mounted: boolean) => void;
  syncFromDocument: () => void;
  applyTheme: (theme: Theme) => void;
}

export type ThemeStore = ThemeState & ThemeActions;

// Subscription Store Types
export interface SubscriptionState {
  tier: SubscriptionTier;
  subscription: UserSubscription;
  usage: UsageData;
  isLoading: boolean;
  upgradeModalFeature: GatedFeature | null;
}

export interface SubscriptionActions {
  setSubscription: (subscription: UserSubscription) => void;
  setUsage: (usage: UsageData) => void;
  setLoading: (loading: boolean) => void;
  fetchSubscription: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
  incrementLocalMessageCount: () => void;
  updateLocalContactsCount: (count: number) => void;
  showUpgradeModal: (feature: GatedFeature) => void;
  hideUpgradeModal: () => void;
}

export type SubscriptionStore = SubscriptionState & SubscriptionActions;

// Chat Store Types
export interface ChatState {
  chats: Chat[];
  activeChat: Chat | null;
  isLoading: boolean;
}

export interface ChatActions {
  setChats: (chats: Chat[]) => void;
  setActiveChat: (chat: Chat | null) => void;
  setLoading: (loading: boolean) => void;
  startChat: (contact: PreMadeContactConfig) => Chat;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  updateLastMessage: (chatId: string, content: string) => void;
  deleteChat: (chatId: string) => void;
  getChat: (chatId: string) => Chat | undefined;
  getChatByContactId: (contactId: string) => Chat | undefined;
  loadChats: () => Promise<void>;
  syncToCloud: () => Promise<void>;
}

export type ChatStore = ChatState & ChatActions;

// Contacts Store Types
export interface ContactsState {
  customContacts: PreMadeContactConfig[];
  isLoading: boolean;
}

export interface ContactsActions {
  setContacts: (contacts: PreMadeContactConfig[]) => void;
  setLoading: (loading: boolean) => void;
  addContact: (contact: PreMadeContactConfig) => void;
  updateContact: (contactId: string, updates: Partial<PreMadeContactConfig>) => void;
  deleteContact: (contactId: string) => void;
  getContact: (contactId: string) => PreMadeContactConfig | undefined;
  loadContacts: () => Promise<void>;
  syncToCloud: () => Promise<void>;
  refreshContacts: () => Promise<void>;
}

export type ContactsStore = ContactsState & ContactsActions;

// Translator Store Types
export type LanguageCode = string;

export interface TranslatorVoice {
  voiceId: string;
  name: string;
  sourceLanguage: LanguageCode;
  createdAt: string;
}

export interface TranslatorState {
  isSetupComplete: boolean;
  translatorVoice: TranslatorVoice | null;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

export interface TranslatorActions {
  setSourceLanguage: (lang: LanguageCode) => void;
  setTargetLanguage: (lang: LanguageCode) => void;
  saveTranslatorVoice: (voice: TranslatorVoice) => void;
  clearTranslatorVoice: () => void;
  loadSettings: () => void;
}

export type TranslatorStore = TranslatorState & TranslatorActions;

// Platform Store Types (for Phase 6)
export type Platform = 'web' | 'telegram' | 'pwa';

export interface PlatformState {
  platform: Platform;
  isTelegramWebApp: boolean;
  telegramUser: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
  } | null;
}

export interface PlatformActions {
  detectPlatform: () => void;
  setTelegramUser: (user: PlatformState['telegramUser']) => void;
}

export type PlatformStore = PlatformState & PlatformActions;
