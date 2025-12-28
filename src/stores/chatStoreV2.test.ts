import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChatStoreV2, initChatsV2 } from './chatStoreV2';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock authStore
vi.mock('./authStore', () => ({
  getCurrentUserId: vi.fn(() => null),
}));

// Mock sync middleware
vi.mock('./middleware/sync', () => ({
  getAuthToken: vi.fn(() => Promise.resolve(null)),
}));

// Mock debounce
vi.mock('@/shared/utils/debounce', () => ({
  debounce: vi.fn((fn) => fn),
}));

const { getCurrentUserId } = await import('./authStore');
const { getAuthToken } = await import('./middleware/sync');

describe('chatStoreV2', () => {
  const mockContact = {
    id: 'contact-1',
    name: 'Test Assistant',
    purpose: 'Testing purposes',
    systemPrompt: 'You are a test assistant',
    avatarEmoji: '🤖',
    category: 'personal' as const,
  };

  const mockChat = {
    id: 'chat-1',
    contactId: 'contact-1',
    contactName: 'Test Assistant',
    contactEmoji: '🤖',
    contactPurpose: 'Testing purposes',
    lastMessage: 'Hello there',
    lastMessageAt: new Date(),
    messages: [],
  };

  const mockMessage = {
    id: 'msg-1',
    contactId: 'contact-1',
    role: 'user' as const,
    content: 'Hello, how are you?',
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    vi.mocked(localStorage.setItem).mockClear();
    mockFetch.mockReset();
    useChatStoreV2.setState({
      chats: [],
      activeChat: null,
      isLoading: false,
      isSyncing: false,
      lastSyncAt: null,
      needsMigration: false,
      migrationStatus: null,
    });
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = useChatStoreV2.getState();
      expect(state.chats).toEqual([]);
      expect(state.activeChat).toBe(null);
      expect(state.isLoading).toBe(false);
      expect(state.isSyncing).toBe(false);
      expect(state.needsMigration).toBe(false);
    });
  });

  describe('setChats', () => {
    it('sets chats array', () => {
      useChatStoreV2.getState().setChats([mockChat]);
      expect(useChatStoreV2.getState().chats).toEqual([mockChat]);
    });
  });

  describe('setActiveChat', () => {
    it('sets active chat', () => {
      useChatStoreV2.getState().setActiveChat(mockChat);
      expect(useChatStoreV2.getState().activeChat).toEqual(mockChat);
    });

    it('clears active chat', () => {
      useChatStoreV2.setState({ activeChat: mockChat });
      useChatStoreV2.getState().setActiveChat(null);
      expect(useChatStoreV2.getState().activeChat).toBe(null);
    });
  });

  describe('startChat', () => {
    it('creates a new chat locally', async () => {
      const chat = await useChatStoreV2.getState().startChat(mockContact);

      expect(chat.contactId).toBe('contact-1');
      expect(chat.contactName).toBe('Test Assistant');
      expect(chat.messages).toEqual([]);
      expect(useChatStoreV2.getState().chats).toHaveLength(1);
      expect(useChatStoreV2.getState().activeChat).toEqual(chat);
    });

    it('returns existing chat if already exists', async () => {
      useChatStoreV2.setState({ chats: [mockChat] });

      const chat = await useChatStoreV2.getState().startChat(mockContact);

      expect(chat.id).toBe('chat-1');
      expect(useChatStoreV2.getState().chats).toHaveLength(1);
    });

    it('syncs to server when logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(getAuthToken).mockResolvedValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ chat: { id: 'server-chat-id' } }),
      });

      const chat = await useChatStoreV2.getState().startChat(mockContact);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v2/chats',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
      expect(chat.id).toBe('server-chat-id');
    });

    it('saves to localStorage', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null); // Ensure anonymous user

      await useChatStoreV2.getState().startChat(mockContact);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox-chats-anonymous',
        expect.any(String)
      );
    });
  });

  describe('addMessage', () => {
    it('adds message optimistically', async () => {
      useChatStoreV2.setState({
        chats: [{ ...mockChat, messages: [] }],
        activeChat: { ...mockChat, messages: [] },
      });

      await useChatStoreV2.getState().addMessage('chat-1', mockMessage);

      const chat = useChatStoreV2.getState().chats[0];
      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].content).toBe('Hello, how are you?');
    });

    it('updates lastMessage', async () => {
      useChatStoreV2.setState({
        chats: [{ ...mockChat, messages: [], lastMessage: '' }],
      });

      await useChatStoreV2.getState().addMessage('chat-1', mockMessage);

      const chat = useChatStoreV2.getState().chats[0];
      expect(chat.lastMessage).toBe('Hello, how are you?');
    });

    it('syncs to server when logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(getAuthToken).mockResolvedValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: { id: 'server-msg-id' } }),
      });

      useChatStoreV2.setState({
        chats: [{ ...mockChat, messages: [] }],
      });

      await useChatStoreV2.getState().addMessage('chat-1', mockMessage);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v2/chats/chat-1/messages',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('updateMessage', () => {
    it('updates message properties', () => {
      const chatWithMessage = {
        ...mockChat,
        messages: [mockMessage],
      };
      useChatStoreV2.setState({
        chats: [chatWithMessage],
        activeChat: chatWithMessage,
      });

      useChatStoreV2.getState().updateMessage('chat-1', 'msg-1', { content: 'Updated content' });

      const chat = useChatStoreV2.getState().chats[0];
      expect(chat.messages[0].content).toBe('Updated content');
    });

    it('updates activeChat if same chat', () => {
      const chatWithMessage = {
        ...mockChat,
        messages: [mockMessage],
      };
      useChatStoreV2.setState({
        chats: [chatWithMessage],
        activeChat: chatWithMessage,
      });

      useChatStoreV2.getState().updateMessage('chat-1', 'msg-1', { content: 'Updated' });

      expect(useChatStoreV2.getState().activeChat?.messages[0].content).toBe('Updated');
    });
  });

  describe('deleteChat', () => {
    it('removes chat optimistically', async () => {
      const chat2 = { ...mockChat, id: 'chat-2', contactId: 'contact-2' };
      useChatStoreV2.setState({ chats: [mockChat, chat2] });

      await useChatStoreV2.getState().deleteChat('chat-1');

      expect(useChatStoreV2.getState().chats).toHaveLength(1);
      expect(useChatStoreV2.getState().chats[0].id).toBe('chat-2');
    });

    it('clears activeChat if deleted', async () => {
      useChatStoreV2.setState({
        chats: [mockChat],
        activeChat: mockChat,
      });

      await useChatStoreV2.getState().deleteChat('chat-1');

      expect(useChatStoreV2.getState().activeChat).toBe(null);
    });

    it('syncs deletion to server', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(getAuthToken).mockResolvedValue('test-token');
      mockFetch.mockResolvedValueOnce({ ok: true });

      useChatStoreV2.setState({ chats: [mockChat] });

      await useChatStoreV2.getState().deleteChat('chat-1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v2/chats/chat-1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('getChat', () => {
    it('returns chat by id', () => {
      useChatStoreV2.setState({ chats: [mockChat] });

      const chat = useChatStoreV2.getState().getChat('chat-1');

      expect(chat).toEqual(mockChat);
    });

    it('returns undefined for non-existent chat', () => {
      const chat = useChatStoreV2.getState().getChat('non-existent');
      expect(chat).toBeUndefined();
    });
  });

  describe('getChatByContactId', () => {
    it('returns chat by contact id', () => {
      useChatStoreV2.setState({ chats: [mockChat] });

      const chat = useChatStoreV2.getState().getChatByContactId('contact-1');

      expect(chat).toEqual(mockChat);
    });
  });

  describe('loadChats', () => {
    it('loads from localStorage when not logged in', async () => {
      const storedChat = {
        ...mockChat,
        lastMessageAt: mockChat.lastMessageAt.toISOString(),
        messages: [],
      };
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([storedChat]));

      await useChatStoreV2.getState().loadChats();

      expect(useChatStoreV2.getState().chats).toHaveLength(1);
      expect(useChatStoreV2.getState().isLoading).toBe(false);
    });

    it('loads from server when logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(getAuthToken).mockResolvedValue('test-token');

      // Mock migration check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ needsMigration: false, status: null }),
      });

      // Mock sync fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            chats: [
              {
                ...mockChat,
                lastMessageAt: mockChat.lastMessageAt.toISOString(),
                messages: [],
              },
            ],
          }),
      });

      await useChatStoreV2.getState().loadChats();

      expect(useChatStoreV2.getState().chats).toHaveLength(1);
    });

    it('handles errors gracefully', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(getAuthToken).mockResolvedValue('test-token');
      mockFetch.mockRejectedValue(new Error('Network error'));

      await useChatStoreV2.getState().loadChats();

      expect(useChatStoreV2.getState().isLoading).toBe(false);
    });
  });

  describe('syncWithServer', () => {
    it('does nothing when not logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null);

      await useChatStoreV2.getState().syncWithServer();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches from server when logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(getAuthToken).mockResolvedValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            chats: [
              {
                ...mockChat,
                lastMessageAt: mockChat.lastMessageAt.toISOString(),
                messages: [],
              },
            ],
          }),
      });

      await useChatStoreV2.getState().syncWithServer();

      expect(useChatStoreV2.getState().chats).toHaveLength(1);
      expect(useChatStoreV2.getState().lastSyncAt).toBeTruthy();
    });

    it('sets isSyncing during sync', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(getAuthToken).mockResolvedValue('test-token');

      let syncingDuringFetch = false;
      mockFetch.mockImplementationOnce(() => {
        syncingDuringFetch = useChatStoreV2.getState().isSyncing;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ chats: [] }),
        });
      });

      await useChatStoreV2.getState().syncWithServer();

      expect(syncingDuringFetch).toBe(true);
      expect(useChatStoreV2.getState().isSyncing).toBe(false);
    });
  });

  describe('checkMigration', () => {
    it('checks migration status from server', async () => {
      vi.mocked(getAuthToken).mockResolvedValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ needsMigration: true, status: 'not_started' }),
      });

      await useChatStoreV2.getState().checkMigration();

      expect(useChatStoreV2.getState().needsMigration).toBe(true);
      expect(useChatStoreV2.getState().migrationStatus).toBe('not_started');
    });

    it('does nothing without token', async () => {
      vi.mocked(getAuthToken).mockResolvedValue(null);

      await useChatStoreV2.getState().checkMigration();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('runMigration', () => {
    it('does nothing without auth token', async () => {
      vi.mocked(getAuthToken).mockResolvedValue(null);

      await useChatStoreV2.getState().runMigration();

      // Should remain null when no token
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sets failed status on error', async () => {
      vi.mocked(getAuthToken).mockResolvedValue('test-token');
      mockFetch.mockResolvedValueOnce({ ok: false });

      await useChatStoreV2.getState().runMigration();

      expect(useChatStoreV2.getState().migrationStatus).toBe('failed');
    });
  });

  describe('initChatsV2', () => {
    it('loads chats on init', async () => {
      const storedChat = {
        ...mockChat,
        lastMessageAt: mockChat.lastMessageAt.toISOString(),
        messages: [],
      };
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([storedChat]));

      await initChatsV2();

      expect(useChatStoreV2.getState().chats).toHaveLength(1);
    });
  });
});
