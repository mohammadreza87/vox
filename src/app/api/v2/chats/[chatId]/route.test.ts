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
  getChat: vi.fn(),
  getChatWithMessages: vi.fn(),
  updateChat: vi.fn(),
  softDeleteChat: vi.fn(),
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
  logChatDeleted: vi.fn(),
}));

// Import after mocks
const { GET, PATCH, DELETE } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { getChat, getChatWithMessages, updateChat, softDeleteChat } = await import(
  '@/lib/firestore-v2'
);

describe('/api/v2/chats/[chatId]', () => {
  const mockDate = new Date('2024-01-15T12:00:00.000Z');
  const mockParams = { params: Promise.resolve({ chatId: 'chat-123' }) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v2/chats/[chatId]', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('GET', '/api/v2/chats/chat-123');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123', {
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
      });

      it('returns chat without messages by default', async () => {
        const mockChat = {
          id: 'chat-123',
          contactId: 'contact-1',
          contactName: 'John',
          lastMessage: 'Hello',
          lastMessageAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate,
          messageCount: 5,
        };
        vi.mocked(getChat).mockResolvedValueOnce(mockChat as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty('chat');
        expect(data.data.chat.id).toBe('chat-123');
        expect(data.data.chat).not.toHaveProperty('messages');
        expect(getChatWithMessages).not.toHaveBeenCalled();
      });

      it('returns chat with messages when messages=true', async () => {
        const mockChat = {
          id: 'chat-123',
          contactId: 'contact-1',
          contactName: 'John',
          lastMessage: 'Hello',
          lastMessageAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate,
          messageCount: 2,
          messages: [
            { id: 'msg-1', role: 'user', content: 'Hi', createdAt: mockDate },
            { id: 'msg-2', role: 'assistant', content: 'Hello!', createdAt: mockDate },
          ],
        };
        vi.mocked(getChatWithMessages).mockResolvedValueOnce(mockChat as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123?messages=true');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.chat).toHaveProperty('messages');
        expect(data.data.chat.messages).toHaveLength(2);
        expect(data.data.chat.messages[0].content).toBe('Hi');
        expect(getChat).not.toHaveBeenCalled();
      });

      it('returns 404 when chat not found', async () => {
        vi.mocked(getChat).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/nonexistent');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Chat not found');
      });

      it('returns 404 when chat with messages not found', async () => {
        vi.mocked(getChatWithMessages).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest(
          'GET',
          '/api/v2/chats/nonexistent?messages=true'
        );

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Chat not found');
      });

      it('converts dates to ISO strings', async () => {
        const mockChat = {
          id: 'chat-123',
          contactId: 'contact-1',
          contactName: 'John',
          lastMessageAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate,
        };
        vi.mocked(getChat).mockResolvedValueOnce(mockChat as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123');

        const response = await GET(request, mockParams);
        const { data } = await parseResponse(response);

        expect(data.data.chat.lastMessageAt).toBe('2024-01-15T12:00:00.000Z');
        expect(data.data.chat.createdAt).toBe('2024-01-15T12:00:00.000Z');
        expect(data.data.chat.updatedAt).toBe('2024-01-15T12:00:00.000Z');
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChat).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('GET', '/api/v2/chats/chat-123');

        const response = await GET(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to get chat');
      });
    });
  });

  describe('PATCH /api/v2/chats/[chatId]', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('PATCH', '/api/v2/chats/chat-123', {
          body: { contactName: 'Jane' },
        });

        const response = await PATCH(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('PATCH', '/api/v2/chats/chat-123', {
          body: { contactName: 'Jane' },
          token: 'invalid-token',
        });

        const response = await PATCH(request, mockParams);
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
        vi.mocked(updateChat).mockResolvedValue(undefined as never);
      });

      it('updates contactName', async () => {
        const request = createAuthenticatedRequest('PATCH', '/api/v2/chats/chat-123', {
          body: { contactName: 'Jane' },
        });

        const response = await PATCH(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({ updated: true });
        expect(updateChat).toHaveBeenCalledWith(
          'test-user-123',
          'chat-123',
          expect.objectContaining({ contactName: 'Jane' })
        );
      });

      it('updates multiple fields at once', async () => {
        const request = createAuthenticatedRequest('PATCH', '/api/v2/chats/chat-123', {
          body: {
            contactName: 'Jane',
            contactEmoji: '🎉',
            contactPurpose: 'Friend',
          },
        });

        await PATCH(request, mockParams);

        expect(updateChat).toHaveBeenCalledWith(
          'test-user-123',
          'chat-123',
          expect.objectContaining({
            contactName: 'Jane',
            contactEmoji: '🎉',
            contactPurpose: 'Friend',
          })
        );
      });

      it('ignores non-allowed fields', async () => {
        const request = createAuthenticatedRequest('PATCH', '/api/v2/chats/chat-123', {
          body: {
            contactName: 'Jane',
            id: 'new-id',
            messageCount: 100,
          },
        });

        await PATCH(request, mockParams);

        expect(updateChat).toHaveBeenCalledWith('test-user-123', 'chat-123', { contactName: 'Jane' });
      });

      it('returns 404 when chat not found', async () => {
        vi.mocked(getChat).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('PATCH', '/api/v2/chats/nonexistent', {
          body: { contactName: 'Jane' },
        });

        const response = await PATCH(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Chat not found');
        expect(updateChat).not.toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChat).mockResolvedValueOnce({ id: 'chat-123' } as never);
        vi.mocked(updateChat).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('PATCH', '/api/v2/chats/chat-123', {
          body: { contactName: 'Jane' },
        });

        const response = await PATCH(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to update chat');
      });
    });
  });

  describe('DELETE /api/v2/chats/[chatId]', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('DELETE', '/api/v2/chats/chat-123');

        const response = await DELETE(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('DELETE', '/api/v2/chats/chat-123', {
          token: 'invalid-token',
        });

        const response = await DELETE(request, mockParams);
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
        vi.mocked(softDeleteChat).mockResolvedValue(undefined as never);
      });

      it('soft deletes chat successfully', async () => {
        const request = createAuthenticatedRequest('DELETE', '/api/v2/chats/chat-123');

        const response = await DELETE(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({ deleted: true });
        expect(softDeleteChat).toHaveBeenCalledWith('test-user-123', 'chat-123');
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(softDeleteChat).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('DELETE', '/api/v2/chats/chat-123');

        const response = await DELETE(request, mockParams);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to delete chat');
      });
    });
  });
});
