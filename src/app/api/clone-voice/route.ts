import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { getUserDocument, createUserDocument, saveClonedVoiceToFirestore } from '@/lib/firestore';
import { SUBSCRIPTION_TIERS } from '@/config/subscription';
import { success, unauthorized, badRequest, forbidden, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import {
  getVoiceCloneRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_AUDIO_MIME_PREFIX = 'audio/';

export async function POST(request: NextRequest) {
  try {
    // Check for authentication
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const userId = decodedToken.uid;

    const rateResult = await checkRateLimitSecure(
      getVoiceCloneRateLimiter(),
      getRateLimitIdentifier(request, userId),
      5, // Allow 5 voice clones per 10 minutes
      10 * 60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    // Get or create user document
    let userDoc = await getUserDocument(userId);
    if (!userDoc && decodedToken.email) {
      await createUserDocument(userId, decodedToken.email, decodedToken.name || '');
      userDoc = await getUserDocument(userId);
    }

    const tier = userDoc?.subscription.tier || 'free';

    // Check if user's tier allows voice cloning
    if (!SUBSCRIPTION_TIERS[tier].features.voiceCloning) {
      return forbidden('Voice cloning requires a Pro or Max subscription');
    }

    const formData = await request.formData();
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const audioFile = formData.get('files') as File;
    const source = (formData.get('source') as string) || 'contact';
    const sourceLanguage = formData.get('sourceLanguage') as string | undefined;
    const isDefaultTranslator = formData.get('isDefaultTranslator') === 'true';

    if (!audioFile || !name) {
      return badRequest('Audio file and name are required');
    }

    if (audioFile.size > MAX_AUDIO_BYTES) {
      return badRequest('Audio file exceeds 50MB limit');
    }

    if (audioFile.type && !audioFile.type.startsWith(ALLOWED_AUDIO_MIME_PREFIX)) {
      return badRequest('Unsupported file type. Please upload an audio file.');
    }

    if (source && !['contact', 'translator'].includes(source)) {
      return badRequest('source must be "contact" or "translator"');
    }

    // Check if ElevenLabs API key is configured
    if (!process.env.ELEVENLABS_API_KEY) {
      return serverError('ElevenLabs API key not configured');
    }

    // Create form data for ElevenLabs API
    const elevenLabsFormData = new FormData();
    elevenLabsFormData.append('name', name);
    elevenLabsFormData.append('description', description || `Cloned voice: ${name}`);
    elevenLabsFormData.append('files', audioFile);

    // Call ElevenLabs Voice Cloning API
    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: elevenLabsFormData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error({ error: errorData, status: response.status }, 'ElevenLabs API error');

      // Check for specific error types
      if (response.status === 401) {
        return unauthorized('Invalid ElevenLabs API key');
      }

      if (response.status === 422) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'ELEVENLABS_PLAN_REQUIRED',
              message: 'Voice cloning requires an ElevenLabs paid plan (Starter or higher)',
            },
          },
          { status: 422 }
        );
      }

      return serverError(errorData.detail?.message || 'Failed to clone voice');
    }

    const data = await response.json();
    const voiceId = data.voice_id;

    // Save to Firestore for persistence
    try {
      await saveClonedVoiceToFirestore(userId, {
        voiceId,
        name,
        source: source as 'contact' | 'translator',
        sourceLanguage,
        isDefaultTranslator,
      });
      logger.info({ userId, voiceId, source }, 'Cloned voice saved to Firestore');
    } catch (firestoreError) {
      // Log but don't fail - the voice was created successfully in ElevenLabs
      logger.error({ error: firestoreError, userId, voiceId }, 'Failed to save cloned voice to Firestore');
    }

    return success(
      {
        voice_id: voiceId,
        name: name,
        source,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ error }, 'Voice cloning error');
    return serverError('Failed to clone voice');
  }
}
