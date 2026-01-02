import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getChatRepository,
  getUserRepository,
  getChatService,
  resetContainer,
  setChatRepository,
  setUserRepository,
  getContainer,
} from '../container';
import { IChatRepository, IUserRepository } from '@/repositories/interfaces';
import { IChatService } from '../interfaces/IChatService';

// Mock Redis availability
vi.mock('@/lib/cache', () => ({
  isRedisAvailable: vi.fn(() => false),
}));

// Mock Firestore repositories
vi.mock('@/repositories/firestore', () => ({
  FirestoreChatRepository: class MockFirestoreChatRepository {
    getChats = vi.fn();
    getChat = vi.fn();
    createChat = vi.fn();
    updateChat = vi.fn();
    deleteChat = vi.fn();
    getMessages = vi.fn();
    addMessage = vi.fn();
    updateMessage = vi.fn();
    deleteMessage = vi.fn();
    getChatByContactId = vi.fn();
    syncChats = vi.fn();
  },
  FirestoreUserRepository: class MockFirestoreUserRepository {
    getUser = vi.fn();
    upsertUser = vi.fn();
    getSettings = vi.fn();
    updateSettings = vi.fn();
    getSubscription = vi.fn();
    updateSubscription = vi.fn();
    getUsage = vi.fn();
    incrementMessageCount = vi.fn();
    getCustomContacts = vi.fn();
    addCustomContact = vi.fn();
    updateCustomContact = vi.fn();
    deleteCustomContact = vi.fn();
    getClonedVoices = vi.fn();
    addClonedVoice = vi.fn();
    deleteClonedVoice = vi.fn();
    setDefaultTranslatorVoice = vi.fn();
  },
}));

// Mock Cached repositories
vi.mock('@/repositories/cache', () => ({
  CachedChatRepository: class MockCachedChatRepository {
    constructor(public repository: IChatRepository) {}
  },
  CachedUserRepository: class MockCachedUserRepository {
    constructor(public repository: IUserRepository) {}
  },
}));

// Mock ChatService
vi.mock('../implementations/ChatService', () => ({
  ChatService: class MockChatService {
    constructor(public chatRepository: IChatRepository) {}
    getChats = vi.fn();
    getChat = vi.fn();
    createChat = vi.fn();
    sendMessage = vi.fn();
    updateChat = vi.fn();
    deleteChat = vi.fn();
  },
}));

describe('Service Container', () => {
  beforeEach(() => {
    resetContainer();
    vi.clearAllMocks();
  });

  describe('getChatRepository', () => {
    it('returns a chat repository instance', () => {
      const repo = getChatRepository();
      expect(repo).toBeDefined();
    });

    it('returns singleton instance', () => {
      const repo1 = getChatRepository();
      const repo2 = getChatRepository();
      expect(repo1).toBe(repo2);
    });

    it('returns fresh instance after reset', () => {
      const repo1 = getChatRepository();
      resetContainer();
      const repo2 = getChatRepository();
      expect(repo1).not.toBe(repo2);
    });
  });

  describe('getUserRepository', () => {
    it('returns a user repository instance', () => {
      const repo = getUserRepository();
      expect(repo).toBeDefined();
    });

    it('returns singleton instance', () => {
      const repo1 = getUserRepository();
      const repo2 = getUserRepository();
      expect(repo1).toBe(repo2);
    });

    it('returns fresh instance after reset', () => {
      const repo1 = getUserRepository();
      resetContainer();
      const repo2 = getUserRepository();
      expect(repo1).not.toBe(repo2);
    });
  });

  describe('getChatService', () => {
    it('returns a chat service instance', () => {
      const service = getChatService();
      expect(service).toBeDefined();
    });

    it('returns singleton instance', () => {
      const service1 = getChatService();
      const service2 = getChatService();
      expect(service1).toBe(service2);
    });

    it('returns fresh instance after reset', () => {
      const service1 = getChatService();
      resetContainer();
      const service2 = getChatService();
      expect(service1).not.toBe(service2);
    });

    it('uses chat repository', () => {
      const service = getChatService();
      expect((service as any).chatRepository).toBeDefined();
    });
  });

  describe('setChatRepository', () => {
    it('allows custom repository implementation', () => {
      const customRepo = {
        getChats: vi.fn(),
        getChat: vi.fn(),
        createChat: vi.fn(),
        updateChat: vi.fn(),
        deleteChat: vi.fn(),
        getMessages: vi.fn(),
        addMessage: vi.fn(),
        updateMessage: vi.fn(),
        deleteMessage: vi.fn(),
        getChatByContactId: vi.fn(),
        syncChats: vi.fn(),
      } as unknown as IChatRepository;

      setChatRepository(customRepo);

      const repo = getChatRepository();
      expect(repo).toBe(customRepo);
    });

    it('resets chat service when repository changed', () => {
      const service1 = getChatService();

      const customRepo = {} as IChatRepository;
      setChatRepository(customRepo);

      const service2 = getChatService();
      expect(service1).not.toBe(service2);
    });
  });

  describe('setUserRepository', () => {
    it('allows custom repository implementation', () => {
      const customRepo = {
        getUser: vi.fn(),
        upsertUser: vi.fn(),
      } as unknown as IUserRepository;

      setUserRepository(customRepo);

      const repo = getUserRepository();
      expect(repo).toBe(customRepo);
    });
  });

  describe('getContainer', () => {
    it('returns all services', () => {
      const container = getContainer();

      expect(container.chatRepository).toBeDefined();
      expect(container.userRepository).toBeDefined();
      expect(container.chatService).toBeDefined();
    });

    it('returns same instances as individual getters', () => {
      const chatRepo = getChatRepository();
      const userRepo = getUserRepository();
      const chatService = getChatService();

      const container = getContainer();

      expect(container.chatRepository).toBe(chatRepo);
      expect(container.userRepository).toBe(userRepo);
      expect(container.chatService).toBe(chatService);
    });
  });

  describe('resetContainer', () => {
    it('resets all instances', () => {
      const chatRepo1 = getChatRepository();
      const userRepo1 = getUserRepository();
      const chatService1 = getChatService();

      resetContainer();

      const chatRepo2 = getChatRepository();
      const userRepo2 = getUserRepository();
      const chatService2 = getChatService();

      expect(chatRepo1).not.toBe(chatRepo2);
      expect(userRepo1).not.toBe(userRepo2);
      expect(chatService1).not.toBe(chatService2);
    });
  });
});
