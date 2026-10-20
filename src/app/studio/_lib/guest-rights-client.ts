import { z } from 'zod';
import { viewSchema, kindSchema, integer, reference, credentialSchema, auditSchema } from '@/lib/adaptive/guest-rights/contracts';
const notice = z.object({ available: z.boolean(), supportedKinds: z.array(kindSchema).max(7), policyRevision: integer.positive().optional(), copyVersion: z.literal('guest-rights-gi1-v1').optional(), supportContact: z.literal('info@joyixir.com') }).strict().superRefine((p, c) => { if (p.available && (!p.policyRevision || p.copyVersion !== 'guest-rights-gi1-v1' || !p.supportedKinds.length))
    c.addIssue({ code: 'custom', message: 'Unavailable policy' }); });
const draft = z.object({ version: z.literal(1), requestId: reference, credential: credentialSchema, ticket: z.string().max(2048), expiresAt: integer, policyRevision: integer.positive() }).strict();
const current = z.object({ request: viewSchema, replayed: z.boolean() }).strict();
const expired = z.object({ expired: z.literal(true), requestId: reference, retainUntil: integer }).strict();
const queue = z.object({ requests: z.array(viewSchema.extend({ operationHandle: z.string().max(2048), audit: z.array(auditSchema.omit({ actorRef: true })).max(32) })).max(100), policyRevision: integer.positive(), admissionEnabled: z.boolean() }).strict();
export type GuestDraft = z.infer<typeof draft>;
export type GuestNotice = z.infer<typeof notice>;
export type GuestCurrent = z.infer<typeof current> | z.infer<typeof expired>;
export type GuestQueue = z.infer<typeof queue>;
export class GuestClientError extends Error {
    constructor(readonly status: number) { super('guest_request_unavailable'); }
}
async function request<T>(route: string, schema: z.ZodType<T>, body: unknown | undefined, signal?: AbortSignal, auth?: string): Promise<T> { const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted)
    controller.abort(); const timer = setTimeout(abort, 15000); try {
    const response = await fetch('/api/guest-rights' + (route ? '/' + route : ''), { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(auth ? { 'x-telegram-init-data': auth } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    if (!response.ok && response.status !== 410)
        throw new GuestClientError(response.status);
    const raw = await response.json();
    return schema.parse(raw);
}
finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
} }
export const guestRightsApi = { notice: (signal?: AbortSignal) => request('', notice, undefined, signal), draft: (signal?: AbortSignal) => request('draft', draft, { version: 1 }, signal), create: (body: unknown, signal?: AbortSignal) => request('requests', z.union([current, expired]), body, signal), status: (body: unknown, signal?: AbortSignal) => request('status', z.union([current, expired]), body, signal), close: (body: unknown, signal?: AbortSignal) => request('close', z.union([current, expired]), body, signal), operations: (auth: string, signal?: AbortSignal) => request('operations/requests', queue, undefined, signal, auth), operate: (auth: string, body: unknown, signal?: AbortSignal) => request('operations/actions', z.object({ requestId: reference, replayed: z.boolean() }).strict(), body, signal, auth) };
