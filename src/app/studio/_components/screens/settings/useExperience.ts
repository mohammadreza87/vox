'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, tg, type AgentView } from '../../../_lib/client';
import { experienceApi, type ExperienceSnapshot } from '../../../_lib/experience-client';
import { useProductPause } from '../../../_lib/product-pause-client';
import { useNav } from '../../StudioApp';

export type UseBoundary = Readonly<{ scope: string; space: 'work' | 'personal'; accountId?: string; useEpoch: number | null | undefined; blocked: boolean; phase: string | undefined }>;
export type NotificationSettings = { timezone: string; cap: number; quietStart: number; quietEnd: number; inbox: boolean; proactive: boolean; reminders: boolean };
export type Mutate = (action: () => Promise<ExperienceSnapshot>, opts?: { quiet?: boolean }) => Promise<boolean>;

/** Derived (non-requested) rows are pause-sensitive; a payload acquired under another use boundary keeps only the person's own reminders. */
const ownOnly = (value: ExperienceSnapshot): ExperienceSnapshot => ({ ...value, inbox: value.inbox.filter(item => item.kind === 'requested_reminder') });

/**
 * Shared data model for Preferences, Inbox and Reminders. Every read and write is bound to the use boundary
 * (session, space, account generation, pause epoch and phase) it started under: late results from an older
 * boundary never repaint derived rows, and a pause/resume or account switch re-admits with one fresh read.
 */
export function useExperience(notificationId?: string) {
  const nav = useNav();
  const space = nav.space, setSpace = nav.setSpace;
  const setSpaceRef = useRef(setSpace); setSpaceRef.current = setSpace;
  const fa = nav.locale === 'fa';
  const t = useCallback((en: string, persian: string) => fa ? persian : en, [fa]);
  const session = tg()?.initData ?? '';
  const pause = useProductPause(space, session);
  const blocked = pause.coveredBlocked;
  const owner = useRef({ session, accountId: pause.status?.accountId, generation: 0 });
  if (owner.current.session !== session) owner.current = { session, accountId: pause.status?.accountId, generation: 0 };
  if (pause.status?.accountId) {
    if (owner.current.accountId && owner.current.accountId !== pause.status.accountId) owner.current.generation++;
    owner.current.accountId = pause.status.accountId;
  }
  const scope = JSON.stringify([session, space, owner.current.generation]);
  const accountId = owner.current.accountId, useEpoch = pause.status?.useEpoch, phase = pause.phase;
  const boundary = useMemo<UseBoundary>(() => Object.freeze({ scope, space, accountId, useEpoch, blocked, phase }), [scope, space, accountId, useEpoch, blocked, phase]);
  const currentUse = useRef(boundary); currentUse.current = boundary;
  const admission = useRef({ scope, waiting: blocked && pause.status?.productPaused !== true });
  if (admission.current.scope !== scope) admission.current = { scope, waiting: blocked && pause.status?.productPaused !== true };
  const [dataScope, setDataScope] = useState(scope), [dataUse, setDataUse] = useState<UseBoundary | null>(null);
  const [storedData, setData] = useState<ExperienceSnapshot | null>(null);
  const data = useMemo(() => dataScope === scope && storedData?.space === space
    ? dataUse === boundary && !blocked ? storedData : ownOnly(storedData) : null,
  [dataScope, scope, storedData, space, dataUse, boundary, blocked]);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [agentId, setAgentId] = useState('');
  const [settings, setSettings] = useState<NotificationSettings>({ timezone: '', cap: 2, quietStart: 21, quietEnd: 8, inbox: false, proactive: false, reminders: false });
  const [notificationScope, setNotificationScope] = useState<'work' | 'personal' | null>(null);
  const [notificationMissing, setNotificationMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); busyRef.current = busy;
  const [error, setError] = useState('');
  const generation = useRef(0);
  const renderGeneration = generation.current;
  const apply = useCallback((value: ExperienceSnapshot, requestedUse: UseBoundary) => {
    if (requestedUse.scope !== currentUse.current.scope || value.space !== requestedUse.space) return false;
    const permitted = requestedUse === currentUse.current && !currentUse.current.blocked;
    // Keep the original immutable token. Old payloads never acquire current use authority.
    setDataScope(requestedUse.scope); setDataUse(requestedUse); setData(permitted ? value : ownOnly(value));
    const s = value.settings, own = s[value.space];
    setSettings({ timezone: s.timezone ?? '', cap: s.dailyCap, quietStart: s.quietStartHour, quietEnd: s.quietEndHour,
      inbox: own.inboxEnabled, proactive: own.proactiveEnabled, reminders: own.reminderEnabled });
    return true;
  }, []);
  const load = useCallback(async (preserveSelection = false) => {
    const requestedUse = currentUse.current;
    if (requestedUse.scope !== scope) return;
    const current = ++generation.current;
    if (!preserveSelection) setData(null);
    setError('');
    try {
      const [snapshot, listed] = await Promise.all([experienceApi.read(space), api.agents()]);
      if (generation.current !== current) return;
      if (!apply(snapshot, requestedUse)) return;
      const activeAgents = listed.agents.filter(a => a.status === 'active');
      setAgents(activeAgents);
      setAgentId(current => preserveSelection && activeAgents.some(agent => agent.id === current) ? current : '');
    } catch { if (generation.current === current) setError(t('Settings could not be loaded.', 'تنظیمات دریافت نشد.')); }
  }, [space, scope, apply, t]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useLayoutEffect(() => { setBusy(false); void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => {
    if (pause.phase === 'loading' && pause.status?.productPaused !== true) admission.current.waiting = true;
    if (admission.current.waiting && !blocked && !busy) {
      admission.current.waiting = false;
      // Keep mounted controls and selection while acquiring new use authority.
      // Unmounting a child would trigger another shared status refresh.
      void load(true);
    }
  }, [blocked, busy, load, pause.phase, pause.status?.productPaused]);
  useEffect(() => {
    let active = true;
    if (!notificationId || typeof experienceApi.resolveNotification !== 'function') return;
    setNotificationMissing(false); setNotificationScope(null);
    void experienceApi.resolveNotification(notificationId).then(result => { if (active) { setNotificationScope(result.space); setSpaceRef.current(result.space); } }).catch(() => { if (active) setNotificationMissing(true); });
    return () => { active = false; };
  }, [notificationId]);
  useEffect(() => {
    if (!notificationId || !notificationScope || data?.space !== notificationScope) return;
    const item = (data.reminders ?? data.inbox).find(item => item.id === notificationId);
    if (!item) { setNotificationMissing(true); return; }
    const element = document.getElementById(`reminder-${notificationId}`);
    element?.scrollIntoView?.({ block: 'center' }); element?.focus();
  }, [data, notificationId, notificationScope]);
  const mutate: Mutate = async (action, opts) => {
    if (busyRef.current) return false;
    const current = generation.current, requestedUse = currentUse.current;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const next = await action();
      if (generation.current !== current || !apply(next, requestedUse)) return false;
      if (!opts?.quiet) nav.snack({ message: t('Saved', 'ذخیره شد'), tone: 'success' });
      return true;
    } catch (error) {
      if (generation.current === current) {
        const code = error instanceof Error ? error.message : '';
        setError(code === 'reminder_delivery_busy' ? t('A reminder is being dispatched. Wait a moment, refresh and review renewal again.', 'یک یادآور در حال ارسال است. کمی صبر کنید، صفحه را تازه و تمدید را دوباره بررسی کنید.') :
          code === 'reminder_authorization_renewal_required' ? t('Renew Telegram authorization or turn Telegram reminders off before choosing this due time.', 'پیش از انتخاب این زمان مقرر، مجوز تلگرام را تمدید یا یادآورهای تلگرام را خاموش کنید.') :
          code === 'reminder_disclosure_required' ? t('Review the Telegram reminder choice again before confirming.', 'پیش از تأیید، انتخاب یادآور تلگرام را دوباره بررسی کنید.') :
          t('The change was not confirmed. Refresh before trying again.', 'تغییر تأیید نشد. پیش از تلاش دوباره صفحه را تازه کنید.'));
      }
      return false;
    } finally { if (generation.current === current) { busyRef.current = false; setBusy(false); } }
  };
  useLayoutEffect(() => { setData(current => current ? ownOnly(current) : current); }, [boundary]);
  const command = () => ({ space, expectedRevision: data!.revision, eventId: crypto.randomUUID() });
  /** Auto-save: the whole settings document goes up with one field changed; a refused save puts the server's values back. */
  const saveSettings = async (patch: Partial<NotificationSettings>) => {
    if (!data || busyRef.current) return;
    const before = settings, next = { ...settings, ...patch };
    setSettings(next);
    const ok = await mutate(() => experienceApi.settings({ ...command(), timezone: next.timezone.trim() || null, dailyCap: next.cap,
      quietStartHour: next.quietStart, quietEndHour: next.quietEnd, inboxEnabled: next.inbox, proactiveEnabled: next.proactive, reminderEnabled: next.reminders }));
    if (!ok) setSettings(current => current === next ? before : current);
  };
  return { nav, space, setSpace, fa, t, session, pause, blocked, boundary, data, setData, agents, agentId, setAgentId, settings, saveSettings,
    busy, error, load, mutate, command, apply, generation, renderGeneration, notificationMissing };
}
export type Experience = ReturnType<typeof useExperience>;
