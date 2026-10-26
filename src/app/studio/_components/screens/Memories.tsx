'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { api, haptic, type AgentView, type Member, type MemoryItem } from '../../_lib/client';
import { DUR, EASE, SPRING, T, listItem } from '../../_lib/motion';
import { AgentFace } from '../Cloud';
import { RelationshipPanel } from '../RelationshipPanel';
import { errorMessage, useNav } from '../StudioApp';
import { Check, Empty, ErrorState, FilterChips, Icon, Row, SheetHead, SkeletonRows, TopBar } from '../ui';
import { LiveSheet, useFirstLoad } from './settings/kit';

type Filter = 'all' | 'private' | 'shared';
const NOT_SHAREABLE = ['personal', 'confidential', 'sensitive'];

/** The agent's memories you may see (UI §5.4): rows, a ··· sheet per memory (share, forget), and Staying in touch as one row. */
export function MemoriesScreen({ id }: { id: string }) {
  const nav = useNav();
  const fa = nav.locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;
  const reduced = useReducedMotion() || nav.tier === 'reduced';
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache.get(id) ?? null);
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [people, setPeople] = useState<Member[]>([]);
  const [legacySharing, setLegacySharing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'share' | 'forget'>('view');
  const [recipients, setRecipients] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const first = useFirstLoad(!!memories);

  const load = useCallback(() => {
    setLoadError('');
    Promise.all([api.agent(id), api.memories(id)])
      .then(([a, m]) => { setAgent(a.agent); nav.cache.set(id, a.agent); setMemories(m.memories); })
      .catch((e) => setLoadError(errorMessage(e)));
    api.members().then(({ people: members }) => setPeople(members)).catch(() => setPeople([]));
    api.me().then(({ features }) => setLegacySharing(features.legacyMemorySharing === true)).catch(() => setLegacySharing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(load, [load]);

  const when = (iso: string) => {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return t('Today', 'امروز');
    if (days < 2) return t('Yesterday', 'دیروز');
    if (days < 7) return fa ? `${days.toLocaleString('fa-IR')} روز پیش` : `${days} days ago`;
    return d.toLocaleDateString(fa ? 'fa-IR' : undefined, { month: 'short', day: 'numeric' });
  };
  const name = agent?.persona.name ?? '';
  const open = memories?.find(m => m.id === openId) ?? null;
  const shareable = (m: MemoryItem) => legacySharing && m.mine && !NOT_SHAREABLE.includes(m.sensitivity.toLowerCase());
  const close = () => { if (!busy) { setOpenId(null); setMode('view'); setSheetError(''); } };
  const openSheet = (m: MemoryItem) => { haptic.light(); setOpenId(m.id); setMode('view'); setRecipients([]); setSheetError(''); };
  const audience = people.filter(person => person.role !== 'pending');

  const forget = async (m: MemoryItem) => {
    setBusy(true); setSheetError('');
    try {
      await api.forget(id, m.id);
      haptic.success();
      setOpenId(null); setMode('view');
      setMemories(all => all?.filter(x => x.id !== m.id) ?? null);
      nav.snack({ message: t('Forgotten', 'فراموش شد'), tone: 'success' });
    } catch (e) { haptic.error(); setSheetError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const share = async (m: MemoryItem) => {
    setBusy(true); setSheetError('');
    try {
      await api.shareMemory(id, m.id, recipients);
      setMemories(all => all?.map(x => x.id === m.id ? { ...x, scope: 'shared', scopeLabel: 'Shared with selected people' } : x) ?? null);
      haptic.success(); setMode('view'); setRecipients([]);
    } catch (e) { haptic.error(); setSheetError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const unshare = async (m: MemoryItem) => {
    setBusy(true); setSheetError('');
    try {
      await api.revokeMemory(id, m.id);
      setMemories(all => all?.map(x => x.id === m.id ? { ...x, scope: 'private', scopeLabel: 'Private to you' } : x) ?? null);
      haptic.success(); setMode('view');
    } catch (e) { haptic.error(); setSheetError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  if (loadError && !memories) {
    return <><TopBar lead="back" onLead={nav.back} title={t('Memories', 'حافظه‌ها')} />
      <div className="vx-scroll"><ErrorState title={t('Can’t load memories', 'حافظه‌ها دریافت نشد')} reason={loadError} retryLabel={t('Try again', 'تلاش دوباره')} onRetry={load} /></div></>;
  }

  const counts = memories ? { all: memories.length, private: memories.filter(m => m.scope === 'private').length, shared: memories.filter(m => m.scope !== 'private').length } : null;
  const shown = memories?.filter(m => filter === 'all' || (filter === 'private' ? m.scope === 'private' : m.scope !== 'private')) ?? [];
  const evaporate = reduced ? { opacity: 0, transition: { duration: DUR.fast } } : { opacity: 0, y: -24, scale: 0.96, transition: { duration: 0.6, ease: EASE.exit } };

  return (
    <>
      <TopBar lead="back" onLead={nav.back} title={t('Memories', 'حافظه‌ها')} subtitle={name || undefined} />
      <div className="vx-scroll vx-mem" dir={nav.dir} lang={nav.locale}>
        <header className="vx-mem-head">
          {agent ? <AgentFace look={agent.look} stage={agent.stage} size={56} expr="thinking" label={name} /> : <span className="vx-mem-face" />}
          <h1 className="vx-title">{agent ? t(`What ${name} remembers`, `آنچه ${name} به خاطر دارد`) : t('Memories', 'حافظه‌ها')}</h1>
        </header>

        {agent && <RelationshipPanel presentation="row" agentId={id} name={name} space={nav.space} locale={nav.locale} allAgentsNote={nav.me?.features?.settingsV2 === true} />}

        {!memories ? <SkeletonRows rows={4} lead={false} label={t('Loading memories', 'در حال دریافت حافظه‌ها')} /> : <>
          {memories.length > 0 && <FilterChips label={t('Filter memories', 'پالایش حافظه‌ها')} value={filter} onChange={setFilter}
            options={(['all', 'private', 'shared'] as const).filter(f => f === 'all' || counts![f] > 0).map(f => ({
              value: f, count: counts![f],
              label: f === 'all' ? t('All', 'همه') : f === 'private' ? t('Private', 'خصوصی') : t('Shared', 'مشترک'),
            }))} />}
          {shown.length === 0 ? (
            <Empty look={agent?.look} expr="sleeping" title={t('Nothing yet', 'هنوز چیزی نیست')}
              body={t(`Teach ${name} something in a chat, or save a private note in You. You can inspect and delete saved memories.`, `در گفتگو چیزی به ${name} یاد بدهید یا در بخش «شما» یادداشت خصوصی ذخیره کنید. حافظه‌های ذخیره‌شده را می‌توانید ببینید و حذف کنید.`)}
              action={<button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => nav.push({ name: 'conversation', id })}><Icon name="chat" size={18} />{t('Open a chat', 'باز کردن گفتگو')}</button>} />
          ) : (
            <section className="vx-section">
              <div className="vx-group">
                <AnimatePresence initial={false}>
                  {shown.map((m, i) => (
                    <motion.div key={m.id} className="vx-mem-item" layout={!reduced} exit={evaporate}
                      initial={reduced ? false : first ? listItem.initial : false} animate={listItem.animate} transition={{ ...T.listItem(i), layout: SPRING.snappy }}>
                      <div className="vx-row top">
                        <button type="button" className="vx-mem-text" aria-expanded={expanded === m.id} onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                          <span className={expanded === m.id ? undefined : 'vx-clamp-3'} dir="auto">{m.content}</span>
                          <span className="vx-mem-meta">
                            <span className={`vx-pill ${m.scope === 'private' ? 'lock' : 'volt'}`}>{m.scope === 'private' && <Icon name="lock" size={11} width={2.5} />}{m.scopeLabel}</span>
                            <span>{m.mine ? t('You', 'شما') : m.from} · {when(m.at)}</span>
                          </span>
                        </button>
                        {m.mine && <button type="button" className="vx-icon-btn vx-mem-more" aria-label={t('Memory options', 'گزینه‌های حافظه')} aria-haspopup="dialog"
                          onClick={() => openSheet(m)}><Icon name="more" size={20} /></button>}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <p className="vx-section-foot">{t('Only what you’re allowed to see: your private memories and what’s shared with your groups.', 'فقط آنچه اجازهٔ دیدنش را دارید: حافظه‌های خصوصی شما و آنچه با گروه‌هایتان به اشتراک گذاشته شده است.')}</p>
            </section>
          )}
        </>}
      </div>

      <LiveSheet open={!!open} scope={id} onClose={close} label={t('Memory', 'حافظه')}>
        {open && <div className="vx-sheet-stack">
          <SheetHead title={t('Memory', 'حافظه')} sub={`${open.scopeLabel} · ${when(open.at)}`} />
          <p className="vx-mem-quote" dir="auto">{open.content}</p>
          {sheetError && <div className="vx-banner danger"><Icon name="warn" size={18} /><div className="vx-banner-body"><span role="alert">{sheetError}</span></div></div>}
          {mode === 'share' ? <>
            <p className="vx-small vx-2">{t('Choose who can see this memory. You can take access away later.', 'انتخاب کنید چه کسی این حافظه را ببیند. بعداً می‌توانید دسترسی را بردارید.')}</p>
            <div className="vx-group" role="group" aria-label={t('People', 'افراد')}>
              {audience.length === 0 ? <Row plain title={<span className="vx-2">{t('No people are available to share with yet.', 'هنوز فردی برای اشتراک‌گذاری نیست.')}</span>} />
                : audience.map(person => {
                  const on = recipients.includes(person.telegramId);
                  return <Row key={person.telegramId} role="checkbox" aria-checked={on} aria-label={person.name} title={person.name} end={<Check />}
                    lead={<span className="vx-initials" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>}
                    onClick={() => { haptic.select(); setRecipients(r => on ? r.filter(x => x !== person.telegramId) : [...r, person.telegramId]); }} />;
                })}
            </div>
            <div className="vx-dock-row">
              <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setMode('view')}>{t('Cancel', 'انصراف')}</button>
              <button className="vx-btn vx-btn-primary" disabled={busy || recipients.length === 0} onClick={() => void share(open)}>{t('Share with selected', 'اشتراک با افراد انتخاب‌شده')}</button>
            </div>
          </> : mode === 'forget' ? (
            <div className="vx-you-confirm" role="group" aria-label={t('Forget memory confirmation', 'تأیید فراموشی')}>
              <p className="vx-head">{t(`${name} will forget this for good.`, `${name} این را برای همیشه فراموش می‌کند.`)}</p>
              <div className="vx-dock-row">
                <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setMode('view')}>{t('Keep memory', 'نگه‌داشتن')}</button>
                <button className="vx-btn vx-btn-danger" disabled={busy} onClick={() => void forget(open)}>{t('Forget', 'فراموش کن')}</button>
              </div>
            </div>
          ) : (
            <div className="vx-group">
              {shareable(open) && <Row plain lead={<Icon name="groups" size={20} />} title={t('Share', 'اشتراک‌گذاری')} chevron onClick={() => { haptic.light(); setRecipients([]); setMode('share'); }} />}
              {shareable(open) && open.scope !== 'private' && <Row plain lead={<Icon name="lock" size={20} />} title={t('Stop sharing', 'توقف اشتراک')} disabled={busy} onClick={() => void unshare(open)} />}
              <Row tone="danger" lead={<Icon name="trash" size={20} />} title={t('Forget', 'فراموش کن')} disabled={busy} onClick={() => { haptic.warn(); setMode('forget'); }} />
            </div>
          )}
        </div>}
      </LiveSheet>
    </>
  );
}
