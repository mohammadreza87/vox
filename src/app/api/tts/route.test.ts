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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fetchWithTimeout
const mockFetchWithTimeout = vi.fn();
vi.mock('@/lib/api/timeout', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
  TIMEOUTS: {
    TTS: 15000,
  },
}));

// Mock withRetry to just execute the function directly
vi.mock('@/lib/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// Set environment variables
vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');

// Import after mocks
const { POST } = await import('./route');
const { checkRateLimitSecure } = await import('@/lib/ratelimit');

describe('POST /api/tts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWithTimeout.mockReset();
  });

  describe('Validation', () => {
    it('returns 400 for missing text field', async () => {
      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: {},
      });
      // Add userId for withAuth mock
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for empty text', async () => {
      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: '' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts valid request with default voice', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello world' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('audio');
      expect(data.data).toHaveProperty('contentType', 'audio/mpeg');
    });

    it('accepts custom voiceId', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello world', voiceId: 'custom-voice-id' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status } = await parseResponse(response);

      expect(status).toBe(200);
      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining('custom-voice-id'),
        expect.any(Object),
        expect.any(Number)
      );
    });
  });

  describe('Rate Limiting', () => {
    it('returns rate limit response when exceeded', async () => {
      vi.mocked(checkRateLimitSecure).mockResolvedValueOnce({
        success: false,
        response: new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 }),
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(429);
      expect(data).toHaveProperty('error', 'Rate limit exceeded');
    });
  });

  describe('API Key Configuration', () => {
    it('returns success with error when API key not configured', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '');
      vi.resetModules();

      // Re-import with cleared API key
      vi.mock('@/lib/api/timeout', () => ({
        fetchWithTimeout: mockFetchWithTimeout,
        TIMEOUTS: { TTS: 15000 },
      }));

      const { POST: freshPOST } = await import('./route');

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await freshPOST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200); // Returns 200 for graceful handling
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('error', 'ElevenLabs API key not configured');
      expect(data.data).toHaveProperty('audioUrl', null);

      // Restore
      vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');
    });
  });

  describe('ElevenLabs API Integration', () => {
    it('calls ElevenLabs API with correct parameters', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello world', voiceId: 'test-voice' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      await POST(request, { params: Promise.resolve({}) });

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/test-voice',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-elevenlabs-key',
            'Content-Type': 'application/json',
          }),
        }),
        expect.any(Number)
      );
    });

    it('returns 502 when ElevenLabs API fails', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid voice ID'),
      });

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(502);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Failed to generate speech');
    });

    it('returns 500 on unexpected error', async () => {
      mockFetchWithTimeout.mockRejectedValueOnce(new Error('Network error'));

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Network error');
    });
  });

  describe('Success Cases', () => {
    it('returns base64 audio on success', async () => {
      const audioData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioData.buffer),
      });

      const request = createAuthenticatedRequest('POST', '/api/tts', {
        body: { text: 'Hello world' },
      });
      (request as any).userId = 'test-user-123';
      (request as any).user = { uid: 'test-user-123' };

      const response = await POST(request, { params: Promise.resolve({}) });
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('audio');
      expect(data.data).toHaveProperty('contentType', 'audio/mpeg');
      expect(typeof data.data.audio).toBe('string');
    });
  });
});
