/**
 * Messages API v2
 * GET - Get messages (paginated)
 * POST - Add a new message
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { getMessages, addMessage, getChat } from '@/lib/firestore-v2';
import { AddMessageRequest } from '@/shared/types/database';

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

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const cursor = searchParams.get('cursor') || undefined;

    // Verify chat exists
    const chat = await getChat(userId, chatId);
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    const result = await getMessages(userId, chatId, limit, cursor);

    return NextResponse.json({
      messages: result.messages.map((msg) => ({
        ...msg,
        createdAt: msg.createdAt.toISOString(),
      })),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    console.error('Error getting messages:', error);
    return NextResponse.json({ error: 'Failed to get messages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const body: Omit<AddMessageRequest, 'chatId'> = await request.json();

    // Validate required fields
    if (!body.role || !body.content) {
      return NextResponse.json(
        { error: 'role and content are required' },
        { status: 400 }
      );
    }

    // Verify chat exists
    const chat = await getChat(userId, chatId);
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    const message = await addMessage(userId, chatId, {
      role: body.role,
      content: body.content,
      audioUrl: body.audioUrl || null,
    });

    return NextResponse.json({
      message: {
        ...message,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error adding message:', error);
    return NextResponse.json({ error: 'Failed to add message' }, { status: 500 });
  }
}
