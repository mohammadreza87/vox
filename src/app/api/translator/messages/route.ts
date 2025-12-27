import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';
import {
  saveTranslatorMessage,
  getTranslatorMessages,
  clearTranslatorMessages,
  TranslatorMessage,
} from '@/lib/firestore';

// Verify Firebase token and get user ID
async function verifyToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const adminAuth = await getAdminAuth();
    const decodedToken = await adminAuth.verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

// GET - Load translator messages
export async function GET(request: NextRequest) {
  try {
    const userId = await verifyToken(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const beforeStr = searchParams.get('before');
    const beforeTimestamp = beforeStr ? new Date(beforeStr) : undefined;

    const messages = await getTranslatorMessages(userId, limit, beforeTimestamp);

    return NextResponse.json({
      messages: messages.map(m => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error loading translator messages:', error);
    return NextResponse.json(
      { error: 'Failed to load messages' },
      { status: 500 }
    );
  }
}

// POST - Save a new translator message
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyToken(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { sourceText, translatedText, sourceLanguage, targetLanguage, speaker, timestamp } = body;

    if (!sourceText || !translatedText || !sourceLanguage || !targetLanguage || !speaker) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const messageId = await saveTranslatorMessage(userId, {
      sourceText,
      translatedText,
      sourceLanguage,
      targetLanguage,
      speaker,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    return NextResponse.json({ id: messageId });
  } catch (error) {
    console.error('Error saving translator message:', error);
    return NextResponse.json(
      { error: 'Failed to save message' },
      { status: 500 }
    );
  }
}

// DELETE - Clear all translator messages
export async function DELETE(request: NextRequest) {
  try {
    const userId = await verifyToken(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await clearTranslatorMessages(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error clearing translator messages:', error);
    return NextResponse.json(
      { error: 'Failed to clear messages' },
      { status: 500 }
    );
  }
}
