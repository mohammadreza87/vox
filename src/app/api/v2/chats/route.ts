/**
 * Chats API v2
 * GET - List all chats for user
 * POST - Create a new chat
 */

import { NextRequest } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import {
  getActiveChats,
  getChatsUpdatedSince,
  createChat,
  getChatByContactId,
} from '@/lib/firestore-v2';
import { CreateChatRequest } from '@/shared/types/database';
import { success, unauthorized, badRequest, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const userId = decodedToken.uid;

    // Check for sync parameter
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since');

    let chats;
    if (since) {
      // Get only chats updated since the given timestamp
      chats = await getChatsUpdatedSince(userId, new Date(since));
    } else {
      // Get all active (non-deleted) chats
      chats = await getActiveChats(userId);
    }

    // Convert dates to ISO strings for JSON
    const serializedChats = chats.map((chat) => ({
      ...chat,
      lastMessageAt: chat.lastMessageAt.toISOString(),
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    }));

    return success({
      chats: serializedChats,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'Error getting chats');
    return serverError('Failed to get chats');
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const userId = decodedToken.uid;
    const body: CreateChatRequest = await request.json();

    // Validate required fields
    if (!body.contactId || !body.contactName) {
      return badRequest('contactId and contactName are required', {
        missingFields: [
          !body.contactId && 'contactId',
          !body.contactName && 'contactName',
        ].filter(Boolean),
      });
    }

    // Check if chat already exists for this contact
    const existingChat = await getChatByContactId(userId, body.contactId);
    if (existingChat) {
      return success({
        chat: {
          ...existingChat,
          lastMessageAt: existingChat.lastMessageAt.toISOString(),
          createdAt: existingChat.createdAt.toISOString(),
          updatedAt: existingChat.updatedAt.toISOString(),
        },
        isExisting: true,
      });
    }

    // Create new chat
    const chat = await createChat(userId, {
      contactId: body.contactId,
      contactName: body.contactName,
      contactEmoji: body.contactEmoji,
      contactImage: body.contactImage,
      contactPurpose: body.contactPurpose,
      lastMessage: '',
      lastMessageAt: new Date(),
    });

    return success(
      {
        chat: {
          ...chat,
          lastMessageAt: chat.lastMessageAt.toISOString(),
          createdAt: chat.createdAt.toISOString(),
          updatedAt: chat.updatedAt.toISOString(),
        },
        isExisting: false,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ error }, 'Error creating chat');
    return serverError('Failed to create chat');
  }
}
