'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_AGENT_SKILLS } from '@/lib/studio/skills/types';
import { api, haptic, type PersonaSpec } from '../../../_lib/client';
import { AgentFace } from '../../Cloud';
import { errorMessage, useNav } from '../../StudioApp';
import { Spinner } from '../../ui';
import { useCatalog } from './catalog';
import { spawnCopy } from './copy';
import { useKeyboard } from './hooks';
import { useSpawnMotion } from './motion';
import { textAttrs } from './routing';
import { Dock, EditableRow, ListRow, type StepProps } from './parts';
import { RefineComposer, RoleLine, VoiceExamples } from './PersonaParts';
import { mergeSelection, onIds, type SkillToggle } from './roles';
import { SkillChips } from './SkillChips';
import { SkillsSheet } from './SkillsSheet';

type TextField = 'role' | 'tagline' | 'personality' | 'communicationStyle' | 'backstory' | 'wontDo';
const PERSONA_FIELDS: Array<{ key: TextField; rows: number }> = [
  { key: 'role', rows: 1 },
  { key: 'tagline', rows: 1 },
  { key: 'personality', rows: 3 },
  { key: 'communicationStyle', rows: 3 },
  { key: 'backstory', rows: 4 },
  { key: 'wontDo', rows: 2 },
];
const DIFFED = ['name', 'role', 'tagline', 'personality', 'communicationStyle', 'backstory', 'wontDo', 'values', 'expertise', 'languages', 'skillIds', 'voiceExamples'] as const;
const SKILL_SAVE_MS = 600;
const CHANGED_MS = 2000;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const changedFields = (before: PersonaSpec, after: PersonaSpec) => new Set<string>(DIFFED.filter((k) => !same(before[k], after[k])));

/**
 * Step 2. Show, then tell: who they are (role, skills, how they sound) before
 * the long-form profile. Refine-by-instruction is pinned above the CTA.
 */
export function PersonaStep({ agent, names, busy, run, onUpdate, onNext }: StepProps & { names: string[] }) {
  const nav = useNav();
  const catalog = useCatalog();
  const t = spawnCopy.en;
  const m = useSpawnMotion();
  const p = agent.persona;
  const editable = agent.canEdit;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [refineFocused, setRefineFocused] = useState(false);
  const [changed, setChanged] = useState<{ fields: Set<string>; n: number } | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const advancingRef = useRef(false);
  const kb = useKeyboard(refineFocused);

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
    const run = (async () => {
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
    inFlight.current = run;
    return run;
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

  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => setChanged(null), CHANGED_MS);
    return () => clearTimeout(timer);
  }, [changed]);

  const save = async (patch: Record<string, unknown>) => {
    const r = await run('save', () => api.updatePersona(agent.id, patch));
    if (r) { onUpdate(r.agent); setEditing(null); haptic.success(); }
    return !!r;
  };

  const refine = async (instruction: string) => {
    if (skillsPending() && !(await flushSkills())) return false;
    // Diff against what the creator sees (a just-flushed skill save is not Claude's change).
    const before = { ...agent.persona, skillIds: agent.persona.skillIds === undefined && !items.length ? undefined : onIds(items) };
    const r = await run('refine', () => api.refine(agent.id, instruction));
    if (!r) return false;
    onUpdate(r.agent);
    const fields = changedFields(before, r.agent.persona);
    setChanged({ fields, n: fields.size });
    haptic.success();
    return true;
  };

  const next = async () => {
    if (busy || advancingRef.current || (editing !== null && !draft.trim())) return;
    if (!skillsPending()) {
      if (editing !== null && !(await save({ [editing]: draft }))) return;
      onNext();
      return;
    }
    // Re-entry guard: a second tap while skills save must not advance twice (and skip Look).
    advancingRef.current = true;
    setAdvancing(true);
    try {
      if (!(await flushSkills())) return;
      if (editing !== null && !(await save({ [editing]: draft }))) return;
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
  const isChanged = (k: string) => !!changed?.fields.has(k);

  return (
    <>
      <div className="vx-scroll vx-scroll-stack" inert={skillsOpen} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={m.reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 300, damping: 18 }}>
            <AgentFace look={agent.look} size={88} expr="happy" label={p.name} />
          </motion.div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 className="vx-title" {...textAttrs(p.name)} style={{ overflowWrap: 'anywhere' }}>{p.name}</h1>
            <RoleLine t={t} persona={p} hue={agent.look.hue} />
            {[p.culture, p.age, p.accent].some(Boolean) && <div className="vx-small vx-3" dir="auto">{[p.culture, p.age, p.accent].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>

        {editable && names.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="vx-over">{t.otherNames}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {names.map((n) => (
                <button key={n} type="button" className="vx-chip vx-name-chip vx-hit" {...textAttrs(n)} aria-pressed={n === p.name} onClick={() => { if (n !== p.name) { haptic.select(); void save({ name: n }); } }}>{n}</button>
              ))}
            </div>
          </div>
        )}

        {p.tagline && <p {...textAttrs(p.tagline)} style={{ margin: 0, fontSize: 17, lineHeight: '24px' }}>“<span className={isChanged('tagline') ? 'vx-changed' : undefined}>{p.tagline}</span>”</p>}

        {showSkills && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="vx-over">{t.skillsCount(onIds(items).length)}</span>
            <SkillChips t={t} items={items} onToggle={toggleSkill} readOnly={!editable} extra={extra}
              onAdd={editable ? () => setSkillsOpen(true) : undefined} />
          </section>
        )}

        <VoiceExamples t={t} agent={agent} />

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">{t.profile}</span>
          <div className="vx-group">
            {editable && (
              <EditableRow label={t.fields.name} value={p.name} rows={1} editing={editing === 'name'} draft={draft} changed={isChanged('name')}
                onEdit={() => { setEditing('name'); setDraft(p.name); }} onDraft={setDraft} onCancel={() => setEditing(null)}
                onSave={() => save({ name: draft })} saving={busy === 'save'} />
            )}
            {PERSONA_FIELDS.map((f) => (
              <EditableRow key={f.key} label={t.fields[f.key]} value={p[f.key]} rows={f.rows} editing={editing === f.key} draft={draft} readOnly={!editable}
                changed={isChanged(f.key)} tone={f.key === 'wontDo' ? 'warn' : undefined}
                onEdit={() => { setEditing(f.key); setDraft(p[f.key]); }} onDraft={setDraft} onCancel={() => setEditing(null)}
                onSave={() => save({ [f.key]: draft })} saving={busy === 'save'} />
            ))}
            <ListRow label={t.fields.values} items={p.values} changed={isChanged('values')} />
            {!hasSkills && <ListRow label={t.fields.expertise} items={p.expertise} changed={isChanged('expertise')} />}
            <ListRow label={t.fields.languages} items={p.languages} changed={isChanged('languages')} />
          </div>
        </section>
      </div>
      <Dock className="vx-dock-stack" inert={skillsOpen} style={kb.up && kb.inset ? { transform: `translateY(-${kb.inset}px)` } : undefined}>
        <div className="vx-sr" role="status" aria-live="polite">{changed ? (changed.n ? t.updated(changed.n) : t.unchanged) : ''}</div>
        <AnimatePresence initial={false}>
          {changed && (
            <motion.span key="hint" className="vx-small vx-2 vx-refine-hint" aria-hidden="true" initial={m.label.initial} animate={m.label.animate} exit={m.label.exit}>
              {changed.n ? t.updated(changed.n) : t.unchanged}
            </motion.span>
          )}
        </AnimatePresence>
        {editable && <RefineComposer t={t} name={p.name} busy={busy === 'refine'} onSubmit={refine} onFocusChange={setRefineFocused} />}
        {!refineFocused && (
          <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={next} disabled={!!busy || advancing || (editing !== null && !draft.trim())}
            aria-busy={busy === 'save' || advancing || undefined}
            aria-label={busy === 'save' || advancing ? (editing !== null ? t.saveNext : t.personaCta(p.name)) : undefined}>
            {busy === 'save' || advancing ? <Spinner /> : editing !== null ? t.saveNext : t.personaCta(p.name)}
          </button>
        )}
      </Dock>
      <SkillsSheet t={t} open={skillsOpen} onClose={() => setSkillsOpen(false)} roleId={p.roleId}
        selected={onIds(items)} onChange={(ids) => setSkills(mergeSelection(items, ids))} />
    </>
  );
}
