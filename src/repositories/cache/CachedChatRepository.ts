/**
 * Cached Chat Repository
 * Wraps any IChatRepository with Redis caching
 */

import { Chat, Message } from '@/shared/types';
import {
  IChatRepository,
  CreateChatInput,
  CreateMessageInput,
  PaginationOptions,
} from '../interfaces/IChatRepository';
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  CACHE_KEYS,
  CACHE_TTL,
} from '@/lib/cache';

export class CachedChatRepository implements IChatRepository {
  constructor(private readonly repository: IChatRepository) {}

  async getChats(userId: string): Promise<Chat[]> {
    const cacheKey = `${CACHE_KEYS.CHATS_LIST}${userId}`;

    // Try cache first
    const cached = await cacheGet<Chat[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from repository
    const chats = await this.repository.getChats(userId);

    // Cache result
    await cacheSet(cacheKey, chats, CACHE_TTL.MEDIUM);

    return chats;
  }

  async getChat(chatId: string): Promise<Chat | null> {
    const cacheKey = `${CACHE_KEYS.CHAT}${chatId}`;

    // Try cache first
    const cached = await cacheGet<Chat>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from repository
    const chat = await this.repository.getChat(chatId);

    // Cache result if found
    if (chat) {
      await cacheSet(cacheKey, chat, CACHE_TTL.MEDIUM);
    }

    return chat;
  }

  async getChatByContactId(userId: string, contactId: string): Promise<Chat | null> {
    // This could be cached but the key would be complex
    // For now, delegate directly
    return this.repository.getChatByContactId(userId, contactId);
  }

  async createChat(userId: string, input: CreateChatInput): Promise<Chat> {
    const chat = await this.repository.createChat(userId, input);

    // Invalidate chats list cache
    await cacheDelete(`${CACHE_KEYS.CHATS_LIST}${userId}`);

    return chat;
  }

  async updateChat(chatId: string, updates: Partial<Chat>): Promise<void> {
    await this.repository.updateChat(chatId, updates);

    // Invalidate chat cache
    await cacheDelete(`${CACHE_KEYS.CHAT}${chatId}`);
  }

  async deleteChat(chatId: string): Promise<void> {
    // Get chat first to know the user ID for cache invalidation
    const chat = await this.getChat(chatId);

    await this.repository.deleteChat(chatId);

    // Invalidate caches
    await cacheDelete(`${CACHE_KEYS.CHAT}${chatId}`);
    // Note: Would need userId to invalidate chats list
  }

  async getMessages(chatId: string, options?: PaginationOptions): Promise<Message[]> {
    // Messages are part of the chat, so we use chat cache
    // For paginated messages, we don't cache as it's more complex
    return this.repository.getMessages(chatId, options);
  }

  async addMessage(chatId: string, input: CreateMessageInput): Promise<Message> {
    const message = await this.repository.addMessage(chatId, input);

    // Invalidate chat cache (messages changed)
    await cacheDelete(`${CACHE_KEYS.CHAT}${chatId}`);

    return message;
  }

  async updateMessage(chatId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    await this.repository.updateMessage(chatId, messageId, updates);

    // Invalidate chat cache
    await cacheDelete(`${CACHE_KEYS.CHAT}${chatId}`);
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.repository.deleteMessage(chatId, messageId);

    // Invalidate chat cache
    await cacheDelete(`${CACHE_KEYS.CHAT}${chatId}`);
  }

  async syncChats(userId: string, localChats: Chat[]): Promise<Chat[]> {
    const result = await this.repository.syncChats(userId, localChats);

    // Invalidate chats list cache after sync
    await cacheDelete(`${CACHE_KEYS.CHATS_LIST}${userId}`);

    return result;
  }
}
