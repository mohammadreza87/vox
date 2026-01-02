/**
 * Chat Service Interface
 * Defines business logic operations for chat functionality
 */

import { Chat, Message, PreMadeContactConfig } from '@/shared/types';

export interface SendMessageRequest {
  chatId: string;
  contactId: string;
  content: string;
  model?: string;
}

export interface SendMessageResponse {
  message: Message;
  aiResponse: Message;
}

export interface IChatService {
  /**
   * Get all chats for the current user
   */
  getChats(): Promise<Chat[]>;

  /**
   * Get a single chat by ID
   */
  getChat(chatId: string): Promise<Chat | null>;

  /**
   * Start a new chat with a contact
   */
  startChat(contact: PreMadeContactConfig): Promise<Chat>;

  /**
   * Send a message and get AI response
   */
  sendMessage(request: SendMessageRequest): Promise<SendMessageResponse>;

  /**
   * Stream a message (for real-time AI responses)
   */
  streamMessage(
    request: SendMessageRequest,
    onChunk: (chunk: string) => void,
    onComplete: (message: Message) => void
  ): Promise<void>;

  /**
   * Delete a chat
   */
  deleteChat(chatId: string): Promise<void>;

  /**
   * Sync local chats with server
   */
  syncChats(localChats: Chat[]): Promise<Chat[]>;
}
