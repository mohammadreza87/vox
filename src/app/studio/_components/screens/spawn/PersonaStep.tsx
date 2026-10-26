'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_AGENT_SKILLS } from '@/lib/studio/skills/types';
import { api, haptic, type PersonaSpec } from '../../../_lib/client';
import { DUR, EASE, SPRING } from '../../../_lib/motion';
import { spawnCopy, type SpawnCopy } from '../../../_lib/spawn-copy';
import { AgentFace } from '../../Cloud';
import { errorMessage, useNav } from '../../StudioApp';
import { Composer, Icon, Spinner } from '../../ui';
import { useCatalog } from './catalog';
import { briefCopy } from './copy';
import { RoleLine, VoiceExamples } from './PersonaParts';
import { mergeSelection, onIds, type SkillToggle } from './roles';
import { Dock, type StepProps } from './shared';
import { SkillChips } from './SkillChips';
import { SkillsSheet } from './SkillsSheet';

type TextKey = 'role' | 'tagline' | 'backstory' | 'personality' | 'communicationStyle' | 'wontDo';
/** List fields: edited one per line, read as a dotted line. `max` mirrors the server's persona limits. */
type ListKey = 'values' | 'expertise' | 'opinions' | 'signatureMoves' | 'petPeeves';
type EditKey = 'name' | TextKey | ListKey;
const LIST_MAX: Record<ListKey, number> = { values: 6, expertise: 10, opinions: 4, signatureMoves: 4, petPeeves: 3 };
const isList = (k: EditKey): k is ListKey => k in LIST_MAX;

/**
 * The doc card's sections, in reading order (board spawn-2; interaction §3.4.3); labels come from spawnCopy.
 * `optional` sections show only when they have content (older drafts have no opinions, moves or peeves).
 */
const SECTIONS: ReadonlyArray<{ key: TextKey | ListKey; rows: number; tone?: 'warn'; optional?: boolean }> = [
  { key: 'role', rows: 1 },
  { key: 'tagline', rows: 1 },
  { key: 'backstory', rows: 4 },
  { key: 'personality', rows: 3 },
  { key: 'communicationStyle', rows: 3 },
  { key: 'values', rows: 3 },
  { key: 'expertise', rows: 3 },
  { key: 'opinions', rows: 4, optional: true },
  { key: 'signatureMoves', rows: 3, optional: true },
  { key: 'petPeeves', rows: 2, optional: true },
  { key: 'wontDo', rows: 2, tone: 'warn' },
];
const EDITABLE: readonly EditKey[] = ['name', ...SECTIONS.map((s) => s.key)];
const SKILL_SAVE_MS = 600;

const listOf = (p: PersonaSpec, k: ListKey): string[] => p[k] ?? [];
const show = (p: PersonaSpec, k: EditKey) => (isList(k) ? listOf(p, k).join(' · ') : p[k]);
const toDraft = (p: PersonaSpec, k: EditKey) => (isList(k) ? listOf(p, k).join('\n') : p[k]);
const fromDraft = (k: EditKey, v: string): Partial<PersonaSpec> =>
  (isList(k) ? { [k]: v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, LIST_MAX[k]) } : { [k]: v });
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

interface Refined { keys: Set<EditKey>; before: Partial<PersonaSpec>; seq: number }
/** Lines Claude changed: edited sections plus the voice examples and languages, which show outside the sections. */
const changeCount = (r: Refined) => r.keys.size + (r.before.voiceExamples ? 1 : 0) + (r.before.languages ? 1 : 0);

/**
 * Draft (board spawn-2): pick a name, read the persona as one document, tap any section to edit it in
 * place, or ask Claude in the composer. Lines Claude rewrote get the volt sweep, with Undo.
 * Show, then tell: the library role, its skills (toggled here, saved after a pause) and how they
 * sound come before the long-form profile.
 */
export function PersonaStep({ agent, names, busy, run, onUpdate, onNext, live, onSayHi }: StepProps & {
  names: string[]; live?: boolean; onSayHi?: () => void;
}) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const c = spawnCopy[locale].persona;
  const t = briefCopy[locale];
  const catalog = useCatalog();
  const p = agent.persona;
  const [editing, setEditing] = useState<EditKey | null>(null);
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');
  const [refined, setRefined] = useState<Refined | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const advancingRef = useRef(false);
  const seq = useRef(0);
  const editable = agent.canEdit;
  // Skills follow the voice rule (creator only, while forming); older views without the flag keep canEdit.
  const shapeable = editable && agent.canShapeIdentity !== false;

  // Skills: optimistic toggles, saved after a short pause with PATCH { skillIds } (merged server-side).
  // One PATCH in flight at a time; the newest selection waits in `queued` and wins.
  const saved = p.skillIds ?? [];
  const [items, setItems] = useState<SkillToggle[]>(() => saved.map((id) => ({ id, on: true })));
  const timer = useRef<{ handle: ReturnType<typeof setTimeout>; ids: string[] } | null>(null);
  const queued = useRef<string[] | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ agent, onUpdate, nav });
  latest.current = { agent, onUpdate, nav };
  const savedKey = saved.join('|');
  useEffect(() => {
    // The server copy changed (refine, save): keep off chips in place, add new ones.
    if (timer.current || queued.current || inFlight.current) return;
    setItems((cur) => (same(onIds(cur), saved) ? cur : mergeSelection(cur, saved)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const pump = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const sending = (async () => {
      let ok = true;
      while (queued.current) {
        const ids = queued.current;
        queued.current = null;
        try {
          const r = await api.updatePersona(latest.current.agent.id, { skillIds: ids });
          if (r?.agent) { latest.current.agent = r.agent; latest.current.onUpdate(r.agent); }
          ok = true;
        } catch (e) {
          ok = false;
          if (queued.current) continue; // a newer selection is already waiting: try that instead
          haptic.error();
          latest.current.nav.toast(errorMessage(e), 'error');
          // Roll back to what the server last confirmed.
          setItems((latest.current.agent.persona.skillIds ?? []).map((id) => ({ id, on: true })));
        }
      }
      inFlight.current = null;
      return ok;
    })();
    inFlight.current = sending;
    return sending;
  }, []);

  /** Sends any pending selection now and resolves when every skill save has settled. */
  const flushSkills = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current.handle);
      queued.current = timer.current.ids;
      timer.current = null;
    }
    return queued.current || inFlight.current ? pump() : Promise.resolve(true);
  }, [pump]);
  const skillsPending = () => !!(timer.current || queued.current || inFlight.current);

  const setSkills = (next: SkillToggle[]) => {
    setItems(next);
    const ids = onIds(next).filter((id) => catalog.skills.has(id)).slice(0, MAX_AGENT_SKILLS);
    if (timer.current) clearTimeout(timer.current.handle);
    const handle = setTimeout(() => { timer.current = null; queued.current = ids; void pump(); }, SKILL_SAVE_MS);
    timer.current = { handle, ids };
  };
  // Leaving the step (Back, Discard) mid-debounce still saves what the creator chose.
  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current.handle);
    queued.current = timer.current.ids;
    timer.current = null;
    void pump();
  }, [pump]);

  const toggleSkill = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!target || (!target.on && onIds(items).length >= MAX_AGENT_SKILLS)) return;
    setSkills(items.map((i) => (i.id === id ? { ...i, on: !i.on } : i)));
  };

  const save = async (patch: Partial<PersonaSpec>) => {
    const r = await run('save', () => api.updatePersona(agent.id, patch));
    if (r) { onUpdate(r.agent); setEditing(null); haptic.success(); }
    return !!r;
  };
  const edit = (k: EditKey) => {
    if (!editable || busy) return;
    haptic.select();
    setEditing(k);
    setDraft(toDraft(p, k));
    // A "nothing changed" note is stale once the creator edits by hand; a real change keeps its Undo.
    setRefined((r) => (r && changeCount(r) > 0 ? r : null));
  };
  const commit = () => { if (editing && draft.trim()) void save(fromDraft(editing, draft)); };

  const refine = async () => {
    const text = instruction.trim();
    if (!text) return;
    // A skill save still pending goes first, so Claude refines what the creator sees.
    if (skillsPending() && !(await flushSkills())) return;
    const before = latest.current.agent.persona;
    const r = await run('refine', () => api.refine(agent.id, text));
    if (!r) return;
    const after = r.agent.persona;
    const keys = new Set(EDITABLE.filter((k) => String(show(before, k)) !== String(show(after, k))));
    onUpdate(r.agent);
    setInstruction('');
    setEditing(null);
    haptic.success();
    const prev: Partial<PersonaSpec> = {};
    for (const k of keys) Object.assign(prev, { [k]: isList(k) ? listOf(before, k) : before[k] });
    // Undo also restores the voice examples Claude rewrote (they show in "How they talk", not as a section).
    if (!same(before.voiceExamples, after.voiceExamples)) prev.voiceExamples = before.voiceExamples ?? [];
    // Languages are read-only here but Claude may change them; Undo puts them back too.
    if (!same(before.languages, after.languages)) prev.languages = before.languages ?? [];
    // Always record the outcome: an empty change set reads "Claude kept everything as it was".
    setRefined({ keys, before: prev, seq: ++seq.current });
  };

  const undo = async () => {
    if (!refined) return;
    const r = await run('undo', () => api.updatePersona(agent.id, refined.before));
    if (r) { onUpdate(r.agent); setRefined(null); haptic.select(); }
  };

  const next = async () => {
    if (busy || advancingRef.current || (editing !== null && !draft.trim())) return;
    if (!skillsPending()) {
      if (editing !== null && !(await save(fromDraft(editing, draft)))) return;
      onNext();
      return;
    }
    // Re-entry guard: a second tap while skills save must not advance twice (and skip a step).
    advancingRef.current = true;
    setAdvancing(true);
    try {
      if (!(await flushSkills())) return;
      if (editing !== null && !(await save(fromDraft(editing, draft)))) return;
      onNext();
    } finally {
      advancingRef.current = false;
      setAdvancing(false);
    }
  };

  const showSkills = catalog.skills.size > 0 && (editable || items.length > 0);
  // Expertise gives way to skills only when the skills are actually on screen.
  const hasSkills = showSkills && onIds(items).some((id) => catalog.skills.has(id));
  const role = p.roleId ? catalog.roles.get(p.roleId) : undefined;
  const extra = role ? role.optionalSkills.filter((s) => catalog.skills.has(s) && !items.some((i) => i.id === s)).length : 0;
  const sections = SECTIONS.filter((s) => (s.key === 'expertise' ? !hasSkills : !s.optional || editing === s.key || !!show(p, s.key)));
  const changed = (k: EditKey) => refined?.keys.has(k) ?? false;
  const n = refined ? changeCount(refined) : 0;
  const cta = editing !== null ? c.saveNext : live ? c.nextLook : c.useName(p.name);
  const saving = busy === 'save' || advancing;
  const meta = [p.culture, p.age, p.accent].filter(Boolean).join(' · ');

  return (
    <>
      <div className="vx-scroll vx-form tall-dock" inert={skillsOpen}>
        {editable && names.length > 1 && (
          <div className="vx-field" role="group" aria-label={c.suggests}>
            <span className="vx-over" aria-hidden="true">{c.suggests}</span>
            <div className="vx-chip-wrap">
              {names.map((name) => (
                <button key={name} type="button" className="vx-chip vx-chip-name" aria-pressed={name === p.name} disabled={!!busy}
                  onClick={() => { if (name !== p.name) { haptic.select(); void save({ name }); } }}>{name}</button>
              ))}
            </div>
          </div>
        )}

        <article className="vx-doc" aria-label={c.persona(p.name)}>
          <div className="vx-doc-head">
            <AgentFace look={agent.look} size={56} stage={agent.stage} expr={busy === 'refine' ? 'thinking' : 'happy'} label={p.name} />
            {editing === 'name' ? (
              <Editor c={c} label={c.name} rows={1} value={draft} onChange={setDraft} onCancel={() => setEditing(null)} onSave={commit} saving={busy === 'save'} />
            ) : (
              <>
                <div className="vx-doc-title">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.h1 key={p.name} className="vx-title" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: { duration: DUR.instant, ease: EASE.exit } }} transition={SPRING.snappy}>{p.name}</motion.h1>
                  </AnimatePresence>
                  <RoleLine t={t} persona={p} hue={agent.look.hue} />
                  {meta && <span className="vx-small vx-2" dir="auto">{meta}</span>}
                </div>
                {editable && <button type="button" className="vx-icon-btn vx-doc-edit" aria-label={c.editName} disabled={!!busy} onClick={() => edit('name')}><Icon name="edit" size={18} /></button>}
              </>
            )}
          </div>
          {showSkills && (
            <section className="vx-doc-sec">
              <span className="vx-over">{t.skillsCount(onIds(items).length)}</span>
              <SkillChips t={t} items={items} onToggle={toggleSkill} readOnly={!shapeable} extra={extra} fa={locale === 'fa'}
                onAdd={shapeable ? () => setSkillsOpen(true) : undefined} />
            </section>
          )}
          {sections.map((s) => editing === s.key ? (
            <Editor key={s.key} c={c} label={c.sections[s.key]} rows={s.rows} value={draft} onChange={setDraft} tone={s.tone}
              onCancel={() => setEditing(null)} onSave={commit} saving={busy === 'save'} list={isList(s.key)} />
          ) : (
            <button key={s.key} type="button" className="vx-doc-sec tap" disabled={!editable || !!busy} onClick={() => edit(s.key)}>
              <span className={`vx-over${s.tone ? ` ${s.tone}` : ''}`}>{c.sections[s.key]}</span>
              <span className={`vx-doc-text${s.tone ? ' vx-2' : ''}`} dir="auto">
                {changed(s.key) ? <span key={refined!.seq} className="vx-changed">{show(p, s.key)}</span> : show(p, s.key) || <span className="vx-3">—</span>}
              </span>
            </button>
          ))}
          {p.languages.length > 0 && (
            <section className="vx-doc-sec">
              <span className="vx-over">{t.fields.languages}</span>
              <span className="vx-doc-text" dir="auto">
                {refined?.before.languages ? <span key={refined.seq} className="vx-changed">{p.languages.join(' · ')}</span> : p.languages.join(' · ')}
              </span>
            </section>
          )}
        </article>

        <VoiceExamples t={t} agent={agent} />

        <div className="vx-hint" aria-live="polite">
          <Icon name="spark" size={16} width={2} className="vx-hint-spark" />
          {n > 0 ? (
            <span>{c.updated(n)}
              <button type="button" className="vx-link-btn" onClick={() => void undo()} disabled={!!busy}>{busy === 'undo' ? <Spinner size={12} /> : c.undo}</button>
            </span>
          ) : <span>{refined ? t.unchanged : editable ? c.tapToEdit : c.readOnly(p.name)}</span>}
          {onSayHi && <button type="button" className="vx-chip vx-hint-end" onClick={onSayHi}><Icon name="chat" size={14} />{c.tryChat}</button>}
        </div>
      </div>
      <Dock stack inert={skillsOpen}>
        {editable && (
          <Composer value={instruction} onChange={setInstruction} onSend={() => void refine()} busy={busy === 'refine'} disabled={(!!busy && busy !== 'refine') || advancing}
            placeholder={c.askPlaceholder(p.name)} label={c.askLabel} sendLabel={c.sendToClaude} maxLength={400} />
        )}
        <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={() => void next()} disabled={!!busy || advancing || (editing !== null && !draft.trim())}
          aria-busy={saving || undefined} aria-label={saving ? cta : undefined}>
          {saving ? <Spinner /> : cta}
        </button>
      </Dock>
      <SkillsSheet t={t} open={skillsOpen} onClose={() => setSkillsOpen(false)} roleId={p.roleId} fa={locale === 'fa'}
        selected={onIds(items)} onChange={(ids) => setSkills(mergeSelection(items, ids))} />
    </>
  );
}

/** A section opened for editing: hue rail, the field, Cancel / Save. Escape cancels, ⌘/Ctrl+Enter saves. */
function Editor({ c, label, rows, value, onChange, onCancel, onSave, saving, tone, list }: {
  c: SpawnCopy['persona']; label: string; rows: number; value: string; onChange: (v: string) => void; onCancel: () => void; onSave: () => void;
  saving: boolean; tone?: 'warn'; list?: boolean;
}) {
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { field.current?.focus(); field.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
    else if (e.key === 'Enter' && (rows === 1 || e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
  };
  return (
    <motion.div className="vx-doc-sec editing" layout transition={SPRING.snappy}>
      <label className={`vx-over${tone ? ` ${tone}` : ''}`} htmlFor={id}>{label}{list ? c.onePerLine : ''}</label>
      {rows > 1
        ? <textarea ref={field} id={id} className="vx-textarea" rows={rows + 1} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} maxLength={800} dir="auto" />
        : <input ref={field} id={id} className="vx-input" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} maxLength={120} dir="auto" />}
      <div className="vx-doc-actions">
        <button type="button" className="vx-btn vx-btn-xs vx-btn-ghost" onClick={onCancel}>{c.cancel}</button>
        <button type="button" className="vx-btn vx-btn-xs vx-btn-hue" onClick={onSave} disabled={saving || !value.trim()} aria-busy={saving || undefined}>
          {saving ? <Spinner size={14} /> : c.save}
        </button>
      </div>
    </motion.div>
  );
}
