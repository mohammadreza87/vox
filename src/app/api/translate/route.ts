import { NextRequest, NextResponse } from 'next/server';
import { withAuth, AuthenticatedRequest } from '@/lib/middleware';
import { translateRequestSchema } from '@/lib/validation/schemas';
import { sanitizeForAI } from '@/lib/validation/sanitize';
import { getApiRateLimiter, applyRateLimit } from '@/lib/ratelimit';

async function handler(request: AuthenticatedRequest) {
  try {
    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(request, getApiRateLimiter(), request.userId);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = translateRequestSchema.safeParse(rawBody);

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

    const { text, sourceLanguage, targetLanguage, voiceId: providedVoiceId } = parseResult.data;
    // Use default multilingual voice if none provided
    const voiceId = providedVoiceId || 'EXAVITQu4vr4xnSDxMaL'; // Rachel - default ElevenLabs voice

    // Sanitize text for AI
    const sanitizedText = sanitizeForAI(text);

    // Check API keys
    const openaiKey = process.env.OPENAI_API_KEY;
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;

    if (!openaiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    if (!elevenLabsKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 500 }
      );
    }

    // Step 1: Translate text using OpenAI GPT-4
    const translationResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the following text from ${sourceLanguage || 'the source language'} to ${targetLanguage}. Only provide the translation, no explanations or additional text.`,
          },
          {
            role: 'user',
            content: sanitizedText,
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!translationResponse.ok) {
      const error = await translationResponse.json().catch(() => ({}));
      console.error('Translation error:', error);
      return NextResponse.json(
        { error: 'Translation failed' },
        { status: 500 }
      );
    }

    const translationData = await translationResponse.json();
    const translatedText = translationData.choices[0]?.message?.content?.trim();

    if (!translatedText) {
      return NextResponse.json(
        { error: 'No translation received' },
        { status: 500 }
      );
    }

    // Step 2: Generate speech with ElevenLabs using the cloned voice
    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsKey,
      },
      body: JSON.stringify({
        text: translatedText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!ttsResponse.ok) {
      const error = await ttsResponse.json().catch(() => ({}));
      console.error('TTS error:', error);
      return NextResponse.json(
        { error: 'Text-to-speech generation failed', translatedText },
        { status: 500 }
      );
    }

    // Convert audio to base64
    const audioBuffer = await ttsResponse.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    return NextResponse.json({
      translatedText,
      audio: base64Audio,
      sourceLanguage,
      targetLanguage,
    });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: 'Translation failed' },
      { status: 500 }
    );
  }
}

// Export with auth wrapper
export const POST = withAuth(handler);
