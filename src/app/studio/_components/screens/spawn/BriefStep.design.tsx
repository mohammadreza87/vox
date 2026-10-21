'use client';

import { useEffect, useState } from 'react';
import type { CharacterLook } from '@/lib/studio/types';
import type { SpawnBrief } from '../../../_lib/client';
import { labelOf, spawnCopy } from '../../../_lib/spawn-copy';
import { useNav } from '../../StudioApp';
import { Icon } from '../../ui';
import { Drafting } from './Drafting.design';
import { Chips, Dock, Field, Slider, type Busy } from './shared';

/** Chip values go to Claude as written (English); only their labels follow the app language. */
const PRESENTATIONS: ReadonlyArray<NonNullable<SpawnBrief['presentation']>> = ['feminine', 'masculine', 'neutral'];
const AGES = ['20s', '30s', '40s', '50s+'];
const DOMAINS = ['Product', 'Engineering', 'Design', 'Marketing', 'Sales', 'Finance', 'People', 'Research', 'Legal', 'Support'];
const LANGUAGES = ['English', 'Persian', 'Vietnamese', 'Arabic', 'Turkish', 'French', 'German', 'Spanish'];
const TRAITS = { warmDirect: 50, playfulSerious: 50, conciseExpansive: 40 };

/** Step 1 (board spawn-1): everything optional; Claude fills the gaps. */
export function BriefStep({ busy, successorOf, onDraft, onDirty, drafted, onDrafted }: {
  busy: Busy; successorOf?: string; onDraft: (b: SpawnBrief) => void;
  /** Anything typed or picked, so closing the wizard asks first */
  onDirty?: (dirty: boolean) => void;
  /** The draft's look once it landed: the forming creature poofs into it, then `onDrafted` moves on */
  drafted?: CharacterLook | null; onDrafted?: () => void;
}) {
  const locale = useNav().locale ?? 'en';
  const c = spawnCopy[locale].brief;
  const [description, setDescription] = useState('');
  const [presentation, setPresentation] = useState<NonNullable<SpawnBrief['presentation']>[]>([]);
  const [age, setAge] = useState<string[]>([]);
  const [domain, setDomain] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [culture, setCulture] = useState('');
  const [accent, setAccent] = useState('');
  const [traits, setTraits] = useState(TRAITS);
  const drafting = busy === 'draft';

  const dirty = !!(description.trim() || culture.trim() || accent.trim()) || presentation.length + age.length + domain.length + languages.length > 0
    || traits.warmDirect !== TRAITS.warmDirect || traits.playfulSerious !== TRAITS.playfulSerious || traits.conciseExpansive !== TRAITS.conciseExpansive;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  const brief = (): SpawnBrief => ({
    description: description.trim() || undefined,
    presentation: presentation[0] ?? undefined,
    age: age[0],
    domain: domain[0],
    languages: languages.length ? languages : undefined,
    culture: culture.trim() || undefined,
    accent: accent.trim() || undefined,
    traits,
  });

  if (drafting || drafted) return <Drafting look={drafted} onDone={onDrafted} locale={locale} />;

  return (
    <>
      <div className="vx-scroll vx-form">
        <div className="vx-step-head">
          <h1 className="vx-title-l">{successorOf ? c.successorTitle : c.title}</h1>
          <p className="vx-2">{successorOf ? c.successorSub : c.sub}</p>
        </div>
        <Field label={c.role}>
          <textarea className="vx-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} dir="auto"
            placeholder={c.rolePlaceholder} />
        </Field>
        <Field label={c.presentsAs} group>
          <Chips options={PRESENTATIONS.map((p) => ({ value: p, label: c.presentations[p] }))} value={presentation} onChange={setPresentation} />
        </Field>
        <Field label={c.age} group>
          <Chips options={AGES.map((a) => ({ value: a, label: labelOf(c.ages, a) }))} value={age} onChange={setAge} />
        </Field>
        <Field label={c.culture}>
          <input className="vx-input" value={culture} onChange={(e) => setCulture(e.target.value)} placeholder={c.culturePlaceholder} maxLength={80} dir="auto" />
        </Field>
        <Field label={c.languages} group>
          <Chips multi options={LANGUAGES.map((l) => ({ value: l, label: labelOf(c.languageNames, l) }))} value={languages} onChange={setLanguages} />
        </Field>
        <Field label={c.domain} group>
          <Chips options={DOMAINS.map((d) => ({ value: d, label: labelOf(c.domains, d) }))} value={domain} onChange={setDomain} />
        </Field>
        <Field label={c.accent} hint={c.accentHint}>
          <input className="vx-input" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder={c.accentPlaceholder} maxLength={80} dir="auto" />
        </Field>
        <div className="vx-field" role="group" aria-label={c.personality}>
          <span className="vx-over">{c.personality}</span>
          <Slider left={c.warm} right={c.direct} label={c.range(c.warm, c.direct)} value={traits.warmDirect} onChange={(v) => setTraits({ ...traits, warmDirect: v })} />
          <Slider left={c.playful} right={c.serious} label={c.range(c.playful, c.serious)} value={traits.playfulSerious} onChange={(v) => setTraits({ ...traits, playfulSerious: v })} />
          <Slider left={c.concise} right={c.expansive} label={c.range(c.concise, c.expansive)} value={traits.conciseExpansive} onChange={(v) => setTraits({ ...traits, conciseExpansive: v })} />
        </div>
      </div>
      <Dock>
        <button type="button" className="vx-btn vx-btn-secondary vx-dock-aside" onClick={() => onDraft({ traits: TRAITS })}>{c.surprise}</button>
        <button type="button" className="vx-btn vx-btn-primary vx-dock-grow" onClick={() => onDraft(brief())}>
          <Icon name="spark" size={18} width={2} />{c.draft}
        </button>
      </Dock>
    </>
  );
}
