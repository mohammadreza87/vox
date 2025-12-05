import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken, getAdminDb } from '@/lib/firebase-admin';
import { Chat, Message } from '@/shared/types';

// GET - Load user data (chats, preferences, custom contacts)
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
    const db = getAdminDb();
    const userDataRef = db.collection('users').doc(userId).collection('data').doc('app');
    const userDataSnap = await userDataRef.get();

    if (!userDataSnap.exists) {
      return NextResponse.json({
        chats: [],
        customContacts: [],
        preferences: { theme: 'light' },
      });
    }

    const data = userDataSnap.data()!;

    // Convert Firestore timestamps to ISO strings for JSON serialization
    const chats = (data.chats || []).map((chat: Chat) => ({
      ...chat,
      lastMessageAt: chat.lastMessageAt instanceof Date
        ? chat.lastMessageAt.toISOString()
        : chat.lastMessageAt,
      messages: (chat.messages || []).map((msg: Message) => ({
        ...msg,
        createdAt: msg.createdAt instanceof Date
          ? msg.createdAt.toISOString()
          : msg.createdAt,
      })),
    }));

    return NextResponse.json({
      chats,
      customContacts: data.customContacts || [],
      preferences: data.preferences || { theme: 'light' },
    });
  } catch (error) {
    console.error('Error loading user data:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}

// POST - Save user data
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
    const body = await request.json();
    const { chats, customContacts, preferences } = body;

    const db = getAdminDb();
    const userDataRef = db.collection('users').doc(userId).collection('data').doc('app');

    const updateData: Record<string, unknown> = {};

    if (chats !== undefined) {
      updateData.chats = chats;
    }
    if (customContacts !== undefined) {
      updateData.customContacts = customContacts;
    }
    if (preferences !== undefined) {
      updateData.preferences = preferences;
    }

    await userDataRef.set(updateData, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving user data:', error);
    return NextResponse.json({ error: 'Failed to save data' }, { status: 500 });
  }
}
