/**
 * HTTP router for the Vox Studio API (/api/studio/...). Framework-light so it
 * can be tested with plain Request objects.
 */

import { verifyInitData } from './auth';
import { Studio, StudioError } from './service';
import type { Member, MemoryPolicy, Role, SpawnBrief } from './types';

type Json = Record<string, unknown>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

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
}

async function authenticate(studio: Studio, req: Request, opts: RouterOptions): Promise<Member> {
  const initData = req.headers.get('x-telegram-init-data') ?? '';
  const user = verifyInitData(initData, opts.botToken) ?? (initData ? null : opts.devUser ?? null);
  if (!user) throw new StudioError(401, 'Open Vox Studio from Telegram.');
  return studio.ensureMember(user);
}

export async function handleStudioRequest(studio: Studio, req: Request, path: string[], opts: RouterOptions): Promise<Response> {
  const method = req.method.toUpperCase();
  try {
    // Media is addressed by unguessable file names so <img>/<audio> can load it.
    if (method === 'GET' && path[0] === 'media' && path[1]) {
      const data = await studio.deps.store.readMedia(path[1]);
      if (!data) return json({ error: 'Not found' }, 404);
      const type = path[1].endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg';
      return new Response(new Uint8Array(data), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }

    const me = await authenticate(studio, req, opts);
    const [root, id, action] = path;

    if (root === 'me' && method === 'GET') {
      return json({ member: me, org: studio.deps.orgName, bot: studio.deps.managerUsername, features: {
        avatars: !!studio.deps.openai, voices: !!studio.deps.eleven, calls: !!studio.deps.openai,
      } });
    }
    if (me.role === 'pending') throw new StudioError(403, 'Waiting for an admin to approve you.');

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
    if (StudioError.is(error)) return json({ error: error.message }, error.status);
    if (error && typeof error === 'object' && 'issues' in error) return json({ error: "Claude's answer didn't fit the persona format. Try again." }, 502);
    (studio.deps.logger ?? console).error('[studio] request failed', error);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
}
