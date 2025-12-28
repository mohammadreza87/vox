import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firebase Admin
vi.mock('@/lib/firebase-admin', () => ({
  getAdminDb: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: true }),
      }),
    }),
  }),
}));

// Mock Upstash Redis
vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    async ping() {
      return 'PONG';
    }
  },
}));

// Mock Stripe
vi.mock('stripe', () => ({
  default: class MockStripe {
    balance = {
      retrieve: async () => ({ available: [] }),
    };
  },
}));

// Import after mocks are set up
const { GET } = await import('./route');

describe('Health Check Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy status when all services are up', async () => {
    // Set environment variables
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks).toHaveLength(3);
    expect(data.checks.map((c: { name: string }) => c.name)).toContain('firebase');
    expect(data.checks.map((c: { name: string }) => c.name)).toContain('redis');
    expect(data.checks.map((c: { name: string }) => c.name)).toContain('stripe');
  });

  it('includes timestamp and version', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.timestamp).toBeDefined();
    expect(new Date(data.timestamp).getTime()).not.toBeNaN();
    expect(data.version).toBeDefined();
    expect(data.environment).toBeDefined();
  });

  it('returns healthy for optional services when not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');

    const redisCheck = data.checks.find((c: { name: string }) => c.name === 'redis');
    expect(redisCheck?.status).toBe('healthy');
    expect(redisCheck?.message).toContain('Not configured');
  });

  it('includes latency measurements', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.totalLatencyMs).toBeGreaterThanOrEqual(0);
    data.checks.forEach((check: { latencyMs?: number }) => {
      expect(check.latencyMs).toBeDefined();
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  it('returns 503 when a critical service is unhealthy', async () => {
    // Mock Firebase to fail
    const { getAdminDb } = await import('@/lib/firebase-admin');
    vi.mocked(getAdminDb).mockRejectedValueOnce(new Error('Connection failed'));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
  });
});
