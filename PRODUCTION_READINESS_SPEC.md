# VOX Production Readiness Specification

> **Version:** 1.0
> **Date:** December 28, 2025
> **Status:** Draft
> **Author:** Code Review Assessment

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Security Improvements](#3-security-improvements)
4. [Testing Strategy](#4-testing-strategy)
5. [Observability & Monitoring](#5-observability--monitoring)
6. [API Layer Improvements](#6-api-layer-improvements)
7. [Database Layer Improvements](#7-database-layer-improvements)
8. [Infrastructure & DevOps](#8-infrastructure--devops)
9. [Performance Optimization](#9-performance-optimization)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Success Criteria](#11-success-criteria)
12. [Appendix](#12-appendix)

---

## 1. Executive Summary

### 1.1 Purpose

This specification outlines the required improvements to make the VOX application production-ready. VOX is a voice-first AI messenger with multi-provider AI integration, voice cloning, and real-time translation capabilities.

### 1.2 Current State

| Metric | Current | Target |
|--------|---------|--------|
| Test Coverage | ~2% | 70%+ |
| Security Score | 6/10 | 9/10 |
| Monitoring | Console logs only | Full observability |
| API Rate Limiting | 3/20 endpoints | 20/20 endpoints |
| Error Tracking | None | 100% coverage |

### 1.3 Estimated Timeline

| Phase | Duration | Focus Area |
|-------|----------|------------|
| Phase 1 | 2 weeks | Critical Security & Monitoring |
| Phase 2 | 3 weeks | Testing Infrastructure |
| Phase 3 | 2 weeks | Performance & Hardening |
| Phase 4 | 1 week | Final Audit & Launch Prep |

**Total: 8 weeks to production readiness**

---

## 2. Current State Analysis

### 2.1 Technology Stack

```
Frontend:
├── Next.js 16.0.10 (App Router)
├── React 19.2.0
├── TypeScript 5 (Strict Mode)
├── Tailwind CSS 4
├── Zustand 5 (State Management)
└── GSAP 3.13 (Animations)

Backend:
├── Next.js API Routes
├── Firebase Admin SDK 13.6
├── Upstash Redis (Rate Limiting)
└── Stripe 20.0 (Payments)

AI/Voice:
├── ElevenLabs (TTS, Voice Cloning)
├── Anthropic Claude (claude-sonnet-4)
├── OpenAI GPT-4o
├── Google Gemini 2.0 Flash
└── DeepSeek Chat/Reasoner
```

### 2.2 Codebase Metrics

| Metric | Value |
|--------|-------|
| TypeScript Files | 164 |
| API Routes | 20 |
| React Components | 60+ |
| Zustand Stores | 8 |
| Custom Hooks | 12 |
| Test Files | 3 |

### 2.3 Strengths

- **Type Safety:** Zero `any` types, strict TypeScript configuration
- **Input Validation:** Comprehensive Zod schemas for all inputs
- **Security:** Prompt injection detection, input sanitization
- **Architecture:** Clean feature-based organization
- **UI/UX:** Polished animations, streaming responses, loading states

### 2.4 Critical Gaps

| Gap | Risk Level | Impact |
|-----|------------|--------|
| No error tracking | Critical | Blind to production errors |
| 2% test coverage | Critical | High regression risk |
| Missing rate limits | High | DoS vulnerability |
| No structured logging | High | Difficult debugging |
| Insecure session tokens | High | Security vulnerability |

---

## 3. Security Improvements

### 3.1 Session Token Security

**Current Issue:**
```typescript
// src/app/api/auth/telegram/route.ts:216
// Session token is base64 encoded JSON - NOT cryptographically signed
const sessionToken = Buffer.from(JSON.stringify({
  oderId,
  oderId,
  oderId,
  oderId,
  ...
})).toString('base64');
```

**Required Implementation:**

```typescript
// src/lib/auth/jwt.ts
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const JWT_ISSUER = 'vox-app';
const JWT_AUDIENCE = 'vox-users';

export interface SessionPayload {
  oderId: string;
  oderId: string;
  oderId: string;
  oderId: string;
  platform: 'telegram' | 'web';
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
```

**Files to Update:**
- `src/app/api/auth/telegram/route.ts`
- Create `src/lib/auth/jwt.ts`
- Add `jose` package to dependencies

### 3.2 Rate Limiting Coverage

**Current Coverage:**

| Endpoint | Rate Limited |
|----------|--------------|
| `/api/chat` | ✅ 30/min |
| `/api/tts` | ✅ 30/min |
| `/api/translate` | ✅ 30/min |
| `/api/v2/chats/*` | ❌ None |
| `/api/v2/sync` | ❌ None |
| `/api/clone-voice` | ❌ None |
| `/api/user/*` | ❌ None |
| `/api/stripe/webhook` | ❌ None |

**Required Implementation:**

```typescript
// src/lib/ratelimit.ts - Add new limiters

export function getV2ApiRateLimiter() {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
    prefix: 'ratelimit:v2api',
  });
}

export function getVoiceCloneRateLimiter() {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'), // 5 clones per hour (expensive)
    prefix: 'ratelimit:voiceclone',
  });
}

export function getWebhookRateLimiter() {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    prefix: 'ratelimit:webhook',
  });
}

// CRITICAL: Fail-secure when Redis unavailable
export async function checkRateLimitSecure(
  limiter: Ratelimit | null,
  identifier: string,
  fallbackLimit: number = 10
): Promise<{ success: boolean; headers: Headers }> {
  if (!limiter) {
    // In-memory fallback with conservative limits
    return checkInMemoryRateLimit(identifier, fallbackLimit);
  }
  // ... existing implementation
}
```

**Files to Update:**
- `src/lib/ratelimit.ts` - Add new limiters and fail-secure logic
- `src/app/api/v2/chats/route.ts` - Add rate limiting
- `src/app/api/v2/chats/[chatId]/route.ts` - Add rate limiting
- `src/app/api/v2/chats/[chatId]/messages/route.ts` - Add rate limiting
- `src/app/api/v2/sync/route.ts` - Add rate limiting
- `src/app/api/clone-voice/route.ts` - Add rate limiting
- `src/app/api/user/data/route.ts` - Add rate limiting

### 3.3 Input Validation Gaps

**Missing Validation Locations:**

```typescript
// src/app/api/v2/chats/[chatId]/route.ts:93 - PATCH handler
// Current: Manual field picking without validation
const allowedFields = ['lastMessage', 'lastMessageAt', 'metadata'];
const updateData: Record<string, unknown> = {};
for (const field of allowedFields) {
  if (body[field] !== undefined) {
    updateData[field] = body[field]; // NO VALIDATION!
  }
}

// Required: Add Zod validation
import { updateChatRequestSchema } from '@/lib/validation/schemas';

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  // ... auth check ...

  const body = await request.json();
  const parseResult = updateChatRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return NextResponse.json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parseResult.error.issues,
    }, { status: 400 });
  }

  // Use validated data
  const validatedData = parseResult.data;
  // ... continue ...
}
```

**New Schemas to Add:**

```typescript
// src/lib/validation/schemas.ts

export const updateChatRequestSchema = z.object({
  lastMessage: z.string().max(1000).optional(),
  lastMessageAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const userDataRequestSchema = z.object({
  chats: z.array(chatSchema).max(1000).optional(),
  customContacts: z.array(customContactSchema).max(100).optional(),
  preferences: preferencesSchema.optional(),
});

export const syncRequestSchema = z.object({
  lastSyncTimestamp: z.string().datetime().optional(),
  chats: z.array(chatSchema).max(100).optional(),
  limit: z.number().min(1).max(100).default(50),
});
```

### 3.4 Security Headers

**Create Security Middleware:**

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Security Headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');

  // Content Security Policy
  response.headers.set('Content-Security-Policy', `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com;
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https: blob:;
    font-src 'self';
    connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://api.stripe.com https://api.elevenlabs.io wss://*.firebaseio.com;
    frame-src https://js.stripe.com;
    object-src 'none';
    base-uri 'self';
  `.replace(/\s+/g, ' ').trim());

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
```

### 3.5 Audit Logging

**Create Audit Logger:**

```typescript
// src/lib/audit/logger.ts
import { getAdminDb } from '@/lib/firebase-admin';

export type AuditAction =
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'CHAT_CREATED'
  | 'CHAT_DELETED'
  | 'CONTACT_CREATED'
  | 'CONTACT_DELETED'
  | 'VOICE_CLONED'
  | 'SUBSCRIPTION_CHANGED'
  | 'PAYMENT_COMPLETED'
  | 'DATA_EXPORTED'
  | 'DATA_DELETED';

export interface AuditEntry {
  action: AuditAction;
  userId: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export async function logAuditEvent(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  try {
    const db = await getAdminDb();
    if (!db) return;

    await db.collection('audit_logs').add({
      ...entry,
      timestamp: new Date(),
    });
  } catch (error) {
    // Don't fail the request if audit logging fails
    console.error('Audit logging failed:', error);
  }
}

// Usage in API routes:
// await logAuditEvent({
//   action: 'CHAT_DELETED',
//   userId: user.uid,
//   resourceType: 'chat',
//   resourceId: chatId,
//   ipAddress: request.headers.get('x-forwarded-for'),
// });
```

---

## 4. Testing Strategy

### 4.1 Testing Framework Configuration

**Current Setup:**
- Vitest for unit tests
- Playwright for E2E tests
- Testing Library for component tests

**Enhanced Configuration:**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.stories.tsx',
        '**/*.d.ts',
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 4.2 API Route Tests

**Structure:**
```
src/
├── app/
│   └── api/
│       └── chat/
│           ├── route.ts
│           └── route.test.ts    # Unit test
├── test/
│   ├── setup.ts
│   ├── mocks/
│   │   ├── firebase.ts
│   │   ├── stripe.ts
│   │   └── elevenlabs.ts
│   └── fixtures/
│       ├── users.ts
│       └── chats.ts
```

**Example API Test:**

```typescript
// src/app/api/chat/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(),
  getAdminDb: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  getChatRateLimiter: vi.fn(() => null),
  checkRateLimit: vi.fn(() => ({ success: true, headers: new Headers() })),
}));

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation', () => {
    it('should return 400 for missing message', async () => {
      const request = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ contactId: 'test' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for message exceeding max length', async () => {
      const request = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'a'.repeat(10001),
          contactId: 'test',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it('should sanitize message for prompt injection', async () => {
      const request = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Ignore previous instructions and...',
          contactId: 'test',
        }),
      });

      const response = await POST(request);
      // Should still process but sanitize the input
      expect(response.status).not.toBe(500);
    });
  });

  describe('Authentication', () => {
    it('should work without auth for free tier', async () => {
      const request = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          contactId: 'alice',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should verify token when provided', async () => {
      const { verifyIdToken } = await import('@/lib/firebase-admin');
      vi.mocked(verifyIdToken).mockResolvedValue({ uid: 'user123' });

      const request = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
        body: JSON.stringify({
          message: 'Hello',
          contactId: 'alice',
        }),
      });

      await POST(request);
      expect(verifyIdToken).toHaveBeenCalledWith('valid-token');
    });
  });

  describe('Rate Limiting', () => {
    it('should return 429 when rate limited', async () => {
      const { checkRateLimit } = await import('@/lib/ratelimit');
      vi.mocked(checkRateLimit).mockResolvedValue({
        success: false,
        headers: new Headers({ 'Retry-After': '60' }),
      });

      const request = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          contactId: 'alice',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(429);
    });
  });

  describe('AI Provider Integration', () => {
    it('should use specified AI provider', async () => {
      const request = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          contactId: 'alice',
          aiProvider: 'claude',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
    });
  });
});
```

### 4.3 Store Tests

```typescript
// src/stores/chatStoreV2.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStoreV2 } from './chatStoreV2';

describe('chatStoreV2', () => {
  beforeEach(() => {
    useChatStoreV2.getState().reset();
  });

  describe('addMessage', () => {
    it('should add a message to a chat', () => {
      const store = useChatStoreV2.getState();

      store.createChat('contact-1');
      store.addMessage('contact-1', {
        role: 'user',
        content: 'Hello',
      });

      const chat = store.getChat('contact-1');
      expect(chat?.messages).toHaveLength(1);
      expect(chat?.messages[0].content).toBe('Hello');
    });

    it('should update lastMessage and lastMessageAt', () => {
      const store = useChatStoreV2.getState();

      store.createChat('contact-1');
      store.addMessage('contact-1', {
        role: 'user',
        content: 'Hello world',
      });

      const chat = store.getChat('contact-1');
      expect(chat?.lastMessage).toBe('Hello world');
      expect(chat?.lastMessageAt).toBeDefined();
    });
  });

  describe('deleteChat', () => {
    it('should remove chat from store', () => {
      const store = useChatStoreV2.getState();

      store.createChat('contact-1');
      expect(store.getChat('contact-1')).toBeDefined();

      store.deleteChat('contact-1');
      expect(store.getChat('contact-1')).toBeUndefined();
    });
  });

  describe('persistence', () => {
    it('should persist to localStorage', () => {
      const store = useChatStoreV2.getState();
      store.createChat('contact-1');

      // Simulate page reload
      const persisted = localStorage.getItem('vox-chats-v2');
      expect(persisted).toBeDefined();
    });
  });
});
```

### 4.4 Hook Tests

```typescript
// src/hooks/useStreamingChat.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStreamingChat } from './useStreamingChat';

describe('useStreamingChat', () => {
  it('should handle streaming response', async () => {
    const mockStreamChat = vi.fn().mockImplementation((_, callbacks) => {
      setTimeout(() => callbacks.onChunk('Hello'), 10);
      setTimeout(() => callbacks.onChunk(' World'), 20);
      setTimeout(() => callbacks.onComplete('Hello World'), 30);
      return { abort: vi.fn() };
    });

    vi.mock('@/lib/api/stream-chat', () => ({
      streamChat: mockStreamChat,
    }));

    const { result } = renderHook(() => useStreamingChat());

    act(() => {
      result.current.sendMessage({
        message: 'Hi',
        contactId: 'alice',
      });
    });

    await waitFor(() => {
      expect(result.current.streamingText).toBe('Hello World');
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it('should abort on unmount', () => {
    const abortFn = vi.fn();
    vi.mock('@/lib/api/stream-chat', () => ({
      streamChat: () => ({ abort: abortFn }),
    }));

    const { unmount } = renderHook(() => useStreamingChat());
    unmount();

    expect(abortFn).toHaveBeenCalled();
  });
});
```

### 4.5 E2E Test Coverage

```typescript
// e2e/chat-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('auth-token', 'mock-token');
    });
  });

  test('should send and receive messages', async ({ page }) => {
    await page.goto('/chat/alice');

    // Type message
    await page.fill('[data-testid="chat-input"]', 'Hello Alice');
    await page.click('[data-testid="send-button"]');

    // Wait for response
    await expect(page.locator('[data-testid="message-assistant"]')).toBeVisible({
      timeout: 30000,
    });
  });

  test('should show loading state while streaming', async ({ page }) => {
    await page.goto('/chat/alice');

    await page.fill('[data-testid="chat-input"]', 'Hello');
    await page.click('[data-testid="send-button"]');

    // Should show streaming indicator
    await expect(page.locator('[data-testid="streaming-indicator"]')).toBeVisible();
  });

  test('should handle voice recording', async ({ page, context }) => {
    // Grant microphone permission
    await context.grantPermissions(['microphone']);

    await page.goto('/chat/alice');

    // Start recording
    await page.click('[data-testid="record-button"]');
    await expect(page.locator('[data-testid="recording-indicator"]')).toBeVisible();

    // Stop recording
    await page.click('[data-testid="record-button"]');
    await expect(page.locator('[data-testid="recording-indicator"]')).not.toBeVisible();
  });
});
```

### 4.6 Test Coverage Targets

| Area | Current | Target | Priority |
|------|---------|--------|----------|
| API Routes | 0% | 80% | Critical |
| Zustand Stores | 0% | 90% | Critical |
| Custom Hooks | 0% | 80% | High |
| Components | 5% | 60% | Medium |
| Utilities | 30% | 90% | High |
| E2E Flows | 10% | 70% | High |

---

## 5. Observability & Monitoring

### 5.1 Structured Logging

**Install Dependencies:**
```bash
npm install pino pino-pretty
```

**Logger Implementation:**

```typescript
// src/lib/logger/index.ts
import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  } : undefined,
  base: {
    env: process.env.NODE_ENV,
    version: process.env.npm_package_version,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
});

export function createRequestLogger(requestId: string, userId?: string) {
  return logger.child({
    requestId,
    userId,
  });
}

// Usage in API routes:
// const log = createRequestLogger(crypto.randomUUID(), user?.uid);
// log.info({ contactId, aiProvider }, 'Processing chat request');
// log.error({ error: err.message, stack: err.stack }, 'Chat request failed');
```

**Request Logging Middleware:**

```typescript
// src/lib/middleware/requestLogger.ts
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export function withRequestLogging<T>(
  handler: (request: NextRequest, context: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, context: T): Promise<NextResponse> => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    const log = logger.child({ requestId });

    log.info({
      method: request.method,
      path: request.nextUrl.pathname,
      query: Object.fromEntries(request.nextUrl.searchParams),
    }, 'Request started');

    try {
      const response = await handler(request, context);

      log.info({
        method: request.method,
        path: request.nextUrl.pathname,
        status: response.status,
        duration: Date.now() - startTime,
      }, 'Request completed');

      // Add request ID to response headers for tracing
      response.headers.set('X-Request-ID', requestId);

      return response;
    } catch (error) {
      log.error({
        method: request.method,
        path: request.nextUrl.pathname,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration: Date.now() - startTime,
      }, 'Request failed');

      throw error;
    }
  };
}
```

### 5.2 Error Tracking (Sentry)

**Install Dependencies:**
```bash
npm install @sentry/nextjs
```

**Configuration:**

```typescript
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session replay for debugging
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Filter out non-actionable errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Network request failed',
    'Load failed',
  ],

  beforeSend(event, hint) {
    // Don't send errors in development
    if (process.env.NODE_ENV === 'development') {
      return null;
    }

    // Scrub sensitive data
    if (event.request?.headers) {
      delete event.request.headers['Authorization'];
      delete event.request.headers['Cookie'];
    }

    return event;
  },
});
```

```typescript
// sentry.server.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  integrations: [
    Sentry.prismaIntegration(), // If using Prisma
  ],
});
```

**Error Boundary Integration:**

```typescript
// src/components/ErrorBoundary.tsx
import * as Sentry from '@sentry/nextjs';

class ErrorBoundary extends Component<Props, State> {
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setContext('componentStack', {
        componentStack: errorInfo.componentStack,
      });
      Sentry.captureException(error);
    });

    this.props.onError?.(error, errorInfo);
  }

  // ... rest of implementation
}
```

### 5.3 Health Check Endpoint

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    firebase: 'ok' | 'error';
    redis: 'ok' | 'error' | 'not_configured';
    stripe: 'ok' | 'error';
  };
  latency: {
    firebase?: number;
    redis?: number;
  };
}

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const startTime = Date.now();
  const checks: HealthStatus['checks'] = {
    firebase: 'error',
    redis: 'not_configured',
    stripe: 'error',
  };
  const latency: HealthStatus['latency'] = {};

  // Check Firebase
  try {
    const firebaseStart = Date.now();
    const db = await getAdminDb();
    if (db) {
      await db.collection('_health').doc('ping').get();
      checks.firebase = 'ok';
      latency.firebase = Date.now() - firebaseStart;
    }
  } catch {
    checks.firebase = 'error';
  }

  // Check Redis
  try {
    if (process.env.UPSTASH_REDIS_REST_URL) {
      const redisStart = Date.now();
      const response = await fetch(
        `${process.env.UPSTASH_REDIS_REST_URL}/ping`,
        {
          headers: {
            Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
          },
        }
      );
      checks.redis = response.ok ? 'ok' : 'error';
      latency.redis = Date.now() - redisStart;
    }
  } catch {
    checks.redis = 'error';
  }

  // Check Stripe
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      await stripe.balance.retrieve();
      checks.stripe = 'ok';
    }
  } catch {
    checks.stripe = 'error';
  }

  // Determine overall status
  const criticalChecks = [checks.firebase];
  const status: HealthStatus['status'] =
    criticalChecks.every(c => c === 'ok') ? 'healthy' :
    criticalChecks.some(c => c === 'ok') ? 'degraded' : 'unhealthy';

  const health: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.0.0',
    checks,
    latency,
  };

  return NextResponse.json(health, {
    status: status === 'unhealthy' ? 503 : 200,
  });
}
```

### 5.4 Performance Monitoring

```typescript
// src/lib/monitoring/performance.ts
import * as Sentry from '@sentry/nextjs';

export function measureApiLatency(name: string) {
  const transaction = Sentry.startTransaction({
    name,
    op: 'api',
  });

  return {
    addData: (data: Record<string, unknown>) => {
      transaction.setData('metadata', data);
    },
    finish: (status: 'ok' | 'error' = 'ok') => {
      transaction.setStatus(status);
      transaction.finish();
    },
  };
}

// Usage:
// const perf = measureApiLatency('POST /api/chat');
// perf.addData({ aiProvider: 'claude', messageLength: message.length });
// // ... do work ...
// perf.finish('ok');
```

### 5.5 Metrics Dashboard

**Key Metrics to Track:**

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| Request latency (p50, p95, p99) | API response times | p95 > 2s |
| Error rate | % of 5xx responses | > 1% |
| Rate limit hits | 429 responses | > 100/min |
| AI provider latency | Time to first token | > 5s |
| Voice cloning duration | Time to clone voice | > 60s |
| Database query latency | Firestore operations | > 500ms |
| Active users | Concurrent sessions | N/A |
| Message throughput | Messages per minute | N/A |

---

## 6. API Layer Improvements

### 6.1 Standardized Error Response Format

```typescript
// src/lib/api/response.ts
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'PAYMENT_REQUIRED';

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    pagination?: {
      total: number;
      page: number;
      pageSize: number;
      hasMore: boolean;
    };
  };
}

export function apiError(
  code: ErrorCode,
  message: string,
  status: number,
  details?: unknown,
  requestId?: string
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: { code, message, details, requestId },
    },
    { status }
  );
}

export function apiSuccess<T>(
  data: T,
  status: number = 200,
  meta?: ApiSuccessResponse<T>['meta']
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    { success: true, data, meta },
    { status }
  );
}

export function fromZodError(error: ZodError, requestId?: string): NextResponse<ApiErrorResponse> {
  return apiError(
    'VALIDATION_ERROR',
    'Request validation failed',
    400,
    error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
    requestId
  );
}

// HTTP Status Code mapping
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
```

### 6.2 HTTP Status Code Fixes

**Files to Update:**

```typescript
// src/app/api/v2/chats/route.ts
// Change: return NextResponse.json({ id, ...chatData });
// To:
return apiSuccess({ id, ...chatData }, HTTP_STATUS.CREATED);

// src/app/api/v2/chats/[chatId]/messages/route.ts
// Change: return NextResponse.json({ id: messageRef.id, ...messageData });
// To:
return apiSuccess({ id: messageRef.id, ...messageData }, HTTP_STATUS.CREATED);

// src/app/api/tts/route.ts
// Change: return NextResponse.json({ error: 'ElevenLabs API key not configured' });
// To:
return apiError(
  'SERVICE_UNAVAILABLE',
  'Text-to-speech service is not configured',
  HTTP_STATUS.SERVICE_UNAVAILABLE
);
```

### 6.3 API Versioning Strategy

```typescript
// src/app/api/v3/[...path]/route.ts
// Future API versioning approach

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const version = 'v3';
  const path = params.path.join('/');

  // Route to appropriate handler based on path
  // Maintain backwards compatibility with v2
}
```

**Versioning Headers:**
```typescript
// Add to all API responses
response.headers.set('X-API-Version', 'v2');
response.headers.set('X-Deprecation-Notice', 'v1 endpoints deprecated, use v2');
```

### 6.4 Request Timeout Handling

```typescript
// src/lib/api/timeout.ts
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Request timeout'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

// Usage in AI calls:
const response = await withTimeout(
  generateAIResponse(message),
  30000, // 30 second timeout
  'AI response timeout'
);
```

---

## 7. Database Layer Improvements

### 7.1 Connection Retry Logic

```typescript
// src/lib/firebase-admin.ts
import { logger } from '@/lib/logger';

const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);
        logger.warn({
          operation: operationName,
          attempt,
          maxRetries: MAX_RETRIES,
          nextRetryIn: delay,
          error: lastError.message,
        }, 'Database operation failed, retrying');

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error({
    operation: operationName,
    error: lastError?.message,
  }, 'Database operation failed after all retries');

  throw lastError;
}

// Update verifyIdToken
export async function verifyIdToken(token: string): Promise<DecodedIdToken | null> {
  return withRetry(async () => {
    const auth = await getAdminAuth();
    if (!auth) return null;
    return auth.verifyIdToken(token);
  }, 'verifyIdToken');
}
```

### 7.2 Query Pagination

```typescript
// src/lib/firestore-v2.ts
export interface PaginationOptions {
  limit: number;
  cursor?: string;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
  total?: number;
}

export async function getChatsWithPagination(
  userId: string,
  options: PaginationOptions
): Promise<PaginatedResult<ChatDocument>> {
  const db = await getAdminDb();
  if (!db) return { items: [], hasMore: false };

  const { limit, cursor, orderBy = 'updatedAt', orderDirection = 'desc' } = options;

  let query = db
    .collection('users')
    .doc(userId)
    .collection('chats')
    .orderBy(orderBy, orderDirection)
    .limit(limit + 1); // Fetch one extra to check hasMore

  if (cursor) {
    const cursorDoc = await db
      .collection('users')
      .doc(userId)
      .collection('chats')
      .doc(cursor)
      .get();

    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const items = snapshot.docs.slice(0, limit).map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as ChatDocument[];

  const hasMore = snapshot.docs.length > limit;
  const nextCursor = hasMore ? items[items.length - 1].id : undefined;

  return { items, nextCursor, hasMore };
}
```

### 7.3 Sync Endpoint Pagination

```typescript
// src/app/api/v2/sync/route.ts
export async function POST(request: NextRequest) {
  // ... auth check ...

  const body = await request.json();
  const parseResult = syncRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return fromZodError(parseResult.error);
  }

  const { lastSyncTimestamp, limit = 50 } = parseResult.data;

  // IMPORTANT: Always limit the number of documents fetched
  const result = await getChatsUpdatedSince(
    user.uid,
    lastSyncTimestamp ? new Date(lastSyncTimestamp) : undefined,
    Math.min(limit, 100) // Hard cap at 100
  );

  return apiSuccess({
    chats: result.items,
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    syncTimestamp: new Date().toISOString(),
  });
}
```

### 7.4 Soft Delete Implementation

```typescript
// src/lib/firestore-v2.ts
export async function softDeleteChat(
  userId: string,
  chatId: string
): Promise<void> {
  const db = await getAdminDb();
  if (!db) throw new Error('Database not available');

  const chatRef = db
    .collection('users')
    .doc(userId)
    .collection('chats')
    .doc(chatId);

  await chatRef.update({
    deletedAt: new Date().toISOString(),
    deletedBy: userId,
    status: 'deleted',
  });

  // Log audit event
  await logAuditEvent({
    action: 'CHAT_DELETED',
    userId,
    resourceType: 'chat',
    resourceId: chatId,
  });
}

// Query to exclude soft-deleted items
export async function getActiveChats(userId: string): Promise<ChatDocument[]> {
  const db = await getAdminDb();
  if (!db) return [];

  const snapshot = await db
    .collection('users')
    .doc(userId)
    .collection('chats')
    .where('status', '!=', 'deleted')
    .orderBy('updatedAt', 'desc')
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as ChatDocument[];
}
```

### 7.5 Database Indexes

**Required Firestore Indexes:**

```json
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "chats",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "chats",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "messages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "audit_logs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

## 8. Infrastructure & DevOps

### 8.1 Environment Variable Validation

```typescript
// src/lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  // Required for all environments
  NODE_ENV: z.enum(['development', 'production', 'test']),

  // Firebase (required)
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),

  // AI Providers (at least one required)
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),

  // Voice (required for voice features)
  ELEVENLABS_API_KEY: z.string().optional(),

  // Payments (required for production)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // Rate limiting (recommended)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Monitoring (recommended for production)
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  // Security
  JWT_SECRET: z.string().min(32).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }

  // Warnings for recommended but optional vars
  if (!result.data.SENTRY_DSN && result.data.NODE_ENV === 'production') {
    console.warn('⚠️ SENTRY_DSN not configured - error tracking disabled');
  }

  if (!result.data.UPSTASH_REDIS_REST_URL) {
    console.warn('⚠️ Redis not configured - rate limiting disabled');
  }

  // Check at least one AI provider is configured
  const aiProviders = [
    result.data.GEMINI_API_KEY,
    result.data.ANTHROPIC_API_KEY,
    result.data.OPENAI_API_KEY,
    result.data.DEEPSEEK_API_KEY,
  ].filter(Boolean);

  if (aiProviders.length === 0) {
    throw new Error('At least one AI provider API key must be configured');
  }

  return result.data;
}

// Call at app startup
// src/app/layout.tsx or instrumentation.ts
export const env = validateEnv();
```

### 8.2 Graceful Shutdown

```typescript
// src/lib/shutdown.ts
import { logger } from '@/lib/logger';

type ShutdownHandler = () => Promise<void>;
const shutdownHandlers: ShutdownHandler[] = [];

export function registerShutdownHandler(handler: ShutdownHandler) {
  shutdownHandlers.push(handler);
}

export async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  // Stop accepting new requests (handled by platform)

  // Run all shutdown handlers
  for (const handler of shutdownHandlers) {
    try {
      await handler();
    } catch (error) {
      logger.error({ error }, 'Shutdown handler failed');
    }
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// Register signal handlers
if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
```

### 8.3 Docker Configuration

```dockerfile
# Dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED 1

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  vox:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### 8.4 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: build
          path: .next/

  deploy-staging:
    runs-on: ubuntu-latest
    needs: [build, e2e]
    if: github.ref == 'refs/heads/develop'
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: build
          path: .next/
      # Add deployment steps (Vercel, Firebase, etc.)

  deploy-production:
    runs-on: ubuntu-latest
    needs: [build, e2e]
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: build
          path: .next/
      # Add deployment steps
```

---

## 9. Performance Optimization

### 9.1 Caching Strategy

```typescript
// src/lib/cache/index.ts
import { Redis } from '@upstash/redis';

const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  return redis.get<T>(key);
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  if (!redis) return;
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
}

export async function cacheDelete(key: string): Promise<void> {
  if (!redis) return;
  await redis.del(key);
}

// Cache patterns
export const CACHE_KEYS = {
  userSubscription: (userId: string) => `sub:${userId}`,
  voiceList: () => 'voices:list',
  contactConfig: (contactId: string) => `contact:${contactId}`,
} as const;

export const CACHE_TTL = {
  subscription: 300, // 5 minutes
  voiceList: 3600,   // 1 hour
  contactConfig: 86400, // 24 hours
} as const;
```

### 9.2 Response Caching

```typescript
// src/app/api/voices/route.ts
import { cacheGet, cacheSet, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';

export async function GET() {
  // Try cache first
  const cached = await cacheGet<VoiceOption[]>(CACHE_KEYS.voiceList());
  if (cached) {
    return apiSuccess(cached, 200, { cached: true });
  }

  // Fetch from API
  const voices = await fetchVoicesFromElevenLabs();

  // Cache for next time
  await cacheSet(CACHE_KEYS.voiceList(), voices, CACHE_TTL.voiceList);

  return apiSuccess(voices);
}
```

### 9.3 Database Query Optimization

```typescript
// Optimize: Batch read operations
export async function getUserDataBatch(userId: string) {
  const db = await getAdminDb();
  if (!db) return null;

  const userRef = db.collection('users').doc(userId);

  // Batch read multiple documents in parallel
  const [profileDoc, subscriptionDoc, preferencesDoc] = await Promise.all([
    userRef.get(),
    userRef.collection('subscription').doc('current').get(),
    userRef.collection('preferences').doc('current').get(),
  ]);

  return {
    profile: profileDoc.data(),
    subscription: subscriptionDoc.data(),
    preferences: preferencesDoc.data(),
  };
}
```

### 9.4 Image Optimization

```typescript
// next.config.ts
const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400, // 24 hours
  },
};
```

---

## 10. Implementation Roadmap

### Phase 1: Critical Security & Monitoring (Weeks 1-2)

| Task | Priority | Effort | Owner |
|------|----------|--------|-------|
| Implement JWT session tokens | Critical | 4h | Backend |
| Add rate limiting to all endpoints | Critical | 4h | Backend |
| Set up Sentry error tracking | Critical | 2h | DevOps |
| Implement structured logging | Critical | 4h | Backend |
| Add security headers middleware | High | 2h | Backend |
| Create health check endpoint | High | 2h | Backend |
| Environment variable validation | High | 2h | Backend |

### Phase 2: Testing Infrastructure (Weeks 3-5)

| Task | Priority | Effort | Owner |
|------|----------|--------|-------|
| API route unit tests (20 routes) | Critical | 20h | Backend |
| Zustand store tests (8 stores) | Critical | 8h | Frontend |
| Custom hook tests (12 hooks) | High | 12h | Frontend |
| Integration tests (Firebase, Stripe) | High | 8h | Backend |
| E2E test expansion | Medium | 16h | QA |
| CI pipeline with coverage gates | High | 4h | DevOps |

### Phase 3: Performance & Hardening (Weeks 6-7)

| Task | Priority | Effort | Owner |
|------|----------|--------|-------|
| Implement caching layer | High | 8h | Backend |
| Database query optimization | High | 4h | Backend |
| Add pagination to all list endpoints | High | 4h | Backend |
| Implement soft delete | Medium | 4h | Backend |
| Add audit logging | Medium | 4h | Backend |
| Connection retry logic | Medium | 2h | Backend |

### Phase 4: Final Audit & Launch Prep (Week 8)

| Task | Priority | Effort | Owner |
|------|----------|--------|-------|
| Security audit | Critical | 8h | Security |
| Performance load testing | High | 4h | QA |
| Documentation update | Medium | 4h | All |
| Runbook creation | High | 4h | DevOps |
| Monitoring dashboard setup | High | 4h | DevOps |
| Launch checklist verification | Critical | 2h | All |

---

## 11. Success Criteria

### 11.1 Security Checklist

- [ ] All session tokens are cryptographically signed (JWT)
- [ ] 100% of API endpoints have rate limiting
- [ ] All user input is validated with Zod schemas
- [ ] Security headers configured (CSP, HSTS, etc.)
- [ ] Audit logging for sensitive operations
- [ ] No secrets in client-side code
- [ ] CORS properly configured

### 11.2 Testing Checklist

- [ ] Unit test coverage ≥ 70%
- [ ] All API routes have tests
- [ ] All Zustand stores have tests
- [ ] E2E tests for critical user flows
- [ ] Integration tests for third-party services
- [ ] CI pipeline enforces coverage thresholds

### 11.3 Observability Checklist

- [ ] Structured logging with correlation IDs
- [ ] Error tracking (Sentry) configured
- [ ] Health check endpoint responds correctly
- [ ] Key metrics are tracked and alertable
- [ ] Dashboards for monitoring

### 11.4 Performance Checklist

- [ ] API p95 latency < 2 seconds
- [ ] Time to first byte < 500ms
- [ ] Database queries < 500ms
- [ ] Caching for expensive operations
- [ ] Pagination on all list endpoints

### 11.5 Launch Readiness Checklist

- [ ] All critical/high priority items completed
- [ ] Security audit passed
- [ ] Load testing completed
- [ ] Rollback plan documented
- [ ] On-call rotation established
- [ ] Incident response plan documented

---

## 12. Appendix

### 12.1 New Dependencies

```json
{
  "dependencies": {
    "jose": "^5.2.0",
    "pino": "^8.18.0",
    "@sentry/nextjs": "^7.100.0"
  },
  "devDependencies": {
    "pino-pretty": "^10.3.0"
  }
}
```

### 12.2 New Environment Variables

```bash
# Security
JWT_SECRET=your-32-character-minimum-secret-key

# Monitoring
SENTRY_DSN=https://xxx@sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx

# Logging
LOG_LEVEL=info
```

### 12.3 File Structure Changes

```
src/
├── lib/
│   ├── auth/
│   │   └── jwt.ts              # NEW: JWT utilities
│   ├── audit/
│   │   └── logger.ts           # NEW: Audit logging
│   ├── cache/
│   │   └── index.ts            # NEW: Caching utilities
│   ├── logger/
│   │   └── index.ts            # NEW: Structured logging
│   ├── middleware/
│   │   └── requestLogger.ts    # NEW: Request logging
│   └── env.ts                  # NEW: Env validation
├── app/
│   └── api/
│       └── health/
│           └── route.ts        # NEW: Health check
├── middleware.ts               # NEW: Security headers
├── sentry.client.config.ts     # NEW: Sentry client
├── sentry.server.config.ts     # NEW: Sentry server
└── sentry.edge.config.ts       # NEW: Sentry edge
```

### 12.4 Reference Links

- [Next.js Security Best Practices](https://nextjs.org/docs/app/building-your-application/configuring/security)
- [Sentry Next.js SDK](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Pino Logger](https://github.com/pinojs/pino)
- [Jose JWT Library](https://github.com/panva/jose)
- [OWASP Security Guidelines](https://owasp.org/www-project-web-security-testing-guide/)
- [Firebase Security Rules](https://firebase.google.com/docs/firestore/security/get-started)

---

**Document Version:** 1.0
**Last Updated:** December 28, 2025
**Status:** Ready for Review
