import { z } from 'zod';
import { turnTelemetrySchema, telemetryProjectionSchema } from './telemetry';

export const OBSERVER_VERSION = 'vox-observer-v1' as const;
export const OBSERVER_RETENTION_MS = 7 * 86_400_000;
export const OBSERVER_MAX_EVENTS = 200;
export const OBSERVER_MAX_ATTEMPTS = 3;
export const OBSERVER_LEASE_MS = 30_000;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().nonnegative().safe();
const space = z.enum(['work', 'personal']);
const revision = z.number().int().positive().safe();
const common = { eventId: id, space, agentId: id, turnId: id, revision: revision.default(1) };
export const serverObservationInputSchema = z.object({ ...common, kind: z.literal('response'),
  channel: z.enum(['voice', 'text', 'telegram']), outcome: z.enum(['responded', 'failed', 'cancelled', 'unknown']),
  durationMs: z.number().finite().min(0).max(86_400_000).optional(),
  telemetry: turnTelemetrySchema.optional(),
  operation: z.enum(['conversation', 'prediction']).optional(),
  origin: z.enum(['human', 'agent', 'system', 'qa']).default('human'), policyReceipt: hash,
}).strict();
export const clientObservationInputSchema = z.object({ ...common,
  durationMs: z.number().finite().min(0).max(86_400_000).optional(),
  outcome: z.enum(['playback_started', 'playback_completed', 'playback_failed', 'interrupted', 'task_succeeded', 'task_failed', 'task_unknown', 'text_rendered']),
}).strict();
export type ServerObservationInput = z.input<typeof serverObservationInputSchema>;
export type ClientObservationInput = z.input<typeof clientObservationInputSchema>;
export const observerEventSchema = z.object({ schemaVersion: z.literal(1), version: z.literal(OBSERVER_VERSION),
  id: hash, fingerprint: hash, revision, turnKey: hash, origin: z.literal('human'),
  purpose: z.literal('optional.product_analytics'), policyVersion: z.literal('adaptive-privacy-v1'),
  consentEpoch: time, permissionRevision: revision, grantRevision: revision, bindingRevision: revision, accountId: z.string().max(200), personId: z.string().max(200),
  space, spaceId: z.string().max(200), agentId: id, policyReceipt: hash,
  clientExperienceVersion: z.literal(1).optional(),
  trust: z.enum(['server', 'client_unverified']), channel: z.enum(['voice', 'text', 'telegram']),
  outcome: z.enum(['responded', 'failed', 'cancelled', 'unknown', 'playback_started', 'playback_completed', 'playback_failed', 'interrupted', 'task_succeeded', 'task_failed', 'task_unknown', 'text_rendered']),
  telemetry: turnTelemetrySchema.optional(),
  operation: z.enum(['conversation', 'prediction']).optional(),
  durationMs: z.number().finite().min(0).max(86_400_000).optional(), occurredAt: time, receivedAt: time, expiresAt: time,
  state: z.enum(['pending', 'leased', 'processed', 'failed']), attempts: z.number().int().min(0).max(OBSERVER_MAX_ATTEMPTS),
  nextAttemptAt: time, leaseId: id.optional(), leaseUntil: time.optional(), processedAt: time.optional(),
  failureCode: z.enum(['consumer_failed', 'retry_exhausted']).optional(),
}).strict().superRefine((event, context) => {
  const serverOutcome = ['responded', 'failed', 'cancelled', 'unknown'].includes(event.outcome);
  if ((event.trust === 'server') !== serverOutcome || (event.trust === 'client_unverified' && !event.outcome.startsWith('task_') && event.outcome !== 'text_rendered' && event.channel !== 'voice') || (event.trust === 'client_unverified' && event.telemetry !== undefined)) context.addIssue({ code: 'custom', message: 'Invalid observation trust' });
  if ((event.outcome === 'text_rendered') !== (event.clientExperienceVersion === 1) || event.outcome === 'text_rendered' && event.channel !== 'text') context.addIssue({ code: 'custom', message: 'Invalid text channel' });
  if (event.occurredAt > event.receivedAt || event.receivedAt >= event.expiresAt || (event.state === 'leased') !== (event.leaseId !== undefined && event.leaseUntil !== undefined)) context.addIssue({ code: 'custom', message: 'Invalid observation state' });
});
export type ObserverEvent = z.infer<typeof observerEventSchema>;
export const observerFindingSchema = z.object({ id: hash, space, rule: z.enum(['response_failure', 'playback_failure', 'interruption']),
  ruleVersion: z.literal(1), evidenceIds: z.array(hash).max(OBSERVER_MAX_EVENTS), count: z.number().int().positive(),
  observed: z.enum(['server_reported_failure', 'client_reported_playback_failure', 'client_reported_interruption']),
  inferredCause: z.null(), alternatives: z.array(z.enum(['provider_or_application_failure', 'network_or_device_failure', 'intentional_user_action', 'unknown'])).max(4),
  confidence: z.literal('observation_only'), reproducibleFrom: z.literal('journal_events'),
}).strict();
export type ObserverFinding = z.infer<typeof observerFindingSchema>;
export const correctionObservationInputSchema = z.object({ version: z.literal(1), eventId: id, space, policyReceipt: hash,
  outcome: z.enum(['correction_client_saved', 'correction_client_unconfirmed']),
}).strict();
export type CorrectionObservationInput = z.infer<typeof correctionObservationInputSchema>;
export const correctionObservationSchema = z.object({ version: z.literal(1), id: hash, fingerprint: hash, space,
  policyReceipt: hash, trust: z.literal('client_unverified'),
  outcome: z.enum(['correction_client_saved', 'correction_client_unconfirmed']),
  mutationEvidence: z.enum(['accepted_command_receipt', 'unavailable']), occurredAt: time, expiresAt: time,
}).strict();
export type CorrectionObservation = z.infer<typeof correctionObservationSchema>;
export const clientExperienceProjectionSchema = z.object({ version: z.literal(1), trust: z.literal('client_unverified'),
  textRendered: z.number().int().nonnegative(), textTimingSamples: z.number().int().nonnegative(), meanTimeToTextMs: z.number().nonnegative().nullable(),
  correctionSaved: z.number().int().nonnegative(), correctionUnconfirmed: z.number().int().nonnegative(), correctionAcceptedReceipts: z.number().int().nonnegative(),
}).strict();
export const observerProjectionSchema = z.object({ space, sourceDigest: hash, sourceEvents: z.number().int().nonnegative(),
  responded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative(),
  unknownResponses: z.number().int().nonnegative(), taskOutcomesUnknown: z.number().int().nonnegative(), timedResponses: z.number().int().nonnegative(), responseTurns: z.number().int().nonnegative(), meanResponseMs: z.number().nonnegative().nullable(),
  playbackStarted: z.number().int().nonnegative(), playbackCompleted: z.number().int().nonnegative(), playbackFailed: z.number().int().nonnegative(),
  interruptions: z.number().int().nonnegative(), playbackUnknown: z.number().int().nonnegative(),
  telemetry: telemetryProjectionSchema.optional(),
  clientExperience: clientExperienceProjectionSchema.optional(),
  findings: z.array(observerFindingSchema).max(3),
}).strict();
export type ObserverProjection = z.infer<typeof observerProjectionSchema>;
export const observerDocumentSchema = z.object({ schemaVersion: z.literal(1),
  events: z.array(observerEventSchema).max(OBSERVER_MAX_EVENTS), corrections: z.array(correctionObservationSchema).max(OBSERVER_MAX_EVENTS).optional(), projections: z.array(observerProjectionSchema).max(2),
}).strict();
export type ObserverDocument = z.infer<typeof observerDocumentSchema>;
export const emptyObserverDocument = (): ObserverDocument => ({ schemaVersion: 1, events: [], projections: [] });
export interface ObserverSnapshot {
  schemaVersion: 1; version: typeof OBSERVER_VERSION; space: 'work' | 'personal'; available: boolean;
  projection: ObserverProjection; findings: ObserverFinding[];
  queue: { pending: number; leased: number; failed: number; oldestPendingAgeMs: number | null; lastProcessedAt: number | null };
  completeness: { complete: false; acceptedEvents: number; processedEvents: number; pendingEvents: number; failedEvents: number;
    samplingRate: 1; retentionMs: number; coverage: 'instrumented_response_and_client_playback_only'; clientExperienceCoverage?: 'committed_text_and_explicit_correction_reports'; clientCorrectionReports?: number;
    playbackEvidence: 'client_unverified'; telemetryCoverage?: 'supported_server_stages_and_reported_usage'; verifiedTaskSuccess: null; providerUsage: null; language: null; release: null };
}
