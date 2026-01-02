/**
 * Firestore Chat Repository
 * Implements IChatRepository using Firebase Firestore
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Chat, Message } from '@/shared/types';
import {
  IChatRepository,
  CreateChatInput,
  CreateMessageInput,
  PaginationOptions,
} from '../interfaces/IChatRepository';

export class FirestoreChatRepository implements IChatRepository {
  private readonly chatsCollection = 'chats';
  private readonly messagesSubcollection = 'messages';

  async getChats(userId: string): Promise<Chat[]> {
    const chatsRef = collection(db, this.chatsCollection);
    const q = query(
      chatsRef,
      where('userId', '==', userId),
      orderBy('lastMessageAt', 'desc')
    );

    const snapshot = await getDocs(q);
    const chats: Chat[] = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const messages = await this.getMessages(docSnap.id);

      chats.push(this.mapToChat(docSnap.id, data, messages));
    }

    return chats;
  }

  async getChat(chatId: string): Promise<Chat | null> {
    const chatRef = doc(db, this.chatsCollection, chatId);
    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
      return null;
    }

    const messages = await this.getMessages(chatId);
    return this.mapToChat(chatId, chatSnap.data(), messages);
  }

  async getChatByContactId(userId: string, contactId: string): Promise<Chat | null> {
    const chatsRef = collection(db, this.chatsCollection);
    const q = query(
      chatsRef,
      where('userId', '==', userId),
      where('contactId', '==', contactId),
      limit(1)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    const docSnap = snapshot.docs[0];
    const messages = await this.getMessages(docSnap.id);
    return this.mapToChat(docSnap.id, docSnap.data(), messages);
  }

  async createChat(userId: string, input: CreateChatInput): Promise<Chat> {
    const chatId = `${userId}-${input.contactId}-${Date.now()}`;
    const chatRef = doc(db, this.chatsCollection, chatId);

    const chatData = {
      userId,
      contactId: input.contactId,
      contactName: input.contactName,
      contactEmoji: input.contactEmoji || null,
      contactImage: input.contactImage || null,
      contactPurpose: input.contactPurpose || null,
      lastMessage: null,
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(chatRef, chatData);

    return {
      id: chatId,
      contactId: input.contactId,
      contactName: input.contactName,
      contactEmoji: input.contactEmoji || '',
      contactImage: input.contactImage,
      contactPurpose: input.contactPurpose || '',
      lastMessage: '',
      lastMessageAt: new Date(),
      messages: [],
    };
  }

  async updateChat(chatId: string, updates: Partial<Chat>): Promise<void> {
    const chatRef = doc(db, this.chatsCollection, chatId);

    const updateData: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };

    if (updates.lastMessage !== undefined) {
      updateData.lastMessage = updates.lastMessage;
    }
    if (updates.lastMessageAt !== undefined) {
      updateData.lastMessageAt = Timestamp.fromDate(updates.lastMessageAt);
    }

    await updateDoc(chatRef, updateData);
  }

  async deleteChat(chatId: string): Promise<void> {
    // Delete all messages first
    const messagesRef = collection(db, this.chatsCollection, chatId, this.messagesSubcollection);
    const messagesSnap = await getDocs(messagesRef);

    const deletePromises = messagesSnap.docs.map((docSnap) =>
      deleteDoc(doc(db, this.chatsCollection, chatId, this.messagesSubcollection, docSnap.id))
    );
    await Promise.all(deletePromises);

    // Delete the chat
    await deleteDoc(doc(db, this.chatsCollection, chatId));
  }

  async getMessages(chatId: string, options?: PaginationOptions): Promise<Message[]> {
    const messagesRef = collection(db, this.chatsCollection, chatId, this.messagesSubcollection);
    let q = query(messagesRef, orderBy('createdAt', 'asc'));

    if (options?.limit) {
      q = query(q, limit(options.limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => this.mapToMessage(docSnap.id, docSnap.data()));
  }

  async addMessage(chatId: string, input: CreateMessageInput): Promise<Message> {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const messageRef = doc(db, this.chatsCollection, chatId, this.messagesSubcollection, messageId);

    const messageData = {
      role: input.role,
      content: input.content,
      audioUrl: input.audioUrl || null,
      createdAt: serverTimestamp(),
    };

    await setDoc(messageRef, messageData);

    // Update chat's last message
    await this.updateChat(chatId, {
      lastMessage: input.content.substring(0, 100),
      lastMessageAt: new Date(),
    });

    return {
      id: messageId,
      contactId: '', // Will be filled by the caller
      role: input.role,
      content: input.content,
      audioUrl: input.audioUrl || null,
      createdAt: new Date(),
    };
  }

  async updateMessage(chatId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    const messageRef = doc(db, this.chatsCollection, chatId, this.messagesSubcollection, messageId);

    const updateData: Record<string, unknown> = {};

    if (updates.content !== undefined) {
      updateData.content = updates.content;
    }
    if (updates.audioUrl !== undefined) {
      updateData.audioUrl = updates.audioUrl;
    }

    await updateDoc(messageRef, updateData);
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    const messageRef = doc(db, this.chatsCollection, chatId, this.messagesSubcollection, messageId);
    await deleteDoc(messageRef);
  }

  async syncChats(userId: string, localChats: Chat[]): Promise<Chat[]> {
    // Get server chats
    const serverChats = await this.getChats(userId);

    // Create a map of server chats by ID
    const serverChatMap = new Map(serverChats.map((chat) => [chat.id, chat]));

    // Merge local chats with server chats
    for (const localChat of localChats) {
      const serverChat = serverChatMap.get(localChat.id);

      if (!serverChat) {
        // Chat exists locally but not on server - upload it
        await this.createChatFromLocal(userId, localChat);
        serverChatMap.set(localChat.id, localChat);
      } else if (
        localChat.lastMessageAt &&
        serverChat.lastMessageAt &&
        localChat.lastMessageAt > serverChat.lastMessageAt
      ) {
        // Local chat is newer - sync messages
        await this.syncMessages(localChat.id, localChat.messages);
        serverChatMap.set(localChat.id, localChat);
      }
    }

    return Array.from(serverChatMap.values());
  }

  private async createChatFromLocal(userId: string, chat: Chat): Promise<void> {
    const chatRef = doc(db, this.chatsCollection, chat.id);

    await setDoc(chatRef, {
      userId,
      contactId: chat.contactId,
      contactName: chat.contactName,
      contactEmoji: chat.contactEmoji || null,
      contactImage: chat.contactImage || null,
      contactPurpose: chat.contactPurpose || null,
      lastMessage: chat.lastMessage,
      lastMessageAt: chat.lastMessageAt ? Timestamp.fromDate(chat.lastMessageAt) : serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Sync messages
    await this.syncMessages(chat.id, chat.messages);
  }

  private async syncMessages(chatId: string, messages: Message[]): Promise<void> {
    for (const message of messages) {
      const messageRef = doc(
        db,
        this.chatsCollection,
        chatId,
        this.messagesSubcollection,
        message.id
      );

      await setDoc(messageRef, {
        role: message.role,
        content: message.content,
        audioUrl: message.audioUrl || null,
        createdAt: message.createdAt ? Timestamp.fromDate(message.createdAt) : serverTimestamp(),
      });
    }
  }

  private mapToChat(id: string, data: Record<string, unknown>, messages: Message[]): Chat {
    return {
      id,
      contactId: data.contactId as string,
      contactName: data.contactName as string,
      contactEmoji: (data.contactEmoji as string) || '',
      contactImage: data.contactImage as string | undefined,
      contactPurpose: (data.contactPurpose as string) || '',
      lastMessage: (data.lastMessage as string) || '',
      lastMessageAt: this.toDate(data.lastMessageAt),
      messages,
    };
  }

  private mapToMessage(id: string, data: Record<string, unknown>): Message {
    return {
      id,
      contactId: '', // Filled by chat context
      role: data.role as 'user' | 'assistant',
      content: data.content as string,
      audioUrl: (data.audioUrl as string) || null,
      createdAt: this.toDate(data.createdAt),
    };
  }

  private toDate(value: unknown): Date {
    if (value instanceof Timestamp) {
      return value.toDate();
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      return new Date(value);
    }
    return new Date();
  }
}
