'use client';
import type { ExperienceSnapshot, FeedbackInput, PreferenceInput, PreferenceState, PreferenceUndoInput, ReminderInput, SettingsInput } from '@/lib/adaptive/runtime/contracts';
import type { ReminderActionInput, ReminderChannelPresentInput, ReminderChannelInput } from '@/lib/adaptive/runtime/reminder-contracts';
import { request } from './client';
import { readPreferenceProjection } from './preference-projection';
export type { ExperienceSnapshot };
export const experienceApi = {
  read: (space: 'work' | 'personal', signal?: AbortSignal) => request<ExperienceSnapshot>('GET', `experience?space=${space}`, undefined, 'json', signal),
  preference: (input: PreferenceInput, signal?: AbortSignal) => request<ExperienceSnapshot>('PUT', 'experience/preferences', input, 'json', signal),
  preferenceState: (space: 'work' | 'personal', agentId: string, signal?: AbortSignal) => readPreferenceProjection<PreferenceState>(`experience/preferences?space=${space}&agentId=${encodeURIComponent(agentId)}`, signal),
  preferenceUndo: (input: PreferenceUndoInput, signal?: AbortSignal) => request<ExperienceSnapshot>('POST', 'experience/preferences/undo', input, 'json', signal),
  settings: (input: SettingsInput) => request<ExperienceSnapshot>('PUT', 'experience/settings', input),
  feedback: (input: FeedbackInput) => request<ExperienceSnapshot>('POST', 'experience/feedback', input),
  reminderChannelPresent: (input: ReminderChannelPresentInput) => request<ExperienceSnapshot>('POST', 'experience/reminder-channel/present', input),
  reminderChannel: (input: ReminderChannelInput) => request<ExperienceSnapshot>('PUT', 'experience/reminder-channel', input),
  reminderAction: (input: ReminderActionInput) => request<ExperienceSnapshot>('POST', 'experience/reminder-action', input),
  resolveNotification: (itemId: string) => request<{ space: 'work' | 'personal' }>('GET', `experience/reminders/${encodeURIComponent(itemId)}`),
  reminder: (input: ReminderInput) => request<ExperienceSnapshot>('POST', 'experience/reminders', input),
};
