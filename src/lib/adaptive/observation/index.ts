import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const time = z.number().int().nonnegative().safe();
const latency = z.number().finite().nonnegative().max(86_400_000);
const payloads = {
  'turn.started': z.object({ channel: z.enum(['text', 'voice', 'telegram']) }).strict(),
  'transcription.finalized': z.object({ durationMs: latency }).strict(),
  'retrieval.completed': z.object({ durationMs: latency, candidateCount: z.number().int().min(0).max(1000) }).strict(),
  'decision.completed': z.object({ durationMs: latency, status: z.enum(['answered', 'unknown']), inputTokens: z.number().int().nonnegative().max(1_000_000).optional() }).strict(),
  'response.first_text': z.object({ durationMs: latency }).strict(),
  'audio.first_played': z.object({ durationMs: latency }).strict(),
  'reply.interrupted': z.object({ afterMs: latency }).strict(),
  'turn.cancelled': z.object({ reason: z.enum(['user', 'revision', 'timeout', 'policy']) }).strict(),
  'tool.commit_verified': z.object({ outcome: z.enum(['success', 'failure']) }).strict(),
  'feedback.submitted': z.object({ value: z.enum(['useful', 'not_useful']) }).strict(),
  'notification.suppressed': z.object({ reason: z.enum(['consent', 'policy', 'quiet_hours', 'budget', 'expired', 'duplicate']) }).strict(),
  'notification.accepted_by_provider': z.object({ channel: z.enum(['telegram', 'inbox']) }).strict(),
  'experiment.exposed': z.object({ experimentId: id, variant: z.enum(['baseline', 'candidate']) }).strict(),
} as const;
export type ObservationName = keyof typeof payloads;
const envelope = z.object({
  schemaVersion: z.literal(1), id, producer: id, revision: z.number().int().positive(),
  tenantId: id, spaceId: id, containerId: id, personId: id, sessionId: id, turnId: id,
  occurredAt: time, receivedAt: time, sourceRevision: z.number().int().nonnegative(),
  policyVersion: id, purpose: z.enum(['ops.security_reliability', 'optional.product_analytics']),
  origin: z.enum(['human', 'agent', 'system', 'qa']), trust: z.enum(['server_verified', 'client_unverified']),
  sampleRate: z.number().positive().max(1), expiresAt: time,
}).strict();
type Envelope = z.infer<typeof envelope>;
export type ObservationEvent = { [Name in ObservationName]: Envelope & { name: Name; payload: z.infer<typeof payloads[Name]> } }[ObservationName];
export type ObservationResult = { accepted: true; event: ObservationEvent } | { accepted: false; reason: 'invalid' | 'unauthorized' | 'expired' };

/** Explicit event allowlist. Never includes transcripts, prompts, names, URLs,
 * source excerpts, arbitrary error strings or audio/images. Do not log parse errors. */
export function parseObservation(input: unknown, now: number): ObservationEvent | null {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(now) || now < 0) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.name !== 'string' || !Object.hasOwn(payloads, record.name)) return null;
  const { name, payload, ...rest } = record;
  const parsed = envelope.safeParse(rest);
  const parsedPayload = payloads[name as ObservationName].safeParse(payload);
  if (!parsed.success || !parsedPayload.success || parsed.data.receivedAt > now ||
      parsed.data.occurredAt > parsed.data.receivedAt || parsed.data.expiresAt <= parsed.data.receivedAt) return null;
  return { ...parsed.data, name, payload: parsedPayload.data } as ObservationEvent;
}

export async function authorizeObservation(input: unknown, now: number,
  /** Server auth validates actor, exact scope/purpose/consent/current source version. */
  authorize: (event: ObservationEvent) => Promise<boolean>): Promise<ObservationResult> {
  const event = parseObservation(input, now);
  if (!event) return { accepted: false, reason: 'invalid' };
  if (event.expiresAt <= now) return { accepted: false, reason: 'expired' };
  if (!await authorize(event)) return { accepted: false, reason: 'unauthorized' };
  return { accepted: true, event };
}

/** Exact producer/scope ID including revision. A storage UNIQUE key must enforce
 * this atomically; this helper alone is not an ingestion deduper/outbox. */
export function observationKey(event: ObservationEvent): string {
  return JSON.stringify([event.tenantId, event.spaceId, event.containerId, event.producer, event.id, event.revision]);
}
export interface OutcomeProjection {
  readonly schemaVersion: 1;
  readonly eventCount: number;
  readonly turnCount: number;
  readonly verifiedSuccesses: number;
  readonly verifiedFailures: number;
  readonly unknownOutcomes: number;
  readonly firstAudioP50Ms: number | null;
  readonly firstAudioP95Ms: number | null;
  readonly unverifiedClientEvents: number;
  readonly complete: boolean;
}
function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

/** Internal minimized projection. Caller supplies an already authorized single
 * scope, date/build/channel cohort and current eligibility; authorization is
 * reapplied per event. Cohort widening/export needs a separate policy decision. */
export async function projectOutcomes(inputs: readonly unknown[], context: {
  tenantId: string; spaceId: string; containerId: string; from: number; until: number; now: number;
  authorize: (event: ObservationEvent) => Promise<boolean>;
  /** A consumer watermark, not inferred from the absence of events. */
  complete: boolean;
}): Promise<OutcomeProjection> {
  const unique = new Map<string, ObservationEvent>();
  const conflicts = new Set<string>();
  for (const input of inputs) {
    const event = parseObservation(input, context.now);
    if (!event || event.purpose !== 'optional.product_analytics' || event.origin !== 'human' ||
        event.expiresAt <= context.now || event.sampleRate !== 1 ||
        event.tenantId !== context.tenantId || event.spaceId !== context.spaceId || event.containerId !== context.containerId ||
        event.occurredAt < context.from || event.occurredAt >= context.until || !await context.authorize(event)) continue;
    const key = JSON.stringify([event.tenantId, event.spaceId, event.containerId, event.producer, event.id]);
    const previous = unique.get(key);
    if (!previous || previous.revision < event.revision) unique.set(key, event);
    else if (previous.revision === event.revision && JSON.stringify(previous) !== JSON.stringify(event)) {
      conflicts.add(observationKey(event));
      // Deterministic representative for counting a quarantined unknown turn.
      if (JSON.stringify(event) < JSON.stringify(previous)) unique.set(key, event);
    }
  }
  const turns = new Map<string, ObservationEvent[]>();
  for (const event of unique.values()) {
    const key = JSON.stringify([event.personId, event.sessionId, event.turnId]);
    turns.set(key, [...(turns.get(key) ?? []), event]);
  }
  let verifiedSuccesses = 0, verifiedFailures = 0;
  const firstAudio: number[] = [];
  for (const events of turns.values()) {
    const outcomes = events.flatMap(e => !conflicts.has(observationKey(e)) && e.name === 'tool.commit_verified' && e.trust === 'server_verified' ? [e.payload.outcome] : []);
    // Conflicting verified outcomes stay unknown. A generated reply is never success.
    const values = new Set(outcomes);
    if (values.size === 1 && values.has('success')) verifiedSuccesses++;
    else if (values.size === 1 && values.has('failure')) verifiedFailures++;
    const playback = events.flatMap(e => !conflicts.has(observationKey(e)) && e.name === 'audio.first_played' ? [e.payload.durationMs] : []);
    if (playback.length) firstAudio.push(Math.min(...playback));
  }
  return { schemaVersion: 1, eventCount: unique.size, turnCount: turns.size, verifiedSuccesses, verifiedFailures,
    unknownOutcomes: turns.size - verifiedSuccesses - verifiedFailures,
    firstAudioP50Ms: percentile(firstAudio, 0.5), firstAudioP95Ms: percentile(firstAudio, 0.95),
    unverifiedClientEvents: [...unique.values()].filter(e => e.trust === 'client_unverified').length,
    complete: context.complete && ![...unique.values()].some(e => conflicts.has(observationKey(e))) };
}
