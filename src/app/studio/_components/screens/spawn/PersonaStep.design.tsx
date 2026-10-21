'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, haptic, type PersonaSpec } from '../../../_lib/client';
import { DUR, EASE, SPRING } from '../../../_lib/motion';
import { spawnCopy, type SpawnCopy } from '../../../_lib/spawn-copy';
import { AgentFace } from '../../Cloud';
import { useNav } from '../../StudioApp';
import { Composer, Icon, Spinner } from '../../ui';
import { Dock, type StepProps } from './shared';

type TextKey = 'role' | 'tagline' | 'backstory' | 'personality' | 'communicationStyle' | 'wontDo';
type EditKey = 'name' | TextKey | 'values';

/** The doc card's sections, in reading order (board spawn-2; interaction §3.4.3); labels come from spawnCopy. */
const SECTIONS: ReadonlyArray<{ key: TextKey | 'values'; rows: number; tone?: 'warn' }> = [
  { key: 'role', rows: 1 },
  { key: 'tagline', rows: 1 },
  { key: 'backstory', rows: 4 },
  { key: 'personality', rows: 3 },
  { key: 'communicationStyle', rows: 3 },
  { key: 'values', rows: 3 },
  { key: 'wontDo', rows: 2, tone: 'warn' },
];
const EDITABLE: readonly EditKey[] = ['name', ...SECTIONS.map((s) => s.key)];

/** Values are a list; they edit as one per line and read as a dotted line. */
const show = (p: PersonaSpec, k: EditKey) => (k === 'values' ? p.values.join(' · ') : p[k]);
const toDraft = (p: PersonaSpec, k: EditKey) => (k === 'values' ? p.values.join('\n') : p[k]);
const fromDraft = (k: EditKey, v: string): Partial<PersonaSpec> =>
  (k === 'values' ? { values: v.split('\n').map((x) => x.trim()).filter(Boolean) } : { [k]: v });

interface Refined { keys: Set<EditKey>; before: Partial<PersonaSpec>; seq: number }

/**
 * Draft (board spawn-2): pick a name, read the persona as one document, tap any section to edit it in
 * place, or ask Claude in the composer. Lines Claude rewrote get the volt sweep, with Undo.
 */
export function PersonaStep({ agent, names, busy, run, onUpdate, onNext, live, onSayHi }: StepProps & {
  names: string[]; live?: boolean; onSayHi?: () => void;
}) {
  const c = spawnCopy[useNav().locale ?? 'en'].persona;
  const p = agent.persona;
  const [editing, setEditing] = useState<EditKey | null>(null);
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');
  const [refined, setRefined] = useState<Refined | null>(null);
  const seq = useRef(0);
  const editable = agent.canEdit;

  const save = async (patch: Partial<PersonaSpec>) => {
    const r = await run('save', () => api.updatePersona(agent.id, patch));
    if (r) { onUpdate(r.agent); setEditing(null); haptic.success(); }
    return !!r;
  };
  const edit = (k: EditKey) => { if (!editable || busy) return; haptic.select(); setEditing(k); setDraft(toDraft(p, k)); };
  const commit = () => { if (editing && draft.trim()) void save(fromDraft(editing, draft)); };

  const refine = async () => {
    const text = instruction.trim();
    if (!text) return;
    const before = p;
    const r = await run('refine', () => api.refine(agent.id, text));
    if (!r) return;
    const after = r.agent.persona;
    const keys = new Set(EDITABLE.filter((k) => String(show(before, k)) !== String(show(after, k))));
    onUpdate(r.agent);
    setInstruction('');
    setEditing(null);
    haptic.success();
    const prev: Partial<PersonaSpec> = {};
    for (const k of keys) Object.assign(prev, k === 'values' ? { values: before.values } : { [k]: before[k] });
    setRefined(keys.size ? { keys, before: prev, seq: ++seq.current } : null);
  };

  const undo = async () => {
    if (!refined) return;
    const r = await run('undo', () => api.updatePersona(agent.id, refined.before));
    if (r) { onUpdate(r.agent); setRefined(null); haptic.select(); }
  };

  const next = async () => {
    if (busy || (editing !== null && !draft.trim())) return;
    if (editing !== null && !(await save(fromDraft(editing, draft)))) return;
    onNext();
  };

  const changed = (k: EditKey) => refined?.keys.has(k) ?? false;
  const n = refined?.keys.size ?? 0;
  const cta = editing !== null ? c.saveNext : live ? c.nextLook : c.useName(p.name);

  return (
    <>
      <div className="vx-scroll vx-form tall-dock">
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
                  <span className="vx-small vx-2">{[p.culture, p.age, p.accent].filter(Boolean).join(' · ') || p.role}</span>
                </div>
                {editable && <button type="button" className="vx-icon-btn vx-doc-edit" aria-label={c.editName} disabled={!!busy} onClick={() => edit('name')}><Icon name="edit" size={18} /></button>}
              </>
            )}
          </div>
          {SECTIONS.map((s) => editing === s.key ? (
            <Editor key={s.key} c={c} label={c.sections[s.key]} rows={s.rows} value={draft} onChange={setDraft} tone={s.tone}
              onCancel={() => setEditing(null)} onSave={commit} saving={busy === 'save'} list={s.key === 'values'} />
          ) : (
            <button key={s.key} type="button" className="vx-doc-sec tap" disabled={!editable || !!busy} onClick={() => edit(s.key)}>
              <span className={`vx-over${s.tone ? ` ${s.tone}` : ''}`}>{c.sections[s.key]}</span>
              <span className={`vx-doc-text${s.tone ? ' vx-2' : ''}`} dir="auto">
                {changed(s.key) ? <span key={refined!.seq} className="vx-changed">{show(p, s.key)}</span> : show(p, s.key) || <span className="vx-3">—</span>}
              </span>
            </button>
          ))}
        </article>

        <div className="vx-hint" aria-live="polite">
          <Icon name="spark" size={16} width={2} className="vx-hint-spark" />
          {n > 0 ? (
            <span>{c.updated(n)}
              <button type="button" className="vx-link-btn" onClick={() => void undo()} disabled={!!busy}>{busy === 'undo' ? <Spinner size={12} /> : c.undo}</button>
            </span>
          ) : <span>{editable ? c.tapToEdit : c.readOnly(p.name)}</span>}
          {onSayHi && <button type="button" className="vx-chip vx-hint-end" onClick={onSayHi}><Icon name="chat" size={14} />{c.tryChat}</button>}
        </div>
      </div>
      <Dock stack>
        {editable && (
          <Composer value={instruction} onChange={setInstruction} onSend={() => void refine()} busy={busy === 'refine'} disabled={!!busy && busy !== 'refine'}
            placeholder={c.askPlaceholder(p.name)} label={c.askLabel} sendLabel={c.sendToClaude} maxLength={400} />
        )}
        <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={() => void next()} disabled={!!busy || (editing !== null && !draft.trim())}>
          {busy === 'save' ? <Spinner /> : cta}
        </button>
      </Dock>
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
