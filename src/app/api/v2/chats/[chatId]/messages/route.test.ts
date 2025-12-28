import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthenticatedRequest, createMockRequest, parseResponse } from '@/test/utils';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(),
  extractBearerToken: vi.fn((header: string | null) => {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }),
}));

vi.mock('@/lib/firestore-v2', () => ({
  getActiveMessages: vi.fn(),
  addMessage: vi.fn(),
  getChat: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/audit', () => ({
  logMessageSent: vi.fn(),
}));

// Import after mocks
const { GET, POST } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { getActiveMessages, addMessage, getChat } = await import('@/lib/firestore-v2');

describe('/api/v2/chats/[chatId]/messages', () => {
  const mockDate = new Date('2024-01-15T12:00:00.000Z');
  const mockParams = { params: Promise.resolve({ chatId: 'chat-123' }) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v2/chats/[chatId]/messages', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('GET', '/api/v2/chats/chat-123/messages');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123/messages', {
          token: 'invalid-token',
        });

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Invalid token');
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChat).mockResolvedValue({
          id: 'chat-123',
          contactName: 'John',
        } as never);
      });

      it('returns messages with default limit', async () => {
        const mockMessages = {
          messages: [
            { id: 'msg-1', role: 'user', content: 'Hello', createdAt: mockDate },
            { id: 'msg-2', role: 'assistant', content: 'Hi there!', createdAt: mockDate },
          ],
          hasMore: false,
          nextCursor: null,
        };
        vi.mocked(getActiveMessages).mockResolvedValueOnce(mockMessages as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123/messages');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty('messages');
        expect(data.data.messages).toHaveLength(2);
        expect(data.meta.pagination.hasMore).toBe(false);
        expect(getActiveMessages).toHaveBeenCalledWith('test-user-123', 'chat-123', 50, undefined);
      });

      it('uses custom limit from query params', async () => {
        vi.mocked(getActiveMessages).mockResolvedValueOnce({
          messages: [],
          hasMore: false,
          nextCursor: null,
        } as never);

        const request = createAuthenticatedRequest(
          'GET',
          '/api/v2/chats/chat-123/messages?limit=20'
        );

        await GET(request, mockParams);

        expect(getActiveMessages).toHaveBeenCalledWith('test-user-123', 'chat-123', 20, undefined);
      });

      it('uses cursor for pagination', async () => {
        vi.mocked(getActiveMessages).mockResolvedValueOnce({
          messages: [],
          hasMore: false,
          nextCursor: null,
        } as never);

        const request = createAuthenticatedRequest(
          'GET',
          '/api/v2/chats/chat-123/messages?cursor=msg-5'
        );

        await GET(request, mockParams);

        expect(getActiveMessages).toHaveBeenCalledWith('test-user-123', 'chat-123', 50, 'msg-5');
      });

      it('returns hasMore and nextCursor for pagination', async () => {
        const mockMessages = {
          messages: [{ id: 'msg-1', role: 'user', content: 'Hello', createdAt: mockDate }],
          hasMore: true,
          nextCursor: 'msg-1',
        };
        vi.mocked(getActiveMessages).mockResolvedValueOnce(mockMessages as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123/messages');

        const response = await GET(request, mockParams);
        const { data } = await parseResponse(response);

        expect(data.meta.pagination.hasMore).toBe(true);
        expect(data.meta.pagination.nextCursor).toBe('msg-1');
      });

      it('converts message dates to ISO strings', async () => {
        const mockMessages = {
          messages: [{ id: 'msg-1', role: 'user', content: 'Hello', createdAt: mockDate }],
          hasMore: false,
          nextCursor: null,
        };
        vi.mocked(getActiveMessages).mockResolvedValueOnce(mockMessages as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123/messages');

        const response = await GET(request, mockParams);
        const { data } = await parseResponse(response);

        expect(data.data.messages[0].createdAt).toBe('2024-01-15T12:00:00.000Z');
      });

      it('returns 404 when chat not found', async () => {
        vi.mocked(getChat).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/nonexistent/messages');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Chat not found');
        expect(getActiveMessages).not.toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChat).mockResolvedValueOnce({ id: 'chat-123' } as never);
        vi.mocked(getActiveMessages).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123/messages');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to get messages');
      });
    });
  });

  describe('POST /api/v2/chats/[chatId]/messages', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { role: 'user', content: 'Hello' },
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { role: 'user', content: 'Hello' },
          token: 'invalid-token',
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Invalid token');
      });
    });

    describe('Validation', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChat).mockResolvedValue({
          id: 'chat-123',
        } as never);
      });

      it('returns 400 when role is missing', async () => {
        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { content: 'Hello' },
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('role and content are required');
      });

      it('returns 400 when content is missing', async () => {
        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { role: 'user' },
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('role and content are required');
      });

      it('returns 404 when chat not found', async () => {
        vi.mocked(getChat).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats/nonexistent/messages', {
          body: { role: 'user', content: 'Hello' },
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Chat not found');
        expect(addMessage).not.toHaveBeenCalled();
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChat).mockResolvedValue({
          id: 'chat-123',
        } as never);
      });

      it('creates user message', async () => {
        const newMessage = {
          id: 'new-msg-1',
          role: 'user',
          content: 'Hello',
          audioUrl: null,
          createdAt: mockDate,
        };
        vi.mocked(addMessage).mockResolvedValueOnce(newMessage as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { role: 'user', content: 'Hello' },
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty('message');
        expect(data.data.message.id).toBe('new-msg-1');
        expect(data.data.message.role).toBe('user');
        expect(data.data.message.content).toBe('Hello');
      });

      it('creates assistant message', async () => {
        const newMessage = {
          id: 'new-msg-2',
          role: 'assistant',
          content: 'Hi there!',
          audioUrl: 'https://example.com/audio.mp3',
          createdAt: mockDate,
        };
        vi.mocked(addMessage).mockResolvedValueOnce(newMessage as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: {
            role: 'assistant',
            content: 'Hi there!',
            audioUrl: 'https://example.com/audio.mp3',
          },
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.data.message.role).toBe('assistant');
        expect(data.data.message.audioUrl).toBe('https://example.com/audio.mp3');
      });

      it('passes audioUrl as null when not provided', async () => {
        vi.mocked(addMessage).mockResolvedValueOnce({
          id: 'new-msg-1',
          role: 'user',
          content: 'Hello',
          audioUrl: null,
          createdAt: mockDate,
        } as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { role: 'user', content: 'Hello' },
        });

        await POST(request, mockParams);

        expect(addMessage).toHaveBeenCalledWith(
          'test-user-123',
          'chat-123',
          expect.objectContaining({
            audioUrl: null,
          })
        );
      });

      it('converts createdAt to ISO string in response', async () => {
        vi.mocked(addMessage).mockResolvedValueOnce({
          id: 'new-msg-1',
          role: 'user',
          content: 'Hello',
          createdAt: mockDate,
        } as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { role: 'user', content: 'Hello' },
        });

        const response = await POST(request, mockParams);
        const { data } = await parseResponse(response);

        expect(data.data.message.createdAt).toBe('2024-01-15T12:00:00.000Z');
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChat).mockResolvedValueOnce({ id: 'chat-123' } as never);
        vi.mocked(addMessage).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('POST', '/api/v2/chats/chat-123/messages', {
          body: { role: 'user', content: 'Hello' },
        });

        const response = await POST(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to add message');
      });
    });
  });
});
