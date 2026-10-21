'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useId } from 'react';
import { haptic } from '../../../_lib/client';
import { Icon } from '../../ui';
import { LinkButton } from './BriefBits';
import { packTitle, roleSummary, roleTitle, useCatalog, type CatalogRole } from './catalog';
import type { SpawnCopy } from './copy';
import { useSpawnMotion } from './motion';
import { MiniCloud } from './parts';
import { textAttrs, type RoutingSource } from './routing';
import type { SkillToggle } from './roles';
import { SkillChips } from './SkillChips';

/** The applied role: who they start as, which skills they carry, and two ways out (✕, Change). */
export function RouteCard({ t, role, source, predecessorName, skills, onToggleSkill, onMoreSkills, onChange, onDetach, fa }: {
  t: SpawnCopy; role: CatalogRole; source: RoutingSource; predecessorName?: string; skills: SkillToggle[];
  onToggleSkill: (id: string) => void; onMoreSkills: () => void; onChange: () => void; onDetach: () => void; fa: boolean;
}) {
  const catalog = useCatalog();
  const id = useId();
  const m = useSpawnMotion();
  const pack = packTitle(catalog, role.pack, t.packFull[role.pack], fa);
  const overline = source === 'successor' && predecessorName ? t.cardSuccessor(predecessorName)
    : source === 'picked' || source === 'successor' ? t.cardPicked(pack) : t.cardRouted(pack);
  const extra = role.optionalSkills.filter((s) => catalog.skills.has(s) && !skills.some((i) => i.id === s)).length;

  return (
    <section className="vx-route" aria-labelledby={`${id}-title`}>
      <div className="vx-route-head">
        <MiniCloud hue={role.hue} id={role.id} size={40} />
        <div>
          <span className="vx-over" {...textAttrs(overline)}>{overline}</span>
          <AnimatePresence initial={false} mode="wait">
            <motion.div key={role.id} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.2 } }} exit={{ opacity: 0, transition: { duration: m.reduce ? 0.12 : 0.16 } }}
              className="vx-catalog-layout-7be83166">
              <h2 id={`${id}-title`} className="vx-route-title" {...textAttrs(roleTitle(role, fa))}>{roleTitle(role, fa)}</h2>
              <p className="vx-route-sum" {...textAttrs(roleSummary(role, fa))}>{roleSummary(role, fa)}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <button type="button" className="vx-icon-btn vx-route-x" aria-label={t.detach} onClick={() => { haptic.select(); onDetach(); }}>
          <Icon name="close" size={18} width={2} />
        </button>
      </div>
      <div className="vx-route-rule" />
      <SkillChips t={t} items={skills} onToggle={onToggleSkill} onAdd={onMoreSkills} extra={extra} fa={fa} />
      <div className="vx-route-foot">
        <LinkButton label={t.change} onClick={onChange} />
      </div>
    </section>
  );
}
