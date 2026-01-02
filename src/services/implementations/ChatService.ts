/**
 * Chat Service Implementation
 * Handles business logic for chat operations
 */

import { Chat, Message, PreMadeContactConfig } from '@/shared/types';
import { IChatRepository } from '@/repositories/interfaces';
import { IChatService, SendMessageRequest, SendMessageResponse } from '../interfaces/IChatService';
import { getCurrentUserId } from '@/stores/authStore';
import { getAuthToken } from '@/stores/middleware/sync';

export class ChatService implements IChatService {
  constructor(private readonly chatRepository: IChatRepository) {}

  async getChats(): Promise<Chat[]> {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.chatRepository.getChats(userId);
  }

  async getChat(chatId: string): Promise<Chat | null> {
    return this.chatRepository.getChat(chatId);
  }

  async startChat(contact: PreMadeContactConfig): Promise<Chat> {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Check if chat already exists
    const existingChat = await this.chatRepository.getChatByContactId(userId, contact.id);
    if (existingChat) {
      return existingChat;
    }

    // Create new chat
    return this.chatRepository.createChat(userId, {
      contactId: contact.id,
      contactName: contact.name,
      contactEmoji: contact.avatarEmoji,
      contactImage: contact.avatarImage,
      contactPurpose: contact.purpose,
    });
  }

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('User not authenticated');
    }

    // Add user message
    const userMessage = await this.chatRepository.addMessage(request.chatId, {
      role: 'user',
      content: request.content,
    });

    // Call AI API
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contactId: request.contactId,
        message: request.content,
        model: request.model,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get AI response');
    }

    const data = await response.json();

    // Add AI response
    const aiMessage = await this.chatRepository.addMessage(request.chatId, {
      role: 'assistant',
      content: data.message,
      audioUrl: data.audioUrl,
    });

    return {
      message: userMessage,
      aiResponse: aiMessage,
    };
  }

  async streamMessage(
    request: SendMessageRequest,
    onChunk: (chunk: string) => void,
    onComplete: (message: Message) => void
  ): Promise<void> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('User not authenticated');
    }

    // Add user message
    await this.chatRepository.addMessage(request.chatId, {
      role: 'user',
      content: request.content,
    });

    // Call streaming API
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contactId: request.contactId,
        message: request.content,
        model: request.model,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get AI response');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullContent += chunk;
      onChunk(chunk);
    }

    // Save complete message
    const aiMessage = await this.chatRepository.addMessage(request.chatId, {
      role: 'assistant',
      content: fullContent,
    });

    onComplete(aiMessage);
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.chatRepository.deleteChat(chatId);
  }

  async syncChats(localChats: Chat[]): Promise<Chat[]> {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.chatRepository.syncChats(userId, localChats);
  }
}
