// Application configuration

export const config = {
  // API URLs
  apiUrl: process.env.NEXT_PUBLIC_API_URL || '/api',

  // Feature flags
  features: {
    enableVoiceRecording: true,
    enableTextToSpeech: true,
    enableAuth: true,
  },

  // Rate limits
  limits: {
    maxMessagesPerMinute: 10,
    maxAudioDurationSeconds: 60,
  },

  // ElevenLabs configuration
  elevenLabs: {
    defaultVoiceId: 'EXAVITQu4vr4xnSDxMaL', // Rachel
    modelId: 'eleven_monolingual_v1',
  },

  // Gemini configuration
  gemini: {
    model: 'gemini-2.0-flash-exp',
    maxTokens: 1024,
    temperature: 0.7,
  },
} as const;

export type Config = typeof config;
