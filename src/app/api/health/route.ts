import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

/**
 * Health Check Endpoint for Vox
 * Returns the status of all critical services
 *
 * GET /api/health
 */

interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  latencyMs?: number;
  message?: string;
}

interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  environment: string;
  checks: HealthCheck[];
  totalLatencyMs: number;
}

// Get app version from package.json or environment
const APP_VERSION = process.env.npm_package_version || '0.1.0';

async function checkFirebase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const db = await getAdminDb();
    // Simple read operation to check connectivity
    await db.collection('_health').doc('ping').get();
    return {
      name: 'firebase',
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'firebase',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();

  // Check if Redis is configured
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return {
      name: 'redis',
      status: 'healthy',
      latencyMs: 0,
      message: 'Not configured (optional)',
    };
  }

  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    });
    await redis.ping();
    return {
      name: 'redis',
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'redis',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

async function checkStripe(): Promise<HealthCheck> {
  const start = Date.now();

  // Check if Stripe is configured
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      name: 'stripe',
      status: 'healthy',
      latencyMs: 0,
      message: 'Not configured (optional)',
    };
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // Simple API call to verify connectivity
    await stripe.balance.retrieve();
    return {
      name: 'stripe',
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'stripe',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

export async function GET() {
  const start = Date.now();

  // Run all health checks in parallel
  const checks = await Promise.all([
    checkFirebase(),
    checkRedis(),
    checkStripe(),
  ]);

  // Determine overall status
  const hasUnhealthy = checks.some((c) => c.status === 'unhealthy');
  const hasDegraded = checks.some((c) => c.status === 'degraded');

  let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
  if (hasUnhealthy) {
    overallStatus = 'unhealthy';
  } else if (hasDegraded) {
    overallStatus = 'degraded';
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    environment: process.env.NODE_ENV || 'development',
    checks,
    totalLatencyMs: Date.now() - start,
  };

  // Return appropriate HTTP status
  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;

  return NextResponse.json(response, { status: httpStatus });
}
