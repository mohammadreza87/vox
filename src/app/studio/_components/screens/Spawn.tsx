'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, haptic, mediaUrl, openTelegram, type AgentLook, type AgentView, type LibraryVoice, type SpawnBrief } from '../../_lib/client';
import { AgentFace, Cloud, PALETTE } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Icon, Spinner, Steps, TopBar } from '../ui';

const STEPS = ['Brief', 'Persona', 'Look', 'Voice', 'Test', 'Hire'] as const;
const PRESENTATIONS: Array<{ value: NonNullable<SpawnBrief['presentation']>; label: string }> = [
  { value: 'feminine', label: 'Woman' },
  { value: 'masculine', label: 'Man' },
  { value: 'neutral', label: 'Neutral' },
];
const DOMAINS = ['Product', 'Engineering', 'Design', 'Marketing', 'Sales', 'Finance', 'People', 'Research', 'Legal', 'Support'];
const LANGUAGES = ['English', 'Persian', 'Arabic', 'Turkish', 'French', 'German', 'Spanish'];
const FAMILY_LABEL = { puff: 'Puff', tower: 'Tower', drift: 'Drift' } as const;
const FEATURE_LABEL = { cheeks: 'Cheeks', lashes: 'Lashes', brows: 'Brows' } as const;

type Busy = null | string;

export function SpawnScreen({ draftId, successorOf }: { draftId?: string; successorOf?: string }) {
  const nav = useNav();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [step, setStep] = useState(draftId ? -1 : 0);
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    if (!draftId) return;
    api.agent(draftId)
      .then((r) => { setAgent(r.agent); setStep(r.agent.status === 'awaiting_bot' ? 5 : 1); })
      .catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      haptic.error();
      nav.toast(errorMessage(e), 'error');
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  const update = setAgent;

  // Live agents being refined skip voice (fixed at hire) and the hire step.
  // Step 5 with an active agent is the "just hired" screen, not a refine.
  const live = agent?.status === 'active' && step !== 5;
  const steps = live ? STEPS.slice(0, 5) : STEPS;
  const next = () => { haptic.tap(); setStep((s) => (live && s === 2 ? 4 : Math.min(s + 1, steps.length - 1))); };
  const prev = () => {
    if (step <= (draftId ? 1 : 0)) nav.back();
    else setStep((s) => (live && s === 4 ? 2 : s - 1));
  };

  if (step === -1 || (step > 0 && !agent)) return <><TopBar onBack={nav.back} backLabel="Agents" /><LoadingFill /></>;

  return (
    <>
      <TopBar onBack={prev} backLabel={step === 0 ? 'Agents' : 'Back'} title={<Steps total={steps.length} current={step} />}
        right={agent && agent.status === 'draft' ? (
          <button className="vx-icon-btn" aria-label="Discard draft" onClick={async () => {
            if (!confirm(`Discard ${agent.persona.name}?`)) return;
            const ok = await run('discard', () => api.deleteDraft(agent.id));
            if (ok) nav.reset({ name: 'home' });
          }}><Icon name="trash" size={20} /></button>
        ) : undefined} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {step === 0 && (
            <BriefStep busy={busy} successorOf={successorOf} onDraft={async (brief) => {
              const r = await run('draft', () => api.draft(brief, successorOf));
              if (r) { haptic.success(); setAgent(r.agent); setNames(r.names); setStep(1); }
            }} />
          )}
          {step === 1 && agent && <PersonaStep agent={agent} names={names} busy={busy} run={run} onUpdate={update} onNext={next} />}
          {step === 2 && agent && <LookStep agent={agent} busy={busy} run={run} onUpdate={update} onNext={next} />}
          {step === 3 && agent && <VoiceStep agent={agent} busy={busy} run={run} onUpdate={update} onNext={next} />}
          {step === 4 && agent && <TestStep agent={agent} onNext={live ? () => nav.back() : next} live={live} />}
          {step === 5 && agent && <HireStep agent={agent} busy={busy} run={run} onUpdate={update} />}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

type Run = <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
interface StepProps { agent: AgentView; busy: Busy; run: Run; onUpdate: (a: AgentView) => void; onNext: () => void }

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="vx-dock">{children}</div>;
}

/** `group` for chip sets: a <label> around buttons would name (and click) the first chip. */
function Field({ label, children, hint, group }: { label: string; children: React.ReactNode; hint?: string; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag role={group ? 'group' : undefined} aria-label={group ? label : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="vx-over">{label}</span>
      {children}
      {hint && <span className="vx-small vx-3">{hint}</span>}
    </Tag>
  );
}

function Chips<T extends string>({ options, value, onChange, multi }: {
  options: Array<{ value: T; label: string }>; value: T[]; onChange: (v: T[]) => void; multi?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className="vx-chip" aria-pressed={on} onClick={() => {
            haptic.select();
            if (multi) onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
            else onChange(on ? [] : [o.value]);
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function Slider({ left, right, value, onChange }: { left: string; right: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input className="vx-range" type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${left} to ${right}`} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }} className="vx-small vx-2"><span>{left}</span><span>{right}</span></div>
    </div>
  );
}

/* ---------- 1. Brief ---------- */

function BriefStep({ busy, successorOf, onDraft }: { busy: Busy; successorOf?: string; onDraft: (b: SpawnBrief) => void }) {
  const [description, setDescription] = useState('');
  const [presentation, setPresentation] = useState<SpawnBrief['presentation'][]>([]);
  const [domain, setDomain] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [culture, setCulture] = useState('');
  const [accent, setAccent] = useState('');
  const [age, setAge] = useState('');
  const [traits, setTraits] = useState({ warmDirect: 50, playfulSerious: 50, conciseExpansive: 40 });
  const drafting = busy === 'draft';

  const brief = (): SpawnBrief => ({
    description: description.trim() || undefined,
    presentation: presentation[0] ?? undefined,
    domain: domain[0],
    languages: languages.length ? languages : undefined,
    culture: culture.trim() || undefined,
    accent: accent.trim() || undefined,
    age: age.trim() || undefined,
    traits,
  });

  if (drafting) return <Drafting />;

  return (
    <>
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="vx-over">{successorOf ? 'Hire a successor' : 'Spawn an agent'}</span>
          <h1 className="vx-title">Who should join the team?</h1>
          <p className="vx-2" style={{ margin: 0 }}>Describe them loosely. Claude fills in everything you leave out — or leave it all blank and be surprised.</p>
        </div>
        <Field label="In a sentence">
          <textarea className="vx-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600}
            placeholder="A calm product lead who asks sharp questions and remembers every decision" />
        </Field>
        <Field label="Presents as" group>
          <Chips options={PRESENTATIONS} value={presentation as NonNullable<SpawnBrief['presentation']>[]} onChange={(v) => setPresentation(v)} />
        </Field>
        <Field label="Knowledge domain" group>
          <Chips options={DOMAINS.map((d) => ({ value: d, label: d }))} value={domain} onChange={setDomain} />
        </Field>
        <Field label="Languages" group>
          <Chips multi options={LANGUAGES.map((l) => ({ value: l, label: l }))} value={languages} onChange={setLanguages} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
          <Field label="Nationality / culture"><input className="vx-input" value={culture} onChange={(e) => setCulture(e.target.value)} placeholder="Persian, Tehran" maxLength={80} /></Field>
          <Field label="Age"><input className="vx-input" value={age} onChange={(e) => setAge(e.target.value)} placeholder="Early 30s" maxLength={40} /></Field>
        </div>
        <Field label="Accent" hint="ElevenLabs designs a voice to match; real accents work best.">
          <input className="vx-input" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="Soft Tehrani English" maxLength={80} />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="vx-over">Temperament</span>
          <Slider left="Warm" right="Direct" value={traits.warmDirect} onChange={(v) => setTraits({ ...traits, warmDirect: v })} />
          <Slider left="Playful" right="Serious" value={traits.playfulSerious} onChange={(v) => setTraits({ ...traits, playfulSerious: v })} />
          <Slider left="Concise" right="Expansive" value={traits.conciseExpansive} onChange={(v) => setTraits({ ...traits, conciseExpansive: v })} />
        </div>
      </div>
      <Dock>
        <button className="vx-btn vx-btn-primary vx-btn-block" onClick={() => onDraft(brief())}>
          <Icon name="spark" width={2} />Draft with Claude
        </button>
      </Dock>
    </>
  );
}

function Drafting() {
  const looks: Array<Pick<AgentLook, 'hue' | 'family' | 'features'>> = [
    { hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: true, brows: false } },
    { hue: 'lagoon', family: 'tower', features: { cheeks: false, lashes: false, brows: true } },
    { hue: 'apricot', family: 'drift', features: { cheeks: true, lashes: false, brows: false } },
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % looks.length), 1100);
    return () => clearInterval(t);
  }, [looks.length]);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, textAlign: 'center' }}>
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ scale: 0.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.6, opacity: 0, rotate: 8 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
          <Cloud look={looks[i]} size={150} expr="thinking" stage={1} label="Drafting" />
        </motion.div>
      </AnimatePresence>
      <div className="vx-title-m">Claude is imagining them…</div>
      <p className="vx-2" style={{ margin: 0, maxWidth: 280 }}>Name, backstory, values, voice and a cloud of their own. About ten seconds.</p>
    </div>
  );
}

/* ---------- 2. Persona ---------- */

const PERSONA_FIELDS = [
  { key: 'role', label: 'Role', rows: 1 },
  { key: 'tagline', label: 'Tagline', rows: 1 },
  { key: 'personality', label: 'Personality', rows: 3 },
  { key: 'communicationStyle', label: 'How they talk', rows: 3 },
  { key: 'backstory', label: 'Backstory', rows: 4 },
  { key: 'wontDo', label: "Won't do", rows: 2 },
] as const;

function PersonaStep({ agent, names, busy, run, onUpdate, onNext }: StepProps & { names: string[] }) {
  const p = agent.persona;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');
  const editable = agent.canEdit;

  const save = async (patch: Record<string, unknown>) => {
    const r = await run('save', () => api.updatePersona(agent.id, patch));
    if (r) { onUpdate(r.agent); setEditing(null); haptic.success(); }
  };

  return (
    <>
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
            <AgentFace look={agent.look} size={88} expr="happy" label={p.name} />
          </motion.div>
          <div style={{ minWidth: 0 }}>
            <h1 className="vx-title" style={{ overflowWrap: 'anywhere' }}>{p.name}</h1>
            <div className="vx-2">{p.role}</div>
            <div className="vx-small vx-3" style={{ marginTop: 4 }}>{[p.culture, p.age, p.accent].filter(Boolean).join(' · ')}</div>
          </div>
        </div>

        {editable && names.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="vx-over">Other names Claude liked</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {names.map((n) => (
                <button key={n} className="vx-chip" aria-pressed={n === p.name} onClick={() => n !== p.name && save({ name: n })}>{n}</button>
              ))}
            </div>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 17, lineHeight: '24px' }}>“{p.tagline}”</p>

        <div className="vx-group">
          {editable && (
            <EditableRow label="Name" value={p.name} rows={1} editing={editing === 'name'} draft={draft}
              onEdit={() => { setEditing('name'); setDraft(p.name); }} onDraft={setDraft} onCancel={() => setEditing(null)}
              onSave={() => save({ name: draft })} saving={busy === 'save'} />
          )}
          {PERSONA_FIELDS.map((f) => (
            <EditableRow key={f.key} label={f.label} value={p[f.key]} rows={f.rows} editing={editing === f.key} draft={draft} readOnly={!editable}
              onEdit={() => { setEditing(f.key); setDraft(p[f.key]); }} onDraft={setDraft} onCancel={() => setEditing(null)}
              onSave={() => save({ [f.key]: draft })} saving={busy === 'save'} />
          ))}
          <ListRow label="Values" items={p.values} />
          <ListRow label="Expertise" items={p.expertise} />
          <ListRow label="Languages" items={p.languages} />
        </div>

        {editable && (
          <div className="vx-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="vx-over" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="spark" size={14} width={2} />Ask Claude to change</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="vx-input" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={400}
                placeholder="Make her funnier, and fluent in Turkish" onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget.nextSibling as HTMLButtonElement)?.click(); }} />
              <button className="vx-icon-btn solid" aria-label="Send to Claude" disabled={!instruction.trim() || busy === 'refine'} onClick={async () => {
                const r = await run('refine', () => api.refine(agent.id, instruction));
                if (r) { onUpdate(r.agent); setInstruction(''); haptic.success(); }
              }}>{busy === 'refine' ? <Spinner /> : <Icon name="send" width={2} />}</button>
            </div>
          </div>
        )}
      </div>
      <Dock>
        <button className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext} disabled={!!busy}>Looks good — next</button>
      </Dock>
    </>
  );
}

function EditableRow({ label, value, rows, editing, draft, readOnly, onEdit, onDraft, onCancel, onSave, saving }: {
  label: string; value: string; rows: number; editing: boolean; draft: string; readOnly?: boolean;
  onEdit: () => void; onDraft: (v: string) => void; onCancel: () => void; onSave: () => void; saving: boolean;
}) {
  if (editing) {
    return (
      <div className="vx-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <span className="vx-over">{label}</span>
        {rows > 1
          ? <textarea className="vx-textarea" rows={rows + 1} value={draft} onChange={(e) => onDraft(e.target.value)} autoFocus maxLength={800} />
          : <input className="vx-input" value={draft} onChange={(e) => onDraft(e.target.value)} autoFocus maxLength={120} />}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={onCancel}>Cancel</button>
          <button className="vx-btn vx-btn-primary vx-btn-sm" onClick={onSave} disabled={saving || !draft.trim()}>{saving ? <Spinner /> : 'Save'}</button>
        </div>
      </div>
    );
  }
  return (
    <button className="vx-row" onClick={readOnly ? undefined : onEdit} disabled={readOnly}
      style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,.08)', textAlign: 'left', cursor: readOnly ? 'default' : 'pointer', alignItems: 'flex-start', color: 'inherit' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="vx-over">{label}</span>
        <span style={{ fontSize: 15, lineHeight: '21px' }}>{value || <span className="vx-3">—</span>}</span>
      </div>
      {!readOnly && <span className="vx-small vx-3" style={{ paddingTop: 2 }}>Edit</span>}
    </button>
  );
}

function ListRow({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="vx-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      <span className="vx-over">{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((i) => <span key={i} className="vx-chip" style={{ cursor: 'default', height: 28 }}>{i}</span>)}
      </div>
    </div>
  );
}

/* ---------- 3. Look ---------- */

function LookStep({ agent, busy, run, onUpdate, onNext }: StepProps) {
  const nav = useNav();
  const look = agent.look;
  const fileRef = useRef<HTMLInputElement>(null);
  const [spin, setSpin] = useState(0);
  const avatarsOn = nav.me.features.avatars;

  const setLook = async (patch: Partial<AgentLook> | 'random') => {
    haptic.select();
    const r = await run('look', () => api.setLook(agent.id, patch));
    if (r) onUpdate(r.agent);
  };

  return (
    <>
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="vx-over">Their look</span>
          <h1 className="vx-title">Shape {agent.persona.name}’s cloud</h1>
        </div>

        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <div style={{ position: 'absolute', top: '50%', left: '50%', width: 200, height: 200, margin: '-100px 0 0 -100px', borderRadius: '50%', background: PALETTE[look.hue].glow, opacity: 0.18, filter: 'blur(30px)' }} />
          <motion.div key={`${look.hue}-${look.family}-${spin}`} initial={{ scale: 0.7, rotate: spin ? -14 : 0 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 16 }}>
            <Cloud look={look} size={180} expr="happy" label={agent.persona.name} />
          </motion.div>
          <motion.button className="vx-icon-btn solid" aria-label="Random look" whileTap={{ rotate: 90, scale: 0.9 }}
            disabled={busy === 'look'} onClick={() => { setSpin((s) => s + 1); void setLook('random'); }}
            style={{ position: 'absolute', right: 0, bottom: 8 }}>
            {busy === 'look' ? <Spinner /> : <Icon name="dice" />}
          </motion.button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">Colour</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 8 }}>
            {Object.entries(PALETTE).map(([hue, pal]) => (
              <button key={hue} aria-label={pal.name} aria-pressed={hue === look.hue} onClick={() => setLook({ hue: hue as AgentLook['hue'] })}
                style={{ aspectRatio: '1', borderRadius: '50%', border: 'none', cursor: 'pointer', background: `radial-gradient(circle at 35% 30%, ${pal.light}, ${pal.base} 60%, ${pal.shadow})`,
                  boxShadow: hue === look.hue ? `0 0 0 2px #0E1013, 0 0 0 4px ${pal.base}` : 'none', transition: 'box-shadow .2s' }} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">Shape</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {(['puff', 'tower', 'drift'] as const).map((family) => (
              <button key={family} className="vx-card" aria-pressed={family === look.family} onClick={() => setLook({ family })}
                style={{ padding: '10px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'inherit',
                  borderColor: family === look.family ? '#D6FF5C' : undefined }}>
                <Cloud look={{ ...look, family }} size={64} label={FAMILY_LABEL[family]} />
                <span className="vx-small">{FAMILY_LABEL[family]}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">Features</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {(Object.keys(FEATURE_LABEL) as Array<keyof typeof FEATURE_LABEL>).map((k) => (
              <button key={k} className="vx-chip" aria-pressed={look.features[k]} onClick={() => setLook({ features: { ...look.features, [k]: !look.features[k] } })}>{FEATURE_LABEL[k]}</button>
            ))}
          </div>
        </div>

        <div className="vx-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="vx-head">Profile picture</div>
              <div className="vx-small vx-2">Used as the Telegram bot photo. The cloud still animates in calls.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: 6, margin: -6 }}>{/* room for the selection ring */}
            <AvatarOption selected={!look.avatar} label="Cloud" onClick={() => look.avatar && run('avatar', () => api.chooseAvatar(agent.id, null)).then((r) => r && onUpdate(r.agent))}>
              <Cloud look={look} size={64} label="Cloud" />
            </AvatarOption>
            {(look.avatarVariants ?? []).map((f) => (
              <AvatarOption key={f} selected={look.avatar === f} label={f.startsWith('up-') ? 'Your upload' : 'Generated'}
                onClick={() => run('avatar', () => api.chooseAvatar(agent.id, f)).then((r) => r && onUpdate(r.agent))}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(f)} alt="" width={72} height={72} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '50%' }} />
              </AvatarOption>
            ))}
            {busy === 'avatars' && [0, 1].map((i) => <div key={i} className="vx-skeleton" style={{ width: 72, height: 72, borderRadius: '50%', flexShrink: 0 }} />)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {avatarsOn && (
              <button className="vx-btn vx-btn-secondary vx-btn-sm" style={{ flex: 1 }} disabled={!!busy}
                onClick={async () => { const r = await run('avatars', () => api.generateAvatars(agent.id, 2)); if (r) { onUpdate(r.agent); haptic.success(); } }}>
                {busy === 'avatars' ? <Spinner /> : <Icon name="image" size={18} />}Generate
              </button>
            )}
            <button className="vx-btn vx-btn-secondary vx-btn-sm" style={{ flex: 1 }} disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === 'upload' ? <Spinner /> : <Icon name="upload" size={18} />}Upload
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const r = await run('upload', () => api.uploadAvatar(agent.id, file));
              if (r) { onUpdate(r.agent); haptic.success(); }
            }} />
          </div>
          {!avatarsOn && <span className="vx-small vx-3">Image generation is off on this server (no OpenAI key). Uploads still work.</span>}
        </div>
      </div>
      <Dock>
        <button className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext} disabled={!!busy}>Next</button>
      </Dock>
    </>
  );
}

function AvatarOption({ selected, label, onClick, children }: { selected: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={selected} aria-label={label}
      style={{ position: 'relative', flexShrink: 0, width: 80, height: 80, borderRadius: '50%', border: 'none', background: '#1E2228', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: selected ? '0 0 0 2px #0E1013, 0 0 0 4px #D6FF5C' : 'none', transition: 'box-shadow .2s' }}>
      {children}
      {selected && (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: '50%', background: '#D6FF5C', color: '#0E1013', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={14} width={3} />
        </motion.span>
      )}
    </button>
  );
}

/* ---------- 4. Voice ---------- */

function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const play = (key: string, src: string) => {
    audio.current?.pause();
    if (playing === key) { setPlaying(null); return; }
    const a = new Audio(src);
    audio.current = a;
    a.onended = () => setPlaying(null);
    a.play().then(() => setPlaying(key)).catch(() => setPlaying(null));
  };
  return { playing, play };
}

function VoiceStep({ agent, busy, run, onUpdate, onNext }: StepProps) {
  const nav = useNav();
  const [tab, setTab] = useState<'design' | 'library'>('design');
  const [brief, setBrief] = useState(agent.persona.voiceBrief);
  const [query, setQuery] = useState({ gender: agent.persona.presentation === 'feminine' ? 'female' : agent.persona.presentation === 'masculine' ? 'male' : '', accent: '', language: '', search: '' });
  const [results, setResults] = useState<LibraryVoice[] | null>(null);
  const player = usePlayer();
  const voicesOn = nav.me.features.voices;

  const search = async () => {
    const r = await run('search', () => api.searchVoices(query));
    if (r) setResults(r.voices);
  };

  const sample = async () => {
    const blob = await run('speak', () => api.speak(agent.id, `Hi, I'm ${agent.persona.name}. ${agent.persona.tagline}`));
    if (blob) player.play('sample', URL.createObjectURL(blob));
  };

  if (!voicesOn) {
    return (
      <>
        <div className="vx-scroll"><div className="vx-banner warn"><Icon name="warn" size={18} />Voices are off on this server (no ElevenLabs key). {agent.persona.name} will reply in text only.</div></div>
        <Dock><button className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext}>Next</button></Dock>
      </>
    );
  }

  return (
    <>
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="vx-over">Their voice</span>
          <h1 className="vx-title">How does {agent.persona.name} sound?</h1>
          <p className="vx-2" style={{ margin: 0 }}>Same voice for everyone in {nav.me.org}. Fixed once hired.</p>
        </div>

        {agent.voice && (
          <div className="vx-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="vx-pill live"><Icon name="check" size={11} width={3} />CHOSEN</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.voice.label}</span>
            <button className="vx-icon-btn solid" aria-label="Hear a sample" onClick={sample} disabled={busy === 'speak'}>
              {busy === 'speak' ? <Spinner /> : <Icon name={player.playing === 'sample' ? 'pause' : 'play'} size={18} />}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="vx-chip" aria-pressed={tab === 'design'} onClick={() => setTab('design')}>Design new</button>
          <button className="vx-chip" aria-pressed={tab === 'library'} onClick={() => { setTab('library'); if (!results) void search(); }}>Voice library</button>
        </div>

        {tab === 'design' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Describe the voice" hint="Accent, age, pace, warmth. ElevenLabs creates three options.">
              <textarea className="vx-textarea" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={1000} />
            </Field>
            <button className="vx-btn vx-btn-secondary" disabled={!!busy || brief.trim().length < 20}
              onClick={async () => { const r = await run('design', () => api.designVoices(agent.id, brief)); if (r) onUpdate(r.agent); }}>
              {busy === 'design' ? <><Spinner />Designing…</> : <><Icon name="spark" size={18} />Design voices</>}
            </button>
            {(agent.voicePreviews ?? []).map((v, i) => (
              <motion.div key={v.generatedVoiceId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="vx-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="vx-icon-btn solid" aria-label={`Play option ${i + 1}`} onClick={() => player.play(v.file, mediaUrl(v.file))}>
                  <Icon name={player.playing === v.file ? 'pause' : 'play'} size={18} />
                </button>
                <Bars active={player.playing === v.file} />
                <span style={{ flex: 1 }}>Option {i + 1}</span>
                <button className="vx-btn vx-btn-primary vx-btn-sm" disabled={!!busy}
                  onClick={async () => { const r = await run('choose', () => api.chooseDesignedVoice(agent.id, v.generatedVoiceId)); if (r) { onUpdate(r.agent); haptic.success(); } }}>
                  {busy === 'choose' ? <Spinner /> : 'Use'}
                </button>
              </motion.div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
              <select className="vx-input" value={query.gender} onChange={(e) => setQuery({ ...query, gender: e.target.value })} aria-label="Gender">
                <option value="">Any</option><option value="female">Female</option><option value="male">Male</option><option value="neutral">Neutral</option>
              </select>
              <input className="vx-input" value={query.accent} onChange={(e) => setQuery({ ...query, accent: e.target.value })} placeholder="Accent" />
              <input className="vx-input" value={query.language} onChange={(e) => setQuery({ ...query, language: e.target.value })} placeholder="Lang (fa)" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="vx-input" value={query.search} onChange={(e) => setQuery({ ...query, search: e.target.value })} placeholder="calm, narrator, young…"
                onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} />
              <button className="vx-icon-btn solid" aria-label="Search voices" onClick={search} disabled={busy === 'search'}>{busy === 'search' ? <Spinner /> : <Icon name="send" />}</button>
            </div>
            {results?.length === 0 && <span className="vx-small vx-2">No voices match. Loosen a filter.</span>}
            {results?.map((v) => (
              <div key={`${v.publicOwnerId}-${v.voiceId}`} className="vx-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="vx-icon-btn solid" aria-label={`Play ${v.name}`} disabled={!v.previewUrl} onClick={() => v.previewUrl && player.play(v.voiceId, v.previewUrl)}>
                  <Icon name={player.playing === v.voiceId ? 'pause' : 'play'} size={18} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                  <div className="vx-small vx-2" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[v.gender, v.age, v.accent, v.descriptive].filter(Boolean).join(' · ')}</div>
                </div>
                <button className="vx-btn vx-btn-primary vx-btn-sm" disabled={!!busy}
                  onClick={async () => { const r = await run('choose', () => api.chooseLibraryVoice(agent.id, v)); if (r) { onUpdate(r.agent); haptic.success(); } }}>Use</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dock>
        <button className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext} disabled={!!busy}>{agent.voice ? 'Next' : 'Skip — text only'}</button>
      </Dock>
    </>
  );
}

function Bars({ active }: { active: boolean }) {
  return (
    <svg width="40" height="20" viewBox="0 0 40 20" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={i * 6} y={2} width={3} height={16} rx={1.5} fill={active ? '#D6FF5C' : '#7D828C'}
          className={active ? 'vx-bar' : undefined} style={{ animationDelay: `${i * 0.11}s`, transformBox: 'fill-box', transform: active ? undefined : 'scaleY(.35)' }} />
      ))}
    </svg>
  );
}

/* ---------- 5. Test ---------- */

function TestStep({ agent, onNext, live }: { agent: AgentView; onNext: () => void; live: boolean }) {
  const nav = useNav();
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, thinking]);

  const send = async () => {
    const content = text.trim();
    if (!content || thinking) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setText('');
    setThinking(true);
    try {
      const r = await api.test(agent.id, next);
      setMessages([...next, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      nav.toast(errorMessage(e), 'error');
    } finally {
      setThinking(false);
    }
  };

  return (
    <>
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <AgentFace look={agent.look} size={56} expr={thinking ? 'thinking' : 'idle'} preferCloud label={agent.persona.name} />
          <div>
            <h1 className="vx-title-m">Say hi to {agent.persona.name}</h1>
            <div className="vx-small vx-2">Sandbox: nothing here becomes a memory.</div>
          </div>
        </div>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['Introduce yourself', 'What would you never do?', 'How do you handle disagreement?'].map((s) => (
              <button key={s} className="vx-chip" onClick={() => setText(s)}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '84%', padding: '10px 14px', borderRadius: 20,
              background: m.role === 'user' ? '#D6FF5C' : '#1E2228', color: m.role === 'user' ? '#0E1013' : 'inherit', whiteSpace: 'pre-wrap', lineHeight: '21px', fontSize: 15 }}>
            {m.content}
          </motion.div>
        ))}
        {thinking && <div className="vx-small vx-2" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Spinner size={14} />{agent.persona.name} is typing…</div>}
        <div ref={end} />
      </div>
      <div className="vx-dock" style={{ flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="vx-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" maxLength={2000}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} style={{ borderRadius: 999 }} />
          <button className="vx-icon-btn solid" aria-label="Send" onClick={send} disabled={!text.trim() || thinking}><Icon name="send" width={2} /></button>
        </div>
        <button className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext}>{live ? 'Done' : 'Ready to hire'}</button>
      </div>
    </>
  );
}

/* ---------- 6. Hire ---------- */

function HireStep({ agent, busy, run, onUpdate }: Omit<StepProps, 'onNext'>) {
  const nav = useNav();
  const [link, setLink] = useState<string | null>(null);
  const awaiting = agent.status === 'awaiting_bot';

  // While waiting for the human to confirm the bot in Telegram, poll for it.
  useEffect(() => {
    if (!awaiting) return;
    const t = setInterval(async () => {
      try {
        const r = await api.agent(agent.id);
        if (r.agent.status === 'active') {
          haptic.success();
          onUpdate(r.agent);
        }
      } catch { /* keep waiting */ }
    }, 3000);
    return () => clearInterval(t);
  }, [awaiting, agent.id, onUpdate]);

  const publish = async () => {
    const r = await run('publish', () => api.publish(agent.id));
    if (r) { setLink(r.link); onUpdate(r.agent); openTelegram(r.link); }
  };

  if (agent.status === 'active') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 12 }}>
          <AgentFace look={agent.look} size={160} expr="happy" stage={1} label={agent.persona.name} preferCloud />
        </motion.div>
        <h1 className="vx-title">{agent.persona.name} is hired</h1>
        <p className="vx-2" style={{ margin: 0, maxWidth: 300 }}>Live as @{agent.bot?.username}. For the next 7 days their personality can still be tuned; after that it’s locked for good.</p>
        <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 340 }}>
          <button className="vx-btn vx-btn-secondary" style={{ flex: 1 }} onClick={() => agent.bot && openTelegram(`https://t.me/${agent.bot.username}`)}>Message</button>
          <button className="vx-btn vx-btn-primary" style={{ flex: 1 }} onClick={() => nav.reset({ name: 'home' }, { name: 'agent', id: agent.id })}>Open</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ marginTop: 12 }}><AgentFace look={agent.look} size={140} expr={awaiting ? 'listening' : 'idle'} label={agent.persona.name} /></div>
        <h1 className="vx-title">{awaiting ? 'Confirm in Telegram' : `Hire ${agent.persona.name}`}</h1>
        <p className="vx-2" style={{ margin: 0, maxWidth: 320 }}>
          {awaiting
            ? 'Telegram opened a “Create bot” screen. Tap Create — this page updates on its own when it’s done.'
            : `${agent.persona.name} becomes a real Telegram bot that everyone in ${nav.me.org} can message, call and add to groups.`}
        </p>
        <div className="vx-group" style={{ width: '100%', textAlign: 'left' }}>
          <div className="vx-row"><Icon name="cloud" size={20} /><span style={{ flex: 1 }}>Look & avatar</span><span className="vx-small vx-2">{agent.look.avatar ? 'Picture' : 'Cloud'}</span></div>
          <div className="vx-row"><Icon name="mic" size={20} /><span style={{ flex: 1 }}>Voice</span><span className="vx-small vx-2">{agent.voice?.label ?? 'Text only'}</span></div>
          <div className="vx-row"><Icon name="lock" size={20} /><span style={{ flex: 1 }}>Personality locks</span><span className="vx-small vx-2">7 days after hire</span></div>
        </div>
        {awaiting && <div className="vx-small vx-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Spinner size={14} />Waiting for Telegram…</div>}
      </div>
      <Dock>
        {awaiting ? (
          <button className="vx-btn vx-btn-secondary vx-btn-block" onClick={() => (link ? openTelegram(link) : publish())} disabled={!!busy}>Open Telegram again</button>
        ) : (
          <button className="vx-btn vx-btn-primary vx-btn-block" onClick={publish} disabled={!!busy}>
            {busy === 'publish' ? <Spinner /> : <Icon name="check" width={2} />}Hire {agent.persona.name}
          </button>
        )}
      </Dock>
    </>
  );
}
