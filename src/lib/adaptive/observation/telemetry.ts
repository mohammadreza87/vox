import { z } from 'zod';
export const TURN_STAGES = ['stt', 'retrieval', 'decisions', 'generation', 'tts'] as const;
export const stageSchema = z.enum(TURN_STAGES);
export const usageReceiptSchema = z.object({ provider: z.enum(['anthropic', 'gemini', 'openai', 'elevenlabs']),
  modelFamily: z.enum(['claude', 'gemini', 'gpt', 'whisper', 'scribe', 'eleven', 'unknown']),
  inputTokens: z.number().int().min(0).max(10_000_000).nullable(), outputTokens: z.number().int().min(0).max(10_000_000).nullable(),
  cacheReadTokens: z.number().int().min(0).max(10_000_000).nullable(), cacheWriteTokens: z.number().int().min(0).max(10_000_000).nullable(),
  status: z.enum(['complete', 'partial', 'unavailable']),
}).strict();
export const turnTelemetrySchema = z.object({ version: z.literal(1), stages: z.array(z.object({ stage: stageSchema,
  outcome: z.enum(['succeeded', 'failed', 'cancelled', 'unknown']), durationMs: z.number().finite().min(0).max(86_400_000),
}).strict()).max(16), usage: z.array(usageReceiptSchema).max(16), truncated: z.boolean(),
}).strict();
export type TurnTelemetry = z.infer<typeof turnTelemetrySchema>;
export type UsageReceipt = z.infer<typeof usageReceiptSchema>;
export type TurnStage = typeof TURN_STAGES[number];
export const telemetryProjectionSchema = z.object({ instrumentedTurns: z.number().int().nonnegative(),
  stages: z.array(z.object({ stage: stageSchema, samples: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(), meanMs: z.number().nonnegative().nullable(),
  }).strict()).max(5), usageReceipts: z.number().int().nonnegative(), usageUnavailable: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  discardedInputTokens: z.number().int().nonnegative().nullable(), discardedOutputTokens: z.number().int().nonnegative().nullable(),
  clientPlaybackTimingSamples: z.number().int().nonnegative(), clientMeanTimeToPlaybackMs: z.number().nonnegative().nullable(),
  usageComplete: z.boolean(), billedCost: z.null(), reportedTaskSucceeded: z.number().int().nonnegative(),
  reportedTaskFailed: z.number().int().nonnegative(), reportedTaskUnknown: z.number().int().nonnegative(),
}).strict();
export type TelemetryProjection = z.infer<typeof telemetryProjectionSchema>;
