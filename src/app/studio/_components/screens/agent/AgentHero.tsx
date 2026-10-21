'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Stage } from '@/lib/studio/types';
import { agentCopy } from '../../../_lib/agents-copy';
import { api, haptic, type AgentView } from '../../../_lib/client';
import { DUR, EASE, SPRING } from '../../../_lib/motion';
import { Cloud, stageFor, type CloudMoment } from '../../Cloud';
import { ProfileSyncStatus } from '../../look/ProfileSyncStatus';
import { syncState, useNow } from '../../look/syncState';
import { useLanded } from '../../motion/useLanded';
import { useStageUp } from '../../motion/useStageUp';
import { errorMessage, useNav } from '../../StudioApp';
import { Icon } from '../../ui';
import { LookSheet, type LookSheetTab } from './LookSheet';

const DAY_MS = 86_400_000;
const HALO = 220;
const FACE = 168;
/** Long-press on the hero opens the look (interaction §7.1). */
const LONG_PRESS_MS = 450;
/** The stage-up moment runs ~2.4 s (motion §4.8); its pill holds a little longer. */
const EVOLVE_MS = 2600;
const PILL_MS = 4200;

/** Fractional forming progress, 0–7: the board fills the current day's segment partway. */
export function formingProgress(agent: Pick<AgentView, 'lockAt' | 'hiredAt' | 'formingDay'>, now: number): number {
  const clamp = (v: number) => Math.min(7, Math.max(0, v));
  if (agent.lockAt) return clamp(7 - (new Date(agent.lockAt).getTime() - now) / DAY_MS);
  if (agent.hiredAt) return clamp((now - new Date(agent.hiredAt).getTime()) / DAY_MS);
  return clamp((agent.formingDay ?? 1) - 0.5);
}

/** 7 day segments round the face, the current one filled to the hour, with a pulsing leading dot (board: agent-profile-forming). */
function FormingHalo({ progress, size, reduced }: { progress: number; size: number; reduced: boolean }) {
  const cx = size / 2, r = size / 2 - 10, seg = 360 / 7, gap = 4;
  const pt = (deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cx + r * Math.sin(a)]; };
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0); const [x1, y1] = pt(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const whole = Math.floor(progress), part = progress - whole;
  const headDeg = Math.min(whole, 6) * seg + gap / 2 + (seg - gap) * (whole >= 7 ? 1 : part);
  const [hx, hy] = pt(headDeg);
  const draw = (i: number) => (reduced ? { initial: false as const } : {
    initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay: 0.15 + i * 0.08, duration: 0.4, ease: EASE.enter },
  });
  return (
    <svg className="vx-halo" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" data-progress={progress.toFixed(2)}>
      {Array.from({ length: 7 }, (_, i) => {
        const a0 = i * seg + gap / 2, a1 = (i + 1) * seg - gap / 2;
        const fill = i < whole ? 1 : i === whole ? part : 0;
        return (
          <g key={i}>
            <path d={arc(a0, a1)} className="vx-halo-track" />
            {fill > 0.01 && <motion.path d={arc(a0, a0 + (a1 - a0) * fill)} className="vx-halo-fill" {...draw(i)} />}
          </g>
        );
      })}
      {progress < 7 && (
        <motion.circle cx={hx} cy={hy} r={5} className="vx-halo-head vx-head-dot"
          initial={reduced ? false : { opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING.pop, delay: reduced ? 0 : 0.15 + whole * 0.08 + 0.3 }} />
      )}
    </svg>
  );
}

function LockSeal({ reduced }: { reduced: boolean }) {
  return (
    <motion.div className="vx-hero-seal" initial={reduced ? false : { scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      transition={{ ...SPRING.pop, delay: 0.3 }}>
      <Icon name="lock" size={18} width={2.25} />
    </motion.div>
  );
}

export interface AgentHeroProps {
  agent: AgentView;
  onUpdate: (a: AgentView) => void;
  /** @deprecated the status row spins its own Retry; kept so AgentScreen compiles until it drops it */
  busy?: boolean;
  /** A failure from the screen's own status reads, shown under the row */
  profileError?: string | null;
  /** Overrides the row's Retry (default: force-push every step, then onUpdate) */
  onRetryProfile?: () => void | Promise<unknown>;
}

/**
 * Profile hero: the live character (the in-app identity, PLAN D1) in its
 * forming halo or under the lock seal, name and role, and the Telegram status
 * row. Poke the character for a hop (three quick pokes: a spin); long-press or
 * the edit badge opens the look sheet, also after the lock (PLAN D9). A new
 * forming stage plays once per device, with a "grew" pill.
 */
export function AgentHero({ agent, onUpdate, profileError, onRetryProfile }: AgentHeroProps) {
  const nav = useNav();
  const c = agentCopy[nav.locale ?? 'en'];
  const reduced = nav.tier === 'reduced';
  const [sheet, setSheet] = useState<LookSheetTab | null>(null);
  /** Opened from "Update" on an outdated photo: the sheet starts drawing straight away. */
  const [regen, setRegen] = useState(false);
  const active = agent.status === 'active';
  const fired = agent.status === 'fired';
  const p = agent.persona;
  const canRepair = agent.canManageAccess || agent.canEdit;
  const canLook = !!agent.canEditLook && !fired;
  const stage: Stage = agent.stage ?? stageFor(agent.formingDay, agent.status);
  const forming = active && !agent.locked;
  const now = useNow(forming, 60_000);

  const grow = useStageUp(agent.id, stage, agent.status);
  // Opened as a hero, the stage-up waits for the face to land instead of squashing mid-flight (motion §3.3)
  const heroRef = useRef<HTMLDivElement>(null);
  const evolve = useLanded(heroRef) ? grow.moment : null;
  // ...and until it plays, the face keeps the stage this device saw: a hero lands at the old stage, then grows
  const faceStage: Stage = grow.moment && !evolve ? grow.moment.fromStage ?? stage : stage;
  const [poke, setPoke] = useState<CloudMoment | null>(null);
  const [pill, setPill] = useState<string | null>(null);
  const pokes = useRef<number[]>([]);
  const pokeN = useRef(0);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);

  // Stage-up: the moment plays on the face, the pill names it. If the face never reports the end, finish anyway.
  const done = useRef(grow.done);
  done.current = grow.done;
  useEffect(() => {
    if (!evolve) return;
    setPill(c.grew(p.name, stage));
    const end = setTimeout(() => done.current(), reduced ? 0 : EVOLVE_MS);
    return () => clearTimeout(end);
  }, [evolve, p.name, stage, reduced, c]);
  useEffect(() => {
    if (!pill) return;
    const t = setTimeout(() => setPill(null), PILL_MS);
    return () => clearTimeout(t);
  }, [pill]);
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);

  // Telegram refused the photo just now (not on arrival): the face winces once.
  const photoFailed = active && syncState(agent) === 'error-photo';
  const wasFailed = useRef(photoFailed);
  useEffect(() => {
    if (photoFailed && !wasFailed.current && !reduced) setPoke({ kind: 'wince', key: `wince-${++pokeN.current}` });
    wasFailed.current = photoFailed;
  }, [photoFailed, reduced]);

  const retry = onRetryProfile ?? (async () => {
    try {
      onUpdate((await api.syncProfile(agent.id)).agent);
    } catch (e) { nav.toast(errorMessage(e), 'error'); }
  });

  const openLook = (tab: LookSheetTab = 'character', auto = false) => { haptic.tap(); setRegen(auto); setSheet(tab); };

  const tapFace = () => {
    if (press.current?.fired) { press.current = null; return; }
    if (evolve) return;
    haptic.soft();
    const t = Date.now();
    pokes.current = [...pokes.current.filter((x) => t - x < 2000), t];
    const kind = pokes.current.length >= 3 ? 'spin' : 'hop';
    if (kind === 'spin') pokes.current = [];
    if (!reduced) setPoke({ kind, key: `poke-${++pokeN.current}` });
  };
  const pressStart = (e: PointerEvent) => {
    if (!canLook || e.button > 0) return;
    const timer = setTimeout(() => {
      press.current = { timer, fired: true };
      haptic.medium();
      setRegen(false);
      setSheet('character');
    }, LONG_PRESS_MS);
    press.current = { timer, fired: false };
  };
  const pressEnd = () => { if (press.current && !press.current.fired) { clearTimeout(press.current.timer); press.current = null; } };

  const moment = evolve ?? poke;
  const expr = fired ? 'sleeping' : evolve || (poke && poke.kind !== 'wince') ? 'happy' : 'idle';

  return (
    <>
      <div className="vx-hero-glow" style={{ top: -40, width: 520, height: 420 }} aria-hidden="true" />
      <div ref={heroRef} className="vx-hero">
        <div className="vx-hero-face" style={{ width: HALO, height: HALO }}>
          {forming && <FormingHalo progress={formingProgress(agent, now)} size={HALO} reduced={reduced} />}
          <button type="button" className="vx-hero-poke" aria-label={c.poke(p.name)} onClick={tapFace}
            onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
            onContextMenu={(e) => { if (canLook) e.preventDefault(); }}>
            <Cloud look={agent.look} size={FACE} heroId={agent.id} stage={faceStage} expr={expr} label={p.name}
              moment={moment} onMomentEnd={(k) => { if (evolve && k === evolve.kind) grow.done(); else setPoke(null); }} />
          </button>
          {agent.locked && <LockSeal reduced={reduced} />}
          {canLook && (
            <button type="button" className="vx-icon-btn vx-hero-edit" aria-label={c.editLook(p.name)} onClick={() => openLook('character')}>
              <Icon name="edit" size={18} width={2} />
            </button>
          )}
        </div>
        <h1 className="vx-display vx-hero-name">{p.name}</h1>
        <span className="vx-small vx-2">{p.role}{agent.bot ? ` · @${agent.bot.username}` : ''}</span>
        {agent.isAdmin && <span className="vx-pill volt vx-hero-admin">{c.adminAgent}</span>}
        <div className="vx-hero-pillslot" aria-live="polite">
          <AnimatePresence>
            {pill && (
              <motion.span key={pill} className="vx-pill volt vx-hero-grew"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1, transition: reduced ? { duration: DUR.fast } : { ...SPRING.pop, delay: 1.4 } }}
                exit={{ opacity: 0, transition: { duration: DUR.fast, ease: EASE.exit } }}>
                <Icon name="spark" size={12} width={2.25} />{pill}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {active && (
          <div className="vx-hero-sync">
            <ProfileSyncStatus agent={agent} compact photo={28}
              onRetry={canRepair ? retry : undefined}
              onRegenerate={canLook ? () => openLook('photo', true) : undefined} />
            {profileError && <p role="alert" className="vx-small vx-hero-error">{profileError}</p>}
          </div>
        )}
        {agent.locked && canLook && (
          <p className="vx-hero-locked">
            <Icon name="lock" size={14} width={2} />
            <span>{c.lockedLook}</span>
          </p>
        )}
      </div>
      {canLook && (
        <LookSheet agent={agent} open={sheet !== null} tab={sheet ?? 'character'} autoGenerate={regen}
          onClose={() => { setSheet(null); setRegen(false); }} onUpdate={onUpdate} />
      )}
    </>
  );
}
