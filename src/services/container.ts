/**
 * Service Container
 * Simple dependency injection container for services
 *
 * This provides a centralized place to configure and access services,
 * making it easy to swap implementations (e.g., for testing or migration)
 */

import { IChatRepository, IUserRepository } from '@/repositories/interfaces';
import { FirestoreChatRepository, FirestoreUserRepository } from '@/repositories/firestore';
import { IChatService } from './interfaces/IChatService';
import { ChatService } from './implementations/ChatService';

// Repository instances (singleton)
let chatRepository: IChatRepository | null = null;
let userRepository: IUserRepository | null = null;

// Service instances (singleton)
let chatService: IChatService | null = null;

/**
 * Get Chat Repository instance
 */
export function getChatRepository(): IChatRepository {
  if (!chatRepository) {
    chatRepository = new FirestoreChatRepository();
  }
  return chatRepository;
}

/**
 * Get User Repository instance
 */
export function getUserRepository(): IUserRepository {
  if (!userRepository) {
    userRepository = new FirestoreUserRepository();
  }
  return userRepository;
}

/**
 * Get Chat Service instance
 */
export function getChatService(): IChatService {
  if (!chatService) {
    chatService = new ChatService(getChatRepository());
  }
  return chatService;
}

/**
 * Reset all services (useful for testing)
 */
export function resetContainer(): void {
  chatRepository = null;
  userRepository = null;
  chatService = null;
}

/**
 * Set custom repository implementation (for testing or migration)
 */
export function setChatRepository(repo: IChatRepository): void {
  chatRepository = repo;
  // Reset dependent services
  chatService = null;
}

export function setUserRepository(repo: IUserRepository): void {
  userRepository = repo;
}

/**
 * Container type for type-safe access
 */
export interface ServiceContainer {
  chatRepository: IChatRepository;
  userRepository: IUserRepository;
  chatService: IChatService;
}

/**
 * Get all services
 */
export function getContainer(): ServiceContainer {
  return {
    chatRepository: getChatRepository(),
    userRepository: getUserRepository(),
    chatService: getChatService(),
  };
}
