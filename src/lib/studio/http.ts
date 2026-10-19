/**
 * HTTP router for the Vox Studio API (/api/studio/...). Framework-light so it
 * can be tested with plain Request objects.
 */

import { verifyInitData } from './auth';
import { StudioRateLimiter, StudioRateLimitError, type StudioRequestRateLimiter } from './ratelimit';
import { Studio, StudioError } from './service';
import { PersonaGenerationError } from './persona';
import type { AgentVisibility, Member, MemoryPolicy, Role, SpawnBrief } from './types';

type Json = Record<string, unknown>;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const MAX_STUDIO_JSON_BYTES = 256 * 1024;
export const MAX_STUDIO_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Count actual bytes before JSON or multipart parsing, including chunked input. */
export async function boundedStudioRequest(req: Request, maxBytes = req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')
  ? MAX_STUDIO_UPLOAD_BYTES : MAX_STUDIO_JSON_BYTES): Promise<Request> {
  if (!req.body) return req;
  const tooLarge = () => new StudioError(413, 'That upload is too large.');
  const length = req.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
    void req.body.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const reader = req.body.getReader();
  let bytes = new Uint8Array(Math.min(maxBytes, 64 * 1024));
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextSize = size + value.byteLength;
      if (nextSize > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      if (nextSize > bytes.byteLength) {
        const larger = new Uint8Array(Math.min(maxBytes, Math.max(nextSize, bytes.byteLength * 2)));
        larger.set(bytes.subarray(0, size));
        bytes = larger;
      }
      bytes.set(value, size);
      size = nextSize;
    }
  } catch (error) {
    if (StudioError.is(error)) throw error;
    throw new StudioError(400, 'The request body could not be read.');
  } finally {
    reader.releaseLock();
  }
  return new Request(req.url, { method: req.method, headers: req.headers, body: bytes.slice(0, size).buffer, signal: req.signal });
}

async function body(req: Request): Promise<Json> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === 'object' ? (parsed as Json) : {};
  } catch {
    throw new StudioError(400, 'Invalid JSON body');
  }
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export interface RouterOptions {
  botToken: string;
  /** Local development only: act as this Telegram user without initData */
  devUser?: { id: number; first_name: string } | null;
  /** Shared for the lifetime of this Studio; injectable for clock/policy tests. */
  rateLimiter?: StudioRequestRateLimiter;
}

const rateLimiters = new WeakMap<Studio, StudioRateLimiter>();

function rateLimiterFor(studio: Studio, opts: RouterOptions): StudioRequestRateLimiter {
  if (opts.rateLimiter) return opts.rateLimiter;
  if (studio.deps.rateLimiter) return studio.deps.rateLimiter;
  let limiter = rateLimiters.get(studio);
  if (!limiter) {
    limiter = new StudioRateLimiter();
    rateLimiters.set(studio, limiter);
  }
  return limiter;
}

async function authenticate(studio: Studio, req: Request, opts: RouterOptions, limiter: StudioRequestRateLimiter): Promise<Member> {
  const initData = req.headers.get('x-telegram-init-data') ?? '';
  if (initData.length > 16_384) throw new StudioError(401, 'Open Vox Studio from Telegram.');
  const user = verifyInitData(initData, opts.botToken) ?? (initData ? null : opts.devUser ?? null);
  if (!user) throw new StudioError(401, 'Open Vox Studio from Telegram.');
  // Throttle verified identities before ensureMember can touch persistent state.
  await limiter.consume('api', user.id);
  return studio.ensureMember(user);
}

export async function handleStudioRequest(studio: Studio, req: Request, path: string[], opts: RouterOptions): Promise<Response> {
  const method = req.method.toUpperCase();
  try {
    const limiter = rateLimiterFor(studio, opts);
    await limiter.consume('ingress', 'all');
    // Media is addressed by unguessable file names so <img>/<audio> can load it.
    if (method === 'GET' && path[0] === 'media' && path[1]) {
      const data = await studio.deps.store.readMedia(path[1]);
      if (!data) return json({ error: 'Not found' }, 404);
      const type = path[1].endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg';
      return new Response(new Uint8Array(data), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }

    const me = await authenticate(studio, req, opts, limiter);
    const [root, id, action] = path;

    if (root === 'me' && method === 'GET') {
      return json({ member: me, org: studio.deps.orgName, bot: studio.deps.managerUsername, features: {
        avatars: !!studio.deps.openai, voices: !!studio.deps.eleven, calls: !!studio.deps.openai || !!studio.deps.eleven, liveCalls: studio.liveCalls,
      } });
    }
    if (me.role === 'pending') throw new StudioError(403, 'Waiting for an admin to approve you.');

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) await limiter.consume('mutation', me.telegramId);
    const generation = root === 'agents' && method === 'POST' && (!id || ['refine', 'avatars', 'voice', 'speak', 'test', 'call', 'live-call'].includes(action));
    const voiceSearch = root === 'voices' && method === 'GET';
    if (generation || voiceSearch) await limiter.consume('expensive', me.telegramId);
    if (generation && action === 'avatars') await limiter.consume('avatar', me.telegramId);
    if (voiceSearch || (generation && ['voice', 'speak'].includes(action))) await limiter.consume('voice', me.telegramId);
    if (generation && ['call', 'test', 'live-call'].includes(action)) await limiter.consume('call', me.telegramId);
    req = await boundedStudioRequest(req);

    if (root === 'members') {
      if (!id && method === 'GET') return json(await studio.listMembers(me));
      if (id && method === 'PUT') {
        const b = await body(req);
        return json({ member: await studio.setRole(me, Number(id), str(b.role, 20) as Role) });
      }
    }
    if (root === 'groups' && method === 'GET') return json({ groups: await studio.listGroups(me) });
    if (root === 'audit' && method === 'GET') return json({ audit: await studio.auditLog(me) });
    if (root === 'voices' && method === 'GET') {
      const q = new URL(req.url).searchParams;
      return json({ voices: await studio.searchVoices(me, {
        gender: q.get('gender') ?? undefined, age: q.get('age') ?? undefined, accent: q.get('accent') ?? undefined,
        language: q.get('language') ?? undefined, search: q.get('search') ?? undefined,
      }) });
    }

    if (root === 'agents') {
      if (!id) {
        if (method === 'GET') return json({ agents: await studio.listAgents(me) });
        if (method === 'POST') {
          const b = await body(req);
          return json(await studio.draft(me, (b.brief ?? {}) as SpawnBrief, str(b.successorOf, 40)), 201);
        }
      }
      if (id && !action) {
        if (method === 'GET') return json({ agent: await studio.getAgent(me, id) });
        if (method === 'PATCH') return json({ agent: await studio.updatePersona(me, id, ((await body(req)).persona ?? {}) as Json) });
        if (method === 'DELETE') { await studio.deleteDraft(me, id); return json({ ok: true }); }
      }
      if (id && action) {
        switch (`${method} ${action}`) {
          case 'POST refine': return json({ agent: await studio.refine(me, id, str((await body(req)).instruction, 500) ?? '') });
          case 'POST look': {
            const b = await body(req);
            return json({ agent: await studio.setLook(me, id, b.random ? 'random' : (b.look ?? {}) as Json) });
          }
          case 'POST avatars': return json({ agent: await studio.generateAvatars(me, id, Number((await body(req)).count ?? 2)) });
          case 'PUT avatar': return json({ agent: await studio.chooseAvatar(me, id, str((await body(req)).file, 140) ?? null) });
          case 'POST avatar-upload': {
            const form = await req.formData().catch(() => { throw new StudioError(400, 'Expected an image upload'); });
            const file = form.get('image');
            if (!(file instanceof Blob)) throw new StudioError(400, 'Expected an image upload');
            return json({ agent: await studio.uploadAvatar(me, id, Buffer.from(await file.arrayBuffer()), file.type) });
          }
          case 'POST voice': {
            const b = await body(req);
            if (b.action === 'design') return json({ agent: await studio.designVoices(me, id, str(b.description, 1000)) });
            if (b.action === 'choose-design') return json({ agent: await studio.chooseDesignedVoice(me, id, str(b.generatedVoiceId, 200) ?? '') });
            if (b.action === 'choose-library') {
              return json({ agent: await studio.chooseLibraryVoice(me, id, {
                publicOwnerId: str(b.publicOwnerId, 200) ?? '', voiceId: str(b.voiceId, 200) ?? '', name: str(b.name, 60) ?? 'Voice',
              }) });
            }
            throw new StudioError(400, 'Unknown voice action');
          }
          case 'POST speak': {
            const audio = await studio.previewSpeech(me, id, str((await body(req)).text, 300) ?? '');
            return new Response(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
          }
          case 'POST test': {
            const b = await body(req);
            const messages = Array.isArray(b.messages) ? (b.messages as Array<{ role: string; content: string }>)
              .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
              .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })) : [];
            return json({ reply: await studio.testChat(me, id, messages) });
          }
          case 'POST publish': return json(await studio.publish(me, id));
          case 'PUT access': {
            const b = await body(req);
            return json({ agent: await studio.setAccess(me, id, b.access === 'everyone' ? 'everyone' : (b.access as number[])) });
          }
          case 'PUT visibility': {
            const b = await body(req);
            return json({ agent: await studio.setVisibility(me, id, str(b.visibility, 10) as AgentVisibility) });
          }
          case 'POST live-call': return json(await studio.startLiveCall(me, id));
          case 'POST call-end': await studio.endLiveCall(me, id); return json({ ok: true });
          case 'PUT live-web': return json({ agent: await studio.setLiveWeb(me, id, (await body(req)).on === true) });
          case 'POST profile-sync': return json(await studio.syncProfile(me, id));
          case 'DELETE blocked': {
            const telegramId = Number(new URL(req.url).searchParams.get('telegramId'));
            if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new StudioError(400, 'Invalid Telegram id');
            return json({ agent: await studio.unblock(me, id, telegramId) });
          }
          case 'PUT admin': return json({ agent: await studio.setAgentAdmin(me, id, (await body(req)).isAdmin === true) });
          case 'POST fire': {
            const b = await body(req);
            return json({ agent: await studio.fire(me, id, {
              reason: str(b.reason, 300) ?? '', memoryPolicy: str(b.memoryPolicy, 20) as MemoryPolicy, confirmName: str(b.confirmName, 60) ?? '',
            }) });
          }
          case 'GET group-link': return json({ link: await studio.groupLink(me, id) });
          case 'POST call': {
            const form = await req.formData().catch(() => { throw new StudioError(400, 'Expected audio'); });
            const audio = form.get('audio');
            if (!(audio instanceof Blob)) throw new StudioError(400, 'Expected audio');
            return json(await studio.callTurn(me, id, await audio.arrayBuffer(), audio.type || 'audio/webm'));
          }
          case 'GET memories': return json({ memories: await studio.memoriesFor(me, id) });
          case 'DELETE memories': {
            const memoryId = new URL(req.url).searchParams.get('memoryId') ?? '';
            await studio.forgetMemory(me, id, memoryId);
            return json({ ok: true });
          }
        }
      }
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    if (error instanceof StudioRateLimitError) return json({ error: error.message }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    if (StudioError.is(error)) return json({ error: error.message }, error.status);
    if (error instanceof PersonaGenerationError) {
      (studio.deps.logger ?? console).warn('[studio] persona generation invalid', { invalidFields: error.invalidFields });
      return json({ error: error.message }, 502);
    }
    if (error && typeof error === 'object' && 'issues' in error) return json({ error: "Claude's answer didn't fit the persona format. Try again." }, 502);
    const provider = providerErrorMessage(error);
    (studio.deps.logger ?? console).error('[studio] request failed', error);
    if (provider) return json({ error: provider }, 502);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
}

/**
 * Failures from Claude, OpenAI or ElevenLabs, said plainly so whoever runs the
 * server knows what to fix (bad key, no credit, unknown model, overload).
 * Never includes keys: only status codes and the provider's own message.
 */
export function providerErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  // OpenAI / ElevenLabs adapters throw "<Provider> <action> failed: …"
  if (/^(OpenAI|ElevenLabs) .*failed/.test(error.message)) {
    const status = Number(error.message.match(/HTTP (\d{3})/)?.[1] ?? NaN);
    const key = error.message.startsWith('OpenAI') ? 'OPENAI_API_KEY' : 'ELEVENLABS_API_KEY';
    if (status === 401 || status === 403) return `${error.message.split(':')[0]}: the server's ${key} was rejected. Check it is valid.`;
    if (status === 429) return `${error.message.split(':')[0]}: rate limited or out of credit. Try again later.`;
    return error.message.slice(0, 300);
  }
  // Anthropic SDK API errors carry a numeric status and the API's error body.
  const api = error as Error & { status?: unknown; error?: { error?: { type?: string; message?: string } } };
  if (error.name === 'APIConnectionError' || error.name === 'APIConnectionTimeoutError' || error.constructor?.name?.startsWith('APIConnection')) {
    return "The server can't reach Claude right now (network or timeout). Try again shortly.";
  }
  if (typeof api.status !== 'number' || !('error' in api)) return null;
  const detail = api.error?.error?.message ?? '';
  if (api.status === 401) return "Claude rejected the server's ANTHROPIC_API_KEY. Check it is valid and not revoked.";
  if (api.status === 403) return "This Anthropic API key isn't allowed to use that Claude model.";
  if (api.status === 404) return `Claude model not found${detail ? ` (${detail})` : ''}. Check STUDIO_PERSONA_MODEL / STUDIO_CHAT_MODEL.`;
  if (/credit balance/i.test(detail)) return 'The Anthropic account is out of credit. Add credit, then try again.';
  if (api.status === 429) return 'Claude is rate-limiting this server. Try again in a minute.';
  if (api.status === 529 || api.status >= 500) return 'Claude is overloaded right now. Try again shortly.';
  return `Claude returned an error (${api.status})${detail ? `: ${detail.slice(0, 200)}` : ''}.`;
}
