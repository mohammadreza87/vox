/**
 * Service Container
 * Simple dependency injection container for services
 *
 * This provides a centralized place to configure and access services,
 * making it easy to swap implementations (e.g., for testing or migration)
 */

import { IChatRepository, IUserRepository, IMemoryRepository } from '@/repositories/interfaces';
import { FirestoreChatRepository, FirestoreUserRepository, FirestoreMemoryRepository } from '@/repositories/firestore';
import { CachedChatRepository, CachedUserRepository } from '@/repositories/cache';
import { IChatService } from './interfaces/IChatService';
import { IMemoryService } from './interfaces/IMemoryService';
import { ChatService } from './implementations/ChatService';
import { MemoryService } from './implementations/MemoryService';
import { isRedisAvailable } from '@/lib/cache';

// Repository instances (singleton)
let chatRepository: IChatRepository | null = null;
let userRepository: IUserRepository | null = null;
let memoryRepository: IMemoryRepository | null = null;

// Service instances (singleton)
let chatService: IChatService | null = null;
let memoryService: IMemoryService | null = null;

/**
 * Get Chat Repository instance
 * Uses caching layer if Redis is configured
 */
export function getChatRepository(): IChatRepository {
  if (!chatRepository) {
    const baseRepository = new FirestoreChatRepository();

    // Wrap with caching if Redis is available
    if (isRedisAvailable()) {
      chatRepository = new CachedChatRepository(baseRepository);
    } else {
      chatRepository = baseRepository;
    }
  }
  return chatRepository;
}

/**
 * Get User Repository instance
 * Uses caching layer if Redis is configured
 */
export function getUserRepository(): IUserRepository {
  if (!userRepository) {
    const baseRepository = new FirestoreUserRepository();

    // Wrap with caching if Redis is available
    if (isRedisAvailable()) {
      userRepository = new CachedUserRepository(baseRepository);
    } else {
      userRepository = baseRepository;
    }
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
 * Get Memory Repository instance
 */
export function getMemoryRepository(): IMemoryRepository {
  if (!memoryRepository) {
    memoryRepository = new FirestoreMemoryRepository();
  }
  return memoryRepository;
}

/**
 * Get Memory Service instance
 */
export function getMemoryService(): IMemoryService {
  if (!memoryService) {
    memoryService = new MemoryService(getMemoryRepository());
  }
  return memoryService;
}

/**
 * Reset all services (useful for testing)
 */
export function resetContainer(): void {
  chatRepository = null;
  userRepository = null;
  memoryRepository = null;
  chatService = null;
  memoryService = null;
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

export function setMemoryRepository(repo: IMemoryRepository): void {
  memoryRepository = repo;
  // Reset dependent services
  memoryService = null;
}

/**
 * Container type for type-safe access
 */
export interface ServiceContainer {
  chatRepository: IChatRepository;
  userRepository: IUserRepository;
  memoryRepository: IMemoryRepository;
  chatService: IChatService;
  memoryService: IMemoryService;
}

/**
 * Get all services
 */
export function getContainer(): ServiceContainer {
  return {
    chatRepository: getChatRepository(),
    userRepository: getUserRepository(),
    memoryRepository: getMemoryRepository(),
    chatService: getChatService(),
    memoryService: getMemoryService(),
  };
}
