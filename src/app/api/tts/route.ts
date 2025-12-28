import { withAuth, AuthenticatedRequest } from '@/lib/middleware';
import { ttsRequestSchema } from '@/lib/validation/schemas';
import { sanitizeForAI } from '@/lib/validation/sanitize';
import { getApiRateLimiter, applyRateLimit } from '@/lib/ratelimit';
import { success, badRequest, badGateway, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { fetchWithTimeout, TIMEOUTS } from '@/lib/api/timeout';
import { withRetry } from '@/lib/retry';

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
      return badRequest('Validation failed', {
        issues: parseResult.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const { text, voiceId = 'EXAVITQu4vr4xnSDxMaL' } = parseResult.data; // Default to Rachel voice

    // Sanitize text
    const sanitizedText = sanitizeForAI(text);

    // Check if API key is configured
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return success({ error: 'ElevenLabs API key not configured', audioUrl: null });
    }

    // Call ElevenLabs API with timeout and retry
    const audioBuffer = await withRetry(
      async () => {
        const response = await fetchWithTimeout(
          `${ELEVENLABS_API_URL}/${voiceId}`,
          {
            method: 'POST',
            headers: {
              Accept: 'audio/mpeg',
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
          },
          TIMEOUTS.TTS
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'ElevenLabs API error');
          throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        return await response.arrayBuffer();
      },
      { maxRetries: 2, baseDelay: 500 }
    );

    // Convert to base64 for frontend
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    return success({
      audio: base64Audio,
      contentType: 'audio/mpeg',
    });
  } catch (error) {
    logger.error({ error }, 'TTS API error');

    if (error instanceof Error && error.message.includes('ElevenLabs API error')) {
      return badGateway('Failed to generate speech');
    }

    return serverError(error instanceof Error ? error.message : 'Unknown error');
  }
}

// Export with auth wrapper
export const POST = withAuth(handler);
