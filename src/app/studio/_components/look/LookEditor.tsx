'use client';

import { animate, AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PRESET_LOOKS, normalizeLook } from '@/lib/studio/character';
import type { CharacterLook, Hue, Stage } from '@/lib/studio/types';
import { haptic, type AgentView } from '../../_lib/client';
import { DUR, EASE, SPRING } from '../../_lib/motion';
import { Cloud, PALETTE, type CloudMoment, type Expression } from '../Cloud';
import { Burst } from '../motion/Burst';
import { errorMessage, useNav } from '../StudioApp';
import { Icon, Seg, hueVars } from '../ui';
import {
  ACCENT_OPTIONS, ACCESSORY_LABEL, CATEGORIES, FAMILY_IDS, FAMILY_LABEL, FEATURES, FEATURE_LABEL, HAIR_LABEL, HAIR_STYLES, HUES,
  SPECIES, SPECIES_LABEL, STAGE_DAY, STAGE_FOR, TONE_OPTIONS,
  accentSwatch, accessoryOrder, applyPatch, blockedBy, changeLabel, describeLook, sameLook, toneLabel, toneSwatch,
  type LookCategory,
} from './lookOptions';
import { OptionRail, type RailOption } from './OptionRail';
import { StageScrubber } from './StageScrubber';
import { SwatchGrid } from './SwatchGrid';
import { TelegramPhoto } from './TelegramPhoto';
import { useLookDraft, type LookDraft } from './useLookDraft';
import { useUndoStack } from './useUndoStack';

/** Dice: six frames, decelerating, then the landing (interaction §4.3). */
export const REEL_MS = [70, 70, 90, 110, 150, 220] as const;
/** Species and accessory changes land ~420–450 ms after the tap (squash-swap, drop-in). */
const LAND_MS = 440;
const HAPPY_MS = 1200;

type Change = Partial<CharacterLook>;

/** Which category a change belongs to, for the stage it needs and the haptic it lands with. */
const partOf = (p: Change): keyof typeof STAGE_FOR | null =>
  p.species ? 'species' : p.hair || p.hairTone ? 'hair' : p.accessory || p.accent ? 'accessory'
    : p.features ? (FEATURES.find((f) => p.features![f]) ?? null) : null;

const CATEGORY_STAGE: Record<LookCategory, Stage> = { species: 2, colour: 1, hair: 3, accessory: 4, face: 3 };

function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export interface LookEditorProps {
  agent: AgentView;
  onUpdate: (a: AgentView) => void;
  /** live: edits save without a Telegram push; one push when the editor closes (PLAN D5) */
  mode: 'draft' | 'live';
  /** Renders a Done button that saves, pushes (live) and then calls this */
  onDone?: () => void;
  /** Heading above the stage, with the Saving… / Saved status under it */
  title?: ReactNode;
  heading?: 'h1' | 'h2';
  /** Shows the "Telegram photo" row that opens the photo picker */
  onPhoto?: () => void;
}

/**
 * The character customizer: a 200 px stage on the hue glow (poke it, roll the
 * dice), a growth scrubber, and Species · Colour · Hair · Accessory · Face rails
 * of live mini characters. Edits are optimistic and saved in the background
 * (350 ms debounce, newest request wins), with a 4 s undo pill.
 */
export function LookEditor({ agent, onUpdate, mode, onDone, title, heading = 'h1', onPhoto }: LookEditorProps) {
  const nav = useNav();
  const reduced = nav.tier === 'reduced';
  const name = agent.persona.name;
  const draft = useLookDraft(agent, onUpdate, {
    live: mode === 'live',
    describe: errorMessage,
    onError: () => haptic.error(),
    // The sheet is usually gone by now: the app-level snack carries the failure and its Retry.
    onPushError: (message, retry) => nav.snack({ message: `Telegram wasn’t updated. ${message}`, tone: 'error', action: { label: 'Retry', run: retry } }),
  });
  const look = draft.look;
  const pal = PALETTE[look.hue] ?? PALETTE.lilac;
  const undo = useUndoStack<CharacterLook>();

  const real: Stage = mode === 'draft' ? 4 : agent.stage ?? 4;
  const [stage, setStage] = useState<Stage>(real);
  const [cat, setCat] = useState<LookCategory>('species');
  const [dir, setDir] = useState(1);
  const [expr, setExpr] = useState<Expression>('happy');
  const [moment, setMoment] = useState<CloudMoment | null>(null);
  const [said, setSaid] = useState('');
  const [wash, setWash] = useState<{ n: number; x: number; color: string } | null>(null);
  const [reel, setReel] = useState<{ frames: CharacterLook[]; i: number } | null>(null);
  const [landed, setLanded] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const happyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokes = useRef<number[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const momentN = useRef(0);

  const changeRef = useRef<typeof change | null>(null);
  const later = (ms: number, run: () => void) => { timers.current.push(setTimeout(run, ms)); };
  useEffect(() => () => { timers.current.forEach(clearTimeout); if (happyTimer.current) clearTimeout(happyTimer.current); }, []);

  const beHappy = (ms = HAPPY_MS) => {
    setExpr('happy');
    if (happyTimer.current) clearTimeout(happyTimer.current);
    happyTimer.current = setTimeout(() => setExpr('idle'), ms);
  };
  // Happy on entry, then idle (interaction §4.2).
  useEffect(() => { beHappy(1600); }, []);

  const play = (kind: CloudMoment['kind']) => {
    if (reduced) return;
    const m = { kind, key: ++momentN.current };
    setMoment(m);
    later(1400, () => setMoment((cur) => (cur?.key === m.key ? null : cur)));
  };

  // A rollback shakes the rail that failed (interaction §2.5).
  useEffect(() => {
    if (!draft.failures || reduced || !panel.current) return;
    animate(panel.current, { x: [0, -8, 7, -5, 4, -2, 0] }, { duration: 0.36, ease: 'easeOut' });
  }, [draft.failures, reduced]);

  const announce = (next: CharacterLook, at: Stage) => setSaid(`${name} is now ${describeLook(next)}, day ${STAGE_DAY[at]} look`);

  /** Apply one change: optimistic, undoable, and visible (the preview jumps to the stage that shows it). */
  const change = (patch: Change, o: { label?: string; whole?: CharacterLook; quiet?: boolean } = {}) => {
    const before = look;
    const next = o.whole ? normalizeLook(o.whole) : applyPatch(before, patch);
    if (sameLook(before, next)) return;
    if (!o.quiet) undo.push(o.label ?? changeLabel(patch, before), before);
    draft.set(next);
    const part = partOf(patch);
    const need = o.whole ? 4 : part ? STAGE_FOR[part] : stage;
    const at = Math.max(stage, need) as Stage;
    if (at !== stage) setStage(at);
    announce(next, at);
    beHappy();
    haptic.select();
    if (patch.species || patch.accessory) later(LAND_MS, () => haptic.soft());
  };

  changeRef.current = change;

  const pickHue = (hue: Hue, i: number) => {
    setWash({ n: (wash?.n ?? 0) + 1, x: (i + 0.5) / HUES.length, color: PALETTE[hue].glow });
    change({ hue });
  };

  const back = () => {
    const top = undo.undo();
    if (!top) return;
    haptic.select();
    draft.set(top.before);
    announce(top.before, stage);
    beHappy();
  };

  const poke = () => {
    if (reel) return;
    haptic.soft();
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 2000), now];
    // The third poke within 2 s is a giggle spin (interaction §3.3).
    if (pokes.current.length >= 3) { pokes.current = []; play('spin'); } else play('hop');
    beHappy();
  };

  const roll = () => {
    if (reel) return;
    const pool = shuffled(PRESET_LOOKS.filter((l) => !sameLook(l, look)));
    const frames = pool.slice(0, REEL_MS.length);
    const final = frames[frames.length - 1];
    if (!final) return;
    const land = () => {
      setReel(null);
      // The newest change(): the user may have tapped something while the reel spun.
      changeRef.current?.({}, { whole: final, label: 'Surprise look' });
      setLanded((n) => n + 1);
      play('hop');
      haptic.success();
    };
    if (reduced) { land(); return; }
    haptic.light();
    setStage(4);
    setReel({ frames, i: 0 });
    let t = 0;
    REEL_MS.forEach((ms, i) => {
      if (i > 0) later(t, () => { setReel((r) => (r ? { ...r, i } : r)); haptic.select(); });
      t += ms;
    });
    later(t, land);
  };

  const switchCat = (c: LookCategory) => {
    const from = CATEGORIES.findIndex((x) => x.value === cat), to = CATEGORIES.findIndex((x) => x.value === c);
    setDir(to >= from ? 1 : -1);
    setCat(c);
    // Show the part this tab edits: hair from day 4, accessories from day 6.
    if (stage < CATEGORY_STAGE[c]) setStage(CATEGORY_STAGE[c]);
  };

  const rtl = (nav.dir ?? 'ltr') === 'rtl' ? -1 : 1;
  const shown = reel ? reel.frames[reel.i] : look;

  return (
    <div className="vx-look" style={hueVars(pal)}>
      {title && (
        <header className="vx-look-head">
          {heading === 'h1' ? <h1 className="vx-title-l">{title}</h1> : <h2 className="vx-title-m">{title}</h2>}
          <SaveStatus draft={draft} live={mode === 'live'} />
        </header>
      )}

      <div className="vx-look-stage">
        <span className="vx-look-glow" aria-hidden="true" />
        <AnimatePresence>
          {wash && !reduced && (
            <motion.span key={wash.n} className="vx-look-wash" aria-hidden="true" style={{ '--wx': wash.x, background: wash.color } as CSSProperties}
              initial={{ scale: 0.1, opacity: 0.55 }} animate={{ scale: 2.4, opacity: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: DUR.slower, ease: EASE.enter }} onAnimationComplete={() => setWash((w) => (w?.n === wash.n ? null : w))} />
          )}
        </AnimatePresence>
        {landed > 0 && !reduced && <span key={landed} className="vx-look-burst" aria-hidden="true"><Burst kind="spark" size={260} /></span>}
        <button type="button" className="vx-look-poke" onClick={poke} aria-label={`Poke ${name}`} disabled={!!reel}>
          {reel ? (
            <span className="vx-look-reel" aria-hidden="true">
              <AnimatePresence initial={false}>
                <motion.span key={reel.i} className="vx-look-frame"
                  initial={{ y: -22, opacity: 0, scaleY: 1.06 }} animate={{ y: 0, opacity: 1, scaleY: 1 }} exit={{ y: 22, opacity: 0 }}
                  transition={{ duration: (REEL_MS[reel.i] / 1000) * 0.9, ease: EASE.standard }}>
                  <Cloud look={shown} size={200} stage={4} expr="happy" lod="card" still label={name} />
                </motion.span>
              </AnimatePresence>
            </span>
          ) : (
            <Cloud look={look} size={200} stage={stage} expr={expr} lod="hero" moment={moment}
              onMomentEnd={() => setMoment(null)} label={`${name}, day ${STAGE_DAY[stage]}`} />
          )}
        </button>
        <motion.button type="button" className="vx-icon-btn solid vx-look-dice" aria-label="Surprise me: random look" onClick={roll}
          whileTap={reduced ? undefined : { scale: 0.9, rotate: 90 * rtl }} transition={SPRING.press}
          animate={reel && !reduced ? { rotate: 360 * rtl } : { rotate: 0 }}>
          <Icon name="dice" />
        </motion.button>
      </div>

      <StageScrubber agentId={agent.id} value={stage} rest={real} onChange={setStage} name={name} draft={mode === 'draft'} reduced={reduced} />

      <div className="vx-look-cats">
        <Seg label="Customize" options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} value={cat} onChange={switchCat} />
      </div>

      <div className="vx-look-panelwrap" ref={panel}>
        <AnimatePresence mode="wait" initial={false} custom={dir * rtl}>
          <motion.div key={cat} className="vx-look-panel" role="tabpanel" aria-label={CATEGORIES.find((c) => c.value === cat)?.label}
            custom={dir * rtl}
            variants={{
              in: (d: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: 12 * d }),
              on: { opacity: 1, x: 0, transition: reduced ? { duration: DUR.fast } : { duration: DUR.base, ease: EASE.enter } },
              out: (d: number) => (reduced ? { opacity: 0, transition: { duration: DUR.instant } } : { opacity: 0, x: -12 * d, transition: { duration: DUR.instant, ease: EASE.exit } }),
            }}
            initial="in" animate="on" exit="out">
            <Panel cat={cat} look={look} name={name} role={agent.persona.role} change={change} pickHue={pickHue} reduced={reduced} />
          </motion.div>
        </AnimatePresence>
      </div>

      {onPhoto && <PhotoRow agent={agent} onOpen={onPhoto} />}

      <div className="vx-look-sr" role="status" aria-live="polite">{said}</div>

      <div className="vx-look-undo-slot">
        <AnimatePresence>
          {undo.pill && (
            <motion.button key={undo.pillKey} type="button" className="vx-look-undo" onClick={back}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: reduced ? { duration: DUR.fast } : SPRING.snappy }}
              exit={{ opacity: 0, y: reduced ? 0 : 8, transition: { duration: DUR.fast, ease: EASE.exit } }}>
              <svg className="vx-flip" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
              <span>Undo · {undo.pill.label}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {onDone && (
        <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={async () => { await draft.commit(); onDone(); }}>Done</button>
      )}
    </div>
  );
}

/** "Saving… / Saved" under the title (aria-live), or the failure with Retry. */
function SaveStatus({ draft, live }: { draft: LookDraft; live: boolean }) {
  const text = draft.status === 'saving' ? 'Saving…' : draft.status === 'saved' ? 'Saved' : draft.status === 'error' ? 'Couldn’t save'
    : live ? 'Saves as you go · Telegram updates when you’re done' : 'Changes save as you go';
  return (
    <div className="vx-look-save" data-state={draft.status} aria-live="polite">
      <span key={text} className="vx-look-save-text">
        {draft.status === 'saved' && <Icon name="check" size={14} width={2.5} />}
        {text}
        {draft.status === 'error' && draft.error ? <span className="vx-look-save-why"> · {draft.error}</span> : null}
      </span>
      {draft.status === 'error' && (
        <button type="button" className="vx-btn vx-btn-xs vx-btn-tonal" onClick={() => { haptic.tap(); draft.retry(); }}>Retry</button>
      )}
    </div>
  );
}

function Panel({ cat, look, name, role, change, pickHue, reduced }: {
  cat: LookCategory; look: CharacterLook; name: string; role: string; reduced: boolean;
  change: (p: Change) => void; pickHue: (h: Hue, i: number) => void;
}) {
  const l = normalizeLook(look);
  const opt = <T extends string>(value: T, label: string, patch: Change, extra: Partial<RailOption<T>> = {}): RailOption<T> =>
    ({ value, label, look: applyPatch(l, patch), blocked: blockedBy(l, patch), ...extra });

  if (cat === 'species') {
    return (
      <>
        <OptionRail label="Species" name={name} options={SPECIES.map((s) => opt(s, SPECIES_LABEL[s], { species: s }))}
          isOn={(v) => v === l.species} onPick={(species) => change({ species })} />
        <OptionRail label="Body" name={name} options={FAMILY_IDS.map((f) => opt(f, FAMILY_LABEL[f], { family: f }))}
          isOn={(v) => v === l.family} onPick={(family) => change({ family })} note={<span className="vx-over">Body</span>} />
        <p className="vx-look-foot">Ears and snouts grow in on day 2.</p>
      </>
    );
  }
  if (cat === 'colour') {
    return (
      <>
        <SwatchGrid label="Colour" reduced={reduced} value={l.hue} onPick={pickHue}
          swatches={HUES.map((h) => ({ value: h, label: PALETTE[h].name, color: PALETTE[h].base, light: PALETTE[h].light, shadow: PALETTE[h].shadow }))} />
        <p className="vx-look-foot">{PALETTE[l.hue].name} tints {name}’s body, glow and profile.</p>
      </>
    );
  }
  if (cat === 'hair') {
    return (
      <>
        <OptionRail label="Hair" name={name} options={HAIR_STYLES.map((h) => opt(h, HAIR_LABEL[h], { hair: h }))}
          isOn={(v) => v === l.hair} onPick={(hair) => change({ hair })} />
        {l.hair !== 'none' && (
          <div className="vx-look-sub">
            <span className="vx-over">Hair colour</span>
            <SwatchGrid label="Hair colour" layout="row" reduced={reduced} value={l.hairTone!} onPick={(hairTone) => change({ hairTone })}
              swatches={TONE_OPTIONS.map((t) => ({ value: t, label: toneLabel(t), color: toneSwatch(t, l.hue) }))} />
          </div>
        )}
        <p className="vx-look-foot">{l.species === 'chick' ? 'A chick’s crest is its hair.' : 'Hair grows in on day 4.'}</p>
      </>
    );
  }
  if (cat === 'accessory') {
    const { order, suggested } = accessoryOrder(role);
    return (
      <>
        <OptionRail label="Accessory" name={name}
          options={order.map((a) => opt(a, ACCESSORY_LABEL[a], { accessory: a }, { suggested: suggested.has(a) }))}
          isOn={(v) => v === l.accessory} onPick={(accessory) => change({ accessory })}
          note={suggested.size > 0 && role ? <span className="vx-rail-suggest">✦ Suggested for {role}</span> : undefined} />
        {l.accessory !== 'none' && (
          <div className="vx-look-sub">
            <span className="vx-over">{ACCESSORY_LABEL[l.accessory!]} colour</span>
            <SwatchGrid label={`${ACCESSORY_LABEL[l.accessory!]} colour`} layout="row" reduced={reduced} value={l.accent!} onPick={(accent) => change({ accent })}
              swatches={ACCENT_OPTIONS.map((a) => ({ value: a, label: toneLabel(a), color: accentSwatch(a) }))} />
          </div>
        )}
        <p className="vx-look-foot">Accessories arrive on day 6, when {name} is fully formed.</p>
      </>
    );
  }
  return (
    <>
      <OptionRail label="Face" name={name} mode="check" zoom
        options={FEATURES.map((f) => ({ value: f, label: FEATURE_LABEL[f], look: applyPatch(l, { features: { ...l.features, [f]: true } }) }))}
        isOn={(f) => l.features[f]} onPick={(f) => change({ features: { ...l.features, [f]: !l.features[f] } })} />
      <p className="vx-look-foot">Cheeks, lashes and brows appear on day 4.</p>
    </>
  );
}

/** The Telegram photo in one row: what it is now, tap to change it. */
function PhotoRow({ agent, onOpen }: { agent: AgentView; onOpen: () => void }) {
  const a = agent.look;
  const sub = a.avatar ? (a.avatarStale ? 'Portrait · drawn from an older look' : 'Portrait') : `Character · grows with ${agent.persona.name}`;
  return (
    <button type="button" className="vx-row-btn vx-look-tg" onClick={() => { haptic.tap(); onOpen(); }}>
      <TelegramPhoto agent={agent} size={40} ring={agent.status === 'active'} />
      <span className="vx-row-main">
        <span className="vx-row-title">Telegram photo</span>
        <span className="vx-row-sub">{sub}</span>
      </span>
      <span className="vx-chev" aria-hidden="true"><Icon name="forward" size={18} flip={false} /></span>
    </button>
  );
}
