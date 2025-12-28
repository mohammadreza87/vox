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
  getActiveChats: vi.fn(),
  getChatsUpdatedSince: vi.fn(),
  createChat: vi.fn(),
  getChatByContactId: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
const { GET, POST } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { getActiveChats, getChatsUpdatedSince, createChat, getChatByContactId } = await import(
  '@/lib/firestore-v2'
);

describe('/api/v2/chats', () => {
  const mockDate = new Date('2024-01-15T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v2/chats', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('GET', '/api/v2/chats');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats', {
          token: 'invalid-token',
        });

        const response = await GET(request);
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

      it('returns all chats for user', async () => {
        const mockChats = [
          {
            id: 'chat-1',
            contactId: 'contact-1',
            contactName: 'John',
            lastMessage: 'Hello',
            lastMessageAt: mockDate,
            createdAt: mockDate,
            updatedAt: mockDate,
            messageCount: 5,
          },
          {
            id: 'chat-2',
            contactId: 'contact-2',
            contactName: 'Jane',
            lastMessage: 'Hi',
            lastMessageAt: mockDate,
            createdAt: mockDate,
            updatedAt: mockDate,
            messageCount: 3,
          },
        ];
        vi.mocked(getActiveChats).mockResolvedValueOnce(mockChats as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty('chats');
        expect(data.data.chats).toHaveLength(2);
        expect(data.data.chats[0].contactName).toBe('John');
        expect(data.data).toHaveProperty('syncedAt');
      });

      it('returns empty array when user has no chats', async () => {
        vi.mocked(getActiveChats).mockResolvedValueOnce([]);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.data.chats).toEqual([]);
      });

      it('uses getChatsUpdatedSince when since parameter is provided', async () => {
        vi.mocked(getChatsUpdatedSince).mockResolvedValueOnce([]);

        const request = createAuthenticatedRequest(
          'GET',
          '/api/v2/chats?since=2024-01-14T00:00:00.000Z'
        );

        await GET(request);

        expect(getChatsUpdatedSince).toHaveBeenCalledWith(
          'test-user-123',
          new Date('2024-01-14T00:00:00.000Z')
        );
        expect(getActiveChats).not.toHaveBeenCalled();
      });

      it('converts dates to ISO strings', async () => {
        const mockChats = [
          {
            id: 'chat-1',
            contactId: 'contact-1',
            contactName: 'John',
            lastMessage: 'Hello',
            lastMessageAt: mockDate,
            createdAt: mockDate,
            updatedAt: mockDate,
            messageCount: 1,
          },
        ];
        vi.mocked(getActiveChats).mockResolvedValueOnce(mockChats as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/chats');

        const response = await GET(request);
        const { data } = await parseResponse(response);

        expect(data.data.chats[0].lastMessageAt).toBe('2024-01-15T12:00:00.000Z');
        expect(data.data.chats[0].createdAt).toBe('2024-01-15T12:00:00.000Z');
        expect(data.data.chats[0].updatedAt).toBe('2024-01-15T12:00:00.000Z');
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getActiveChats).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('GET', '/api/v2/chats');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to get chats');
      });
    });
  });

  describe('POST /api/v2/chats', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('POST', '/api/v2/chats', {
          body: { contactId: 'contact-1', contactName: 'John' },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats', {
          body: { contactId: 'contact-1', contactName: 'John' },
          token: 'invalid-token',
        });

        const response = await POST(request);
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
      });

      it('returns 400 when contactId is missing', async () => {
        const request = createAuthenticatedRequest('POST', '/api/v2/chats', {
          body: { contactName: 'John' },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('contactId and contactName are required');
      });

      it('returns 400 when contactName is missing', async () => {
        const request = createAuthenticatedRequest('POST', '/api/v2/chats', {
          body: { contactId: 'contact-1' },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('contactId and contactName are required');
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
        } as never);
      });

      it('returns existing chat if contact already has a chat', async () => {
        const existingChat = {
          id: 'chat-1',
          contactId: 'contact-1',
          contactName: 'John',
          lastMessage: 'Hello',
          lastMessageAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate,
          messageCount: 5,
        };
        vi.mocked(getChatByContactId).mockResolvedValueOnce(existingChat as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats', {
          body: { contactId: 'contact-1', contactName: 'John' },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty('isExisting', true);
        expect(data.data.chat.id).toBe('chat-1');
        expect(createChat).not.toHaveBeenCalled();
      });

      it('creates new chat when contact has no existing chat', async () => {
        vi.mocked(getChatByContactId).mockResolvedValueOnce(null as never);
        const newChat = {
          id: 'new-chat-1',
          contactId: 'contact-1',
          contactName: 'John',
          contactEmoji: '👤',
          lastMessage: '',
          lastMessageAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate,
          messageCount: 0,
        };
        vi.mocked(createChat).mockResolvedValueOnce(newChat as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats', {
          body: {
            contactId: 'contact-1',
            contactName: 'John',
            contactEmoji: '👤',
          },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty('isExisting', false);
        expect(data.data.chat.id).toBe('new-chat-1');
        expect(data.data.chat.contactEmoji).toBe('👤');
      });

      it('passes all optional fields to createChat', async () => {
        vi.mocked(getChatByContactId).mockResolvedValueOnce(null as never);
        vi.mocked(createChat).mockResolvedValueOnce({
          id: 'new-chat-1',
          lastMessageAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate,
        } as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/chats', {
          body: {
            contactId: 'contact-1',
            contactName: 'John',
            contactEmoji: '👤',
            contactImage: 'https://example.com/photo.jpg',
            contactPurpose: 'Friend',
          },
        });

        await POST(request);

        expect(createChat).toHaveBeenCalledWith(
          'test-user-123',
          expect.objectContaining({
            contactId: 'contact-1',
            contactName: 'John',
            contactEmoji: '👤',
            contactImage: 'https://example.com/photo.jpg',
            contactPurpose: 'Friend',
          })
        );
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChatByContactId).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('POST', '/api/v2/chats', {
          body: { contactId: 'contact-1', contactName: 'John' },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to create chat');
      });
    });
  });
});
