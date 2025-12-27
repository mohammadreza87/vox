/**
 * Chat Store V2
 * Uses new scalable database schema with real-time sync
 */

import { create } from 'zustand';
import { Chat, Message, PreMadeContactConfig } from '@/shared/types';
import { getChatsKey } from '@/shared/utils/storage';
import { getCurrentUserId } from './authStore';
import { debounce } from '@/shared/utils/debounce';
import { getAuthToken } from './middleware/sync';

interface ChatStoreState {
  chats: Chat[];
  activeChat: Chat | null;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncAt: string | null;
  needsMigration: boolean;
  migrationStatus: 'not_started' | 'in_progress' | 'completed' | 'failed' | null;
}

interface ChatStoreActions {
  setChats: (chats: Chat[]) => void;
  setActiveChat: (chat: Chat | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;

  // CRUD operations
  startChat: (contact: PreMadeContactConfig) => Promise<Chat>;
  addMessage: (chatId: string, message: Message) => Promise<void>;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  deleteChat: (chatId: string) => Promise<void>;
  getChat: (chatId: string) => Chat | undefined;
  getChatByContactId: (contactId: string) => Chat | undefined;

  // Sync operations
  loadChats: () => Promise<void>;
  syncWithServer: () => Promise<void>;
  checkMigration: () => Promise<void>;
  runMigration: () => Promise<void>;
}

type ChatStore = ChatStoreState & ChatStoreActions;

// Debounced sync
const debouncedSync = debounce(async (store: ChatStore) => {
  await syncChatsToServer(store.chats);
}, 2000);

// API helpers
async function fetchChatsFromServer(): Promise<Chat[]> {
  const token = await getAuthToken();
  if (!token) return [];

  try {
    const response = await fetch('/api/v2/sync', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.chats || []).map((chat: Record<string, unknown>) => ({
      id: chat.id,
      contactId: chat.contactId,
      contactName: chat.contactName,
      contactEmoji: chat.contactEmoji,
      contactImage: chat.contactImage,
      contactPurpose: chat.contactPurpose,
      lastMessage: chat.lastMessage,
      lastMessageAt: new Date(chat.lastMessageAt as string),
      messages: ((chat.messages as Array<Record<string, unknown>>) || []).map((msg) => ({
        id: msg.id,
        contactId: chat.contactId,
        role: msg.role,
        content: msg.content,
        audioUrl: msg.audioUrl,
        createdAt: new Date(msg.createdAt as string),
      })),
    }));
  } catch (error) {
    console.error('Error fetching chats from server:', error);
    return [];
  }
}

async function syncChatsToServer(chats: Chat[]): Promise<boolean> {
  const token = await getAuthToken();
  if (!token) return false;

  try {
    const response = await fetch('/api/v2/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        localChats: chats.map((chat) => ({
          id: chat.id,
          contactId: chat.contactId,
          contactName: chat.contactName,
          contactEmoji: chat.contactEmoji,
          contactImage: chat.contactImage,
          contactPurpose: chat.contactPurpose,
          lastMessage: chat.lastMessage,
          lastMessageAt: chat.lastMessageAt.toISOString(),
          messages: chat.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            audioUrl: msg.audioUrl,
            createdAt: msg.createdAt.toISOString(),
          })),
        })),
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error syncing chats to server:', error);
    return false;
  }
}

async function createChatOnServer(chat: Omit<Chat, 'messages'>): Promise<string | null> {
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const response = await fetch('/api/v2/chats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contactId: chat.contactId,
        contactName: chat.contactName,
        contactEmoji: chat.contactEmoji,
        contactImage: chat.contactImage,
        contactPurpose: chat.contactPurpose,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.chat?.id || null;
  } catch (error) {
    console.error('Error creating chat on server:', error);
    return null;
  }
}

async function addMessageToServer(
  chatId: string,
  message: Omit<Message, 'id' | 'createdAt' | 'contactId'>
): Promise<string | null> {
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const response = await fetch(`/api/v2/chats/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        role: message.role,
        content: message.content,
        audioUrl: message.audioUrl,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.message?.id || null;
  } catch (error) {
    console.error('Error adding message to server:', error);
    return null;
  }
}

async function deleteChatOnServer(chatId: string): Promise<boolean> {
  const token = await getAuthToken();
  if (!token) return false;

  try {
    const response = await fetch(`/api/v2/chats/${chatId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    return response.ok;
  } catch (error) {
    console.error('Error deleting chat on server:', error);
    return false;
  }
}

// Local storage helpers
function getStorageKey(): string {
  const userId = getCurrentUserId();
  return getChatsKey(userId);
}

function saveToLocalStorage(chats: Chat[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getStorageKey(), JSON.stringify(chats));
}

function loadFromLocalStorage(): Chat[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(getStorageKey());
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return parsed.map((chat: Chat) => ({
      ...chat,
      lastMessageAt: new Date(chat.lastMessageAt),
      messages: chat.messages.map((msg: Message) => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
      })),
    }));
  } catch {
    return [];
  }
}

export const useChatStoreV2 = create<ChatStore>((set, get) => ({
  // State
  chats: [],
  activeChat: null,
  isLoading: false,
  isSyncing: false,
  lastSyncAt: null,
  needsMigration: false,
  migrationStatus: null,

  // Actions
  setChats: (chats) => set({ chats }),
  setActiveChat: (chat) => set({ activeChat: chat }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),

  startChat: async (contact: PreMadeContactConfig) => {
    const { chats } = get();

    // Check if chat already exists
    const existingChat = chats.find((c) => c.contactId === contact.id);
    if (existingChat) {
      set({ activeChat: existingChat });
      return existingChat;
    }

    // Create new chat locally
    const newChat: Chat = {
      id: `chat-${Date.now()}`,
      contactId: contact.id,
      contactName: contact.name,
      contactEmoji: contact.avatarEmoji,
      contactImage: contact.avatarImage,
      contactPurpose: contact.purpose,
      lastMessage: '',
      lastMessageAt: new Date(),
      messages: [],
    };

    // Optimistic update
    const newChats = [newChat, ...chats];
    set({ chats: newChats, activeChat: newChat });
    saveToLocalStorage(newChats);

    // Create on server
    const userId = getCurrentUserId();
    if (userId) {
      const serverId = await createChatOnServer(newChat);
      if (serverId) {
        // Update with server ID
        const updatedChat = { ...newChat, id: serverId };
        const updatedChats = newChats.map((c) =>
          c.id === newChat.id ? updatedChat : c
        );
        set({ chats: updatedChats, activeChat: updatedChat });
        saveToLocalStorage(updatedChats);
        return updatedChat;
      }
    }

    return newChat;
  },

  addMessage: async (chatId: string, message: Message) => {
    const { chats, activeChat } = get();

    // Optimistic update
    const newChats = chats.map((chat) => {
      if (chat.id === chatId) {
        return {
          ...chat,
          messages: [...chat.messages, message],
          lastMessage: message.content.slice(0, 100),
          lastMessageAt: new Date(),
        };
      }
      return chat;
    });

    const newActiveChat =
      activeChat?.id === chatId
        ? {
            ...activeChat,
            messages: [...activeChat.messages, message],
            lastMessage: message.content.slice(0, 100),
            lastMessageAt: new Date(),
          }
        : activeChat;

    set({ chats: newChats, activeChat: newActiveChat });
    saveToLocalStorage(newChats);

    // Add to server
    const userId = getCurrentUserId();
    if (userId) {
      await addMessageToServer(chatId, message);
    }
  },

  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => {
    const { chats, activeChat } = get();

    const newChats = chats.map((chat) => {
      if (chat.id === chatId) {
        return {
          ...chat,
          messages: chat.messages.map((msg) =>
            msg.id === messageId ? { ...msg, ...updates } : msg
          ),
        };
      }
      return chat;
    });

    const newActiveChat =
      activeChat?.id === chatId
        ? {
            ...activeChat,
            messages: activeChat.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...updates } : msg
            ),
          }
        : activeChat;

    set({ chats: newChats, activeChat: newActiveChat });
    saveToLocalStorage(newChats);

    // Debounced sync to server
    debouncedSync(get());
  },

  deleteChat: async (chatId: string) => {
    const { chats, activeChat } = get();

    // Optimistic update
    const newChats = chats.filter((chat) => chat.id !== chatId);
    const newActiveChat = activeChat?.id === chatId ? null : activeChat;

    set({ chats: newChats, activeChat: newActiveChat });
    saveToLocalStorage(newChats);

    // Delete on server
    const userId = getCurrentUserId();
    if (userId) {
      await deleteChatOnServer(chatId);
    }
  },

  getChat: (chatId: string) => {
    return get().chats.find((c) => c.id === chatId);
  },

  getChatByContactId: (contactId: string) => {
    return get().chats.find((c) => c.contactId === contactId);
  },

  loadChats: async () => {
    const userId = getCurrentUserId();
    set({ isLoading: true });

    try {
      if (userId) {
        // Check migration status first
        await get().checkMigration();

        // Fetch from server
        const serverChats = await fetchChatsFromServer();

        if (serverChats.length > 0) {
          set({ chats: serverChats, lastSyncAt: new Date().toISOString() });
          saveToLocalStorage(serverChats);
        } else {
          // Fall back to localStorage
          const localChats = loadFromLocalStorage();
          set({ chats: localChats });

          // If we have local chats, sync them to server
          if (localChats.length > 0) {
            await syncChatsToServer(localChats);
          }
        }
      } else {
        // Not logged in - use localStorage only
        const localChats = loadFromLocalStorage();
        set({ chats: localChats });
      }
    } catch (error) {
      console.error('Error loading chats:', error);
      // Fall back to localStorage
      const localChats = loadFromLocalStorage();
      set({ chats: localChats });
    } finally {
      set({ isLoading: false });
    }
  },

  syncWithServer: async () => {
    const userId = getCurrentUserId();
    if (!userId) return;

    set({ isSyncing: true });

    try {
      const serverChats = await fetchChatsFromServer();

      if (serverChats.length > 0) {
        set({ chats: serverChats, lastSyncAt: new Date().toISOString() });
        saveToLocalStorage(serverChats);
      }
    } catch (error) {
      console.error('Error syncing with server:', error);
    } finally {
      set({ isSyncing: false });
    }
  },

  checkMigration: async () => {
    const token = await getAuthToken();
    if (!token) return;

    try {
      const response = await fetch('/api/v2/migrate', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        set({
          needsMigration: data.needsMigration,
          migrationStatus: data.status,
        });
      }
    } catch (error) {
      console.error('Error checking migration:', error);
    }
  },

  runMigration: async () => {
    const token = await getAuthToken();
    if (!token) return;

    set({ migrationStatus: 'in_progress' });

    try {
      const response = await fetch('/api/v2/migrate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        set({
          needsMigration: false,
          migrationStatus: 'completed',
        });

        // Reload chats after migration
        await get().loadChats();
      } else {
        set({ migrationStatus: 'failed' });
      }
    } catch (error) {
      console.error('Error running migration:', error);
      set({ migrationStatus: 'failed' });
    }
  },
}));

/**
 * Initialize chats v2 - call this when user state changes
 */
export async function initChatsV2(): Promise<void> {
  const store = useChatStoreV2.getState();
  await store.loadChats();
}
