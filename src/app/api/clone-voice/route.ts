import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { getUserDocument, createUserDocument } from '@/lib/firestore';
import { SUBSCRIPTION_TIERS } from '@/config/subscription';

export async function POST(request: NextRequest) {
  try {
    // Check for authentication
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json(
        { error: 'Invalid token', code: 'INVALID_TOKEN' },
        { status: 401 }
      );
    }

    const userId = decodedToken.uid;

    // Get or create user document
    let userDoc = await getUserDocument(userId);
    if (!userDoc && decodedToken.email) {
      await createUserDocument(userId, decodedToken.email, decodedToken.name || '');
      userDoc = await getUserDocument(userId);
    }

    const tier = userDoc?.subscription.tier || 'free';

    // Check if user's tier allows voice cloning
    if (!SUBSCRIPTION_TIERS[tier].features.voiceCloning) {
      return NextResponse.json(
        {
          error: 'Voice cloning requires a Pro or Max subscription',
          code: 'FEATURE_RESTRICTED',
          requiredTier: 'pro',
        },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const audioFile = formData.get('files') as File;

    if (!audioFile || !name) {
      return NextResponse.json(
        { error: 'Audio file and name are required' },
        { status: 400 }
      );
    }

    // Check if ElevenLabs API key is configured
    if (!process.env.ELEVENLABS_API_KEY) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 500 }
      );
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
      console.error('ElevenLabs API error:', errorData);

      // Check for specific error types
      if (response.status === 401) {
        return NextResponse.json(
          { error: 'Invalid ElevenLabs API key' },
          { status: 401 }
        );
      }

      if (response.status === 422) {
        return NextResponse.json(
          { error: 'Voice cloning requires an ElevenLabs paid plan (Starter or higher)' },
          { status: 422 }
        );
      }

      return NextResponse.json(
        { error: errorData.detail?.message || 'Failed to clone voice' },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      voice_id: data.voice_id,
      name: name,
    });
  } catch (error) {
    console.error('Voice cloning error:', error);
    return NextResponse.json(
      { error: 'Failed to clone voice' },
      { status: 500 }
    );
  }
}
