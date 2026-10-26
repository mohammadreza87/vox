'use client';

/**
 * The pet API client (brief §3.8): every call carries X-Telegram-Init-Data and the user's zone in
 * x-pet-tz. `?mock=1` swaps in the in-memory fake (mock.ts) for demos and the lab, so the page runs
 * with no server and no Telegram; it is imported on demand, so production pages never download it.
 */

import {
  PET_API_BASE, PET_TZ_HEADER,
  type CareRequest, type CareResponse, type PetErrorBody, type PetErrorCode, type PetView,
  type TalkRequest, type TalkResponse, type TalkVoiceResponse,
} from '@/lib/pet/types';
import type { PetApi, PetRequestOpts } from './contract';
import { PetError } from './errors';
import type { MockOptions } from './mock';
import { tg } from './telegram';

export { PetError, isPetError } from './errors';

/** The user's IANA zone (quiet hours are local): sent on every request, GET included. */
export function petTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const STATUS_CODE: Record<number, PetErrorCode> = { 401: 'authentication_required', 403: 'pet_private', 404: 'pet_unavailable', 429: 'rate_limited' };

interface HttpDeps { fetch?: typeof fetch; initData?: () => string; tz?: () => string }

export function createHttpApi(d: HttpDeps = {}): PetApi {
  const doFetch = d.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const initData = d.initData ?? (() => tg()?.initData ?? '');
  const tz = d.tz ?? petTz;
  const epochs = new Map<string, string>();
  const url = (agentId: string, action?: string) => `${PET_API_BASE}/${encodeURIComponent(agentId)}${action ? `/${action}` : ''}`;

  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, o?: PetRequestOpts, epoch?: string): Promise<T> {
    const headers: Record<string, string> = { 'X-Telegram-Init-Data': initData(), [PET_TZ_HEADER]: tz(), Accept: 'application/json', ...(epoch ? { 'x-pet-care-epoch': epoch } : {}) };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res: Response;
    try {
      res = await doFetch(path, { method, headers, body: payload, ...(o?.signal ? { signal: o.signal } : {}), ...(o?.keepalive ? { keepalive: true } : {}) });
    } catch (e) {
      throw new PetError(0, 'network', e instanceof Error ? e.message : 'Network error');
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const b = json && typeof json === 'object' && 'error' in json && typeof json.error === 'string' ? json as PetErrorBody : undefined;
      const code = b?.error ?? STATUS_CODE[res.status] ?? 'invalid_request';
      throw new PetError(res.status, code, b?.message ?? `Request failed (${res.status})`, b);
    }
    if (json === null) throw new PetError(res.status, 'network', 'Unreadable response');
    return json as T;
  }

  return {
    get: async (agentId, o) => {
      const view = await call<PetView>('GET', url(agentId), undefined, o);
      epochs.set(agentId, view.careEpoch ?? 'initial');
      return view;
    },
    care: (agentId, req: CareRequest, o) => call<CareResponse>('POST', url(agentId, 'care'), req, o, epochs.get(agentId)),
    talk: (agentId, req: TalkRequest, o) => call<TalkResponse>('POST', url(agentId, 'talk'), req, o, epochs.get(agentId)),
    talkVoice: (agentId, audio, o) => {
      const form = new FormData();
      form.append('audio', audio, `voice.${audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'}`);
      return call<TalkVoiceResponse>('POST', url(agentId, 'talk-voice'), form, o, epochs.get(agentId));
    },
    send: (agentId, method, action, body, o) => call(method, url(agentId, action), body, o),
  };
}

/** `?mock=1` (and the knobs mock.ts reads: look, stage, role, welcome, stageup). */
export function mockOptions(search: string): MockOptions | null {
  const q = new URLSearchParams(search);
  if (q.get('mock') !== '1') return null;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const role = q.get('role');
  return {
    look: num('look'),
    stage: num('stage'),
    role: role === 'guest' || role === 'private' || role === 'outside' ? role : undefined,
    welcome: q.get('welcome') === '1',
    stageUp: q.get('stageup') === '1',
  };
}

export function createPetApi(search = typeof location === 'undefined' ? '' : location.search): PetApi {
  const mock = mockOptions(search);
  if (!mock) return createHttpApi();
  const fake = import('./mock').then((m) => m.createMockApi(mock));
  return {
    get: async (agentId, o) => (await fake).get(agentId, o),
    care: async (agentId, req, o) => (await fake).care(agentId, req, o),
    talk: async (agentId, req, o) => (await fake).talk(agentId, req, o),
    talkVoice: async (agentId, audio, o) => (await fake).talkVoice(agentId, audio, o),
    send: async (agentId, method, action, body, o) => (await fake).send!(agentId, method, action, body, o),
  };
}
