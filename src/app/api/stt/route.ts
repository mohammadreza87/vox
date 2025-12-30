import { NextResponse } from 'next/server';
import { withAuth, AuthenticatedRequest } from '@/lib/middleware';
import {
  getApiRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

async function handler(request: AuthenticatedRequest) {
  try {
    // Apply rate limiting
    const rateResult = await checkRateLimitSecure(
      getApiRateLimiter(),
      getRateLimitIdentifier(request, request.userId),
      30, // 30 requests per minute for STT
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    // Get the form data with audio file
    const formData = await request.formData();
    const audioFile = formData.get('audio') as Blob | null;
    const language = formData.get('language') as string | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // Check file size (max 25MB)
    if (audioFile.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Audio file too large. Maximum size is 25MB.' },
        { status: 400 }
      );
    }

    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 500 }
      );
    }

    // Create form data for ElevenLabs STT API
    const sttFormData = new FormData();
    sttFormData.append('file', audioFile, 'audio.webm');
    sttFormData.append('model_id', 'scribe_v1'); // ElevenLabs Scribe model

    // If language is provided, use it for better accuracy
    if (language) {
      const langCode = getLanguageCode(language);
      if (langCode) {
        sttFormData.append('language_code', langCode);
      }
    }

    console.log('[STT] Sending to ElevenLabs, file size:', audioFile.size);

    // Call ElevenLabs Speech-to-Text API
    const sttResponse = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey,
      },
      body: sttFormData,
    });

    if (!sttResponse.ok) {
      const error = await sttResponse.json().catch(() => ({}));
      console.error('ElevenLabs STT error:', error);
      return NextResponse.json(
        { error: 'Speech-to-text failed', details: error },
        { status: 500 }
      );
    }

    const result = await sttResponse.json();
    console.log('[STT] ElevenLabs response:', result);

    return NextResponse.json({
      text: result.text,
      language: result.language_code || language,
    });
  } catch (error) {
    console.error('STT error:', error);
    return NextResponse.json(
      { error: 'Speech-to-text failed' },
      { status: 500 }
    );
  }
}

// Helper to convert language names to ISO 639-1 codes
function getLanguageCode(language: string): string | null {
  const languageMap: Record<string, string> = {
    'English': 'en',
    'Spanish': 'es',
    'French': 'fr',
    'German': 'de',
    'Italian': 'it',
    'Portuguese': 'pt',
    'Dutch': 'nl',
    'Russian': 'ru',
    'Chinese': 'zh',
    'Japanese': 'ja',
    'Korean': 'ko',
    'Arabic': 'ar',
    'Hindi': 'hi',
    'Turkish': 'tr',
    'Polish': 'pl',
    'Vietnamese': 'vi',
    'Thai': 'th',
    'Indonesian': 'id',
    'Malay': 'ms',
    'Persian': 'fa',
    'Farsi': 'fa',
    'Hebrew': 'he',
    'Greek': 'el',
    'Czech': 'cs',
    'Romanian': 'ro',
    'Hungarian': 'hu',
    'Swedish': 'sv',
    'Danish': 'da',
    'Finnish': 'fi',
    'Norwegian': 'no',
    'Ukrainian': 'uk',
    'Filipino': 'tl',
    'Tagalog': 'tl',
  };

  // Try exact match first
  if (languageMap[language]) {
    return languageMap[language];
  }

  // Try case-insensitive match
  const lowerLang = language.toLowerCase();
  for (const [name, code] of Object.entries(languageMap)) {
    if (name.toLowerCase() === lowerLang) {
      return code;
    }
  }

  // If language looks like a code already (2-3 chars), use it
  if (language.length <= 3) {
    return language.toLowerCase();
  }

  return null;
}

// Export with auth wrapper
export const POST = withAuth(handler);
