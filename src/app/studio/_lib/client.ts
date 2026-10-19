'use client';

/**
 * Telegram Mini App bridge + typed API client for Vox Studio.
 */

import type { AgentView } from '@/lib/studio/service';
import type { DefaultVoice, LibraryVoice, VoiceOptions } from '@/lib/studio/media';
import type { AgentLook, AgentVisibility, GroupBehavior, Member, PersonaSpec, Role, SpawnBrief } from '@/lib/studio/types';

export type { AgentView, AgentLook, AgentVisibility, GroupBehavior, Member, PersonaSpec, Role, SpawnBrief };
export type { DefaultVoice, LibraryVoice, VoiceOptions };

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: TelegramUserInfo };
  ready(): void;
  expand(): void;
  colorScheme?: 'light' | 'dark';
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

export interface TelegramUserInfo { id: number; first_name: string; last_name?: string; username?: string }

/** The signed-in Telegram user as the client sees it (available even if the server is down). */
export function telegramUser(): TelegramUserInfo | null {
  return tg()?.initDataUnsafe?.user ?? null;
}

export function tg(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

export function initTelegram() {
  const app = tg();
  if (!app) return;
  app.ready();
  app.expand();
  app.setHeaderColor?.('#0E1013');
  app.setBackgroundColor?.('#0E1013');
  app.disableVerticalSwipes?.();
}

export const haptic = {
  tap: () => tg()?.HapticFeedback?.impactOccurred('light'),
  soft: () => tg()?.HapticFeedback?.impactOccurred('soft'),
  heavy: () => tg()?.HapticFeedback?.impactOccurred('heavy'),
  select: () => tg()?.HapticFeedback?.selectionChanged(),
  success: () => tg()?.HapticFeedback?.notificationOccurred('success'),
  warn: () => tg()?.HapticFeedback?.notificationOccurred('warning'),
  error: () => tg()?.HapticFeedback?.notificationOccurred('error'),
};

export function openTelegram(url: string) {
  const app = tg();
  // telegram-web-app.js defines WebApp in any browser; only a real Mini App
  // has initData. Outside Telegram, openTelegramLink would navigate this page away.
  if (app?.initData) app.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function request<T>(method: string, path: string, body?: unknown, responseType: 'json' | 'blob' = 'json', signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {
    'X-Telegram-Init-Data': tg()?.initData ?? '',
    Accept: responseType === 'blob' ? 'audio/*' : 'application/json',
  };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api/studio/${path}`, { method, headers, body: payload, ...(signal ? { signal } : {}) });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => null);
    const message = err && typeof err === 'object' && 'error' in err && typeof err.error === 'string'
      ? err.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  if (responseType === 'blob') return await res.blob() as T;
  const type = (res.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json' && !(type.startsWith('application/') && type.endsWith('+json'))) {
    throw new ApiError(res.status, 'Vox Studio returned an unexpected page. Close and reopen the Mini App, then try again.');
  }
  try {
    return await res.json() as T;
  } catch {
    throw new ApiError(res.status, 'Vox Studio returned unreadable data. Try again.');
  }
}

export interface Me {
  member: Member;
  org: string;
  bot: string;
  features: { avatars: boolean; voices: boolean; calls: boolean; liveCalls?: boolean; legacyMemorySharing?: boolean };
}

export interface MemoryItem { id: string; content: string; type: string; scope: string; scopeLabel: string; from: string; mine: boolean; at: string; sensitivity: string }
export interface GroupItem { chatId: number; title: string; hasGuests: boolean; memberCount: number; agents: Array<{ id: string; name: string; look: AgentLook }> }
export type RelationshipMode = 'off' | 'shadow' | 'live';
export type RelationshipSpace = 'work' | 'personal';
export interface RelationshipInboxItem { id: string; text: string; createdAt: number; expiresAt: number; status: 'unread' | 'read' | 'dismissed' }
export interface RelationshipView {
  available: boolean;
  mode: RelationshipMode;
  disabled: boolean;
  pausedUntil?: string;
  timeZone: string;
  quietHours: { start: number; end: number };
  preferences: Array<{ key: string; value: string }>;
  openSituations: number;
  pending: number;
  unanswered: number;
  space: RelationshipSpace;
  externalEnabled: boolean;
  externalAvailable: boolean;
  inbox: RelationshipInboxItem[];
  sources: Array<{ id: string; createdAt: number }>;
}

const enc = encodeURIComponent;

export const api = {
  relationshipObservations: () => request<{ mode: 'off' | 'shadow' | 'live'; sampledEvents: number; counts: Record<string, number>; feedbackOutcomes?: Record<string, number>; windowStart: string | null; windowEnd: string | null; scope: string }>('GET', 'relationship-observations'),
  me: () => request<Me>('GET', 'me'),
  agents: () => request<{ agents: AgentView[] }>('GET', 'agents'),
  agent: (id: string) => request<{ agent: AgentView }>('GET', `agents/${enc(id)}`),
  draft: (brief: SpawnBrief, successorOf?: string) => request<{ agent: AgentView; names: string[] }>('POST', 'agents', { brief, successorOf }),
  updatePersona: (id: string, persona: Partial<PersonaSpec>) => request<{ agent: AgentView }>('PATCH', `agents/${enc(id)}`, { persona }),
  deleteDraft: (id: string) => request<{ ok: true }>('DELETE', `agents/${enc(id)}`),
  refine: (id: string, instruction: string) => request<{ agent: AgentView }>('POST', `agents/${enc(id)}/refine`, { instruction }),
  setLook: (id: string, look: Partial<AgentLook> | 'random') =>
    request<{ agent: AgentView }>('POST', `agents/${enc(id)}/look`, look === 'random' ? { random: true } : { look }),
  generateAvatars: (id: string, count = 2) => request<{ agent: AgentView }>('POST', `agents/${enc(id)}/avatars`, { count }),
  chooseAvatar: (id: string, file: string | null) => request<{ agent: AgentView }>('PUT', `agents/${enc(id)}/avatar`, { file }),
  uploadAvatar: (id: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return request<{ agent: AgentView }>('POST', `agents/${enc(id)}/avatar-upload`, form);
  },
  designVoices: (id: string, description?: string) => request<{ agent: AgentView }>('POST', `agents/${enc(id)}/voice`, { action: 'design', description }),
  chooseDesignedVoice: (id: string, generatedVoiceId: string) =>
    request<{ agent: AgentView }>('POST', `agents/${enc(id)}/voice`, { action: 'choose-design', generatedVoiceId }),
  voiceOptions: () => request<VoiceOptions>('GET', 'voices/options'),
  chooseDefaultVoice: (id: string, voiceId: string) =>
    request<{ agent: AgentView }>('POST', `agents/${enc(id)}/voice`, { action: 'choose-default', voiceId }),
  chooseLibraryVoice: (id: string, v: LibraryVoice) =>
    request<{ agent: AgentView }>('POST', `agents/${enc(id)}/voice`, { action: 'choose-library', publicOwnerId: v.publicOwnerId, voiceId: v.voiceId, name: v.name }),
  searchVoices: (filters: Record<string, string>) =>
    request<{ voices: LibraryVoice[] }>('GET', `voices?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}`),
  speak: (id: string, text: string) => request<Blob>('POST', `agents/${enc(id)}/speak`, { text }, 'blob'),
  test: (id: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    request<{ reply: string }>('POST', `agents/${enc(id)}/test`, { messages }),
  publish: (id: string) => request<{ link: string; agent: AgentView }>('POST', `agents/${enc(id)}/publish`),
  setAccess: (id: string, access: 'everyone' | number[]) => request<{ agent: AgentView }>('PUT', `agents/${enc(id)}/access`, { access }),
  setVisibility: (id: string, visibility: AgentVisibility) => request<{ agent: AgentView }>('PUT', `agents/${enc(id)}/visibility`, { visibility }),
  setLiveWeb: (id: string, on: boolean) => request<{ agent: AgentView }>('PUT', `agents/${enc(id)}/live-web`, { on }),
  setGroupBehavior: (id: string, behavior: GroupBehavior) => request<{ agent: AgentView }>('PUT', `agents/${enc(id)}/group-behavior`, behavior),
  syncProfile: (id: string) => request<{ agent: AgentView; failed: string[] }>('POST', `agents/${enc(id)}/profile-sync`),
  unblock: (id: string, telegramId: number) => request<{ agent: AgentView }>('DELETE', `agents/${enc(id)}/blocked?telegramId=${telegramId}`),
  setAgentAdmin: (id: string, isAdmin: boolean) => request<{ agent: AgentView }>('PUT', `agents/${enc(id)}/admin`, { isAdmin }),
  fire: (id: string, input: { reason: string; memoryPolicy: string; confirmName: string }) =>
    request<{ agent: AgentView }>('POST', `agents/${enc(id)}/fire`, input),
  groupLink: (id: string) => request<{ link: string }>('GET', `agents/${enc(id)}/group-link`),
  callTurn: (id: string, audio: Blob, space: 'work' | 'personal' = 'work') => {
    const form = new FormData();
    form.append('audio', audio, 'turn');
    form.append('space', space);
    return request<{ transcript: string; reply: string; audio?: string; turnId?: string }>('POST', `agents/${enc(id)}/call`, form);
  },
  liveCall: (id: string, space: 'work' | 'personal' = 'work') => request<LiveCall>('POST', `agents/${enc(id)}/live-call`, { space }),
  callEnd: (id: string, space: 'work' | 'personal' = 'work') => request<{ ok: true }>('POST', `agents/${enc(id)}/call-end`, { space }),
  memories: (id: string) => request<{ memories: MemoryItem[] }>('GET', `agents/${enc(id)}/memories`),
  relationship: (id: string, space: RelationshipSpace = 'work') => request<{ relationship: RelationshipView }>('GET', `agents/${enc(id)}/relationship?space=${space}`),
  updateRelationship: (id: string, input: { space?: RelationshipSpace; action: 'pause' | 'resume' | 'stop' | 'forget' | 'external' | 'source-delete' | 'read' | 'dismiss'; until?: string; enabled?: boolean; sourceId?: string; itemId?: string }, space: RelationshipSpace = 'work') =>
    request<{ relationship: RelationshipView }>('PUT', `agents/${enc(id)}/relationship`, { ...input, space }),
  shareMemory: (id: string, memoryId: string, recipients: number[]) =>
    request<{ ok: true }>('PUT', `agents/${enc(id)}/memories`, { memoryId, recipients }),
  revokeMemory: (id: string, memoryId: string) =>
    request<{ ok: true }>('POST', `agents/${enc(id)}/revoke-memory`, { memoryId }),
  forget: (id: string, memoryId: string) => request<{ ok: true }>('DELETE', `agents/${enc(id)}/memories?memoryId=${enc(memoryId)}`),
  members: () => request<{ people: Member[]; agentAdmins: AgentView[] }>('GET', 'members'),
  setRole: (telegramId: number, role: Role) => request<{ member: Member }>('PUT', `members/${telegramId}`, { role }),
  groups: () => request<{ groups: GroupItem[] }>('GET', 'groups'),
};

export type LiveCall =
  | { live: false }
  | { live: true; signedUrl: string; callToken: string; voiceId: string; language?: string; firstMessage: string;
      partialPrediction?: import('@/lib/adaptive/prediction/voice-client').VoicePartialCapability };

export const mediaUrl = (file: string) => `/api/studio/media/${encodeURIComponent(file)}`;
