/**
 * API Types
 * Request and response types for all API endpoints
 */

import { Chat, Message, PreMadeContactConfig } from '@/shared/types';
import { ChatDocument, MessageDocument, CustomContactDocument } from '@/shared/types/database';
import { UserSubscription, UsageData } from '@/shared/types/subscription';

// ============================================
// COMMON
// ============================================

export interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
}

// ============================================
// AUTH
// ============================================

export interface UserData {
  chats: Chat[];
  customContacts: PreMadeContactConfig[];
  preferences: {
    theme: 'light' | 'dark';
  };
}

// ============================================
// CHATS (V2)
// ============================================

export interface GetChatsResponse {
  chats: ChatDocument[];
  syncedAt: string;
}

export interface CreateChatRequest {
  contactId: string;
  contactName: string;
  contactEmoji: string;
  contactImage?: string;
  contactPurpose: string;
}

export interface CreateChatResponse {
  chat: ChatDocument;
  isExisting: boolean;
}

export interface GetChatResponse {
  chat: ChatDocument & { messages?: MessageDocument[] };
}

export interface GetMessagesResponse {
  messages: MessageDocument[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface AddMessageRequest {
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string | null;
}

export interface AddMessageResponse {
  message: MessageDocument;
}

// ============================================
// SYNC
// ============================================

export interface SyncRequest {
  lastSyncAt?: string;
  localChats?: Array<{
    id: string;
    contactId: string;
    contactName: string;
    contactEmoji: string;
    contactImage?: string;
    contactPurpose: string;
    lastMessage: string;
    lastMessageAt: string;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      audioUrl: string | null;
      createdAt: string;
    }>;
    isDeleted?: boolean;
  }>;
}

export interface SyncResponse {
  chats: Array<ChatDocument & { messages: MessageDocument[] }>;
  syncedAt: string;
}

// ============================================
// MIGRATION
// ============================================

export interface MigrationStatusResponse {
  status: 'not_started' | 'in_progress' | 'completed' | 'completed_with_errors' | 'failed';
  needsMigration: boolean;
  migratedChats?: number;
  migratedMessages?: number;
  completedAt?: string;
  errors?: string[];
}

export interface MigrationResponse {
  success: boolean;
  message: string;
  migratedChats: number;
  migratedMessages: number;
  alreadyMigrated?: boolean;
  errors?: string[];
}

// ============================================
// SUBSCRIPTION
// ============================================

export interface SubscriptionResponse {
  subscription: UserSubscription;
  usage: UsageData;
}

export interface CreateCheckoutResponse {
  url: string;
}

export interface CreatePortalResponse {
  url: string;
}

// ============================================
// VOICE / TTS
// ============================================

export interface TextToSpeechRequest {
  text: string;
  voiceId: string;
}

export interface TextToSpeechResponse {
  audioUrl: string;
}

export interface CloneVoiceRequest {
  name: string;
  audioFile: File;
}

export interface CloneVoiceResponse {
  voiceId: string;
  name: string;
}

export interface VoiceListResponse {
  voices: Array<{
    voiceId: string;
    name: string;
    previewUrl?: string;
  }>;
}

// ============================================
// CHAT GENERATION
// ============================================

export interface GenerateRequest {
  contactId: string;
  message: string;
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface GenerateResponse {
  content: string;
  audioUrl?: string;
}

// ============================================
// TRANSLATOR
// ============================================

export interface TranslateRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslateResponse {
  translatedText: string;
  detectedLanguage?: string;
}

export interface TranslatorTTSRequest {
  text: string;
  language: string;
  voiceId?: string;
}

export interface TranslatorTTSResponse {
  audioUrl: string;
}

// ============================================
// CUSTOM CONTACTS
// ============================================

export interface GetCustomContactsResponse {
  contacts: CustomContactDocument[];
}

export interface CreateCustomContactRequest {
  name: string;
  purpose: string;
  personality: string;
  systemPrompt: string;
  voiceId: string;
  voiceName: string;
  avatarEmoji: string;
  avatarImage?: string;
  category: string;
  gradient: string;
  aiProvider?: string;
  aiModel?: string;
}

export interface CreateCustomContactResponse {
  contact: CustomContactDocument;
}
