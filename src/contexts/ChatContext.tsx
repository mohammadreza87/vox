'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { Chat, Message, PreMadeContactConfig } from '@/shared/types';

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
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [mounted, setMounted] = useState(false);

  // Load chats from localStorage on mount
  useEffect(() => {
    setMounted(true);
    const savedChats = localStorage.getItem('vox-chats');
    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats);
        // Convert date strings back to Date objects
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
      }
    }
  }, []);

  // Save chats to localStorage when they change
  useEffect(() => {
    if (mounted && chats.length > 0) {
      localStorage.setItem('vox-chats', JSON.stringify(chats));
    }
  }, [chats, mounted]);

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

    // Also update localStorage
    const savedChats = localStorage.getItem('vox-chats');
    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats);
        const filtered = parsed.filter((chat: Chat) => chat.id !== chatId);
        localStorage.setItem('vox-chats', JSON.stringify(filtered));
      } catch (e) {
        console.error('Error updating chats in localStorage:', e);
      }
    }
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
