/**
 * Individual Chat API v2
 * GET - Get chat with messages
 * PATCH - Update chat metadata
 * DELETE - Delete chat and all messages
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import {
  getChat,
  getChatWithMessages,
  updateChat,
  deleteChat,
} from '@/lib/firestore-v2';

interface RouteParams {
  params: Promise<{ chatId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = decodedToken.uid;
    const { chatId } = await params;

    // Check if we should include messages
    const { searchParams } = new URL(request.url);
    const includeMessages = searchParams.get('messages') === 'true';

    if (includeMessages) {
      const chat = await getChatWithMessages(userId, chatId);
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }

      return NextResponse.json({
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
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    return NextResponse.json({
      chat: {
        ...chat,
        lastMessageAt: chat.lastMessageAt.toISOString(),
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error getting chat:', error);
    return NextResponse.json({ error: 'Failed to get chat' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = decodedToken.uid;
    const { chatId } = await params;
    const body = await request.json();

    // Verify chat exists
    const existingChat = await getChat(userId, chatId);
    if (!existingChat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Only allow updating certain fields
    const allowedUpdates: Record<string, unknown> = {};
    if (body.contactName !== undefined) allowedUpdates.contactName = body.contactName;
    if (body.contactEmoji !== undefined) allowedUpdates.contactEmoji = body.contactEmoji;
    if (body.contactImage !== undefined) allowedUpdates.contactImage = body.contactImage;
    if (body.contactPurpose !== undefined) allowedUpdates.contactPurpose = body.contactPurpose;

    await updateChat(userId, chatId, allowedUpdates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating chat:', error);
    return NextResponse.json({ error: 'Failed to update chat' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = decodedToken.uid;
    const { chatId } = await params;

    await deleteChat(userId, chatId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting chat:', error);
    return NextResponse.json({ error: 'Failed to delete chat' }, { status: 500 });
  }
}
