import { GuestRightsService } from '../adaptive/guest-rights/service';
import { credentialInputSchema, createSchema, closeSchema, operatorInputSchema } from '../adaptive/guest-rights/contracts';
import { RightsError, fail } from '../adaptive/rights-intake/repository';
import { verifyInitData } from './auth';
import { StudioRateLimiter, StudioRateLimitError } from './ratelimit';
import { isSchemaValidationError } from '../error-contract';
import { trustedStudioRequestOrigin } from './request-origin';
const limiter = new StudioRateLimiter();
const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...extra } });
/** Independent 4KiB JSON reader: importing Studio's router would load provider modules. */
async function readGuestBody(request: Request): Promise<unknown> {
    const length = request.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return fail(400, 'invalid_request');
    if (length && Number(length) > 4096) return fail(413, 'guest_request_too_large');
    const reader = request.body?.getReader();
    if (!reader) return fail(400, 'invalid_request');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
        while (true) { const part = await reader.read(); if (request.signal.aborted) return fail(409, 'guest_request_aborted'); if (part.done) break; bytes += part.value.byteLength; if (bytes > 4096) { await reader.cancel(); return fail(413, 'guest_request_too_large'); } chunks.push(part.value); }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch (error) { if (RightsError.is(error)) throw error; return fail(400, 'invalid_request'); }
    finally { reader.releaseLock(); }
}
/** Payloads are never logged; credential-bearing routes reject every query string. */
export async function handleGuestRightsRequest(service: GuestRightsService | undefined, request: Request, path: string[], botToken: string, trustedWebAppUrl?: string): Promise<Response> {
    try {
        await limiter.consume('ingress', 'guest-rights');
        const url = new URL(request.url), route = path.join('/');
        if (url.search)
            return json({ error: 'invalid_request' }, 400);
        if (!service) {
            if (request.method === 'GET' && !route)
                return json({ available: false, supportedKinds: [], supportContact: 'info@joyixir.com' });
            return json({ error: 'guest_unavailable' }, 503);
        }
        const operator = path[0] === 'operations';
        let operatorId: number | undefined;
        const auth = request.headers.get('x-telegram-init-data') ?? '';
        const guard = () => { if (request.signal.aborted)
            return fail(409, 'guest_request_aborted'); if (operator) {
            const user = botToken && auth.length <= 16384 ? verifyInitData(auth, botToken) : null;
            if (!user || operatorId !== undefined && user.id !== operatorId)
                return fail(401, 'authentication_required');
            operatorId = user.id;
        } };
        guard();
        const scoped = service.forRequest(guard);
        const respond = (value: unknown, status = 200) => { const serialized = JSON.stringify(value); guard(); if (operator)
            scoped.operations(operatorId!); return new Response(serialized, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } }); };
        if (request.method === 'GET') {
            if (!route)
                return respond({ ...scoped.notice(), supportContact: 'info@joyixir.com' });
            if (route === 'operations/requests')
                return respond(scoped.operations(operatorId!));
            return json({ error: 'not_found' }, 404);
        }
        if (request.method !== 'POST')
            return json({ error: 'not_found' }, 404);
        const trustedOrigin = trustedStudioRequestOrigin(url, trustedWebAppUrl);
        if (!trustedOrigin) return json({ error: 'guest_origin_unavailable' }, 503);
        if (request.headers.get('origin') !== trustedOrigin || request.headers.get('sec-fetch-site') === 'cross-site')
            return json({ error: 'origin_denied' }, 403);
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
            return json({ error: 'json_required' }, 415);
        await limiter.consume('mutation', operator ? `guest-operator:${operatorId}` : 'guest-public');
        if (route === 'draft') {
            const bounded = await readGuestBody(request);
            let body;
            try {
                body = bounded;
            }
            catch {
                return json({ error: 'invalid_request' }, 400);
            }
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('version' in body) || body.version !== 1)
                return json({ error: 'invalid_request' }, 400);
            guard();
            return respond(scoped.draft());
        }
        const bounded = await readGuestBody(request);
        let body: unknown;
        try {
            body = bounded;
        }
        catch {
            return json({ error: 'invalid_request' }, 400);
        }
        guard();
        if (route === 'status') {
            const input = credentialInputSchema.parse(body), result = scoped.status(input);
            return respond(result, 'expired' in result ? 410 : 200);
        }
        if (route === 'requests') {
            const input = createSchema.parse(body), result = await scoped.create(input), current = scoped.status({ version: 1, requestId: input.requestId, credential: input.credential });
            return respond({ ...current, ...(!('expired' in current) && !('expired' in result) ? { replayed: result.replayed } : {}) }, 'expired' in current ? 410 : !('expired' in result) && result.replayed ? 200 : 201);
        }
        if (route === 'close') {
            const input = closeSchema.parse(body);
            await scoped.close(input);
            const current = scoped.status({ version: 1, requestId: input.requestId, credential: input.credential });
            return respond(current, 'expired' in current ? 410 : 200);
        }
        if (route === 'operations/actions') {
            const input = operatorInputSchema.parse(body);
            return respond(await scoped.operatorAction(operatorId!, input));
        }
        return json({ error: 'not_found' }, 404);
    }
    catch (error) {
        if (RightsError.is(error))
            return json({ error: error.code }, error.status);
        if (StudioRateLimitError.is(error))
            return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
        if (isSchemaValidationError(error))
            return json({ error: 'invalid_request' }, 400);
        return json({ error: 'guest_unavailable' }, 503);
    }
}
