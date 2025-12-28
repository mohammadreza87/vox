import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  getAdminDb: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({
  createSessionToken: vi.fn().mockResolvedValue('mock-session-token'),
}));

// Set environment variables
vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
vi.stubEnv('NEXT_PUBLIC_TELEGRAM_BOT_USERNAME', 'test_bot');

// Import after mocks
const { POST, GET } = await import('./route');
const { getAdminDb } = await import('@/lib/firebase-admin');
const { createSessionToken } = await import('@/lib/auth/jwt');

describe('/api/auth/telegram', () => {
  const mockDb = {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminDb).mockResolvedValue(mockDb as never);
    mockDb.get.mockResolvedValue({ exists: false });
    mockDb.set.mockResolvedValue(undefined);
    mockDb.collection.mockReturnThis();
    mockDb.doc.mockReturnThis();
  });

  const createRequest = (body: object) => {
    return new Request('http://localhost:3000/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  // Helper to create valid Mini App init data
  const createValidMiniAppData = (user: object) => {
    const botToken = 'test-bot-token';
    const authDate = Math.floor(Date.now() / 1000);
    const userJson = JSON.stringify(user);

    const params = new URLSearchParams();
    params.set('user', userJson);
    params.set('auth_date', authDate.toString());
    params.set('query_id', 'test-query-id');

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const hash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    params.set('hash', hash);
    return params.toString();
  };

  // Helper to create valid Login Widget user data
  const createValidWidgetUser = (userData: object) => {
    const botToken = 'test-bot-token';
    const authDate = Math.floor(Date.now() / 1000);

    const user = {
      id: 123456789,
      first_name: 'Test',
      auth_date: authDate,
      ...userData,
    };

    const { id, first_name, last_name, username, photo_url, auth_date } = user as Record<string, unknown>;
    const dataCheckObj: Record<string, unknown> = {
      id,
      first_name,
      auth_date,
    };
    if (last_name) dataCheckObj.last_name = last_name;
    if (username) dataCheckObj.username = username;
    if (photo_url) dataCheckObj.photo_url = photo_url;

    const dataCheckString = Object.entries(dataCheckObj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHash('sha256')
      .update(botToken)
      .digest();

    const hash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return { ...user, hash };
  };

  describe('GET /api/auth/telegram', () => {
    it('returns enabled status and bot username', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('enabled', true);
      expect(data).toHaveProperty('botUsername', 'test_bot');
    });

    it('returns disabled when bot token not configured', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
      vi.resetModules();

      const { GET: freshGET } = await import('./route');
      const response = await freshGET();
      const data = await response.json();

      expect(data).toHaveProperty('enabled', false);

      // Restore
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
    });
  });

  describe('POST /api/auth/telegram - Validation', () => {
    it('returns 400 when neither initData nor user is provided', async () => {
      const request = createRequest({});

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Missing initData or user object');
    });

    it('returns 401 for invalid Mini App init data', async () => {
      const request = createRequest({ initData: 'invalid-data' });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toHaveProperty('error', 'Invalid or expired Telegram Mini App data');
    });

    it('returns 401 for invalid Login Widget data', async () => {
      const request = createRequest({
        user: {
          id: 123456789,
          first_name: 'Test',
          auth_date: Math.floor(Date.now() / 1000),
          hash: 'invalid-hash',
        },
      });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toHaveProperty('error', 'Invalid or expired Telegram login data');
    });

    it('returns 401 for expired Mini App data', async () => {
      const botToken = 'test-bot-token';
      const expiredAuthDate = Math.floor(Date.now() / 1000) - 86401; // More than 24 hours ago
      const user = { id: 123456789, first_name: 'Test' };
      const userJson = JSON.stringify(user);

      const params = new URLSearchParams();
      params.set('user', userJson);
      params.set('auth_date', expiredAuthDate.toString());

      const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();

      const hash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      params.set('hash', hash);

      const request = createRequest({ initData: params.toString() });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toHaveProperty('error', 'Invalid or expired Telegram Mini App data');
    });
  });

  describe('POST /api/auth/telegram - Mini App Auth', () => {
    it('authenticates new user via Mini App', async () => {
      const user = {
        id: 123456789,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
        language_code: 'en',
        is_premium: true,
      };
      const initData = createValidMiniAppData(user);
      const request = createRequest({ initData });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('source', 'miniapp');
      expect(data).toHaveProperty('isNewUser', true);
      expect(data).toHaveProperty('sessionToken', 'mock-session-token');
      expect(data.user).toMatchObject({
        telegramId: 123456789,
        firstName: 'Test',
        lastName: 'User',
        username: 'testuser',
      });
    });

    it('authenticates existing user via Mini App', async () => {
      mockDb.get.mockResolvedValue({ exists: true });

      const user = {
        id: 123456789,
        first_name: 'Test',
        username: 'testuser',
      };
      const initData = createValidMiniAppData(user);
      const request = createRequest({ initData });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('isNewUser', false);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('creates session token with correct parameters', async () => {
      const user = {
        id: 123456789,
        first_name: 'Test',
      };
      const initData = createValidMiniAppData(user);
      const request = createRequest({ initData });

      await POST(request as never);

      expect(createSessionToken).toHaveBeenCalledWith({
        userId: 'telegram_123456789',
        telegramId: 123456789,
        platform: 'telegram_miniapp',
        expiresIn: 604800, // 7 days
      });
    });
  });

  describe('POST /api/auth/telegram - Login Widget Auth', () => {
    it('authenticates new user via Login Widget', async () => {
      const user = createValidWidgetUser({
        last_name: 'User',
        username: 'testuser',
        photo_url: 'https://t.me/photo.jpg',
      });
      const request = createRequest({ user });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('source', 'widget');
      expect(data).toHaveProperty('isNewUser', true);
      expect(data).toHaveProperty('sessionToken', 'mock-session-token');
      expect(data.user).toHaveProperty('photoUrl', 'https://t.me/photo.jpg');
    });

    it('creates session token with widget platform', async () => {
      const user = createValidWidgetUser({});
      const request = createRequest({ user });

      await POST(request as never);

      expect(createSessionToken).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'telegram_widget',
        })
      );
    });
  });

  describe('POST /api/auth/telegram - User Creation', () => {
    it('initializes settings document for new users', async () => {
      const user = {
        id: 123456789,
        first_name: 'Test',
        language_code: 'es',
      };
      const initData = createValidMiniAppData(user);
      const request = createRequest({ initData });

      await POST(request as never);

      // Verify settings document was created
      expect(mockDb.collection).toHaveBeenCalledWith('users');
      expect(mockDb.doc).toHaveBeenCalledWith('telegram_123456789');
      expect(mockDb.collection).toHaveBeenCalledWith('data');
      expect(mockDb.doc).toHaveBeenCalledWith('settings');
    });

    it('initializes subscription document for new users', async () => {
      const user = {
        id: 123456789,
        first_name: 'Test',
      };
      const initData = createValidMiniAppData(user);
      const request = createRequest({ initData });

      await POST(request as never);

      // Verify subscription document was created
      expect(mockDb.doc).toHaveBeenCalledWith('subscription');
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: 'free',
          messagesUsed: 0,
          voiceClonesUsed: 0,
          customContactsUsed: 0,
        })
      );
    });
  });

  describe('POST /api/auth/telegram - Error Handling', () => {
    it('returns 500 on Firestore error', async () => {
      vi.mocked(getAdminDb).mockRejectedValueOnce(new Error('Firestore error'));

      const user = {
        id: 123456789,
        first_name: 'Test',
      };
      const initData = createValidMiniAppData(user);
      const request = createRequest({ initData });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toHaveProperty('error', 'Firestore error');
    });

    it('returns 500 on session token creation error', async () => {
      vi.mocked(createSessionToken).mockRejectedValueOnce(new Error('JWT error'));

      const user = {
        id: 123456789,
        first_name: 'Test',
      };
      const initData = createValidMiniAppData(user);
      const request = createRequest({ initData });

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toHaveProperty('error', 'JWT error');
    });
  });
});
