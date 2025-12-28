import { NextRequest, NextResponse } from 'next/server';

// Cache voices for 1 hour
let cachedVoices: any[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export async function GET(request: NextRequest) {
  try {
    // Check cache
    if (cachedVoices && Date.now() - cacheTimestamp < CACHE_DURATION) {
      return NextResponse.json({ voices: cachedVoices });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      // Return default voices without preview URLs if no API key
      return NextResponse.json({
        voices: getDefaultVoices(),
        source: 'default'
      });
    }

    // Fetch voices from ElevenLabs
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      console.error('ElevenLabs API error:', response.status);
      return NextResponse.json({
        voices: getDefaultVoices(),
        source: 'default'
      });
    }

    const data = await response.json();

    // Separate cloned voices (user's own) from premade/professional
    const clonedVoices = data.voices
      .filter((v: any) => v.category === 'cloned')
      .map((v: any) => ({
        id: v.voice_id,
        name: v.name,
        gender: v.labels?.gender || 'Custom',
        accent: v.labels?.accent || 'Cloned',
        description: v.labels?.description || 'Your cloned voice',
        previewUrl: v.preview_url,
        category: 'cloned',
        isCloned: true,
      }));

    // Transform premade/professional voices to our format
    const premadeVoices = data.voices
      .filter((v: any) => v.category === 'premade' || v.category === 'professional')
      .map((v: any) => ({
        id: v.voice_id,
        name: v.name,
        gender: v.labels?.gender || 'Unknown',
        accent: v.labels?.accent || 'Unknown',
        description: v.labels?.description || v.labels?.use_case || '',
        previewUrl: v.preview_url,
        category: v.category,
      }))
      .slice(0, 30); // Limit to 30 premade voices

    // Combine with cloned voices first
    const voices = [...clonedVoices, ...premadeVoices];

    // Cache the results
    cachedVoices = voices;
    cacheTimestamp = Date.now();

    return NextResponse.json({
      voices,
      source: 'elevenlabs'
    });
  } catch (error) {
    console.error('Error fetching voices:', error);
    return NextResponse.json({
      voices: getDefaultVoices(),
      source: 'default'
    });
  }
}

// Default voices without preview URLs (will use TTS API for preview)
function getDefaultVoices() {
  return [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'Female', accent: 'American', description: 'Confident and warm' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'Male', accent: 'American', description: 'Deep and confident' },
    { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', gender: 'Male', accent: 'American', description: 'Easy going, casual' },
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'Female', accent: 'American', description: 'Sunny and quirky' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'Male', accent: 'Australian', description: 'Confident and energetic' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'Male', accent: 'British', description: 'Warm and captivating' },
    { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'Female', accent: 'British', description: 'Clear and engaging' },
    { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'Female', accent: 'American', description: 'Professional and warm' },
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'Female', accent: 'American', description: 'Playful and trendy' },
    { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', gender: 'Male', accent: 'American', description: 'Smooth and professional' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'Male', accent: 'British', description: 'Strong and professional' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'Female', accent: 'British', description: 'Velvety and warm' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'Male', accent: 'American', description: 'Resonant and comforting' },
    { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', gender: 'Male', accent: 'American', description: 'Conversational and chill' },
    { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'Male', accent: 'American', description: 'Natural and down-to-earth' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'Male', accent: 'American', description: 'Energetic for social media' },
    { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'Neutral', accent: 'American', description: 'Relaxed and calm' },
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'Female', accent: 'American', description: 'Soft and gentle' },
  ];
}
