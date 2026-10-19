'use client';
import type { ExperienceSnapshot, FeedbackInput, PreferenceInput, PreferenceState, PreferenceUndoInput, ReminderInput, SettingsInput } from '@/lib/adaptive/runtime/contracts';
import type { ReminderActionInput, ReminderChannelPresentInput, ReminderChannelInput } from '@/lib/adaptive/runtime/reminder-contracts';
import { request } from './client';
export type { ExperienceSnapshot };
export const experienceApi = {
  read: (space: 'work' | 'personal') => request<ExperienceSnapshot>('GET', `experience?space=${space}`),
  preference: (input: PreferenceInput) => request<ExperienceSnapshot>('PUT', 'experience/preferences', input),
  preferenceState: (space: 'work' | 'personal', agentId: string) => request<PreferenceState>('GET', `experience/preferences?space=${space}&agentId=${encodeURIComponent(agentId)}`),
  preferenceUndo: (input: PreferenceUndoInput) => request<ExperienceSnapshot>('POST', 'experience/preferences/undo', input),
  settings: (input: SettingsInput) => request<ExperienceSnapshot>('PUT', 'experience/settings', input),
  feedback: (input: FeedbackInput) => request<ExperienceSnapshot>('POST', 'experience/feedback', input),
  reminderChannelPresent: (input: ReminderChannelPresentInput) => request<ExperienceSnapshot>('POST', 'experience/reminder-channel/present', input),
  reminderChannel: (input: ReminderChannelInput) => request<ExperienceSnapshot>('PUT', 'experience/reminder-channel', input),
  reminderAction: (input: ReminderActionInput) => request<ExperienceSnapshot>('POST', 'experience/reminder-action', input),
  resolveNotification: (itemId: string) => request<{ space: 'work' | 'personal' }>('GET', `experience/reminders/${encodeURIComponent(itemId)}`),
  reminder: (input: ReminderInput) => request<ExperienceSnapshot>('POST', 'experience/reminders', input),
};
