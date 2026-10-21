'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useReducer, useRef, useState } from 'react';
import { MAX_AGENT_SKILLS, type PackId } from '@/lib/studio/skills/types';
import type { CharacterLook } from '@/lib/studio/types';
import { api, haptic, type SpawnBrief, type SuccessorTemplate } from '../../../_lib/client';
import { useNav } from '../../StudioApp';
import { Icon, Spinner } from '../../ui';
import { BriefComposer } from './BriefComposer';
import { BriefHeader, CustomLine, DraftError, LinkButton, PackRow } from './BriefBits';
import { packTitle, roleTitle, useCatalog, type CatalogRole } from './catalog';
import { Clarifier, type Clarify } from './Clarifier';
import { briefCopy } from './copy';
import { Drafting } from './Drafting';
import { EMPTY_FINE_TUNE, effectiveLanguages, FineTune, type FineTuneValue } from './FineTune';
import { useAfter, useBeat, useKeyboard, useOnline, useStudioLocale } from './hooks';
import { useSpawnMotion } from './motion';
import { Dock, type Busy } from './shared';
import { INITIAL_ROLES, isLocked, onIds, rolesReducer, type RolesAction, type RolesState } from './roles';
import { RoleSheet } from './RoleSheet';
import { hasPersian, PACK_DOMAIN, routable, ROUTING } from './routing';
import { RouteCard } from './RouteCard';
import { SkillsSheet } from './SkillsSheet';
import { useRouting } from './useRouting';

type SheetState = null | { kind: 'roles'; pack?: PackId } | { kind: 'skills' };

/**
 * Step 1. One sentence is enough: the composer is the hero, a role appears
 * only when routing is confident, at most one question is asked (after
 * Draft), and everything personal waits behind Fine-tune.
 *
 * The wizard owns the error (`error`, shown inline here, never as a second banner),
 * learns whether closing would lose anything (`onDirty`), and hands over the
 * drafted look (`drafted`) so the forming creature poofs into it before `onDrafted`.
 */
export function BriefStep({ busy, successorOf, error, onDraft, onDirty, drafted, onDrafted }: {
  busy: Busy; successorOf?: string; error?: string | null; onDraft: (brief: SpawnBrief) => void;
  /** Anything typed, picked or fine-tuned, so closing the wizard asks first */
  onDirty?: (dirty: boolean) => void;
  /** The draft's look once it landed: the forming creature poofs into it, then `onDrafted` moves on */
  drafted?: CharacterLook | null; onDrafted?: () => void;
}) {
  const catalog = useCatalog();
  const nav = useNav();
  const decisions = nav.me.features.skillRouting === 'decisions';
  const userLocale = useStudioLocale();
  const locale = nav.locale ?? 'en';
  // Chrome follows the app language; examples also follow Telegram's, role titles the brief's script (or a Persian app).
  const t = briefCopy[locale];
  const online = useOnline();
  const m = useSpawnMotion();

  const [text, setText] = useState('');
  const [fine, setFine] = useState<FineTuneValue>(EMPTY_FINE_TUNE);
  const [fineOpen, setFineOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [roles, dispatchRoles] = useReducer(rolesReducer, INITIAL_ROLES);
  const rolesRef = useRef<RolesState>(roles);
  rolesRef.current = roles;
  const [sheet, setSheet] = useState<SheetState>(null);
  const [ask, setAsk] = useState<Clarify | null>(null);
  const [asked, setAsked] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [predecessor, setPredecessor] = useState<SuccessorTemplate | null>(null);
  const [draftRole, setDraftRole] = useState<CatalogRole>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const slotRef = useRef<HTMLDivElement>(null);

  const drafting = busy === 'draft';
  const kb = useKeyboard(focused);
  const trimmed = text.trim();
  const fa = hasPersian(text);
  const faTitles = fa || locale === 'fa';
  const autoLanguages = fa ? ['Persian'] : [];
  const hasRoles = catalog.shelves.length > 0;
  const appliedRole = roles.applied ? catalog.roles.get(roles.applied.roleId) : undefined;
  const items = appliedRole ? roles.skills[appliedRole.id] ?? [] : [];
  const locked = isLocked(roles.applied);
  // While Draft is resolving (route, clarifier answer) the brief is frozen: what is sent is what is shown.
  const frozen = submitting || !!pending;
  const routingOn = hasRoles && online && !locked && !drafting && !ask && !frozen;

  /** Dispatch and return the resulting state (async handlers act on it immediately). */
  const commit = (action: RolesAction): RolesState => {
    const next = rolesReducer(rolesRef.current, action);
    rolesRef.current = next;
    dispatchRoles(action);
    return next;
  };

  const routing = useRouting({
    text, enabled: routingOn, exclude: roles.exclude, answer,
    onSuggest: (s, routedText) => commit({ type: 'suggest', s, text: routedText, role: s.roleId ? catalog.roles.get(s.roleId) : undefined }),
  });

  // Successor: carry the predecessor's role and skills (detachable like any other role).
  // A narrow template, not the agent: fired agents are visible to admins only, successors are drafted by any member.
  useEffect(() => {
    if (!successorOf) return;
    let cancelled = false;
    Promise.resolve().then(() => api.successorTemplate(successorOf))
      .then((r) => { if (!cancelled && r?.name) setPredecessor(r); })
      .catch(() => { /* the brief still works without it */ });
    return () => { cancelled = true; };
  }, [successorOf]);
  const carried = useRef(false);
  useEffect(() => {
    if (carried.current || !predecessor || !catalog.loaded) return;
    carried.current = true;
    const role = predecessor.roleId ? catalog.roles.get(predecessor.roleId) : undefined;
    if (role) commit({ type: 'apply', role, source: 'successor', text: '', skills: predecessor.skillIds });
  }, [predecessor, catalog]);
  const predecessorName = predecessor?.name;
  const legacySuccessor = !!predecessor && catalog.loaded && !(predecessor.roleId && catalog.roles.has(predecessor.roleId));

  // Undo after "Keep it custom" lasts a few seconds.
  useEffect(() => {
    if (!roles.undo) return;
    const timer = setTimeout(() => dispatchRoles({ type: 'expire' }), ROUTING.undoMs);
    return () => clearTimeout(timer);
  }, [roles.undo]);

  const thinking = useAfter(routing.inFlight, ROUTING.thinkingAfterMs);
  const happy = useBeat(roles.applied?.roleId, 1200);
  const expr = thinking ? 'thinking' : happy ? 'happy' : focused && trimmed ? 'listening' : 'idle';

  const latest = useRef({ text, fine });
  latest.current = { text, fine };

  // A carried successor role is not the creator's input; anything else they typed, picked or tuned is.
  const dirty = !!trimmed || (!!roles.applied && roles.applied.source !== 'successor')
    || fine.presentation !== undefined || fine.languages !== null || !!(fine.culture.trim() || fine.age.trim() || fine.accent.trim())
    || Object.keys(fine.traits).length > 0;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  const draftWith = (st: RolesState) => {
    if (!mounted.current) return;
    const { text: now, fine } = latest.current;
    const description = now.trim();
    const role = st.applied ? catalog.roles.get(st.applied.roleId) : undefined;
    const langs = effectiveLanguages(fine, hasPersian(now) ? ['Persian'] : []);
    const brief: SpawnBrief = {
      description: description || undefined,
      presentation: fine.presentation,
      languages: langs.length ? langs : undefined,
      culture: fine.culture.trim() || undefined,
      accent: fine.accent.trim() || undefined,
      age: fine.age.trim() || undefined,
      // Only sliders the creator moved: untouched defaults would bias every draft.
      ...(Object.keys(fine.traits).length ? { traits: { ...fine.traits } } : {}),
      ...(role && st.applied ? {
        roleId: role.id,
        skillIds: onIds(st.skills[role.id] ?? []).filter((id) => catalog.skills.has(id)).slice(0, MAX_AGENT_SKILLS),
        domain: PACK_DOMAIN[role.pack],
        routing: { source: st.applied.source, ...(typeof st.applied.confidence === 'number' ? { confidence: Math.round(st.applied.confidence * 100) / 100 } : {}) },
      } : {}),
    };
    setDraftRole(role);
    setAsk(null);
    setPending(null);
    onDraft(brief);
  };

  const submit = async () => {
    if (drafting || frozen || !online) return;
    haptic.tap();
    let st = rolesRef.current;
    // A role already showing (routed match, picked or carried) drafts at once; otherwise route once more.
    const showing = !!st.applied;
    if (routingOn && !showing && routable(trimmed)) {
      setSubmitting(true);
      const s = await routing.finalize(trimmed, decisions);
      if (!mounted.current) return;
      setSubmitting(false);
      if (s) {
        st = commit({ type: 'suggest', s, text: trimmed, role: s.roleId ? catalog.roles.get(s.roleId) : undefined });
        if (s.clarify && !st.applied && !asked) {
          setAsk(s.clarify);
          setAsked(true);
          setFocused(false);
          haptic.soft();
          return;
        }
      }
    }
    draftWith(st);
  };

  const onAnswer = async (value: string) => {
    haptic.select();
    setPending(value);
    setAnswer(value);
    let st = rolesRef.current;
    const role = catalog.roles.get(value);
    if (role) {
      st = commit({ type: 'apply', role, source: 'picked', text: trimmed });
    } else {
      const s = await routing.reroute(trimmed, value, decisions);
      if (!mounted.current) return;
      const routed = s?.roleId ? catalog.roles.get(s.roleId) : undefined;
      if (s && routed && !s.clarify && s.confidence >= ROUTING.afterAnswer && !rolesRef.current.exclude.includes(routed.id)) {
        st = commit({ type: 'apply', role: routed, source: s.source, confidence: s.confidence, text: trimmed, skills: s.skillIds });
      } else {
        st = rolesRef.current;
      }
    }
    draftWith(st);
  };

  const pick = (roleId: string | null) => {
    setSheet(null);
    if (!roleId) { if (rolesRef.current.applied) { haptic.select(); commit({ type: 'detach' }); } return; }
    const role = catalog.roles.get(roleId);
    if (!role) return;
    haptic.select();
    commit({ type: 'apply', role, source: 'picked', text: trimmed });
  };

  if (drafting || drafted) {
    return <Drafting look={drafted} onDone={onDrafted} locale={locale} role={draftRole} roleName={draftRole ? roleTitle(draftRole, faTitles) : undefined} />;
  }

  const placeholder = predecessorName ? t.successorPlaceholder(predecessorName)
    : roles.applied?.source === 'picked' ? t.pickedPlaceholder : undefined;
  const announce = appliedRole && (roles.applied?.source === 'decisions' || roles.applied?.source === 'local')
    ? t.announce(roleTitle(appliedRole, faTitles), packTitle(catalog, appliedRole.pack, t.packFull[appliedRole.pack], faTitles)) : '';
  const openRoles = (pack?: PackId) => setSheet({ kind: 'roles', pack });

  let slot: { key: string; node: React.ReactNode } | null = null;
  if (ask) {
    slot = { key: 'ask', node: <Clarifier t={t} clarify={ask} pending={pending} onAnswer={(v) => void onAnswer(v)}
      subFor={(v) => { const r = catalog.roles.get(v); return r ? packTitle(catalog, r.pack, t.packFull[r.pack], faTitles) : undefined; }} /> };
  } else if (appliedRole && roles.applied) {
    slot = { key: 'role', node: <RouteCard t={t} role={appliedRole} source={roles.applied.source} predecessorName={predecessorName} skills={items} fa={faTitles}
      onToggleSkill={(id) => dispatchRoles({ type: 'toggle', id })} onMoreSkills={() => setSheet({ kind: 'skills' })}
      onChange={() => openRoles(appliedRole.pack)} onDetach={() => commit({ type: 'detach' })} /> };
  } else if (roles.undo) {
    slot = { key: 'undo', node: <CustomLine t={t} onUndo={() => commit({ type: 'undo' })} /> };
  } else if (legacySuccessor) {
    slot = { key: 'legacy', node: <CustomLine t={t} onBrowse={hasRoles ? () => openRoles() : undefined} /> };
  } else if (!trimmed && hasRoles && !kb.up) {
    slot = { key: 'packs', node: <PackRow t={t} packs={catalog.shelves.map((s) => s.pack)} onPick={(p) => openRoles(p)} /> };
  } else if (roles.detached) {
    slot = { key: 'custom', node: <CustomLine t={t} onBrowse={hasRoles ? () => openRoles() : undefined} /> };
  }

  const ctaLabel = !online ? t.ctaOffline : successorOf ? t.ctaSuccessor : !trimmed && !roles.applied ? t.ctaEmpty : t.cta;
  const ctaIcon = ctaLabel === t.ctaEmpty ? 'dice' : 'spark';

  return (
    <>
      <div className="vx-scroll vx-brief" inert={!!sheet}>
        <AnimatePresence initial={false}>
          {!online && (
            <motion.div key="offline" className="vx-banner info" initial={m.card.initial} animate={m.card.animate} exit={m.card.exit}>
              {hasRoles ? t.offline : t.offlineNoRoles}
            </motion.div>
          )}
        </AnimatePresence>
        <BriefHeader t={t} hue={appliedRole?.hue ?? 'ash'} expr={expr} successor={!!successorOf} successorName={predecessorName} />
        <BriefComposer value={text} label={t.composerLabel} placeholder={placeholder} describe={t.example}
          examples={briefCopy[locale === 'fa' ? 'fa' : userLocale].examples} onFocusChange={setFocused} onSubmit={() => void submit()} readOnly={frozen}
          onChange={(v) => {
            setText(v);
            if (ask) setAsk(null);
            if (!v.trim()) commit({ type: 'clearRouted' });
          }}
          footer={!slot && hasRoles && trimmed ? <LinkButton label={t.browse} onClick={() => openRoles()} /> : undefined} />
        <AnimatePresence initial={false} mode="popLayout">
          {slot && (
            <motion.div key={slot.key} ref={slotRef} tabIndex={-1} className="vx-slot" layout={!m.reduce} initial={m.card.initial} animate={m.card.animate} exit={m.card.exit}>
              {slot.node}
            </motion.div>
          )}
        </AnimatePresence>
        {!kb.up && !ask && (
          <motion.div layout={m.reduce ? false : 'position'}>
            <FineTune t={t} open={fineOpen} onToggle={() => setFineOpen((o) => !o)} value={fine} onChange={setFine} autoLanguages={autoLanguages} disabled={frozen} />
          </motion.div>
        )}
        {error && <DraftError t={t} message={error} onRetry={() => void submit()} />}
      </div>
      <Dock inert={!!sheet} style={kb.up && kb.inset ? { transform: `translateY(-${kb.inset}px)` } : undefined}>
        {ask ? (
          <button type="button" className="vx-btn vx-btn-secondary vx-btn-block" disabled={!!pending} onClick={() => { haptic.tap(); draftWith(rolesRef.current); }}>
            {t.skip}
          </button>
        ) : (
          <button type="button" className="vx-btn vx-btn-primary vx-btn-block vx-catalog-layout-4fa00029"  disabled={!online || submitting}
            aria-busy={submitting || undefined} onClick={() => void submit()}>
            {submitting ? <Spinner /> : online && <Icon name={ctaIcon} width={2} />}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={ctaLabel} initial={m.label.initial} animate={m.label.animate} exit={m.label.exit}>{ctaLabel}</motion.span>
            </AnimatePresence>
          </button>
        )}
      </Dock>
      <div className="vx-sr" role="status" aria-live="polite">{announce}</div>
      <RoleSheet t={t} open={sheet?.kind === 'roles'} onClose={() => setSheet(null)} fa={faTitles}
        initialPack={sheet?.kind === 'roles' ? sheet.pack ?? appliedRole?.pack : undefined}
        closest={roles.closest} selectedId={roles.applied?.roleId ?? null} onPick={pick} returnFocus={slotRef} />
      <SkillsSheet t={t} open={sheet?.kind === 'skills'} onClose={() => setSheet(null)} fa={faTitles} roleId={appliedRole?.id}
        selected={onIds(items)} onChange={(ids) => dispatchRoles({ type: 'setSkills', ids })} returnFocus={slotRef} />
    </>
  );
}
