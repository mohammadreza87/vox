/**
 * Repository Layer
 * Provides data access abstraction for different backends
 *
 * Usage:
 * import { IChatRepository, FirestoreChatRepository } from '@/repositories';
 *
 * const chatRepo: IChatRepository = new FirestoreChatRepository();
 */

// Interfaces
export * from './interfaces';

// Implementations
export * from './firestore';
