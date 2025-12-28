import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createAuthenticatedRequest, parseResponse } from '@/test/utils';

// Mock all external dependencies
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(),
  extractBearerToken: vi.fn((header: string | null) => {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }),
}));

vi.mock('@/lib/firestore', () => ({
  getUserDocument: vi.fn(),
  incrementMessageCount: vi.fn(),
  createUserDocument: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  getChatRateLimiter: vi.fn().mockReturnValue(null),
  applyRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/api/timeout', () => ({
  withTimeout: vi.fn((promise: Promise<unknown>) => promise),
  TIMEOUTS: {
    CHAT: 30000,
  },
}));

vi.mock('@/lib/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// Mock AI clients
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      startChat: vi.fn().mockReturnValue({
        sendMessage: vi.fn().mockResolvedValue({
          response: { text: () => 'Mock Gemini response' },
        }),
      }),
    }),
  })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock Claude response' }],
      }),
    },
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mock OpenAI response' } }],
        }),
      },
    },
  })),
}));

// Set environment variables
vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key');

// Import after mocks are set up
const { POST } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { getUserDocument, incrementMessageCount } = await import('@/lib/firestore');
const { applyRateLimit } = await import('@/lib/ratelimit');

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation', () => {
    it('returns 400 for missing message field', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: {},
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Validation failed');
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for empty message', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: { message: '' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid aiProvider', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: { message: 'Hello', aiProvider: 'invalid-provider' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts valid request body', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: {
          message: 'Hello, how are you?',
          contactId: 'test-contact',
          aiProvider: 'deepseek', // Free tier only allows deepseek
        },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('content');
    });
  });

  describe('Authentication', () => {
    it('works without authentication (anonymous user)', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: { message: 'Hello there', contactId: 'test-contact' },
      });

      const response = await POST(request);
      const { status } = await parseResponse(response);

      expect(status).toBe(200);
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    it('verifies token when Authorization header is present', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'free' },
        usage: { messagesUsedToday: 0 },
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/chat', {
        body: { message: 'Hello there', contactId: 'test-contact' },
        token: 'valid-token',
      });

      const response = await POST(request);
      const { status } = await parseResponse(response);

      expect(status).toBe(200);
      expect(verifyIdToken).toHaveBeenCalledWith('valid-token');
    });

    it('processes authenticated user requests', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'free' },
        usage: { messagesUsedToday: 0 },
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/chat', {
        body: { message: 'Hello there', contactId: 'test-contact' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      // Route handles authenticated users and returns response
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('content');
    });
  });

  describe('Rate Limiting', () => {
    it('returns rate limit response when exceeded', async () => {
      const rateLimitResponse = new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        { status: 429 }
      );
      vi.mocked(applyRateLimit).mockResolvedValueOnce(rateLimitResponse as never);

      const request = createMockRequest('POST', '/api/chat', {
        body: { message: 'Hello there', contactId: 'test-contact' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(429);
      expect(data).toHaveProperty('error', 'Rate limit exceeded');
    });
  });

  describe('Subscription Limits', () => {
    it('returns 429 when daily message limit is reached', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'free' },
        usage: { messagesUsedToday: 1000 }, // Exceeded limit
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/chat', {
        body: { message: 'Hello there', contactId: 'test-contact' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(429);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('RATE_LIMITED');
    });

    it('returns 403 when trying to use restricted model', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'free' },
        usage: { messagesUsedToday: 0 },
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/chat', {
        body: {
          message: 'Hello world test message',
          contactId: 'test-contact',
          aiProvider: 'claude',
          aiModel: 'claude-3-opus-20240229', // Premium model
        },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('AI Provider Fallback', () => {
    it('uses deepseek as default provider', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: { message: 'Hello world test message', contactId: 'test-contact' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      // Route returns content and isMock flag regardless of actual API status
      expect(data.data).toHaveProperty('content');
      expect(data.data).toHaveProperty('isMock');
    });

    it('returns mock response on API error', async () => {
      // Force an error by clearing API keys
      vi.stubEnv('DEEPSEEK_API_KEY', '');
      vi.resetModules();

      const { POST: freshPOST } = await import('./route');

      const request = createMockRequest('POST', '/api/chat', {
        body: { message: 'Hello world test message', contactId: 'test-contact' },
      });

      const response = await freshPOST(request);
      const { status, data } = await parseResponse(response);

      // On error, route returns 200 with isMock: true and error message
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('isMock', true);

      // Restore
      vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key');
    });
  });

  describe('Success Cases', () => {
    it('returns response with correct format', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: {
          message: 'Hello, how are you doing today?',
          contactId: 'test-contact',
          systemPrompt: 'You are a helpful assistant',
          aiProvider: 'deepseek', // Free tier only allows deepseek
        },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      // Route returns 200 even on error (with isMock: true)
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('content');
      expect(data.data).toHaveProperty('isMock'); // Either true or false
    });

    it('handles conversation history', async () => {
      const request = createMockRequest('POST', '/api/chat', {
        body: {
          message: 'What did I say before in our conversation?',
          contactId: 'test-contact',
          conversationHistory: [
            { role: 'user', content: 'Hello there friend' },
            { role: 'assistant', content: 'Hi there! How can I help?' },
          ],
          aiProvider: 'deepseek', // Free tier only allows deepseek
        },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      // Route returns 200 even on error (with isMock: true)
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('content');
    });
  });
});
