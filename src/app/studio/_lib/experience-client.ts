'use client';
import type { ExperienceSnapshot, FeedbackInput, PreferenceInput, ReminderInput, SettingsInput } from '@/lib/adaptive/runtime/contracts';
import { request } from './client';
export type { ExperienceSnapshot };
export const experienceApi = {
  read: (space: 'work' | 'personal') => request<ExperienceSnapshot>('GET', `experience?space=${space}`),
  preference: (input: PreferenceInput) => request<ExperienceSnapshot>('PUT', 'experience/preferences', input),
  settings: (input: SettingsInput) => request<ExperienceSnapshot>('PUT', 'experience/settings', input),
  feedback: (input: FeedbackInput) => request<ExperienceSnapshot>('POST', 'experience/feedback', input),
  reminder: (input: ReminderInput) => request<ExperienceSnapshot>('POST', 'experience/reminders', input),
};
