'use client';
import type { Role } from '../../_lib/client';
import { InboxPage, PreferencesPage, RemindersPage } from './settings/ExperiencePages';

/**
 * The old "Your experience" wall, now split into Preferences, Inbox and Reminders (UI §4.12). The `experience` route
 * (a reminder alert's deep link) and older callers land here: a notification opens Reminders, anything else Preferences.
 * Language and space are app-level (nav); no page has controls of its own for either.
 */
export function ExperienceScreen({ notificationId, page }: { onBack?: () => void; role?: Role; notificationId?: string; page?: 'preferences' | 'inbox' | 'reminders' }) {
  const target = page ?? (notificationId ? 'reminders' : 'preferences');
  if (target === 'reminders') return <RemindersPage notificationId={notificationId} />;
  if (target === 'inbox') return <InboxPage />;
  return <PreferencesPage />;
}
