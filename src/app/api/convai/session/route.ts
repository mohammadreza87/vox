import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';

interface SessionRequest {
  contactId: string;
  contactName: string;
  voiceId: string;
  systemPrompt: string;
  personality?: string;
}

/**
 * Generate signed URL for ElevenLabs Conversational AI session
 * Returns agent overrides for the contact's voice and personality
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const body: SessionRequest = await request.json();
    const { contactName, voiceId, systemPrompt, personality } = body;

    // Validate required fields
    if (!contactName || !voiceId) {
      return NextResponse.json(
        { error: 'contactName and voiceId are required' },
        { status: 400 }
      );
    }

    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!agentId) {
      return NextResponse.json(
        { error: 'ElevenLabs agent not configured' },
        { status: 500 }
      );
    }

    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 500 }
      );
    }

    // Get signed URL from ElevenLabs
    const signedUrlResponse = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        headers: {
          'xi-api-key': elevenLabsKey,
        },
      }
    );

    if (!signedUrlResponse.ok) {
      const error = await signedUrlResponse.json().catch(() => ({}));
      logger.error({ error, status: signedUrlResponse.status }, '[ConvAI Session] Failed to get signed URL');
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 }
      );
    }

    const { signed_url: signedUrl } = await signedUrlResponse.json();

    // Build the full system prompt
    const fullPrompt = personality
      ? `${systemPrompt}\n\nPersonality: ${personality}`
      : systemPrompt;

    // Return signed URL with agent overrides
    // Testing with empty overrides
    const overrides = {};

    logger.info({ contactName, voiceId, userId: decodedToken.uid }, '[ConvAI Session] Session created');

    return NextResponse.json({
      signedUrl,
      overrides,
      agentId,
    });
  } catch (error) {
    logger.error({ error }, '[ConvAI Session] Error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
