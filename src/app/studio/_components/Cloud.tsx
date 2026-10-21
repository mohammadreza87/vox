'use client';

import { animate, motion, motionValue, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import {
  BEAK_DROP, PALETTE, beakLowerD, beakMouth, characterModel, derivePalette, eyeD, eyeFor, lookKey, modelEye, mouthD, mouthFor, mouthOpenness, MOUTH, stageFor, stageGrowth, talkMouth,
  type Expression, type Lod, type MouthShape,
} from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { EASE, SPRING } from '../_lib/motion';
import { CharacterView, type RigBindings } from './character/CharacterView';
import * as M from './character/moments';
import { LISTEN, SHY, TALK } from './character/poses';
import {
  blinkOnce, morphEye, morphMouth, readEye, readMouth, useBlink, useEyeMV, useGaze, useGlance, useHeroSlot, useLipSync, useMouthMV, useOnScreen,
  useSyllableBounce, useTilt, useTwitch, wait,
} from './character/rig';
import { Particles, type BurstSpec, type ParticleKind } from './motion/Burst';
import { useTier } from './motion/tier';

export type { Expression };
export { PALETTE, stageFor };

/** squish = the tap reaction (squish + giggle); shy = the long-press reaction (blush grows), as scripted beats */
export type MomentKind = 'poof' | 'evolve' | 'born' | 'hop' | 'perk' | 'nod' | 'wince' | 'spin' | 'retire' | 'squish' | 'shy';
export interface CloudMoment { kind: MomentKind; key: string | number; fromStage?: Stage; fromLook?: CharacterLook }

export interface CloudProps {
  look: CharacterLook;
  size?: number;
  expr?: Expression;
  /** Forming stage 1–4: the face gains detail as the agent matures */
  stage?: Stage;
  label?: string;
  /** Default: size ≥ 140 hero · > 56 card · else icon */
  lod?: Lod;
  /** disc = hue .12 disc with the character at 86 % (≤ 56 px, Telegram-style) */
  variant?: 'free' | 'disc';
  /** Wraps in motion.div layoutId={`face-${heroId}`} */
  heroId?: string;
  /** 0..1 audio level: speaking lip-sync / listening scale */
  level?: MotionValue<number>;
  moment?: CloudMoment | null;
  onMomentEnd?: (k: MomentKind) => void;
  /** Aura opacity (default none: the minimal character has no glow; a value > 0 opts a surface into a soft CSS halo) */
  glow?: number;
  /** No idle loops (thumbnails) */
  still?: boolean;
  /** Hero faces answer touch (default on): a tap squishes and giggles, a long-press blushes */
  touch?: boolean;
}

export const lodFor = (size: number): Lod => (size >= 140 ? 'hero' : size > 56 ? 'card' : 'icon');

/** Ears that hang (sway with the breath) vs ears that stand (still, then twitch). */
const FLOPPY = new Set(['dog', 'bunny']);
const POINTY = new Set(['cat', 'bear', 'owl']);
const SHORT_HAIR = new Set(['tuft', 'curls', 'spiky']);
const GESTURES = new Set<MomentKind>(['hop', 'perk', 'nod', 'wince', 'spin']);

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** CSS `saturate(s)` (the filter spec's matrix) baked into a hex colour, so the live rig never runs a filter (D18). */
export const saturateHex = (hex: string, s: number): string => {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${ch((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b)}${
    ch((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b)}${
    ch((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b)}`;
};
/** A sleeper's colour (motion.css applies the same saturate as a static filter on still card/icon faces). */
const SLEEP_SATURATE = 0.6;

/**
 * Shared-element frame for hero flights (motion §3.3): the same `face-<id>` on the Home card, the
 * profile and the call lets the face fly between screens. The frame is stable; what it holds can
 * change. `data-hero` tells the navigator a flyable face is on screen.
 */
function HeroFrame({ heroId, children }: { heroId?: string; children: ReactNode }) {
  if (!heroId) return <>{children}</>;
  return (
    <motion.div layoutId={`face-${heroId}`} data-hero={`face-${heroId}`} transition={{ layout: SPRING.hero }} style={{ display: 'inline-flex', position: 'relative' }}>
      {children}
    </motion.div>
  );
}

/**
 * The live character (vector, so it can move and talk). Composes the HTML wrapper (gestures, breathe,
 * CSS aura) around CharacterView and drives its rig: random blinks, gaze, morphing expressions,
 * lip-sync, look-change choreography and moments. `still` renders a static pose with no rig.
 */
export function Cloud({ variant = 'free', heroId, ...p }: CloudProps) {
  const size = p.size ?? 120;
  const disc = variant === 'disc';
  const inner = disc ? Math.round(size * 0.86) : size;
  const body = p.still
    ? <CharacterView look={p.look} stage={p.stage ?? 4} expr={p.expr ?? 'idle'} size={inner} lod={p.lod ?? lodFor(inner)} label={p.label ?? 'Agent'} fit={disc ? 'circle' : undefined} />
    : <Rig {...p} size={inner} fit={disc ? 'circle' : undefined} />;
  const pal = PALETTE[p.look.hue] ?? PALETTE.lilac;
  return (
    <HeroFrame heroId={heroId}>
      {disc
        ? <span className="vx-avatar disc" style={{ width: size, height: size, '--hue-12': rgba(pal.base, 0.12) } as CSSProperties}>{body}</span>
        : body}
    </HeroFrame>
  );
}

/** Every in-app identity is the vector character (D1): it blinks, talks and grows. `preferCloud` is kept for old callers. */
export function AgentFace(p: CloudProps & { preferCloud?: boolean }) {
  return <Cloud {...p} />;
}

type RigProps = Omit<CloudProps, 'variant' | 'heroId' | 'still'> & { size: number; fit?: 'circle' };

/** One MotionValue per rig part, created once. */
function useParts(): M.RigParts {
  const ref = useRef<M.RigParts | null>(null);
  if (!ref.current) {
    const mv = (v: number) => motionValue(v);
    ref.current = {
      lid: mv(1), counterY: mv(0), tilt: mv(0), gy: mv(0),
      hairS: mv(1), hairSY: mv(1), hairY: mv(0), hairO: mv(1),
      earS: [mv(1), mv(1)], earR: [mv(0), mv(0)],
      accY: mv(0), accO: mv(1), accSY: mv(1),
      fxO: mv(1), fxY: mv(0), auraO: mv(0), auraS: mv(1),
      shyO: mv(0), shyS: mv(1), gx: mv(0),
    };
  }
  return ref.current;
}
function Rig({ look, size, expr = 'idle', stage = 4, label = 'Agent', lod: lodProp, level, moment, onMomentEnd, glow, fit, touch = true }: RigProps) {
  const tier = useTier();
  const reduced = tier === 'reduced', full = tier === 'full';
  const want = lodProp ?? lodFor(size);
  const slot = useHeroSlot(want === 'hero');
  const mode: Lod = want === 'hero' && !slot ? 'card' : want;
  const hero = mode === 'hero';
  const k = size / 200;
  const choreo = hero && !reduced;

  const scope = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(scope);
  const parts = useParts();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  /* ---- what is on screen: choreography swaps the look at its low point; moments override ---- */
  const [shown, setShownState] = useState(look);
  const shownRef = useRef(look);
  const setShown = useCallback((l: CharacterLook) => { shownRef.current = l; setShownState(l); }, []);
  const [held, setHeld] = useState<CharacterLook | null>(null);
  // a stage-up or birth starts from its first frame, never one painted frame at the new stage
  const [stageOv, setStageOv] = useState<Stage | null>(() => (reduced ? null : moment?.kind === 'evolve' ? moment.fromStage ?? (Math.max(1, stage - 1) as Stage) : moment?.kind === 'born' ? 4 : null));
  const [exprOv, setExprOv] = useState<Expression | null>(null);
  const display = held ?? (choreo ? shown : look);
  const st = stageOv ?? stage;

  /* ---- happy is a one-shot (motion §4.4): a hop, a content hold, then idle; a look change replays it ---- */
  const lk = lookKey(look);
  const [calm, setCalm] = useState(false);
  const [joy, setJoy] = useState(0);
  useEffect(() => {
    setCalm(false);
    if (expr !== 'happy' || reduced) return;
    const t = setTimeout(() => setCalm(true), 2200);
    return () => clearTimeout(t);
  }, [expr, joy, reduced]);
  const exprRef = useRef(expr);
  exprRef.current = expr;
  const base = exprOv ?? expr;
  const dExpr: Expression = base === 'happy' && calm && !exprOv ? 'idle' : base;

  /* ---- face anchors (hero only: cards and icons swap poses instead of morphing) ---- */
  const lodSize = mode === 'icon' ? Math.min(size, 56) : size;
  const dKey = lookKey(display);
  // built as soon as the hero LOD is wanted (before the slot lands), so the first frame already has the species' eyes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const anchors = useMemo(() => (want === 'hero' ? characterModel(display, { uid: 'rig', mode: 'live', stage: st, expr: 'idle', size: lodSize }) : null), [want, dKey, st, lodSize]);
  const model = hero ? anchors : null;
  const s4 = Math.min(st, 4) as Stage;
  const eyeTarget = anchors ? modelEye(anchors, eyeFor(dExpr, s4)) : eyeFor(dExpr, s4);
  const mouthTarget = mouthFor(dExpr, s4);
  const eye = useEyeMV(eyeTarget);
  const mouth = useMouthMV(mouthTarget);
  const open = useMotionValue(0);
  const gx = parts.gx;
  const speaking = dExpr === 'speaking' && st >= 2 && !reduced && hero;

  const beak = model?.face.mouthKind === 'beak';
  // read every motion value before any early return: the computed transform subscribes to what its first run reads
  const mouthPath = useTransform(() => {
    const o = open.get(), rest = readMouth(mouth);
    if (!model) return '';
    const s: MouthShape = speaking ? talkMouth(st === 2 ? o * 0.7 : o) : rest;
    const m = beak ? beakMouth(s) : s;
    return mouthD(model.face.mouth.x, model.face.mouth.y, m);
  });
  // a beak talks by dropping its lower mandible with the same mouth shape (one mouth: the beak is the mouth)
  const beakPath = useTransform(() => {
    const o = open.get(), rest = readMouth(mouth), bk = model?.face.beak;
    if (!bk) return '';
    const s: MouthShape = speaking ? talkMouth(st === 2 ? o * 0.7 : o) : rest;
    return beakLowerD(bk.x, bk.top, bk.k, Math.round(mouthOpenness(s) * BEAK_DROP * bk.k * 10) / 10);
  });
  const eyePath = (i: 0 | 1) => () => { const e = readEye(eye); return model ? eyeD(model.face.eyes[i].cx, model.face.eyes[i].cy, e) : ''; };
  const eyeLD = useTransform(eyePath(0));
  const eyeRD = useTransform(eyePath(1));

  /* ---- expression morph (220 ms; sleep is slow and yawns first) ---- */
  const firstMorph = useRef(true);
  const morphDur = useRef<number | null>(null);
  const prevExpr = useRef(dExpr);
  const morphKey = `${dExpr}|${s4}|${model?.face.eyeScale ?? 0}|${hero}`;
  useLayoutEffect(() => {
    const from = prevExpr.current;
    prevExpr.current = dExpr;
    if (!hero) { firstMorph.current = true; return; }
    const instant = firstMorph.current || reduced;
    firstMorph.current = false;
    const duration = morphDur.current ?? (dExpr === 'sleeping' ? 0.4 : 0.22);
    morphDur.current = null;
    morphEye(eye, eyeTarget, { instant, duration });
    if (!instant && dExpr === 'sleeping' && from !== 'sleeping' && st >= 3) {
      morphMouth(mouth, MOUTH.yawn, { duration: 0.4 });
      const t = setTimeout(() => morphMouth(mouth, mouthTarget, { duration: 0.4 }), 520);
      return () => clearTimeout(t);
    }
    morphMouth(mouth, mouthTarget, { instant, duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morphKey, reduced]);

  /* ---- growth: a stage change grows (or exhales) the body out of the old silhouette ---- */
  // the body path tweens (one rig structure for every stage and family) while `grow` springs the stage
  // scale from the old size, so the shoulders visibly grow out instead of swapping
  const grow = useMotionValue(1);
  const bodyMV = useMotionValue(anchors?.bodyD ?? '');
  const growDur = useRef<number | null>(null);
  const prevBody = useRef({ st: s4, d: anchors?.bodyD ?? '' });
  useLayoutEffect(() => {
    const d = anchors?.bodyD;
    if (!d) return;
    const prev = prevBody.current;
    prevBody.current = { st: s4, d };
    const staged = prev.st !== s4;
    const dur = growDur.current;
    if (staged) growDur.current = null;
    if (prev.d === d && !staged) return;
    bodyMV.stop(); grow.stop();
    if (reduced || !hero || !prev.d || (staged && dur === 0)) { bodyMV.set(d); grow.set(1); return; }
    if (!staged) { void animate(bodyMV, d, { duration: 0.2, ease: EASE.standard }); return; }
    const r = stageGrowth(prev.st) / stageGrowth(s4);
    grow.set(grow.get() * r);
    const t = dur ?? 0.45;
    // growing overshoots a little (a puff); shrinking exhales without a bounce
    void animate(grow, 1, { type: 'spring', visualDuration: t, bounce: r < 1 ? 0.38 : 0.05 });
    void animate(bodyMV, d, { duration: t, ease: EASE.enter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors?.bodyD, s4]);

  /* ---- touch (hero): tap = squish + giggle, long-press = shy blush ---- */
  const [shyHeld, setShyHeld] = useState(false);
  /** the timeline generation a touch reaction owns (gestures stay quiet while it plays) */
  const reactGen = useRef(-1);

  /* ---- idle life ---- */
  const momentBusy = useRef(false);
  const blinkOn = !reduced && st >= 2 && dExpr !== 'happy' && dExpr !== 'sleeping';
  const slowFace = st === 2;
  const every: [number, number] = mode === 'icon' ? [6, 12] : slowFace ? [4, 8] : [2.6, 6.2];
  const stretch = mode === 'card' ? 1.4 : 1;
  useBlink(parts.lid, {
    on: blinkOn, every: [every[0] * stretch, every[1] * stretch], visible: onScreen,
    doubles: hero ? (st >= 4 ? 0.15 : 0.08) : 0, slow: slowFace ? 0.25 : 0,
  });
  const species = display.species ?? 'cloud';
  const calmFace = dExpr === 'idle' || dExpr === 'listening';
  useGaze(gx, parts.gy, parts.lid, hero && full && st >= 3 && calmFace && !shyHeld, onScreen);
  useGlance(gx, hero && full && st >= 3 && dExpr === 'thinking', onScreen);
  useTilt(parts.tilt, hero && full && st >= 4 && dExpr === 'idle' && !shyHeld, onScreen);
  useTwitch(parts.earR, hero && full && st >= 2 && POINTY.has(species) && calmFace, onScreen);
  useLipSync(level, speaking, open, tier === 'lite');
  const bump = useMotionValue(0);
  useSyllableBounce(open, bump, speaking, TALK);

  /* ---- listening: the body leans in (a touch bigger) and swells a little more with your voice ---- */
  const attending = hero && !reduced && dExpr === 'listening';
  const attend = useSpring(0, { stiffness: 260, damping: 24 });
  useEffect(() => { if (reduced) attend.jump(0); else attend.set(attending ? 1 : 0); }, [attending, reduced, attend]);
  const heard = useSpring(0, { stiffness: 400, damping: 20 });
  useEffect(() => {
    if (!level || dExpr !== 'listening' || reduced) { heard.set(0); return; }
    return level.on('change', (v) => heard.set(v));
  }, [level, dExpr, reduced, heard]);
  const swell = useTransform(() => 1 + heard.get() * LISTEN.levelSwell);
  // talking is lively: every syllable lifts the body a little and stretches it from the ground (squash on the
  // close), and each syllable onset adds a small bounce; the stage growth and the listening lean ride along
  const bob = useTransform(() => -(TALK.lift * open.get() + TALK.bounceLift * bump.get()) * k);
  const talkY = useTransform(() => grow.get() * swell.get() * (1 + TALK.stretch * open.get() + TALK.bounceStretch * bump.get()) * (1 + (LISTEN.sy - 1) * attend.get()));
  const talkX = useTransform(() => grow.get() * swell.get() * (1 - TALK.narrow * open.get()) * (1 + (LISTEN.sx - 1) * attend.get()));

  /* ---- aura: off by default (STYLE: no glow); a surface may opt in to a soft CSS radial ---- */
  const auraRest = glow ?? 0;
  const auraTarget = dExpr === 'listening' ? Math.min(1, auraRest * 1.6) : auraRest;
  const firstAura = useRef(true);
  useLayoutEffect(() => {
    if (firstAura.current || reduced || !hero) { parts.auraO.set(auraTarget); firstAura.current = false; return; }
    void animate(parts.auraO, auraTarget, SPRING.gentle);
  }, [auraTarget, reduced, hero, parts.auraO]);
  const auraOpacity = useTransform(() => parts.auraO.get() * (1 + 0.55 * open.get()));
  // The body's stage growth, so the CSS aura hugs the character at every stage.
  const growth = stageGrowth(s4);
  const auraScale = useTransform(() => parts.auraS.get() * growth);

  /* ---- hue tween through the body stops (300 ms; retire takes 1.2 s); a hero sleeper fades to its desaturated stops ---- */
  const derived = derivePalette(display.hue, s4);
  const pal = hero && dExpr === 'sleeping'
    ? { base: saturateHex(derived.base, SLEEP_SATURATE), light: saturateHex(derived.light, SLEEP_SATURATE), shadow: saturateHex(derived.shadow, SLEEP_SATURATE), deep: saturateHex(derived.deep, SLEEP_SATURATE) }
    : derived;
  const stops = { base: useMotionValue(pal.base), light: useMotionValue(pal.light), shadow: useMotionValue(pal.shadow), deep: useMotionValue(pal.deep) };
  const tweenDur = useRef<number | null>(null);
  const firstStops = useRef(true);
  useLayoutEffect(() => {
    const d = tweenDur.current ?? 0.3;
    tweenDur.current = null;
    const instant = firstStops.current || reduced || !hero || d === 0;
    firstStops.current = false;
    for (const key of ['base', 'light', 'shadow', 'deep'] as const) {
      if (instant) { stops[key].stop(); stops[key].set(pal[key]); } else void animate(stops[key], pal[key], { duration: d, ease: EASE.standard });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pal.base, pal.light, pal.shadow, pal.deep]);

  /* ---- rig bindings: full rig at hero, blink-only lids for cards and icons ---- */
  const glasses = display.accessory === 'glasses' || display.accessory === 'specs';
  const faceY = useTransform(() => parts.gy.get() + parts.counterY.get() + LISTEN.faceLift * attend.get());
  const accX = useTransform(() => (glasses ? gx.get() : 0));
  const accY = useTransform(() => (glasses ? parts.gy.get() + parts.counterY.get() : 0) + parts.accY.get());
  const rig = useMemo<RigBindings>(() => {
    const lids = { scaleY: parts.lid };
    if (!hero) return { lids };
    return {
      lids, eyeLD, eyeRD, mouthD: mouthPath, beakD: beakPath, bodyD: bodyMV,
      blush: { opacity: parts.shyO, scale: parts.shyS },
      layer: {
        face: { x: gx, y: faceY, rotate: parts.tilt },
        hair: { scale: parts.hairS, scaleY: parts.hairSY, y: parts.hairY, opacity: parts.hairO },
        'acc-rigid': { x: accX, y: accY, opacity: parts.accO },
        'acc-soft': { y: parts.accY, scaleY: parts.accSY, opacity: parts.accO },
        fx: { y: parts.fxY, opacity: parts.fxO },
      },
      earL: { scale: parts.earS[0], rotate: parts.earR[0] },
      earR: { scale: parts.earS[1], rotate: parts.earR[1] },
      tail: { scale: parts.earS[1] },
      stops,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero]);

  /* ---- particles, sheen, wag ---- */
  const [bursts, setBursts] = useState<BurstSpec[]>([]);
  const burstSeq = useRef(0);
  const [sheen, setSheen] = useState(0);
  const lite = tier === 'lite';
  const center: [number, number] = [size / 2, size * 0.56];
  const wagT = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(wagT.current), []);
  const ctxRef = useRef<() => Omit<M.RigCtx, 'alive'>>(null!);
  ctxRef.current = () => ({
    el: () => scope.current, parts, k, reduced, lite, aura: auraRest,
    palette: () => derivePalette(display.hue, s4),
    setExpr: setExprOv, setStage: setStageOv, setLook: setShown, holdLook: setHeld,
    tweenFor: (d) => { tweenDur.current = d; }, morphFor: (d) => { morphDur.current = d; }, growFor: (d) => { growDur.current = d; },
    burst: (kind: ParticleKind, at?: [number, number]) => {
      if (reduced) return;
      const pl = derivePalette(display.hue, s4);
      const origin = at ?? (kind === 'puffs' && model ? [model.pivots.hair[0] * k, model.pivots.hair[1] * k] : center);
      setBursts((b) => [...b, { id: ++burstSeq.current, kind, at: origin, k: Math.max(0.45, k), light: pl.light, base: pl.base, lite }]);
    },
    sheen: () => setSheen((n) => n + 1),
    wag: (ms) => {
      const el = scope.current; if (!el) return;
      clearTimeout(wagT.current);
      el.setAttribute('data-wag', '');
      wagT.current = setTimeout(() => el.removeAttribute('data-wag'), ms);
    },
  });
  const timeline = useRef(0);
  // a look change in flight leaves the wrapper mid-squash; whatever retires it springs the wrapper home
  const lookRun = useRef(false);
  const begin = useCallback((): M.RigCtx => {
    const gen = ++timeline.current;
    const c = ctxRef.current();
    if (lookRun.current) { lookRun.current = false; M.settle(scope.current, c.reduced); }
    return { ...c, alive: () => mounted.current && timeline.current === gen };
  }, []);

  /* ---- expression gestures (hero): perk to listen, nod to speak, hop for joy, wake from sleep ---- */
  const lastExpr = useRef(dExpr);
  useEffect(() => {
    const from = lastExpr.current;
    lastExpr.current = dExpr;
    if (from === dExpr || !hero || reduced || momentBusy.current || reactGen.current === timeline.current) return;
    const c = { ...ctxRef.current(), alive: () => mounted.current };
    const ears = FLOPPY.has(species) || POINTY.has(species);
    if (dExpr === 'listening') {
      void M.play(c, 'perk');
      if (ears) parts.earS.forEach((s) => void animate(s, 1.06, SPRING.jelly));
    } else if (from === 'listening' && ears) parts.earS.forEach((s) => void animate(s, 1, SPRING.gentle));
    if (dExpr === 'thinking' || dExpr === 'sleeping') {
      parts.fxO.set(0); parts.fxY.set(6);
      void animate(parts.fxO, 1, { duration: 0.32, ease: EASE.enter, delay: 0.12 });
      void animate(parts.fxY, 0, { ...SPRING.gentle, delay: 0.12 });
    }
    if (dExpr === 'thinking' && full) void animate(parts.tilt, -4, SPRING.gentle);
    else if (from === 'thinking') void animate(parts.tilt, 0, SPRING.gentle);
    if (dExpr === 'speaking' && from === 'thinking') void M.play(c, 'nod');
    if (dExpr === 'happy') {
      void M.play(c, 'hop');
      c.burst('sparkle', [size / 2, size * 0.42]);
      if (species === 'cat' || FLOPPY.has(species)) c.wag(1600);
    }
    if (from === 'sleeping' && dExpr !== 'sleeping') {
      void blinkOnce(parts.lid).then(() => wait(90)).then(() => blinkOnce(parts.lid)).then(() => M.play(c, 'perk'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dExpr]);

  /* ---- look-change choreography (hero; D11): squash-swap-stretch, never a remount ---- */
  const wasChoreo = useRef(choreo);
  useEffect(() => {
    const was = wasChoreo.current;
    wasChoreo.current = choreo;
    const from = shownRef.current;
    if (lookKey(from) === lk) return;
    if (!choreo) { shownRef.current = look; if (exprRef.current === 'happy') setJoy((n) => n + 1); return; }
    if (!was || momentBusy.current) { setShown(look); return; }
    const c = begin();
    lookRun.current = true;
    M.partsAtRest(parts);
    const d = M.diffLook(from, look);
    void M.changeLook(c, from, look, d, s4).finally(() => {
      if (!c.alive()) return;
      lookRun.current = false;
      M.partsAtRest(parts);
      if (exprRef.current === 'happy') setJoy((n) => n + 1);   // the change lands, then a happy beat
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lk, choreo]);

  /* ---- moments ---- */
  const end = useRef(onMomentEnd);
  end.current = onMomentEnd;
  const skip = useRef<null | (() => void)>(null);
  const mKey = moment ? `${moment.kind}:${moment.key}` : null;
  useLayoutEffect(() => {
    if (!moment) {
      if (held || stageOv !== null || exprOv !== null) { timeline.current++; setHeld(null); setStageOv(null); setExprOv(null); M.partsAtRest(parts); M.rest(scope.current); }
      return;
    }
    const c = begin();
    const kind = moment.kind;
    const el = scope.current;
    momentBusy.current = true;
    const run =
      kind === 'poof' ? M.poof(c)
        : kind === 'evolve' ? M.evolve(c, moment.fromStage ?? (Math.max(1, stage - 1) as Stage), stage)
          : kind === 'born' ? M.born(c, stage)
            : kind === 'retire' ? M.retire(c, moment.fromLook ?? look)
              : kind === 'squish' ? M.squish(c)
                : kind === 'shy' ? M.shy(c)
                  : GESTURES.has(kind) ? M.play(c, kind as M.Gesture) : Promise.resolve();
    const finish = () => {
      skip.current = null;
      momentBusy.current = false;
      if (kind !== 'retire') { setStageOv(null); setExprOv(null); M.partsAtRest(parts); }
      end.current?.(kind);
    };
    if (kind === 'evolve') skip.current = () => { timeline.current++; M.rest(scope.current); finish(); };
    void run.finally(() => { if (c.alive()) finish(); });
    // bumping the live counter (not a copy) is the point: it retires whatever timeline is running now,
    // and a moment cut short (cleared or replaced) never leaves the character hidden or squashed
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      timeline.current++;
      skip.current = null;
      if (!momentBusy.current) return;
      momentBusy.current = false;
      M.partsAtRest(parts); M.rest(el);
      setExprOv(null); setStageOv(null); setHeld(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mKey]);

  /* ---- touch reactions ---- */
  const touchOn = hero && !reduced && touch;
  const press = useRef<{ long: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const free = () => !momentBusy.current && !lookRun.current;
  const tap = () => {
    const c = begin();
    const gen = timeline.current;
    reactGen.current = gen;
    void M.squish(c).finally(() => { if (reactGen.current === gen) reactGen.current = -1; });
  };
  // the shy pose starts after the gaze and tilt loops have switched off (effects run in order), and its
  // cleanup is the release: the blush fades, everything springs home
  useEffect(() => {
    if (!shyHeld) return;
    const c = begin();
    const gen = timeline.current;
    reactGen.current = gen;
    M.shyIn(c);
    return () => { void M.shyOut(c).finally(() => { if (reactGen.current === gen) reactGen.current = -1; }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shyHeld]);
  const release = (tapped: boolean) => {
    const pr = press.current;
    press.current = null;
    if (!pr) return;
    clearTimeout(pr.timer);
    if (pr.long) setShyHeld(false);
    else if (tapped && free()) tap();
  };
  useEffect(() => () => clearTimeout(press.current?.timer), []);
  useEffect(() => { if (!touchOn) { clearTimeout(press.current?.timer); press.current = null; setShyHeld(false); } }, [touchOn]);
  const onPointerDown = (e: PointerEvent) => {
    if (skip.current) { skip.current(); return; }
    if (!touchOn || e.button > 0 || !free()) return;
    clearTimeout(press.current?.timer);
    const pr: { long: boolean; timer?: ReturnType<typeof setTimeout> } = { long: false };
    pr.timer = setTimeout(() => { if (!free()) return; pr.long = true; setShyHeld(true); }, SHY.holdMs);
    press.current = pr;
  };

  /* ---- render ---- */
  const loop = !reduced && mode !== 'icon';
  const sway = hero && full && st >= 3;
  const hairShort = SHORT_HAIR.has(display.hair ?? 'none');
  const auraOn = auraRest > 0;
  const glowColor = (PALETTE[display.hue] ?? PALETTE.lilac).glow;
  return (
    <div ref={scope} className="vx-char" data-lod={mode} data-stage={st} data-expr={dExpr}
      data-loop={loop || undefined} data-sway={sway || undefined} data-pulse={(hero && full) || undefined}
      data-ears={FLOPPY.has(species) ? 'floppy' : undefined} data-touch={touchOn || undefined}
      onPointerDown={onPointerDown} onPointerUp={() => release(true)} onPointerCancel={() => release(false)} onPointerLeave={() => release(false)}
      onContextMenu={touchOn ? (e) => e.preventDefault() : undefined}
      style={{
        width: size, height: size, '--k': k,
        '--hair-sway': hairShort ? '2.5deg' : '1.5deg', '--hair-lag': hairShort ? '.18s' : '.24s',
      } as CSSProperties}>
      {auraOn && (
        <motion.span className="vx-char-aura" aria-hidden="true" style={{ opacity: auraOpacity, scale: auraScale }}>
          <span style={{ background: `radial-gradient(closest-side, ${glowColor}, ${rgba(glowColor, 0)})` }} />
        </motion.span>
      )}
      <motion.div className="vx-char-bob" style={{ y: bob, scaleX: talkX, scaleY: talkY, originX: 0.5, originY: 0.83 }}>
        <div className="vx-char-breathe">
          <CharacterView look={display} stage={st} expr={dExpr} size={size} lod={mode} label={label} rig={rig} fit={fit} />
        </div>
      </motion.div>
      {sheen > 0 && (
        <span className="vx-char-sheen" aria-hidden="true">
          <motion.span key={sheen} initial={{ x: '-130%' }} animate={{ x: '130%' }} transition={{ duration: 0.42, ease: EASE.standard }} />
        </span>
      )}
      <Particles bursts={bursts} onDone={(id) => setBursts((b) => b.filter((x) => x.id !== id))} />
    </div>
  );
}
