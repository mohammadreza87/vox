import { NextRequest } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import {
  getClonedVoicesFromFirestore,
  saveClonedVoiceToFirestore,
  deleteClonedVoiceFromFirestore,
  setDefaultTranslatorVoice,
  getDefaultTranslatorVoice,
} from '@/lib/firestore';
import { success, unauthorized, badRequest, notFound, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import {
  getV2ApiRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

// GET - Get all cloned voices for the user
export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      60, // Increased from 30 - called on page load
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const voices = await getClonedVoicesFromFirestore(userId);
    const defaultVoice = await getDefaultTranslatorVoice(userId);

    return success({
      voices: voices.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
      })),
      defaultTranslatorVoiceId: defaultVoice?.voiceId || null,
    });
  } catch (error) {
    logger.error({ error }, 'Error getting cloned voices');
    return serverError('Failed to get cloned voices');
  }
}

// POST - Save a new cloned voice
export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      10,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const body = await request.json();

    const { voiceId, name, source, sourceLanguage, isDefaultTranslator } = body;

    if (!voiceId || !name) {
      return badRequest('voiceId and name are required');
    }

    if (source && !['contact', 'translator'].includes(source)) {
      return badRequest('source must be "contact" or "translator"');
    }

    const id = await saveClonedVoiceToFirestore(userId, {
      voiceId,
      name,
      source: source || 'contact',
      sourceLanguage,
      isDefaultTranslator: isDefaultTranslator || false,
    });

    // If this is marked as default translator, set it
    if (isDefaultTranslator) {
      await setDefaultTranslatorVoice(userId, voiceId);
    }

    logger.info({ userId, voiceId, source }, 'Saved cloned voice');

    return success({ id, saved: true }, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Error saving cloned voice');
    return serverError('Failed to save cloned voice');
  }
}

// DELETE - Delete a cloned voice
export async function DELETE(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      20,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const { searchParams } = new URL(request.url);
    const voiceId = searchParams.get('voiceId');

    if (!voiceId) {
      return badRequest('voiceId query parameter is required');
    }

    try {
      await deleteClonedVoiceFromFirestore(userId, voiceId);
      logger.info({ userId, voiceId }, 'Deleted cloned voice');
      return success({ deleted: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'Voice not found') {
        return notFound('Voice not found');
      }
      throw error;
    }
  } catch (error) {
    logger.error({ error }, 'Error deleting cloned voice');
    return serverError('Failed to delete cloned voice');
  }
}

// PATCH - Update default translator voice
export async function PATCH(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      20,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const body = await request.json();

    const { defaultTranslatorVoiceId } = body;

    await setDefaultTranslatorVoice(userId, defaultTranslatorVoiceId || null);
    logger.info({ userId, voiceId: defaultTranslatorVoiceId }, 'Updated default translator voice');

    return success({ updated: true });
  } catch (error) {
    logger.error({ error }, 'Error updating default translator voice');
    return serverError('Failed to update default translator voice');
  }
}
