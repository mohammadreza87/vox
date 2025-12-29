/**
 * Sync API v2
 * POST - Full sync of chats with messages
 *
 * Handles bidirectional sync:
 * 1. Sends local changes to server
 * 2. Receives server changes since last sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken, getAdminDb } from '@/lib/firebase-admin';
import {
  getChats,
  createChat,
  updateChat,
  deleteChat,
  addMessage,
  getAllMessages,
  getChatByContactId,
} from '@/lib/firestore-v2';
import { ChatDocument, MessageDocument } from '@/shared/types/database';
import {
  getSyncRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';
import { syncRequestSchema } from '@/lib/validation/schemas';

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
      6,
      60 * 60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const body = await request.json();
    const parsed = syncRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    // Process local changes if provided
    if (parsed.data.localChats && parsed.data.localChats.length > 0) {
      for (const localChat of parsed.data.localChats) {
        if (localChat.isDeleted) {
          // Handle deletion
          const existingChat = await getChatByContactId(userId, localChat.contactId);
          if (existingChat) {
            await deleteChat(userId, existingChat.id);
          }
        } else {
          // Check if chat exists
          let serverChat = await getChatByContactId(userId, localChat.contactId);

          if (!serverChat) {
            // Create new chat
            serverChat = await createChat(userId, {
              contactId: localChat.contactId,
              contactName: localChat.contactName,
              contactEmoji: localChat.contactEmoji || '💬',
              contactImage: localChat.contactImage,
              contactPurpose: localChat.contactPurpose || '',
              lastMessage: localChat.lastMessage || '',
              lastMessageAt: localChat.lastMessageAt ? new Date(localChat.lastMessageAt) : new Date(),
            });
          }

          // Sync messages
          if (localChat.messages && localChat.messages.length > 0) {
            const existingMessages = await getAllMessages(userId, serverChat.id);
            const existingMessageIds = new Set(existingMessages.map((m) => m.id));

            for (const msg of localChat.messages) {
              // Only add messages that don't exist on server
              // Use a composite key of content + timestamp for deduplication
              const isDuplicate = existingMessages.some(
                (em) =>
                  em.content === msg.content &&
                  Math.abs(new Date(em.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 1000
              );

              if (!isDuplicate) {
                await addMessage(userId, serverChat.id, {
                  role: msg.role,
                  content: msg.content,
                  audioUrl: msg.audioUrl,
                });
              }
            }
          }
        }
      }
    }

    // Get all chats from server (with messages for full sync)
    const serverChats = await getChats(userId);
    const chatsWithMessages = [];

    for (const chat of serverChats) {
      const messages = await getAllMessages(userId, chat.id);
      chatsWithMessages.push({
        ...chat,
        lastMessageAt: chat.lastMessageAt.toISOString(),
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
        messages: messages.map((msg) => ({
          ...msg,
          createdAt: msg.createdAt.toISOString(),
        })),
      });
    }

    return NextResponse.json({
      chats: chatsWithMessages,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error syncing:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}

/**
 * GET - Simple fetch of all data for initial load
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
      6,
      60 * 60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;

    // Get all chats with messages
    const serverChats = await getChats(userId);
    const chatsWithMessages = [];

    for (const chat of serverChats) {
      const messages = await getAllMessages(userId, chat.id);
      chatsWithMessages.push({
        ...chat,
        lastMessageAt: chat.lastMessageAt.toISOString(),
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
        messages: messages.map((msg) => ({
          ...msg,
          createdAt: msg.createdAt.toISOString(),
        })),
      });
    }

    return NextResponse.json({
      chats: chatsWithMessages,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching sync data:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
