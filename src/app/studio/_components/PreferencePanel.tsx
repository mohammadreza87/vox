'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExperienceSnapshot, PreferenceEntry, PreferenceState } from '@/lib/adaptive/runtime/contracts';
import type { PreferenceValue } from '@/lib/adaptive/personalization';
import { experienceApi } from '../_lib/experience-client';
import { ApiError } from '../_lib/client';

const choices = {
  response_length: [['brief', 'Brief', 'کوتاه'], ['balanced', 'Balanced', 'متعادل'], ['detailed', 'Detailed', 'با جزئیات']],
  language: [['auto', 'Automatic', 'خودکار'], ['en', 'English', 'انگلیسی'], ['fa', 'Persian', 'فارسی']],
  formatting: [['plain', 'Plain', 'ساده'], ['structured', 'Structured', 'ساختاریافته']],
} as const;
const names = { response_length: ['Reply length', 'اندازهٔ پاسخ'], language: ['Reply language', 'زبان پاسخ'], formatting: ['Reply format', 'قالب پاسخ'] } as const;
const explanations = {
  explicit_choice: ['Used because you saved this choice for this agent and space.', 'به دلیل انتخاب ذخیره‌شدهٔ شما برای همین عامل و فضا استفاده می‌شود.'],
  explicit_reset: ['Default style is used because you explicitly reset this choice.', 'به دلیل بازنشانی صریح شما، شیوهٔ پیش‌فرض استفاده می‌شود.'],
  default: ['No saved choice; the default style is used.', 'انتخابی ذخیره نشده است؛ شیوهٔ پیش‌فرض استفاده می‌شود.'],
  personalization_off: ['Saved choices are not used because personalization is off or expired.', 'انتخاب‌های ذخیره‌شده استفاده نمی‌شوند؛ شخصی‌سازی خاموش یا منقضی است.'],
  capability_unavailable: ['Saved choices are not used because personalization is unavailable.', 'انتخاب‌های ذخیره‌شده استفاده نمی‌شوند؛ شخصی‌سازی در دسترس نیست.'],
  agent_grant_missing: ['Saved choices are not used because this agent has no current grant in this space.', 'انتخاب‌های ذخیره‌شده استفاده نمی‌شوند؛ این عامل در این فضا مجوز فعلی ندارد.'],
} as const;
function choiceName(setting: PreferenceValue, fa: boolean) {
  return choices[setting.key].find(row => row[0] === setting.value)?.[fa ? 2 : 1] ?? setting.value;
}
function PreferenceRow({ entry, fa, busy, limited, act }: { entry: PreferenceEntry; fa: boolean; busy: boolean; limited: boolean;
  act(action: 'set' | 'reset' | 'undo', setting: PreferenceValue, changeId?: string): void }) {
  const key = entry.setting.key;
  const [selected, setSelected] = useState(entry.saved?.status === 'active' ? entry.saved.setting.value : entry.setting.value);
  const value = { key, value: selected } as PreferenceValue;
  const title = names[key][fa ? 1 : 0];
  const restore = entry.undo?.restore;
  return <article aria-label={fa ? `ترجیح: ${title}` : `${title} preference`} className="vx-preference-row">
    <label>{title}<select className="vx-input" disabled={busy} value={selected} onChange={event => setSelected(event.target.value as typeof selected)}>
      {choices[key].map(([option, en, persian]) => <option value={option} key={option}>{fa ? persian : en}</option>)}
    </select></label>
    <p className="vx-small vx-2">{limited ? (fa ? 'دلیل دقیق و واگرد اینجا در دسترس نیست. ذخیره و بازنشانی ترجیح همچنان ممکن است.'
      : 'Detailed explanations and undo are unavailable here. You can still save or reset a preference.') : explanations[entry.explanation][fa ? 1 : 0]}</p>
    {entry.saved?.status === 'active' && !entry.applied && <p className="vx-small">{fa ? 'انتخاب ذخیره‌شده: ' : 'Saved choice: '}{choiceName(entry.saved.setting, fa)}</p>}
    <div className="vx-privacy-actions">
      <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => act('set', value)}>{fa ? 'ذخیرهٔ ترجیح' : 'Save preference'}</button>
      <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => act('reset', value)}>{fa ? 'بازنشانی' : 'Reset'}</button>
      {entry.undo && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => act('undo', value, entry.undo!.changeId)}>{fa ? 'واگرد آخرین تغییر' : 'Undo last change'}</button>}
    </div>
    {entry.undo && <p className="vx-small vx-2">{!restore ? (fa ? 'واگرد، انتخاب ذخیره‌شده را برمی‌دارد.' : 'Undo removes the saved choice.')
      : restore.status === 'reset' ? (fa ? 'واگرد، بازنشانی قبلی را برمی‌گرداند.' : 'Undo restores the previous reset.')
        : `${fa ? 'واگرد برمی‌گرداند: ' : 'Undo restores: '}${choiceName(restore.setting, fa)}`}{' '}
      {fa ? 'مهلت واگرد: ' : 'Undo until: '}{new Date(entry.undo.expiresAt).toLocaleTimeString(fa ? 'fa' : 'en', { hour: '2-digit', minute: '2-digit' })}</p>}
  </article>;
}

export function PreferencePanel({ agentId, space, confirmed, revisionHint, locale = 'en', onSnapshot }: {
  agentId: string; space: 'work' | 'personal'; confirmed: boolean; revisionHint: number;
  locale?: 'en' | 'fa'; onSnapshot(snapshot: ExperienceSnapshot): void;
}) {
  const fa = locale === 'fa';
  const [state, setState] = useState<PreferenceState | null>(null);
  const [limited, setLimited] = useState(false);
  const stateRef = useRef<PreferenceState | null>(null), generation = useRef(0), busyRef = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const invalidate = useCallback(() => { generation.current++; }, []);
  const fetchState = useCallback(async () => {
    try { return { state: await experienceApi.preferenceState(space, agentId), limited: false }; }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 503 || error.message !== 'preference_projection_unavailable') throw error;
      // Preserve the existing ordinary controls on backends without a synchronous
      // projection fence. No inferred reason or undo token is synthesized here.
      const snapshot = await experienceApi.read(space);
      if (!snapshot.confirmed) throw error;
      const defaults: PreferenceValue[] = [{ key: 'response_length', value: 'balanced' }, { key: 'language', value: 'auto' }, { key: 'formatting', value: 'plain' }];
      const state: PreferenceState = { schemaVersion: 1, revision: snapshot.revision, space, agentId, receipt: '', entries: defaults.map(setting => {
        const saved = snapshot.preferences.find(p => p.agentId === agentId && p.setting.key === setting.key);
        return { setting: saved?.status === 'active' ? saved.setting : setting, source: saved?.status === 'reset' ? 'reset' : saved ? 'explicit' : 'default',
          applied: saved?.applied ?? false, explanation: 'default', ...(saved ? { saved } : {}) };
      }) };
      return { state, limited: true };
    }
  }, [space, agentId]);
  const load = useCallback(async () => {
    const current = ++generation.current; setBusy(true); setError(''); setStatus('');
    try {
      const result = await fetchState();
      if (generation.current !== current) return;
      stateRef.current = result.state; setState(result.state); setLimited(result.limited);
    } catch { if (generation.current === current) { stateRef.current = null; setState(null); setError('load'); } }
    finally { if (generation.current === current) setBusy(false); }
  }, [fetchState]);
  // Catching up the parent's revision after our own mutation must not cancel a
  // later command that already uses the same fresh state. Only scope/identity
  // changes or unmount invalidate without starting a replacement load.
  useEffect(() => invalidate, [agentId, space, confirmed, invalidate]);
  useEffect(() => {
    if (!agentId || !confirmed) { stateRef.current = null; setState(null); setBusy(false); setStatus(''); setError(''); return; }
    if (stateRef.current?.revision !== revisionHint || stateRef.current.agentId !== agentId || stateRef.current.space !== space) void load();
  }, [agentId, confirmed, load, revisionHint, space]);
  useEffect(() => {
    const expiry = Math.min(...(state?.entries.flatMap(row => row.undo ? [row.undo.expiresAt] : []) ?? []));
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => {
      setState(current => {
        if (!current) return current;
        const next = { ...current, entries: current.entries.map(row => row.undo && row.undo.expiresAt <= Date.now() ? { ...row, undo: undefined } : row) };
        stateRef.current = next; return next;
      });
    }, Math.max(0, expiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [state]);
  const act = async (action: 'set' | 'reset' | 'undo', setting: PreferenceValue, changeId?: string) => {
    const before = stateRef.current;
    if (!before || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setStatus('');
    const current = generation.current;
    try {
      const common = { space, agentId, expectedRevision: before.revision, eventId: crypto.randomUUID() };
      const result = action === 'undo' ? await experienceApi.preferenceUndo({ ...common, changeId: changeId! })
        : await experienceApi.preference({ ...common, action, setting });
      if (generation.current !== current) return;
      const fresh = await fetchState();
      if (generation.current !== current) return;
      stateRef.current = fresh.state; setState(fresh.state); setLimited(fresh.limited); setStatus(action === 'undo' ? 'undone' : 'saved'); setBusy(false); onSnapshot(result);
    } catch { if (generation.current === current) { stateRef.current = null; setState(null); setError('change'); } }
    finally { busyRef.current = false; if (generation.current === current) setBusy(false); }
  };
  return <div dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-busy={busy}>
    <p className="vx-small vx-2">{fa ? 'درخواست فعلی شما مقدم است. این کنترل‌ها فقط انتخاب‌های صریح شما را ذخیره می‌کنند. واگرد فقط ترجیح را تغییر می‌دهد و مجوزی را برنمی‌گرداند.'
      : 'Your current request comes first. These controls save only your explicit choices. Undo changes only the preference and never restores permission.'}</p>
    {!agentId && <p className="vx-small">{fa ? 'برای دیدن ترجیح‌ها یک عامل انتخاب کنید.' : 'Choose an agent to see preferences.'}</p>}
    {agentId && !confirmed && <p className="vx-small">{fa ? 'ابتدا نمایهٔ حساب را در حریم خصوصی تأیید کنید.' : 'Confirm your account profile in Privacy first.'}</p>}
    {error && <div role="alert"><p>{error === 'load' ? (fa ? 'ترجیح‌ها دریافت نشد.' : 'Preferences could not be loaded.')
      : (fa ? 'تغییر تأیید نشد. پیش از تلاش دوباره تازه‌سازی و بررسی کنید.' : 'The change was not confirmed. Refresh and review before trying again.')}</p>
      <button className="vx-btn vx-btn-secondary" onClick={() => { setStatus(''); void load(); }} disabled={busy}>{fa ? 'تازه‌سازی' : 'Refresh preferences'}</button></div>}
    {busy && !state && <p role="status">{fa ? 'در حال دریافت ترجیح‌ها…' : 'Loading preferences…'}</p>}
    {status && <p role="status">{status === 'undone' ? (fa ? 'آخرین تغییر واگرد شد.' : 'Last change undone.') : (fa ? 'ذخیره شد.' : 'Saved.')}</p>}
    {agentId && confirmed && state?.agentId === agentId && state.space === space && state.entries.map(entry => <PreferenceRow key={`${entry.setting.key}:${entry.saved?.revision ?? 0}:${entry.source}:${entry.explanation}`}
      entry={entry} fa={fa} busy={busy} limited={limited} act={(action, setting, changeId) => void act(action, setting, changeId)} />)}
  </div>;
}
