/**
 * Chats API v2
 * GET - List all chats for user
 * POST - Create a new chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import {
  getChats,
  getChatsUpdatedSince,
  createChat,
  getChatByContactId,
} from '@/lib/firestore-v2';
import { CreateChatRequest } from '@/shared/types/database';

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

    const userId = decodedToken.uid;

    // Check for sync parameter
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since');

    let chats;
    if (since) {
      // Get only chats updated since the given timestamp
      chats = await getChatsUpdatedSince(userId, new Date(since));
    } else {
      // Get all chats
      chats = await getChats(userId);
    }

    // Convert dates to ISO strings for JSON
    const serializedChats = chats.map((chat) => ({
      ...chat,
      lastMessageAt: chat.lastMessageAt.toISOString(),
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      chats: serializedChats,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting chats:', error);
    return NextResponse.json({ error: 'Failed to get chats' }, { status: 500 });
  }
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

    const userId = decodedToken.uid;
    const body: CreateChatRequest = await request.json();

    // Validate required fields
    if (!body.contactId || !body.contactName) {
      return NextResponse.json(
        { error: 'contactId and contactName are required' },
        { status: 400 }
      );
    }

    // Check if chat already exists for this contact
    const existingChat = await getChatByContactId(userId, body.contactId);
    if (existingChat) {
      return NextResponse.json({
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

    return NextResponse.json({
      chat: {
        ...chat,
        lastMessageAt: chat.lastMessageAt.toISOString(),
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
      },
      isExisting: false,
    });
  } catch (error) {
    console.error('Error creating chat:', error);
    return NextResponse.json({ error: 'Failed to create chat' }, { status: 500 });
  }
}
