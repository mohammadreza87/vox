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
import { IIntentService } from './interfaces/IIntentService';
import { ITokenBudgetService } from './interfaces/ITokenBudgetService';
import { IEmbeddingService } from './interfaces/IEmbeddingService';
import { ChatService } from './implementations/ChatService';
import { MemoryService } from './implementations/MemoryService';
import { IntentService } from './implementations/IntentService';
import { TokenBudgetService } from './implementations/TokenBudgetService';
import { EmbeddingService } from './implementations/EmbeddingService';
import { isRedisAvailable } from '@/lib/cache';

// Repository instances (singleton)
let chatRepository: IChatRepository | null = null;
let userRepository: IUserRepository | null = null;
let memoryRepository: IMemoryRepository | null = null;

// Service instances (singleton)
let chatService: IChatService | null = null;
let memoryService: IMemoryService | null = null;
let intentService: IIntentService | null = null;
let tokenBudgetService: ITokenBudgetService | null = null;
let embeddingService: IEmbeddingService | null = null;

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
    const service = new MemoryService(getMemoryRepository());
    // Wire up embedding service for semantic search indexing
    // This enables automatic fact indexing when facts are saved
    try {
      service.setEmbeddingService(getEmbeddingService());
    } catch {
      // Embedding service may not be available (e.g., missing API key)
      // Memory service will still work without semantic search
      console.warn('[ServiceContainer] EmbeddingService not available, semantic search disabled');
    }
    memoryService = service;
  }
  return memoryService;
}

/**
 * Get Intent Service instance
 */
export function getIntentService(): IIntentService {
  if (!intentService) {
    intentService = new IntentService();
  }
  return intentService;
}

/**
 * Get Token Budget Service instance
 */
export function getTokenBudgetService(): ITokenBudgetService {
  if (!tokenBudgetService) {
    tokenBudgetService = new TokenBudgetService();
  }
  return tokenBudgetService;
}

/**
 * Get Embedding Service instance
 */
export function getEmbeddingService(): IEmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
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
  intentService = null;
  tokenBudgetService = null;
  embeddingService = null;
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
  intentService: IIntentService;
  tokenBudgetService: ITokenBudgetService;
  embeddingService: IEmbeddingService;
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
    intentService: getIntentService(),
    tokenBudgetService: getTokenBudgetService(),
    embeddingService: getEmbeddingService(),
  };
}
