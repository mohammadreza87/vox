/**
 * Chat Repository Interface
 * Defines the contract for chat data access operations.
 * Implementations can use Firestore, Supabase, or any other data store.
 */

import { Chat, Message } from '@/shared/types';

export interface CreateChatInput {
  contactId: string;
  contactName: string;
  contactEmoji?: string;
  contactImage?: string;
  contactPurpose?: string;
}

export interface CreateMessageInput {
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string | null;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface IChatRepository {
  /**
   * Get all chats for a user
   */
  getChats(userId: string): Promise<Chat[]>;

  /**
   * Get a single chat by ID
   */
  getChat(chatId: string): Promise<Chat | null>;

  /**
   * Get chat by contact ID for a user
   */
  getChatByContactId(userId: string, contactId: string): Promise<Chat | null>;

  /**
   * Create a new chat
   */
  createChat(userId: string, input: CreateChatInput): Promise<Chat>;

  /**
   * Update a chat
   */
  updateChat(chatId: string, updates: Partial<Chat>): Promise<void>;

  /**
   * Delete a chat and all its messages
   */
  deleteChat(chatId: string): Promise<void>;

  /**
   * Get messages for a chat with optional pagination
   */
  getMessages(chatId: string, options?: PaginationOptions): Promise<Message[]>;

  /**
   * Add a message to a chat
   */
  addMessage(chatId: string, input: CreateMessageInput): Promise<Message>;

  /**
   * Update a message
   */
  updateMessage(chatId: string, messageId: string, updates: Partial<Message>): Promise<void>;

  /**
   * Delete a message
   */
  deleteMessage(chatId: string, messageId: string): Promise<void>;

  /**
   * Sync local chats with server (for offline-first support)
   */
  syncChats(userId: string, localChats: Chat[]): Promise<Chat[]>;
}
