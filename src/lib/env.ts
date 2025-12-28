/**
 * Environment Variable Validation for Vox
 * Validates all required and optional environment variables at startup
 * Fails fast if critical variables are missing
 */

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
  validate?: (value: string) => boolean;
  validationMessage?: string;
}

// Define all environment variables
const ENV_VARS: EnvVar[] = [
  // Firebase (Required)
  {
    name: 'NEXT_PUBLIC_FIREBASE_API_KEY',
    required: true,
    description: 'Firebase API key for client-side auth',
  },
  {
    name: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    required: true,
    description: 'Firebase project ID',
  },
  {
    name: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    required: true,
    description: 'Firebase auth domain',
  },

  // Firebase Admin (Required for server)
  {
    name: 'SERVICE_ACCOUNT_KEY',
    required: false, // Can use ADC in production
    description: 'Firebase Admin service account JSON (or use ADC)',
  },

  // JWT (Required for Telegram auth)
  {
    name: 'JWT_SECRET',
    required: true,
    description: 'Secret key for signing JWT tokens',
    validate: (value) => value.length >= 32,
    validationMessage: 'Must be at least 32 characters',
  },

  // AI Services (At least one required)
  {
    name: 'OPENAI_API_KEY',
    required: false,
    description: 'OpenAI API key for chat',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    required: false,
    description: 'Anthropic API key for chat',
  },
  {
    name: 'GOOGLE_GENERATIVE_AI_API_KEY',
    required: false,
    description: 'Google AI API key for chat',
  },

  // ElevenLabs (Required for TTS)
  {
    name: 'ELEVENLABS_API_KEY',
    required: true,
    description: 'ElevenLabs API key for text-to-speech',
  },

  // Stripe (Required for payments)
  {
    name: 'STRIPE_SECRET_KEY',
    required: true,
    description: 'Stripe secret key for server-side',
  },
  {
    name: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    required: true,
    description: 'Stripe publishable key for client-side',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    required: true,
    description: 'Stripe webhook signing secret',
  },

  // Telegram (Optional, for Telegram integration)
  {
    name: 'TELEGRAM_BOT_TOKEN',
    required: false,
    description: 'Telegram bot token for authentication',
  },
  {
    name: 'NEXT_PUBLIC_TELEGRAM_BOT_USERNAME',
    required: false,
    description: 'Telegram bot username for login widget',
  },

  // Redis/Rate Limiting (Optional)
  {
    name: 'UPSTASH_REDIS_REST_URL',
    required: false,
    description: 'Upstash Redis URL for rate limiting',
  },
  {
    name: 'UPSTASH_REDIS_REST_TOKEN',
    required: false,
    description: 'Upstash Redis token',
  },

  // Monitoring (Optional)
  {
    name: 'SENTRY_DSN',
    required: false,
    description: 'Sentry DSN for server error tracking',
  },
  {
    name: 'NEXT_PUBLIC_SENTRY_DSN',
    required: false,
    description: 'Sentry DSN for client error tracking',
  },
  {
    name: 'LOG_LEVEL',
    required: false,
    description: 'Log level (debug, info, warn, error)',
    validate: (value) => ['debug', 'info', 'warn', 'error'].includes(value),
    validationMessage: 'Must be one of: debug, info, warn, error',
  },
];

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate all environment variables
 * @returns Validation result with errors and warnings
 */
export function validateEnv(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.name];

    if (!value) {
      if (envVar.required) {
        errors.push(`Missing required env var: ${envVar.name} - ${envVar.description}`);
      } else {
        // Only warn for commonly used optional vars
        if (['SENTRY_DSN', 'UPSTASH_REDIS_REST_URL'].includes(envVar.name)) {
          warnings.push(`Optional env var not set: ${envVar.name} - ${envVar.description}`);
        }
      }
      continue;
    }

    // Run custom validation if present
    if (envVar.validate && !envVar.validate(value)) {
      errors.push(
        `Invalid value for ${envVar.name}: ${envVar.validationMessage || 'Validation failed'}`
      );
    }
  }

  // Check that at least one AI provider is configured
  const aiProviders = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
  ];
  const hasAiProvider = aiProviders.some((name) => process.env[name]);
  if (!hasAiProvider) {
    errors.push(
      `At least one AI provider API key is required: ${aiProviders.join(', ')}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate environment variables and fail if invalid
 * Call this at application startup
 */
export function assertEnvValid(): void {
  const result = validateEnv();

  // Log warnings
  for (const warning of result.warnings) {
    console.warn(`[ENV WARNING] ${warning}`);
  }

  // Fail on errors
  if (!result.valid) {
    console.error('Environment validation failed:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    throw new Error(
      `Missing or invalid environment variables. See logs for details.`
    );
  }

  console.log('[ENV] All required environment variables are configured');
}

/**
 * Get environment variable with type safety
 * Throws if required variable is missing
 */
export function getEnv(name: string, required: true): string;
export function getEnv(name: string, required?: false): string | undefined;
export function getEnv(name: string, required = false): string | undefined {
  const value = process.env[name];
  // Treat empty string as undefined
  const normalizedValue = value && value.trim() !== '' ? value : undefined;
  if (!normalizedValue && required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return normalizedValue;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}
