/**
 * Messages API v2
 * GET - Get messages (paginated)
 * POST - Add a new message
 */

import { NextRequest } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { getActiveMessages, addMessage, getChat } from '@/lib/firestore-v2';
import { AddMessageRequest } from '@/shared/types/database';
import { success, unauthorized, notFound, badRequest, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { logMessageSent } from '@/lib/audit';

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

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const cursor = searchParams.get('cursor') || undefined;

    // Verify chat exists
    const chat = await getChat(userId, chatId);
    if (!chat) {
      return notFound('Chat not found');
    }

    // Use getActiveMessages to exclude soft-deleted messages
    const result = await getActiveMessages(userId, chatId, limit, cursor);

    return success(
      {
        messages: result.messages.map((msg) => ({
          ...msg,
          createdAt: msg.createdAt.toISOString(),
        })),
      },
      {
        pagination: {
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error getting messages');
    return serverError('Failed to get messages');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const body: Omit<AddMessageRequest, 'chatId'> = await request.json();

    // Validate required fields
    if (!body.role || !body.content) {
      return badRequest('role and content are required', {
        missingFields: [!body.role && 'role', !body.content && 'content'].filter(Boolean),
      });
    }

    // Verify chat exists
    const chat = await getChat(userId, chatId);
    if (!chat) {
      return notFound('Chat not found');
    }

    const message = await addMessage(userId, chatId, {
      role: body.role,
      content: body.content,
      audioUrl: body.audioUrl || null,
    });

    // Log message for audit
    await logMessageSent(userId, chatId, message.id, body.role);

    return success(
      {
        message: {
          ...message,
          createdAt: message.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ error }, 'Error adding message');
    return serverError('Failed to add message');
  }
}
