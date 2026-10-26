/**
 * The no-scroll layout classes (design §9.2). The page reads its available height (Telegram's stable viewport less
 * the safe areas) and width, picks one class, and pet.css sizes everything from the class's tokens
 * (`.pet-root[data-h=…]`, `[data-layout=wide]`). Nothing on the page scrolls at any size: long things page.
 */

export type HeightClass = 'peek' | 'short' | 'regular' | 'tall';
export type LayoutClass = HeightClass | 'wide';

export interface Layout {
  /** the root's class: `wide` from 600 px wide, else the height class */
  cls: LayoutClass;
  /** the height class (a wide page uses it too: a landscape phone is wide and short, §9.4 rule 8) */
  h: HeightClass;
  /** the talk keyboard is up: dock and rail hide, the class drops to at most Short (§9.4 rule 6) */
  kb: boolean;
  /** the bubble's height class: the keyboard does not take its line budget away (§9.4 rule 6) */
  bubble: HeightClass;
}

export const WIDE_FROM = 600;
/** Wide: a centred column (§9.2) */
export const COLUMN_MAX = 480;

export function heightClass(h: number): HeightClass {
  return h < 480 ? 'peek' : h < 620 ? 'short' : h < 780 ? 'regular' : 'tall';
}

/** `h` is the available height: stable viewport − safe top − safe bottom. */
export function layoutOf(w: number, h: number, kb = false): Layout {
  const bubble = heightClass(h);
  const hc: HeightClass = kb && (bubble === 'regular' || bubble === 'tall') ? 'short' : bubble;
  return { cls: w >= WIDE_FROM ? 'wide' : hc, h: hc, kb, bubble };
}

/** The bubble's line budget per class (§9.2): Wide is as Tall. */
export const BUBBLE_LINES: Record<HeightClass, number> = { peek: 2, short: 3, regular: 4, tall: 5 };

/** The bubble's width in px, matching pet.css `.pet-bubble` max-width: min(78vw, 320px). */
export const bubbleWidth = (vw: number) => Math.min(vw * 0.78, 320);

/**
 * How far the live viewport must drop below the stable one, with the talk field focused, to count as the keyboard
 * (a Telegram sheet dragged a little, or the URL bar, moves it by less).
 */
export const KEYBOARD_PX = 120;
