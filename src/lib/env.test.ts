import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateEnv, assertEnvValid, getEnv, isProduction, isDevelopment } from './env';

describe('Environment Validation', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  describe('validateEnv', () => {
    it('reports errors for missing required variables', () => {
      // Clear all env vars
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', '');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', '');
      vi.stubEnv('JWT_SECRET', '');

      const result = validateEnv();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('NEXT_PUBLIC_FIREBASE_API_KEY'))).toBe(true);
    });

    it('validates JWT_SECRET length', () => {
      vi.stubEnv('JWT_SECRET', 'short');

      const result = validateEnv();

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('JWT_SECRET') && e.includes('32 characters'))).toBe(true);
    });

    it('requires at least one AI provider', () => {
      // Set required vars but no AI providers
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'test');
      vi.stubEnv('JWT_SECRET', 'test-secret-key-that-is-at-least-32-characters');
      vi.stubEnv('ELEVENLABS_API_KEY', 'test');
      vi.stubEnv('STRIPE_SECRET_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'test');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test');
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');

      const result = validateEnv();

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('AI provider'))).toBe(true);
    });

    it('passes validation with all required variables', () => {
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'test');
      vi.stubEnv('JWT_SECRET', 'test-secret-key-that-is-at-least-32-characters');
      vi.stubEnv('ELEVENLABS_API_KEY', 'test');
      vi.stubEnv('STRIPE_SECRET_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'test');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test');
      vi.stubEnv('OPENAI_API_KEY', 'test');

      const result = validateEnv();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns warnings for optional but recommended variables', () => {
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'test');
      vi.stubEnv('JWT_SECRET', 'test-secret-key-that-is-at-least-32-characters');
      vi.stubEnv('ELEVENLABS_API_KEY', 'test');
      vi.stubEnv('STRIPE_SECRET_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'test');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test');
      vi.stubEnv('OPENAI_API_KEY', 'test');
      vi.stubEnv('SENTRY_DSN', '');

      const result = validateEnv();

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('SENTRY_DSN'))).toBe(true);
    });

    it('validates LOG_LEVEL values', () => {
      vi.stubEnv('LOG_LEVEL', 'invalid');

      const result = validateEnv();

      expect(result.errors.some((e) => e.includes('LOG_LEVEL'))).toBe(true);
    });
  });

  describe('assertEnvValid', () => {
    it('throws error when validation fails', () => {
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', '');

      expect(() => assertEnvValid()).toThrow('Missing or invalid environment variables');
    });

    it('does not throw when validation passes', () => {
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test');
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'test');
      vi.stubEnv('JWT_SECRET', 'test-secret-key-that-is-at-least-32-characters');
      vi.stubEnv('ELEVENLABS_API_KEY', 'test');
      vi.stubEnv('STRIPE_SECRET_KEY', 'test');
      vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'test');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test');
      vi.stubEnv('OPENAI_API_KEY', 'test');

      expect(() => assertEnvValid()).not.toThrow();
    });
  });

  describe('getEnv', () => {
    it('returns value when variable exists', () => {
      vi.stubEnv('TEST_VAR', 'test-value');

      expect(getEnv('TEST_VAR')).toBe('test-value');
    });

    it('returns undefined for missing optional variable', () => {
      vi.stubEnv('MISSING_VAR', '');

      expect(getEnv('MISSING_VAR')).toBeUndefined();
    });

    it('throws for missing required variable', () => {
      vi.stubEnv('MISSING_REQUIRED', '');

      expect(() => getEnv('MISSING_REQUIRED', true)).toThrow(
        'Missing required environment variable: MISSING_REQUIRED'
      );
    });
  });

  describe('environment checks', () => {
    it('isProduction returns true in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(isProduction()).toBe(true);
    });

    it('isDevelopment returns true in development', () => {
      vi.stubEnv('NODE_ENV', 'development');
      expect(isDevelopment()).toBe(true);
    });
  });
});
