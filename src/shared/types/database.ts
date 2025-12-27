/**
 * Database Types for Scalable Schema
 *
 * Schema Structure:
 * users/{userId}/
 *   ├── profile (document)
 *   │   └── preferences, updatedAt
 *   ├── chats/{chatId}/ (subcollection)
 *   │   ├── metadata (contactId, contactName, lastMessage, etc.)
 *   │   └── messages/{messageId}/ (nested subcollection)
 *   └── customContacts/{contactId}/ (subcollection)
 */

import { ContactCategory, AIProvider } from './index';

// ============================================
// USER PROFILE
// ============================================

export interface UserProfile {
  preferences: UserPreferences;
  updatedAt: Date;
}

export interface UserPreferences {
  theme: 'light' | 'dark';
  defaultAiProvider?: AIProvider;
  defaultAiModel?: string;
}

// ============================================
// CHAT (Subcollection)
// ============================================

/**
 * Chat document stored in users/{userId}/chats/{chatId}
 * Messages are stored in a nested subcollection
 */
export interface ChatDocument {
  id: string;
  contactId: string;
  contactName: string;
  contactEmoji: string;
  contactImage?: string;
  contactPurpose: string;
  lastMessage: string;
  lastMessageAt: Date;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Message document stored in users/{userId}/chats/{chatId}/messages/{messageId}
 */
export interface MessageDocument {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl: string | null;
  createdAt: Date;
}

/**
 * Chat with messages (for API responses)
 */
export interface ChatWithMessages extends ChatDocument {
  messages: MessageDocument[];
}

/**
 * Paginated messages response
 */
export interface PaginatedMessages {
  messages: MessageDocument[];
  hasMore: boolean;
  nextCursor?: string; // messageId to start after
}

// ============================================
// CUSTOM CONTACTS (Subcollection)
// ============================================

/**
 * Custom contact document stored in users/{userId}/customContacts/{contactId}
 */
export interface CustomContactDocument {
  id: string;
  name: string;
  purpose: string;
  personality: string;
  systemPrompt: string;
  voiceId: string;
  voiceName: string;
  avatarEmoji: string;
  avatarImage?: string;
  category: ContactCategory;
  gradient: string;
  aiProvider?: AIProvider;
  aiModel?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

export interface CreateChatRequest {
  contactId: string;
  contactName: string;
  contactEmoji: string;
  contactImage?: string;
  contactPurpose: string;
}

export interface AddMessageRequest {
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string | null;
}

export interface GetMessagesRequest {
  chatId: string;
  limit?: number;
  cursor?: string; // Start after this messageId
}

export interface SyncChatsRequest {
  lastSyncAt?: string; // ISO date string
}

export interface SyncChatsResponse {
  chats: ChatDocument[];
  deletedChatIds: string[];
  syncedAt: string;
}

// ============================================
// MIGRATION TYPES
// ============================================

export interface MigrationStatus {
  userId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  oldChatsCount: number;
  migratedChatsCount: number;
  migratedMessagesCount: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

// ============================================
// BACKWARD COMPATIBILITY
// ============================================

/**
 * Legacy chat format (stored in single document)
 * Used for migration
 */
export interface LegacyChatData {
  chats: Array<{
    id: string;
    contactId: string;
    contactName: string;
    contactEmoji: string;
    contactImage?: string;
    contactPurpose: string;
    lastMessage: string;
    lastMessageAt: Date | string;
    messages: Array<{
      id: string;
      contactId: string;
      role: 'user' | 'assistant';
      content: string;
      audioUrl: string | null;
      createdAt: Date | string;
    }>;
  }>;
  customContacts: CustomContactDocument[];
  preferences: UserPreferences;
}
