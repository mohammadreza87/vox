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
      return respond(result, result.replayed ? 200 : 201);
    }
    if (path.length === 3 && path[0] === 'requests' && path[2] === 'actions') {
      const result = await rights.requesterAction(user.id, space!, reference.parse(path[1]), requesterActionSchema.parse(body));
      if (result.prepared) {
        // Serialization precedes the last synchronous authority check. There is
        // no await between this fence and constructing the attachment response.
        const serialized = JSON.stringify(result.prepared.data);
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
