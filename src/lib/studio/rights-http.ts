import { localErasurePlanInputSchema, localErasureExecuteInputSchema, localErasureReconcileInputSchema } from '../adaptive/rights-intake/local-erasure-contracts';
import { localUseActionInputSchema, localUsePlanInputSchema, localUsePurposeSchema, localUseReconcileInputSchema } from '../adaptive/rights-intake/local-use-contracts';
import { RightsUseHoldError } from '../adaptive/rights-use-holds/service';
import { trustedStudioRequestOrigin } from './request-origin';
import { isSchemaValidationError } from '../error-contract';
import { AdaptiveError } from '../adaptive/persistence/service';
import { SharedMemoryError } from '../adaptive/shared/service';
import { createInputSchema, retentionActionSchema, operatorActionSchema, reference, requesterActionSchema, spaceSchema } from '../adaptive/rights-intake/contracts';
import { fail, RightsError } from '../adaptive/rights-intake/repository';
import type { Studio } from './service';
import { StudioError } from './service';
import { verifyInitData } from './auth';
import { boundedStudioRequest } from './http';
import { StudioRateLimiter, StudioRateLimitError } from './ratelimit';
import { petStoreFor } from './pet-store';
import type { PetCare } from '../pet/types';
import type { AgentJoin } from './types';
import type { CircleParticipationExport, NoteExport } from '../circles/contracts';
const localLimiters = new WeakMap<Studio, StudioRateLimiter>();
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers } });

/** Committed account membership only. No enrollment/profile convenience methods. */
export function assertRightsAccountNow(studio: Studio, id: number, mode: 'metadata' | 'operator' | 'export' = 'metadata'): void {
  const state = studio.deps.store.readCommittedForEffect?.();
  if (!state) return fail(503, 'rights_unavailable');
  const rows = state.members.filter(m => m.telegramId === id);
  if (rows.length !== 1 || !['pending','member','admin','owner','superadmin'].includes(rows[0].role)) return fail(403, 'account_intake_unavailable');
  if (mode === 'export' && rows[0].role === 'pending') return fail(403, 'export_access_denied');
  if (mode === 'operator' && !['owner','superadmin'].includes(rows[0].role)) return fail(403, 'privacy_operator_required');
}
/** Pet care for a rights export: the records, or a flag that they could not be read this time. */
async function petCareForExport(studio: Studio, id: number): Promise<{ petCare: PetCare[] } | { petCareUnavailable: true }> {
  try { return { petCare: await (await petStoreFor(studio)).listForUser(id) }; }
  catch { (studio.deps.logger ?? console).warn('[studio] pet_export_failed'); return { petCareUnavailable: true }; }
}

/** Pet care erasure at intake: never fails the filed request (replaying it retries). */
async function erasePetCare(studio: Studio, id: number): Promise<void> {
  try { await (await petStoreFor(studio)).eraseUser(id); }
  catch { (studio.deps.logger ?? console).warn('[studio] pet_erasure_failed'); }
}
/** Agent-card choices (Circles) for a rights export: present only when any exist, or a flag that they could not be read. */
async function agentChoicesForExport(studio: Studio, id: number): Promise<{ agentChoices?: AgentJoin[] } | { agentChoicesUnavailable: true }> {
  try { const choices = await studio.agentChoicesFor(id); return choices.length ? { agentChoices: choices } : {}; }
  catch { (studio.deps.logger ?? console).warn('[studio] choice_export_failed'); return { agentChoicesUnavailable: true }; }
}
/** Agent-card choice erasure at intake, like pet care: never fails the filed request. */
async function eraseAgentChoices(studio: Studio, id: number): Promise<void> {
  try { await studio.forgetAgentChoices(id); }
  catch { (studio.deps.logger ?? console).warn('[studio] choice_erasure_failed'); }
}
/** The requester's own circle participation (Circles S2): present only when any exists, or a flag that it could not be read. */
async function circlesForExport(studio: Studio, id: number): Promise<{ circles?: CircleParticipationExport[] } | { circlesUnavailable: true }> {
  try { const circles = await studio.circleParticipationFor(id); return circles.length ? { circles } : {}; }
  catch { (studio.deps.logger ?? console).warn('[studio] circle_export_failed'); return { circlesUnavailable: true }; }
}
/** The requester's own note copies (Circles S3): present only when any exist, or a flag that they could not be read. */
async function notesForExport(studio: Studio, id: number): Promise<{ notes?: NoteExport[] } | { notesUnavailable: true }> {
  try { const notes = await studio.notesFor(id); return notes.length ? { notes } : {}; }
  catch { (studio.deps.logger ?? console).warn('[studio] note_export_failed'); return { notesUnavailable: true }; }
}
/** Note-copy erasure at intake (only the requester's copies), like pet care: never fails the filed request. */
async function eraseNotes(studio: Studio, id: number): Promise<void> {
  try { await studio.forgetNotes(id); }
  catch { (studio.deps.logger ?? console).warn('[studio] note_erasure_failed'); }
}
/** Circle-row erasure at intake (only the requester's rows), like pet care: never fails the filed request. */
async function eraseCircles(studio: Studio, id: number): Promise<void> {
  try { await studio.forgetCircles(id); }
  catch { (studio.deps.logger ?? console).warn('[studio] circle_erasure_failed'); }
}

export async function handleRightsRequest(studio: Studio, request: Request, path: string[], botToken: string): Promise<Response> {
  try {
    if (!botToken.trim()) return json({ error: 'rights_unavailable' }, 503);
    let limiter = studio.deps.rateLimiter ?? localLimiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); localLimiters.set(studio, local); limiter = local; }
    await limiter.consume('ingress', 'all');
    const auth = request.headers.get('x-telegram-init-data') ?? '';
    const user = auth.length <= 16_384 ? verifyInitData(auth, botToken) : null;
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const assertAuthenticatedNow = () => {
      const current = verifyInitData(auth, botToken);
      if (!current || current.id !== user.id) return fail(401, 'authentication_required');
      assertRightsAccountNow(studio, user.id);
      // Membership reads can consume the final second of signed init-data age.
      if (verifyInitData(auth, botToken)?.id !== user.id) return fail(401, 'authentication_required');
    };
    assertAuthenticatedNow();
    if (!studio.deps.rights) return json({ error: 'rights_unavailable' }, 503);
    const rights = studio.deps.rights.forRequest(()=>{assertAuthenticatedNow();if(path.includes('private-note-erasure')&&request.signal.aborted)return fail(409,'rights_request_cancelled');});
    const respond = (value: unknown, status = 200) => {
      const serialized = JSON.stringify(value);
      assertAuthenticatedNow();
      if (path[0] === 'operations') rights.assertOperatorPublicationNow(user.id);
      return new Response(serialized, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    };
    const respondLocal = (value: unknown, fence: () => void) => { const serialized = JSON.stringify(value); fence(); assertAuthenticatedNow(); if(path[0]==='operations') rights.assertOperatorPublicationNow(user.id); return new Response(serialized, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); };
    const url = new URL(request.url), route = path.join('/'), operator = path[0] === 'operations';
    const localUseRoute = path.includes('local-use');
    const allowedQuery = operator ? ['cursor'] : localUseRoute && request.method === 'GET' ? ['space', 'purpose'] : ['space'];
    if ([...url.searchParams.keys()].some(k => !allowedQuery.includes(k)) || allowedQuery.some(k => url.searchParams.getAll(k).length > 1)) return json({ error: 'invalid_request' }, 400);
    const space = operator || route === 'requests' && request.method === 'POST' && !url.searchParams.has('space') ? undefined : spaceSchema.parse(url.searchParams.get('space'));
    if (request.method === 'GET') {
      if(path.length===3&&path[0]==='requests'&&path[2]==='private-note-erasure') {
        const id=reference.parse(path[1]),result=rights.privateNoteErasureStatus(user.id,id,space!);
        return respondLocal(result,()=>rights.assertPrivateNoteErasurePublication(user.id,id,space!,result));
      }
      if (path.length === 3 && path[0] === 'requests' && path[2] === 'local-use') {
        const requestId = reference.parse(path[1]), scope = { space: space!, purpose: localUsePurposeSchema.parse(url.searchParams.get('purpose')) };
        const result = rights.localUseStatus(user.id, requestId, scope);
        return respondLocal(result, () => rights.assertLocalUsePublication(user.id,requestId,scope,result));
      }
      if (route === '') return respond(rights.snapshot(user.id, space!));
      if (path.length === 2 && path[0] === 'requests') return respond(rights.detail(user.id, space!, reference.parse(path[1])));
      if (route === 'operations/requests') {const result=await rights.operations(user.id,url.searchParams.get('cursor')??undefined);return respondLocal(result,()=>rights.assertErasureOperationsPublication(user.id,result));}
      return json({ error: 'not_found' }, 404);
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    const expectedOrigin = trustedStudioRequestOrigin(url, studio.deps.webAppUrl);
    if (!expectedOrigin) return json({ error: 'origin_unavailable' }, 503);
    if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, 4096);
    let body: unknown;
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_request' }, 400); }
    assertAuthenticatedNow();
    if(path.length===4&&path[0]==='requests'&&path[2]==='private-note-erasure') {
      const id=reference.parse(path[1]);
      if(path[3]==='plan'){const result=rights.privateNoteErasurePlan(user.id,id,space!,localErasurePlanInputSchema.parse(body));return respondLocal(result,()=>rights.assertPrivateNoteErasurePlanPublication(user.id,id,space!,result));}
      if(path[3]==='execute'){const result=await rights.privateNoteErasureExecute(user.id,id,space!,localErasureExecuteInputSchema.parse(body));return respondLocal(result,()=>rights.assertPrivateNoteErasurePublication(user.id,id,space!,result));}
    }
    if(path.length===5&&path[0]==='operations'&&path[1]==='requests'&&path[3]==='private-note-erasure'&&path[4]==='reconcile') {
      const input=localErasureReconcileInputSchema.parse(body),id=reference.parse(path[2]);const result=await rights.reconcilePrivateNoteErasure(user.id,id,input.operationHandle,input.commandEventId,input.eventId);
      return respondLocal(result,()=>rights.assertPrivateNoteErasureOperatorPublication(user.id,id,input.operationHandle,result));
    }
    if (path.length === 4 && path[0] === 'requests' && path[2] === 'local-use') {
      const requestId = reference.parse(path[1]);
      if (path[3] === 'plan') return respond(rights.localUsePlan(user.id, requestId, space!, localUsePlanInputSchema.parse(body)));
      if (path[3] === 'actions') {
        const result = await rights.localUseAction(user.id,requestId,space!,localUseActionInputSchema.parse(body));
        return respondLocal(result, () => rights.assertLocalUsePublication(user.id,requestId,result.status.scope,result));
      }
    }
    if (path.length === 5 && path[0] === 'operations' && path[1] === 'requests' && path[3] === 'local-use' && path[4] === 'reconcile') {
      const input = localUseReconcileInputSchema.parse(body), requestId = reference.parse(path[2]);
      const result = await rights.reconcileLocalUse(user.id,requestId,input.operationHandle,input.commandEventId);
      return respondLocal(result,()=>rights.assertLocalUseOperatorPublication(user.id,requestId,input.operationHandle,result));
    }
    if (route === 'requests') {
      const input = createInputSchema.parse(body);
      if (space !== undefined && input.space !== space) return json({ error: 'invalid_request' }, 400);
      const result = await rights.create(user.id, input);
      // Pet care (toy needs, Bond, zone and visit times; no conversation content) has no review step:
      // an erasure request deletes it for every agent at once, whatever the space, and a later
      // withdrawal cannot bring it back (the pet page's "forget me" does the same on its own). The
      // request itself still goes to review. The request is filed either way: a pet store failure is
      // logged and retried by replaying the request (idempotent).
      if (input.kind === 'erasure') { await erasePetCare(studio, user.id); await eraseAgentChoices(studio, user.id); await eraseCircles(studio, user.id); await eraseNotes(studio, user.id); }
      return respond(result, result.replayed ? 200 : 201);
    }
    if (path.length === 3 && path[0] === 'requests' && path[2] === 'actions') {
      const result = await rights.requesterAction(user.id, space!, reference.parse(path[1]), requesterActionSchema.parse(body));
      // Pet care is per person and agent, not per space: every export carries all of it. Read
      // before the fences below, which must stay free of awaits. A pet store failure never fails the
      // export: it says the pet part is missing instead.
      const petCare = result.prepared ? { ...await petCareForExport(studio, user.id), ...await agentChoicesForExport(studio, user.id), ...await circlesForExport(studio, user.id), ...await notesForExport(studio, user.id) } : undefined;
      if (result.prepared) {
        // Serialization precedes the last synchronous authority check. There is
        // no await between this fence and constructing the attachment response.
        let root = true;
        // The replacer sees the root after its own toJSON, so the export serializes exactly as before plus petCare.
        const serialized = JSON.stringify(result.prepared.data, (_key, value: unknown) => {
          if (!root) return value;
          root = false;
          return { ...(value as object), ...petCare };
        });
        assertRightsAccountNow(studio, user.id, 'export');
        result.prepared.revalidate();
        assertRightsAccountNow(studio, user.id, 'export');
        assertAuthenticatedNow();
        return new Response(serialized, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
          'Content-Disposition': `attachment; filename="vox-${space}-export.json"`, 'X-Vox-Rights-Request-Id': path[1] } });
      }
      return respond(result.result);
    }
    if (path.length === 4 && path[0] === 'operations' && path[1] === 'requests' && path[3] === 'retention')
      return respond(await rights.retentionAction(user.id, reference.parse(path[2]), retentionActionSchema.parse(body)));
    if (path.length === 4 && path[0] === 'operations' && path[1] === 'requests' && path[3] === 'actions')
      return respond(await rights.operatorAction(user.id, reference.parse(path[2]), operatorActionSchema.parse(body)));
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (isSchemaValidationError(error)) return json({ error: 'invalid_request' }, 400);
    if (RightsUseHoldError.is(error)) return json({ error: 'rights_local_use_' + error.code }, ['conflict','capacity','authority_changed'].includes(error.code) ? 409 : 503);
    if (RightsError.is(error)) return json({ error: error.code }, error.status);
    if (AdaptiveError.is(error) || SharedMemoryError.is(error)) return json({ error: 'export_unavailable' }, error.status === 503 ? 503 : 409);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    return json({ error: 'rights_unavailable' }, 503);
  }
}
