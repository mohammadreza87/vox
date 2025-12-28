import { vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Test utilities for Vox
 * Provides mock factories and helper functions for testing
 */

// ============================================
// Mock Data Factories
// ============================================

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    uid: 'test-user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: null,
    emailVerified: true,
    ...overrides,
  };
}

export interface MockUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export function createMockTelegramUser(overrides: Partial<MockTelegramUser> = {}): MockTelegramUser {
  return {
    id: 123456789,
    first_name: 'Test',
    last_name: 'User',
    username: 'testuser',
    language_code: 'en',
    is_premium: false,
    ...overrides,
  };
}

export interface MockTelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export function createMockChat(overrides: Partial<MockChat> = {}): MockChat {
  return {
    id: `chat-${Date.now()}`,
    contactId: 'contact-123',
    title: 'Test Chat',
    lastMessageAt: new Date().toISOString(),
    messageCount: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export interface MockChat {
  id: string;
  contactId: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: 'Test message',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export interface MockMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  audioUrl?: string;
}

export function createMockSubscription(overrides: Partial<MockSubscription> = {}): MockSubscription {
  return {
    tier: 'free',
    messagesUsed: 0,
    messagesLimit: 50,
    voiceClonesUsed: 0,
    voiceClonesLimit: 0,
    ...overrides,
  };
}

export interface MockSubscription {
  tier: 'free' | 'pro' | 'premium';
  messagesUsed: number;
  messagesLimit: number;
  voiceClonesUsed: number;
  voiceClonesLimit: number;
}

// ============================================
// Request/Response Helpers
// ============================================

export function createMockRequest(
  method: string,
  url: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const { body, headers = {} } = options;

  const requestHeaders = new Headers(headers);

  const request = new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  return request;
}

export function createAuthenticatedRequest(
  method: string,
  url: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    token?: string;
  } = {}
): NextRequest {
  const { token = 'mock-valid-token', headers = {}, ...rest } = options;

  return createMockRequest(method, url, {
    ...rest,
    headers: {
      ...headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function parseResponse<T>(response: NextResponse): Promise<{
  status: number;
  data: T;
}> {
  const data = await response.json();
  return {
    status: response.status,
    data,
  };
}

// ============================================
// Firebase Admin Mocks
// ============================================

export function mockFirebaseAdmin() {
  const mockDb = {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    startAfter: vi.fn().mockReturnThis(),
  };

  const mockAuth = {
    verifyIdToken: vi.fn().mockResolvedValue({
      uid: 'test-user-123',
      email: 'test@example.com',
    }),
    createCustomToken: vi.fn().mockResolvedValue('mock-custom-token'),
  };

  return {
    getAdminDb: vi.fn().mockResolvedValue(mockDb),
    getAdminAuth: vi.fn().mockResolvedValue(mockAuth),
    verifyIdToken: vi.fn().mockResolvedValue({
      uid: 'test-user-123',
      email: 'test@example.com',
    }),
    extractBearerToken: vi.fn((header: string | null) => {
      if (!header?.startsWith('Bearer ')) return null;
      return header.slice(7);
    }),
    mockDb,
    mockAuth,
  };
}

// ============================================
// API Response Mocks
// ============================================

export function mockFetch(responses: Array<{
  url?: string | RegExp;
  method?: string;
  response: unknown;
  status?: number;
}>) {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method || 'GET';

    for (const mock of responses) {
      const urlMatch = mock.url
        ? typeof mock.url === 'string'
          ? url.includes(mock.url)
          : mock.url.test(url)
        : true;
      const methodMatch = mock.method ? method === mock.method : true;

      if (urlMatch && methodMatch) {
        return new Response(JSON.stringify(mock.response), {
          status: mock.status || 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Default response
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

// ============================================
// Zustand Store Helpers
// ============================================

export function resetAllStores() {
  // Import stores dynamically and reset them
  // This should be called in beforeEach to ensure clean state
  vi.resetModules();
}

// ============================================
// Wait Utilities
// ============================================

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await waitFor(interval);
  }
}

// ============================================
// Error Helpers
// ============================================

export function expectErrorResponse(
  response: { status: number; data: unknown },
  expectedStatus: number,
  expectedCode?: string
) {
  expect(response.status).toBe(expectedStatus);
  expect(response.data).toHaveProperty('error');
  if (expectedCode) {
    expect((response.data as { error: string; code?: string }).code).toBe(expectedCode);
  }
}

export function expectSuccessResponse<T>(
  response: { status: number; data: T },
  expectedStatus = 200
) {
  expect(response.status).toBe(expectedStatus);
  expect(response.data).toBeDefined();
}
