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
import { success, unauthorized, notFound, serverError, badRequest } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { logChatDeleted } from '@/lib/audit';
import { updateChatRequestSchema } from '@/lib/validation/schemas';
import {
  getV2ApiRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

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

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      60,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
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

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      20,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const { chatId } = await params;
    const body = await request.json();

    const parsed = updateChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('Validation failed', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    // Verify chat exists
    const existingChat = await getChat(userId, chatId);
    if (!existingChat) {
      return notFound('Chat not found');
    }

    // Only allow updating validated fields
    const allowedUpdates: Record<string, unknown> = {};
    if (parsed.data.contactName !== undefined) allowedUpdates.contactName = parsed.data.contactName;
    if (parsed.data.contactEmoji !== undefined) allowedUpdates.contactEmoji = parsed.data.contactEmoji;
    if (parsed.data.contactImage !== undefined) allowedUpdates.contactImage = parsed.data.contactImage;
    if (parsed.data.contactPurpose !== undefined) allowedUpdates.contactPurpose = parsed.data.contactPurpose;

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

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      20,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
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
