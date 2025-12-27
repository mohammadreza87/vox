import { NextRequest, NextResponse } from 'next/server';
import { withAuth, AuthenticatedRequest } from '@/lib/middleware';
import { ttsRequestSchema } from '@/lib/validation/schemas';
import { sanitizeForAI } from '@/lib/validation/sanitize';
import { getApiRateLimiter, applyRateLimit } from '@/lib/ratelimit';

// ElevenLabs API endpoint
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

async function handler(request: AuthenticatedRequest) {
  try {
    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(request, getApiRateLimiter(), request.userId);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = ttsRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    const { text, voiceId = 'EXAVITQu4vr4xnSDxMaL' } = parseResult.data; // Default to Rachel voice

    // Sanitize text
    const sanitizedText = sanitizeForAI(text);

    // Check if API key is configured
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured', audioUrl: null },
        { status: 200 } // Return 200 so frontend can handle gracefully
      );
    }

    // Call ElevenLabs API
    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: sanitizedText,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs API error:', error);
      return NextResponse.json(
        { error: 'Failed to generate speech', details: error },
        { status: response.status }
      );
    }

    // Get audio buffer
    const audioBuffer = await response.arrayBuffer();

    // Convert to base64 for frontend
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    return NextResponse.json({
      audio: base64Audio,
      contentType: 'audio/mpeg',
    });
  } catch (error) {
    console.error('TTS API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Export with auth wrapper
export const POST = withAuth(handler);
