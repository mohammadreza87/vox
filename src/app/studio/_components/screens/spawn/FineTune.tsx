'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useId } from 'react';
import { Icon } from '../../ui';
import type { SpawnCopy, TraitKey } from './copy';
import { useSpawnMotion } from './motion';
import { Chips, Field, Slider, type Presentation } from './parts';

export const LANGUAGES = ['English', 'Persian', 'Vietnamese', 'Arabic', 'Turkish', 'French', 'German', 'Spanish'];
const TRAIT_DEFAULTS: Record<TraitKey, number> = { warmDirect: 50, playfulSerious: 50, conciseExpansive: 40 };
const TRAITS: TraitKey[] = ['warmDirect', 'playfulSerious', 'conciseExpansive'];

export interface FineTuneValue {
  presentation?: Presentation;
  /** null until the creator touches the chips; until then the brief's own language is pre-marked. */
  languages: string[] | null;
  culture: string;
  age: string;
  accent: string;
  /** Only sliders the creator moved. */
  traits: Partial<Record<TraitKey, number>>;
}

export const EMPTY_FINE_TUNE: FineTuneValue = { languages: null, culture: '', age: '', accent: '', traits: {} };

export const effectiveLanguages = (v: FineTuneValue, auto: string[]) => v.languages ?? auto;

/** "Woman · Persian, English · Early 30s +1", or "Claude decides". */
export function fineTuneSummary(t: SpawnCopy, v: FineTuneValue, auto: string[]): string {
  const langs = effectiveLanguages(v, auto);
  const items = [
    v.presentation && t.presentations[v.presentation],
    langs.length ? langs.join(', ') : '',
    v.culture.trim(), v.age.trim(), v.accent.trim(),
    Object.keys(v.traits).length ? t.temperament : '',
  ].filter(Boolean) as string[];
  if (!items.length) return t.fineTuneDefault;
  return items.slice(0, 3).join(' · ') + (items.length > 3 ? ` +${t.num(items.length - 3)}` : '');
}

/** Everything personal, one tap away and collapsed by default. */
export function FineTune({ t, open, onToggle, value, onChange, autoLanguages, disabled }: {
  t: SpawnCopy; open: boolean; onToggle: () => void; value: FineTuneValue; onChange: (v: FineTuneValue) => void; autoLanguages: string[];
  disabled?: boolean;
}) {
  const id = useId();
  const m = useSpawnMotion();
  const langs = effectiveLanguages(value, autoLanguages);
  const set = (patch: Partial<FineTuneValue>) => onChange({ ...value, ...patch });

  return (
    <div>
      <button type="button" className="vx-disclose" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle} disabled={disabled}>
        <span className="vx-head vx-catalog-layout-827f35e0" >{t.fineTune}</span>
        <span className="vx-disclose-sum" dir="auto">{fineTuneSummary(t, value, autoLanguages)}</span>
        <span className="vx-disclose-chev" aria-hidden="true"><Icon name="chevron" size={18} width={2} /></span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" initial={m.collapse.initial} animate={m.collapse.animate} exit={m.collapse.exit} className="vx-catalog-layout-fe45d938">
            <fieldset id={`${id}-body`} role="region" aria-label={t.fineTune} className="vx-disclose-body" disabled={disabled}>
              <Field label={t.presentsAs} group>
                <Chips options={(['feminine', 'masculine', 'neutral'] as const).map((p) => ({ value: p, label: t.presentations[p] }))}
                  value={value.presentation ? [value.presentation] : []} onChange={(v) => set({ presentation: v[0] })} />
              </Field>
              <Field label={t.languages} group
                hint={!value.languages && autoLanguages.length ? `${autoLanguages.join(', ')} ${t.fromBrief}` : undefined}>
                <Chips multi options={LANGUAGES.map((l) => ({ value: l, label: l }))} value={langs} onChange={(v) => set({ languages: v })} />
              </Field>
              <div className="vx-catalog-layout-baf2fda5">
                <span className="vx-over">{t.background}</span>
                <div className="vx-catalog-layout-f83d7b60">
                  <input className="vx-input" dir="auto" value={value.culture} onChange={(e) => set({ culture: e.target.value })} placeholder={t.culturePh} aria-label={t.culture} maxLength={80} />
                  <input className="vx-input" dir="auto" value={value.age} onChange={(e) => set({ age: e.target.value })} placeholder={t.agePh} aria-label={t.age} maxLength={40} />
                </div>
              </div>
              <Field label={t.accent} hint={t.accentHint}>
                <input className="vx-input" dir="auto" value={value.accent} onChange={(e) => set({ accent: e.target.value })} placeholder={t.accentPh} maxLength={80} />
              </Field>
              <div role="group" aria-label={t.temperament} className="vx-catalog-layout-ff69c307">
                <span className="vx-over">{t.temperament}</span>
                {TRAITS.map((k) => (
                  <Slider key={k} left={t.sliders[k][0]} right={t.sliders[k][1]} value={value.traits[k] ?? TRAIT_DEFAULTS[k]}
                    onChange={(n) => set({ traits: { ...value.traits, [k]: n } })} />
                ))}
              </div>
            </fieldset>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
