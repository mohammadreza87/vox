/**
 * Chat Store
 * Manages chat conversations with localStorage and cloud sync
 */

import { create } from 'zustand';
import { Chat, Message, PreMadeContactConfig } from '@/shared/types';
import { getChatsKey } from '@/shared/utils/storage';
import { getCurrentUserId } from './authStore';
import { createCloudSync, loadFromCloud } from './middleware/sync';
import type { ChatStore } from './types';

// Cloud sync configuration
const chatCloudSync = createCloudSync<Chat[]>({
  endpoint: '/api/user/data',
  debounceMs: 2000,
  dataKey: 'chats',
});

// Transform dates when loading from cloud
function transformChatsFromCloud(data: unknown): Chat[] {
  if (!Array.isArray(data)) return [];

  return data.map((chat: Chat) => ({
    ...chat,
    lastMessageAt: new Date(chat.lastMessageAt),
    messages: (chat.messages || []).map((msg: Message) => ({
      ...msg,
      createdAt: new Date(msg.createdAt),
    })),
  }));
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // State
  chats: [],
  activeChat: null,
  isLoading: false,

  // Actions
  setChats: (chats) => set({ chats }),
  setActiveChat: (chat) => set({ activeChat: chat }),
  setLoading: (isLoading) => set({ isLoading }),

  startChat: (contact: PreMadeContactConfig) => {
    const { chats } = get();

    // Check if chat already exists
    const existingChat = chats.find((c) => c.contactId === contact.id);
    if (existingChat) {
      set({ activeChat: existingChat });
      return existingChat;
    }

    // Create new chat
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

    const newChats = [newChat, ...chats];
    set({ chats: newChats, activeChat: newChat });

    // Sync to localStorage and cloud
    saveToLocalStorage(newChats);
    chatCloudSync(newChats);

    return newChat;
  },

  addMessage: (chatId: string, message: Message) => {
    set((state) => {
      const newChats = state.chats.map((chat) => {
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

      // Update active chat if it's the same
      const newActiveChat =
        state.activeChat?.id === chatId
          ? {
              ...state.activeChat,
              messages: [...state.activeChat.messages, message],
              lastMessage: message.content.slice(0, 100),
              lastMessageAt: new Date(),
            }
          : state.activeChat;

      // Sync
      saveToLocalStorage(newChats);
      chatCloudSync(newChats);

      return { chats: newChats, activeChat: newActiveChat };
    });
  },

  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => {
    set((state) => {
      const newChats = state.chats.map((chat) => {
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
        state.activeChat?.id === chatId
          ? {
              ...state.activeChat,
              messages: state.activeChat.messages.map((msg) =>
                msg.id === messageId ? { ...msg, ...updates } : msg
              ),
            }
          : state.activeChat;

      // Sync
      saveToLocalStorage(newChats);
      chatCloudSync(newChats);

      return { chats: newChats, activeChat: newActiveChat };
    });
  },

  updateLastMessage: (chatId: string, content: string) => {
    set((state) => {
      const newChats = state.chats.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            lastMessage: content.slice(0, 100),
            lastMessageAt: new Date(),
          };
        }
        return chat;
      });

      saveToLocalStorage(newChats);
      chatCloudSync(newChats);

      return { chats: newChats };
    });
  },

  deleteChat: (chatId: string) => {
    set((state) => {
      const newChats = state.chats.filter((chat) => chat.id !== chatId);
      const newActiveChat = state.activeChat?.id === chatId ? null : state.activeChat;

      saveToLocalStorage(newChats);
      chatCloudSync(newChats);

      return { chats: newChats, activeChat: newActiveChat };
    });
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
        // Try cloud first
        const cloudChats = await loadFromCloud<Chat[]>(
          '/api/user/data',
          'chats',
          transformChatsFromCloud
        );

        if (cloudChats && cloudChats.length > 0) {
          set({ chats: cloudChats });
          saveToLocalStorage(cloudChats);
        } else {
          // Fall back to localStorage
          const localChats = loadFromLocalStorage();
          if (localChats.length > 0) {
            set({ chats: localChats });
            // Sync to cloud
            chatCloudSync(localChats);
          }
        }
      } else {
        // Not logged in - use localStorage only
        const localChats = loadFromLocalStorage();
        set({ chats: localChats });
      }
    } catch (error) {
      console.error('Error loading chats:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  syncToCloud: async () => {
    const { chats } = get();
    chatCloudSync(chats);
  },
}));

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
  } catch (error) {
    console.error('Error loading chats from localStorage:', error);
    return [];
  }
}

/**
 * Initialize chats - call this when user state changes
 */
export async function initChats(): Promise<void> {
  const store = useChatStore.getState();
  await store.loadChats();
}
