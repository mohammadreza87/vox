import { getAdminDb } from './firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  UserDocument,
  UserSubscription,
  UsageData,
  DEFAULT_SUBSCRIPTION,
  DEFAULT_USAGE
} from '@/shared/types/subscription';
import { SubscriptionTier } from '@/config/subscription';

// Convert Firestore Timestamp to Date
function timestampToDate(timestamp: Timestamp | null): Date | null {
  if (!timestamp) return null;
  return timestamp.toDate();
}

// Convert Date to Firestore Timestamp
function dateToTimestamp(date: Date | null | undefined): Timestamp | null {
  if (!date) return null;
  // Ensure date is a valid Date object
  if (!(date instanceof Date)) {
    // Try to create a Date from the value
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      console.error('Invalid date value:', date);
      return null;
    }
    return Timestamp.fromDate(parsed);
  }
  if (isNaN(date.getTime())) {
    console.error('Invalid Date object:', date);
    return null;
  }
  return Timestamp.fromDate(date);
}

// Get user document from Firestore
export async function getUserDocument(userId: string): Promise<UserDocument | null> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('users').doc(userId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return null;
    }

    const data = docSnap.data()!;

    return {
      email: data.email,
      displayName: data.displayName,
      createdAt: timestampToDate(data.createdAt) || new Date(),
      subscription: {
        tier: data.subscription?.tier || 'free',
        status: data.subscription?.status || null,
        stripeCustomerId: data.subscription?.stripeCustomerId || null,
        stripeSubscriptionId: data.subscription?.stripeSubscriptionId || null,
        stripePriceId: data.subscription?.stripePriceId || null,
        currentPeriodStart: timestampToDate(data.subscription?.currentPeriodStart),
        currentPeriodEnd: timestampToDate(data.subscription?.currentPeriodEnd),
        cancelAtPeriodEnd: data.subscription?.cancelAtPeriodEnd || false,
      },
      usage: {
        messagesUsedToday: data.usage?.messagesUsedToday || 0,
        messagesDailyReset: timestampToDate(data.usage?.messagesDailyReset) || new Date(),
        customContactsCount: data.usage?.customContactsCount || 0,
        clonedVoicesCount: data.usage?.clonedVoicesCount || 0,
      },
    };
  } catch (error) {
    console.error('Error getting user document:', error);
    return null;
  }
}

// Create new user document in Firestore
export async function createUserDocument(
  userId: string,
  email: string,
  displayName: string
): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('users').doc(userId);

    // Check if document already exists
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      return; // Don't overwrite existing user
    }

    const now = new Date();

    await docRef.set({
      email,
      displayName,
      createdAt: dateToTimestamp(now),
      subscription: {
        ...DEFAULT_SUBSCRIPTION,
        currentPeriodStart: null,
        currentPeriodEnd: null,
      },
      usage: {
        ...DEFAULT_USAGE,
        messagesDailyReset: dateToTimestamp(now),
      },
    });
  } catch (error) {
    console.error('Error creating user document:', error);
    throw error;
  }
}

// Update user subscription
export async function updateUserSubscription(
  userId: string,
  subscription: Partial<UserSubscription>
): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('users').doc(userId);

    const updateData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(subscription)) {
      if (value instanceof Date) {
        updateData[`subscription.${key}`] = dateToTimestamp(value);
      } else {
        updateData[`subscription.${key}`] = value;
      }
    }

    await docRef.update(updateData);
  } catch (error) {
    console.error('Error updating user subscription:', error);
    throw error;
  }
}

// Increment message count
export async function incrementMessageCount(userId: string): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('users').doc(userId);

    // First check if we need to reset daily count
    const userDoc = await getUserDocument(userId);
    if (userDoc) {
      const lastReset = userDoc.usage.messagesDailyReset;
      const now = new Date();

      // Check if we're on a new day (UTC)
      if (isNewDay(lastReset, now)) {
        await docRef.update({
          'usage.messagesUsedToday': 1,
          'usage.messagesDailyReset': dateToTimestamp(now),
        });
        return;
      }
    }

    // Increment count
    await docRef.update({
      'usage.messagesUsedToday': FieldValue.increment(1),
    });
  } catch (error) {
    console.error('Error incrementing message count:', error);
    throw error;
  }
}

// Reset daily usage if new day
export async function resetDailyUsageIfNeeded(userId: string): Promise<boolean> {
  try {
    const userDoc = await getUserDocument(userId);
    if (!userDoc) return false;

    const lastReset = userDoc.usage.messagesDailyReset;
    const now = new Date();

    if (isNewDay(lastReset, now)) {
      const db = getAdminDb();
      const docRef = db.collection('users').doc(userId);
      await docRef.update({
        'usage.messagesUsedToday': 0,
        'usage.messagesDailyReset': dateToTimestamp(now),
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error resetting daily usage:', error);
    return false;
  }
}

// Update custom contacts count
export async function updateCustomContactsCount(
  userId: string,
  count: number
): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('users').doc(userId);
    await docRef.update({
      'usage.customContactsCount': count,
    });
  } catch (error) {
    console.error('Error updating custom contacts count:', error);
    throw error;
  }
}

// Update cloned voices count
export async function updateClonedVoicesCount(
  userId: string,
  count: number
): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('users').doc(userId);
    await docRef.update({
      'usage.clonedVoicesCount': count,
    });
  } catch (error) {
    console.error('Error updating cloned voices count:', error);
    throw error;
  }
}

// Set Stripe customer ID
export async function setStripeCustomerId(
  userId: string,
  customerId: string
): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('users').doc(userId);
    await docRef.update({
      'subscription.stripeCustomerId': customerId,
    });
  } catch (error) {
    console.error('Error setting Stripe customer ID:', error);
    throw error;
  }
}

// Get user tier for validation
export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const userDoc = await getUserDocument(userId);
  return userDoc?.subscription.tier || 'free';
}

// Get messages used today with auto-reset
export async function getMessagesUsedToday(userId: string): Promise<number> {
  const userDoc = await getUserDocument(userId);
  if (!userDoc) return 0;

  const lastReset = userDoc.usage.messagesDailyReset;
  const now = new Date();

  // If new day, return 0 (will be reset on next increment)
  if (isNewDay(lastReset, now)) {
    return 0;
  }

  return userDoc.usage.messagesUsedToday;
}

// Helper: Check if it's a new day (UTC)
function isNewDay(lastReset: Date, now: Date): boolean {
  const lastResetDate = new Date(lastReset);
  lastResetDate.setUTCHours(0, 0, 0, 0);

  const nowDate = new Date(now);
  nowDate.setUTCHours(0, 0, 0, 0);

  return nowDate.getTime() > lastResetDate.getTime();
}

// ============================================
// TRANSLATOR HISTORY FUNCTIONS
// ============================================

export interface TranslatorMessage {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  speaker: 'me' | 'other';
  timestamp: Date;
}

// Save a translator message
export async function saveTranslatorMessage(
  userId: string,
  message: Omit<TranslatorMessage, 'id'>
): Promise<string> {
  try {
    const db = getAdminDb();
    const messagesRef = db.collection('users').doc(userId).collection('translatorMessages');

    const docRef = await messagesRef.add({
      ...message,
      timestamp: dateToTimestamp(message.timestamp),
    });

    return docRef.id;
  } catch (error) {
    console.error('Error saving translator message:', error);
    throw error;
  }
}

// Get translator messages for a user (paginated)
export async function getTranslatorMessages(
  userId: string,
  limit: number = 100,
  beforeTimestamp?: Date
): Promise<TranslatorMessage[]> {
  try {
    const db = getAdminDb();
    const messagesRef = db.collection('users').doc(userId).collection('translatorMessages');

    let query = messagesRef.orderBy('timestamp', 'desc').limit(limit);

    if (beforeTimestamp) {
      query = query.where('timestamp', '<', dateToTimestamp(beforeTimestamp));
    }

    const snapshot = await query.get();

    const messages: TranslatorMessage[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      messages.push({
        id: doc.id,
        sourceText: data.sourceText,
        translatedText: data.translatedText,
        sourceLanguage: data.sourceLanguage,
        targetLanguage: data.targetLanguage,
        speaker: data.speaker,
        timestamp: timestampToDate(data.timestamp) || new Date(),
      });
    });

    // Return in chronological order (oldest first)
    return messages.reverse();
  } catch (error) {
    console.error('Error getting translator messages:', error);
    throw error;
  }
}

// Clear all translator messages for a user
export async function clearTranslatorMessages(userId: string): Promise<void> {
  try {
    const db = getAdminDb();
    const messagesRef = db.collection('users').doc(userId).collection('translatorMessages');

    const snapshot = await messagesRef.get();
    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
  } catch (error) {
    console.error('Error clearing translator messages:', error);
    throw error;
  }
}
