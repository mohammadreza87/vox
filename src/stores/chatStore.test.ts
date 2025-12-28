import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChatStore, initChats } from './chatStore';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock authStore
vi.mock('./authStore', () => ({
  getCurrentUserId: vi.fn(() => null),
}));

// Mock sync middleware
vi.mock('./middleware/sync', () => ({
  createCloudSync: vi.fn(() => vi.fn()),
  loadFromCloud: vi.fn(() => Promise.resolve(null)),
  getAuthToken: vi.fn(() => Promise.resolve(null)),
}));

const { getCurrentUserId } = await import('./authStore');
const { loadFromCloud } = await import('./middleware/sync');

describe('chatStore', () => {
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
    useChatStore.setState({
      chats: [],
      activeChat: null,
      isLoading: false,
    });
  });

  describe('Initial State', () => {
    it('has correct initial state', () => {
      const state = useChatStore.getState();
      expect(state.chats).toEqual([]);
      expect(state.activeChat).toBe(null);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('setChats', () => {
    it('sets chats array', () => {
      useChatStore.getState().setChats([mockChat]);
      expect(useChatStore.getState().chats).toEqual([mockChat]);
    });
  });

  describe('setActiveChat', () => {
    it('sets active chat', () => {
      useChatStore.getState().setActiveChat(mockChat);
      expect(useChatStore.getState().activeChat).toEqual(mockChat);
    });

    it('clears active chat', () => {
      useChatStore.setState({ activeChat: mockChat });
      useChatStore.getState().setActiveChat(null);
      expect(useChatStore.getState().activeChat).toBe(null);
    });
  });

  describe('startChat', () => {
    it('creates a new chat', () => {
      const chat = useChatStore.getState().startChat(mockContact);

      expect(chat.contactId).toBe('contact-1');
      expect(chat.contactName).toBe('Test Assistant');
      expect(chat.messages).toEqual([]);
      expect(useChatStore.getState().chats).toHaveLength(1);
      expect(useChatStore.getState().activeChat).toEqual(chat);
    });

    it('returns existing chat if already exists', () => {
      useChatStore.setState({
        chats: [mockChat],
      });

      const chat = useChatStore.getState().startChat(mockContact);

      expect(chat.id).toBe('chat-1');
      expect(useChatStore.getState().chats).toHaveLength(1);
    });

    it('saves to localStorage', () => {
      useChatStore.getState().startChat(mockContact);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'vox-chats-anonymous',
        expect.any(String)
      );
    });
  });

  describe('addMessage', () => {
    it('adds message to chat', () => {
      useChatStore.setState({
        chats: [{ ...mockChat, messages: [] }],
        activeChat: { ...mockChat, messages: [] },
      });

      useChatStore.getState().addMessage('chat-1', mockMessage);

      const chat = useChatStore.getState().chats[0];
      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].content).toBe('Hello, how are you?');
    });

    it('updates lastMessage', () => {
      useChatStore.setState({
        chats: [{ ...mockChat, messages: [], lastMessage: '' }],
      });

      useChatStore.getState().addMessage('chat-1', mockMessage);

      const chat = useChatStore.getState().chats[0];
      expect(chat.lastMessage).toBe('Hello, how are you?');
    });

    it('updates activeChat if same chat', () => {
      useChatStore.setState({
        chats: [{ ...mockChat, messages: [] }],
        activeChat: { ...mockChat, messages: [] },
      });

      useChatStore.getState().addMessage('chat-1', mockMessage);

      expect(useChatStore.getState().activeChat?.messages).toHaveLength(1);
    });
  });

  describe('updateMessage', () => {
    it('updates message properties', () => {
      const chatWithMessage = {
        ...mockChat,
        messages: [mockMessage],
      };
      useChatStore.setState({
        chats: [chatWithMessage],
        activeChat: chatWithMessage,
      });

      useChatStore.getState().updateMessage('chat-1', 'msg-1', { content: 'Updated content' });

      const chat = useChatStore.getState().chats[0];
      expect(chat.messages[0].content).toBe('Updated content');
    });
  });

  describe('updateLastMessage', () => {
    it('updates last message text', () => {
      useChatStore.setState({ chats: [mockChat] });

      useChatStore.getState().updateLastMessage('chat-1', 'New last message');

      const chat = useChatStore.getState().chats[0];
      expect(chat.lastMessage).toBe('New last message');
    });

    it('truncates long messages', () => {
      useChatStore.setState({ chats: [mockChat] });

      const longMessage = 'x'.repeat(200);
      useChatStore.getState().updateLastMessage('chat-1', longMessage);

      const chat = useChatStore.getState().chats[0];
      expect(chat.lastMessage.length).toBe(100);
    });
  });

  describe('deleteChat', () => {
    it('removes chat from list', () => {
      const chat2 = { ...mockChat, id: 'chat-2', contactId: 'contact-2' };
      useChatStore.setState({ chats: [mockChat, chat2] });

      useChatStore.getState().deleteChat('chat-1');

      expect(useChatStore.getState().chats).toHaveLength(1);
      expect(useChatStore.getState().chats[0].id).toBe('chat-2');
    });

    it('clears activeChat if deleted', () => {
      useChatStore.setState({
        chats: [mockChat],
        activeChat: mockChat,
      });

      useChatStore.getState().deleteChat('chat-1');

      expect(useChatStore.getState().activeChat).toBe(null);
    });

    it('preserves activeChat if different chat deleted', () => {
      const chat2 = { ...mockChat, id: 'chat-2' };
      useChatStore.setState({
        chats: [mockChat, chat2],
        activeChat: chat2,
      });

      useChatStore.getState().deleteChat('chat-1');

      expect(useChatStore.getState().activeChat?.id).toBe('chat-2');
    });
  });

  describe('getChat', () => {
    it('returns chat by id', () => {
      useChatStore.setState({ chats: [mockChat] });

      const chat = useChatStore.getState().getChat('chat-1');

      expect(chat).toEqual(mockChat);
    });

    it('returns undefined for non-existent chat', () => {
      const chat = useChatStore.getState().getChat('non-existent');
      expect(chat).toBeUndefined();
    });
  });

  describe('getChatByContactId', () => {
    it('returns chat by contact id', () => {
      useChatStore.setState({ chats: [mockChat] });

      const chat = useChatStore.getState().getChatByContactId('contact-1');

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

      await useChatStore.getState().loadChats();

      expect(useChatStore.getState().chats).toHaveLength(1);
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('loads from cloud when logged in', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(loadFromCloud).mockResolvedValueOnce([mockChat]);

      await useChatStore.getState().loadChats();

      expect(useChatStore.getState().chats).toHaveLength(1);
    });

    it('falls back to localStorage if cloud empty', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(loadFromCloud).mockResolvedValueOnce(null);

      const storedChat = {
        ...mockChat,
        lastMessageAt: mockChat.lastMessageAt.toISOString(),
        messages: [],
      };
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([storedChat]));

      await useChatStore.getState().loadChats();

      expect(useChatStore.getState().chats).toHaveLength(1);
    });

    it('handles errors gracefully', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123');
      vi.mocked(loadFromCloud).mockRejectedValueOnce(new Error('Network error'));

      await useChatStore.getState().loadChats();

      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  describe('initChats', () => {
    it('loads chats on init', async () => {
      const storedChat = {
        ...mockChat,
        lastMessageAt: mockChat.lastMessageAt.toISOString(),
        messages: [],
      };
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([storedChat]));

      await initChats();

      expect(useChatStore.getState().chats).toHaveLength(1);
    });
  });
});
