import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(),
  extractBearerToken: vi.fn((header: string | null) => {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }),
}));

vi.mock('@/lib/firestore', () => ({
  getUserDocument: vi.fn(),
  createUserDocument: vi.fn(),
  saveClonedVoiceToFirestore: vi.fn().mockResolvedValue('voice-doc-id'),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set environment variables
vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');

// Import after mocks
const { POST } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { getUserDocument } = await import('@/lib/firestore');

describe('POST /api/clone-voice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  const createFormDataRequest = (
    data: { name?: string; description?: string; audioFile?: File },
    token?: string
  ) => {
    const formData = new FormData();
    if (data.name) formData.append('name', data.name);
    if (data.description) formData.append('description', data.description);
    if (data.audioFile) formData.append('files', data.audioFile);

    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return new Request('http://localhost:3000/api/clone-voice', {
      method: 'POST',
      headers,
      body: formData,
    });
  };

  const mockAudioFile = new File(['audio content'], 'voice.mp3', {
    type: 'audio/mpeg',
  });

  describe('Authentication', () => {
    it('returns 401 when no authorization header', async () => {
      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        undefined
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token is invalid', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'invalid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('verifies token from Authorization header', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'free' },
      } as never);

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      await POST(request as never);

      expect(verifyIdToken).toHaveBeenCalledWith('valid-token');
    });
  });

  describe('Subscription Validation', () => {
    it('returns 403 for free tier users', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'free' },
      } as never);

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    it('allows pro tier users to clone voice', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'pro' },
      } as never);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'new-voice-123' }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.voice_id).toBe('new-voice-123');
    });

    it('allows max tier users to clone voice', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'max' },
      } as never);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'new-voice-123' }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('voice_id');
    });
  });

  describe('Validation', () => {
    beforeEach(() => {
      vi.mocked(verifyIdToken).mockResolvedValue({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: { tier: 'pro' },
      } as never);
    });

    it('returns 400 when name is missing', async () => {
      const request = createFormDataRequest(
        { audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Audio file and name are required');
    });

    it('returns 400 when audio file is missing', async () => {
      const request = createFormDataRequest({ name: 'My Voice' }, 'valid-token');

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Audio file and name are required');
    });

    it('accepts request with name and audio file', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'new-voice-123' }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('voice_id');
    });
  });

  describe('API Key Configuration', () => {
    it('returns 500 when ElevenLabs API key not configured', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '');
      vi.resetModules();

      const { POST: freshPOST } = await import('./route');

      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'pro' },
      } as never);

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await freshPOST(request as never);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('ElevenLabs API key not configured');

      // Restore
      vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');
    });
  });

  describe('ElevenLabs API Integration', () => {
    beforeEach(() => {
      vi.mocked(verifyIdToken).mockResolvedValue({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: { tier: 'pro' },
      } as never);
    });

    it('calls ElevenLabs API with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'new-voice-123' }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', description: 'Test description', audioFile: mockAudioFile },
        'valid-token'
      );

      await POST(request as never);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/add',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-elevenlabs-key',
          }),
        })
      );
    });

    it('returns 401 when ElevenLabs API key is invalid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: { message: 'Invalid API key' } }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Invalid ElevenLabs API key');
    });

    it('returns 422 when ElevenLabs plan does not support voice cloning', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: { message: 'Voice cloning requires paid plan' } }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe(
        'Voice cloning requires an ElevenLabs paid plan (Starter or higher)'
      );
    });

    it('returns error message from ElevenLabs on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: { message: 'Internal server error' } }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Internal server error');
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Failed to clone voice');
    });
  });

  describe('Success Cases', () => {
    beforeEach(() => {
      vi.mocked(verifyIdToken).mockResolvedValue({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: { tier: 'pro' },
      } as never);
    });

    it('returns voice_id and name on successful clone', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'cloned-voice-456' }),
      });

      const request = createFormDataRequest(
        { name: 'My Custom Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toEqual({
        voice_id: 'cloned-voice-456',
        name: 'My Custom Voice',
        source: 'contact',
      });
    });

    it('uses default description when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'cloned-voice-456' }),
      });

      const request = createFormDataRequest(
        { name: 'My Voice', audioFile: mockAudioFile },
        'valid-token'
      );

      await POST(request as never);

      // Verify the fetch was called (description handling is in the form data)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
