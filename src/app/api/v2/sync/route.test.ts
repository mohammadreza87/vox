import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthenticatedRequest, createMockRequest, parseResponse } from '@/test/utils';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(),
  extractBearerToken: vi.fn((header: string | null) => {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }),
  getAdminDb: vi.fn(),
}));

vi.mock('@/lib/firestore-v2', () => ({
  getChats: vi.fn(),
  createChat: vi.fn(),
  updateChat: vi.fn(),
  deleteChat: vi.fn(),
  addMessage: vi.fn(),
  getAllMessages: vi.fn(),
  getChatByContactId: vi.fn(),
}));

// Import after mocks
const { GET, POST } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { getChats, createChat, deleteChat, addMessage, getAllMessages, getChatByContactId } =
  await import('@/lib/firestore-v2');

describe('/api/v2/sync', () => {
  const mockDate = new Date('2024-01-15T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v2/sync', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('GET', '/api/v2/sync');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data).toHaveProperty('error', 'Unauthorized');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/sync', {
          token: 'invalid-token',
        });

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data).toHaveProperty('error', 'Invalid token');
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
        } as never);
      });

      it('returns all chats with messages', async () => {
        const mockChats = [
          {
            id: 'chat-1',
            contactId: 'contact-1',
            contactName: 'John',
            lastMessageAt: mockDate,
            createdAt: mockDate,
            updatedAt: mockDate,
          },
        ];
        const mockMessages = [
          { id: 'msg-1', role: 'user', content: 'Hello', createdAt: mockDate },
        ];

        vi.mocked(getChats).mockResolvedValueOnce(mockChats as never);
        vi.mocked(getAllMessages).mockResolvedValueOnce(mockMessages as never);

        const request = createAuthenticatedRequest('GET', '/api/v2/sync');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toHaveProperty('chats');
        expect(data.chats).toHaveLength(1);
        expect(data.chats[0]).toHaveProperty('messages');
        expect(data.chats[0].messages).toHaveLength(1);
        expect(data).toHaveProperty('syncedAt');
      });

      it('returns empty array when no chats', async () => {
        vi.mocked(getChats).mockResolvedValueOnce([]);

        const request = createAuthenticatedRequest('GET', '/api/v2/sync');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.chats).toEqual([]);
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChats).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('GET', '/api/v2/sync');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'Failed to fetch data');
      });
    });
  });

  describe('POST /api/v2/sync', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('POST', '/api/v2/sync', {
          body: {},
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data).toHaveProperty('error', 'Unauthorized');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/sync', {
          body: {},
          token: 'invalid-token',
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data).toHaveProperty('error', 'Invalid token');
      });
    });

    describe('Sync with local changes', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChats).mockResolvedValue([]);
        vi.mocked(getAllMessages).mockResolvedValue([]);
      });

      it('creates new chat from local data', async () => {
        vi.mocked(getChatByContactId).mockResolvedValueOnce(null as never);
        vi.mocked(createChat).mockResolvedValueOnce({
          id: 'new-chat-1',
          contactId: 'contact-1',
          lastMessageAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate,
        } as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/sync', {
          body: {
            localChats: [
              {
                id: 'local-chat-1',
                contactId: 'contact-1',
                contactName: 'John',
                contactEmoji: '👤',
                contactPurpose: 'Friend',
                lastMessage: 'Hello',
                lastMessageAt: '2024-01-15T12:00:00.000Z',
                messages: [],
              },
            ],
          },
        });

        await POST(request);

        expect(createChat).toHaveBeenCalledWith(
          'test-user-123',
          expect.objectContaining({
            contactId: 'contact-1',
            contactName: 'John',
          })
        );
      });

      it('deletes chat when marked as deleted', async () => {
        vi.mocked(getChatByContactId).mockResolvedValueOnce({
          id: 'existing-chat-1',
        } as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/sync', {
          body: {
            localChats: [
              {
                id: 'local-chat-1',
                contactId: 'contact-1',
                contactName: 'John',
                isDeleted: true,
              },
            ],
          },
        });

        await POST(request);

        expect(deleteChat).toHaveBeenCalledWith('test-user-123', 'existing-chat-1');
      });

      it('syncs messages to existing chat', async () => {
        vi.mocked(getChatByContactId).mockResolvedValueOnce({
          id: 'existing-chat-1',
        } as never);
        vi.mocked(getAllMessages).mockResolvedValueOnce([]);

        const request = createAuthenticatedRequest('POST', '/api/v2/sync', {
          body: {
            localChats: [
              {
                id: 'local-chat-1',
                contactId: 'contact-1',
                contactName: 'John',
                contactEmoji: '👤',
                contactPurpose: 'Friend',
                lastMessage: 'Hello',
                lastMessageAt: '2024-01-15T12:00:00.000Z',
                messages: [
                  {
                    id: 'msg-1',
                    role: 'user',
                    content: 'Hello',
                    audioUrl: null,
                    createdAt: '2024-01-15T12:00:00.000Z',
                  },
                ],
              },
            ],
          },
        });

        await POST(request);

        expect(addMessage).toHaveBeenCalledWith(
          'test-user-123',
          'existing-chat-1',
          expect.objectContaining({
            role: 'user',
            content: 'Hello',
          })
        );
      });

      it('deduplicates messages based on content and timestamp', async () => {
        vi.mocked(getChatByContactId).mockResolvedValueOnce({
          id: 'existing-chat-1',
        } as never);
        vi.mocked(getAllMessages).mockResolvedValueOnce([
          {
            id: 'existing-msg',
            content: 'Hello',
            createdAt: mockDate,
          },
        ] as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/sync', {
          body: {
            localChats: [
              {
                id: 'local-chat-1',
                contactId: 'contact-1',
                contactName: 'John',
                contactEmoji: '👤',
                contactPurpose: 'Friend',
                lastMessage: 'Hello',
                lastMessageAt: '2024-01-15T12:00:00.000Z',
                messages: [
                  {
                    id: 'msg-1',
                    role: 'user',
                    content: 'Hello',
                    audioUrl: null,
                    createdAt: '2024-01-15T12:00:00.000Z', // Same as existing
                  },
                ],
              },
            ],
          },
        });

        await POST(request);

        // Should not add duplicate message
        expect(addMessage).not.toHaveBeenCalled();
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
        } as never);
      });

      it('returns all server chats with messages after sync', async () => {
        const mockChats = [
          {
            id: 'chat-1',
            contactId: 'contact-1',
            contactName: 'John',
            lastMessageAt: mockDate,
            createdAt: mockDate,
            updatedAt: mockDate,
          },
        ];
        const mockMessages = [
          { id: 'msg-1', role: 'user', content: 'Hello', createdAt: mockDate },
        ];

        vi.mocked(getChats).mockResolvedValueOnce(mockChats as never);
        vi.mocked(getAllMessages).mockResolvedValueOnce(mockMessages as never);

        const request = createAuthenticatedRequest('POST', '/api/v2/sync', {
          body: {},
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toHaveProperty('chats');
        expect(data).toHaveProperty('syncedAt');
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getChats).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('POST', '/api/v2/sync', {
          body: {},
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'Failed to sync');
      });
    });
  });
});
