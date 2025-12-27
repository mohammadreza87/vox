/**
 * Chat API Module
 * Handles all chat-related API calls
 */

import { api } from '../client';
import {
  GetChatsResponse,
  CreateChatRequest,
  CreateChatResponse,
  GetChatResponse,
  GetMessagesResponse,
  AddMessageRequest,
  AddMessageResponse,
  SyncRequest,
  SyncResponse,
  MigrationStatusResponse,
  MigrationResponse,
} from '../types';
import { Chat, Message } from '@/shared/types';
import { ChatDocument, MessageDocument } from '@/shared/types/database';

// ============================================
// HELPERS
// ============================================

function parseChat(chat: ChatDocument): ChatDocument {
  return {
    ...chat,
    lastMessageAt: new Date(chat.lastMessageAt),
    createdAt: new Date(chat.createdAt),
    updatedAt: new Date(chat.updatedAt),
  };
}

function parseMessage(msg: MessageDocument): MessageDocument {
  return {
    ...msg,
    createdAt: new Date(msg.createdAt),
  };
}

// ============================================
// CHATS (V2 API)
// ============================================

/**
 * Get all chats for the current user
 */
export async function getChats(since?: string): Promise<ChatDocument[]> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await api.get<GetChatsResponse>(`/api/v2/chats${params}`);
  return response.chats.map(parseChat);
}

/**
 * Create a new chat
 */
export async function createChat(data: CreateChatRequest): Promise<{ chat: ChatDocument; isExisting: boolean }> {
  const response = await api.post<CreateChatResponse>('/api/v2/chats', data);
  return {
    chat: parseChat(response.chat),
    isExisting: response.isExisting,
  };
}

/**
 * Get a single chat by ID
 */
export async function getChat(chatId: string, includeMessages = false): Promise<ChatDocument & { messages?: MessageDocument[] }> {
  const params = includeMessages ? '?messages=true' : '';
  const response = await api.get<GetChatResponse>(`/api/v2/chats/${chatId}${params}`);
  const chat = parseChat(response.chat);

  if (response.chat.messages) {
    return {
      ...chat,
      messages: response.chat.messages.map(parseMessage),
    };
  }

  return chat;
}

/**
 * Update a chat
 */
export async function updateChat(chatId: string, updates: Partial<ChatDocument>): Promise<void> {
  await api.patch(`/api/v2/chats/${chatId}`, updates);
}

/**
 * Delete a chat
 */
export async function deleteChat(chatId: string): Promise<void> {
  await api.delete(`/api/v2/chats/${chatId}`);
}

// ============================================
// MESSAGES
// ============================================

/**
 * Get messages for a chat (paginated)
 */
export async function getMessages(
  chatId: string,
  limit = 50,
  cursor?: string
): Promise<{ messages: MessageDocument[]; hasMore: boolean; nextCursor?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);

  const response = await api.get<GetMessagesResponse>(`/api/v2/chats/${chatId}/messages?${params}`);
  return {
    messages: response.messages.map(parseMessage),
    hasMore: response.hasMore,
    nextCursor: response.nextCursor,
  };
}

/**
 * Add a message to a chat
 */
export async function addMessage(chatId: string, data: AddMessageRequest): Promise<MessageDocument> {
  const response = await api.post<AddMessageResponse>(`/api/v2/chats/${chatId}/messages`, data);
  return parseMessage(response.message);
}

// ============================================
// SYNC
// ============================================

/**
 * Full sync - get all chats with messages
 */
export async function syncChats(): Promise<SyncResponse> {
  const response = await api.get<SyncResponse>('/api/v2/sync');
  return {
    chats: response.chats.map((chat) => ({
      ...parseChat(chat),
      messages: chat.messages.map(parseMessage),
    })),
    syncedAt: response.syncedAt,
  };
}

/**
 * Push local changes and get server state
 */
export async function pushSync(data: SyncRequest): Promise<SyncResponse> {
  const response = await api.post<SyncResponse>('/api/v2/sync', data);
  return {
    chats: response.chats.map((chat) => ({
      ...parseChat(chat),
      messages: chat.messages.map(parseMessage),
    })),
    syncedAt: response.syncedAt,
  };
}

// ============================================
// MIGRATION
// ============================================

/**
 * Check migration status
 */
export async function getMigrationStatus(): Promise<MigrationStatusResponse> {
  return api.get<MigrationStatusResponse>('/api/v2/migrate');
}

/**
 * Run migration from old schema to new
 */
export async function runMigration(): Promise<MigrationResponse> {
  return api.post<MigrationResponse>('/api/v2/migrate');
}

// ============================================
// LEGACY API (for backward compatibility)
// ============================================

interface LegacyUserData {
  chats: Chat[];
  customContacts: unknown[];
  preferences: { theme: string };
}

/**
 * Get user data (legacy v1 API)
 */
export async function getLegacyUserData(): Promise<LegacyUserData> {
  const response = await api.get<LegacyUserData>('/api/user/data');
  return {
    ...response,
    chats: response.chats.map((chat) => ({
      ...chat,
      lastMessageAt: new Date(chat.lastMessageAt),
      messages: chat.messages.map((msg) => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
      })),
    })),
  };
}

/**
 * Save user data (legacy v1 API)
 */
export async function saveLegacyUserData(data: Partial<LegacyUserData>): Promise<void> {
  await api.post('/api/user/data', data);
}
