'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { MAX_AGENT_SKILLS } from '@/lib/studio/skills/types';
import { haptic } from '../../../_lib/client';
import { skillTitle, useCatalog } from './catalog';
import type { SpawnCopy } from './copy';
import { useSpawnMotion } from './motion';
import { onIds, type SkillToggle } from './roles';
import { textAttrs } from './routing';

/**
 * Tap to toggle; off chips stay where they are (dashed) so a mistaken tap is
 * undone with a second tap. At the cap, off chips can't be turned back on.
 */
export function SkillChips({ t, items, onToggle, onAdd, extra = 0, readOnly, fa, label }: {
  t: SpawnCopy; items: SkillToggle[]; onToggle: (id: string) => void; onAdd?: () => void;
  extra?: number; readOnly?: boolean; fa?: boolean; label?: string;
}) {
  const catalog = useCatalog();
  const m = useSpawnMotion();
  const known = items.filter((i) => catalog.skills.has(i.id));
  const atCap = onIds(known).length >= MAX_AGENT_SKILLS;
  return (
    <div className="vx-catalog-layout-baf2fda5">
      <div className="vx-skills" role="group" aria-label={label ?? t.skills}>
        <AnimatePresence initial={false}>
          {known.map((i, n) => {
            const skill = catalog.skills.get(i.id)!;
            return (
              <motion.button key={i.id} type="button" className="vx-skill vx-hit" aria-pressed={i.on}
                initial={m.chip.initial} animate={{ ...m.chip.animate, transition: { ...m.chip.animate.transition, delay: m.reduce ? 0 : Math.min(n, 8) * 0.03 } }}
                whileTap={readOnly || m.reduce ? undefined : { scale: 0.96 }}
                disabled={readOnly || (!i.on && atCap)} onClick={() => { haptic.select(); onToggle(i.id); }}>
                <span className="vx-skill-label" {...textAttrs(skillTitle(skill, !!fa))}>{skillTitle(skill, !!fa)}</span>
              </motion.button>
            );
          })}
        </AnimatePresence>
        {onAdd && !readOnly && (
          <button type="button" className="vx-skill vx-skill-add vx-hit" aria-label={extra > 0 ? `${t.addSkillsLabel} (${t.moreSkills(extra)})` : t.addSkillsLabel}
            onClick={onAdd}>{extra > 0 ? t.moreSkills(extra) : t.addSkill}</button>
        )}
      </div>
      {atCap && !readOnly && known.some((i) => !i.on) && <span className="vx-small vx-2">{t.cap}</span>}
    </div>
  );
}
