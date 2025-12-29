import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthenticatedRequest, parseResponse } from '@/test/utils';

// Mock dependencies
vi.mock('@/lib/middleware', () => ({
  withAuth: vi.fn((handler) => handler),
  AuthenticatedRequest: {},
}));

vi.mock('@/lib/ratelimit', () => ({
  getApiRateLimiter: vi.fn().mockReturnValue(null),
  getRateLimitIdentifier: vi.fn().mockReturnValue('user:test'),
  checkRateLimitSecure: vi.fn().mockResolvedValue({ success: true, response: null }),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set environment variables
vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');

// Import after mocks
const { POST } = await import('./route');
const { checkRateLimitSecure } = await import('@/lib/ratelimit');

describe('POST /api/translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  const createRequest = (body: object) => {
    const request = createAuthenticatedRequest('POST', '/api/translate', { body });
    (request as any).userId = 'test-user-123';
    (request as any).user = { uid: 'test-user-123' };
    return request;
  };

  describe('Validation', () => {
    it('returns 400 for missing text field', async () => {
      const request = createRequest({
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 for missing targetLanguage', async () => {
      const request = createRequest({
        text: 'Hello',
        voiceId: 'voice-123',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 for missing voiceId', async () => {
      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('accepts valid request', async () => {
      // Mock OpenAI response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Hola' } }],
        }),
      });
      // Mock ElevenLabs response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data).toHaveProperty('translatedText', 'Hola');
      expect(data).toHaveProperty('audio');
    });
  });

  describe('Rate Limiting', () => {
    it('returns rate limit response when exceeded', async () => {
      vi.mocked(checkRateLimitSecure).mockResolvedValueOnce({
        success: false,
        response: new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 }),
      } as never);

      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(429);
      expect(data).toHaveProperty('error', 'Rate limit exceeded');
    });
  });

  describe('API Key Configuration', () => {
    it('returns 500 when OpenAI API key not configured', async () => {
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.resetModules();

      const { POST: freshPOST } = await import('./route');

      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      const response = await freshPOST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data).toHaveProperty('error', 'OpenAI API key not configured');

      // Restore
      vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    });

    it('returns 500 when ElevenLabs API key not configured', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '');
      vi.resetModules();

      const { POST: freshPOST } = await import('./route');

      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      const response = await freshPOST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data).toHaveProperty('error', 'ElevenLabs API key not configured');

      // Restore
      vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');
    });
  });

  describe('Translation Flow', () => {
    it('calls OpenAI for translation first', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Hola mundo' } }],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const request = createRequest({
        text: 'Hello world',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      await POST(request, { params: Promise.resolve({}) });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-openai-key',
          }),
        })
      );
    });

    it('calls ElevenLabs with translated text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Hola' } }],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
        voiceId: 'custom-voice',
      });

      await POST(request, { params: Promise.resolve({}) });

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.elevenlabs.io/v1/text-to-speech/custom-voice',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-elevenlabs-key',
          }),
        })
      );
    });

    it('returns 500 when translation fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'API error' }),
      });

      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data).toHaveProperty('error', 'Translation failed');
    });

    it('returns 500 when TTS fails but includes translated text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Hola' } }],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'TTS error' }),
      });

      const request = createRequest({
        text: 'Hello',
        targetLanguage: 'es',
        voiceId: 'voice-123',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data).toHaveProperty('error', 'Text-to-speech generation failed');
      expect(data).toHaveProperty('translatedText', 'Hola');
    });
  });

  describe('Success Cases', () => {
    it('returns translated text and audio', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Bonjour le monde' } }],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const request = createRequest({
        text: 'Hello world',
        sourceLanguage: 'en',
        targetLanguage: 'fr',
        voiceId: 'voice-123',
      });

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data).toHaveProperty('translatedText', 'Bonjour le monde');
      expect(data).toHaveProperty('audio');
      expect(data).toHaveProperty('sourceLanguage', 'en');
      expect(data).toHaveProperty('targetLanguage', 'fr');
    });
  });
});
