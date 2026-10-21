/**
 * Vox Studio motion tokens.
 * Single source for framer-motion springs/eases/durations; mirrored as CSS vars in motion.css.
 * Springs use framer's designer params (visualDuration + bounce); k/c noted for reference.
 */
import type { Transition, Variants } from 'framer-motion';

/* ---------- durations (seconds; CSS mirror in ms) ---------- */
export const DUR = {
  instant: 0.09, // press-in, hover tints
  fast: 0.14, // exits, toggles' colour, chip fill
  base: 0.22, // standard enter/fade, expression morph
  medium: 0.32, // list item enter, toast enter
  slow: 0.48, // emphasised reveals (avatar mask, check draw + ring)
  slower: 0.64, // character poof total ≈ 0.9 incl. settle
} as const;

/* ---------- easings (cubic-bezier) ---------- */
export const EASE = {
  standard: [0.2, 0, 0, 1], // M3 standard: on-screen moves, colour, morphs
  enter: [0.05, 0.7, 0.1, 1], // M3 emphasised-decelerate: things arriving
  exit: [0.3, 0, 0.8, 0.15], // M3 emphasised-accelerate: things leaving (keep ≤ 160ms)
  over: [0.34, 1.56, 0.64, 1], // overshoot for small pops when a spring is overkill
  sine: [0.37, 0, 0.63, 1], // idle loops (breathe, sway, bob)
} as const satisfies Record<string, [number, number, number, number]>;

/* ---------- springs ---------- */
// t90 = time to 90 %, settle = to rest. Values measured with motion-dom 12.23.
export const SPRING = {
  press: { type: 'spring', visualDuration: 0.16, bounce: 0.35 }, // k1071 c42.5 · t90 76ms · +6.8 % · release of pressed things
  snappy: { type: 'spring', visualDuration: 0.2, bounce: 0.15 }, // k685 c44.5 · t90 122ms · chips, toggles, tab pill, segmented
  page: { type: 'spring', visualDuration: 0.32, bounce: 0 }, // k268 c32.7 · t90 238ms · settle 456ms · push/pop
  cover: { type: 'spring', visualDuration: 0.4, bounce: 0.02 }, // k171 c25.7 · t90 290ms · full-screen covers (spawn, fire)
  sheet: { type: 'spring', visualDuration: 0.34, bounce: 0.1 }, // k237 c27.7 · t90 222ms · bottom sheets (keeps drag velocity)
  hero: { type: 'spring', visualDuration: 0.46, bounce: 0.14 }, // k130 c19.6 · t90 284ms · +0.5 % · shared-element flights
  pop: { type: 'spring', visualDuration: 0.38, bounce: 0.45 }, // k190 c15.2 · +12.6 % · badges, checks, poof body, unlocks
  jelly: { type: 'spring', visualDuration: 0.5, bounce: 0.55 }, // k110 c9.4 · +20 % · hair/ears/tails follow-through ONLY
  gentle: { type: 'spring', visualDuration: 0.55, bounce: 0 }, // k91 c19 · tickers, glow, progress
} as const satisfies Record<string, Transition>;

/* ---------- distance scale (px) ---------- */
export const DIST = { xs: 4, s: 8, m: 12, l: 24, xl: 48, parallax: '-28%', push: '100%' } as const;

/* ---------- stagger ---------- */
export const STAGGER = { step: 0.03, max: 0.24, grid: 0.035 } as const;
/** Linear list: 30 ms/item, capped so item 9+ arrive together (≤ 240 ms). */
export const stagger = (i: number) => Math.min(i * STAGGER.step, STAGGER.max);
/** 2-col grid: diagonal wave by row+col. */
export const gridStagger = (i: number, cols = 2) => Math.min((Math.floor(i / cols) + (i % cols)) * STAGGER.grid, STAGGER.max);

/* ---------- reusable transitions ---------- */
export const T = {
  fadeIn: { duration: DUR.base, ease: EASE.enter },
  fadeOut: { duration: DUR.fast, ease: EASE.exit },
  morph: { duration: DUR.base, ease: EASE.standard },
  listItem: (i: number) => ({ ...SPRING.page, delay: stagger(i), opacity: { duration: DUR.medium, ease: EASE.enter, delay: stagger(i) } }),
} as const;

/* ---------- screen transitions ---------- */
export type NavKind = 'push' | 'pop' | 'hero' | 'hero-pop' | 'cover' | 'uncover' | 'tab' | 'replace';
export interface NavCtx { kind: NavKind; delta: number; rtl: boolean; reduced: boolean }

/** Routes that arrive as a full-screen cover (iOS card stack) instead of a push. */
export const COVER_ROUTES: ReadonlySet<string> = new Set(['spawn', 'fire']);
/** from>to pairs whose screens both render the agent's face (`layoutId face-<id>`), so the face can fly. */
export const HERO_PAIRS: ReadonlySet<string> = new Set(['home>agent', 'agent>call', 'spawn>agent']);
/** Tab order, start to end; tab switches slide along it. */
export const TAB_ROUTES: readonly string[] = ['home', 'groups', 'org', 'privacy'];

interface NavRoute { name: string }
export interface KindOpts {
  /** push/reset: the source face is on screen and the target agent is cached. back: the screen was entered as a hero. */
  hero?: boolean;
  /** reset only: stack depth before and after */
  fromDepth?: number; toDepth?: number;
}

/** Which transition a navigation plays (motion §3.1). `from`/`to` are the top routes before and after. */
export function kindFor(op: 'push' | 'back' | 'reset', from: NavRoute, to: NavRoute, o: KindOpts = {}): { kind: NavKind; delta: number } {
  if (op === 'push') {
    if (COVER_ROUTES.has(to.name)) return { kind: 'cover', delta: 1 };
    if (o.hero && HERO_PAIRS.has(`${from.name}>${to.name}`)) return { kind: 'hero', delta: 1 };
    return { kind: 'push', delta: 1 };
  }
  if (op === 'back') {
    if (COVER_ROUTES.has(from.name)) return { kind: 'uncover', delta: -1 };
    if (o.hero && HERO_PAIRS.has(`${to.name}>${from.name}`)) return { kind: 'hero-pop', delta: -1 };
    return { kind: 'pop', delta: -1 };
  }
  const a = TAB_ROUTES.indexOf(from.name), b = TAB_ROUTES.indexOf(to.name);
  if (o.fromDepth === 1 && o.toDepth === 1 && a >= 0 && b >= 0) return { kind: a === b ? 'replace' : 'tab', delta: Math.sign(b - a) };
  // Leaving a cover for a fresh stack (hire → agent, fire → home): the card drops away, or the face flies.
  if (COVER_ROUTES.has(from.name) && !COVER_ROUTES.has(to.name)) {
    return o.hero && HERO_PAIRS.has(`${from.name}>${to.name}`) ? { kind: 'hero', delta: 1 } : { kind: 'uncover', delta: -1 };
  }
  return { kind: 'replace', delta: 0 };
}

const sx = (c: NavCtx) => (c.rtl ? -1 : 1);
const REDUCED = { duration: 0.15, ease: EASE.standard } as const;
/** Covers read as a sheet becoming a screen: rounded top while moving, square at rest. */
const ROUND = { borderTopLeftRadius: 28, borderTopRightRadius: 28 } as const;
const SNAP = { borderTopLeftRadius: { duration: 0 }, borderTopRightRadius: { duration: 0 } } as const;

const enterTransition = (c: NavCtx): Transition =>
  c.reduced ? REDUCED
    : c.kind === 'tab' ? { opacity: { duration: 0.21, delay: 0.09, ease: EASE.enter }, x: { ...SPRING.page, delay: 0.09 } }
    : c.kind === 'cover' || c.kind === 'uncover' ? SPRING.cover
    : c.kind === 'hero' ? { duration: 0 }
    : c.kind === 'hero-pop' ? SPRING.hero
    : c.kind === 'replace' ? { duration: DUR.medium, ease: EASE.enter }
    : SPRING.page;

/**
 * Screen variants. Transform + opacity only: the push edge shadow is a static CSS pseudo-element
 * (`.vx-screen[data-layer=page]::before`), never an animated box-shadow. z-index is released at rest
 * so sheets inside a screen still stack above the overlay tab bar.
 */
export const screenVariants: Variants = {
  initial: (c: NavCtx) => {
    if (c.reduced) return { opacity: 0 };
    switch (c.kind) {
      case 'push': return { x: `${100 * sx(c)}%`, opacity: 1, zIndex: 2 };
      case 'pop': return { x: `${-28 * sx(c)}%`, opacity: 0.5, zIndex: 1 };
      case 'cover': return { y: '100%', zIndex: 3, ...ROUND };
      case 'uncover': return { scale: 0.94, opacity: 0.5, zIndex: 1 };
      // the flying face lives in the arriving screen, so that screen stays opaque: its ground and
      // content arrive through CSS (`.vx-screen[data-arrive=hero]`) while the face is in the air
      case 'hero': return { opacity: 1, zIndex: 2 };
      case 'hero-pop': return { opacity: 1, scale: 0.98, zIndex: 1 };
      case 'tab': return { opacity: 0, x: DIST.l * c.delta * sx(c) };
      case 'replace': return { opacity: 0, scale: 1.02 };
    }
  },
  enter: (c: NavCtx) => ({
    x: 0, y: 0, scale: 1, opacity: 1,
    transition: enterTransition(c),
    transitionEnd: { zIndex: 'auto', borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  }),
  exit: (c: NavCtx) => {
    if (c.reduced) return { opacity: 0, transition: REDUCED };
    switch (c.kind) {
      case 'push': return { x: `${-28 * sx(c)}%`, opacity: 0.5, zIndex: 1, transition: SPRING.page };
      case 'pop': return { x: `${100 * sx(c)}%`, zIndex: 2, transition: SPRING.page };
      case 'cover': return { scale: 0.94, opacity: 0.5, zIndex: 1, transition: SPRING.cover };
      case 'uncover': return { y: '100%', zIndex: 3, ...ROUND, transition: { ...SPRING.cover, ...SNAP } };
      case 'hero': return { opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: EASE.exit } };
      case 'hero-pop': return { opacity: 0, zIndex: 2, transition: { duration: 0.16, ease: EASE.exit } };
      case 'tab': return { opacity: 0, transition: { duration: DUR.instant, ease: EASE.exit } };
      case 'replace': return { opacity: 0, scale: 0.98, transition: { duration: DUR.fast, ease: EASE.exit } };
    }
  },
};

/**
 * The overlay tab bar belongs to the root screen: on push it parallaxes away *under* the incoming
 * screen (iOS hidesBottomBarWhenPushed), on pop it returns with the root. Tab switches keep it mounted.
 */
export const barVariants: Variants = {
  initial: (c: NavCtx) => {
    if (c.reduced) return { opacity: 0 };
    switch (c.kind) {
      case 'pop': return { x: `${-28 * sx(c)}%`, opacity: 0.5, zIndex: 1 };
      case 'uncover': return { opacity: 0.5, zIndex: 1 };
      case 'hero-pop': return { opacity: 0.4, zIndex: 1 };
      default: return { opacity: 0, zIndex: 1 };
    }
  },
  enter: (c: NavCtx) => ({ x: 0, opacity: 1, transition: enterTransition(c), transitionEnd: { zIndex: 6 } }),
  exit: (c: NavCtx) => {
    if (c.reduced) return { opacity: 0, transition: REDUCED };
    switch (c.kind) {
      case 'push': return { x: `${-28 * sx(c)}%`, opacity: 0.5, zIndex: 1, transition: SPRING.page };
      case 'cover': return { opacity: 0.5, zIndex: 1, transition: SPRING.cover };
      case 'hero': return { opacity: 0, zIndex: 1, transition: { duration: 0.15, ease: EASE.exit } };
      default: return { opacity: 0, zIndex: 1, transition: { duration: DUR.fast, ease: EASE.exit } };
    }
  },
};

/** Bottom snackbar (D13): rises on the sheet spring, fades down on exit. */
export const snackVariants: Variants = {
  initial: { opacity: 0, y: DIST.m + 4, scale: 0.98 },
  enter: { opacity: 1, y: 0, scale: 1, transition: SPRING.sheet },
  exit: { opacity: 0, y: DIST.s, transition: { duration: DUR.fast, ease: EASE.exit } },
};

/* ---------- micro patterns ---------- */
export const shake = { x: [0, -8, 7, -5, 4, -2, 0], transition: { duration: 0.36, ease: 'easeOut' } } as const;
export const press = { whileTap: { scale: 0.97 }, transition: SPRING.press } as const; // buttons
export const pressCard = { whileTap: { scale: 0.98 }, transition: SPRING.press } as const;
export const pressRound = { whileTap: { scale: 0.92 }, transition: SPRING.press } as const; // 44–84px round buttons
export const listItem = {
  initial: { opacity: 0, y: DIST.m },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DUR.fast, ease: EASE.exit } },
} as const;

/* ---------- motion tier ---------- */
export type MotionTier = 'full' | 'lite' | 'reduced';
/**
 * Telegram Android appends the device performance class to the UA, e.g.
 * `Telegram-Android/11.4.2 (Google Pixel 4a; Android 13; SDK 33; AVERAGE)`.
 * Core count only counts on Android: iOS WebKit clamps hardwareConcurrency, so it says nothing there.
 */
export function detectTier(reducedMotion: boolean, nav: Pick<Navigator, 'userAgent' | 'hardwareConcurrency'> & { deviceMemory?: number } | undefined =
  typeof navigator === 'undefined' ? undefined : navigator): MotionTier {
  if (reducedMotion) return 'reduced';
  if (!nav) return 'full';
  const ua = nav.userAgent ?? '';
  const cls = /Telegram-Android\/[^\s]+ \([^)]*;\s*(LOW|AVERAGE|HIGH)\)/.exec(ua)?.[1];
  if (cls) return cls === 'LOW' ? 'lite' : 'full';
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return 'lite';
  if (/Android/i.test(ua) && (nav.hardwareConcurrency ?? 8) <= 4) return 'lite';
  return 'full';
}
