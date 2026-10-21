'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { AgentLook } from '../../../_lib/client';
import { Cloud } from '../../Cloud';
import { familyFor, type CatalogRole } from './catalog';
import type { SpawnCopy } from './copy';
import { useSpawnMotion } from './motion';
import { textAttrs } from './routing';

const LOOKS: Array<Pick<AgentLook, 'hue' | 'family' | 'features'>> = [
  { hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: true, brows: false } },
  { hue: 'lagoon', family: 'tower', features: { cheeks: false, lashes: false, brows: true } },
  { hue: 'apricot', family: 'drift', features: { cheeks: true, lashes: false, brows: false } },
];
const BEAT_MS = 2400;

/** Full-screen wait while Claude drafts. Honest beats, stopping on the last; no fake progress. */
export function Drafting({ t, role, roleName }: { t: SpawnCopy; role?: CatalogRole; roleName?: string }) {
  const m = useSpawnMotion();
  const [i, setI] = useState(0);
  const [beat, setBeat] = useState(0);
  const carousel = !role && !m.reduce;

  useEffect(() => {
    if (!carousel) return;
    const timer = setInterval(() => setI((n) => (n + 1) % LOOKS.length), 1100);
    return () => clearInterval(timer);
  }, [carousel]);

  useEffect(() => {
    if (beat >= t.beats.length - 1) return;
    const timer = setTimeout(() => setBeat((b) => b + 1), BEAT_MS);
    return () => clearTimeout(timer);
  }, [beat, t.beats.length]);

  const look = role ? { hue: role.hue, family: familyFor(role.id), features: { cheeks: true, lashes: false, brows: false } } : LOOKS[i];
  return (
    <div className="vx-drafting">
      <AnimatePresence mode="wait">
        <motion.div key={role ? role.id : i}
          initial={m.reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={m.reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0, rotate: 8 }}
          transition={m.reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 380, damping: 22 }}>
          <Cloud look={look} size={150} expr="thinking" stage={role ? 3 : 1} label="Drafting" />
        </motion.div>
      </AnimatePresence>
      <div aria-live="polite" className="vx-title-m" {...textAttrs(roleName)}>{role && roleName ? t.draftingRole(roleName) : t.draftingCustom}</div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={beat} className="vx-2 vx-catalog-layout-02419cff"  aria-hidden="true"
          initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.24 } }} exit={{ opacity: 0, transition: { duration: 0.16 } }}>
          {t.beats[beat]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
