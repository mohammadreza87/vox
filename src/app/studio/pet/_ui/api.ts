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
import type { GrowthConfirmResponse, LookResponse } from '@/lib/pet/types';
import type { CheckinPrefs, PetApi, PetRequestOpts, PlayResponse } from './contract';
import { PetError } from './errors';
import type { MockOptions } from './mock';
import { tg } from './telegram';

export { PetError, isPetError } from './errors';

/** The user's IANA zone (quiet hours are local): sent on every request, GET included. */
export function petTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const STATUS_CODE: Record<number, PetErrorCode> = { 401: 'authentication_required', 403: 'pet_private', 404: 'pet_unavailable', 429: 'rate_limited' };

/** A response's JSON, or the PetError its status and body say (shared with the voice stream reader). */
export async function readJson<T>(res: Response): Promise<T> {
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = json && typeof json === 'object' && 'error' in json && typeof json.error === 'string' ? json as PetErrorBody : undefined;
    const code = b?.error ?? STATUS_CODE[res.status] ?? 'invalid_request';
    throw new PetError(res.status, code, b?.message ?? `Request failed (${res.status})`, b);
  }
  if (json === null) throw new PetError(res.status, 'network', 'Unreadable response');
  return json as T;
}

interface HttpDeps { fetch?: typeof fetch; initData?: () => string; tz?: () => string; search?: () => string }

/** `?ci=<ref>` (a check-in's Open button, §5.1): an opaque reference passed on to GET, never identity. */
export const ciRef = (search: string) => { const r = new URLSearchParams(search).get('ci'); return r && /^[\w-]{1,64}$/.test(r) ? r : null; };

export function createHttpApi(d: HttpDeps = {}): PetApi {
  const doFetch = d.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const initData = d.initData ?? (() => tg()?.initData ?? '');
  const tz = d.tz ?? petTz;
  const search = d.search ?? (() => (typeof location === 'undefined' ? '' : location.search));
  const epochs = new Map<string, string>();
  const url = (agentId: string, action?: string) => `${PET_API_BASE}/${encodeURIComponent(agentId)}${action ? `/${action}` : ''}`;

  const head = (epoch?: string, accept = 'application/json'): Record<string, string> =>
    ({ 'X-Telegram-Init-Data': initData(), [PET_TZ_HEADER]: tz(), Accept: accept, ...(epoch ? { 'x-pet-care-epoch': epoch } : {}) });
  const voiceForm = (audio: Blob, handsFree?: boolean) => {
    const form = new FormData();
    form.append('audio', audio, `voice.${audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'}`);
    if (handsFree) form.append('handsFree', 'true');
    return form;
  };

  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, o?: PetRequestOpts, epoch?: string): Promise<T> {
    const headers = head(epoch);
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res: Response;
    try {
      res = await doFetch(path, { method, headers, body: payload, ...(o?.signal ? { signal: o.signal } : {}), ...(o?.keepalive ? { keepalive: true } : {}) });
    } catch (e) {
      throw new PetError(0, 'network', e instanceof Error ? e.message : 'Network error');
    }
    return readJson<T>(res);
  }

  return {
    get: async (agentId, o) => {
      const ci = ciRef(search());
      const view = await call<PetView>('GET', url(agentId) + (ci ? `?ci=${ci}` : ''), undefined, o);
      epochs.set(agentId, view.careEpoch ?? 'initial');
      return view;
    },
    care: (agentId, req: CareRequest, o) => call<CareResponse>('POST', url(agentId, 'care'), req, o, epochs.get(agentId)),
    talk: (agentId, req: TalkRequest, o) => call<TalkResponse>('POST', url(agentId, 'talk'), req, o, epochs.get(agentId)),
    talkVoice: (agentId, audio, o) => call<TalkVoiceResponse>('POST', url(agentId, 'talk-voice'), voiceForm(audio, o?.handsFree), o, epochs.get(agentId)),
    // the NDJSON reader loads with the first voice turn (never with the page)
    talkVoiceStream: async (agentId, audio, onEvent, o) => (await import('./voiceStream')).streamVoice(doFetch,
      `${url(agentId, 'talk-voice')}?stream=1`, head(epochs.get(agentId), 'application/x-ndjson, application/json'), voiceForm(audio, o?.handsFree), onEvent, o),
    play: (agentId, req, o) => call<PlayResponse>('POST', url(agentId, 'play'), req, o, epochs.get(agentId)),
    growthConfirm: (agentId, momentId, o) => call<GrowthConfirmResponse>('POST', url(agentId, 'growth/confirm'), { momentId }, o, epochs.get(agentId)),
    // a server without the route answers 404 pet_unavailable: that must never end the pet, so it is renamed
    // POSTs carry the care epoch like every pet mutation (the server fences them on it); GET answers the current one
    checkins: (agentId, req, o) => call<CheckinPrefs>(req ? 'POST' : 'GET', url(agentId, 'checkins'), req, o, req ? epochs.get(agentId) : undefined).catch((e: unknown) => {
      throw e instanceof PetError && e.status === 404 ? new PetError(404, 'checkins_unavailable', 'checkins_unavailable') : e;
    }),
    look: (agentId, req, o) => call<LookResponse>('POST', url(agentId, 'look'), req, o, epochs.get(agentId)),
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
    ...(q.get('ask') === 'mic' ? { askMic: true } : {}),
    // Wave C demos (mock.ts): ?garden=seeded|ready|bloom, ?ci=C5, ?checkins=on|paused, ?items=1; ?room= is the page's (Extras)
    ...['garden', 'ci', 'checkins'].reduce((o, k) => (q.get(k) ? { ...o, [k]: q.get(k) } : o), {}),
    ...(q.has('items') ? { items: true } : {}),
    // ?at=14: the demo clock reads today at 14:00 local (so a review at night is not a quiet-hours sleep)
    ...(/^([01]?\d|2[0-3])$/.test(q.get('at') ?? '') ? { now: mockClock(Number(q.get('at'))) } : {}),
  };
}

/** A clock that starts at `hour`:00 today and runs at real speed from there. */
export function mockClock(hour: number, start = Date.now()): () => number {
  const d = new Date(start); d.setHours(hour, 0, 0, 0);
  const off = d.getTime() - start;
  return () => Date.now() + off;
}

export function createPetApi(search = typeof location === 'undefined' ? '' : location.search): PetApi {
  const mock = mockOptions(search);
  if (!mock) return createHttpApi();
  const fake = import('./mock').then((m) => m.createMockApi(mock));
  const out: Record<string, unknown> = {};
  for (const k of ['get', 'care', 'talk', 'talkVoice', 'send', 'play', 'growthConfirm', 'checkins', 'look'] as const) out[k] = async (...a: unknown[]) => ((await fake)[k] as (...x: unknown[]) => unknown)(...a);
  return out as unknown as PetApi;
}
