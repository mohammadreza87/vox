'use client';

import { useEffect, useState } from 'react';
import { experienceApi } from '../../../_lib/experience-client';
import type { InboxItem } from '@/lib/adaptive/runtime/contracts';

/** Derived notices the Inbox lists (the person's own reminders live in Reminders); pause-covered rows never count. */
export function inboxRows(data: { inbox: InboxItem[] } | null, blocked: boolean) {
  return blocked || !data ? [] : data.inbox.filter(item => item.kind !== 'requested_reminder' && item.status !== 'dismissed' && item.status !== 'cancelled');
}

/** Fired by the Inbox page after it changes a notice, so the You row's count catches up without a reload. */
export const INBOX_CHANGED = 'vx:inbox-changed';
export const announceInboxChange = () => { try { window.dispatchEvent(new Event(INBOX_CHANGED)); } catch { /* no window */ } };

/** Unread count for the You hub's Inbox row. Nothing is read or counted while pause covers derived notices. */
export function useInboxBadge(space: 'work' | 'personal', blocked: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (blocked) { setCount(0); return; }
    let live = true;
    const read = () => { void experienceApi.read(space).then(data => { if (live) setCount(inboxRows(data, false).filter(item => item.status === 'unread').length); }).catch(() => { if (live) setCount(0); }); };
    setCount(0); read();
    window.addEventListener(INBOX_CHANGED, read);
    return () => { live = false; window.removeEventListener(INBOX_CHANGED, read); };
  }, [space, blocked]);
  return count;
}
