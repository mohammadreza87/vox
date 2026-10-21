'use client';

import { useRef, useState, type RefObject } from 'react';
import { MAX_AGENT_SKILLS } from '@/lib/studio/skills/types';
import { haptic } from '../../../_lib/client';
import { Icon, Sheet } from '../../ui';
import { roleTitle, skillSummary, skillTitle, useCatalog, type CatalogSkill } from './catalog';
import type { BriefCopy } from './copy';
import { useBackGuard, useSheetA11y } from './hooks';
import { SheetScroll } from './parts';
import { textAttrs } from './routing';

const TOP_PICKS = 6;
const MAX_RESULTS = 40;

/**
 * Skills on/off for one agent: what is on, the role's suggestions, and a
 * search over the whole library. Capped at MAX_AGENT_SKILLS.
 */
export function SkillsSheet({ t, open, onClose, roleId, selected, onChange, fa, returnFocus }: {
  t: BriefCopy; open: boolean; onClose: () => void; roleId?: string; selected: string[];
  onChange: (next: string[]) => void; fa?: boolean; returnFocus?: RefObject<HTMLElement | null>;
}) {
  useBackGuard(open, onClose);
  return (
    <Sheet open={open} onClose={onClose} label={t.skillsSheet}>
      {open && <SkillsBody t={t} onClose={onClose} roleId={roleId} selected={selected} onChange={onChange} fa={!!fa} returnFocus={returnFocus} />}
    </Sheet>
  );
}

function SkillsBody({ t, onClose, roleId, selected, onChange, fa, returnFocus }: {
  t: BriefCopy; onClose: () => void; roleId?: string; selected: string[]; onChange: (next: string[]) => void; fa: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const catalog = useCatalog();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  useSheetA11y(true, ref, onClose, returnFocus);

  // Sections are fixed while the sheet is open, so a row never jumps away from the finger that toggled it.
  const [initiallyOn] = useState(selected);
  const role = roleId ? catalog.roles.get(roleId) : undefined;
  const atCap = selected.length >= MAX_AGENT_SKILLS;
  const get = (id: string) => catalog.skills.get(id);
  const on = initiallyOn.map(get).filter((s): s is CatalogSkill => !!s);
  const suggested = role
    ? [...new Set([...role.skills, ...role.optionalSkills])].filter((id) => !initiallyOn.includes(id)).map(get).filter((s): s is CatalogSkill => !!s)
    : [];
  const q = query.trim().toLowerCase();
  const rest = [...catalog.skills.values()].filter((s) => !initiallyOn.includes(s.id) && !suggested.includes(s));
  // Search-first: a long library is never listed whole. Without a role, a few general skills are a start.
  const [picks] = useState(() => role ? [] : [...rest.filter((s) => s.id.startsWith('core.')), ...rest.filter((s) => !s.id.startsWith('core.'))].slice(0, TOP_PICKS));
  const matches = q
    ? rest.filter((s) => [s.title, s.summary, s.fa?.title, s.fa?.summary].some((v) => v?.toLowerCase().includes(q))).slice(0, MAX_RESULTS)
    : [];

  const toggle = (id: string) => {
    const isOn = selected.includes(id);
    if (!isOn && atCap) return;
    haptic.select();
    onChange(isOn ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const row = (s: CatalogSkill) => {
    const isOn = selected.includes(s.id);
    return (
      <button key={s.id} type="button" className="vx-pick-row vx-pick-row-56" aria-pressed={isOn} disabled={!isOn && atCap} onClick={() => toggle(s.id)}>
        <div>
          <span {...textAttrs(skillTitle(s, fa))} className="vx-catalog-layout-3d9df89e">{skillTitle(s, fa)}</span>
          <span {...textAttrs(skillSummary(s, fa))} className="vx-small vx-2">{skillSummary(s, fa)}</span>
        </div>
        <span className="vx-pick-check" aria-hidden="true"><Icon name={isOn ? 'check' : 'plus'} size={20} width={2} /></span>
      </button>
    );
  };

  const search = (
    <label className="vx-search">
      <Icon name="search" size={18} />
      <input type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchSkills} aria-label={t.searchSkills} maxLength={60} />
    </label>
  );

  return (
    <div ref={ref} className="vx-sheet-body">
      <div className="vx-sheet-head">
        <h2 className="vx-title-m">{t.skillsSheet}</h2>
        <span className="vx-small vx-2 vx-num">{t.num(selected.length)}/{t.num(MAX_AGENT_SKILLS)}</span>
      </div>
      {atCap && <div className="vx-small vx-2" role="status">{t.cap}</div>}
      <SheetScroll>
        {!role && search}
        {on.length > 0 && <Section title={t.on}>{on.map(row)}</Section>}
        {suggested.length > 0 && role && <Section title={t.suggestedFor(roleTitle(role, fa))}>{suggested.map(row)}</Section>}
        {role && search}
        {q
          ? matches.length > 0
            ? <Section title={t.moreSkillsSection}>{matches.map(row)}</Section>
            : <div className="vx-small vx-2">{t.noSkillMatch}</div>
          : picks.length > 0 && <Section title={t.topPicks}>{picks.map(row)}</Section>}
      </SheetScroll>
      <button type="button" className="vx-btn vx-btn-secondary vx-btn-block" onClick={onClose}>{t.done}</button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vx-section">
      <span className="vx-over">{title}</span>
      <div className="vx-group vx-pick-list">{children}</div>
    </section>
  );
}
