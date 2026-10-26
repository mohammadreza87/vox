'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { adaptiveApi, type AdaptiveOptionalPurpose, type AdaptivePresentation, type AdaptiveSnapshot } from '../../_lib/adaptive-client';
import { privacyCopy, purposeCopy, privacyUnavailableReason } from '../../_lib/adaptive-copy';
import { api, haptic, tg, type AgentView } from '../../_lib/client';
import { DUR, EASE, SPRING } from '../../_lib/motion';
import { useProductPause } from '../../_lib/product-pause-client';
import { pauseText } from '../../_lib/product-pause-copy';
import { ACCOUNT_SECTIONS, accountRows } from '../../_lib/settings/registry';
import { settingsCopy } from '../../_lib/settings-copy';
import { LANGUAGES, youCopy } from '../../_lib/you-copy';
import { AgentFace } from '../Cloud';
import { MemoryCorrectionEditor } from '../MemoryCorrectionEditor';
import { ProductPausePanel } from '../ProductPausePanel';
import { ReviewedMemoryPanel } from '../ReviewedMemoryPanel';
import { RightsRequestPanel } from '../RightsRequestPanel';
import { useNav } from '../StudioApp';
import { UserInfo } from '../UserInfo';
import { Banner, Check, Composer, Icon, PageHead, Picker, Row, Section, Seg, Sheet, SheetHead, SkeletonRows, Switch } from '../ui';
import { VoiceRecognitionPanel } from '../VoiceRecognitionPanel';
import { Enter, LiveSheet, useFirstLoad } from './settings/kit';
import { NotesGrantRow } from './settings/NotesGrant';
import { useInboxBadge } from './settings/useInboxBadge';

type Panel = 'identity' | 'account' | 'agents' | 'voice' | 'rights' | 'summary' | 'language';
const COVERED = ['optional.personalization', 'optional.auto_memory', 'optional.proactive_suggestions', 'optional.relationship_outreach'];
const REVIEW_STATES = ['expired', 'reconsent_required', 'suspended'];
const NOTES_SHOWN = 3;
const ADDRESS = 'Harju maakond, Tallinn, Kesklinna linnaosa, Narva mnt 7-652, 10117, Estonia';

const IconTile = ({ name, ok }: { name: string; ok?: boolean }) => <span className={`vx-tile icon sm${ok ? ' ok' : ''}`} aria-hidden="true"><Icon name={name} size={20} /></span>;

/** The "You" hub (UI §5.1): identity, consent, notes, sharing, experience, control and the app's only language control. */
export function PrivacyScreen({ onShared, onExperience, onConnections, onCorrectionPendingChange }: { onShared?: () => void; onExperience?: () => void; onConnections?: () => void; onCorrectionPendingChange?: (token: string, pending: boolean) => boolean }) {
  const nav = useNav();
  const { locale, space } = nav;
  const c = privacyCopy[locale], y = youCopy[locale];
  const session = tg()?.initData ?? '';
  const [snapshotSession, setSnapshotSession] = useState(session);
  const [storedSnapshot, setSnapshot] = useState<AdaptiveSnapshot | null>(null);
  const snapshot = snapshotSession === session ? storedSnapshot : null;
  const [presentation, setPresentation] = useState<{ purpose: AdaptiveOptionalPurpose; data: AdaptivePresentation } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /** The rights sheet's dock: RightsRequestPanel portals its volt Submit into it */
  const [rightsDock, setRightsDock] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adult, setAdult] = useState(false);
  const [jurisdiction, setJurisdiction] = useState('');
  const [note, setNote] = useState('');
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [allNotes, setAllNotes] = useState(false);
  const generation = useRef(0), pendingCorrectionRef = useRef<string | null>(null), busyRef = useRef(false), alive = useRef(true);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const [pendingCorrection, setPendingCorrection] = useState<string | null>(null);
  const [notesStale, setNotesStale] = useState(false);
  busyRef.current = busy;
  const locked = !!pendingCorrection;
  const reduced = useReducedMotion() || nav.tier === 'reduced';
  const first = useFirstLoad(!!snapshot);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const correctionPending = useCallback((token: string, pending: boolean): boolean => {
    if (pending) {
      if (busyRef.current || pendingCorrectionRef.current && pendingCorrectionRef.current !== token) return false;
      if (onCorrectionPendingChange?.(token, true) === false) return false;
      pendingCorrectionRef.current = token; setPendingCorrection(token); setNotice('');
    } else {
      if (pendingCorrectionRef.current !== token) return false;
      pendingCorrectionRef.current = null; setPendingCorrection(null); onCorrectionPendingChange?.(token, false);
    }
    return true;
  }, [onCorrectionPendingChange]);
  const pause = useProductPause(space);
  const unread = useInboxBadge(space, pause.coveredBlocked || pause.status?.productPaused === true);
  const paused = pause.status?.productPaused === true || snapshot?.storedPersonalizationAllowed === false;
  // Identity confirmation and a current adult declaration are separate facts.
  const adultDeclarationNeeded = !!snapshot && (!snapshot.identity.adultDeclared || snapshot.explicitMemoryReason === 'adult_required' || snapshot.purposes.some(p => p.reason === 'adult_required'));
  useLayoutEffect(() => { setAdult(false); }, [adultDeclarationNeeded]);

  const load = useCallback(async () => {
    if (pendingCorrectionRef.current) return;
    const current = ++generation.current;
    setSnapshot(null); setPresentation(null); setRemoving(null); setError(''); setNotice(''); setNote(''); setNoteId(null); setAllNotes(false);
    setPanel(open => open === 'voice' || open === 'rights' ? open : null);
    try {
      const [result, availableAgents] = await Promise.all([adaptiveApi.read(space, locale), api.agents()]);
      if (generation.current !== current) return;
      setSnapshotSession(session); setSnapshot(result); setNotesStale(false); setAdult(false); setJurisdiction(result.identity.declaredJurisdiction ?? '');
      setAgents(availableAgents.agents.filter(a => a.status === 'active'));
    } catch { if (generation.current === current) setError(locale === 'fa' ? 'تنظیمات دریافت نشد. دوباره تلاش کنید.' : 'Your settings could not be loaded. Please try again.'); }
  }, [space, locale, session]);
  const erasureDispatched = useCallback(() => { generation.current++; setNotesStale(true); setSnapshot(current => current && ({ ...current, memories: [] })); setNote(''); setNoteId(null); setRemoving(null); setPresentation(null); }, []);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const loadedContext = useRef({ session, space, locale });
  useLayoutEffect(() => {
    const previous = loadedContext.current; loadedContext.current = { session, space, locale };
    if ((previous.session !== session || previous.space !== space || previous.locale !== locale) && pendingCorrectionRef.current) correctionPending(pendingCorrectionRef.current, false);
    void load(); return invalidate;
  }, [load, invalidate, session, space, locale, correctionPending]);

  const mutate = async (action: () => Promise<AdaptiveSnapshot>, message: string, after?: (result: AdaptiveSnapshot) => void) => {
    if (busyRef.current || pendingCorrectionRef.current) return false;
    const current = generation.current;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (generation.current !== current) return false;
      setSnapshot(result); setPresentation(null); setRemoving(null);
      if (message) nav.snack({ message, tone: 'success' });
      after?.(result);
      return true;
    } catch {
      if (generation.current === current) { haptic.error(); setError(locale === 'fa' ? 'تغییر تأیید نشد. تنظیمات را تازه کنید و دوباره تلاش کنید.' : 'The change was not confirmed. Refresh your settings before trying again.'); }
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };
  const review = async (purpose: AdaptiveOptionalPurpose, revision: number) => {
    if (busyRef.current || pendingCorrectionRef.current) return;
    const current = generation.current;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const data = await adaptiveApi.present(space, purpose, revision, locale);
      if (generation.current !== current) return;
      setSnapshot(data); setPresentation({ purpose, data });
    } catch { if (generation.current === current) setError(locale === 'fa' ? 'انتخاب دریافت نشد. تنظیمات را تازه کنید.' : 'This choice could not be opened. Refresh your settings.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  /** Off acts at once; Undo can only reopen the notice, because turning on always needs a fresh receipt. */
  const withdraw = async (purpose: AdaptiveOptionalPurpose, revision: number, title: string) => {
    const ok = await mutate(() => adaptiveApi.consent(space, purpose, revision, 'withdrawn'), '');
    if (!ok || !alive.current) return;
    nav.snack({ message: y.turnedOff(title), tone: 'info', ms: 5000, action: { label: y.undo, run: () => {
      const latest = snapshotRef.current?.purposes.find(p => p.purpose === purpose);
      if (alive.current && latest) void review(purpose, latest.revision);
    } } });
  };
  const go = (action: () => void) => { if (!pendingCorrectionRef.current) action(); };
  const changeSpace = (next: typeof space) => { if (!pendingCorrectionRef.current && !busyRef.current) nav.setSpace(next); };

  /** Private sheet content vanishes at once when any of these change (no exit-animation afterimage). */
  const scope = `${space}:${locale}:${session}:${snapshot?.identity.bindingId ?? ''}`;
  const openNote = snapshot?.memories.find(m => m.id === noteId) ?? null;
  const allowedAgents = snapshot ? agents.filter(a => snapshot.agents.some(g => g.agentId === a.id && g.allowed)).length : 0;
  const admin = nav.me.member.role === 'owner' || nav.me.member.role === 'superadmin';
  const sheetError = error && <Banner tone="danger">{error}</Banner>;
  const date = (at: number) => new Date(at).toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const anySheet = !!noteId || !!panel || !!presentation;
  const shownNotes = snapshot ? (allNotes ? snapshot.memories : snapshot.memories.slice(0, NOTES_SHOWN)) : [];
  const evaporate = reduced ? { opacity: 0, transition: { duration: DUR.fast } } : { opacity: 0, y: -24, scale: 0.96, transition: { duration: 0.6, ease: EASE.exit } };

  /* ---------- rows and panels, built once: today's grouping, or the registry's sections with Settings v2 ---------- */
  const settingsV2 = nav.me.features?.settingsV2 === true;
  const sc = settingsCopy[locale];
  const identityRow = snapshot && <Row plain lead={<IconTile name={snapshot.identity.confirmed && !adultDeclarationNeeded ? 'check' : 'user'} ok={snapshot.identity.confirmed && !adultDeclarationNeeded} />} chevron disabled={locked} onClick={() => go(() => setPanel('identity'))}
    title={snapshot.identity.confirmed && !adultDeclarationNeeded ? y.identityConfirmed : y.identityConfirm}
    sub={snapshot.identity.confirmed && !adultDeclarationNeeded ? [y.adult, snapshot.identity.declaredJurisdiction].filter(Boolean).join(' · ') : y.identityNeeded} />;
  const telegramRow = <Row plain lead={<IconTile name="telegram" />} chevron disabled={locked} onClick={() => go(() => setPanel('account'))}
    title={y.telegramAccount} sub={y.telegramAccountSub} />;
  const purposesSection = snapshot && <Section title={y.maySection} foot={c.intro}>
    {snapshot.purposes.map(p => {
      const copy = purposeCopy[p.purpose]?.[locale];
      const title = copy?.title ?? p.notice.title;
      const on = p.state === 'granted';
      const sub = !p.available && !on ? privacyUnavailableReason(p.reason, locale)
        : REVIEW_STATES.includes(p.state) || (on && !p.available) ? c.reviewNeeded
        : !on && !snapshot.identity.confirmed ? y.needsIdentity
        : on && paused && COVERED.includes(p.purpose) ? pauseText(locale, space, 'consent')
        : copy?.body ?? p.notice.body;
      return <Switch key={p.purpose} checked={on} attention={on && !p.available} label={title} sub={sub} disabled={busy || locked || (!on && (!p.available || !snapshot.identity.confirmed))}
        onChange={next => go(() => { if (next) void review(p.purpose, p.revision); else void withdraw(p.purpose, p.revision, title); })} />;
    })}
  </Section>;
  const notesSection = snapshot && <Section title={y.notesSection} foot={<>{c.memoryBody} {c[space]} · {c.private}.{!snapshot.explicitMemoryAvailable && <> {privacyUnavailableReason(snapshot.explicitMemoryReason, locale)}</>}
    {!snapshot.memoryCorrectionAvailable && snapshot.memories.some(m => !m.sourceRefs) && <> {locale === 'fa' ? 'ویرایش اینجا در دسترس نیست؛ هنوز می‌توانید یادداشت را حذف یا یادداشت تازه‌ای ذخیره کنید.' : 'Editing is unavailable here; you can still delete a note or save a new one.'}</>}</>}>
    <div className="vx-you-compose">
      <Composer multiline value={note} onChange={setNote} label={c.memoryLabel} sendLabel={c.saveMemory} placeholder={y.addNote} maxLength={2000}
        disabled={busy || locked || notesStale || !snapshot.explicitMemoryAvailable}
        onSend={() => void mutate(async () => { const result = await adaptiveApi.save(space, note, snapshot.revision); setNote(''); return result; }, c.saved)} />
    </div>
    {!snapshot.memories.length && <div className="vx-row"><span className="vx-row-sub">{c.empty}</span></div>}
    {!notesStale && <AnimatePresence initial={false}>
      {shownNotes.map(m => <motion.div key={m.id} className="vx-you-note" layout={!reduced} exit={evaporate} transition={SPRING.snappy}>
        <Row chevron disabled={locked} onClick={() => go(() => { setRemoving(null); setNoteId(m.id); })}
          title={<span className="vx-clamp-2" dir="auto">{m.text}</span>}
          sub={[m.origin && y.noteProvenanceClaim, m.sourceRefs && y.noteProvenanceSummary(m.sourceRefs.length), `${c.expires} ${date(m.expiresAt)}`].filter(Boolean).join(' · ')} />
      </motion.div>)}
    </AnimatePresence>}
    {snapshot.memories.length > NOTES_SHOWN && <Row title={<span className="vx-row-link">{allNotes ? y.showFewer : y.seeAll(snapshot.memories.length)}</span>} onClick={() => setAllNotes(v => !v)} />}
    {snapshot.memories.length >= 2 && <Row plain lead={<IconTile name="spark" />} title={y.summarise} sub={y.summariseSub} chevron disabled={locked} onClick={() => go(() => setPanel('summary'))} />}
  </Section>;
  const sharedRow = <Row plain lead={<IconTile name="groups" />} title={y.sharedMemories} chevron disabled={locked} onClick={() => go(() => onShared ? onShared() : nav.push({ name: 'shared-memories' }))} />;
  const agentAccessRow = <Row plain lead={<IconTile name="lock" />} title={y.agentAccess} value={snapshot ? y.agentsAllowed(allowedAgents) : undefined} chevron disabled={locked || !snapshot} onClick={() => go(() => setPanel('agents'))} />;
  const connectionsRow = <Row plain lead={<IconTile name="plug" />} title={y.connections} chevron disabled={locked} onClick={() => go(() => onConnections ? onConnections() : nav.push({ name: 'connections' }))} />;
  const preferencesRow = <Row plain lead={<IconTile name="sliders" />} title={y.preferences} chevron disabled={locked} onClick={() => go(() => onExperience ? onExperience() : nav.push({ name: 'settings', page: 'preferences' }))} />;
  const inboxRow = <Row plain lead={<IconTile name="inbox" />} title={y.inbox} aria-label={unread ? `${y.inbox} · ${y.unread(unread)}` : undefined}
    end={unread ? <span className="vx-count" aria-hidden="true">{unread.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')}</span> : undefined} chevron disabled={locked} onClick={() => go(() => nav.push({ name: 'settings', page: 'inbox' }))} />;
  const remindersRow = <Row plain lead={<IconTile name="bell" />} title={y.reminders} chevron disabled={locked} onClick={() => go(() => nav.push({ name: 'settings', page: 'reminders' }))} />;
  const voiceRow = <Row plain lead={<IconTile name="mic" />} title={y.voiceRecognition} chevron disabled={locked} onClick={() => go(() => setPanel('voice'))} />;
  const pauseRow = <Row plain role="switch" aria-checked={pause.status?.productPaused === true} lead={<IconTile name="pause" />} title={y.pause}
    sub={pause.status?.productPaused ? y.pauseOn : y.pauseOff} end={<span className="vx-switch" aria-hidden="true" />} onClick={() => setPauseOpen(true)} />;
  const requestsRow = <Row plain lead={<IconTile name="download" />} title={y.requests} chevron disabled={locked} onClick={() => go(() => setPanel('rights'))} />;
  const diagnosticsRow = <Row plain lead={<IconTile name="signal" />} title={y.diagnostics} chevron disabled={locked} onClick={() => go(() => nav.push({ name: 'settings', page: 'diagnostics' }))} />;
  const operatorRow = <Row plain lead={<IconTile name="shield" />} title={y.operatorRequests} chevron disabled={locked} onClick={() => go(() => nav.push({ name: 'settings', page: 'requests' }))} />;
  const languageRow = <Row plain lead={<IconTile name="globe" />} title={c.language} value={y.languageName} chevron disabled={busy || locked} onClick={() => go(() => setPanel('language'))} />;
  const nodes: Partial<Record<string, ReactNode>> = {
    'account.preferences': preferencesRow, 'account.language': languageRow, 'account.inbox': inboxRow, 'account.reminders': remindersRow,
    'account.voiceRecognition': voiceRow, 'account.agentAccess': agentAccessRow, 'account.sharedMemories': sharedRow, 'account.connections': connectionsRow,
    // Pause stays reachable while a note correction is pending: it is deliberately a separate channel.
    'account.pause': pauseRow, 'account.requests': requestsRow, 'account.purposes': purposesSection, 'account.notes': notesSection,
    'account.identity': identityRow, 'account.telegram': telegramRow, 'account.diagnostics': diagnosticsRow, 'account.operatorRequests': operatorRow,
  };
  let n = 0;
  /** One registry section: its rows in one group, then any panels (consent switches, notes) under their own titles. */
  const regrouped = (section: typeof ACCOUNT_SECTIONS[number]) => {
    const defs = accountRows({ me: nav.me, locale }, section).filter(d => nodes[d.id]);
    const rows = defs.filter(d => d.kind !== 'panel'), panels = defs.filter(d => d.kind === 'panel');
    return <Fragment key={section}>
      {rows.length > 0 && <Enter i={n++} first={first}>
        <Section title={sc.sections[section]}>{rows.map(d => <Fragment key={d.id}>{nodes[d.id]}</Fragment>)}</Section>
      </Enter>}
      {panels.map(d => <Enter key={d.id} i={n++} first={first}>{nodes[d.id]}</Enter>)}
    </Fragment>;
  };

  return <section className="vx-scroll vx-you" dir={nav.dir} lang={locale} aria-busy={busy || locked}>
    <PageHead over={`${nav.me.org} · ${nav.me.member.name}`} title={y.you} />
    <div className="vx-space-bar">
      <Seg label={c.space} value={space} onChange={changeSpace} disabled={busy || locked} options={[{ value: 'work', label: c.work }, { value: 'personal', label: c.personal }]} />
    </div>

    {pause.status?.productPaused === true
      ? <Banner tone="warn" action={<button className="vx-btn vx-btn-secondary vx-btn-xs" onClick={() => setPauseOpen(true)}>{y.pausedAction}</button>}>{y.pausedBanner(c[space])}</Banner>
      : snapshot && !snapshot.identity.confirmed && <Banner tone="info" action={<button className="vx-btn vx-btn-secondary vx-btn-xs" disabled={locked} onClick={() => go(() => setPanel('identity'))}>{y.identityAction}</button>}>{y.identityBanner}</Banner>}
    {error && !anySheet && <Banner tone="danger" action={<button className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void load()}>{c.refresh}</button>}>{error}</Banner>}
    {notice && <Banner tone="info" icon="info"><span role="status">{notice}</span></Banner>}

    {!snapshot && !error && <SkeletonRows rows={4} lead="tile" label={c.loading} />}
    {settingsV2 ? <>
      {/* Settings v2: the registry's Vox-wide sections, then your agents' hubs; the controls are the same nodes. */}
      {ACCOUNT_SECTIONS.filter(section => section !== 'admin').map(section => regrouped(section))}
      {snapshot && <Enter i={n++} first={first}>
        <Section title={sc.sections.agents}>
          {!agents.length && <div className="vx-row"><span className="vx-row-sub">{sc.noAgents}</span></div>}
          {agents.map(agent => <Row key={agent.id} plain chevron disabled={locked} title={agent.persona.name} sub={sc.agentRowSub}
            lead={<AgentFace look={agent.look} stage={agent.stage} size={32} variant="disc" still label={agent.persona.name} />}
            onClick={() => go(() => nav.push({ name: 'settings', page: 'agent', params: { agentId: agent.id, from: 'you' } }))} />)}
        </Section>
      </Enter>}
      {regrouped('admin')}
    </> : <>
    {snapshot && <>
      <Enter i={0} first={first}>
        <Section title={y.identitySection}>
          {identityRow}
          {telegramRow}
        </Section>
      </Enter>

      <Enter i={1} first={first}>
        {purposesSection}
      </Enter>

      <Enter i={2} first={first}>
        {notesSection}
      </Enter>
    </>}

    <Enter i={3} first={first}>
      <Section title={y.sharingSection} foot={c.sharingBody}>
        {sharedRow}
        {agentAccessRow}
        {connectionsRow}
      </Section>
    </Enter>

    <Enter i={4} first={first}>
      <Section title={y.experienceSection}>
        {preferencesRow}
        {inboxRow}
        {remindersRow}
        {voiceRow}
      </Section>
    </Enter>

    <Enter i={5} first={first}>
      <Section title={y.controlSection}>
        {/* Pause stays reachable while a note correction is pending: it is deliberately a separate channel. */}
        {pauseRow}
        {requestsRow}
      </Section>
    </Enter>

    {admin && <Enter i={6} first={first}>
      <Section title={y.adminSection}>
        {diagnosticsRow}
        {operatorRow}
      </Section>
    </Enter>}

    <Enter i={7} first={first}>
      <Section title={y.languageSection}>
        {languageRow}
      </Section>
    </Enter>
    </>}

    <footer className="vx-you-foot">
      <p className="vx-footnote"><strong>{c.ai}.</strong> {c.aiBody}</p>
      <p className="vx-footnote">{c.operator} · {c.privacyContact}: <a href="mailto:info@joyixir.com" dir="ltr">info@joyixir.com</a></p>
      <p className="vx-footnote">{c.registeredAddress}: <span dir="ltr">{ADDRESS}</span></p>
      <p className="vx-footnote"><a href="/privacy">{y.privacyRequestLink}</a></p>
    </footer>

    {/* ---------- sheets ---------- */}
    <Sheet open={panel === 'identity' && !!snapshot} onClose={() => setPanel(null)} label={c.identity}
      dock={snapshot && (!snapshot.identity.confirmed || adultDeclarationNeeded) && <button className="vx-btn vx-btn-primary vx-btn-block" disabled={busy || !adult || (!!jurisdiction && !/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/.test(jurisdiction))}
        onClick={() => void mutate(() => adaptiveApi.confirm(space, adult, jurisdiction || undefined), c.confirmed, () => { haptic.success(); setPanel(null); })}>{c.confirm}</button>}>
      {snapshot && <div className="vx-sheet-stack">
        <SheetHead title={c.identity} sub={c.identityBody} />
        {snapshot.identity.confirmed && !adultDeclarationNeeded
          ? <div className="vx-group"><Row lead={<span className="vx-you-ok" aria-hidden="true"><Icon name="check" size={18} width={2} /></span>} title={c.confirmed}
            sub={[y.adult, snapshot.identity.declaredJurisdiction].filter(Boolean).join(' · ')} /></div>
          : <>
            <div className="vx-group"><Row role="checkbox" aria-checked={adult} title={c.adult} end={<Check />} disabled={busy} onClick={() => { haptic.select(); setAdult(!adult); }} /></div>
            <label className="vx-field"><span className="vx-label">{c.jurisdiction}</span>
              <input className="vx-input" value={jurisdiction} placeholder="EE / US-CA" maxLength={11} disabled={busy} dir="ltr" autoCapitalize="characters"
                onChange={e => setJurisdiction(e.target.value.toUpperCase())} aria-describedby="vx-jurisdiction-hint" /></label>
            <p id="vx-jurisdiction-hint" className="vx-footnote">{c.jurisdictionHint}</p>
          </>}
        <p className="vx-footnote">{c.accountNote}</p>
        {sheetError}
      </div>}
    </Sheet>

    {/* Equal weight on purpose: refusing is exactly as easy as agreeing. */}
    <Sheet open={!!presentation} onClose={() => { if (!busyRef.current) setPresentation(null); }} label={presentation?.data.notice.title ?? c.notice}
      dock={presentation && <div className="vx-dock-row">
        <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => { const p = snapshot?.purposes.find(x => x.purpose === presentation.purpose); if (p) void mutate(() => adaptiveApi.consent(space, p.purpose, p.revision, 'declined', presentation.data.receipt), c.saved); }}>{c.decline}</button>
        <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => { const p = snapshot?.purposes.find(x => x.purpose === presentation.purpose); if (p) void mutate(() => adaptiveApi.consent(space, p.purpose, p.revision, 'granted', presentation.data.receipt), c.saved, () => haptic.success()); }}>{c.enable}</button>
      </div>}>
      {presentation && <div className="vx-sheet-stack">
        <SheetHead title={presentation.data.notice.title} sub={c.notice} />
        <div className="vx-you-notice" dir="auto">{presentation.data.notice.body}</div>
        <p className="vx-footnote">{c.noticeVersion}: <bdi>{presentation.data.notice.version}</bdi> · {y.consentFoot}</p>
        {sheetError}
      </div>}
    </Sheet>

    {/* A pending correction keeps its sheet open: closing would abandon a save whose outcome is still unknown. */}
    <LiveSheet open={!!openNote && !!snapshot} scope={scope} onClose={() => { if (!pendingCorrectionRef.current && !busyRef.current) { setNoteId(null); setRemoving(null); } }} label={y.note}>
      {openNote && snapshot && <article className="vx-sheet-stack">
        <span className="vx-over">{y.note} · {c[space]}</span>
        <p className="vx-you-note-text" dir="auto">{openNote.text}</p>
        {(openNote.origin || openNote.sourceRefs) && <div className="vx-you-provenance">
          {openNote.origin && <p>{locale === 'fa' ? 'ادعای بررسی‌شدهٔ شما؛ به‌طور مستقل تأیید نشده است.' : 'User-reviewed claim; not independently verified.'}</p>}
          {openNote.sourceRefs && <p>{locale === 'fa' ? `خلاصهٔ بررسی‌شده از ${openNote.sourceRefs.length} یادداشت؛ حذف خلاصه، اصل یادداشت‌ها را نگه می‌دارد.` : `Reviewed summary of ${openNote.sourceRefs.length} notes; deleting this summary keeps the originals.`}</p>}
        </div>}
        <p className="vx-footnote">{c.expires}: {date(openNote.expiresAt)} · {c.private}</p>
        <MemoryCorrectionEditor key={`${space}:${locale}:${snapshot.identity.bindingId ?? 'unconfirmed'}:${openNote.id}:${openNote.revision}`} note={openNote} snapshot={snapshot} locale={locale}
          disabled={busy || removing === openNote.id}
          onSaved={result => { setSnapshot(current => current && current.revision > result.revision ? current : result); nav.snack({ message: c.saved, tone: 'success' }); setRemoving(null); }}
          onRefresh={() => void load()} onPendingChange={correctionPending}
          onUnconfirmed={savedSpace => setNotice(savedSpace === 'work' ? (locale === 'fa' ? 'ممکن است اصلاح در فضای کاری ذخیره شده باشد. یادداشت‌ها را تازه‌سازی و بررسی کنید.' : 'The correction may have been saved in Work. Refresh notes to check.') : (locale === 'fa' ? 'ممکن است اصلاح در فضای شخصی ذخیره شده باشد. یادداشت‌ها را تازه‌سازی و بررسی کنید.' : 'The correction may have been saved in Personal. Refresh notes to check.'))} />
        {sheetError}
        {removing === openNote.id
          ? <div className="vx-you-confirm" role="group" aria-label={c.deleteTitle}>
            <h3 className="vx-head">{c.deleteTitle}</h3><p className="vx-small vx-2">{c.deleteBody}</p>
            <div className="vx-dock-row">
              <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setRemoving(null)}>{c.cancel}</button>
              <button className="vx-btn vx-btn-danger" disabled={busy} onClick={() => { const m = openNote; void mutate(() => adaptiveApi.remove(space, m.id, m.revision), c.deleted, () => { haptic.success(); setNoteId(null); }); }}>{c.remove}</button>
            </div>
          </div>
          : <div className="vx-group"><Row tone="danger" lead={<Icon name="trash" size={20} />} title={c.remove} disabled={busy || locked} onClick={() => { haptic.warn(); setRemoving(openNote.id); }} /></div>}
      </article>}
    </LiveSheet>

    <LiveSheet open={panel === 'agents' && !!snapshot} scope={scope} onClose={() => setPanel(null)} label={c.agents}>
      {snapshot && <div className="vx-sheet-stack">
        <SheetHead title={c.agents} sub={c.agentsBody} />
        <div className="vx-group">
          {!agents.length && <div className="vx-row"><span className="vx-row-sub">{c.noAgents}</span></div>}
          {agents.map(agent => {
            const allowed = snapshot.agents.some(g => g.agentId === agent.id && g.allowed);
            return <NotesGrantRow key={agent.id} agent={agent} allowed={allowed} label={y.canUseNotes} disabled={busy || !snapshot.identity.confirmed}
              onToggle={() => void mutate(() => adaptiveApi.agent(space, agent.id, !allowed, snapshot.revision), c.saved)} />;
          })}
        </div>
        {!snapshot.identity.confirmed && <p className="vx-footnote">{y.needsIdentity}</p>}
        {sheetError}
      </div>}
    </LiveSheet>

    <LiveSheet open={panel === 'summary' && !!snapshot} scope={scope} onClose={() => { if (!busyRef.current) setPanel(null); }} label={y.summarise}>
      {snapshot && <div className="vx-sheet-stack">
        <ReviewedMemoryPanel key={`${space}:${locale}:${snapshot.identity.bindingId ?? 'unconfirmed'}`} snapshot={snapshot} agents={agents} locale={locale}
          disabled={busy || notesStale || !snapshot.explicitMemoryAvailable} pauseBlocked={pause.coveredBlocked} personalizationPaused={paused} pauseEpoch={pause.status?.useEpoch ?? undefined}
          onSaved={result => { setSnapshot(result); nav.snack({ message: c.saved, tone: 'success' }); }} />
      </div>}
    </LiveSheet>

    <Sheet open={panel === 'voice'} onClose={() => setPanel(null)} label={y.voiceRecognition}>
      <div className="vx-sheet-stack"><VoiceRecognitionPanel key={space} space={space} locale={locale} /></div>
    </Sheet>

    <Sheet open={panel === 'rights'} onClose={() => setPanel(null)} label={y.requests} dock={<div ref={setRightsDock} className="vx-dock-row" />}>
      <div className="vx-sheet-stack"><RightsRequestPanel space={space} locale={locale} sessionKey={session} dock={rightsDock} memorySnapshot={snapshot} notesStale={notesStale} mutationDisabled={busy || locked} onRefreshNotes={() => void load()} onErasurePendingChange={correctionPending} onErasureDispatched={erasureDispatched} /></div>
    </Sheet>

    <Sheet open={pauseOpen} onClose={() => setPauseOpen(false)} label={y.pause}>
      <div className="vx-sheet-stack">
        <ProductPausePanel locale={locale} sessionKey={session} initialSpace={space}
          onReviewProfile={() => { setPauseOpen(false); go(() => setPanel('identity')); }} />
      </div>
    </Sheet>

    <Sheet open={panel === 'account'} onClose={() => setPanel(null)} label={y.telegramAccount}>
      <div className="vx-sheet-stack">
        <SheetHead title={y.telegramAccount} sub={y.telegramAccountSub} />
        <UserInfo member={nav.me.member} locale={locale} />
      </div>
    </Sheet>

    <Picker open={panel === 'language'} onClose={() => setPanel(null)} title={c.language} value={locale}
      options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))} onChange={l => { if (!pendingCorrectionRef.current && l !== locale) nav.setLocale(l); }} />
  </section>;
}
