/**
 * Firestore V2 - Scalable Database Layer
 *
 * Uses subcollections for chats and messages:
 * - users/{userId}/chats/{chatId} - Chat metadata
 * - users/{userId}/chats/{chatId}/messages/{messageId} - Individual messages
 * - users/{userId}/customContacts/{contactId} - Custom contacts
 */

import { getAdminDb } from './firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  ChatDocument,
  MessageDocument,
  ChatWithMessages,
  PaginatedMessages,
  CustomContactDocument,
  UserPreferences,
} from '@/shared/types/database';

// ============================================
// HELPERS
// ============================================

function toDate(timestamp: Timestamp | Date | string | null): Date {
  if (!timestamp) return new Date();
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp === 'string') return new Date(timestamp);
  return timestamp.toDate();
}

function toTimestamp(date: Date | string | null): Timestamp | null {
  if (!date) return null;
  if (typeof date === 'string') date = new Date(date);
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

// ============================================
// USER PREFERENCES
// ============================================

export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    const db = await getAdminDb();
    const doc = await db.collection('users').doc(userId).collection('profile').doc('preferences').get();

    if (!doc.exists) return null;
    return doc.data() as UserPreferences;
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return null;
  }
}

export async function setUserPreferences(
  userId: string,
  preferences: Partial<UserPreferences>
): Promise<void> {
  try {
    const db = await getAdminDb();
    await db
      .collection('users')
      .doc(userId)
      .collection('profile')
      .doc('preferences')
      .set(preferences, { merge: true });
  } catch (error) {
    console.error('Error setting user preferences:', error);
    throw error;
  }
}

// ============================================
// CHATS
// ============================================

/**
 * Get all chats for a user (metadata only, no messages)
 */
export async function getChats(userId: string): Promise<ChatDocument[]> {
  try {
    const db = await getAdminDb();
    const chatsRef = db.collection('users').doc(userId).collection('chats');
    const snapshot = await chatsRef.orderBy('lastMessageAt', 'desc').get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        contactId: data.contactId,
        contactName: data.contactName,
        contactEmoji: data.contactEmoji,
        contactImage: data.contactImage,
        contactPurpose: data.contactPurpose,
        lastMessage: data.lastMessage,
        lastMessageAt: toDate(data.lastMessageAt),
        messageCount: data.messageCount || 0,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      };
    });
  } catch (error) {
    console.error('Error getting chats:', error);
    throw error;
  }
}

/**
 * Get chats updated since a specific time (for sync)
 */
export async function getChatsUpdatedSince(
  userId: string,
  since: Date
): Promise<ChatDocument[]> {
  try {
    const db = await getAdminDb();
    const chatsRef = db.collection('users').doc(userId).collection('chats');
    const snapshot = await chatsRef
      .where('updatedAt', '>', toTimestamp(since))
      .orderBy('updatedAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        contactId: data.contactId,
        contactName: data.contactName,
        contactEmoji: data.contactEmoji,
        contactImage: data.contactImage,
        contactPurpose: data.contactPurpose,
        lastMessage: data.lastMessage,
        lastMessageAt: toDate(data.lastMessageAt),
        messageCount: data.messageCount || 0,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      };
    });
  } catch (error) {
    console.error('Error getting updated chats:', error);
    throw error;
  }
}

/**
 * Get a single chat by ID
 */
export async function getChat(userId: string, chatId: string): Promise<ChatDocument | null> {
  try {
    const db = await getAdminDb();
    const doc = await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .get();

    if (!doc.exists) return null;

    const data = doc.data()!;
    return {
      id: doc.id,
      contactId: data.contactId,
      contactName: data.contactName,
      contactEmoji: data.contactEmoji,
      contactImage: data.contactImage,
      contactPurpose: data.contactPurpose,
      lastMessage: data.lastMessage,
      lastMessageAt: toDate(data.lastMessageAt),
      messageCount: data.messageCount || 0,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    };
  } catch (error) {
    console.error('Error getting chat:', error);
    throw error;
  }
}

/**
 * Get chat by contact ID
 */
export async function getChatByContactId(
  userId: string,
  contactId: string
): Promise<ChatDocument | null> {
  try {
    const db = await getAdminDb();
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .where('contactId', '==', contactId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      contactId: data.contactId,
      contactName: data.contactName,
      contactEmoji: data.contactEmoji,
      contactImage: data.contactImage,
      contactPurpose: data.contactPurpose,
      lastMessage: data.lastMessage,
      lastMessageAt: toDate(data.lastMessageAt),
      messageCount: data.messageCount || 0,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    };
  } catch (error) {
    console.error('Error getting chat by contact:', error);
    throw error;
  }
}

/**
 * Create a new chat
 */
export async function createChat(
  userId: string,
  chat: Omit<ChatDocument, 'id' | 'messageCount' | 'createdAt' | 'updatedAt'>
): Promise<ChatDocument> {
  try {
    const db = await getAdminDb();
    const now = new Date();

    const chatData = {
      contactId: chat.contactId,
      contactName: chat.contactName,
      contactEmoji: chat.contactEmoji,
      contactImage: chat.contactImage || null,
      contactPurpose: chat.contactPurpose,
      lastMessage: chat.lastMessage,
      lastMessageAt: toTimestamp(chat.lastMessageAt),
      messageCount: 0,
      createdAt: toTimestamp(now),
      updatedAt: toTimestamp(now),
    };

    const docRef = await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .add(chatData);

    return {
      id: docRef.id,
      ...chat,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    console.error('Error creating chat:', error);
    throw error;
  }
}

/**
 * Update chat metadata
 */
export async function updateChat(
  userId: string,
  chatId: string,
  updates: Partial<Omit<ChatDocument, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const db = await getAdminDb();
    const updateData: Record<string, unknown> = {
      updatedAt: toTimestamp(new Date()),
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value instanceof Date) {
        updateData[key] = toTimestamp(value);
      } else if (value !== undefined) {
        updateData[key] = value;
      }
    }

    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .update(updateData);
  } catch (error) {
    console.error('Error updating chat:', error);
    throw error;
  }
}

/**
 * Delete a chat and all its messages
 */
export async function deleteChat(userId: string, chatId: string): Promise<void> {
  try {
    const db = await getAdminDb();
    const chatRef = db.collection('users').doc(userId).collection('chats').doc(chatId);

    // Delete all messages first (Firestore doesn't auto-delete subcollections)
    const messagesSnapshot = await chatRef.collection('messages').get();
    const batch = db.batch();

    messagesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Delete the chat document
    batch.delete(chatRef);

    await batch.commit();
  } catch (error) {
    console.error('Error deleting chat:', error);
    throw error;
  }
}

// ============================================
// MESSAGES
// ============================================

/**
 * Get messages for a chat (paginated, newest first)
 */
export async function getMessages(
  userId: string,
  chatId: string,
  limit: number = 50,
  cursor?: string
): Promise<PaginatedMessages> {
  try {
    const db = await getAdminDb();
    const messagesRef = db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages');

    let query = messagesRef.orderBy('createdAt', 'desc').limit(limit + 1);

    if (cursor) {
      const cursorDoc = await messagesRef.doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > limit;
    const docs = hasMore ? snapshot.docs.slice(0, -1) : snapshot.docs;

    const messages: MessageDocument[] = docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        role: data.role,
        content: data.content,
        audioUrl: data.audioUrl || null,
        createdAt: toDate(data.createdAt),
      };
    });

    // Return in chronological order (oldest first)
    messages.reverse();

    return {
      messages,
      hasMore,
      nextCursor: hasMore ? docs[docs.length - 1].id : undefined,
    };
  } catch (error) {
    console.error('Error getting messages:', error);
    throw error;
  }
}

/**
 * Get all messages for a chat (no pagination - use for small chats or export)
 */
export async function getAllMessages(
  userId: string,
  chatId: string
): Promise<MessageDocument[]> {
  try {
    const db = await getAdminDb();
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        role: data.role,
        content: data.content,
        audioUrl: data.audioUrl || null,
        createdAt: toDate(data.createdAt),
      };
    });
  } catch (error) {
    console.error('Error getting all messages:', error);
    throw error;
  }
}

/**
 * Add a message to a chat
 */
export async function addMessage(
  userId: string,
  chatId: string,
  message: Omit<MessageDocument, 'id' | 'createdAt'>
): Promise<MessageDocument> {
  try {
    const db = await getAdminDb();
    const now = new Date();

    const messageData = {
      role: message.role,
      content: message.content,
      audioUrl: message.audioUrl || null,
      createdAt: toTimestamp(now),
    };

    // Add message
    const messageRef = await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .add(messageData);

    // Update chat metadata
    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .update({
        lastMessage: message.content.slice(0, 100),
        lastMessageAt: toTimestamp(now),
        messageCount: FieldValue.increment(1),
        updatedAt: toTimestamp(now),
      });

    return {
      id: messageRef.id,
      ...message,
      createdAt: now,
    };
  } catch (error) {
    console.error('Error adding message:', error);
    throw error;
  }
}

/**
 * Update a message
 */
export async function updateMessage(
  userId: string,
  chatId: string,
  messageId: string,
  updates: Partial<Omit<MessageDocument, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const db = await getAdminDb();
    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .doc(messageId)
      .update(updates);
  } catch (error) {
    console.error('Error updating message:', error);
    throw error;
  }
}

/**
 * Delete a message
 */
export async function deleteMessage(
  userId: string,
  chatId: string,
  messageId: string
): Promise<void> {
  try {
    const db = await getAdminDb();

    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .doc(messageId)
      .delete();

    // Update message count
    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .update({
        messageCount: FieldValue.increment(-1),
        updatedAt: toTimestamp(new Date()),
      });
  } catch (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
}

// ============================================
// CUSTOM CONTACTS
// ============================================

/**
 * Get all custom contacts for a user
 */
export async function getCustomContacts(userId: string): Promise<CustomContactDocument[]> {
  try {
    const db = await getAdminDb();
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('customContacts')
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        purpose: data.purpose,
        personality: data.personality,
        systemPrompt: data.systemPrompt,
        voiceId: data.voiceId,
        voiceName: data.voiceName,
        avatarEmoji: data.avatarEmoji,
        avatarImage: data.avatarImage,
        category: data.category,
        gradient: data.gradient,
        aiProvider: data.aiProvider,
        aiModel: data.aiModel,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      };
    });
  } catch (error) {
    console.error('Error getting custom contacts:', error);
    throw error;
  }
}

/**
 * Create a custom contact
 */
export async function createCustomContact(
  userId: string,
  contact: Omit<CustomContactDocument, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CustomContactDocument> {
  try {
    const db = await getAdminDb();
    const now = new Date();

    const contactData = {
      ...contact,
      createdAt: toTimestamp(now),
      updatedAt: toTimestamp(now),
    };

    const docRef = await db
      .collection('users')
      .doc(userId)
      .collection('customContacts')
      .add(contactData);

    return {
      id: docRef.id,
      ...contact,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    console.error('Error creating custom contact:', error);
    throw error;
  }
}

/**
 * Update a custom contact
 */
export async function updateCustomContact(
  userId: string,
  contactId: string,
  updates: Partial<Omit<CustomContactDocument, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const db = await getAdminDb();
    await db
      .collection('users')
      .doc(userId)
      .collection('customContacts')
      .doc(contactId)
      .update({
        ...updates,
        updatedAt: toTimestamp(new Date()),
      });
  } catch (error) {
    console.error('Error updating custom contact:', error);
    throw error;
  }
}

/**
 * Delete a custom contact
 */
export async function deleteCustomContact(userId: string, contactId: string): Promise<void> {
  try {
    const db = await getAdminDb();
    await db
      .collection('users')
      .doc(userId)
      .collection('customContacts')
      .doc(contactId)
      .delete();
  } catch (error) {
    console.error('Error deleting custom contact:', error);
    throw error;
  }
}

// ============================================
// FULL CHAT WITH MESSAGES (for initial load)
// ============================================

/**
 * Get a chat with all its messages
 */
export async function getChatWithMessages(
  userId: string,
  chatId: string
): Promise<ChatWithMessages | null> {
  try {
    const chat = await getChat(userId, chatId);
    if (!chat) return null;

    const messages = await getAllMessages(userId, chatId);

    return {
      ...chat,
      messages,
    };
  } catch (error) {
    console.error('Error getting chat with messages:', error);
    throw error;
  }
}

/**
 * Get all chats with their messages (for migration or export)
 * WARNING: This can be slow and memory-intensive for users with lots of data
 */
export async function getAllChatsWithMessages(userId: string): Promise<ChatWithMessages[]> {
  try {
    const chats = await getChats(userId);
    const chatsWithMessages: ChatWithMessages[] = [];

    for (const chat of chats) {
      const messages = await getAllMessages(userId, chat.id);
      chatsWithMessages.push({
        ...chat,
        messages,
      });
    }

    return chatsWithMessages;
  } catch (error) {
    console.error('Error getting all chats with messages:', error);
    throw error;
  }
}

// ============================================
// SOFT DELETE
// ============================================

/**
 * Soft delete fields added to documents
 */
export interface SoftDeleteFields {
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

/**
 * Soft delete a chat (mark as deleted without physical deletion)
 * Messages are not individually marked - they're implicitly deleted with the chat
 */
export async function softDeleteChat(userId: string, chatId: string): Promise<void> {
  try {
    const db = await getAdminDb();
    const now = new Date();

    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .update({
        deletedAt: toTimestamp(now),
        deletedBy: userId,
        updatedAt: toTimestamp(now),
      });
  } catch (error) {
    console.error('Error soft deleting chat:', error);
    throw error;
  }
}

/**
 * Soft delete a message
 */
export async function softDeleteMessage(
  userId: string,
  chatId: string,
  messageId: string
): Promise<void> {
  try {
    const db = await getAdminDb();
    const now = new Date();

    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .doc(messageId)
      .update({
        deletedAt: toTimestamp(now),
        deletedBy: userId,
      });

    // Update message count (decrement for soft deleted messages)
    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .update({
        messageCount: FieldValue.increment(-1),
        updatedAt: toTimestamp(now),
      });
  } catch (error) {
    console.error('Error soft deleting message:', error);
    throw error;
  }
}

/**
 * Restore a soft-deleted chat
 */
export async function restoreChat(userId: string, chatId: string): Promise<void> {
  try {
    const db = await getAdminDb();
    const now = new Date();

    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .update({
        deletedAt: null,
        deletedBy: null,
        updatedAt: toTimestamp(now),
      });
  } catch (error) {
    console.error('Error restoring chat:', error);
    throw error;
  }
}

/**
 * Restore a soft-deleted message
 */
export async function restoreMessage(
  userId: string,
  chatId: string,
  messageId: string
): Promise<void> {
  try {
    const db = await getAdminDb();
    const now = new Date();

    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .doc(messageId)
      .update({
        deletedAt: null,
        deletedBy: null,
      });

    // Restore message count
    await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .update({
        messageCount: FieldValue.increment(1),
        updatedAt: toTimestamp(now),
      });
  } catch (error) {
    console.error('Error restoring message:', error);
    throw error;
  }
}

/**
 * Get soft-deleted chats for a user (for restore/review)
 */
export async function getDeletedChats(userId: string): Promise<ChatDocument[]> {
  try {
    const db = await getAdminDb();
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .where('deletedAt', '!=', null)
      .orderBy('deletedAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        contactId: data.contactId,
        contactName: data.contactName,
        contactEmoji: data.contactEmoji,
        contactImage: data.contactImage,
        contactPurpose: data.contactPurpose,
        lastMessage: data.lastMessage,
        lastMessageAt: toDate(data.lastMessageAt),
        messageCount: data.messageCount || 0,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
        deletedAt: toDate(data.deletedAt),
        deletedBy: data.deletedBy,
      };
    });
  } catch (error) {
    console.error('Error getting deleted chats:', error);
    throw error;
  }
}

/**
 * Permanently delete soft-deleted items older than specified days
 * This should be run periodically (e.g., daily cron job)
 *
 * @param userId - User ID to clean up, or null for all users
 * @param retentionDays - Days to keep soft-deleted items (default: 30)
 */
export async function permanentlyDeleteOldItems(
  userId: string | null,
  retentionDays: number = 30
): Promise<{ chatsDeleted: number; messagesDeleted: number }> {
  const db = await getAdminDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffTimestamp = toTimestamp(cutoffDate);

  let chatsDeleted = 0;
  let messagesDeleted = 0;

  try {
    if (userId) {
      // Clean up for a specific user
      const result = await cleanupUserDeletedItems(db, userId, cutoffTimestamp);
      chatsDeleted += result.chatsDeleted;
      messagesDeleted += result.messagesDeleted;
    } else {
      // Clean up for all users (admin operation)
      const usersSnapshot = await db.collection('users').get();

      for (const userDoc of usersSnapshot.docs) {
        const result = await cleanupUserDeletedItems(db, userDoc.id, cutoffTimestamp);
        chatsDeleted += result.chatsDeleted;
        messagesDeleted += result.messagesDeleted;
      }
    }

    console.log(`Permanent deletion complete: ${chatsDeleted} chats, ${messagesDeleted} messages`);
    return { chatsDeleted, messagesDeleted };
  } catch (error) {
    console.error('Error in permanent deletion:', error);
    throw error;
  }
}

/**
 * Helper function to clean up deleted items for a specific user
 */
async function cleanupUserDeletedItems(
  db: FirebaseFirestore.Firestore,
  userId: string,
  cutoffTimestamp: Timestamp | null
): Promise<{ chatsDeleted: number; messagesDeleted: number }> {
  let chatsDeleted = 0;
  let messagesDeleted = 0;

  if (!cutoffTimestamp) {
    return { chatsDeleted, messagesDeleted };
  }

  // Find and delete old soft-deleted chats
  const deletedChatsSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('chats')
    .where('deletedAt', '<', cutoffTimestamp)
    .get();

  for (const chatDoc of deletedChatsSnapshot.docs) {
    // Delete all messages in this chat
    const messagesSnapshot = await chatDoc.ref.collection('messages').get();
    const batch = db.batch();

    messagesSnapshot.docs.forEach((msgDoc) => {
      batch.delete(msgDoc.ref);
      messagesDeleted++;
    });

    batch.delete(chatDoc.ref);
    chatsDeleted++;

    await batch.commit();
  }

  // Find and delete old soft-deleted messages in non-deleted chats
  const activeChatsSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('chats')
    .where('deletedAt', '==', null)
    .get();

  for (const chatDoc of activeChatsSnapshot.docs) {
    const deletedMessagesSnapshot = await chatDoc.ref
      .collection('messages')
      .where('deletedAt', '<', cutoffTimestamp)
      .get();

    if (!deletedMessagesSnapshot.empty) {
      const batch = db.batch();
      deletedMessagesSnapshot.docs.forEach((msgDoc) => {
        batch.delete(msgDoc.ref);
        messagesDeleted++;
      });
      await batch.commit();
    }
  }

  return { chatsDeleted, messagesDeleted };
}

// ============================================
// ACTIVE (NON-DELETED) QUERIES
// ============================================

/**
 * Get all active (non-deleted) chats for a user
 * This is the preferred method for normal operation
 */
export async function getActiveChats(userId: string): Promise<ChatDocument[]> {
  try {
    const db = await getAdminDb();
    const chatsRef = db.collection('users').doc(userId).collection('chats');

    // Query for chats where deletedAt is null or doesn't exist
    const snapshot = await chatsRef
      .where('deletedAt', '==', null)
      .orderBy('lastMessageAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        contactId: data.contactId,
        contactName: data.contactName,
        contactEmoji: data.contactEmoji,
        contactImage: data.contactImage,
        contactPurpose: data.contactPurpose,
        lastMessage: data.lastMessage,
        lastMessageAt: toDate(data.lastMessageAt),
        messageCount: data.messageCount || 0,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      };
    });
  } catch (error) {
    console.error('Error getting active chats:', error);
    throw error;
  }
}

/**
 * Get active (non-deleted) messages for a chat
 */
export async function getActiveMessages(
  userId: string,
  chatId: string,
  limit: number = 50,
  cursor?: string
): Promise<PaginatedMessages> {
  try {
    const db = await getAdminDb();
    const messagesRef = db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(chatId)
      .collection('messages');

    let query = messagesRef
      .where('deletedAt', '==', null)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1);

    if (cursor) {
      const cursorDoc = await messagesRef.doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > limit;
    const docs = hasMore ? snapshot.docs.slice(0, -1) : snapshot.docs;

    const messages: MessageDocument[] = docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        role: data.role,
        content: data.content,
        audioUrl: data.audioUrl || null,
        createdAt: toDate(data.createdAt),
      };
    });

    // Return in chronological order (oldest first)
    messages.reverse();

    return {
      messages,
      hasMore,
      nextCursor: hasMore ? docs[docs.length - 1].id : undefined,
    };
  } catch (error) {
    console.error('Error getting active messages:', error);
    throw error;
  }
}
