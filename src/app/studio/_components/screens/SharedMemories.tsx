'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AgentView, type GroupItem, type Member } from '../../_lib/client';
import { sharedApi, type SharedPreview, type SharedSnapshot } from '../../_lib/shared-client';
import { adaptiveApi } from '../../_lib/adaptive-client';
import { TopBar } from '../ui';

export function SharedMemoriesScreen({ selfId, onBack }: { selfId: number; onBack: () => void }) {
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  const [fa, setFa] = useState(false);
  const [data, setData] = useState<SharedSnapshot | null>(null);
  const [personId, setPersonId] = useState('');
  const [people, setPeople] = useState<Member[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [kind, setKind] = useState<'selected' | 'group'>('selected');
  const [recipients, setRecipients] = useState<number[]>([]);
  const [group, setGroup] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<SharedPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const generation = useRef(0);
  const t = (en: string, persian: string) => fa ? persian : en;
  const name = (id: number) => people.find(p => p.telegramId === id)?.name ?? String(id);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setData(null); setPreview(null); setError(''); setStatus(''); setText(''); setRecipients([]); setAgentIds([]); setConfirmation(null);
    try {
      const [shared, members, listedGroups, listedAgents, identity] = await Promise.all([sharedApi.list(space), api.members(), api.groups(), api.agents(), adaptiveApi.read(space, 'en')]);
      if (current !== generation.current) return;
      setData(shared); setPeople(members.people.filter(p => p.role !== 'pending')); setGroups(listedGroups.groups);
      setAgents(listedAgents.agents.filter(a => a.status === 'active')); setPersonId(identity.identity.personId ?? '');
    } catch { if (current === generation.current) setError('Settings could not be loaded. / تنظیمات دریافت نشد.'); }
  }, [space]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const perform = async (action: () => Promise<SharedSnapshot>) => {
    const current = generation.current;
    setBusy(true); setError(''); setStatus('');
    try {
      const next = await action();
      if (current === generation.current) { setData(next); setPreview(null); setConfirmation(null); setStatus(t('Saved.', 'ذخیره شد.')); }
    } catch { if (current === generation.current) setError(t('The change was not confirmed. Refresh and review the current audience.', 'تغییر تأیید نشد. صفحه را تازه کنید و مخاطبان فعلی را بررسی کنید.')); }
    finally { setBusy(false); }
  };
  const review = async () => {
    setBusy(true); setError(''); setStatus('');
    try { setPreview(await sharedApi.preview({ space, kind, recipientTelegramIds: kind === 'selected' ? [...new Set([selfId, ...recipients])] : [], ...(kind === 'group' ? { groupId: group } : {}) })); }
    catch { setError(t('This audience cannot be shared with. All recipients must confirm their own profile and remain eligible.', 'اشتراک با این مخاطبان ممکن نیست. همهٔ گیرندگان باید نمایهٔ خود را تأیید کرده و مجاز باشند.')); }
    finally { setBusy(false); }
  };
  const mutation = (revision: number) => ({ space, expectedRevision: revision, eventId: crypto.randomUUID() });
  return <><TopBar onBack={onBack} title={t('Shared memories', 'حافظه‌های مشترک')} right={<button className="vx-chip" disabled={busy} onClick={() => setFa(!fa)}>{fa ? 'English' : 'فارسی'}</button>} />
    <section className="vx-scroll vx-privacy" dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'} aria-busy={busy}>
      <p className="vx-2">{t('Save a note for an exact set of people. Each person chooses separately whether an agent can use it for personalization.', 'یادداشتی را برای افراد مشخص ذخیره کنید. هر فرد جداگانه انتخاب می‌کند که عامل از آن برای شخصی‌سازی استفاده کند یا نه.')}</p>
      <div className="vx-privacy-spaces" role="group" aria-label={t('Memory space', 'فضای حافظه')}>{(['work', 'personal'] as const).map(s => <button className="vx-btn vx-btn-secondary" key={s} disabled={busy} aria-pressed={space === s} onClick={() => setSpace(s)}>{s === 'work' ? t('Work', 'کاری') : t('Personal', 'شخصی')}</button>)}</div>
      {error && <div className="vx-banner danger" role="alert">{error}<button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void load()}>{t('Refresh', 'تازه‌سازی')}</button></div>}
      {status && <p role="status">{status}</p>}
      {!data && !error && <p role="status">{t('Loading…', 'در حال دریافت…')}</p>}
      {data && <>
        <div className="vx-card vx-privacy-card">
          <h2 className="vx-head">{t('A new shared note', 'یادداشت مشترک جدید')}</h2>
          <label>{t('Share with', 'اشتراک با')}<select className="vx-input" disabled={busy} value={kind} onChange={e => { setKind(e.target.value as typeof kind); setPreview(null); }}><option value="selected">{t('Selected people', 'افراد منتخب')}</option><option value="group">{t('A group', 'یک گروه')}</option></select></label>
          {kind === 'selected' ? <fieldset style={{ border: 0, padding: 0 }}><legend className="vx-small">{t('Exact recipients, including you', 'گیرندگان دقیق، شامل خودتان')}</legend><p className="vx-small">{name(selfId)} · {t('You', 'شما')}</p>{people.filter(p => p.telegramId !== selfId).map(p => <label className="vx-privacy-checkbox" key={p.telegramId}><input type="checkbox" disabled={busy} checked={recipients.includes(p.telegramId)} onChange={e => { setRecipients(old => e.target.checked ? [...old, p.telegramId] : old.filter(id => id !== p.telegramId)); setPreview(null); }} />{p.name}</label>)}</fieldset> : <label>{t('Group', 'گروه')}<select className="vx-input" disabled={busy} value={group} onChange={e => { setGroup(e.target.value); setPreview(null); }}><option value="">{t('Choose a group', 'انتخاب گروه')}</option>{groups.map(g => <option key={g.chatId} disabled={g.hasGuests} value={`chat-${Math.abs(g.chatId)}`}>{g.title}{g.hasGuests ? t(' · guests present', ' · دارای مهمان') : ''}</option>)}</select></label>}
          <fieldset style={{ border: 0, padding: 0 }}><legend className="vx-small">{t('Agents allowed to read this note', 'عامل‌های مجاز برای خواندن این یادداشت')}</legend>{agents.map(a => <label className="vx-privacy-checkbox" key={a.id}><input type="checkbox" checked={agentIds.includes(a.id)} disabled={busy} onChange={e => { setAgentIds(old => e.target.checked ? [...old, a.id] : old.filter(id => id !== a.id)); setPreview(null); }} />{a.persona.name}</label>)}</fieldset>
          <label>{t('Note', 'یادداشت')}<textarea className="vx-textarea" rows={3} maxLength={2000} value={text} disabled={busy} onChange={e => { setText(e.target.value); setPreview(null); }} /></label>
          <button className="vx-btn vx-btn-secondary" disabled={busy || !text.trim() || !personId || (kind === 'selected' ? !recipients.length : !group)} onClick={() => void review()}>{t('Preview exact audience', 'پیش‌نمایش مخاطبان دقیق')}</button>
          {preview && <div className="vx-privacy-notice"><h3 className="vx-head">{t('These people will be able to read this note', 'این افراد می‌توانند یادداشت را بخوانند')}</h3><ul>{preview.recipients.map(r => <li key={r.telegramId}>{name(r.telegramId)}</li>)}</ul><p className="vx-small vx-2">{t('Future members do not automatically gain access. Removing access cannot recall a copy someone already read.', 'اعضای آینده خودکار دسترسی نمی‌گیرند. حذف دسترسی، نسخه‌ای را که فرد قبلاً خوانده بازنمی‌گرداند.')}</p><button className="vx-btn vx-btn-primary" disabled={busy} onClick={() => void perform(async () => { const next = await sharedApi.create({ ...mutation(0), previewToken: preview.previewToken, text, agentIds }); setText(''); return next; })}>{t('Share this note', 'اشتراک این یادداشت')}</button></div>}
        </div>
        {!data.containers.length && <p className="vx-small vx-2">{t('No shared memories in this space.', 'در این فضا حافظهٔ مشترکی وجود ندارد.')}</p>}
        {data.containers.map(container => <article className="vx-card vx-privacy-card" key={container.id}>
          <h2 className="vx-head">{container.kind === 'group' ? t('Group memory', 'حافظهٔ گروه') : t('Selected people', 'افراد منتخب')}</h2>
          <p className="vx-small vx-2">{container.recipients.filter(r => r.active).map(r => name(r.telegramId)).join(' · ')}</p>
          {container.status === 'audience_changed' && <p className="vx-banner warn">{t('The audience changed. These notes are unavailable until a new sharing decision.', 'مخاطبان تغییر کرده‌اند. یادداشت‌ها تا تصمیم جدید برای اشتراک در دسترس نیستند.')}</p>}
          {container.memories.map(m => <div className="vx-privacy-note" key={m.id}><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</p>{(m.authorPersonId === personId || container.ownerPersonId === personId) && (confirmation === m.id ? <div className="vx-privacy-actions"><button className="vx-btn vx-btn-danger vx-btn-sm" disabled={busy} onClick={() => void perform(() => sharedApi.remove(container.id, m.id, mutation(container.revision)))}>{t('Confirm deletion', 'تأیید حذف')}</button><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setConfirmation(null)}>{t('Cancel', 'انصراف')}</button></div> : <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setConfirmation(m.id)}>{t('Delete note', 'حذف یادداشت')}</button>)}</div>)}
          {container.recipients.filter(r => r.active && (r.telegramId === selfId || container.ownerPersonId === personId)).map(r => {
            const key = `revoke:${container.id}:${r.telegramId}`;
            const leaving = r.telegramId === selfId;
            return <div key={key}>{confirmation === key ? <div className="vx-privacy-notice">
              <p>{leaving && container.ownerPersonId === personId
                ? t('Leaving as owner deletes this shared container and all its notes for everyone.', 'خروج مالک، این فضای مشترک و همهٔ یادداشت‌هایش را برای همه حذف می‌کند.')
                : t('This removes access and deletes this person’s notes from the shared container for everyone.', 'این کار دسترسی را حذف می‌کند و یادداشت‌های این فرد را از فضای مشترک برای همه پاک می‌کند.')}</p>
              <div className="vx-privacy-actions"><button className="vx-btn vx-btn-danger vx-btn-sm" disabled={busy} onClick={() => void perform(() => sharedApi.revoke(container.id, r.telegramId, mutation(container.revision)))}>{t('Confirm removal', 'تأیید حذف دسترسی')}</button><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setConfirmation(null)}>{t('Cancel', 'انصراف')}</button></div>
            </div> : <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setConfirmation(key)}>{leaving ? t('Leave shared memory', 'خروج از حافظهٔ مشترک') : `${t('Remove access', 'حذف دسترسی')}: ${name(r.telegramId)}`}</button>}</div>;
          })}
        </article>)}
      </>}
    </section>
  </>;
}
