'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedContainerView, SharedMemoryView } from '@/lib/adaptive/shared/contracts';
import { api, type AgentView, type GroupItem, type Member } from '../../_lib/client';
import { sharedApi, type SharedPreview, type SharedSnapshot } from '../../_lib/shared-client';
import { adaptiveApi } from '../../_lib/adaptive-client';
import { haptic } from '../../_lib/haptics';
import { DUR, EASE, SPRING } from '../../_lib/motion';
import { AgentFace } from '../Cloud';
import { Banner, Check, Empty, Icon, Radio, Row, Section, Seg, Sheet, SheetHead, SkeletonRows, Steps, useConfirm } from '../ui';
import { useNav } from '../StudioApp';
import { Enter, Faces, LetterTile, LiveSheet, SettingsPage, SheetError, SpaceBar, formatWhen, useFirstLoad } from './settings/kit';

type Step = 0 | 1 | 2;

/**
 * Shared memories (UI §4.14): one section per shared container (its audience in the head, notes as rows, leave and remove
 * behind the section's ··· with a confirmation), and a three-step compose sheet that always shows the server's exact
 * audience before anything is shared.
 */
export function SharedMemoriesScreen({ selfId }: { selfId: number; onBack?: () => void }) {
  // Language and space are app-level (nav); the space switch here writes nav.space.
  const nav = useNav();
  const space = nav.space;
  const fa = nav.locale === 'fa';
  const confirm = useConfirm();
  const reduced = useReducedMotion() || nav.tier === 'reduced';
  const [data, setData] = useState<SharedSnapshot | null>(null);
  const [personId, setPersonId] = useState('');
  const [people, setPeople] = useState<Member[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [kind, setKind] = useState<'selected' | 'group'>('selected');
  const [recipients, setRecipients] = useState<number[]>([]);
  const [group, setGroup] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<SharedPreview | null>(null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [note, setNote] = useState<{ container: string; memory: string } | null>(null);
  const generation = useRef(0);
  const first = useFirstLoad(!!data);
  const t = (en: string, persian: string) => fa ? persian : en;
  const name = (id: number) => people.find(p => p.telegramId === id)?.name ?? String(id);
  const reset = () => { setStep(0); setKind('selected'); setRecipients([]); setGroup(''); setAgentIds([]); setText(''); setPreview(null); };
  const load = useCallback(async () => {
    const current = ++generation.current;
    setData(null); setError(''); setComposing(false); setContainerId(null); setNote(null);
    setStep(0); setKind('selected'); setRecipients([]); setGroup(''); setAgentIds([]); setText(''); setPreview(null);
    try {
      const [shared, members, listedGroups, listedAgents, identity] = await Promise.all([sharedApi.list(space), api.members(), api.groups(), api.agents(), adaptiveApi.read(space, 'en')]);
      if (current !== generation.current) return;
      setData(shared); setPeople(members.people.filter(p => p.role !== 'pending')); setGroups(listedGroups.groups);
      setAgents(listedAgents.agents.filter(a => a.status === 'active')); setPersonId(identity.identity.personId ?? '');
    } catch { if (current === generation.current) setError(t('Shared memories could not be loaded.', 'حافظه‌های مشترک دریافت نشد.')); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const perform = async (action: () => Promise<SharedSnapshot>, message = t('Saved', 'ذخیره شد')) => {
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const next = await action();
      if (current !== generation.current) return false;
      setData(next); setPreview(null); haptic.success(); nav.snack({ message, tone: 'success' });
      return true;
    } catch {
      if (current === generation.current) { haptic.error(); setError(t('The change was not confirmed. Refresh and review the current audience.', 'تغییر تأیید نشد. صفحه را تازه کنید و مخاطبان فعلی را بررسی کنید.')); }
      return false;
    } finally { setBusy(false); }
  };
  const review = async () => {
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const value = await sharedApi.preview({ space, kind, recipientTelegramIds: kind === 'selected' ? [...new Set([selfId, ...recipients])] : [], ...(kind === 'group' ? { groupId: group } : {}) });
      if (current === generation.current) { setPreview(value); haptic.select(); }
    } catch { if (current === generation.current) setError(t('This audience cannot be shared with. All recipients must confirm their own profile and remain eligible.', 'اشتراک با این مخاطبان ممکن نیست. همهٔ گیرندگان باید نمایهٔ خود را تأیید کرده و مجاز باشند.')); }
    finally { setBusy(false); }
  };
  const mutation = (revision: number) => ({ space, expectedRevision: revision, eventId: crypto.randomUUID() });
  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];
  const container = data?.containers.find(item => item.id === containerId) ?? null;
  const openNote = note && data?.containers.find(item => item.id === note.container);
  const memory = openNote?.memories.find(m => m.id === note?.memory) ?? null;
  const canDelete = (box: SharedContainerView, m: SharedMemoryView) => m.authorPersonId === personId || box.ownerPersonId === personId;
  const authorName = (box: SharedContainerView, m: SharedMemoryView) => {
    if (m.authorPersonId === personId) return t('You', 'شما');
    const r = box.recipients.find(item => item.personId === m.authorPersonId);
    return r ? name(r.telegramId) : t('Someone', 'یک نفر');
  };
  const deleteNote = async (box: SharedContainerView, m: SharedMemoryView) => {
    const ok = await confirm({ title: t('Delete this shared note?', 'این یادداشت مشترک حذف شود؟'), tone: 'danger',
      body: t('It disappears for everyone in this audience. Someone who already read it may remember it.', 'برای همهٔ این مخاطبان حذف می‌شود. کسی که آن را خوانده ممکن است آن را به یاد داشته باشد.'),
      confirmLabel: t('Delete note', 'حذف یادداشت'), cancelLabel: t('Cancel', 'انصراف') });
    if (ok && await perform(() => sharedApi.remove(box.id, m.id, mutation(box.revision)), t('Note deleted', 'یادداشت حذف شد'))) setNote(null);
  };
  const revoke = async (box: SharedContainerView, telegramId: number) => {
    const leaving = telegramId === selfId;
    const ok = await confirm({ title: leaving ? t('Leave this shared memory?', 'از این حافظهٔ مشترک خارج می‌شوید؟') : t(`Remove ${name(telegramId)}?`, `${name(telegramId)} حذف شود؟`), tone: 'danger',
      body: leaving && box.ownerPersonId === personId
        ? t('Leaving as owner deletes this shared container and all its notes for everyone.', 'خروج مالک، این فضای مشترک و همهٔ یادداشت‌هایش را برای همه حذف می‌کند.')
        : t('This removes access and deletes this person’s notes from the shared container for everyone.', 'این کار دسترسی را حذف می‌کند و یادداشت‌های این فرد را از فضای مشترک برای همه پاک می‌کند.'),
      confirmLabel: leaving ? t('Leave', 'خروج') : t('Remove access', 'حذف دسترسی'), cancelLabel: t('Cancel', 'انصراف') });
    if (ok && await perform(() => sharedApi.revoke(box.id, telegramId, mutation(box.revision)))) setContainerId(null);
  };
  const audienceReady = kind === 'selected' ? recipients.length > 0 : !!group;
  const evaporate = reduced ? { opacity: 0, transition: { duration: DUR.fast } } : { opacity: 0, y: -24, scale: 0.96, transition: { duration: 0.6, ease: EASE.exit } };
  const stepTitle = [t('Who can read it', 'چه کسانی می‌توانند بخوانند'), t('Which agents may use it', 'کدام عامل‌ها مجازند'), t('Your note', 'یادداشت شما')][step];
  const others = people.filter(p => p.telegramId !== selfId);
  const share = () => preview && perform(async () => { const next = await sharedApi.create({ ...mutation(0), previewToken: preview.previewToken, text, agentIds }); return next; }, t('Shared', 'به اشتراک گذاشته شد'))
    .then(ok => { if (ok) { setComposing(false); reset(); } });

  return <SettingsPage title={t('Shared memories', 'حافظه‌های مشترک')} busy={busy} className="vx-shared"
    dock={data && !composing && <button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={busy || !personId} onClick={() => { reset(); setComposing(true); }}>
      <Icon name="plus" size={20} width={2} />{t('New shared note', 'یادداشت مشترک تازه')}</button>}>
    <SpaceBar disabled={busy} label={t('Memory space', 'فضای حافظه')} />
    {error && !composing && <Banner tone="danger" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void load()}>{t('Refresh', 'تازه‌سازی')}</button>}>{error}</Banner>}
    {!data && !error && <SkeletonRows rows={3} lead="dot" label={t('Loading…', 'در حال دریافت…')} />}
    {data && !data.containers.length && <Empty title={t('No shared memories in this space.', 'در این فضا حافظهٔ مشترکی وجود ندارد.')}
      body={t('Save a note for an exact set of people. Each person chooses separately whether an agent can use it for personalization.', 'یادداشتی را برای افراد مشخص ذخیره کنید. هر فرد جداگانه انتخاب می‌کند که عامل از آن برای شخصی‌سازی استفاده کند یا نه.')} />}
    {data?.containers.map((box, i) => {
      const audience = box.recipients.filter(r => r.active).map(r => name(r.telegramId));
      return <Enter key={box.id} i={i} first={first}>
        <section className="vx-section vx-shared-box" aria-label={box.kind === 'group' ? t('Group memory', 'حافظهٔ گروه') : t('Selected people', 'افراد منتخب')}>
          <div className="vx-section-head">
            <Faces names={audience} />
            <h2 className="vx-over">{box.kind === 'group' ? t('Group memory', 'حافظهٔ گروه') : t('Selected people', 'افراد منتخب')}</h2>
            <button type="button" className="vx-icon-btn" disabled={busy} aria-label={t('Sharing options', 'گزینه‌های اشتراک')} onClick={() => setContainerId(box.id)}><Icon name="more" size={20} /></button>
          </div>
          {box.status === 'audience_changed' && <Banner tone="warn">{t('The audience changed. These notes are unavailable until a new sharing decision.', 'مخاطبان تغییر کرده‌اند. یادداشت‌ها تا تصمیم جدید برای اشتراک در دسترس نیستند.')}</Banner>}
          <div className="vx-group">
            {!box.memories.length && <div className="vx-row"><span className="vx-row-sub">{t('No notes here yet.', 'هنوز یادداشتی نیست.')}</span></div>}
            <AnimatePresence initial={false}>
              {box.memories.map(m => <motion.div key={m.id} className="vx-mem-item" layout={!reduced} exit={evaporate} transition={SPRING.snappy}>
                <Row align="top" chevron onClick={() => setNote({ container: box.id, memory: m.id })}
                  title={<span className="vx-clamp-3" dir="auto">{m.text}</span>}
                  sub={`${authorName(box, m)} · ${formatWhen(m.createdAt, fa, { day: 'numeric', month: 'short' })}`} />
              </motion.div>)}
            </AnimatePresence>
          </div>
          <p className="vx-section-foot">{audience.join(' · ')}</p>
        </section>
      </Enter>;
    })}

    {/* ---------- a note ---------- */}
    <LiveSheet open={!!memory && !!openNote} scope={space} onClose={() => { if (!busy) setNote(null); }} label={t('Shared note', 'یادداشت مشترک')}>
      {memory && openNote && <div className="vx-sheet-stack">
        <span className="vx-over">{authorName(openNote, memory)} · {formatWhen(memory.createdAt, fa)}</span>
        <p className="vx-you-note-text" dir="auto">{memory.text}</p>
        <div className="vx-group"><Fact2 label={t('Can read', 'می‌توانند بخوانند')} value={openNote.recipients.filter(r => r.active).map(r => name(r.telegramId)).join(' · ')} /></div>
        <p className="vx-footnote">{t('Expires', 'انقضا')} {formatWhen(memory.expiresAt, fa, { dateStyle: 'medium' })}</p>
        {canDelete(openNote, memory) && <div className="vx-group">
          <Row tone="danger" lead={<Icon name="trash" size={20} />} title={t('Delete note', 'حذف یادداشت')} disabled={busy} onClick={() => void deleteNote(openNote, memory)} />
        </div>}
        {error && <SheetError>{error}</SheetError>}
      </div>}
    </LiveSheet>

    {/* ---------- a container's audience ---------- */}
    <LiveSheet open={!!container} scope={space} onClose={() => { if (!busy) setContainerId(null); }} label={t('Sharing options', 'گزینه‌های اشتراک')}>
      {container && <div className="vx-sheet-stack">
        <SheetHead title={container.kind === 'group' ? t('Group memory', 'حافظهٔ گروه') : t('Selected people', 'افراد منتخب')}
          sub={t('Future members do not automatically gain access. Removing access cannot recall a copy someone already read.', 'اعضای آینده خودکار دسترسی نمی‌گیرند. حذف دسترسی، نسخه‌ای را که فرد قبلاً خوانده بازنمی‌گرداند.')} />
        <div className="vx-group">
          {container.recipients.filter(r => r.active).map(r => <Row key={r.telegramId} lead={<LetterTile text={name(r.telegramId)} round />}
            title={name(r.telegramId)} sub={r.telegramId === selfId ? t('You', 'شما') : r.personId === container.ownerPersonId ? t('Owner', 'مالک') : undefined} />)}
        </div>
        <div className="vx-group">
          {container.recipients.filter(r => r.active && (r.telegramId === selfId || container.ownerPersonId === personId)).map(r => {
            const leaving = r.telegramId === selfId;
            return <Row key={r.telegramId} tone="danger" lead={<Icon name={leaving ? 'back' : 'close'} size={20} />} disabled={busy} onClick={() => void revoke(container, r.telegramId)}
              title={leaving ? t('Leave shared memory', 'خروج از حافظهٔ مشترک') : `${t('Remove access', 'حذف دسترسی')}: ${name(r.telegramId)}`} />;
          })}
        </div>
        {error && <SheetError>{error}</SheetError>}
      </div>}
    </LiveSheet>

    {/* ---------- compose: Audience → Agents → Note ---------- */}
    <Sheet open={composing} onClose={() => { if (!busy) setComposing(false); }} label={t('A new shared note', 'یادداشت مشترک جدید')}
      dock={<div className="vx-dock-row">
        <button type="button" className="vx-btn vx-btn-ghost" disabled={busy} onClick={() => { if (step === 0) setComposing(false); else { setPreview(null); setStep((step - 1) as Step); } }}>
          {step === 0 ? t('Cancel', 'انصراف') : t('Back', 'بازگشت')}</button>
        {step < 2 ? <button type="button" className="vx-btn vx-btn-primary" disabled={busy || (step === 0 && !audienceReady)} onClick={() => { haptic.tap(); setStep((step + 1) as Step); }}>{t('Next', 'بعدی')}</button>
          : preview ? <button type="button" className="vx-btn vx-btn-primary" disabled={busy} onClick={() => void share()}>
            {t(`Share with ${preview.recipients.length} people`, `اشتراک با ${preview.recipients.length.toLocaleString('fa-IR')} نفر`)}</button>
            : <button type="button" className="vx-btn vx-btn-secondary" disabled={busy || !text.trim() || !personId || !audienceReady} onClick={() => void review()}>{t('Preview exact audience', 'پیش‌نمایش مخاطبان دقیق')}</button>}
      </div>}>
      <div className="vx-sheet-stack">
        <div className="vx-shared-steps"><Steps total={3} current={step} /><span className="vx-over">{stepTitle}</span></div>
        {step === 0 && <>
          <Seg label={t('Share with', 'اشتراک با')} value={kind} disabled={busy} onChange={v => { setKind(v); setPreview(null); }}
            options={[{ value: 'selected', label: t('Selected people', 'افراد منتخب') }, { value: 'group', label: t('A group', 'یک گروه') }]} />
          {kind === 'selected' ? <Section title={t('Exact recipients, including you', 'گیرندگان دقیق، شامل خودتان')}>
            <Row lead={<LetterTile text={name(selfId)} round />} title={name(selfId)} sub={t('You', 'شما')} role="checkbox" aria-checked end={<Check />} />
            {others.map(p => <Row key={p.telegramId} role="checkbox" aria-checked={recipients.includes(p.telegramId)} lead={<LetterTile text={p.name} round />} title={p.name} end={<Check />}
              disabled={busy} onClick={() => { haptic.select(); setRecipients(toggle(recipients, p.telegramId)); setPreview(null); }} />)}
          </Section> : <Section title={t('Group', 'گروه')} foot={t('Groups with guests can’t hold shared memories.', 'گروه‌های دارای مهمان نمی‌توانند حافظهٔ مشترک داشته باشند.')}>
            {!groups.length && <div className="vx-row"><span className="vx-row-sub">{t('No groups yet.', 'هنوز گروهی نیست.')}</span></div>}
            {groups.map(g => { const value = `chat-${Math.abs(g.chatId)}`; return <Row key={g.chatId} role="radio" aria-checked={group === value} title={g.title}
              lead={<LetterTile text={g.title} />} sub={g.hasGuests ? t('Guests present', 'دارای مهمان') : t(`${g.memberCount} members`, `${g.memberCount.toLocaleString('fa-IR')} عضو`)} end={<Radio />}
              disabled={busy || g.hasGuests} onClick={() => { haptic.select(); setGroup(value); setPreview(null); }} />; })}
          </Section>}
        </>}
        {step === 1 && <Section title={t('Agents allowed to read this note', 'عامل‌های مجاز برای خواندن این یادداشت')} foot={t('Optional. Each person still decides for themselves whether an agent may use shared notes.', 'اختیاری. هر فرد همچنان خودش تصمیم می‌گیرد که عامل از یادداشت‌های مشترک استفاده کند یا نه.')}>
          {!agents.length && <div className="vx-row"><span className="vx-row-sub">{t('No active agents.', 'عامل فعالی نیست.')}</span></div>}
          {agents.map(a => <Row key={a.id} role="checkbox" aria-checked={agentIds.includes(a.id)} title={a.persona.name} sub={a.persona.role} end={<Check />}
            lead={<AgentFace look={a.look} stage={a.stage} size={32} variant="disc" still label={a.persona.name} />}
            disabled={busy} onClick={() => { haptic.select(); setAgentIds(toggle(agentIds, a.id)); setPreview(null); }} />)}
        </Section>}
        {step === 2 && <>
          <label className="vx-field"><span className="vx-label">{t('Note', 'یادداشت')}</span>
            <textarea className="vx-textarea vx-shared-text" rows={4} maxLength={2000} value={text} disabled={busy} dir="auto" onChange={e => { setText(e.target.value); setPreview(null); }} /></label>
          {preview && <div className="vx-shared-preview" role="group" aria-label={t('These people will be able to read this note', 'این افراد می‌توانند یادداشت را بخوانند')}>
            <div className="vx-shared-preview-head"><Faces names={preview.recipients.map(r => name(r.telegramId))} max={5} />
              <span className="vx-row-title">{t('These people will be able to read this note', 'این افراد می‌توانند یادداشت را بخوانند')}</span></div>
            <ul className="vx-shared-names">{preview.recipients.map(r => <li key={r.telegramId}>{name(r.telegramId)}</li>)}</ul>
            <p className="vx-footnote">{t('Future members do not automatically gain access. Removing access cannot recall a copy someone already read.', 'اعضای آینده خودکار دسترسی نمی‌گیرند. حذف دسترسی، نسخه‌ای را که فرد قبلاً خوانده بازنمی‌گرداند.')}</p>
          </div>}
        </>}
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    </Sheet>
  </SettingsPage>;
}

const Fact2 = ({ label, value }: { label: string; value: string }) => (
  <div className="vx-row vx-fact"><span className="vx-row-main"><span className="vx-row-sub">{label}</span><span className="vx-fact-value start">{value}</span></span></div>
);
