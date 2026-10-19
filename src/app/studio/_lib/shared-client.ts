'use client';
import type { SharedSnapshot, SharedPreview, SharedPreviewInput, SharedCreateInput, SharedMutation } from '@/lib/adaptive/shared/contracts';
import { request } from './client';
export type { SharedSnapshot, SharedPreview };
export const sharedApi = {
  list: (space: 'work' | 'personal') => request<SharedSnapshot>('GET', `shared?space=${space}`),
  preview: (input: SharedPreviewInput) => request<SharedPreview>('POST', 'shared/preview', input),
  create: (input: SharedCreateInput) => request<SharedSnapshot>('POST', 'shared/containers', input),
  add: (id: string, input: SharedMutation & { text: string }) => request<SharedSnapshot>('POST', `shared/containers/${encodeURIComponent(id)}/memories`, input),
  remove: (id: string, memoryId: string, input: SharedMutation) => request<SharedSnapshot>('DELETE', `shared/containers/${encodeURIComponent(id)}/memories/${encodeURIComponent(memoryId)}`, input),
  revoke: (id: string, telegramId: number, input: SharedMutation) => request<SharedSnapshot>('POST', `shared/containers/${encodeURIComponent(id)}/participants/${telegramId}`, { ...input, revoked: true }),
  agent: (id: string, agentId: string, allowed: boolean, input: SharedMutation) => request<SharedSnapshot>('POST', `shared/containers/${encodeURIComponent(id)}/agents/${encodeURIComponent(agentId)}`, { ...input, allowed }),
};
