/**
 * Migration API
 * POST - Migrate user data from old schema to new subcollection schema
 *
 * Old schema: users/{userId}/data/app.chats = [{...chat with messages...}]
 * New schema: users/{userId}/chats/{chatId} + messages subcollection
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken, getAdminDb } from '@/lib/firebase-admin';
import { createChat, addMessage, getChatByContactId } from '@/lib/firestore-v2';
import { Timestamp } from 'firebase-admin/firestore';
import {
  getSyncRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

interface LegacyMessage {
  id: string;
  contactId: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl: string | null;
  createdAt: Date | string | Timestamp;
}

interface LegacyChat {
  id: string;
  contactId: string;
  contactName: string;
  contactEmoji: string;
  contactImage?: string;
  contactPurpose: string;
  lastMessage: string;
  lastMessageAt: Date | string | Timestamp;
  messages: LegacyMessage[];
}

interface LegacyData {
  chats?: LegacyChat[];
  customContacts?: unknown[];
  preferences?: unknown;
}

function toDate(value: Date | string | Timestamp | null | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if ('toDate' in value && typeof value.toDate === 'function') return value.toDate();
  return new Date();
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const rateResult = await checkRateLimitSecure(
      getSyncRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      1,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const db = await getAdminDb();

    // Check migration status
    const migrationRef = db.collection('users').doc(userId).collection('metadata').doc('migration');
    const migrationDoc = await migrationRef.get();

    if (migrationDoc.exists && migrationDoc.data()?.status === 'completed') {
      return NextResponse.json({
        success: true,
        message: 'Migration already completed',
        alreadyMigrated: true,
      });
    }

    // Mark migration as in progress
    await migrationRef.set({
      status: 'in_progress',
      startedAt: new Date(),
    });

    // Load legacy data
    const legacyDataRef = db.collection('users').doc(userId).collection('data').doc('app');
    const legacyDataSnap = await legacyDataRef.get();

    if (!legacyDataSnap.exists) {
      await migrationRef.set({
        status: 'completed',
        completedAt: new Date(),
        migratedChats: 0,
        migratedMessages: 0,
        note: 'No legacy data found',
      });

      return NextResponse.json({
        success: true,
        message: 'No data to migrate',
        migratedChats: 0,
        migratedMessages: 0,
      });
    }

    const legacyData = legacyDataSnap.data() as LegacyData;
    const legacyChats = legacyData.chats || [];

    let migratedChats = 0;
    let migratedMessages = 0;
    const errors: string[] = [];

    for (const legacyChat of legacyChats) {
      try {
        // Check if chat already exists
        const existingChat = await getChatByContactId(userId, legacyChat.contactId);

        if (existingChat) {
          // Skip if chat already migrated
          continue;
        }

        // Create new chat in subcollection
        const newChat = await createChat(userId, {
          contactId: legacyChat.contactId,
          contactName: legacyChat.contactName,
          contactEmoji: legacyChat.contactEmoji,
          contactImage: legacyChat.contactImage,
          contactPurpose: legacyChat.contactPurpose,
          lastMessage: legacyChat.lastMessage || '',
          lastMessageAt: toDate(legacyChat.lastMessageAt),
        });

        migratedChats++;

        // Migrate messages
        const messages = legacyChat.messages || [];
        for (const msg of messages) {
          try {
            await addMessage(userId, newChat.id, {
              role: msg.role,
              content: msg.content,
              audioUrl: msg.audioUrl,
            });
            migratedMessages++;
          } catch (msgError) {
            console.error(`Error migrating message:`, msgError);
            errors.push(`Message in chat ${legacyChat.contactName}: ${msgError}`);
          }
        }
      } catch (chatError) {
        console.error(`Error migrating chat ${legacyChat.contactName}:`, chatError);
        errors.push(`Chat ${legacyChat.contactName}: ${chatError}`);
      }
    }

    // Mark migration as completed
    await migrationRef.set({
      status: errors.length > 0 ? 'completed_with_errors' : 'completed',
      completedAt: new Date(),
      migratedChats,
      migratedMessages,
      errors: errors.length > 0 ? errors : undefined,
    });

    return NextResponse.json({
      success: true,
      message: 'Migration completed',
      migratedChats,
      migratedMessages,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Migration error:', error);

    // Try to mark migration as failed
    try {
      const token = extractBearerToken(request.headers.get('Authorization'));
      if (token) {
        const decodedToken = await verifyIdToken(token);
        if (decodedToken) {
          const db = await getAdminDb();
          await db
            .collection('users')
            .doc(decodedToken.uid)
            .collection('metadata')
            .doc('migration')
            .set({
              status: 'failed',
              failedAt: new Date(),
              error: String(error),
            });
        }
      }
    } catch {
      // Ignore errors when trying to save error state
    }

    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}

/**
 * GET - Check migration status
 */
export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const rateResult = await checkRateLimitSecure(
      getSyncRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      1,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const db = await getAdminDb();

    const migrationRef = db.collection('users').doc(userId).collection('metadata').doc('migration');
    const migrationDoc = await migrationRef.get();

    if (!migrationDoc.exists) {
      return NextResponse.json({
        status: 'not_started',
        needsMigration: true,
      });
    }

    const data = migrationDoc.data();
    return NextResponse.json({
      status: data?.status || 'unknown',
      migratedChats: data?.migratedChats || 0,
      migratedMessages: data?.migratedMessages || 0,
      completedAt: data?.completedAt?.toDate?.()?.toISOString() || null,
      errors: data?.errors || null,
      needsMigration: data?.status !== 'completed' && data?.status !== 'completed_with_errors',
    });
  } catch (error) {
    console.error('Error checking migration status:', error);
    return NextResponse.json({ error: 'Failed to check migration status' }, { status: 500 });
  }
}
