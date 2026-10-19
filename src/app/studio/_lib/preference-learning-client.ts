'use client';
import { request, tg } from './client';
import type { LearningPublicView, LearningPresentInput, LearningToggleInput, LearningReviewInput } from '@/lib/adaptive/personalization/learning/contracts';
export const preferenceLearningApi = {
  read: (space: 'work' | 'personal', agentId: string, signal?: AbortSignal) => request<LearningPublicView>('GET', `experience/preference-learning?space=${space}&agentId=${encodeURIComponent(agentId)}`, undefined, 'json', signal),
  present: (input: LearningPresentInput, signal?: AbortSignal) => request<LearningPublicView>('POST', 'experience/preference-learning/present', input, 'json', signal),
  toggle: (input: LearningToggleInput, signal?: AbortSignal) => request<LearningPublicView>('PUT', 'experience/preference-learning', input, 'json', signal),
  review: (input: LearningReviewInput, signal?: AbortSignal) => request<LearningPublicView>('POST', 'experience/preference-learning/review', input, 'json', signal),
  cancel: async (space: 'work' | 'personal', agentId: string) => {
    try { await fetch('/api/studio/experience/preference-learning/cancel', { method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': tg()?.initData ?? '' }, body: JSON.stringify({ space, agentId }) }); } catch { /* Leaving a surface never waits for a server reply. */ }
  },
};
