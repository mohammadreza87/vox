'use client';
import { z } from 'zod';
import { RIGHTS_COPY_VERSION } from '@/lib/adaptive/rights-intake/notice';
import { auditSchema, createInputSchema, integer, kindSchema, operatorActionSchema, policyBindingSchema, requestSchema, requesterActionSchema, type CreateInput, type OperatorAction, type RequesterAction, type RightsMutation, type RightsOperations, type RightsRequestView, type RightsSnapshot, type RightsSpace } from '@/lib/adaptive/rights-intake/contracts';
import { preferenceValueSchema } from '@/lib/adaptive/personalization';
import { productPauseScopeSchema } from '@/lib/adaptive/product-pause/contracts';
import { ADAPTIVE_OPTIONAL_PURPOSES } from '@/lib/adaptive/persistence/contracts';
import { tg } from './client';
export type { RightsRequestView, RightsSnapshot, RightsSpace, RightsOperations, RightsOperationView } from '@/lib/adaptive/rights-intake/contracts';
const policyStatus = z.enum(['available', 'unavailable']);
export const rightsRequestViewSchema = requestSchema.omit({ accountId: true, audit: true }).extend({ retentionReviewRequired: z.boolean() }).strict();
const operationViewSchema = rightsRequestViewSchema.pick({ version: true, requestId: true, space: true, kind: true, revision: true, createdAt: true, updatedAt: true, state: true, reasonCode: true, deadline: true, coverage: true, retentionReviewRequired: true }).extend({ accountRef: z.string().regex(/^[a-f0-9]{64}$/), operationHandle: z.string().min(1).max(2048), audit: z.array(auditSchema.omit({ actorRef: true })).max(32) }).strict();
export const rightsSnapshotSchema = z.object({ available: z.boolean(), policyStatus, supportedKinds: z.array(kindSchema).max(7), intakePolicy: policyBindingSchema.optional(), requests: z.array(rightsRequestViewSchema).max(100), supportContact: z.literal('info@joyixir.com') }).strict().superRefine((value, ctx) => { if (value.available && (value.policyStatus !== 'available' || !value.intakePolicy || value.intakePolicy.copyVersion !== RIGHTS_COPY_VERSION || !value.supportedKinds.length)) ctx.addIssue({ code: 'custom', message: 'Policy unavailable' }); if (!value.available && value.supportedKinds.length) ctx.addIssue({ code: 'custom', message: 'Unavailable kinds' }); });
const mutationSchema = z.object({ replayed: z.boolean(), request: rightsRequestViewSchema, policyStatus }).strict();
const operationsSchema = z.object({ requests: z.array(operationViewSchema).max(100), nextCursor: z.string().min(1).max(4096).optional(), policyStatus }).strict();
const operationMutationSchema = z.object({ replayed: z.boolean(), request: operationViewSchema, policyStatus }).strict();
const id = z.string().min(1).max(200), time = integer, revision = integer.positive();
const timed = { createdAt: time, expiresAt: time }, agent = { agentId: id }, setting = preferenceValueSchema;
const note = z.object({ id, revision, text: z.string().max(10000), ...timed }).strict();
const preferenceStatus = z.enum(['active', 'reset']);
const itemStatus = z.enum(['unread', 'read', 'dismissed', 'cancelled']);
const duration = z.number().finite().min(0).max(86_400_000);
// The attachment is the current server allowlist, never an unchecked JSON/blob or stored preview.
export const rightsExportSchema = z.object({ schemaVersion: z.literal(1), accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/), space: z.enum(['work', 'personal']), generatedAt: time, revision: integer, confirmedUntil: time,
  productPause: productPauseScopeSchema.optional(), memories: z.array(note), preferences: z.array(z.object({ id, revision, ...agent, setting, status: preferenceStatus, updatedAt: time }).strict()),
  preferenceChanges: z.array(z.object({ changeId: id, ...agent, key: z.enum(['response_length', 'language', 'formatting']), ...timed, previous: z.object({ setting, status: preferenceStatus }).strict().nullable() }).strict()),
  preferenceLearning: z.object({ version: z.literal('preference-learning-v1'), intents: z.array(z.object({ ...agent, ...timed }).strict()), candidates: z.array(z.object({ id, ...agent, setting, reason: z.enum(['length_cue', 'language_cue', 'formatting_cue']), evidenceIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(16), ...timed }).strict()), suppressions: z.array(z.object({ ...agent, evidenceId: z.string().regex(/^[a-f0-9]{64}$/), ...timed }).strict()) }).strict().nullable(),
  purposes: z.array(z.object({ purpose: z.enum(ADAPTIVE_OPTIONAL_PURPOSES), state: z.enum(['not_asked', 'presented', 'granted', 'declined', 'withdrawn', 'expired', 'reconsent_required', 'suspended']), revision, epoch: integer, effectiveAt: time, expiresAt: time }).strict()),
  agents: z.array(z.object({ ...agent, allowed: z.boolean(), revision }).strict()),
  settings: z.object({ inboxEnabled: z.boolean(), proactiveEnabled: z.boolean(), reminderEnabled: z.boolean(), timezone: z.string().max(128).optional(), dailyCap: integer.max(20), quietStartHour: integer.max(23), quietEndHour: integer.max(23) }).strict(),
  reminders: z.array(z.object({ id, ...agent, category: z.enum(['reminder', 'proactive']), label: z.string().max(160).optional(), status: itemStatus, ...timed, dueAt: time }).strict()),
  observations: z.array(z.object({ ...agent, channel: z.enum(['voice', 'text', 'telegram']), status: z.enum(['responded', 'failed', 'cancelled']), durationMs: duration, at: time }).strict()),
  checkIns: z.array(z.object({ id, ...agent, text: z.string().max(1000), status: itemStatus, ...timed }).strict()),
  observerEvents: z.array(z.object({ ...agent, trust: z.enum(['server', 'client_unverified']), channel: z.enum(['voice', 'text', 'telegram']), outcome: z.enum(['responded', 'failed', 'cancelled', 'unknown', 'playback_started', 'playback_completed', 'playback_failed', 'interrupted', 'task_succeeded', 'task_failed', 'task_unknown']), durationMs: duration.optional(), occurredAt: time, expiresAt: time, state: z.enum(['pending', 'leased', 'processed', 'failed']) }).strict()),
  sharedContributions: z.array(note.extend({ containerId: id }).strict()), coverage: z.object({ privateAccount: z.literal('included'), shared: z.enum(['authorized_published_only', 'not_configured']), providers: z.literal('unavailable'), backups: z.literal('unavailable') }).strict(),
}).strict();
export type RightsExport = z.infer<typeof rightsExportSchema>;
export type RightsActionResult = { type: 'metadata'; value: RightsMutation } | { type: 'export'; value: RightsExport };
export class RightsClientError extends Error { constructor(readonly status: number) { super('rights_request_unconfirmed'); } }
function scoped<T extends { space: RightsSpace }>(row: T, space: RightsSpace): T { if (row.space !== space) throw new RightsClientError(409); return row; }
async function call(path: string, session: string, method: 'GET' | 'POST', body?: unknown, outer?: AbortSignal) {
  if (!session || tg()?.initData !== session) throw new RightsClientError(401);
  const controller = new AbortController(), abort = () => controller.abort(); outer?.addEventListener('abort', abort, { once: true });
  if (outer?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`/api/studio/rights${path}`, { method, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Telegram-Init-Data': session, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
    if (controller.signal.aborted || tg()?.initData !== session) throw new RightsClientError(409);
    if (!response.ok) throw new RightsClientError(response.status);
    if ((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new RightsClientError(502);
    const value: unknown = await response.json();
    if (controller.signal.aborted || tg()?.initData !== session) throw new RightsClientError(409);
    return { response, value };
  } finally { clearTimeout(timeout); outer?.removeEventListener('abort', abort); }
}
export const rightsApi = {
  async read(space: RightsSpace, session: string, signal?: AbortSignal): Promise<RightsSnapshot> { const { value } = await call(`?space=${space}`, session, 'GET', undefined, signal); const parsed = rightsSnapshotSchema.parse(value); parsed.requests.forEach(row => scoped(row, space)); return parsed; },
  async create(input: CreateInput, session: string, signal?: AbortSignal): Promise<RightsMutation> { const { value } = await call('/requests', session, 'POST', createInputSchema.parse(input), signal); const parsed = mutationSchema.parse(value); scoped(parsed.request, input.space); if (parsed.request.kind !== input.kind) throw new RightsClientError(409); return parsed; },
  async act(row: RightsRequestView, input: RequesterAction, session: string, signal?: AbortSignal): Promise<RightsActionResult> { const { response, value } = await call(`/requests/${encodeURIComponent(row.requestId)}/actions?space=${row.space}`, session, 'POST', requesterActionSchema.parse(input), signal);
    if (response.headers.get('content-disposition')?.startsWith('attachment;')) {
      if (input.action !== 'prepare_local_export' || response.headers.get('X-Vox-Rights-Request-Id') !== row.requestId) throw new RightsClientError(502);
      return { type: 'export', value: scoped(rightsExportSchema.parse(value), row.space) };
    }
    const parsed = mutationSchema.parse(value); scoped(parsed.request, row.space); if (parsed.request.requestId !== row.requestId || parsed.request.kind !== row.kind) throw new RightsClientError(409); return { type: 'metadata', value: parsed };
  },
  async operations(session: string, cursor?: string, signal?: AbortSignal): Promise<RightsOperations> { const { value } = await call(`/operations/requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, session, 'GET', undefined, signal); return operationsSchema.parse(value); },
  async operate(requestId: string, input: OperatorAction, session: string, signal?: AbortSignal) { const { value } = await call(`/operations/requests/${encodeURIComponent(requestId)}/actions`, session, 'POST', operatorActionSchema.parse(input), signal); const parsed = operationMutationSchema.parse(value); if (parsed.request.requestId !== requestId) throw new RightsClientError(409); return parsed; },
};
