/**
 * Individual Chat API v2
 * GET - Get chat with messages
 * PATCH - Update chat metadata
 * DELETE - Soft delete chat and all messages
 */

import { NextRequest } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import {
  getChat,
  getChatWithMessages,
  updateChat,
  softDeleteChat,
} from '@/lib/firestore-v2';
import { success, unauthorized, notFound, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { logChatDeleted } from '@/lib/audit';

interface RouteParams {
  params: Promise<{ chatId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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
    const { chatId } = await params;

    // Check if we should include messages
    const { searchParams } = new URL(request.url);
    const includeMessages = searchParams.get('messages') === 'true';

    if (includeMessages) {
      const chat = await getChatWithMessages(userId, chatId);
      if (!chat) {
        return notFound('Chat not found');
      }

      return success({
        chat: {
          ...chat,
          lastMessageAt: chat.lastMessageAt.toISOString(),
          createdAt: chat.createdAt.toISOString(),
          updatedAt: chat.updatedAt.toISOString(),
          messages: chat.messages.map((msg) => ({
            ...msg,
            createdAt: msg.createdAt.toISOString(),
          })),
        },
      });
    }

    const chat = await getChat(userId, chatId);
    if (!chat) {
      return notFound('Chat not found');
    }

    return success({
      chat: {
        ...chat,
        lastMessageAt: chat.lastMessageAt.toISOString(),
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error getting chat');
    return serverError('Failed to get chat');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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
    const { chatId } = await params;
    const body = await request.json();

    // Verify chat exists
    const existingChat = await getChat(userId, chatId);
    if (!existingChat) {
      return notFound('Chat not found');
    }

    // Only allow updating certain fields
    const allowedUpdates: Record<string, unknown> = {};
    if (body.contactName !== undefined) allowedUpdates.contactName = body.contactName;
    if (body.contactEmoji !== undefined) allowedUpdates.contactEmoji = body.contactEmoji;
    if (body.contactImage !== undefined) allowedUpdates.contactImage = body.contactImage;
    if (body.contactPurpose !== undefined) allowedUpdates.contactPurpose = body.contactPurpose;

    await updateChat(userId, chatId, allowedUpdates);

    return success({ updated: true });
  } catch (error) {
    logger.error({ error }, 'Error updating chat');
    return serverError('Failed to update chat');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
    const { chatId } = await params;

    // Use soft delete instead of permanent delete
    await softDeleteChat(userId, chatId);

    // Log the deletion for audit
    await logChatDeleted(userId, chatId, true);

    return success({ deleted: true });
  } catch (error) {
    logger.error({ error }, 'Error deleting chat');
    return serverError('Failed to delete chat');
  }
}
