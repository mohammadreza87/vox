'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { Chat, Message, PreMadeContactConfig } from '@/shared/types';
import { useAuth } from './AuthContext';
import { getChatsKey } from '@/shared/utils/storage';
import { auth } from '@/lib/firebase';

interface ChatContextType {
  chats: Chat[];
  activeChat: Chat | null;
  setActiveChat: (chat: Chat | null) => void;
  startChat: (contact: PreMadeContactConfig) => Chat;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  updateLastMessage: (chatId: string, content: string) => void;
  deleteChat: (chatId: string) => void;
  getChat: (chatId: string) => Chat | undefined;
  getChatByContactId: (contactId: string) => Chat | undefined;
  isLoading: boolean;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

// Debounce function for cloud sync
function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const previousUserIdRef = useRef<string | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Save chats to cloud (debounced)
  const saveToCloud = useCallback(async (chatsToSave: Chat[]) => {
    if (!user) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await fetch('/api/user/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ chats: chatsToSave }),
      });
    } catch (error) {
      console.error('Error saving chats to cloud:', error);
    }
  }, [user]);

  // Debounced cloud sync
  const debouncedSaveToCloud = useCallback(
    debounce((chatsToSave: Chat[]) => {
      saveToCloud(chatsToSave);
    }, 2000), // Sync after 2 seconds of inactivity
    [saveToCloud]
  );

  // Load chats from cloud
  const loadFromCloud = useCallback(async (): Promise<Chat[] | null> => {
    if (!user) return null;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;

      const response = await fetch('/api/user/data', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) return null;

      const data = await response.json();
      if (data.chats && data.chats.length > 0) {
        // Convert date strings to Date objects
        return data.chats.map((chat: Chat) => ({
          ...chat,
          lastMessageAt: new Date(chat.lastMessageAt),
          messages: (chat.messages || []).map((msg: Message) => ({
            ...msg,
            createdAt: new Date(msg.createdAt),
          })),
        }));
      }
      return [];
    } catch (error) {
      console.error('Error loading chats from cloud:', error);
      return null;
    }
  }, [user]);

  // Load chats when user changes
  useEffect(() => {
    setMounted(true);
    const currentUserId = user?.uid || null;

    // If user changed, clear current chats and load new user's chats
    if (previousUserIdRef.current !== currentUserId) {
      previousUserIdRef.current = currentUserId;
      setActiveChat(null);

      const loadChats = async () => {
        if (currentUserId) {
          setIsLoading(true);

          // Try to load from cloud first
          const cloudChats = await loadFromCloud();

          if (cloudChats !== null && cloudChats.length > 0) {
            setChats(cloudChats);
            // Also update localStorage as cache
            const storageKey = getChatsKey(currentUserId);
            localStorage.setItem(storageKey, JSON.stringify(cloudChats));
          } else {
            // Fall back to localStorage
            const storageKey = getChatsKey(currentUserId);
            const savedChats = localStorage.getItem(storageKey);

            if (savedChats) {
              try {
                const parsed = JSON.parse(savedChats);
                const chatsWithDates = parsed.map((chat: Chat) => ({
                  ...chat,
                  lastMessageAt: new Date(chat.lastMessageAt),
                  messages: chat.messages.map((msg: Message) => ({
                    ...msg,
                    createdAt: new Date(msg.createdAt),
                  })),
                }));
                setChats(chatsWithDates);

                // Sync localStorage data to cloud if it exists
                if (chatsWithDates.length > 0) {
                  saveToCloud(chatsWithDates);
                }
              } catch (e) {
                console.error('Error loading chats:', e);
                setChats([]);
              }
            } else {
              setChats([]);
            }
          }

          setIsLoading(false);
        } else {
          // Not logged in - use localStorage
          const storageKey = getChatsKey(null);
          const savedChats = localStorage.getItem(storageKey);

          if (savedChats) {
            try {
              const parsed = JSON.parse(savedChats);
              const chatsWithDates = parsed.map((chat: Chat) => ({
                ...chat,
                lastMessageAt: new Date(chat.lastMessageAt),
                messages: chat.messages.map((msg: Message) => ({
                  ...msg,
                  createdAt: new Date(msg.createdAt),
                })),
              }));
              setChats(chatsWithDates);
            } catch (e) {
              console.error('Error loading chats:', e);
              setChats([]);
            }
          } else {
            setChats([]);
          }
        }
      };

      loadChats();
    }
  }, [user, loadFromCloud, saveToCloud]);

  // Save chats to localStorage and cloud when they change
  useEffect(() => {
    if (mounted) {
      const storageKey = getChatsKey(user?.uid || null);
      localStorage.setItem(storageKey, JSON.stringify(chats));

      // Also sync to cloud (debounced)
      if (user && chats.length >= 0) {
        debouncedSaveToCloud(chats);
      }
    }
  }, [chats, mounted, user, debouncedSaveToCloud]);

  const startChat = useCallback((contact: PreMadeContactConfig): Chat => {
    // Check if chat already exists for this contact
    const existingChat = chats.find(c => c.contactId === contact.id);
    if (existingChat) {
      setActiveChat(existingChat);
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

    setChats(prev => [newChat, ...prev]);
    setActiveChat(newChat);
    return newChat;
  }, [chats]);

  const addMessage = useCallback((chatId: string, message: Message) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        return {
          ...chat,
          messages: [...chat.messages, message],
          lastMessage: message.content.slice(0, 100),
          lastMessageAt: new Date(),
        };
      }
      return chat;
    }));

    // Update active chat if it's the same
    setActiveChat(prev => {
      if (prev?.id === chatId) {
        return {
          ...prev,
          messages: [...prev.messages, message],
          lastMessage: message.content.slice(0, 100),
          lastMessageAt: new Date(),
        };
      }
      return prev;
    });
  }, []);

  const updateLastMessage = useCallback((chatId: string, content: string) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        return {
          ...chat,
          lastMessage: content.slice(0, 100),
          lastMessageAt: new Date(),
        };
      }
      return chat;
    }));
  }, []);

  const updateMessage = useCallback((chatId: string, messageId: string, updates: Partial<Message>) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        return {
          ...chat,
          messages: chat.messages.map(msg =>
            msg.id === messageId ? { ...msg, ...updates } : msg
          ),
        };
      }
      return chat;
    }));

    // Update active chat if it's the same
    setActiveChat(prev => {
      if (prev?.id === chatId) {
        return {
          ...prev,
          messages: prev.messages.map(msg =>
            msg.id === messageId ? { ...msg, ...updates } : msg
          ),
        };
      }
      return prev;
    });
  }, []);

  const deleteChat = useCallback((chatId: string) => {
    setChats(prev => prev.filter(chat => chat.id !== chatId));
    setActiveChat(prev => prev?.id === chatId ? null : prev);
  }, []);

  const getChat = useCallback((chatId: string) => {
    return chats.find(c => c.id === chatId);
  }, [chats]);

  const getChatByContactId = useCallback((contactId: string) => {
    return chats.find(c => c.contactId === contactId);
  }, [chats]);

  return (
    <ChatContext.Provider value={{
      chats,
      activeChat,
      setActiveChat,
      startChat,
      addMessage,
      updateMessage,
      updateLastMessage,
      deleteChat,
      getChat,
      getChatByContactId,
      isLoading,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
