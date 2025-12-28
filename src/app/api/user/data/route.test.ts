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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/cache', () => ({
  withCache: vi.fn((key: string, fn: () => Promise<unknown>) => fn()),
  cacheKeys: {
    userPreferences: (userId: string) => `user:${userId}:preferences`,
  },
  CACHE_TTL: {
    USER_PREFERENCES: 600,
  },
  cacheDelete: vi.fn(),
}));

// Import after mocks
const { GET, POST } = await import('./route');
const { verifyIdToken, getAdminDb } = await import('@/lib/firebase-admin');

describe('/api/user/data', () => {
  const mockDb = {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn(),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminDb).mockResolvedValue(mockDb as never);
    mockDb.collection.mockReturnThis();
    mockDb.doc.mockReturnThis();
  });

  describe('GET /api/user/data', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('GET', '/api/user/data');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('GET', '/api/user/data', {
          token: 'invalid-token',
        });

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Invalid token');
      });

      it('verifies token from Authorization header', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
          email: 'test@example.com',
        } as never);
        mockDb.get.mockResolvedValueOnce({ exists: false });

        const request = createAuthenticatedRequest('GET', '/api/user/data', {
          token: 'valid-token',
        });

        await GET(request);

        expect(verifyIdToken).toHaveBeenCalledWith('valid-token');
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        vi.mocked(verifyIdToken).mockResolvedValue({
          uid: 'test-user-123',
          email: 'test@example.com',
        } as never);
      });

      it('returns default data when user document does not exist', async () => {
        mockDb.get.mockResolvedValueOnce({ exists: false });

        const request = createAuthenticatedRequest('GET', '/api/user/data');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({
          chats: [],
          customContacts: [],
          preferences: { theme: 'light' },
        });
      });

      it('returns user data when document exists', async () => {
        const userData = {
          chats: [
            {
              id: 'chat-1',
              title: 'Test Chat',
              lastMessageAt: '2024-01-01T00:00:00.000Z',
              messages: [
                { id: 'msg-1', content: 'Hello', createdAt: '2024-01-01T00:00:00.000Z' },
              ],
            },
          ],
          customContacts: [{ id: 'contact-1', name: 'John' }],
          preferences: { theme: 'dark' },
        };

        mockDb.get.mockResolvedValueOnce({
          exists: true,
          data: () => userData,
        });

        const request = createAuthenticatedRequest('GET', '/api/user/data');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.chats).toHaveLength(1);
        expect(data.data.chats[0].title).toBe('Test Chat');
        expect(data.data.customContacts).toHaveLength(1);
        expect(data.data.preferences.theme).toBe('dark');
      });

      it('converts Firestore timestamps to ISO strings', async () => {
        const mockDate = new Date('2024-01-15T12:00:00.000Z');
        const userData = {
          chats: [
            {
              id: 'chat-1',
              title: 'Test Chat',
              lastMessageAt: mockDate,
              messages: [{ id: 'msg-1', content: 'Hello', createdAt: mockDate }],
            },
          ],
        };

        mockDb.get.mockResolvedValueOnce({
          exists: true,
          data: () => userData,
        });

        const request = createAuthenticatedRequest('GET', '/api/user/data');

        const response = await GET(request);
        const { data } = await parseResponse(response);

        expect(data.data.chats[0].lastMessageAt).toBe('2024-01-15T12:00:00.000Z');
        expect(data.data.chats[0].messages[0].createdAt).toBe('2024-01-15T12:00:00.000Z');
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        vi.mocked(getAdminDb).mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('GET', '/api/user/data');

        const response = await GET(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to load data');
      });
    });
  });

  describe('POST /api/user/data', () => {
    describe('Authentication', () => {
      it('returns 401 when no authorization header', async () => {
        const request = createMockRequest('POST', '/api/user/data', {
          body: { chats: [] },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Authentication required');
      });

      it('returns 401 when token is invalid', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body: { chats: [] },
          token: 'invalid-token',
        });

        const response = await POST(request);
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
          email: 'test@example.com',
        } as never);
        mockDb.set.mockResolvedValue(undefined);
      });

      it('saves chats to Firestore', async () => {
        const chats = [{ id: 'chat-1', title: 'Test Chat', messages: [] }];

        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body: { chats },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({ saved: true });
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({ chats }),
          { merge: true }
        );
      });

      it('saves customContacts to Firestore', async () => {
        const customContacts = [{ id: 'contact-1', name: 'John Doe' }];

        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body: { customContacts },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({ saved: true });
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({ customContacts }),
          { merge: true }
        );
      });

      it('saves preferences to Firestore', async () => {
        const preferences = { theme: 'dark', language: 'es' };

        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body: { preferences },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({ saved: true });
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({ preferences }),
          { merge: true }
        );
      });

      it('saves multiple fields at once', async () => {
        const body = {
          chats: [{ id: 'chat-1', title: 'Test' }],
          customContacts: [{ id: 'contact-1', name: 'John' }],
          preferences: { theme: 'dark' },
        };

        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body,
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({ saved: true });
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({
            chats: body.chats,
            customContacts: body.customContacts,
            preferences: body.preferences,
          }),
          { merge: true }
        );
      });

      it('updates customContactsCount in user document', async () => {
        const customContacts = [
          { id: 'contact-1', name: 'John' },
          { id: 'contact-2', name: 'Jane' },
        ];

        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body: { customContacts },
        });

        await POST(request);

        // Should update the user document with contact count
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({
            usage: { customContactsCount: 2 },
          }),
          { merge: true }
        );
      });

      it('handles empty body gracefully', async () => {
        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body: {},
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data).toEqual({ saved: true });
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on Firestore error', async () => {
        vi.mocked(verifyIdToken).mockResolvedValueOnce({
          uid: 'test-user-123',
        } as never);
        mockDb.set.mockRejectedValueOnce(new Error('Firestore error'));

        const request = createAuthenticatedRequest('POST', '/api/user/data', {
          body: { chats: [] },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error.message).toBe('Failed to save data');
      });
    });
  });
});
